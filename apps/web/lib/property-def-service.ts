import type { Prisma, PropertyDef, PropertyOption } from "@prisma/client";
import type { PropertyDefDto, PropertyOptionDto } from "@/lib/types";

/**
 * 拡張属性の項目定義は物質と製品で1つの表を共有し、`target` で用途を分ける。
 * 値の表は FK を保つために用途ごとに分かれているので、件数は両方数えて自分の側だけを見せる。
 * 選択肢（値・条件）も一緒に引く（2026-10-17）
 */
export const PROPERTY_DEF_COUNT = {
  _count: { select: { substanceValues: true, productValues: true } },
  options: { orderBy: [{ displayOrder: "asc" }, { code: "asc" }] },
} satisfies Prisma.PropertyDefInclude;

type WithCount = PropertyDef & {
  _count: { substanceValues: number; productValues: number };
  options: PropertyOption[];
};

/** 用途に対応する側の入力済み件数 */
export function valueCountOf(d: WithCount): number {
  return d.target === "PRODUCT" ? d._count.productValues : d._count.substanceValues;
}

function toOptionDto(o: PropertyOption): PropertyOptionDto {
  return {
    id: o.id,
    code: o.code,
    labelJa: o.labelJa,
    labelEn: o.labelEn,
    activeFlag: o.activeFlag,
  };
}

export function toPropertyDefDto(d: WithCount): PropertyDefDto {
  return {
    id: d.id,
    target: d.target,
    key: d.key,
    labelJa: d.labelJa,
    labelEn: d.labelEn,
    dataType: d.dataType,
    defaultUnit: d.defaultUnit,
    displayOrder: d.displayOrder,
    activeFlag: d.activeFlag,
    valueCount: valueCountOf(d),
    group: d.group,
    systemFlag: d.systemFlag,
    valueOptions: d.options.filter((o) => o.kind === "VALUE").map(toOptionDto),
    conditionOptions: d.options.filter((o) => o.kind === "CONDITION").map(toOptionDto),
  };
}

/** 画面から届く選択肢の並び（`id` が無いものは新しく足す） */
export interface PropertyOptionInput {
  id?: string | undefined;
  labelJa: string;
  labelEn?: string | null | undefined;
  activeFlag: boolean;
}

/**
 * 選択肢を、画面から届いた並びに合わせる（2026-10-17）。
 * - 並びの順を表示順にする
 * - 新しいものにはコードを振る。既にあるもののコードは変えない（保存した値との対応のため）
 * - 並びから外したものは、入力済みの値で使われていれば「使わない」にし、使われていなければ消す
 */
export async function syncPropertyOptions(
  tx: Prisma.TransactionClient,
  def: Pick<PropertyDef, "id" | "target">,
  kind: "VALUE" | "CONDITION",
  list: PropertyOptionInput[],
): Promise<void> {
  const existing = await tx.propertyOption.findMany({ where: { propertyDefId: def.id, kind } });
  const kept = new Set(list.flatMap((o) => (o.id ? [o.id] : [])));
  const removed = existing.filter((o) => !kept.has(o.id));
  if (removed.length > 0) {
    const codes = removed.map((o) => o.code);
    const where =
      kind === "VALUE"
        ? { propertyDefId: def.id, valueText: { in: codes } }
        : { propertyDefId: def.id, conditionCode: { in: codes } };
    const used =
      def.target === "PRODUCT"
        ? await tx.productProperty.findMany({
            where,
            select: { valueText: true, conditionCode: true },
          })
        : await tx.substanceProperty.findMany({
            where,
            select: { valueText: true, conditionCode: true },
          });
    const usedCodes = new Set(used.map((u) => (kind === "VALUE" ? u.valueText : u.conditionCode)));
    for (const o of removed) {
      if (usedCodes.has(o.code)) {
        await tx.propertyOption.update({ where: { id: o.id }, data: { activeFlag: false } });
      } else {
        await tx.propertyOption.delete({ where: { id: o.id } });
      }
    }
  }
  const byId = new Map(existing.map((o) => [o.id, o]));
  const codes = new Set(existing.map((o) => o.code));
  let i = 0;
  for (const o of list) {
    i += 1;
    const data = {
      labelJa: o.labelJa,
      labelEn: o.labelEn ?? null,
      activeFlag: o.activeFlag,
      displayOrder: i * 10,
    };
    if (o.id && byId.has(o.id)) {
      await tx.propertyOption.update({ where: { id: o.id }, data });
      continue;
    }
    // 管理者が足した選択肢のコードは連番（o1, o2…）。既にあるコードとは重ねない
    let n = codes.size + 1;
    while (codes.has(`o${n}`)) n += 1;
    const code = `o${n}`;
    codes.add(code);
    await tx.propertyOption.create({ data: { ...data, propertyDefId: def.id, kind, code } });
  }
}
