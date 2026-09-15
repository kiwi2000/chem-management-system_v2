/**
 * docs/ の Markdown を 1 つの HTML にまとめる（開くファイルを 1 つにするため。2026-09-15 指示）。
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/build-docs-index.ts
 *
 * できるもの: docs/ドキュメント一式.html
 *   - 先頭に目次。導入手順書（HTML）はそのまま別ファイルへのリンク
 *   - docs/*.md と docs/decisions/*.md を、見出し・表・箇条書き・コードだけの簡単な変換で本文に並べる
 *
 * Markdown の変換は外部の部品を使わず、この文書群で使っている書きかた（見出し・段落・箇条書き・
 * 番号付き・表・コードの囲み・強調・コード・リンク）だけを扱う。凝った書きかたには対応しない
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DOCS = join(__dirname, "..", "docs");
const OUT = join(DOCS, "ドキュメント一式.html");

/** 目次の並び。先頭ほど読んでほしいもの。ここに無い .md は「そのほか」に入る */
const GROUPS: { title: string; files: string[] }[] = [
  {
    title: "導入と更新",
    files: [
      "評価機導入記録_WindowsServer_2026-09-14.md",
      "評価機更新記録_WindowsServer_2026-09-15.md",
      "バージョンアップ作業の見積もり.md",
      "運用構成書.md",
    ],
  },
  {
    title: "法規制と判定",
    files: [
      "法規制の内容と該非判定の方法.md",
      "judgment-engine.md",
      "法規制データの作り方.md",
      "毒劇法の閾値構造化.md",
      "LOLIデータの気づき.md",
      "LOLI取り込み記録.md",
      "LOLI取り込み記録_インベントリ.md",
      "LOLI取り込み記録_中国.md",
      "CHRIP取り込みの保留事項.md",
    ],
  },
  {
    title: "仕様",
    files: [
      "機能仕様書.md",
      "詳細機能仕様書.md",
      "画面設計書.md",
      "data-model.md",
      "化学物質管理システム_要件定義書_v0.7.md",
      "システム仕様書_発注用_v1.0.md",
      "公開検証環境_仕様と変更履歴.md",
    ],
  },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 行の中の書きかた（コード・強調・リンク）。コードの中は触らない */
function inline(s: string): string {
  const parts = s.split(/(`[^`]*`)/);
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return `<code>${esc(p.slice(1, -1))}</code>`;
      let t = esc(p);
      t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      t = t.replace(/\[\[([^\]]+)\]\]/g, "<i>$1</i>");
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
        const h = String(href);
        // 相対のリンク先は docs/ からの位置。.md はこの一式の中の節へ
        if (/^https?:/.test(h)) return `<a href="${esc(h)}">${label}</a>`;
        const md = h.match(/([^/]+)\.md$/);
        if (md) return `<a href="#${idOf(md[1] + ".md")}">${label}</a>`;
        return `<a href="${esc(h)}">${label}</a>`;
      });
      return t;
    })
    .join("");
}

function idOf(name: string): string {
  return "doc-" + name.replace(/\.md$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-");
}

/** Markdown → HTML（この文書群の書きかたぶんだけ） */
function render(md: string, prefix: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) buf.push(lines[i++]!);
      i++;
      out.push(`<pre>${esc(buf.join("\n"))}</pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const level = Math.min(6, h[1]!.length + 1); // 文書の # は h2 に（ページの h1 は 1 つ）
      out.push(`<h${level} id="${prefix}-${i}">${inline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]!)) {
      flush();
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]!);
      const tag = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i]!.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m && /\d/.test(m[2]!) === ordered) {
          items.push(m[3]!);
          i++;
        } else if (lines[i]!.match(/^\s{2,}\S/) && items.length > 0) {
          // 折り返しの続き
          items[items.length - 1] += " " + lines[i]!.trim();
          i++;
        } else break;
      }
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!))
        buf.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      out.push(`<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flush();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join("\n");
}

const mdFiles = readdirSync(DOCS).filter((f) => f.endsWith(".md"));
const decisions = readdirSync(join(DOCS, "decisions"))
  .filter((f) => f.endsWith(".md"))
  .sort();
const listed = new Set(GROUPS.flatMap((g) => g.files));
const others = mdFiles.filter((f) => !listed.has(f)).sort();

const sections: string[] = [];
const toc: string[] = [];
const addDoc = (dir: string, file: string) => {
  const md = readFileSync(join(dir, file), "utf8").replace(/^\uFEFF/, "");
  const id = idOf(file);
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? basename(file, ".md");
  toc.push(`<li><a href="#${id}">${esc(title)}</a> <span class="file">${esc(file)}</span></li>`);
  sections.push(
    `<section id="${id}"><h1>${inline(title)}</h1><p class="file">${esc(file)}</p>${render(
      md.replace(/^#\s+.+\n/, ""),
      id,
    )}<p class="top"><a href="#top">目次へ</a></p></section>`,
  );
};

const tocGroups: string[] = [];
tocGroups.push(
  `<h3>手順書</h3><ul><li><a href="社内サーバー導入手順書.html">社内サーバー導入手順書（初期セットアップ・更新の手順）</a> <span class="file">別ファイル。ブラウザで開く</span></li><li>画面の使いかた（ユーザーマニュアル）はアプリの左メニュー「ユーザーマニュアル」で読む</li></ul>`,
);
for (const g of GROUPS) {
  toc.length = 0;
  for (const f of g.files) if (mdFiles.includes(f)) addDoc(DOCS, f);
  tocGroups.push(`<h3>${esc(g.title)}</h3><ul>${toc.join("")}</ul>`);
}
toc.length = 0;
for (const f of decisions) addDoc(join(DOCS, "decisions"), f);
tocGroups.push(`<h3>設計の決定（decisions）</h3><ul>${toc.join("")}</ul>`);
toc.length = 0;
for (const f of others) addDoc(DOCS, f);
if (others.length > 0) tocGroups.push(`<h3>そのほか</h3><ul>${toc.join("")}</ul>`);

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ケミカルコンプライアンス支援システム ドキュメント一式</title>
<style>
  body { font-family: "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif; line-height: 1.7; color: #1f2937; margin: 0; padding: 2rem 1.25rem 4rem; max-width: 60rem; margin-inline: auto; }
  h1 { font-size: 1.5rem; margin-top: 3rem; border-bottom: 2px solid #0f766e; padding-bottom: .25rem; }
  h2 { font-size: 1.2rem; margin-top: 2rem; border-left: 4px solid #0f766e; padding-left: .5rem; }
  h3 { font-size: 1.05rem; margin-top: 1.5rem; }
  h4, h5, h6 { font-size: 1rem; margin-top: 1.2rem; }
  table { border-collapse: collapse; margin: .75rem 0; font-size: .92rem; display: block; overflow-x: auto; }
  th, td { border: 1px solid #cbd5e1; padding: .3rem .55rem; vertical-align: top; text-align: left; }
  th { background: #f1f5f9; }
  pre { background: #0f172a; color: #e2e8f0; padding: .75rem 1rem; overflow-x: auto; font-size: .85rem; border-radius: .25rem; }
  code { background: #f1f5f9; padding: .05rem .3rem; border-radius: .2rem; font-size: .9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #94a3b8; margin: .75rem 0; padding: .25rem .75rem; color: #475569; background: #f8fafc; }
  .file { color: #64748b; font-size: .8rem; margin-left: .5rem; }
  .toc { background: #f8fafc; border: 1px solid #e2e8f0; padding: 1rem 1.5rem; }
  .toc h2 { margin-top: 0; border: 0; padding: 0; font-size: 1.3rem; }
  .toc ul { margin: .25rem 0 .75rem; padding-left: 1.25rem; }
  .top { text-align: right; font-size: .85rem; }
  .meta { color: #64748b; font-size: .85rem; }
</style>
</head>
<body>
<a id="top"></a>
<div class="toc">
<h2>ケミカルコンプライアンス支援システム ドキュメント一式</h2>
<p class="meta">作成 ${new Date().toISOString().slice(0, 10)}（\`scripts/build-docs-index.ts\` が docs/ の Markdown から作る。直すときは元の .md を直して作り直す）</p>
${tocGroups.join("\n")}
</div>
${sections.join("\n")}
</body>
</html>
`;
writeFileSync(OUT, html, "utf8");
console.warn(`書きました: ${OUT}（${mdFiles.length + decisions.length} 文書）`);
