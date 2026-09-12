import type { JudgeResult, ReviewReason } from "@/lib/judge-calc";

/**
 * 判定に対する**人の判断**を、判定し直した結果に当てはめる。**ここはデータベースを知らない。**
 *
 * 人の判断（確認した・判定を変えた）は、判定の行ではなく製品 × 規制区分で別に持つ
 * （schema の ProductDecision）。判定の行は判定し直すたびに作り直すので、そこに置くと
 * 法規制バージョンが変わるたびに消えてしまう。人の判断は「この製品に入っている物質に
 * ついての知識」なので、データソースの版が変わっただけでは変わらない（2026-09-12 決定）。
 *
 * ただし**前提が同じあいだだけ**引き継ぐ。判断したときのシステムの結果
 * （該当／非該当と、どの法文物質名にどのCASで当たったか）を控えておき、
 * 判定し直した結果と見比べて、
 *
 *   同じ … 判断をそのまま当てはめる。要確認は付けない
 *   違う … 当てはめない。システムの結果を出し、**判断を外したことを要確認の理由にする**
 *          （黙って結果が変わると、判断した人が気づけない）
 *
 * 前提が変わる原因は、データソースの版の切り替えだけでなく、USERデータの追加、
 * 製品の組成の変更、閾値や合算のしかたの変更、金属換算係数の変更もある。
 */

/** 判定の行に控える「人の判断」の写し */
export interface Decision {
  /** 人が決めた判定。null なら「確認しただけ」（システムの判定をそのまま認めた） */
  verdict: "APPLICABLE" | "NOT_APPLICABLE" | null;
  /** 判断したときのシステムの判定と前提 */
  systemVerdict: "APPLICABLE" | "NOT_APPLICABLE";
  premise: string;
  decidedBy: string;
  decidedAt: Date;
  decidedNote: string | null;
}

/** 判断を当てはめたあとの、判定の行に書く値 */
export interface AppliedJudgement {
  verdict: "APPLICABLE" | "NOT_APPLICABLE";
  source: "SYSTEM" | "USER";
  needsReview: boolean;
  reasons: ReviewReason[];
  decidedBy: string | null;
  decidedAt: Date | null;
  decidedNote: string | null;
}

/**
 * 判定の前提の要約。**「どの法文物質名に、どのCASで当たったか」を1本の文字列にする。**
 *
 * 並びに依らず同じ文字列になるよう、CAS も法文物質名も並べ替えてからつなぐ
 * （移行 SQL も同じ作りかたで既存の行を埋めているので、形を変えるときは両方直す）。
 * 区分そのものでまとめて当たったときは法文物質名が無いので `*` で表す。
 * 含有率は入れない。同じ物質に同じ法文物質名で当たっているなら、量が少し動いても
 * 「この物質は法文物質名の形ではない」という判断は変わらないため
 */
export function premiseOf(hits: JudgeResult["hits"]): string {
  return hits
    .map((h) => {
      const cas = [...new Set(h.contributions.map((c) => c.cas))].sort();
      return `${h.statutorySubstanceId ?? "*"}:${cas.join(",")}`;
    })
    .sort()
    .join(";");
}

/** 判断したときと同じ前提か */
export function samePremise(
  result: { verdict: JudgeResult["verdict"]; premise: string },
  decision: Pick<Decision, "systemVerdict" | "premise">,
): boolean {
  return result.verdict === decision.systemVerdict && result.premise === decision.premise;
}

/**
 * 判定し直した結果に、人の判断を当てはめる。
 *
 *   判断が無い     … システムの結果のまま
 *   前提が同じ     … 判断を当てはめる（判定を変えていれば人の値に、確認だけなら印だけ）
 *   前提が違う     … システムの結果のまま、要確認にして理由 `decisionDropped` を足す
 */
export function applyDecision(
  result: Pick<JudgeResult, "verdict" | "needsReview" | "reasons">,
  premise: string,
  decision: Decision | null,
): AppliedJudgement {
  if (!decision) {
    return {
      verdict: result.verdict,
      source: "SYSTEM",
      needsReview: result.needsReview,
      reasons: result.reasons,
      decidedBy: null,
      decidedAt: null,
      decidedNote: null,
    };
  }
  if (samePremise({ verdict: result.verdict, premise }, decision)) {
    const verdict = decision.verdict ?? result.verdict;
    return {
      verdict,
      // 人が変えたものは、システムが出したものと見分けが付くようにする
      source: verdict === result.verdict ? "SYSTEM" : "USER",
      needsReview: false,
      // 警告は残す。確認は済んでいるが、気を付ける相手であることは変わらない
      reasons: result.reasons,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      decidedNote: decision.decidedNote,
    };
  }
  return {
    verdict: result.verdict,
    source: "SYSTEM",
    needsReview: true,
    reasons: [...result.reasons, "decisionDropped"],
    decidedBy: null,
    decidedAt: null,
    decidedNote: null,
  };
}
