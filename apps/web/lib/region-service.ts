import type { Region } from "@prisma/client";
import type { RegionDto } from "@/lib/types";

/** 地域（アジア・欧州など）。国は含まない */
export function toRegionDto(r: Region): RegionDto {
  return {
    id: r.id,
    code: r.code,
    nameJa: r.nameJa,
    nameEn: r.nameEn,
    displayOrder: r.displayOrder,
  };
}
