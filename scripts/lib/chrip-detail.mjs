/**
 * CHRIP の詳細ページ（HTML）から、法規制ごとの中身を取り出す。
 *
 * 詳細ページは「情報源」ごとの箱が縦に並び、その中が
 * 「項目名 → 値」の対で書かれている。欲しいのは
 *   政令番号（＝法文物質名を指す番号）と 政令名称（＝法文物質名）
 * の2つ。閾値や適用日も一緒に取れる。
 *
 * **1つの箱に、記載がいくつも並ぶ。**同じ物質が同じ法律の中で
 * 複数の号に載ることがあるため。例えばクロムは大気汚染防止法の
 * 別表1と別表2の両方に、ペンタクロロフェノールは韓国の
 * 禁止物質と有害化学物質の両方に載る。
 * **項目名がもう一度出てきたら、そこから次の記載**として切り分ける。
 * （切り分けないと最後の1つしか残らず、他は落ちる）
 */

const unescape = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** タグを落として、行の並びにする */
function lines(html) {
  return unescape(
    html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, "\n"),
  )
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 「情報源」の見出しになりうる語。ここで箱が切り替わる */
const SOURCE_HEAD =
  /^(化審法|化管法|安衛法|毒物及び劇物取締法|大気汚染防止法|水質汚濁防止法|土壌汚染対策法|化学兵器|特定物質等|REACH|EU|TSCA|中国|韓国|台湾)/;

/** 対で拾う項目 */
const KEYS = [
  "政令番号",
  "政令名称",
  // 毒劇法は項目名が違う。**同じものを別の呼び方**で持っている
  "法律又は政令番号",
  "法律又は政令名称",
  "管理番号",
  "官報整理番号",
  "適用日",
  "注記",
  "表示の対象となる範囲（重量％）",
  "通知の対象となる範囲（重量％）",
  "含有率",
  "分類",
  // 韓国（化評法／化管法）は項目名がすべて違う
  "NIER番号",
  "カテゴリ",
  "化学物質名称",
  "対象となる範囲（％）",
];

/** 呼び方の違いを1つに寄せる。使う側が場合分けしなくて済むように */
const SAME_AS = { 法律又は政令番号: "政令番号", 法律又は政令名称: "政令名称" };

export function parseDetail(html) {
  const ls = lines(html);
  const cid = ls[ls.indexOf("CHRIP_ID") + 1] ?? null;
  const cas = ls[ls.indexOf("CAS RN") + 1] ?? null;
  const nameJa = ls[ls.indexOf("日本語名") + 1] ?? null;
  const nameEn = ls[ls.indexOf("英語名") + 1] ?? null;

  /** 記載ごとの入れ物。1つの情報源から複数出ることがある */
  const entries = [];
  let source = null;
  let current = null;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (l === "データの説明") continue;
    if (SOURCE_HEAD.test(l) && l.length > 4 && !KEYS.includes(l)) {
      source = l;
      current = null;
      continue;
    }
    if (source && KEYS.includes(l)) {
      const v = ls[i + 1];
      // 次が項目名なら、その項目は空
      if (!v || KEYS.includes(v) || SOURCE_HEAD.test(v)) continue;
      const key = SAME_AS[l] ?? l;
      // 同じ項目名がもう一度出た＝次の記載が始まった
      if (!current || key in current.fields) {
        current = { source, fields: {} };
        entries.push(current);
      }
      current.fields[key] = v;
    }
  }
  return {
    cid,
    cas,
    nameJa,
    nameEn,
    entries: entries.filter((e) => Object.keys(e.fields).length > 0),
  };
}
