import {
  DOCUMENT_FIELDS,
  DOCUMENT_TABLES,
  DOCUMENT_TABLE_DEFS,
  ORG_ITEM_PREFIX,
  RECIPIENT_ITEM_PREFIX,
  isKnownField,
  type DocumentTable,
  type DocumentTarget,
} from "./document";
import type { Locale } from "./i18n/locales";

/**
 * Word / Excel の様式に書く差込札。
 *
 * **文法は1つだけ。**`{鍵}` と書く。覚えることを増やさないために、
 * 繰り返しの開始・終了の印は作らない。
 *
 * - 値 … `{product.code}` `{org.name}` `{to.item.担当者}`
 *   — 画面の様式で使っている差込名と同じ
 * - 表の列 … `{composition.casNumber}` のように `表の名前.列の名前`。
 *   **その札を置いた行が、明細の数だけ下へ増える**（Excel は行、Word は表の行）
 *
 * 知らない札は**空にする**。「？」などを残すと、書いた文字と見分けが付かない
 */

/** 札の切り出し。中に `{}` と改行は入れない（表計算の式と読み違えないため） */
const TAG_RE = /\{([^{}\r\n]{1,120})\}/g;

export type DocTag =
  /** 1つの値 */
  | { kind: "value"; raw: string; key: string }
  /** 表の列。その行が明細の数だけ増える */
  | { kind: "cell"; raw: string; table: DocumentTable; column: string }
  /** 知らない札 */
  | { kind: "unknown"; raw: string; key: string };

/** 文字の中の札を、書いてある順に取り出す。`raw` は `{}` を含んだそのままの形 */
export function findTags(text: string): { raw: string; key: string }[] {
  const out: { raw: string; key: string }[] = [];
  for (const mm of text.matchAll(TAG_RE)) {
    const key = (mm[1] ?? "").trim();
    if (key) out.push({ raw: mm[0], key });
  }
  return out;
}

/** 札が何を指しているかを決める。組織の項目は打たれた名前をそのまま使う */
export function classifyTag(key: string, target: DocumentTarget, orgItems?: string[]): DocTag {
  const raw = `{${key}}`;
  const dot = key.indexOf(".");
  if (dot > 0) {
    const head = key.slice(0, dot);
    const rest = key.slice(dot + 1);
    if ((DOCUMENT_TABLES as readonly string[]).includes(head)) {
      const def = DOCUMENT_TABLE_DEFS.find((t) => t.key === head);
      const known = def?.target === target && def.columns.some((c) => c.key === rest);
      return known
        ? { kind: "cell", raw, table: head as DocumentTable, column: rest }
        : { kind: "unknown", raw, key };
    }
  }
  return isKnownField(target, key, orgItems)
    ? { kind: "value", raw, key }
    : { kind: "unknown", raw, key };
}

/**
 * 様式に書ける札の一覧。**編集画面に出して、写して貼ってもらう。**
 * 打ち間違いを減らすため、覚えて打たせない
 */
export function documentTags(
  target: DocumentTarget,
  locale: Locale,
  orgItems: string[] = [],
): { group: string; items: { tag: string; label: string }[] }[] {
  const en = locale === "en";
  const values = DOCUMENT_FIELDS.filter((f) => f.target === target).map((f) => ({
    tag: `{${f.key}}`,
    label: en ? f.labelEn : f.labelJa,
  }));
  for (const prefix of [ORG_ITEM_PREFIX, RECIPIENT_ITEM_PREFIX]) {
    const head =
      prefix === ORG_ITEM_PREFIX ? (en ? "Sender: " : "差出人の") : en ? "To: " : "宛先の";
    for (const it of orgItems) values.push({ tag: `{${prefix}${it}}`, label: `${head}${it}` });
  }

  const out = [{ group: en ? "Values" : "値", items: values }];
  for (const def of DOCUMENT_TABLE_DEFS) {
    if (def.target !== target) continue;
    out.push({
      group: en ? def.labelEn : def.labelJa,
      items: def.columns.map((c) => ({
        tag: `{${def.key}.${c.key}}`,
        label: en ? c.labelEn : c.labelJa,
      })),
    });
  }
  return out;
}
