"use client";

import { PropertyDefSection } from "@/components/property-def-section";
import { useI18n } from "@/lib/i18n-client";

/**
 * 拡張属性の項目定義。
 * 物質の項目と製品の項目は使う場面が違うので、1つの表に混ぜず上下に分けて扱う。
 */
export default function PropertyDefsPage() {
  const { m } = useI18n();

  return (
    <div className="w-full space-y-8 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{m.propertyDefs.title}</h1>
        <p className="text-muted-foreground text-sm">{m.propertyDefs.description}</p>
      </div>

      <PropertyDefSection
        target="SUBSTANCE"
        title={m.propertyDefs.targetSubstance}
        hint={m.propertyDefs.targetSubstanceHint}
        storageKey="chem.table.propertyDefs.substance"
        keyPlaceholder="melting_point"
      />

      <PropertyDefSection
        target="PRODUCT"
        title={m.propertyDefs.targetProduct}
        hint={m.propertyDefs.targetProductHint}
        storageKey="chem.table.propertyDefs.product"
        keyPlaceholder="model_number"
      />
    </div>
  );
}
