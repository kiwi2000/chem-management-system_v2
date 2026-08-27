"use client";

import { pickStatutoryName } from "@chem/shared";
import Link from "next/link";
import { useState } from "react";
import { CasLinkSection } from "@/components/cas-link-section";
import { PrevNext, type Neighbour } from "@/components/prev-next";
import type { VersionSource } from "@/components/version-source-picker";
import { useI18n } from "@/lib/i18n-client";
import type { StatutorySubstanceDto } from "@/lib/types";

/** 戻り先の区分。名前だけあればよい */
interface CategoryRef {
  id: string;
  code: string;
  nameOriginal: string;
  nameJa: string | null;
  nameEn: string | null;
}

/**
 * 法文物質名の対象CAS。
 *
 * **1段につき1画面。**インベントリの該当物質と同じ形にそろえてある。
 * 左上の小さなリンクで、1つ上の規制区分へ戻る。
 */
export function SubstanceCasScreen({
  substance,
  category,
  prev,
  next,
}: {
  substance: StatutorySubstanceDto;
  category: CategoryRef;
  /** 同じ分類の隣の法文物質名。端では null */
  prev: Neighbour | null;
  next: Neighbour | null;
}) {
  const { m, locale } = useI18n();
  /** 見ているバージョンとデータソース。インベントリの該当物質と同じ持ちかた */
  const [picked, setPicked] = useState<VersionSource | null>(null);

  const catName = pickStatutoryName(
    locale,
    category.nameOriginal,
    category.nameJa,
    category.nameEn,
  );
  const subName = pickStatutoryName(
    locale,
    substance.nameOriginal,
    substance.nameJa,
    substance.nameEn,
  );

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <p className="text-muted-foreground text-sm">
        <Link href={`/categories/${category.id}`} className="underline underline-offset-2">
          {catName || category.code}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{subName || substance.code}</h1>
        {/* 同じ分類の中を順に見ていくための矢印 */}
        <PrevNext prev={prev} next={next} />
      </div>
      {substance.officialNumber && (
        <p className="text-muted-foreground text-xs">
          {m.statutorySubstances.officialNumber}: {substance.officialNumber}
        </p>
      )}

      <CasLinkSection
        substance={substance}
        picked={picked}
        onPickedChange={setPicked}
        slideDir={null}
      />
    </div>
  );
}
