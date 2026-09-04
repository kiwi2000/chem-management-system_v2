"use client";

import { useRouter } from "next/navigation";
import { pickStatutoryName } from "@chem/shared";
import { useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CategoryProducts } from "@/components/category-products";
import { PrevNext, type Neighbour } from "@/components/prev-next";
import { StatutorySubstanceSection } from "@/components/statutory-substance-section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { LanguageDto, RegulationCategoryDto } from "@/lib/types";

/** 見出しに出す法律。名前だけあればよい */
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
 * 左上の小さなリンクで法律の一覧へ戻り、コードを押すと対象CASへ降りる。
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
  /** 同じ法律の隣の区分。端では null */
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

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      {/* いまどこにいるか。メニューの項目名から始める */}
      {/*
        規制区分だけの画面は無く、法律の画面から直接ここへ来る。
        法律と区分を別の段にすると、途中に開けない段ができてしまうので、
        「化審法・第二種特定化学物質」のように1つにまとめる
      */}
      <Breadcrumbs
        items={[
          { label: m.nav.laws },
          { label: m.laws.title, href: "/laws" },
          { label: `${lawName || law.code}・${catName || category.code}` },
        ]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{catName || category.code}</h1>
        {/* 同じ法律の中を順に見ていくための矢印 */}
        <PrevNext prev={prev} next={next} />
        {/* 逆引き。区分を見ているときにだけ意味があるので、ここに置く */}
        <Button size="sm" variant="outline" onClick={() => setProductsOpen((v) => !v)}>
          {m.judgements.matchedProducts}
        </Button>
        {/* この区分の対象CASを、法文物質名をまたいで1つの表で見る（外部データベースの画面） */}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            router.push(
              `/external-db?version=current&scopeCategory=${category.id}&scopeLabel=${encodeURIComponent(
                `${lawName || law.code}・${catName || category.code}`,
              )}`,
            )
          }
        >
          {m.casLinkTable.openAll}
        </Button>
      </div>

      {productsOpen && <CategoryProducts categoryId={category.id} />}

      <StatutorySubstanceSection languages={languages} category={category} />
    </div>
  );
}
