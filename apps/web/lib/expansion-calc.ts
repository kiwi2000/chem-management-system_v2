import {
  COMPOSITION_MAX_DEPTH,
  RATIO_ONE,
  fineToPct,
  ratioToFine,
  timesPct,
  type Ratio,
} from "@chem/shared";

/**
 * 組成を末端まで下ろして、CAS でまとめる計算。
 *
 * **ここはデータベースを知らない。**読み出しは外から渡してもらう。
 * 判定の土台になる数字なので、手で組んだ木で境目まで試験できるようにしてある。
 * 保存や作り直しは expansion-store.ts の側。
 */

/** 保持する形。名前は持たない（物質マスターを引けば分かるものを二重に持たない） */
export interface ExpandedProduct {
  /** 展開できたぶんの合計 */
  totalPct: string;
  /** 中身が分からないまま残ったぶん。0 でなければ判定は言い切れない */
  unknownPct: string;
  /** 深さの上限で打ち切った枝の数 */
  truncated: number;
  lines: { casNormalized: string | null; substanceId: string | null; totalPct: string }[];
}

/** 組成の1行。木をたどるのに要るぶんだけ */
export interface ExpandLine {
  contentPct: string | null;
  substance: { id: string; casNumber: string | null } | null;
  childProductId: string | null;
}

/**
 * 組成を読み出す係。中身が無い（登録されていない・製品が無い）ときは null。
 * データベースから切り離しておき、計算だけを取り出して試験できるようにする。
 */
export type LineLoader = (productId: string) => Promise<ExpandLine[] | null>;

/**
 * 木をたどって、CAS でまとめる。**ここが計算の要。**
 *
 * 合算は細かい整数のまま行う。小数のまま足すと、桁の小さいものが消える。
 * 読み出しは外から渡してもらうので、この関数はデータベースを知らない。
 */
export async function expandTree(
  rootProductId: string,
  load: LineLoader,
): Promise<ExpandedProduct> {
  /** 鍵。CAS を持たない物質はまとめようがないので、物質そのものを鍵にする */
  const buckets = new Map<
    string,
    { cas: string | null; substanceId: string | null; fine: bigint }
  >();
  let unknownFine = 0n;
  let truncated = 0;

  /** 同じ原材料が木の何か所にも出てくるので、1回の計算の中では一度しか引かない */
  const cache = new Map<string, ExpandLine[] | null>();

  async function cachedLines(productId: string) {
    if (!cache.has(productId)) cache.set(productId, await load(productId));
    return cache.get(productId) ?? null;
  }

  /** その枝が開けなかったぶんを「分からない」として数える */
  function addUnknown(ratio: Ratio) {
    unknownFine += ratioToFine(ratio);
  }

  function addLeaf(substance: { id: string; casNumber: string | null }, ratio: Ratio) {
    const cas = substance.casNumber?.trim().toUpperCase() || null;
    // CAS を持つものは CAS でまとめる。持たないものは物質そのものを鍵にする
    const key = cas ? `cas:${cas}` : `sub:${substance.id}`;
    const cur = buckets.get(key) ?? {
      cas,
      substanceId: cas ? null : substance.id,
      fine: 0n,
    };
    cur.fine += ratioToFine(ratio);
    buckets.set(key, cur);
  }

  async function walk(productId: string, ratio: Ratio, depth: number): Promise<void> {
    const lines = await cachedLines(productId);
    if (!lines) {
      // 中身が登録されていない原材料。ここから先は分からない
      addUnknown(ratio);
      return;
    }

    for (const line of lines) {
      // 含有率はその行が持っている
      const within = line.contentPct?.toString() ?? null;
      if (within === null) continue;
      const next = timesPct(ratio, within);
      if (!next) continue;

      if (line.substance) {
        addLeaf(line.substance, next);
        continue;
      }
      if (!line.childProductId) continue;

      if (depth >= COMPOSITION_MAX_DEPTH) {
        // 深すぎて開けなかった。分からないぶんに数える
        truncated += 1;
        addUnknown(next);
        continue;
      }
      await walk(line.childProductId as string, next, depth + 1);
    }
  }

  await walk(rootProductId, RATIO_ONE, 0);

  return {
    totalPct: fineToPct([...buckets.values()].reduce((s, b) => s + b.fine, 0n)),
    unknownPct: fineToPct(unknownFine),
    truncated,
    lines: [...buckets.values()].map((b) => ({
      casNormalized: b.cas,
      substanceId: b.substanceId,
      totalPct: fineToPct(b.fine),
    })),
  };
}
