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
  "auth/logout/route.ts", // 未ログインでも安全に空振りする
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

  it("allowlist に実在しないパスが残っていない", () => {
    const all = new Set(files.map((f) => relative(API_DIR, f).split(sep).join("/")));
    for (const rel of ALLOWLIST) expect(all.has(rel), `${rel} は存在しない`).toBe(true);
  });
});
