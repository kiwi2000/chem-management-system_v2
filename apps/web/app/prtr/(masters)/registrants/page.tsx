"use client";

import { PrtrRegistrantSection } from "@/components/prtr-registrant-section";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/** 事業者（届出者）（S22-1） */
export default function PrtrRegistrantsPage() {
  return (
    <div className={PAGE_SHELL_STACKED}>
      <PrtrRegistrantSection />
    </div>
  );
}
