"use client";

import { PrtrSiteSection } from "@/components/prtr-site-section";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/** 工場（S22-1） */
export default function PrtrSitesPage() {
  return (
    <div className={PAGE_SHELL_STACKED}>
      <PrtrSiteSection />
    </div>
  );
}
