import { beforeEach, describe, expect, it, vi } from "vitest";

// DB と権限の確認は差し替え、数えかただけを試す
const findLogs = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: { findMany: (...a: unknown[]) => findLogs(...a) },
    user: {
      findMany: async () => [{ id: "u1", displayName: "山田", email: "yamada@example.test" }],
    },
  },
}));
vi.mock("@/lib/authz", () => ({ requireAdmin: async () => ({ user: { id: "admin" } }) }));

const { GET } = await import("./route");
type Stats = import("@/lib/types").AccessStatsDto;

const log = (action: string, at: string, diff: Record<string, unknown> = {}) => ({
  at: new Date(at),
  action,
  actorId: "u1",
  diff,
});

async function stats(logs: ReturnType<typeof log>[]): Promise<Stats> {
  findLogs.mockResolvedValue(logs);
  const res = await GET(new Request("http://localhost/api/admin/access-log/stats?days=30"));
  return (await res.json()) as Stats;
}

describe("アクセスの分析の数えかた", () => {
  beforeEach(() => findLogs.mockReset());

  it("「組成を見た」に数えるのは view だけ。ログアウトや設定・出力・取り込みは数えない（2026-11-12）", async () => {
    const s = await stats([
      log("login", "2026-11-12T01:00:00Z"),
      log("view", "2026-11-12T01:10:00Z", { lineCount: 4 }),
      log("view", "2026-11-12T01:20:00Z", { lineCount: 6 }),
      // 読む種類を絞っているので本来は来ないが、来ても「見た」に入れない
      log("logout", "2026-11-12T02:00:00Z"),
      log("mfa_enable", "2026-11-12T02:00:00Z"),
      log("passkey_add", "2026-11-12T02:00:00Z"),
      log("export", "2026-11-12T02:00:00Z"),
      log("import", "2026-11-12T02:00:00Z"),
    ]);
    expect(s.totals).toMatchObject({ login: 1, failed: 0, view: 2 });
    expect(s.topViewers).toEqual([{ name: "山田", count: 2, lines: 10 }]);
    expect(s.byHour.reduce((n, h) => n + h.view, 0)).toBe(2);
    // DB から読む種類も、数えるものだけ
    expect(findLogs.mock.calls[0]![0].where.action).toEqual({
      in: ["login", "login_failed", "view"],
    });
  });

  it("時間帯と夜間は日本の時刻で数える（サーバーの時計の地域に左右されない）", async () => {
    // 世界標準時 13:30 ＝ 日本の 22:30（夜間）。世界標準時 22:30 ＝ 日本の 7:30（朝。夜間ではない）
    const s = await stats([
      log("login", "2026-11-12T13:30:00Z"),
      log("login", "2026-11-12T22:30:00Z"),
    ]);
    expect(s.byHour[22]!.login).toBe(1);
    expect(s.byHour[7]!.login).toBe(1);
    expect(s.risks.find((r) => r.kind === "nightLogin")?.count).toBe(1);
  });

  it("「1 日に多くの組成」は日本の日で区切る", async () => {
    // 日本の 11/13 の 0:10〜8:50（世界標準時では 11/12 と 11/13 にまたがる）に 30 件
    const logs = Array.from({ length: 30 }, (_, i) =>
      log("view", new Date(Date.UTC(2026, 10, 12, 15, 10) + i * 18 * 60_000).toISOString()),
    );
    const s = await stats(logs);
    const bulk = s.risks.find((r) => r.kind === "bulkView");
    expect(bulk?.count).toBe(30);
    expect(bulk?.samples[0]).toContain("2026-11-13");
  });
});
