/**
 * 帳票のファイル名（システム設定「帳票のファイル名」。2026-09-16 指示）。
 *
 * 差込みの書きかたは `{テンプレート}` のように波括弧。日付は `{日付:YYYY-MM-DD}` のように形を添えられる。
 * 英語の名前（`{template}` など）も同じ意味で使える。
 * ファイル名に使えない文字は `_` に置き換え、長すぎるものは切る。
 */

export interface DocFileNameVars {
  /** テンプレートのコード */
  template: string;
  /** 製品・物質のコード */
  code: string;
  /** 製品・物質の名称 */
  name: string;
  /** 法規制バージョンのコード */
  version: string;
  /** まとめて作ったときの通番（1 から） */
  seq: number;
  /** 作った時刻 */
  at: Date;
}

/** 使える差込み。左が日本語、右が英語の名前 */
export const DOC_FILE_NAME_KEYS: { ja: string; en: string; key: keyof DocFileNameVars }[] = [
  { ja: "テンプレート", en: "template", key: "template" },
  { ja: "対象コード", en: "code", key: "code" },
  { ja: "対象名", en: "name", key: "name" },
  { ja: "日付", en: "date", key: "at" },
  { ja: "時刻", en: "time", key: "at" },
  { ja: "バージョン", en: "version", key: "version" },
  { ja: "通番", en: "seq", key: "seq" },
];

export const DEFAULT_DOC_FILE_NAME_PATTERN = "{テンプレート}_{対象コード}_{日付}";

/** 帳票を置くフォルダーの既定。アプリのフォルダーからの相対の道筋 */
export const DEFAULT_DOC_OUTPUT_DIR = "data/documents";

const PLACEHOLDER = /\{([^{}:]+)(?::([^{}]+))?\}/g;

/** 日付の形。YYYY・YY・MM・DD・HH・mm・ss を置き換える（それ以外の文字はそのまま） */
export function formatDate(at: Date, fmt: string): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return fmt
    .replace(/YYYY/g, String(at.getFullYear()))
    .replace(/YY/g, p(at.getFullYear() % 100))
    .replace(/MM/g, p(at.getMonth() + 1))
    .replace(/DD/g, p(at.getDate()))
    .replace(/HH/g, p(at.getHours()))
    .replace(/mm/g, p(at.getMinutes()))
    .replace(/ss/g, p(at.getSeconds()));
}

function canonical(name: string): string | null {
  const t = name.trim();
  const hit = DOC_FILE_NAME_KEYS.find((k) => k.ja === t || k.en === t);
  return hit ? hit.en : null;
}

/**
 * 書式の検査。知らない差込みがあれば、その名前を返す（無ければ空）。
 * 画面の保存時に呼び、間違った書式を設定させない
 */
export function unknownFileNamePlaceholders(pattern: string): string[] {
  const bad: string[] = [];
  for (const m of pattern.matchAll(PLACEHOLDER)) {
    if (canonical(m[1]!) === null) bad.push(m[1]!.trim());
  }
  return bad;
}

/** ファイル名に使えない文字を `_` に。前後の空白と点も落とす（Windows では末尾の点が消えるため） */
export function sanitizeFileName(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
}

const MAX_BASE = 150;

/**
 * 書式から、拡張子を除いたファイル名を作る。
 * 空になったら（差込みが全部空など）対象コードで補う
 */
export function buildDocFileName(pattern: string, v: DocFileNameVars): string {
  const out = pattern.replace(PLACEHOLDER, (_m, rawName: string, fmt?: string) => {
    switch (canonical(rawName)) {
      case "template":
        return v.template;
      case "code":
        return v.code;
      case "name":
        return v.name;
      case "date":
        return formatDate(v.at, fmt?.trim() || "YYYYMMDD");
      case "time":
        return formatDate(v.at, fmt?.trim() || "HHmmss");
      case "version":
        return v.version;
      case "seq":
        return String(v.seq).padStart(Math.max(1, Number(fmt) || 1), "0");
      default:
        return "";
    }
  });
  const base = sanitizeFileName(out).slice(0, MAX_BASE);
  return base || sanitizeFileName(v.code) || "document";
}
