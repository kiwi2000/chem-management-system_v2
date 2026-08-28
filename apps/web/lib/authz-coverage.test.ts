import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 認可の呼び忘れ検出。
 * すべての API Route Handler は lib/authz.ts の require* を必ず通す決まりなので、
 * 1本でも書き忘れていればここで落ちる。目視では気づけない類のミスを機械で止めるためのテスト。
 */

const API_DIR = join(__dirname, "..", "app", "api");

/** 認証を通さないことが意図的なルート（理由をコメントで残すこと） */
const ALLOWLIST = new Set([
  "auth/login/route.ts", // ログイン自体。認証前に呼ばれる
  "auth/passkey/login/route.ts", // ログイン自体。認証前に呼ばれる
  // 自動ログアウトの残り時間を見るだけ。最終操作時刻に触らないため requireUser を通さない
  // （通すと、確かめる行為そのものが延命になってしまう）
  "auth/session-status/route.ts",
  "auth/logout/route.ts", // 未ログインでも安全に空振りする
  // 直前のログインが切れた理由を1語返すだけ。未ログインの人が読むためのもの
  "auth/session-end/route.ts",
  "health/route.ts", // 監視・デプロイ確認用。業務データを返さない
  // 表示言語とテーマの切替。ログイン画面でも使うため認証不要。
  // 副作用は Cookie と、ログイン中なら自分の設定だけで、業務データには触れない
  "preferences/route.ts",
]);

const GUARDS = ["requireUser", "requirePermission", "requireAnyPermission", "requireAdmin"];

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

describe("API ルートの認可", () => {
  const files = findRouteFiles(API_DIR);

  it("route.ts が見つかること（走査の失敗を検出するため）", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s は認可を通している", (file) => {
    const rel = relative(API_DIR, file).split(sep).join("/");
    if (ALLOWLIST.has(rel)) return;

    const src = readFileSync(file, "utf8");
    const guarded = GUARDS.some((g) => src.includes(`${g}(`));
    expect(guarded, `${rel} が ${GUARDS.join(" / ")} のいずれも呼んでいない`).toBe(true);
  });

  /*
    済ませていない用事（初期パスワードの変更・2要素認証の登録）がある人でも
    通してよいルート。**増えると、用事を済ませずに使い回せる道ができる**ので、
    ここで数を固定する。
    足したいときは、なぜその用事の最中に要るのかを書いたうえでここに載せる
  */
  it("用事を飛ばして通せるルートが増えていない", () => {
    const opened = files
      .filter((f) => readFileSync(f, "utf8").includes("allowPending"))
      .map((f) => relative(API_DIR, f).split(sep).join("/"))
      .sort();
    expect(opened).toEqual([
      "auth/change-password/route.ts", // 用事そのもの
      "auth/heartbeat/route.ts", // 放置での自動ログアウト
      "auth/mfa/qr/route.ts", // 用事そのもの（QRコードを絵にする）
      "auth/mfa/route.ts", // 用事そのもの
      "auth/passkey/[id]/route.ts", // 用事そのもの（登録し直しの途中で外す）
      "auth/passkey/register/route.ts", // 用事そのもの（パスキーの登録）
      "auth/passkey/route.ts", // 登録済みの端末を出すだけ
      "me/route.ts", // 画面の枠（利用者名・ログアウト）
      "password-policy/route.ts", // パスワードの決まりを見せるだけ
    ]);
  });

  it("allowlist に実在しないパスが残っていない", () => {
    const all = new Set(files.map((f) => relative(API_DIR, f).split(sep).join("/")));
    for (const rel of ALLOWLIST) expect(all.has(rel), `${rel} は存在しない`).toBe(true);
  });
});
