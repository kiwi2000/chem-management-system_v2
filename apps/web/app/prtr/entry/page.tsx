"use client";

import { PrtrEntryScreen } from "@/components/prtr-entry-screen";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

/** PRTR 届出データの入力（S22） */
export default function PrtrEntryPage() {
  return (
    <div className={PAGE_SHELL_STACKED}>
      <PrtrEntryScreen />
    </div>
  );
}
