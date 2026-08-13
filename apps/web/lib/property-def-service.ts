import type { SubstancePropertyDef } from "@prisma/client";
import type { PropertyDefDto } from "@/lib/types";

type WithCount = SubstancePropertyDef & { _count: { values: number } };

export function toPropertyDefDto(d: WithCount): PropertyDefDto {
  return {
    id: d.id,
    key: d.key,
    labelJa: d.labelJa,
    labelEn: d.labelEn,
    dataType: d.dataType,
    defaultUnit: d.defaultUnit,
    displayOrder: d.displayOrder,
    activeFlag: d.activeFlag,
    valueCount: d._count.values,
  };
}
