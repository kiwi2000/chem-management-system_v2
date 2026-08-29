import {
  COMPOSITION_MAX_DEPTH,
  RATIO_ONE,
  compareFine,
  fineToPct,
  ratioToFine,
  timesPct,
  validateCompositionSum,
  type AppSettings,
  type Messages,
  type Ratio,
} from "@chem/shared";
import { COMPOSITION_INCLUDE } from "@/lib/composition-service";
import {
  currentSources,
  nearMissByCas,
  previousVersion,
  regulationsByCas,
} from "@/lib/composition-regulations";
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

/** CASを持たない物質はまとめようがないので、物質IDそのものを鍵にする */
const keyOf = (casNormalized: string | null, substanceId: string) =>
  casNormalized ? `cas:${casNormalized}` : `sub:${substanceId}`;

interface Bucket {
  casNumber: string | null;
  casNormalized: string | null;
  /** 代表が決まるまでの仮の名前。いちばん最初に見つけた物質のもの */
  code: string;
  nameJa: string;
  nameEn: string | null;
  /** 合算用の細かい整数 */
  fine: bigint;
  /** 寄与元。並べ替えたいので、細かい整数のまま持つ */
  contributions: { code: string; nameJa: string; nameEn: string | null; fine: bigint }[];
  /** 組成の行の備考。重なりを除いて出す順に持つ */
  notes: string[];
}

export async function aggregateComposition(
  actor: Actor,
  rootProductId: string,
  settings: AppSettings,
  m: Messages,
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

    // 残部の行は自分では値を持たない。その組成から計算した値を使う
    const sum = validateCompositionSum(
      found.lines.map((l) => ({
        contentPct: l.contentPct?.toString() ?? null,
        isBalance: l.isBalance,
      })),
      settings,
      m,
    );

    for (const line of found.lines) {
      const within = line.isBalance ? sum.balancePct : (line.contentPct?.toString() ?? null);
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
    },
    ratio: Ratio,
    note: string | null,
  ) {
    const casNormalized = substance.casNumber?.trim().toUpperCase() ?? null;
    const key = keyOf(casNormalized, substance.id);
    const fine = ratioToFine(ratio);

    const bucket = buckets.get(key) ?? {
      casNumber: substance.casNumber,
      casNormalized,
      code: substance.code,
      nameJa: substance.nameJa,
      nameEn: substance.nameEn,
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
    };
  }

  // まとめた行に出す名称は、そのCASの代表物質から取る
  const casKeys = [...buckets.values()].flatMap((b) => (b.casNormalized ? [b.casNormalized] : []));
  const representatives =
    casKeys.length === 0
      ? []
      : await prisma.substance.findMany({
          where: { casNormalized: { in: casKeys }, isCasRepresentative: true, deletedAt: null },
          select: { casNormalized: true, code: true, nameJa: true, nameEn: true },
        });
  const byCas = new Map(representatives.map((r) => [r.casNormalized ?? "", r]));

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

  const rows = [...buckets.values()]
    .sort((a, b) => compareFine(b.fine, a.fine))
    .map((b) => {
      const rep = b.casNormalized ? byCas.get(b.casNormalized) : undefined;
      return {
        casNumber: b.casNumber,
        code: rep?.code ?? b.code,
        nameJa: rep?.nameJa ?? b.nameJa,
        nameEn: rep?.nameEn ?? b.nameEn,
        totalPct: fineToPct(b.fine),
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
        // 判定は正規化した CAS で紐づいている（表示用の CAS 番号ではない）
        regulations: (b.casNormalized ? regulations.get(b.casNormalized) : undefined) ?? [],
        nearMiss: (b.casNormalized ? nearMiss.get(b.casNormalized) : undefined) ?? [],
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
  };
}
