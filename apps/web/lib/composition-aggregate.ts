import {
  compareFine,
  COMPOSITION_MAX_DEPTH,
  fineToPct,
  IMPURITY_NONE,
  type Ratio,
  RATIO_ONE,
  ratioToFine,
  timesPct,
} from "@chem/shared";
import { COMPOSITION_INCLUDE } from "@/lib/composition-service";
import {
  casTypeKey,
  currentSources,
  nearMissByCas,
  previousVersion,
  regulationsByCas,
} from "@/lib/composition-regulations";
import { listNumbersByCas, listInventoryColumns } from "@/lib/substance-numbers";
import { prisma } from "@/lib/db";
import { visibilityWhere } from "@/lib/product-service";
import type { Actor } from "@/lib/authz";
import type { CompositionAggregateDto } from "@/lib/types";

/**
 * 組成をCAS番号でまとめる。
 *
 * 登録した組成は1段しか持たないので、原材料を末端の物質まで下ろしてから、
 * 同じCAS番号のものを足し合わせる。法規制の判定はCAS単位で行うため、
 * 判定に使えるのはこちらの値になる。
 *
 * まとめるのは3つの事情が重なった結果で、そのどれもが普通に起きる。
 *  - 同じCASの物質が、仕入先ごとに別IDで登録されている
 *  - 同じ物質が、木の別の場所から何度も出てくる
 *  - それぞれが違う深さにいる
 * 寄与元は木のあちこちに散らばるので、この表は木を並べ替えたものではなく、別の平らな表になる。
 *
 * 展開できなかった枝があると、この表は不完全になる。完成した数字に見えてしまうと危ないので、
 * 開けなかった原材料を blocked に載せて呼び出し側から見えるようにする。
 */

/**
 * CASを持たない物質はまとめようがないので、物質IDそのものを鍵にする。
 * **不純物種別（S21）が違えば別の行**にする（種別をまたいで足さない）
 */
const keyOf = (casNormalized: string | null, substanceId: string, type: string) =>
  casNormalized ? `cas:${casNormalized}@${type}` : `sub:${substanceId}`;

interface Bucket {
  casNumber: string | null;
  casNormalized: string | null;
  /** 不純物種別（S21）。0 は「不純物ではない」 */
  impurityTypeId: string;
  /** 代表が決まるまでの仮の名前。いちばん最初に見つけた物質のもの */
  code: string;
  nameJa: string;
  nameEn: string | null;
  /** 代表が決まらないとき（CASを持たない物質）に出すスコア */
  score: string;
  scoreRank: string | null;
  /** 合算用の細かい整数 */
  fine: bigint;
  /** 寄与元。並べ替えたいので、細かい整数のまま持つ */
  contributions: { code: string; nameJa: string; nameEn: string | null; fine: bigint }[];
  /** 組成の行の備考。重なりを除いて出す順に持つ */
  notes: string[];
}

/** 展開した 1 行。まとめる前なので、同じ物質が木の別の場所から何度も出る */
export interface ExpandedCompositionRow {
  /** たどった原材料の名前（根の製品は含めない） */
  path: { code: string; nameJa: string; nameEn: string | null }[];
  code: string;
  casNumber: string | null;
  nameJa: string;
  nameEn: string | null;
  /** 製品全体に占める重量% */
  totalPct: string;
  note: string | null;
}

/**
 * 組成を末端の物質まで下ろし、**まとめずに** 1 行ずつ返す（2026-09-16 指示。帳票の「原材料展開（合算前）」）。
 * どの原材料をたどって来たかが分かる。数え上げかたは aggregateComposition と同じ
 */
