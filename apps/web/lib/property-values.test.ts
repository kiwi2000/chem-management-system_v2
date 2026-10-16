import { getMessages } from "@chem/shared";
import type { PropertyDef, PropertyOption } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { propertyWrites, validatePropertyValues } from "./property-values";

const m = getMessages("ja");

function def(
  id: string,
  dataType: PropertyDef["dataType"],
  options: [PropertyOption["kind"], string][] = [],
): PropertyDef & { options: PropertyOption[] } {
  return {
    id,
    target: "SUBSTANCE",
    key: id,
    labelJa: id,
    labelEn: null,
    dataType,
    defaultUnit: null,
    displayOrder: 0,
    activeFlag: true,
    group: "OTHER",
    systemFlag: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    options: options.map(([kind, code], i) => ({
      id: `${id}-${kind}-${code}`,
      propertyDefId: id,
      kind,
      code,
      labelJa: code,
      labelEn: null,
      displayOrder: i,
      activeFlag: code !== "old",
    })),
  };
}

const DEFS = [
  def("state", "CHOICE", [
    ["VALUE", "solid"],
    ["VALUE", "old"],
    ["CONDITION", "c20"],
  ]),
  def("flash", "NUMBER", [["CONDITION", "closed_cup"]]),
];

describe("拡張属性の値の検証（選択肢・条件。2026-10-17）", () => {
  it("選択肢の項目は登録したコードだけ通す", () => {
    expect(
      validatePropertyValues([{ propertyDefId: "state", valueText: "solid" }], DEFS, m),
    ).toEqual([]);
    expect(
      validatePropertyValues([{ propertyDefId: "state", valueText: "液状" }], DEFS, m),
    ).toEqual([m.errors.propertyChoiceUnknown("state")]);
  });

  it("使わない選択肢でも、入力済みの値は保存し直せる", () => {
    expect(validatePropertyValues([{ propertyDefId: "state", valueText: "old" }], DEFS, m)).toEqual(
      [],
    );
  });

  it("条件は選択肢のコードか「その他」の自由記入のどちらか一方", () => {
    const ok = { propertyDefId: "flash", valueNum: "21" };
    expect(validatePropertyValues([{ ...ok, conditionCode: "closed_cup" }], DEFS, m)).toEqual([]);
    expect(validatePropertyValues([{ ...ok, conditionText: "タグ密閉式" }], DEFS, m)).toEqual([]);
    expect(validatePropertyValues([{ ...ok, conditionCode: "c20" }], DEFS, m)).toEqual([
      m.errors.propertyConditionUnknown("flash"),
    ]);
    expect(
      validatePropertyValues([{ ...ok, conditionCode: "closed_cup", conditionText: "x" }], DEFS, m),
    ).toEqual([m.errors.propertyConditionUnknown("flash")]);
  });

  it("値の空いた項目は保存しない。条件も一緒に保存する", () => {
    expect(
      propertyWrites([
        { propertyDefId: "flash", valueNum: "21", conditionCode: "closed_cup" },
        { propertyDefId: "state", valueText: null, conditionCode: "c20" },
      ]),
    ).toEqual([
      {
        propertyDefId: "flash",
        valueText: null,
        valueNum: "21",
        unit: null,
        conditionCode: "closed_cup",
        conditionText: null,
      },
    ]);
  });
});
