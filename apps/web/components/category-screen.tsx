"use client";

import { pickStatutoryName } from "@chem/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { CategoryProducts } from "@/components/category-products";
import { PrevNext, type Neighbour } from "@/components/prev-next";
import { StatutorySubstanceSection } from "@/components/statutory-substance-section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { LanguageDto, RegulationCategoryDto, StatutorySubstanceDto } from "@/lib/types";

/** 見出しに出す法令。名前だけあればよい */
interface LawRef {
  id: string;
  code: string;
  nameOriginal: string;
  nameJa: string | null;
  nameEn: string | null;
}

/**
 * 規制区分の法文物質名。
 *
 * **1段につき1画面。**インベントリと同じ形にそろえてある。
 * 左上の小さなリンクで法令の一覧へ戻り、コードを押すと対象CASへ降りる。
 */
export function CategoryScreen({
  languages,
  category,
  law,
  prev,
  next,
}: {
  languages: LanguageDto[];
  category: RegulationCategoryDto;
  law: LawRef;
  /** 同じ法令の隣の区分。端では null */
  prev: Neighbour | null;
  next: Neighbour | null;
}) {
  const { m, locale } = useI18n();
  const router = useRouter();
  /** 逆引き（この区分に当たる製品）。開いているあいだだけ読む */
  const [productsOpen, setProductsOpen] = useState(false);

  const lawName = pickStatutoryName(locale, law.nameOriginal, law.nameJa, law.nameEn);
  const catName = pickStatutoryName(
    locale,
    category.nameOriginal,
    category.nameJa,
    category.nameEn,
  );

  /** 行を押したら対象CASの画面へ移る。兄弟はその画面が自分で引く */
  const onSelect = useCallback(
    (substance: StatutorySubstanceDto) => {
      router.push(`/statutory-substances/${substance.id}`);
    },
    [router],
  );

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      {/* 戻り道。インベントリと同じく、左上の小さなリンク */}
      <p className="text-muted-foreground text-sm">
        <Link href="/laws" className="underline underline-offset-2">
          {m.laws.title}
        </Link>
        <span className="px-2">›</span>
        {lawName}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{catName || category.code}</h1>
        {/* 同じ法令の中を順に見ていくための矢印 */}
        <PrevNext prev={prev} next={next} />
        {/* 逆引き。区分を見ているときにだけ意味があるので、ここに置く */}
        <Button size="sm" variant="outline" onClick={() => setProductsOpen((v) => !v)}>
          {m.judgements.matchedProducts}
        </Button>
      </div>

      {productsOpen && <CategoryProducts categoryId={category.id} />}

      <StatutorySubstanceSection languages={languages} category={category} onSelect={onSelect} />
    </div>
  );
}
