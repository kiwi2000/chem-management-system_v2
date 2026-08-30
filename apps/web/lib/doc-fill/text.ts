import { classifyTag, findTags, type DocumentTable, type DocumentTarget } from "@chem/shared";

/**
 * 預かったファイルの中の差込札を、値に置き換える。
 *
 * **知らない札は、書いてあるまま残す。**空にすると、
 * 打ち間違いが「値の無い項目」と見分けられなくなり、
 * 空欄のまま取引先へ出る。残しておけば、出す前に気づける。
 * 相手の様式に元から書いてある波かっこ（「{注}」など）も、これで消えない。
 *
 * **値のほうが空なのは、そのまま空にする。**組織に打たれていない項目や、
 * 見る権限が無くて落ちた表がこれにあたる
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
    let value: string;
    if (tag.kind === "value") {
      value = ctx.values.get(tag.key) ?? "";
    } else if (tag.kind === "cell") {
      // 明細の行の外に置かれた表の札は、埋めようがないので空にする
      value = ctx.row?.table === tag.table ? (ctx.row.cells[tag.column] ?? "") : "";
    } else {
      // 知らない札は触らない。どれが分からなかったかだけ控える
      ctx.unknown.add(t.key);
      continue;
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
