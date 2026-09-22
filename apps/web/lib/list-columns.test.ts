import { describe, expect, it } from "vitest";
import {
  CAS_LINK_COLUMNS,
  CAS_LINK_DIFF_COLUMNS,
  STATUTORY_SUBSTANCE_COLUMNS,
  productColumns,
  regulationCategoryColumns,
  statutorySubstanceColumns,
} from "./list-columns";
import { buildWhere } from "./table-query";

/** 全部の物質を見られる人。公開前の物質の扱いは別に試す */
const VIEWER = { seeAll: true, userId: "u1" };

/**
 * 結び付きを見る条件には、必ず「そのバージョンで無効にしたデータソースではない」が付く（2026-09-18 指示）。
 * 「有効なものに限る」ではない。バージョンに並んでいない種別（取り消し線）は従来どおり見る
 */
const NOT_DISABLED = { source: { versions: { none: { versionId: "v1", enabled: false } } } };

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
 *
 * 判定は法規制バージョンごとにあるので、**条件には必ず現在の版が入る**。
 * 入っていないと、前の版で当たっていた製品まで「該当あり」に数える
 */
const PRODUCT_COLUMNS = productColumns("v1", true);
// 施行前・適用終了のものは該当に数えない（2026-09-22 決定）
const hit = {
  judgements: { some: { versionId: "v1", verdict: "APPLICABLE", effective: "IN_FORCE" } },
};

const where = (key: string, values: string[]) =>
  buildWhere(PRODUCT_COLUMNS, { [key]: { kind: "enum", values } });

