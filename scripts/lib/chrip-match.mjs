/**
 * CHRIP の詳細から取れた「政令番号」「政令名称」を、
 * 本システムの法文物質名に結び付けるための言い換え。
 *
 * **区分の対応表は持たない。**番号が分かれば、それがどの区分のものかは
 * 本システム側が知っている。手で対応表を作ると、そこが取り違えの元になる。
 */

/** 全角の英数字・記号を半角に寄せる */
function toHalfWidth(s) {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

/**
 * 番号の言い換え。
 *
 * CHRIP は「規則別表第2の1486」、本システムは「則別表第2の1486」のように、
 * **同じものを別の書き方**で持っている。ここで寄せる。
 */
export function normalizeNumber(raw) {
  if (!raw) return null;
  let s = toHalfWidth(raw).replace(/\s+/g, "");
  s = s.replace(/^規則別表/, "則別表");
  s = s.replace(/^法律別表/, "法別表"); // 毒劇法: 法律別表第2の15 → 法別表第2の15
  s = s.replace(/^政令第17条別表/, "令別表"); // 安衛法: 政令第17条別表第3… → 令別表第3…
  s = s.replace(/^政令第/, "令第"); // 水質・土壌: 政令第3条第5号 → 令第3条第5号
  s = s.replace(/^労働安全衛生法施行令別表/, "令別表");
  s = s.replace(/^施行令別表/, "令別表");
  s = s.replace(/^政令別表/, "令別表");
  s = s.replace(/^別表第3/, "令別表第3"); // 安衛法: 「令」が落ちている書き方
  /*
    安衛法の令別表第3は、CHRIP が「第1号3」「第2号23の3」のように
    **号のあとの「の」を落として**書く。本システムは「第1号の3」「第2号の23-3」。
    枝番の「の」は本システムでは「-」になる
  */
  const ishaBessou = /^令別表第3第(\d+)号(\d+)(?:の(\d+))?$/.exec(s);
  if (ishaBessou) {
    const [, gou, num, eda] = ishaBessou;
    s = `令別表第3第${gou}号の${num}` + (eda ? `-${eda}` : "");
  }
  /*
    化管法だけ体系が違う。「1-86」は**別表番号と連番**を並べたもので、
    本システムは「令別表第1の86」と書く。組み立て直す
  */
  const kakan = /^([12])-(\d+)$/.exec(s);
  // 「1-045」のように0で埋めて書かれることがある。本システムは埋めない
  if (kakan) s = `令別表第${kakan[1]}の${Number(kakan[2])}`;
  return s || null;
}

/**
 * 名前の言い換え。番号で当たらないときの手がかり。
 *
 * 法令の原文は全角・旧字が混ざる。**同じ物質を別の字で書いてあるだけ**なので、
 * 比べる前に形をそろえる。中黒と長音、かっこの種類も揺れる
 */
export function normalizeName(raw) {
  if (!raw) return null;
  let s = toHalfWidth(raw).toLowerCase();
  s = s.replace(/[（）]/g, (c) => (c === "（" ? "(" : ")"));
  s = s.replace(/[‐－―ー−–—]/g, "-");
  s = s.replace(/[・･]/g, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[。、,]/g, "");
  return s || null;
}
