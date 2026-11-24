import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 削除の楽観的ロックの付け忘れ検出（2026-11-24 指示）。
 *
 * - サーバー: DELETE を持つ route.ts は、lib/stamped-delete.ts の runStampedDelete を通す
 *   （1 つのものの中の一部を消すもの〔組成の一部・ひな形のファイル〕は、編集と同じ印の確かめでもよい）
 * - 画面: DELETE を送る部品は、components/use-stamped-delete.ts を使う（印を添え、食い違いを確かめる）
 *
 * 例外は理由を書いてここに載せる。人が中身を直すデータは例外にしない
 */

const WEB_DIR = join(__dirname, "..");
const API_DIR = join(WEB_DIR, "app", "api");

/** 印を要らないと決めた削除の API（理由をコメントで残すこと） */
const SERVER_ALLOWLIST = new Set([
  "admin/access-log/route.ts", // アクセス記録の整理。記録は直すものではない
  "admin/permission-groups/[id]/members/route.ts", // メンバーを外すだけ。中身を直すものではない
  "admin/sessions/[id]/route.ts", // ログイン中の端末を切る
  "admin/users/[id]/mfa/route.ts", // 管理者が 2 要素認証を解除する（本人の認証の手続き）
  "admin/users/[id]/passkeys/route.ts", // 同上（パスキー）
  "auth/mfa/route.ts", // 本人の 2 要素認証
  "auth/passkey/[id]/route.ts", // 本人のパスキー
  "documents/[id]/route.ts", // 作った帳票の控え。中身を直す画面が無い
  "documents/batch/[id]/route.ts", // 同上（まとめて作った帳票）
  "import/[id]/route.ts", // 取り込みの一時領域。頼んだ本人だけが触る
  "preferences/avatar/route.ts", // 本人の写真
  "saved-filters/[id]/route.ts", // 本人が保存した絞り込み
  "settings/app-icon/route.ts", // システム設定の絵を既定に戻すだけ
  // モジュール（SDS 版など）の API の中継。消す処理はモジュールの側で持つ
  "modules/[module]/[[...path]]/route.ts",
]);

/** 画面側: 印を要らないと決めた削除（上の API を呼ぶもの） */
const CLIENT_ALLOWLIST = new Set([
  "app/admin/access-log/page.tsx",
  "app/admin/sessions/page.tsx",
  "app/admin/users/[id]/page.tsx", // 2 要素認証・パスキーの解除だけ
  "components/permission-group-form.tsx", // メンバーを外すだけ
  "components/passkey-section.tsx",
  "components/preferences-form.tsx",
  "components/data-table/saved-filters.tsx",
  "components/app-icon-field.tsx",
  "components/documents-screen.tsx",
  "components/import-job-screen.tsx",
]);

/**
 * 1 つのものの中の一部を消す API（編集と同じ印の確かめ。lib/edit-stamp.ts）と、それを呼ぶ画面
 */
const PART_DELETES = new Set([
  "products/[id]/composition/pre-reaction/route.ts", // 反応前の組成（組成の印）
  "doc-templates/[id]/file/route.ts", // ひな形のファイル（ひな形の印）
]);

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

describe("削除の楽観的ロック（サーバー）", () => {
  const files = walk(API_DIR, (n) => n === "route.ts").filter((f) =>
    /export (async function|const) DELETE\b/.test(readFileSync(f, "utf8")),
  );

  it("削除の API が見つかること（走査の失敗を検出するため）", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s は印を確かめて消している", (file) => {
    const r = rel(API_DIR, file);
    if (SERVER_ALLOWLIST.has(r)) return;
    const src = readFileSync(file, "utf8");
    if (PART_DELETES.has(r)) {
      expect(
        src.includes("parseEditStamp(") || src.includes("staleResponse("),
        `${r} が印を確かめていない`,
      ).toBe(true);
      return;
    }
    expect(src.includes("runStampedDelete("), `${r} が runStampedDelete を通していない`).toBe(true);
  });

  it("例外の一覧に、もう無いファイルが残っていない", () => {
    const all = new Set(walk(API_DIR, (n) => n === "route.ts").map((f) => rel(API_DIR, f)));
    for (const r of [...SERVER_ALLOWLIST, ...PART_DELETES]) {
      expect(all.has(r), `${r} は存在しない`).toBe(true);
    }
  });
});

describe("削除の楽観的ロック（画面）", () => {
  const roots = [join(WEB_DIR, "components"), join(WEB_DIR, "app"), join(WEB_DIR, "modules")];
  const files = roots
    .flatMap((d) => walk(d, (n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx")))
    .filter((f) => /method: "DELETE"/.test(readFileSync(f, "utf8")));

  it.each(files)("%s は印を添えて消している", (file) => {
    const r = rel(WEB_DIR, file);
    if (CLIENT_ALLOWLIST.has(r)) return;
    const src = readFileSync(file, "utf8");
    // 一部を消すもの（反応前の組成・ひな形のファイル）は、編集と同じく本文に stamp を添える
    const ok = src.includes("stamp") && (src.includes("stale_") || src.includes("readStaleEdit("));
    expect(ok, `${r} が印（stamp）を添えて消していない`).toBe(true);
  });

  it("まとめて消す画面は useStampedDelete を使う", () => {
    const loops = roots
      .flatMap((d) => walk(d, (n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx")))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return src.includes("onDeleteSelected=") && !src.includes("useStampedDelete");
      })
      .map((f) => rel(WEB_DIR, f))
      .filter((r) => !CLIENT_ALLOWLIST.has(r));
    expect(loops).toEqual([]);
  });

  it("例外の一覧に、もう無いファイルが残っていない", () => {
    for (const r of CLIENT_ALLOWLIST) {
      expect(statSync(join(WEB_DIR, r)).isFile(), `${r} は存在しない`).toBe(true);
    }
  });
});
