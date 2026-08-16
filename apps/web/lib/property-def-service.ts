import type { Prisma, PropertyDef } from "@prisma/client";
import type { PropertyDefDto } from "@/lib/types";

/**
 * 拡張属性の項目定義は物質と製品で1つの表を共有し、`target` で用途を分ける。
 * 値の表は FK を保つために用途ごとに分かれているので、件数は両方数えて自分の側だけを見せる。
 */
export const PROPERTY_DEF_COUNT = {
  _count: { select: { substanceValues: true, productValues: true } },
} satisfies Prisma.PropertyDefInclude;

type WithCount = PropertyDef & { _count: { substanceValues: number; productValues: number } };

/** 用途に対応する側の入力済み件数 */
export function valueCountOf(d: WithCount): number {
  return d.target === "PRODUCT" ? d._count.productValues : d._count.substanceValues;
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
  };
}
