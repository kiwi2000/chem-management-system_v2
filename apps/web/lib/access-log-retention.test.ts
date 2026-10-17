import { describe, expect, it, vi } from "vitest";
// DB を使う関数は読み込むだけで Prisma を起こすので、ここでは形の検査だけを確かめる
vi.mock("@/lib/db", () => ({ prisma: {} }));
const { ARCHIVE_FILE_PATTERN, archiveFileName, archiveLine, tsvCell } =
  await import("./access-log-retention");

describe("アクセス記録の書き出し", () => {
  it("ファイル名は期間と走った時刻で、決まりの形に合う", () => {
    const name = archiveFileName(
      new Date("2026-01-05T10:00:00Z"),
      new Date("2026-03-31T23:59:59Z"),
      new Date("2026-10-17T03:04:05Z"),
    );
    expect(name).toBe("access-log_2026-01-05_2026-03-31_20261017T030405.tsv");
    expect(ARCHIVE_FILE_PATTERN.test(name)).toBe(true);
    expect(ARCHIVE_FILE_PATTERN.test("../etc/passwd")).toBe(false);
  });
  it("マスの中のタブ・改行は空白にし、無い値は空にする", () => {
    expect(tsvCell("a\tb\nc")).toBe("a b c");
    expect(tsvCell(null)).toBe("");
    expect(tsvCell({ x: 1 })).toBe('{"x":1}');
  });
  it("1 行は画面と同じ項目で、利用者の名前はこの時点で引いた表から書く", () => {
    const line = archiveLine(
      {
        at: new Date("2026-02-01T00:00:00Z"),
        action: "login",
        actorId: "u1",
        entityId: null,
        diff: { ip: "203.0.113.5", userAgent: "UA" },
      },
      new Map([["u1", { email: "a@example.com", displayName: "山田" }]]),
    );
    expect(line.split("\t")).toEqual([
      "2026-02-01T00:00:00.000Z",
      "login",
      "a@example.com",
      "山田",
      "",
      "203.0.113.5",
      "",
      "",
      "",
      "UA",
      '{"ip":"203.0.113.5","userAgent":"UA"}',
    ]);
  });
});