export async function expandComposition(
  actor: Actor,
  rootProductId: string,
): Promise<ExpandedCompositionRow[]> {
  const rows: ExpandedCompositionRow[] = [];
  async function walk(
    productId: string,
    ratio: Ratio,
    depth: number,
    path: ExpandedCompositionRow["path"],
  ): Promise<void> {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null, ...visibilityWhere(actor) },
      select: { id: true },
    });
    if (!product) return;
    const lines = await prisma.compositionLine.findMany({
      where: { parentProductId: productId },
      include: COMPOSITION_INCLUDE,
      orderBy: { displayOrder: "asc" },
    });
    for (const line of lines) {
      const within = line.contentPct?.toString() ?? null;
      if (within === null) continue;
      const next = timesPct(ratio, within);
      if (!next) continue;
      if (line.substance) {
        rows.push({
          path,
          code: line.substance.code,
          casNumber: line.substance.casNumber,
          nameJa: line.substance.nameJa,
          nameEn: line.substance.nameEn,
          totalPct: fineToPct(ratioToFine(next)),
          note: line.note,
        });
        continue;
      }
      if (!line.childProduct || depth >= COMPOSITION_MAX_DEPTH) continue;
      const c = line.childProduct;
      await walk(c.id, next, depth + 1, [
        ...path,
        { code: c.code, nameJa: c.nameJa, nameEn: c.nameEn },
      ]);
    }
  }
  await walk(rootProductId, RATIO_ONE, 0, []);
  return rows;
}