describe("法規制の絞り込み", () => {
  it("該当あり", () => {
    expect(where("judgement", ["hit"])).toEqual({ AND: [hit] });
  });

  it("該当なしは「この版で判定したが、該当の行が1つも無い」。判定していないものは含めない", () => {
    expect(where("judgement", ["none"])).toEqual({
      AND: [{ AND: [{ expansion: { is: { judgedVersionId: "v1" } } }, { NOT: hit }] }],
    });
  });

  it("未判定は「この版で判定した記録が無い」（判定の行が 0 件でも判定済みのことがあるため）", () => {
    expect(where("judgement", ["unjudged"])).toEqual({
      AND: [{ NOT: { expansion: { is: { judgedVersionId: "v1" } } } }],
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

describe("組成をたどる絞り込み", () => {
  it("組成を見られる人には CAS番号・物質名の列がある", () => {
    const keys = productColumns("v1", true).map((c) => c.key);
    expect(keys).toContain("casNumbers");
    expect(keys).toContain("substanceNames");
  });

  it("組成を見られない人には無く、送られてきても黙って捨てる（このCASを含む製品、が分かってしまう）", () => {
    const cols = productColumns("v1", false);
    expect(cols.map((c) => c.key)).not.toContain("casNumbers");
    expect(cols.map((c) => c.key)).not.toContain("substanceNames");
    expect(
      buildWhere(cols, { casNumbers: { kind: "list", op: "any", values: ["7440-31-5"] } }),
    ).toEqual({});
  });
});

describe("要確認の絞り込み", () => {
  it("残っているものは「印の付いた行が1つでもある」", () => {
    expect(where("needsReview", ["true"])).toEqual({
      AND: [{ judgements: { some: { versionId: "v1", needsReview: true } } }],
    });
  });

  it("済んでいるものは「印の付いた行が1つも無い」", () => {
    // some: { needsReview: false } にすると、確認の残っている製品まで拾ってしまう
    expect(where("needsReview", ["false"])).toEqual({
      AND: [{ judgements: { none: { versionId: "v1", needsReview: true } } }],
    });
  });

  it("両方選ぶのは、絞っていないのと同じ", () => {
    expect(where("needsReview", ["true", "false"])).toEqual({});
  });
});

describe("該当法規制の絞り込み", () => {
  const list = (values: string[], op: "all" | "any") =>
    buildWhere(PRODUCT_COLUMNS, { judgementCategories: { kind: "list", op, values } });
  const hit = (id: string) => ({
    judgements: {
      some: { versionId: "v1", categoryId: id, verdict: "APPLICABLE", effective: "IN_FORCE" },
    },
  });

  it("いずれかを含む", () => {
    expect(list(["a", "b"], "any")).toEqual({ AND: [{ OR: [hit("a"), hit("b")] }] });
  });

  it("すべてを含む", () => {
    expect(list(["a", "b"], "all")).toEqual({ AND: [{ AND: [hit("a"), hit("b")] }] });
  });

  it("非該当は当てにしない（該当だけを見る）", () => {
    // ここが verdict なしになると、「調べたが当たらなかった」ものまで拾ってしまう
    const w = list(["a"], "any") as { AND: { OR: { judgements: { some: unknown } }[] }[] };
    expect(w.AND[0]?.OR[0]?.judgements.some).toEqual({
      versionId: "v1",
      categoryId: "a",
      verdict: "APPLICABLE",
      effective: "IN_FORCE",
    });
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

/**
 * 結び付いた CAS番号で法文物質名・区分を絞る条件。
 *
 * **番号は完全一致、見るのはいまの版だけ**（2026-09-18 指摘）。
 * 部分一致だと `50-00-0` で `71550-00-0` の行まで出る。版を限らないと、
 * 古い版にしか無い結び付きで、画面に出ていない行が並ぶ
 */
describe("結び付いたCAS番号の絞り込み", () => {
  const first = (w: unknown) => (w as { AND: Record<string, unknown>[] }).AND[0];
  const cas = (op: "any" | "all", values: string[]) => ({
    casNumber: { kind: "list" as const, op, values },
  });

  it("法文物質名：いまの版の結び付きに、その番号がそのまま付いているもの", () => {
    expect(
      first(buildWhere(statutorySubstanceColumns("v1", VIEWER), cas("any", ["50-00-0"]))),
    ).toEqual({
      OR: [{ links: { some: { versionId: "v1", casNormalized: "50-00-0", ...NOT_DISABLED } } }],
    });
  });

  it("複数の番号は「いずれか」なら OR、「すべて」なら AND", () => {
    const any = first(
      buildWhere(statutorySubstanceColumns("v1", VIEWER), cas("any", ["50-00-0", "71-43-2"])),
    );
    const all = first(
      buildWhere(statutorySubstanceColumns("v1", VIEWER), cas("all", ["50-00-0", "71-43-2"])),
    );
    expect((any as { OR: unknown[] }).OR).toHaveLength(2);
    expect((all as { AND: unknown[] }).AND).toHaveLength(2);
  });

  it("版が決まっていなければ1件も当たらない", () => {
    expect(
      first(buildWhere(statutorySubstanceColumns(null, VIEWER), cas("any", ["50-00-0"]))),
    ).toEqual({
      id: { in: [] },
    });
    expect(
      first(buildWhere(regulationCategoryColumns(null, VIEWER), cas("any", ["50-00-0"]))),
    ).toEqual({
      id: { in: [] },
    });
  });

  it("区分：分類 → 法文物質名 → 結び付き とたどる（消したものは飛ばす）", () => {
    expect(
      first(buildWhere(regulationCategoryColumns("v1", VIEWER), cas("any", ["50-00-0"]))),
    ).toEqual({
      OR: [
        {
          classes: {
            some: {
              deletedAt: null,
              statutorySubstances: {
                some: {
                  deletedAt: null,
                  links: { some: { versionId: "v1", casNormalized: "50-00-0", ...NOT_DISABLED } },
                },
              },
            },
          },
        },
      ],
    });
  });
});

/**
 * 「結び付いた物質の名前」の絞り込み。
 *
 * **当たった物質や CAS の一覧を渡し直さず、条件だけを渡す**（2026-09-18 指摘）。
 * 一覧を渡す形だと、PostgreSQL が受け取れる値の数（32,767）を超えたところで失敗する。
 * リンク → 名前（ビュー）とたどる条件になっていることを固定する
 */
describe("結び付いた物質の名前の絞り込み", () => {
  const first = (w: unknown) => (w as { AND: Record<string, unknown>[] }).AND[0];
  const name = (value: string) => ({
    substanceName: { kind: "text" as const, op: "contains" as const, value },
  });
  const nameMatch = {
    OR: [
      { nameJa: { contains: "鉛", mode: "insensitive" } },
      { nameEn: { contains: "鉛", mode: "insensitive" } },
    ],
  };

  it("法文物質名：いまの版の結び付きに、その名前（別名も）の物質が付いているもの", () => {
    expect(first(buildWhere(statutorySubstanceColumns("v1", VIEWER), name("鉛")))).toEqual({
      links: { some: { versionId: "v1", names: { some: { AND: [nameMatch] } }, ...NOT_DISABLED } },
    });
  });

  it("全部を見られない人には、公開済みか本人が作った物質だけを当てる", () => {
    const w = first(
      buildWhere(statutorySubstanceColumns("v1", { seeAll: false, userId: "u9" }), name("鉛")),
    ) as { links: { some: { names: { some: { AND: unknown[] } } } } };
    expect(w.links.some.names.some.AND).toEqual([
      nameMatch,
      { OR: [{ publishState: "PUBLISHED" }, { createdBy: "u9" }] },
    ]);
  });

  it("区分：分類 → 法文物質名 → 結び付き → 名前 とたどる", () => {
    expect(first(buildWhere(regulationCategoryColumns("v1", VIEWER), name("鉛")))).toEqual({
      classes: {
        some: {
          deletedAt: null,
          statutorySubstances: {
            some: {
              deletedAt: null,
              links: {
                some: { versionId: "v1", names: { some: { AND: [nameMatch] } }, ...NOT_DISABLED },
              },
            },
          },
        },
      },
    });
  });

  it("版が決まっていなければ1件も当たらない", () => {
    expect(first(buildWhere(statutorySubstanceColumns(null, VIEWER), name("鉛")))).toEqual({
      id: { in: [] },
    });
  });

  it("規制対象CASの表：代表物質の主名称だけを見る（公開状態は見ない）", () => {
    expect(
      first(
        buildWhere(CAS_LINK_COLUMNS, {
          casName: { kind: "text", op: "contains", value: "鉛" },
        }),
      ),
    ).toEqual({
      names: { some: { AND: [nameMatch, { isCasRepresentative: true }, { aliasId: null }] } },
    });
  });

  it("「空」「空でない」は条件にしない", () => {
    expect(
      buildWhere(statutorySubstanceColumns("v1", VIEWER), {
        substanceName: { kind: "text", op: "empty", value: "" },
      }),
    ).toEqual({});
  });
});

/** 対象CASの差分の表。種類は DB の値で絞り、法文物質名の側の条件は関連をたどる */
describe("対象CASの差分の絞り込み", () => {
  it("種類は kind の in で絞る", () => {
    expect(
      buildWhere(CAS_LINK_DIFF_COLUMNS, { kind: { kind: "enum", values: ["ADDED", "REMOVED"] } }),
    ).toEqual({
      AND: [{ kind: { in: ["ADDED", "REMOVED"] } }],
    });
  });

  it("法律の名前は法文物質名 → 分類 → 区分 → 法律 と掘る", () => {
    const w = buildWhere(CAS_LINK_DIFF_COLUMNS, {
      lawName: { kind: "text", op: "contains", value: "安衛" },
    }) as { AND: { statutorySubstance: { regulationClass: { category: { law: unknown } } } }[] };
    expect(w.AND[0]!.statutorySubstance.regulationClass.category.law).toEqual({
      OR: [
        { nameOriginal: { contains: "安衛", mode: "insensitive" } },
        { nameJa: { contains: "安衛", mode: "insensitive" } },
        { nameEn: { contains: "安衛", mode: "insensitive" } },
      ],
    });
  });
});
