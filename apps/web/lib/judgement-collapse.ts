import type { ProductJudgementDto } from "@/lib/types";

/**
 * 組成を見る権限の無い人に返す判定（2026-10-14 指示）。
 *
 * **規制区分ごとに結論を 1 つにまとめ、物質を推し量れる情報を消してから返す。**
 * 法文物質名・法令の番号・適用条件・金属換算・当たった CAS と含有率・人の判断の記録は持たせない。
 * 画面で隠すだけでは、受け取ったデータから読めてしまう（機密はサーバー側で外す決まり）。
 * 上の段（国・法律）の件数も、まとめたあとの区分の数で数えることになり、法文物質名の数は漏れない。
 *
 * 結論の決め方は、最終組成の表のいちばん下と同じ（`aggregate-footer.ts`）。
 * - 要確認の付いていない該当が 1 つでもある → 該当
 * - 要確認の付いた該当だけ → 要確認（verdict は該当のまま、needsReview を立てる）
 * - それ以外 → 非該当。「非該当だが要確認」は組成を意識する人にだけ見せる内容なので、ここでは非該当
 *   （ユーザーの判断）。施行前・適用終了も非該当
 */
export function collapseToCategories(rows: ProductJudgementDto[]): ProductJudgementDto[] {
  const byCategory = new Map<string, ProductJudgementDto[]>();
  for (const r of rows) byCategory.set(r.categoryId, [...(byCategory.get(r.categoryId) ?? []), r]);

  return [...byCategory.values()].map((list) => {
    const first = list[0]!;
    const inForce = list.filter((r) => r.effective === "IN_FORCE");
    const applicable = inForce.some((r) => r.verdict === "APPLICABLE" && !r.needsReview);
    const review = inForce.some((r) => r.verdict === "APPLICABLE" && r.needsReview);
    const verdict = applicable || review ? "APPLICABLE" : "NOT_APPLICABLE";
    // 区分ごと施行前・適用終了なら、その印は残す（区分の性質で、物質の情報ではない）
    const whole = inForce.length === 0 ? first : null;
    return {
      ...first,
      // 区分で 1 行。内部の id は使わない（判定修正はできない人なので、押される場所も無い）
      id: `category:${first.categoryId}`,
      statutorySubstanceId: null,
      statutoryName: null,
      officialNumber: null,
      applicableCondition: null,
      asElement: null,
      effective: whole ? whole.effective : "IN_FORCE",
      effectiveScope: whole ? "category" : null,
      effectiveFrom: whole ? whole.effectiveFrom : null,
      effectiveTo: whole ? whole.effectiveTo : null,
      verdict,
      source: "SYSTEM",
      systemVerdict: verdict,
      needsReview: !applicable && review,
      reviewReasons: [],
      decidedByName: null,
      decidedAt: null,
      decidedNote: null,
      droppedDecision: null,
      hits: [],
      hitsWithheld: true,
    };
  });
}
