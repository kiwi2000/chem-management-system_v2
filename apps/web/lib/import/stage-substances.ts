import {
  SUBSTANCES_COLUMNS,
  looksLikeCas,
  mapHeader,
  normalizeCas,
  normalizeCode,
  parseTable,
} from "@chem/shared";
import { prisma } from "@/lib/db";
import {
  diffFields,
  editedByHuman,
  resolveOwner,
  stateRefusal,
  type StageContext,
  type StagedRow,
} from "@/lib/import/types";
import { visibilityWhere } from "@/lib/substance-service";

/**
 * 物質の表（TSV）を一時領域の行にする。鍵は物質コード。
 * 別名は「;」区切りで 1 列に書く（反映では、無いものを足すだけ）
 */

export interface SubstancePayload {
  code: string;
  nameJa: string;
  nameEn: string | null;
  casNumber: string | null;
  note: string | null;
  aliases: string[];
  /**
   * 所属先（S31。管理グループの id）。新しく作るときは必ず入る。
   * 既にある物質で null なら所属先を変えない（「画面で選んだ所属先」のとき）
   */
  ownerGroupId?: string | null;
}

const FIELDS = ["nameJa", "nameEn", "casNumber", "note"] as const;

export async function stageSubstances(
  text: string,
  ctx: StageContext,
): Promise<{
  rows: StagedRow[];
  errors: { line: number; message: string }[];
  notes: string[];
  count: number;
}> {
  const table = parseTable(text);
  const map = mapHeader(table.header, SUBSTANCES_COLUMNS);
  const errors: { line: number; message: string }[] = [];
  const notes: string[] = [];
  if (map.missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `必須の列がありません: ${map.missing.join("、")}` }],
      notes,
      count: table.rows.length,
    };
  }
  if (map.unknown.length > 0) notes.push(`使わない列: ${map.unknown.join("、")}`);
  const col = (row: string[], k: string) => {
    const i = map.index[k];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const existing = await prisma.substance.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      ownerGroupId: true,
      codeNormalized: true,
      nameJa: true,
      nameEn: true,
      casNumber: true,
      note: true,
      updatedBy: true,
      publishState: true,
      createdBy: true,
    },
  });
  /*
    S31: 取り込む人に見えない物質と同じコードの行は「このコードは使えません」とだけ出す
    （コードは全体で一意。見えないものの存在を知らせない）
  */
  const visibleIds = new Set(
    (
      await prisma.substance.findMany({
        where: { deletedAt: null, ...visibilityWhere(ctx.actor) },
        select: { id: true },
      })
    ).map((s) => s.id),
  );
  const hiddenCodes = new Set(
    existing.filter((s) => !visibleIds.has(s.id)).map((s) => s.codeNormalized),
  );
  const byCode = new Map(
    existing.filter((s) => visibleIds.has(s.id)).map((s) => [s.codeNormalized, s]),
  );
  const ownerCodeOf = new Map(ctx.owners.map((o) => [o.id, o.code]));
  const rows: StagedRow[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const code = col(row, "code");
    const nameJa = col(row, "nameJa");
    if (!code || !nameJa) {
      errors.push({ line, message: "物質コードか名称が空です" });
      return;
    }
    const codeN = normalizeCode(code);
    if (hiddenCodes.has(codeN)) {
      errors.push({ line, message: `物質「${code}」: このコードは使えません` });
      return;
    }
    if (seen.has(codeN)) {
      errors.push({ line, message: `物質コード「${code}」が表の中で重複しています` });
      return;
    }
    seen.add(codeN);
    const casRaw = col(row, "cas");
    const cas = casRaw ? normalizeCas(casRaw) : null;
    if (cas && !looksLikeCas(cas))
      notes.push(`${line} 行目: CAS「${casRaw}」は一般的な形ではありません（そのまま入れます）`);
    // 空の任意項目は本体の値を残す（製品の表と同じ。列を省いた小さな表で値が消えないように）
    const cur = byCode.get(codeN);
    const payload: SubstancePayload = {
      code,
      nameJa,
      nameEn: col(row, "nameEn") || cur?.nameEn || null,
      casNumber: cas ?? (cur?.casNumber ? normalizeCas(cur.casNumber) : null),
      note: col(row, "note") || cur?.note || null,
      aliases: col(row, "aliases")
        ? col(row, "aliases")
            .split(/[;；]/)
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    };
    // 所属先（S31 仕様 7 章）
    const owner = resolveOwner(
      ctx,
      cur?.ownerGroupId ?? null,
      normalizeCode(col(row, "owner")),
      "substanceEdit",
    );
    if (typeof owner === "string") {
      errors.push({ line, message: `物質「${code}」: ${owner}` });
      return;
    }
    payload.ownerGroupId = owner.target;
    const base = { kind: "substance_master" as const, keyPath: code, label: nameJa, payload };
    if (!cur) {
      rows.push({ ...base, action: "ADD", apply: true });
      return;
    }
    const diff = diffFields(cur, payload as unknown as Record<string, unknown>, FIELDS);
    if (owner.target && owner.target !== cur.ownerGroupId) {
      diff.ownerGroup = {
        current: ownerCodeOf.get(cur.ownerGroupId) ?? "",
        next: ownerCodeOf.get(owner.target) ?? "",
      };
    }
    /*
      公開の状態は画面と同じ決まり（承認待は誰も直せない。作成中・却下は作った本人だけ）。
      項目が今と同じなら断らない。「画面で直されています」の行にする前に見る（反映に切り替えられないように）
    */
    const refusal = Object.keys(diff).length > 0 ? stateRefusal(ctx.actor, cur) : null;
    if (refusal) {
      errors.push({ line, message: `物質「${code}」: ${refusal}` });
      return;
    }
    if (Object.keys(diff).length === 0) rows.push({ ...base, action: "UNCHANGED", apply: false });
    else if (editedByHuman(cur.updatedBy))
      rows.push({
        ...base,
        action: "CONFLICT",
        apply: false,
        diff,
        message: "前回の取り込みのあとに画面で直されています",
      });
    else rows.push({ ...base, action: "UPDATE", apply: true, diff });
  });
  return { rows, errors, notes, count: table.rows.length };
}
