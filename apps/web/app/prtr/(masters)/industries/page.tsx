"use client";

import { PrtrIndustrySection } from "@/components/prtr-industry-section";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/** 業種（S22-1） */
export default function PrtrIndustriesPage() {
  return (
    <div className={PAGE_SHELL_STACKED}>
      <PrtrIndustrySection />
    </div>
  );
}
