import { normalizeCas, normalizeCode } from "@chem/shared";
import type { User } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import type { Actor } from "@/lib/authz";
import { aggregateComposition } from "@/lib/composition-aggregate";
import { PRE_REACTION_INCLUDE } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import type { CompositionAggregateDto } from "@/lib/types";

/**
 * 反応前組成（S24）の展開・合算を、原材料の変更に追いかけさせる（2026-10-03 指示）。
 *
 * 反応前の写し（product_pre_reaction_lines）は原材料の行を持つ。画面の展開・合算は表示のたびに
 * 原材料のいまの組成から作るので自然に追いかけるが、写し取ったときに凍結した展開結果
 * （product_pre_reaction_expansion_lines。一覧の「展開・合算後」で探すのに使う）は止まったまま。
 * 原材料の組成が変わったら、それを反応前に含む製品の凍結した展開結果を作り直し、
 * 中身が変わっていれば製品に印（pre_reaction_changed_at）を付ける。
 *
 * **反応後組成（登録組成）は変えない。**印が付いた製品を開くと、反応後組成も書き換えるかを尋ねる
 * （いまの反応後を編集する／反応前をコピーしてから編集する／このままにする）。反応後を保存すると印は消える
 */

/**
 * 裏の作り直しで使う、すべてを見られる立場。人の操作ではないので見える範囲で隠さない。
 * **画面に返す値を作るのには使わない**（見せてよい範囲は人ごとに違う）
 */
const SYSTEM_ACTOR: Actor = {
  user: { id: "system" } as User,
  permissions: [],
  has: () => true,
};

/** 反応前の写しの行（合算の根に渡す形） */
export function loadPreRootLines(productId: string) {
  return prisma.productPreReactionLine.findMany({
    where: { productId },
    include: PRE_REACTION_INCLUDE,
    orderBy: { displayOrder: "asc" },
  });
}

/** 合算の行を、凍結する展開結果の行にする（代表物質のコードから物質を引く） */
export async function expansionRowsOf(productId: string, agg: CompositionAggregateDto) {
  const codes = [...new Set(agg.rows.map((r) => normalizeCode(r.code)))];
  const substances = await prisma.substance.findMany({
    where: { codeNormalized: { in: codes }, deletedAt: null },
    select: { id: true, codeNormalized: true },
  });
  const idByCode = new Map(substances.map((s) => [s.codeNormalized, s.id]));
  return agg.rows.map((r) => ({
    productId,
    casNormalized: r.casNumber ? normalizeCas(r.casNumber) : null,
    substanceId: idByCode.get(normalizeCode(r.code)) ?? null,
    impurityTypeId: r.impurityTypeId,
    totalPct: r.totalPct,
  }));
}

/**
 * 合算の表から、反応後の出発点の行を作る（物質ごと。2026-09-29 指示）。
 * 展開できなかった原材料（中身が無い・見えない）は、数字を失わないよう原材料の行のまま残す。
 * 「反応後の組成入力」と「反応前組成をコピーしてから編集する」の両方で使う
 */
export async function postStartLines(agg: CompositionAggregateDto) {
  const codes = [...new Set(agg.rows.map((r) => normalizeCode(r.code)))];
  const substances = await prisma.substance.findMany({
    where: { codeNormalized: { in: codes }, deletedAt: null },
    select: { id: true, codeNormalized: true },
  });
  const idByCode = new Map(substances.map((s) => [s.codeNormalized, s.id]));
  const next: {
    substanceId: string | null;
    childProductId: string | null;
    contentPct: string | null;
    note: string | null;
  }[] = [];
  for (const r of agg.rows) {
    const substanceId = idByCode.get(normalizeCode(r.code));
    if (!substanceId) continue; // 代表物質が引けない（消された直後など）。要確認に残す
    next.push({ substanceId, childProductId: null, contentPct: r.totalPct, note: r.note });
  }
  if (agg.blocked.length > 0) {
    const blockedCodes = [...new Set(agg.blocked.map((b) => normalizeCode(b.code)))];
    const children = await prisma.product.findMany({
      where: { codeNormalized: { in: blockedCodes }, deletedAt: null },
      select: { id: true, codeNormalized: true },
    });
    const childByCode = new Map(children.map((c) => [c.codeNormalized, c.id]));
    for (const b of agg.blocked) {
      const childProductId = childByCode.get(normalizeCode(b.code));
      if (childProductId)
        next.push({ substanceId: null, childProductId, contentPct: b.pct, note: null });
    }
  }
  return next;
}

/** 凍結した展開結果を比べる形（並び順に左右されない） */
function fingerprint(
  rows: {
    casNormalized: string | null;
    substanceId: string | null;
    impurityTypeId: string;
    totalPct: { toString(): string } | string;
  }[],
): string {
  return rows
    .map(
      (r) =>
        `${r.casNormalized ?? ""}|${r.substanceId ?? ""}|${r.impurityTypeId}|${Number(r.totalPct.toString())}`,
    )
    .sort()
    .join("\n");
}

/**
 * 組成が変わった製品（とその親）を反応前の写しに含む製品の、凍結した展開結果を作り直す。
 * 中身が変わった製品には印を付ける。作り直した数を返す。
 * 組成の保存・取り込みが通る展開の作り直し（expansion-store の recomputeFrom）から呼ぶ
 */
export async function refreshPreReactionsUsing(changedIds: string[]): Promise<number> {
  if (changedIds.length === 0) return 0;
  const owners = await prisma.product.findMany({
    where: {
      deletedAt: null,
      preReactionAt: { not: null },
      preReactionLines: { some: { childProductId: { in: changedIds } } },
    },
    select: { id: true },
  });
  let changed = 0;
  for (const { id } of owners) {
    const rootLines = await loadPreRootLines(id);
    const agg = await aggregateComposition(SYSTEM_ACTOR, id, { rootLines });
    const rows = await expansionRowsOf(id, agg);
    const before = await prisma.productPreReactionExpansionLine.findMany({
      where: { productId: id },
    });
    if (fingerprint(before) === fingerprint(rows)) continue;
    const at = new Date();
    await prisma.$transaction([
      prisma.productPreReactionExpansionLine.deleteMany({ where: { productId: id } }),
      prisma.productPreReactionExpansionLine.createMany({ data: rows }),
      prisma.product.update({ where: { id }, data: { preReactionChangedAt: at } }),
    ]);
    await writeAudit({
      entity: "product_pre_reaction",
      entityId: id,
      action: "update",
      diff: { reason: "material_changed", materials: changedIds.length, rows: rows.length },
    });
    changed++;
  }
  return changed;
}
