import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE_PREFS,
  formatPageSizePrefs,
  pageSizeListProblem,
  parsePageSizeList,
  parsePageSizePrefs,
} from "./page-size";

const m = {
  pageSizeUnreadable: "読めません",
  pageSizeRange: (min: number, max: number) => `${min}〜${max}`,
  pageSizeTooMany: (n: number) => `${n}件まで`,
};

describe("1ページの件数の好み", () => {
  describe("打ち込みを並びにする", () => {
    it("区切りは何でもよい", () => {
      expect(parsePageSizeList("15,25,50,100")).toEqual([15, 25, 50, 100]);
      expect(parsePageSizeList("15 25 50")).toEqual([15, 25, 50]);
      expect(parsePageSizeList("15、25、50")).toEqual([15, 25, 50]);
    });

    it("小さい順に並べ直し、重なりは1つにする", () => {
      expect(parsePageSizeList("100,15,25,15")).toEqual([15, 25, 100]);
    });

    it("範囲の外は受け取らない", () => {
      expect(parsePageSizeList("0,25")).toBeNull();
      expect(parsePageSizeList("1000")).toBeNull();
    });

    it("1以上なら受け取る", () => {
      expect(parsePageSizeList("1,5,10")).toEqual([1, 5, 10]);
    });

    it("多すぎるものは受け取らない", () => {
      expect(parsePageSizeList("15,16,17,18,19,20,21,22,23")).toBeNull();
    });

    it("数が無ければ受け取らない", () => {
      expect(parsePageSizeList("")).toBeNull();
      expect(parsePageSizeList("あいう")).toBeNull();
    });
  });

  describe("しまう・戻す", () => {
    it("往復しても変わらない", () => {
      const p = { options: [15, 30, 60], defaultSize: 30 };
      expect(parsePageSizePrefs(formatPageSizePrefs(p))).toEqual(p);
    });

    it("何も無ければ既定", () => {
      expect(parsePageSizePrefs(null)).toEqual(DEFAULT_PAGE_SIZE_PREFS);
      expect(parsePageSizePrefs("")).toEqual(DEFAULT_PAGE_SIZE_PREFS);
    });

    it("読めない形は既定に落とす。画面は壊さない", () => {
      expect(parsePageSizePrefs("こわれた")).toEqual(DEFAULT_PAGE_SIZE_PREFS);
      expect(parsePageSizePrefs("0,20|20")).toEqual(DEFAULT_PAGE_SIZE_PREFS);
    });

    it("既定が選択肢に無ければ、いちばん小さいものにする", () => {
      expect(parsePageSizePrefs("15,25,50|999")).toEqual({
        options: [15, 25, 50],
        defaultSize: 15,
      });
    });
  });

  describe("誤りの知らせ", () => {
    it("問題なければ何も言わない", () => {
      expect(pageSizeListProblem("15,25,50", m)).toBeNull();
    });

    it("数が無い・範囲の外・多すぎる、を見分ける", () => {
      expect(pageSizeListProblem("", m)).toBe("読めません");
      expect(pageSizeListProblem("0", m)).toBe("1〜500");
      expect(pageSizeListProblem("15,16,17,18,19,20,21,22,23", m)).toBe("8件まで");
    });
  });
});
