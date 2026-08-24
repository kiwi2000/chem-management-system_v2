"use client";

import { Hammer } from "lucide-react";
import { useI18n } from "@/lib/i18n-client";
import type { Messages } from "@chem/shared";

/**
 * まだ作っていない画面。
 *
 * メニューには全体像が見えるよう先に並べてあるので、押したときに 404 を出すと
 * 「壊れている」と読めてしまう。作っていないだけだと分かる形にする。
 *
 * 画面の名前はメニューと同じ辞書から引く。名前がずれないようにするため。
 */
export function UnderConstruction({ titleKey }: { titleKey: keyof Messages["nav"] }) {
  const { m } = useI18n();

  return (
    <div className="w-full p-4 lg:p-6">
      <div className="border-border bg-muted/30 mx-auto max-w-xl space-y-3 border p-8 text-center">
        <Hammer className="text-muted-foreground mx-auto size-8" aria-hidden />
        <h1 className="text-xl font-semibold">{m.nav[titleKey]}</h1>
        <p className="leading-relaxed">{m.common.underConstruction}</p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {m.common.underConstructionLead}
        </p>
      </div>
    </div>
  );
}
