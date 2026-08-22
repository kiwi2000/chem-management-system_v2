import type { Prisma } from "@prisma/client";
import type { CountryDto } from "@/lib/types";

/** 一覧に地域名を出すので、地域を一緒に引く */
export const COUNTRY_INCLUDE = {
  region: { select: { nameJa: true, nameEn: true } },
} satisfies Prisma.CountryInclude;

type CountryWithRegion = Prisma.CountryGetPayload<{ include: typeof COUNTRY_INCLUDE }>;

export function toCountryDto(c: CountryWithRegion): CountryDto {
  return {
    id: c.id,
    code: c.code,
    regionId: c.regionId,
    regionNameJa: c.region.nameJa,
    regionNameEn: c.region.nameEn,
    nameJa: c.nameJa,
    nameEn: c.nameEn,
    displayOrder: c.displayOrder,
  };
}
