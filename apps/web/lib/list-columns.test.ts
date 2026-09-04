import { describe, expect, it } from "vitest";
import { PRODUCT_COLUMNS, STATUTORY_SUBSTANCE_COLUMNS } from "./list-columns";
import { buildWhere } from "./table-query";

/**
 * 製品一覧の「法規制」「要確認」の絞り込み。
 *
 * この2つは**行の有無と行の中身を組み合わせて見る**ので、共通の組み立てに乗らない。
 * 意味を取り違えると、
 *
 *   「該当なし」が「まだ判定していない」ものまで拾う
 *   「確認は済んでいる」が、確認の残っている製品まで拾う
 *
 * という、静かに間違った一覧になる。ここで固定しておく。
 */
const hit = { judgements: { some: { verdict: "APPLICABLE" } } };

const where = (key: string, values: string[]) =>
  buildWhere(PRODUCT_COLUMNS, { [key]: { kind: "enum", values } });

describe("法規制の絞り込み", () => {
  it("該当あり", () => {
    expect(where("judgement", ["hit"])).toEqual({ AND: [hit] });
  });

  it("該当なしは「該当の行が1つも無い」。判定していないものは含めない", () => {
    expect(where("judgement", ["none"])).toEqual({
      AND: [{ AND: [{ judgements: { some: {} } }, { NOT: hit }] }],
    });
  });

  it("未判定は「行そのものが無い」", () => {
    expect(where("judgement", ["unjudged"])).toEqual({
      AND: [{ judgements: { none: {} } }],
    });
  });

  it("複数選んだら、そのどれか", () => {
    const w = where("judgement", ["hit", "unjudged"]) as { AND: { OR: unknown[] }[] };
    expect(w.AND[0]?.OR).toHaveLength(2);
  });

  it("選択が空なら絞らない", () => {
    expect(where("judgement", [])).toEqual({});
  });

  it("知らない値は無視する", () => {
    expect(where("judgement", ["なにか"])).toEqual({});
  });
});

describe("要確認の絞り込み", () => {
  it("残っているものは「印の付いた行が1つでもある」", () => {
    expect(where("needsReview", ["true"])).toEqual({
      AND: [{ judgements: { some: { needsReview: true } } }],
    });
  });

  it("済んでいるものは「印の付いた行が1つも無い」", () => {
    // some: { needsReview: false } にすると、確認の残っている製品まで拾ってしまう
    expect(where("needsReview", ["false"])).toEqual({
      AND: [{ judgements: { none: { needsReview: true } } }],
    });
  });

  it("両方選ぶのは、絞っていないのと同じ", () => {
    expect(where("needsReview", ["true", "false"])).toEqual({});
  });
});

describe("該当法規制の絞り込み", () => {
  const list = (values: string[], op: "all" | "any") =>
    buildWhere(PRODUCT_COLUMNS, { judgementCategories: { kind: "list", op, values } });
  const hit = (id: string) => ({ judgements: { some: { categoryId: id, verdict: "APPLICABLE" } } });

  it("いずれかを含む", () => {
    expect(list(["a", "b"], "any")).toEqual({ AND: [{ OR: [hit("a"), hit("b")] }] });
  });

  it("すべてを含む", () => {
    expect(list(["a", "b"], "all")).toEqual({ AND: [{ AND: [hit("a"), hit("b")] }] });
  });

  it("非該当は当てにしない（該当だけを見る）", () => {
    // ここが verdict なしになると、「調べたが当たらなかった」ものまで拾ってしまう
    const w = list(["a"], "any") as { AND: { OR: { judgements: { some: unknown } }[] }[] };
    expect(w.AND[0]?.OR[0]?.judgements.some).toEqual({ categoryId: "a", verdict: "APPLICABLE" });
  });

  it("同じ区分を2回選んでも1回として扱う", () => {
    expect(list(["a", "a"], "any")).toEqual({ AND: [{ OR: [hit("a")] }] });
  });

  it("選んでいなければ絞らない", () => {
    expect(list([], "any")).toEqual({});
    expect(list([""], "any")).toEqual({});
  });
});

/**
 * 法文物質名の絞り込み。画面に出る名前は原文・日本語・英語のどれかなので、
 * どの欄に入っていても当たらないと「載っていない」ように見える
 */
describe("法文物質名の絞り込み", () => {
  // buildWhere は条件を AND で包むので、法文物質名の条件だけを取り出す
  const nameWhere = (op: "contains" | "empty" | "notEmpty", value = "") =>
    (
      buildWhere(STATUTORY_SUBSTANCE_COLUMNS, { nameJa: { kind: "text", op, value } }) as {
        AND: Record<string, unknown>[];
      }
    ).AND[0];

  it("原文・日本語・英語のどれかに含まれれば当たる", () => {
    expect(nameWhere("contains", "トルエン")).toEqual({
      OR: [
        { nameOriginal: { contains: "トルエン", mode: "insensitive" } },
        { nameJa: { contains: "トルエン", mode: "insensitive" } },
        { nameEn: { contains: "トルエン", mode: "insensitive" } },
      ],
    });
  });

  it("「空」は3つとも空のとき", () => {
    const w = nameWhere("empty") as { AND: unknown[] };
    expect(w.AND).toHaveLength(3);
  });

  it("「空でない」はどれかに入っているとき", () => {
    const w = nameWhere("notEmpty") as { OR: unknown[] };
    expect(w.OR).toHaveLength(3);
  });
});
