/**
 * e-Gov 法令API の XML を読むための、最小限の読み取り。
 *
 * 法令XMLは素直な作りで、CDATA も名前空間も出てこない。
 * そのため外部の部品を足さずに、必要なところだけを自前で読む。
 *
 * **ルビ（`Rt`）の扱いが要点。**法令XMLは、読み仮名と上付き添字を
 * 同じ仕組みで書いている。落とし方を間違えると「五弗ふつ化臭素」になったり、
 * von Baeyer 名の位置番号が消えたりする。
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
}

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescape(s: string): string {
  return s.replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITY[body] ?? whole;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][-\w:.]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) attrs[m[1]!] = unescape(m[2]!);
  return attrs;
}

/**
 * XML を木にする。宣言・コメント・処理命令は読み飛ばす。
 * 閉じ忘れがあれば投げる（法令XMLで起きたことはないが、黙って進むと照合が狂う）
 */
export function parseXml(src: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim() !== "") stack[stack.length - 1]!.children.push(unescape(text));
    }
    if (src.startsWith("<!--", lt)) {
      i = src.indexOf("-->", lt) + 3;
      continue;
    }
    if (src.startsWith("<?", lt) || src.startsWith("<!", lt)) {
      i = src.indexOf(">", lt) + 1;
      continue;
    }
    const gt = src.indexOf(">", lt);
    if (gt < 0) throw new Error("閉じていないタグがあります");
    const body = src.slice(lt + 1, gt);

    if (body.startsWith("/")) {
      const tag = body.slice(1).trim();
      const top = stack[stack.length - 1];
      if (!top || top.tag !== tag) throw new Error(`閉じタグが合いません: ${tag}`);
      stack.pop();
    } else if (body.endsWith("/")) {
      const tag = body.slice(0, -1).trim().split(/\s/)[0]!;
      stack[stack.length - 1]!.children.push({ tag, attrs: parseAttrs(body), children: [] });
    } else {
      const tag = body.trim().split(/\s/)[0]!;
      const node: XmlNode = { tag, attrs: parseAttrs(body), children: [] };
      stack[stack.length - 1]!.children.push(node);
      stack.push(node);
    }
    i = gt + 1;
  }
  if (stack.length !== 1) throw new Error("閉じていない要素があります");
  return root;
}

/**
 * `Rt`（ルビ）の中身が**読み仮名**か、それとも**上付き添字**かを見分ける。
 *
 * 法令XMLは縦書きの組版なので、この2つを同じ `Ruby`/`Rt` で書いている。
 *
 * ```
 * 五弗<Ruby>素<Rt>ふつ</Rt></Ruby>化臭素                読み仮名。落とす
 * ペンタシクロ［五・三・〇・<Ruby>〇<Rt>二・六</Rt></Ruby>］  上付き添字。残す
 * ```
 *
 * **落とし方を間違えると、どちらかが壊れる。**
 * 読み仮名を残すと「五弗ふつ化臭素」になり、
 * 上付き添字を落とすと von Baeyer 名の位置番号が消える。
 *
 * 見分けは中身で付く。**かなだけなら読み仮名**、数字が混じれば添字。
 */
export function isReading(rt: string): boolean {
  return /^[ぁ-ゖァ-ヺー・]+$/.test(rt);
}

/**
 * 中の文字だけを取り出す。改行と空白は落とす。
 *
 * 読み仮名は落とし、上付き添字は `（）` に入れて残す。
 */
export function nodeText(node: XmlNode | string): string {
  if (typeof node === "string") return node;
  if (node.tag === "Rt") {
    const body = node.children.map((c) => nodeText(c)).join("");
    return isReading(body) ? "" : `（${body}）`;
  }
  return node.children
    .map((c) => nodeText(c))
    .join("")
    .split(/\s+/)
    .join(" ")
    .trim();
}

/** 木の中から、そのタグの要素をすべて拾う（深さ優先） */
export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (typeof c === "string") continue;
      if (c.tag === tag) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** 直下の子だけを拾う。入れ子の同名要素を巻き込みたくないときに使う */
export function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c): c is XmlNode => typeof c !== "string" && c.tag === tag);
}

/** 最初に見つかった要素の文字。無ければ空 */
export function textOf(node: XmlNode, tag: string): string {
  const hit = findAll(node, tag)[0];
  return hit ? nodeText(hit) : "";
}