export async function aggregateComposition(
  actor: Actor,
  rootProductId: string,
): Promise<CompositionAggregateDto> {
  const buckets = new Map<string, Bucket>();
  const blocked: CompositionAggregateDto["blocked"] = [];
  let truncated = 0;

  /** 同じ原材料が木の何か所にも出てくるので、1リクエストの中では一度しか引かない */
  const linesCache = new Map<string, Awaited<ReturnType<typeof loadLines>>>();

  async function loadLines(productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null, ...visibilityWhere(actor) },
      select: { id: true },
    });
    if (!product) return { reason: "notFound" as const };

    const lines = await prisma.compositionLine.findMany({
      where: { parentProductId: productId },
      include: COMPOSITION_INCLUDE,
      orderBy: { displayOrder: "asc" },
    });
    if (lines.length === 0) return { reason: "empty" as const };
    return { lines };
  }

  function cachedLines(productId: string) {
    const known = linesCache.get(productId);
    if (known) return Promise.resolve(known);
    return loadLines(productId).then((v) => {
      linesCache.set(productId, v);
      return v;
    });
  }

  async function walk(productId: string, ratio: Ratio, depth: number) {
    const found = await cachedLines(productId);
    if ("reason" in found) return found.reason;

    for (const line of found.lines) {
      const within = line.contentPct?.toString() ?? null;
      if (within === null) continue;
      const next = timesPct(ratio, within);
      if (!next) continue;

      if (line.substance) {
        addLeaf(line.substance, next, line.note);
        continue;
      }
      if (!line.childProduct) continue;

      if (depth >= COMPOSITION_MAX_DEPTH) {
        truncated += 1;
        continue;
      }
      const child = line.childProduct;
      const reason = await walk(child.id, next, depth + 1);
      if (reason) {
        blocked.push({
          code: child.code,
          nameJa: child.nameJa,
          nameEn: child.nameEn,
          pct: fineToPct(ratioToFine(next)),
          reason,
        });
      }
    }
    return null;
  }

  function addLeaf(
    substance: {
      id: string;
      code: string;
      nameJa: string;
      nameEn: string | null;
      casNumber: string | null;
      score: { toString(): string };
      scoreRank: string | null;
      impurityTypeId?: string;
    },
    ratio: Ratio,
    note: string | null,
  ) {
    const casNormalized = substance.casNumber?.trim().toUpperCase() ?? null;
    const type = substance.impurityTypeId ?? IMPURITY_NONE;
    const key = keyOf(casNormalized, substance.id, type);
    const fine = ratioToFine(ratio);

    const bucket = buckets.get(key) ?? {
      casNumber: substance.casNumber,
      casNormalized,
      impurityTypeId: type,
      code: substance.code,
      nameJa: substance.nameJa,
      nameEn: substance.nameEn,
      score: substance.score.toString(),
      scoreRank: substance.scoreRank,
      fine: 0n,
      contributions: [],
      notes: [],
    };
    bucket.fine += fine;
    bucket.contributions.push({
      code: substance.code,
      nameJa: substance.nameJa,
      nameEn: substance.nameEn,
      fine,
    });
    const trimmed = note?.trim();
    if (trimmed && !bucket.notes.includes(trimmed)) bucket.notes.push(trimmed);
    buckets.set(key, bucket);
  }

  const rootReason = await walk(rootProductId, RATIO_ONE, 0);
  if (rootReason) {
    return {
      rows: [],
      totalPct: "0",
      blocked,
      truncated,
      sources: await currentSources(),
      previousVersion: (await previousVersion())?.code ?? null,
      inventories: await listInventoryColumns(),
    };
  }

  // まとめた行に出す名称は、そのCASの代表物質から取る
  const casKeys = [...buckets.values()].flatMap((b) => (b.casNormalized ? [b.casNormalized] : []));
  const representatives =
    casKeys.length === 0
      ? []
      : await prisma.substance.findMany({
          where: { casNormalized: { in: casKeys }, isCasRepresentative: true, deletedAt: null },
          select: {
            casNormalized: true,
            code: true,
            nameJa: true,
            nameEn: true,
            score: true,
            scoreRank: true,
            impurityTypeId: true,
          },
        });
  // 代表は CAS × 不純物種別ごとに 1 件（S21）
  const byCas = new Map(
    representatives.map((r) => [`${r.casNormalized ?? ""}@${r.impurityTypeId}`, r]),
  );

  /*
    どの CAS がどの規制区分に効いているか。保持してある判定結果から引くだけで、
    ここで判定し直しはしない（2か所で計算すると必ず食い違う）。
    まだ判定していない製品では空になる。空＝該当なし ではないので、
    印が付かないことを「かかっていない」と読ませないよう、画面側で断る。
  */
  const regulations = await regulationsByCas(rootProductId);
  /*
    当たってはいないが、CAS が載っているもの。含有率が変われば規制を受けるので、
    画面で切り替えて見られるようにする（既定は出さない）
  */
  const nearMiss = await nearMissByCas(rootProductId, casKeys);
  // インベントリの番号（化審法番号・EC番号など）。物質の画面と同じ引きかた
  const numbers = await listNumbersByCas(casKeys, { all: true });

  const rows = [...buckets.values()]
    .sort((a, b) => compareFine(b.fine, a.fine))
    .map((b) => {
      const rep = b.casNormalized ? byCas.get(`${b.casNormalized}@${b.impurityTypeId}`) : undefined;
      return {
        casNumber: b.casNumber,
        impurityTypeId: b.impurityTypeId,
        code: rep?.code ?? b.code,
        nameJa: rep?.nameJa ?? b.nameJa,
        nameEn: rep?.nameEn ?? b.nameEn,
        totalPct: fineToPct(b.fine),
        // スコアは物質そのものに付く値。CASでまとめた行は代表物質のものを出す
        score: rep?.score.toString() ?? b.score,
        scoreRank: rep ? rep.scoreRank : b.scoreRank,
        // 内訳も多い順。上の表と並びを揃える
        contributions: b.contributions
          .sort((x, y) => compareFine(y.fine, x.fine))
          .map((c) => ({
            code: c.code,
            nameJa: c.nameJa,
            nameEn: c.nameEn,
            pct: fineToPct(c.fine),
          })),
        note: b.notes.join("／") || null,
        /*
          判定は正規化した CAS で紐づいている（表示用の CAS 番号ではない）。
          **規制は CAS × 不純物種別で引く**（S21）。除外した区分が不純物の行に出ないようにする。
          含有率不足のほうはリンクの側に種別が無いので、CAS だけで引く
        */
        regulations:
          (b.casNormalized
            ? regulations.get(casTypeKey(b.casNormalized, b.impurityTypeId))
            : undefined) ?? [],
        nearMiss: (b.casNormalized ? nearMiss.get(b.casNormalized) : undefined) ?? [],
        numbers:
          (b.casNormalized ? numbers.get(b.casNormalized) : undefined)?.map((n) => ({
            inventoryId: n.inventoryId,
            number: n.number,
          })) ?? [],
      };
    });

  const total = [...buckets.values()].reduce((acc, b) => acc + b.fine, 0n);
  // 表の印と、その意味を並べる札に使う
  return {
    rows,
    totalPct: fineToPct(total),
    blocked,
    truncated,
    sources: await currentSources(),
    previousVersion: (await previousVersion())?.code ?? null,
    // 表の右に出すインベントリの列。行が無くても列は出す
    inventories: await listInventoryColumns(),
  };
}
