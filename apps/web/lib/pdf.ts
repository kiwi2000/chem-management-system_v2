import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";

/**
 * 帳票の PDF 化。**画面の紙面（HTML）を、サーバー側の Chromium でそのまま PDF にする**（2026-09-16 指示）。
 * テンプレート編集で決めた見た目（余白・背景・枠線・字の大きさ）が画面と同じに出る。
 *
 * ブラウザの探しかた（上から順）:
 *  1. CHEM_BROWSER_PATH … 実行ファイルを直に指す
 *  2. 同梱の Chromium … 導入セットや Docker イメージに入れてある（PLAYWRIGHT_BROWSERS_PATH）
 *  3. CHEM_BROWSER_CHANNEL / Windows の Edge … OS に入っているブラウザ（Windows Server 2022 以降は Edge が最初からある）
 *
 * 実行時に外へは出ない。ページは自分自身（127.0.0.1）から読む
 */

/** 同梱の Chromium は node_modules の中（PLAYWRIGHT_BROWSERS_PATH=0 で入れる）。環境の指定が無ければそこを見る */
function ensureBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const local = join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
  if (existsSync(local)) process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
}

/** 自分自身の住所。サーバーの中から自分のページを開くために使う */
export function internalBaseUrl(): string {
  return (
    process.env.CHEM_INTERNAL_URL?.replace(/\/$/, "") ??
    `http://127.0.0.1:${process.env.PORT ?? "3001"}`
  );
}

let browserPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  ensureBrowsersPath();
  const { chromium } = await import("playwright");
  // Docker では root で動くので sandbox を切る（コンテナの外には出られない）
  const args = process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
  const tries: (() => Promise<Browser>)[] = [];
  const exe = process.env.CHEM_BROWSER_PATH;
  const channel = process.env.CHEM_BROWSER_CHANNEL;
  if (exe) tries.push(() => chromium.launch({ executablePath: exe, args }));
  if (channel) tries.push(() => chromium.launch({ channel, args }));
  tries.push(() => chromium.launch({ args }));
  // Windows Server には Edge が最初から入っている。同梱の Chromium が無くても動くように
  if (process.platform === "win32" && !channel) {
    tries.push(() => chromium.launch({ channel: "msedge", args }));
    tries.push(() => chromium.launch({ channel: "chrome", args }));
  }
  let lastError: unknown = null;
  for (const t of tries) {
    try {
      return await t();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("browser not available");
}

/** ブラウザは 1 つを使い回す（立ち上げに 1〜2 秒かかる）。落ちていたら立て直す */
export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.isConnected()) return b;
    browserPromise = null;
  }
  browserPromise = launch();
  return browserPromise;
}

/** 使い終わったら閉じる（仕事の終わりに呼ぶ。メモリを持ち続けない） */
export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  const b = await p.catch(() => null);
  await b?.close().catch(() => undefined);
}

/**
 * その URL の紙面を A4 の PDF にする。
 * 向きと余白はページの `@page`（print-orientation.tsx）に従う
 */
export async function renderPdf(url: string): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!res || !res.ok()) throw new Error(`print page ${res?.status() ?? "?"}: ${url}`);
    await page.emulateMedia({ media: "print" });
    // フォントの読み込みを待つ（待たないと字が置き換わる）
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await context.close().catch(() => undefined);
  }
}
