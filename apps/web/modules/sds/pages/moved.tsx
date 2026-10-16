import { redirect } from "next/navigation";

/**
 * 前の道筋（/sds/ghs-data・/sds/ghs）。GHS分類データは 2026-10-16 に標準へ移したので、
 * しおりや前の案内から来た人を新しい画面へ送る
 */
export function SdsGhsMovedPage(): never {
  redirect("/ghs-data");
}
