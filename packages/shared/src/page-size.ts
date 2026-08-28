import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_PAGE_SIZE_OPTIONS,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  isPageSize,
} from "./table";

/**
 * 1ページの件数の好み。**人ごとに決める。**
 *
 * 画面の高さも、一度に読みたい量も人によって違う。
 * 決め打ちにすると、誰かには多すぎ、誰かには少なすぎる。
 *
 * Cookie に置くのは、表が出るたびに問い合わせたくないため
 * （言語やテーマと同じ扱い）。
 */
export const PAGE_SIZE_COOKIE = "chem_page_sizes";

/** いちどに並べる選択肢の数。多すぎると選ぶのが手間になる */
export const PAGE_SIZE_CHOICE_MAX = 8;

export interface PageSizePrefs {
  /** 選択欄に並べる件数（小さい順） */
  options: number[];
  /** 表を開いたときの件数。必ず `options` のどれか */
  defaultSize: number;
}

export const DEFAULT_PAGE_SIZE_PREFS: PageSizePrefs = {
  options: [...DEFAULT_PAGE_SIZE_OPTIONS],
  defaultSize: DEFAULT_PAGE_SIZE,
};

/**
 * 打ち込まれた文字を件数の並びにする。
 * 区切りは何でもよい（カンマ・空白・読点）。読めなければ null
 */
export function parsePageSizeList(input: string): number[] | null {
  const parts = input
    .split(/[^0-9]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (parts.length === 0) return null;

  const out = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  if (out.length > PAGE_SIZE_CHOICE_MAX) return null;
  if (!out.every(isPageSize)) return null;
  return out;
}

/** 好みを1つの文字にする（`15,25,50,100|50`） */
export function formatPageSizePrefs(p: PageSizePrefs): string {
  return `${p.options.join(",")}|${p.defaultSize}`;
}

/**
 * 文字から好みに戻す。**読めないところは既定に落とす。**
 * 古い形が残っていても画面が壊れないようにする
 */
export function parsePageSizePrefs(raw: string | null | undefined): PageSizePrefs {
  if (!raw) return DEFAULT_PAGE_SIZE_PREFS;
  const [listPart, defPart] = raw.split("|");
  const options = parsePageSizeList(listPart ?? "");
  if (!options || options.length === 0) return DEFAULT_PAGE_SIZE_PREFS;

  const wanted = Number(defPart ?? "");
  // 既定が選択肢に無ければ、いちばん小さいものにする（必ず選べる数にする）
  const defaultSize = options.includes(wanted) ? wanted : options[0]!;
  return { options, defaultSize };
}

/** 打ち込みの誤りを、直しかたが分かる言葉で返す。問題なければ null */
export function pageSizeListProblem(
  input: string,
  m: {
    pageSizeUnreadable: string;
    pageSizeRange: (min: number, max: number) => string;
    pageSizeTooMany: (n: number) => string;
  },
): string | null {
  const parts = input.split(/[^0-9]+/).filter((s) => s !== "");
  if (parts.length === 0) return m.pageSizeUnreadable;
  if (new Set(parts.map(Number)).size > PAGE_SIZE_CHOICE_MAX) {
    return m.pageSizeTooMany(PAGE_SIZE_CHOICE_MAX);
  }
  if (!parts.map(Number).every(isPageSize)) return m.pageSizeRange(PAGE_SIZE_MIN, PAGE_SIZE_MAX);
  return null;
}
