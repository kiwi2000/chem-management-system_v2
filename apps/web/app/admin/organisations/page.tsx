"use client";

import { OrganisationSection } from "@/components/organisation-section";
import { useI18n } from "@/lib/i18n-client";

/** 組織（会社・事業所）。帳票に載せる差出人の情報を置く */
export default function OrganisationsPage() {
  const { m } = useI18n();

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div>
        <p className="text-muted-foreground text-sm">{m.organisations.description}</p>
      </div>
      <OrganisationSection />
    </div>
  );
}
