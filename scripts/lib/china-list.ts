/**
 * LOLI の中国の一覧（`ListData.Data`）を読む。
 *
 * どの一覧も形が同じで、次の3つが1行に入っている。
 *
 * ```
 * "Present ([0486])" As Brucine [357-57-3]
 *  ~~~~~~~~~~~~~~~~     ~~~~~~~  ~~~~~~~~~
 *  状態と番号            代表の名前 代表の鍵
 * ```
 *
 * **`As` から後ろが「法文物質名」にあたる。**
 * 中国の目録は「ブルシン」という1項目に何個ものCASがぶら下がる作りで、
 * 行のCAS（`101324-32-7`）はそのぶら下がっている側。
 *
 * `As` が無い行もある。その場合は**行のCAS自身が1項目**。
 *
 * ```
 * Present ([0121])            ← 107-12-0 そのものが目録の項目
 * ```
 *
 * 状態の部分は一覧によって中身が違う。
 *
 *   1945 剧毒化学品   `Present ([0486])`           … 括弧の中が目録の序号
 *   2579 危险化学品   `Present (stabilized, [2811])` … 同上（前に注記が入ることがある）
 *   2171 易制毒化学品 `Category I precursor`        … 第I類〜第III類の別
 *   988  监控化学品   `Schedule 1: Chemicals ...`   … 第1表〜第4表の別
 *   5380 易制爆       `oxidising solid, category 3` … GHS区分（番号は無い）
 */

export interface ChinaListRow {
  /** ぶら下がっているCAS（`ListData.Cas`） */
  cas: string;
  /**
   * その項目を指す鍵。`As ... [ここ]` の値。
   * `As` が無ければ行のCAS自身（＝1項目1CAS）
   */
  entryKey: string;
  /** 項目の名前（英語）。`As` が無ければ空 */
  entryName: string | null;
  /** 目録の中の番号。持たない一覧もある */
  officialNumber: string | null;
  /** 第I類・第1表などの区分け。持たない一覧もある */
  className: string | null;
}

/** 目録の中の番号。`([0486])` `(stabilized, [2811])` のどちらの形でも拾う */
function officialNumber(status: string): string | null {
  const m = status.match(/\[([0-9A-Za-z-]+)\]/);
  if (!m?.[1]) return null;
  // 先頭の 0 は目録の書き方そのもの。落とさない
  return m[1];
}

/**
 * 第I類・第1表などの区分け。
 * **一覧ごとに書き方が違うので、分かる形だけを拾う。**
 * 拾えなかったものは区分け無し（1つのまとまりに入る）。
 */
function className(status: string): string | null {
  const precursor = status.match(/Category\s+(I{1,3}|IV)\s+precursor/i);
  if (precursor?.[1]) return `Category ${precursor[1].toUpperCase()}`;
  const schedule = status.match(/Schedule\s+(\d)/i);
  if (schedule?.[1]) return `Schedule ${schedule[1]}`;
  return null;
}

/**
 * 1行読む。読めない行は null。
 *
 * `Data` は引用符でくくられていることがある（中にカンマがある行）。
 * くくりは意味を持たないので外す。
 */
export function parseChinaRow(cas: string, data: string): ChinaListRow | null {
  const trimmedCas = cas.trim();
  if (!trimmedCas || !data.trim()) return null;

  // `As` の前後で切る。名前の中に " As " が入ることは無い（LOLI が付ける区切り）
  const at = data.indexOf('" As ');
  const [statusRaw, entryRaw] = at >= 0 ? [data.slice(0, at + 1), data.slice(at + 5)] : [data, ""];
  const status = statusRaw.trim().replace(/^"|"$/g, "");

  let entryKey = trimmedCas;
  let entryName: string | null = null;
  if (entryRaw) {
    // 末尾の [キー] を取り、その手前までが名前
    const m = entryRaw.match(/^(.*)\s\[([^\]]+)\]\s*;?\s*$/);
    if (m?.[1] && m[2]) {
      entryName = m[1].trim();
      entryKey = m[2].trim();
    } else {
      // 鍵が取れない書き方。名前だけ使い、鍵は行のCASにしておく
      entryName = entryRaw.trim().replace(/\s*;?\s*$/, "") || null;
    }
  }

  return {
    cas: trimmedCas,
    entryKey,
    entryName,
    officialNumber: officialNumber(status),
    className: className(status),
  };
}
