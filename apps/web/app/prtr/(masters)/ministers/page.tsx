"use client";

import { PrtrMinisterSection } from "@/components/prtr-minister-section";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/** 主務大臣（S22-1） */
export default function PrtrMinistersPage() {
  return (
    <div className={PAGE_SHELL_STACKED}>
      <PrtrMinisterSection />
    </div>
  );
}
