import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 楽観的ロックの付け忘れ検出（2026-10-18 指示「今後編集機能を作るときは楽観的ロックを書く」）。
 *
 * - サーバー: PUT / PATCH を持つ route.ts は lib/edit-stamp.ts の印を確かめる
 * - 画面: PUT / PATCH で保存する部品は、本文に `stamp` を添えて送り、409 の食い違い（stale_edit）を受ける
 *
 * 目視では気づけない類のミスを機械で止めるためのテスト。例外は理由を書いてここに載せる
 */

const WEB_DIR = join(__dirname, "..");
const API_DIR = join(WEB_DIR, "app", "api");

/** 印を要らないと決めた更新の API（理由をコメントで残すこと） */
const SERVER_ALLOWLIST = new Set([
  "preferences/route.ts", // 本人の個人設定。本人しか変えない
  "preferences/avatar/route.ts", // 同上
  "auth/mfa/route.ts", // 本人の 2 要素認証。本人しか変えない
  "auth/passkey/login/route.ts", // ログインそのもの（パスキーの署名回数の更新）
  "auth/passkey/register/route.ts", // 本人のパスキーの登録
  // 取り込みの一時領域の「反映する」の印。取り込みを頼んだ本人が、反映前にだけ触る
  "import/[id]/rows/route.ts",
  // モジュール（SDS 版など）の API の中継。いまモジュールに更新の API は無い。
  // 足すときはモジュールの側で lib/edit-stamp.ts の印を確かめ、ここの検出も広げる
  "modules/[module]/[[...path]]/route.ts",
]);

/** 画面側: 印を要らないと決めた保存（理由をコメントで残すこと） */
const CLIENT_ALLOWLIST = new Set([
  "components/preferences-form.tsx", // 個人設定
  "components/language-switcher.tsx", // 個人設定（言語）
  "components/page-size-section.tsx", // 個人設定（1 ページの件数）
  "components/mfa-section.tsx", // 本人の 2 要素認証
  "components/passkey-section.tsx", // 本人のパスキー
  "app/login/page.tsx", // ログイン画面の言語・テーマ
  "components/import-job-screen.tsx", // 取り込みの一時領域（上の import/[id]/rows と同じ理由）
  "components/prtr-import-dialog.tsx", // 取り込み（PUT は使っていない。動詞を変数で持つだけ）
]);

/**
 * 1 つの route.ts が複数の API を中継しているもの（`export const PUT = handle`）。
 * 印の確認は中継先にあるので、そちらを見る
 */
const SERVER_DELEGATES: Record<string, string> = {
  "ghs-data/[[...path]]/route.ts": "lib/ghs/data-api.ts",
};

function walk(dir: string, pick: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      out.push(...walk(full, pick));
    } else if (pick(name)) out.push(full);
  }
  return out;
}

const rel = (base: string, file: string) => relative(base, file).split(sep).join("/");

describe("楽観的ロック（サーバー）", () => {
  const files = walk(API_DIR, (n) => n === "route.ts").filter((f) =>
    /export (async function|const) (PUT|PATCH)\b/.test(readFileSync(f, "utf8")),
  );

  it("更新の API が見つかること（走査の失敗を検出するため）", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s は印を確かめている", (file) => {
    const r = rel(API_DIR, file);
    if (SERVER_ALLOWLIST.has(r)) return;
    const delegate = SERVER_DELEGATES[r];
    const src = readFileSync(delegate ? join(WEB_DIR, delegate) : file, "utf8");
    const usesStamp =
      src.includes("parseEditStamp(") ||
      src.includes("staleResponse(") ||
      src.includes("stampWhere(");
    expect(usesStamp, `${r} が lib/edit-stamp.ts の印を確かめていない`).toBe(true);
  });

  it("例外の一覧に、もう無いファイルが残っていない", () => {
    const all = new Set(walk(API_DIR, (n) => n === "route.ts").map((f) => rel(API_DIR, f)));
    for (const r of SERVER_ALLOWLIST) expect(all.has(r), `${r} は存在しない`).toBe(true);
  });
});

describe("楽観的ロック（画面）", () => {
  const roots = [join(WEB_DIR, "components"), join(WEB_DIR, "app")];
  const files = roots
    .flatMap((d) => walk(d, (n) => n.endsWith(".tsx")))
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return /"(PUT|PATCH)"/.test(src) && src.includes("fetch(");
    });

  it("保存する画面が見つかること", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s は印を送り、食い違いを受けている", (file) => {
    const r = rel(WEB_DIR, file);
    if (CLIENT_ALLOWLIST.has(r)) return;
    const src = readFileSync(file, "utf8");
    expect(src.includes("stamp"), `${r} が印（stamp）を送っていない`).toBe(true);
    expect(
      src.includes("readStaleEdit(") || src.includes("stale_edit"),
      `${r} が食い違い（stale_edit）を受けていない`,
    ).toBe(true);
  });

  it("例外の一覧に、もう無いファイルが残っていない", () => {
    const all = new Set(
      roots.flatMap((d) => walk(d, (n) => n.endsWith(".tsx"))).map((f) => rel(WEB_DIR, f)),
    );
    for (const r of CLIENT_ALLOWLIST) expect(all.has(r), `${r} は存在しない`).toBe(true);
  });
});
