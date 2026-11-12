import { describe, expect, it } from "vitest";
import {
  dateTimeTextInJapan,
  dayInJapan,
  hourInJapan,
  stampInJapan,
  todayInJapan,
} from "./judgement-date";

/**
 * 「今日」と、時刻から作る日付は日本の日付で決める（2026-11-12）。
 * 世界標準時の日付（toISOString の先頭 10 文字）を使うと、日本の 0〜9 時が前の日になる
 */
describe("日本の日付", () => {
  it("世界標準時の 15 時は、日本では翌日の 0 時", () => {
    expect(dayInJapan(new Date("2026-11-12T14:59:59Z"))).toBe("2026-11-12");
    expect(dayInJapan(new Date("2026-11-12T15:00:00Z"))).toBe("2026-11-13");
    // 日本の朝 8 時（世界標準時では前の日の 23 時）
    expect(dayInJapan(new Date("2026-11-12T23:00:00Z"))).toBe("2026-11-13");
  });

  it("年・月をまたぐときも日本の日付", () => {
    expect(dayInJapan(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(dayInJapan(new Date("2027-02-28T15:30:00Z"))).toBe("2027-03-01");
  });

  it("時とファイル名の日時も日本の時刻（サーバーの時計の地域に左右されない）", () => {
    expect(hourInJapan(new Date("2026-11-12T13:30:00Z"))).toBe(22);
    expect(hourInJapan(new Date("2026-11-12T15:00:00Z"))).toBe(0);
    expect(hourInJapan(new Date("2026-11-12T20:59:59Z"))).toBe(5);
    expect(stampInJapan(new Date("2026-12-31T15:04:05Z"))).toBe("20270101T000405");
  });

  it("帳票に印字する日時も日本の時刻", () => {
    // 環境によって空白の種類が違うので、空白は 1 つに揃えて比べる
    const text = (locale: string) =>
      dateTimeTextInJapan(new Date("2026-11-12T15:04:05Z"), locale).replace(/\s+/g, " ");
    expect(text("ja")).toBe("2026/11/13 0:04:05");
    expect(text("en")).toBe("11/13/2026, 12:04:05 AM");
  });

  it("今日は、渡した時刻の日本の日付", () => {
    expect(todayInJapan(new Date("2026-11-12T15:30:00Z"))).toBe("2026-11-13");
    expect(todayInJapan()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
