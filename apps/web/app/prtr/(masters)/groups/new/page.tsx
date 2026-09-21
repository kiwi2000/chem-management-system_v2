"use client";

import { PrtrGroupForm } from "@/components/prtr-group-form";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/** グループの登録（S22-1） */
export default function NewPrtrGroupPage() {
  const { m } = useI18n();
  return (
    <div className={PAGE_SHELL_STACKED}>
      <h1 className="text-2xl font-semibold">{m.prtr.groups.newTitle}</h1>
      <PrtrGroupForm initial={null} />
    </div>
  );
}
