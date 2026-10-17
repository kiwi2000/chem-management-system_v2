import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { classifyClass, merge, runTests, type Mixture } from "./engine";
import type { Ruleset } from "./generated/ast";
import { parseRuleset } from "./services";

const sample = (name: string) => readFileSync(join(__dirname, "samples", name), "utf8");

const registry = new Map<string, Ruleset>();
async function load(file: string): Promise<Ruleset> {
  const r = await parseRuleset(sample(file), file);
  if (r.errors.length || !r.ruleset) throw new Error(`${file}: ${JSON.stringify(r.errors)}`);
  registry.set(`${r.ruleset.name}@${r.ruleset.version}`, r.ruleset);
  return r.ruleset;
}

let un: Ruleset;
let jp: Ruleset;
let acme: Ruleset;

beforeAll(async () => {
  un = await load("un-rev9.ghsrule");
  jp = await load("jp-jis2025.ghsrule");
  acme = await load("acme-jp.ghsrule");
});

describe("レイヤーの重ね合わせ", () => {
  it("国連だけなら選択点は安全側の既定になる", () => {
    const m = merge(un, registry);
    expect(m.problems).toEqual([]);
    expect(m.options.get("acute.category5")?.chosen?.name).toBe("adopt");
    expect(m.options.get("acute.category5")?.chosenBy).toBe("safest");
  });

  it("日本のレイヤーは国連の上に重なり、選択点が全部選ばれている", () => {
    const m = merge(jp, registry);
    expect(m.layers).toEqual(["UN-Rev9@1", "JP-JIS2025@1"]);
    expect(m.problems).toEqual([]);
    expect(m.options.get("acute.category5")?.chosen?.name).toBe("exclude");
    expect(m.exclusions.map((e) => e.pattern.join("."))).toEqual([
      "acute.*.5",
      "skin.3",
      "aspiration.2",
    ]);
    // 変換値の表は国連のまま（区分 5 の行も残る。成分の区分 5 はそのまま計算に入れる）
    expect(m.rules.get("acute.oral")?.conversion?.entries.map((e) => String(e.category))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    // 本文（加算式など）は国連のまま残っている
    expect(m.rules.get("acute.oral")?.body.length).toBeGreaterThan(0);
  });

  it("自社のレイヤーは open の選択点だけ選び直せる", () => {
    const m = merge(acme, registry);
    expect(m.problems).toEqual([]);
    expect(m.options.get("acute.unknown_policy")?.chosen?.name).toBe("unclassifiable_over");
    expect(m.options.get("acute.unknown_policy")?.chosen?.arg?.value).toBe(0.1);
  });

  it("locked の選択点を選び直すと問題になる", async () => {
    const r = await parseRuleset(
      'ruleset "X" version 1 extends "JP-JIS2025" version 1 {\n  choose skin.category3 = adopt\n}\n',
      "x",
    );
    const m = merge(r.ruleset!, registry);
    expect(m.problems.join("\n")).toContain("locked");
  });
});

describe("ルールセットに書いた試験が全部通る", () => {
  for (const [label, get] of [
    ["国連 Rev.9", () => un],
    ["日本 JIS 2025", () => jp],
    ["自社（ACME）", () => acme],
  ] as const) {
    it(label, () => {
      const outcomes = runTests(get(), registry);
      expect(
        outcomes.filter((o) => !o.ok).map((o) => `${o.layer} ${o.name}: ${o.details.join("; ")}`),
      ).toEqual([]);
      expect(outcomes.length).toBeGreaterThan(0);
    });
  }
});

describe("判定の中身", () => {
  const mix = (
    ings: Partial<{
      name: string;
      conc: number;
      cat: [string, string];
      ate: number;
      unknown: boolean;
    }>[],
    product: Record<string, number | string> = {},
  ): Mixture => ({
    ingredients: ings.map((i, k) => ({
      name: i.name ?? `I${k}`,
      conc: i.conc ?? 0,
      categories: new Map(i.cat ? [i.cat] : []),
      values: new Map(i.ate !== undefined ? [["ate.oral", i.ate]] : []),
      unknown: new Set(i.unknown ? ["acute.oral"] : []),
      flags: new Set(),
    })),
    product: new Map(Object.entries(product)),
  });

  it("急性毒性（経口）の加算式: 50 % × 区分 3（ATE 100）と 50 % × 区分 4（ATE 500）→ ATEmix 167 → 区分 3", () => {
    const m = merge(jp, registry);
    const r = classifyClass(
      m,
      "acute.oral",
      mix([
        { conc: 50, cat: ["acute.oral", "3"] },
        { conc: 50, cat: ["acute.oral", "4"] },
      ]),
    );
    expect(r.outcome).toEqual({ kind: "category", category: "3" });
  });

  it("未知成分 20 % は補正の式。文が付き、置き場所は日本の選択点（sds）", () => {
    const m = merge(jp, registry);
    const r = classifyClass(
      m,
      "acute.oral",
      mix([
        { conc: 80, ate: 400 },
        { conc: 20, unknown: true },
      ]),
    );
    // (100 - 20) / ATEmix = 80 / 400 → ATEmix = 400 → 区分 4
    expect(r.outcome).toEqual({ kind: "category", category: "4" });
    expect(r.notes[0]?.text).toContain("20 %");
    expect(r.notes[0]?.place).toBe("sds");
  });

  it("pH 12 の製品は皮膚 区分 1 で、人の判断が要る印が付く", () => {
    const m = merge(jp, registry);
    const r = classifyClass(m, "skin", mix([{ conc: 100, cat: ["skin", "2"] }], { ph: 12 }));
    expect(r.outcome).toEqual({ kind: "category", category: "1" });
    expect(r.judgement.length).toBe(1);
    expect(r.because[0]).toContain("pH");
  });

  it("採らない区分に当たると読み替えの記録が残る", () => {
    const m = merge(jp, registry);
    const r = classifyClass(m, "acute.oral", mix([{ conc: 100, ate: 3000 }]));
    expect(r.outcome).toEqual({ kind: "not_classified" });
    expect(r.remapped).toEqual({ from: "5", to: { kind: "not_classified" } });
  });
});
