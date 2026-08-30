import { classifyTag, findTags, type DocumentTable, type DocumentTarget } from "@chem/shared";

/**
 * 預かったファイルの中の差込札を、値に置き換える。
 *
 * **見つからない札は空にする。**「？」や札のままを残すと、
 * 書いた文字と見分けが付かず、そのまま取引先へ出てしまう。
 * どの札が分からなかったかは呼んだ側へ返し、画面で知らせる
 */

export interface FillContext {
  target: DocumentTarget;
  /** 差込項目の鍵 → 出す文字 */
  values: Map<string, string>;
  /** 組織に打たれている項目名。これに無い `org.item.◯◯` は知らない札 */
  orgItems?: string[];
  /** 明細の行を埋めているときだけ入る。`{組成.CAS番号}` の受け皿 */
  row?: { table: DocumentTable; cells: Record<string, string> };
  /** 分からなかった札を集める */
  unknown: Set<string>;
}

/** 文字の中の札を置き換える。札が無ければ元の文字をそのまま返す */
export function fillText(text: string, ctx: FillContext): string {
  const tags = findTags(text);
  if (tags.length === 0) return text;

  let out = text;
  for (const t of tags) {
    const tag = classifyTag(t.key, ctx.target, ctx.orgItems);
    let value = "";
    if (tag.kind === "value") {
      value = ctx.values.get(tag.key) ?? "";
    } else if (tag.kind === "cell") {
      // 明細の行の外に置かれた表の札は、埋めようがないので空にする
      value = ctx.row?.table === tag.table ? (ctx.row.cells[tag.column] ?? "") : "";
    } else {
      ctx.unknown.add(t.key);
    }
    out = out.split(t.raw).join(value);
  }
  return out;
}

/** その文字が、どの表の明細を指しているか。指していなければ null */
export function tableOf(text: string, ctx: FillContext): DocumentTable | null {
  for (const t of findTags(text)) {
    const tag = classifyTag(t.key, ctx.target, ctx.orgItems);
    if (tag.kind === "cell") return tag.table;
  }
  return null;
}
