/**
 * 物質のスコアとランク。
 *
 * **スコア**は、その物質が当たっている規制区分に人が付けた点数の合計。
 * 製品の組成とは関係のない、**物質そのものに付く値**。
 *
 * **ランク**は、スコアを段階に読み替えたもの。対応表はシステム設定で決める。
 * 段の数は決めない。名前も数字でなくてよい（`A` `要注意` など）。
 *
 * 合計と読み替えの決まりはここに集める。サーバーと画面の両方で同じ判断をするため。
 */
import { z } from "zod";
import { toScaled } from "./decimal";
import type { Messages } from "./i18n/ja";

/** 境目に、その値そのものを含めるかどうか */
export type RankBound = "INCLUSIVE" | "EXCLUSIVE";

/**
 * ランクの1段。
 *
 * 上下の境目は**値と不等号**で持つ。値が空なら、その側に限りが無い。
 * 隣どうしで同じ値を使えるように、含む・含まないを段ごとに決められる
 * （`0 ≦ x < 30` の次が `30 ≦ x < 70`）。
 */
export interface RankBand {
  id?: string;
  /** 画面に出す段の名前 */
  label: string;
  /** 下限。空なら下限なし */
  lowerValue: string | null;
  lowerBound: RankBound | null;
  /** 上限。空なら上限なし */
  upperValue: string | null;
  upperBound: RankBound | null;
  displayOrder: number;
  note?: string | null;
}

/** 規制区分に入れられるスコアの範囲。システム設定で決める */
export interface ScoreRange {
  min: string;
  max: string;
}

/**
 * その段に当てはまるか。
 *
 * **上下とも空の段は、どんな値にも当てはまる。**
 * 受け皿（「その他」）として使えるように、あえて弾かない。
 */
export function bandMatches(score: string, band: RankBand): boolean {
  const v = toScaled(score);
  if (v === null) return false;

  if (band.lowerValue !== null && band.lowerValue !== "") {
    const lo = toScaled(band.lowerValue);
    if (lo === null) return false;
    if (band.lowerBound === "EXCLUSIVE" ? v <= lo : v < lo) return false;
  }
  if (band.upperValue !== null && band.upperValue !== "") {
    const hi = toScaled(band.upperValue);
    if (hi === null) return false;
    if (band.upperBound === "EXCLUSIVE" ? v >= hi : v > hi) return false;
  }
  return true;
}

/**
 * スコアをランクに読み替える。
 *
 * **並び順に見て、最初に当てはまった段を採る。**
 * 境目が重なっていても結果が1つに決まるようにするため。
 * どの段にも当てはまらなければ null（画面では空欄になる）。
 */
export function rankOf(score: string, bands: RankBand[]): string | null {
  const sorted = [...bands].sort((a, b) => a.displayOrder - b.displayOrder);
  for (const b of sorted) if (bandMatches(score, b)) return b.label;
  return null;
}

/** 段の範囲を人が読む形にする。`0 ≦ x < 30` */
export function describeBand(band: RankBand): string {
  const lo = band.lowerValue !== null && band.lowerValue !== "" ? band.lowerValue : null;
  const hi = band.upperValue !== null && band.upperValue !== "" ? band.upperValue : null;
  if (lo === null && hi === null) return "すべて";
  const left = lo === null ? "" : `${lo} ${band.lowerBound === "EXCLUSIVE" ? "<" : "≦"} `;
  const right = hi === null ? "" : ` ${band.upperBound === "EXCLUSIVE" ? "<" : "≦"} ${hi}`;
  return `${left}x${right}`;
}

/**
 * 対応表の見落としを拾う。**保存は止めない。**
 * 境目の決め方は業務の都合で決まるもので、機械が正しさを決められないため、
 * 気づきとして画面に出すだけにする。
 */
export interface BandWarning {
  kind: "overlap" | "gap" | "unreachable";
  /** 並び順で何番目と何番目のことか（1始まり） */
  at: number[];
}

export function checkBands(bands: RankBand[]): BandWarning[] {
  const sorted = [...bands].sort((a, b) => a.displayOrder - b.displayOrder);
  const out: BandWarning[] = [];

  // 上下とも空の段より後ろは、決して当たらない
  const catchAll = sorted.findIndex((b) => !b.lowerValue && !b.upperValue);
  if (catchAll >= 0 && catchAll < sorted.length - 1) {
    out.push({ kind: "unreachable", at: [catchAll + 2] });
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const aHi = a.upperValue ? toScaled(a.upperValue) : null;
    const bLo = b.lowerValue ? toScaled(b.lowerValue) : null;
    if (aHi === null || bLo === null) continue;

    if (bLo > aHi) out.push({ kind: "gap", at: [i + 1, i + 2] });
    else if (
      bLo < aHi ||
      // 同じ値で、両方が「含む」なら重なる
      (bLo === aHi && a.upperBound === "INCLUSIVE" && b.lowerBound === "INCLUSIVE")
    ) {
      out.push({ kind: "overlap", at: [i + 1, i + 2] });
    }
  }
  return out;
}

/** 数として読める文字列か。空は許す（限りなしの意味） */
const decimalText = (m: Messages, allowEmpty: boolean) =>
  z
    .string()
    .trim()
    .refine((v) => (allowEmpty && v === "") || toScaled(v) !== null, {
      message: m.validation.numberFormat,
    });

export const rankBandSchema = (m: Messages) =>
  z
    .object({
      label: z.string().trim().min(1, m.validation.required).max(50),
      lowerValue: decimalText(m, true),
      lowerBound: z.enum(["INCLUSIVE", "EXCLUSIVE"]).nullable(),
      upperValue: decimalText(m, true),
      upperBound: z.enum(["INCLUSIVE", "EXCLUSIVE"]).nullable(),
      displayOrder: z.number().int().min(0),
      note: z.string().trim().max(1000).nullable().optional(),
    })
    .refine(
      (b) => {
        if (b.lowerValue === "" || b.upperValue === "") return true;
        const lo = toScaled(b.lowerValue);
        const hi = toScaled(b.upperValue);
        return lo === null || hi === null || lo <= hi;
      },
      { message: m.score.rangeReversed, path: ["upperValue"] },
    );

export type RankBandInput = z.infer<ReturnType<typeof rankBandSchema>>;

/** 規制区分のスコア。システム設定で決めた範囲に収める */
export const categoryScoreSchema = (m: Messages, range: ScoreRange) =>
  z
    .string()
    .trim()
    .refine((v) => toScaled(v) !== null, { message: m.validation.numberFormat })
    .refine(
      (v) => {
        const s = toScaled(v);
        const lo = toScaled(range.min);
        const hi = toScaled(range.max);
        if (s === null) return false;
        return (lo === null || s >= lo) && (hi === null || s <= hi);
      },
      { message: m.score.outOfRange(range.min, range.max) },
    );
