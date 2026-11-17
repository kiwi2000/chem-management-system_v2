import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectIfPending, redirectIfUnauthorized } from "@/lib/auth-redirect";
import { EXPIRED_LOGIN_URL, PENDING_HEADER } from "@/lib/routes";

const replace = vi.fn();
function at(pathname: string) {
  vi.stubGlobal("window", { location: { pathname, replace } });
}
function refused(status: number, pending?: string) {
  return new Response("{}", { status, headers: pending ? { [PENDING_HEADER]: pending } : {} });
}

/**
 * 先に済ませる用事（パスワードの変更・2要素認証の登録）が残っている人への断りを受けたら、用事の画面へ送る。
 * 前は断りの文を出すだけで、一覧が「先に済ませることがあります」とだけ出て行き先が分からなかった（2026-11-17、本番で起きた）
 */
describe("読み込みの断りを受けたときの行き先", () => {
  beforeEach(() => replace.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it("ログインが切れている（401）→ ログイン画面へ", () => {
    at("/substances");
    expect(redirectIfUnauthorized(refused(401))).toBe(true);
    expect(replace).toHaveBeenCalledWith(EXPIRED_LOGIN_URL);
  });

  it("用事が残っている（403＋行き先）→ 用事の画面へ", () => {
    at("/substances");
    expect(redirectIfUnauthorized(refused(403, "/mfa-setup"))).toBe(true);
    expect(replace).toHaveBeenCalledWith("/mfa-setup");
  });

  it("もう用事の画面にいるときは送らない（送ると、その画面を読み込み直し続ける）", () => {
    at("/mfa-setup");
    expect(redirectIfPending(refused(403, "/mfa-setup"))).toBe(false);
    at("/change-password");
    expect(redirectIfUnauthorized(refused(403, "/change-password"))).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("ふつうの「権限がありません」（403・行き先なし）では送らない", () => {
    at("/admin/users");
    expect(redirectIfUnauthorized(refused(403))).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("行き先は、このシステムの中のアドレスだけ", () => {
    at("/substances");
    expect(redirectIfPending(refused(403, "//evil.example/x"))).toBe(false);
    expect(redirectIfPending(refused(403, "https://evil.example/x"))).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});

/**
 * layout（と、その中で動く外枠 AppShell）は、画面の中からの読み込みのときに `redirect()` を投げてはいけない。
 * 投げた状態で画面の読み直し（`router.refresh()`）が走ると、送り先を休みなく取りに行く
 * （2026-11-17、本番で 37 秒に約 90 回。開発の環境では 2.5 秒に 1,405 回）
 */
describe("layout で redirect() を投げない", () => {
  const web = join(__dirname, "..");
  const calls = (file: string) =>
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      // 注釈の中の「`redirect()`」という言葉は数えない
      .filter((l) => /\bredirect\(/.test(l) && !l.includes("`redirect("));

  it("外枠（AppShell）の redirect() は、画面ごとの読み込みと確かめた 1 行だけ", () => {
    const lines = calls(join(web, "components", "app-shell.tsx"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"sec-fetch-dest"');
    expect(lines[0]).toContain('"document"');
  });

  it("app の下の layout.tsx は redirect() を使わない", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "layout.tsx" && calls(p).length > 0) found.push(p);
      }
    };
    walk(join(web, "app"));
    expect(found).toEqual([]);
  });
});
