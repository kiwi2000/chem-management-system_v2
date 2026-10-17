// HTML を A4 の PDF にする（Playwright の Chromium。Mermaid の図は描き終わるのを待つ）。2026-10-17
// 使い方: node tools/html-to-pdf.mjs <入力.html> <出力.pdf> ["<ヘッダーの文字>"]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [input, output, headerText = ""] = process.argv.slice(2);
let html = readFileSync(input, "utf8");
// Mermaid を足す（まだ無ければ）。file:// の頁から外部の script は読めない（ORB で止まる）ので、
// tools/vendor/mermaid.min.js を file:// で読む（無ければ取る: curl -L -o tools/vendor/mermaid.min.js https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js）（中身を埋め込むと、
// 中の "</script>" で HTML が切れる）
if (!html.includes("__mermaidDone")) {
  const vendor = new URL("./vendor/mermaid.min.js", import.meta.url).href;
  html = html.replace(
    "</body>",
    `<script src="${vendor}"></script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { useMaxWidth: true, htmlLabels: true }, securityLevel: "loose" });
  window.__mermaidDone = mermaid.run({ querySelector: "pre.mermaid" }).then(() => true).catch((e) => { console.error("mermaid", e); return false; });
</script></body>`,
  );
}
// 数式（$$…$$ / $…$）があれば MathJax（tools/vendor/tex-svg.js。無ければ取る:
// curl -L -o tools/vendor/tex-svg.js https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js）で描く
if (html.includes('class="math"') && !html.includes("__mathDone")) {
  const mj = new URL("./vendor/tex-svg.js", import.meta.url).href;
  html = html.replace(
    "</body>",
    () => `<script>
  window.MathJax = { tex: { inlineMath: [["$", "$"]], displayMath: [["$$", "$$"]] }, svg: { fontCache: "none" },
    startup: { typeset: false } };
</script>
<script src="${mj}"></script>
<script>
  window.__mathDone = (window.MathJax.startup?.promise ?? Promise.resolve())
    .then(() => MathJax.typesetPromise()).then(() => true).catch((e) => { console.error("mathjax", e); return false; });
</script></body>`,
  );
}
const tmp = input.replace(/\.html$/, ".render.html");
writeFileSync(tmp, html);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.goto(pathToFileURL(tmp).href, { waitUntil: "load", timeout: 120000 });
await page.evaluate(() => window.__mermaidDone ?? true);
await page.evaluate(() => window.__mathDone ?? true);
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: output,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:7.5pt;color:#5a6270;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:'Noto Sans JP','Yu Gothic',sans-serif"><span>${headerText}</span><span></span></div>`,
  footerTemplate: `<div style="font-size:7.5pt;color:#5a6270;width:100%;text-align:center;font-family:'Noto Sans JP','Yu Gothic',sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
});
await browser.close();
console.log("wrote", output);
