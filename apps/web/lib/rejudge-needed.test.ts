import { describe, expect, it } from "vitest";
import { isRejudgeNeeded } from "./rejudge-needed";

/**
 * 左メニューの下に「要再計算」を出すかどうか。
 * 出し忘れると古い判定が残り続け、出し過ぎると印が無視されるようになる
 */
describe("isRejudgeNeeded", () => {
  const t0 = new Date("2026-09-04T10:00:00Z");
  const t1 = new Date("2026-09-04T11:00:00Z");

  it("データがあとから変わっていれば要る", () => {
    expect(
      isRejudgeNeeded({ currentVersionId: "v1", changedAt: t1, lastFull: t0, missing: false }),
    ).toBe(true);
  });

  it("判定し直したあとに変わっていなければ要らない", () => {
    expect(
      isRejudgeNeeded({ currentVersionId: "v1", changedAt: t0, lastFull: t1, missing: false }),
    ).toBe(false);
  });

  it("切り替えた版の判定が無い製品があれば要る（判定は版ごとに持つ）", () => {
    expect(
      isRejudgeNeeded({ currentVersionId: "v2", changedAt: t0, lastFull: null, missing: true }),
    ).toBe(true);
  });

  it("切り替えた版の判定がそろっていて、そのあと変わっていなければ要らない", () => {
    expect(
      isRejudgeNeeded({ currentVersionId: "v2", changedAt: t0, lastFull: t1, missing: false }),
    ).toBe(false);
  });

  it("判定し直した記録が無ければ出さない（新しい環境で騒がない）", () => {
    expect(
      isRejudgeNeeded({ currentVersionId: "v1", changedAt: t1, lastFull: null, missing: false }),
    ).toBe(false);
  });

  it("バージョンが無ければ出さない", () => {
    expect(
      isRejudgeNeeded({ currentVersionId: null, changedAt: t1, lastFull: t0, missing: true }),
    ).toBe(false);
  });
});
