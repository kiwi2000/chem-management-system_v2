import { describe, expect, it } from "vitest";
import { applyExtract, compileExtract, EXTRACT_MAX } from "./extract-rule";

/**
 * 実データ（LOLI）の形をそのまま試験にしてある。
 * 資料が増えても、ここに1件足せば読み方が合っているか確かめられる。
 */
describe("applyExtract", () => {
  it("化審法の番号を取り出す", () => {
    const rule = { pattern: "\\((\\d+)\\)-(\\d+)", format: "($1)-$2" };
    expect(applyExtract(rule, "(5)-3714").values).toEqual(["(5)-3714"]);
  });

  it("番号の無い行（-）は取れない", () => {
    const rule = { pattern: "\\((\\d+)\\)-(\\d+)", format: "($1)-$2" };
    const data =
      "- (treated as Existing Chemical Substances, etc.); - (listed on Japanese Pharmacopoeia)";
    expect(applyExtract(rule, data).values).toEqual([]);
  });

  it("1行に複数のEC番号があれば、その数だけ取れる", () => {
    const rule = { pattern: "(\\d{3}-\\d{3}-\\d)", format: "$1" };
    const data =
      '"215-637-1" As 1,2,3-Propanetriol, acetate [1335-58-6];  "247-704-6" As Glyceryl monoacetate [26446-35-5]';
    expect(applyExtract(rule, data).values).toEqual(["215-637-1", "247-704-6"]);
  });

  it("同じ値が2回出ても1つにまとめる", () => {
    const rule = { pattern: "(KE-\\d+)", format: "$1" };
    expect(applyExtract(rule, "KE-05780 ... KE-05780").values).toEqual(["KE-05780"]);
  });

  it("TSCA は ACTIVE / INACTIVE をそのまま出す", () => {
    const rule = { pattern: "\\((ACTIVE|INACTIVE)\\)", format: "$1" };
    expect(applyExtract(rule, "Present (ACTIVE)").values).toEqual(["ACTIVE"]);
    expect(applyExtract(rule, "Present [T] (INACTIVE)").values).toEqual(["INACTIVE"]);
  });

  it("取得条件が空なら、書式をそのまま1つ返す（載っているかどうかだけの名簿）", () => {
    expect(applyExtract({ pattern: null, format: "該当" }, "Present").values).toEqual(["該当"]);
    expect(applyExtract({ pattern: "  ", format: "該当" }, "Present").values).toEqual(["該当"]);
  });

  it("$0 は一致した全体", () => {
    expect(
      applyExtract({ pattern: "HSR\\d+", format: "$0" }, "HSNO Approval: HSR003056").values,
    ).toEqual(["HSR003056"]);
  });

  it("一致しなければ空。**壊れているのとは区別する**", () => {
    const r = applyExtract({ pattern: "HSR\\d+", format: "$0" }, "no approval");
    expect(r.values).toEqual([]);
    expect(r.error).toBeNull();
  });

  it("正規表現が壊れていれば、そう言う", () => {
    const r = applyExtract({ pattern: "(", format: "$0" }, "なんでも");
    expect(r.values).toEqual([]);
    expect(r.error).not.toBeNull();
  });

  it("何にでも当たる書き方でも、上限で止まる", () => {
    const r = applyExtract({ pattern: "\\d", format: "$0-$0" }, "1234567890".repeat(10));
    expect(r.values.length).toBeLessThanOrEqual(EXTRACT_MAX);
  });

  it("空になる書式は取らない（見出しだけの行を作らない）", () => {
    expect(applyExtract({ pattern: "(x)?y", format: "$1" }, "y").values).toEqual([]);
  });
});

describe("compileExtract", () => {
  it("使える書き方なら error は null", () => {
    expect(compileExtract("\\d+").error).toBeNull();
  });
  it("使えない書き方なら理由を返す", () => {
    expect(compileExtract("[").error).not.toBeNull();
  });
});
