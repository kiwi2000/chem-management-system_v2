import { rankOf, fromScaled, normalizeCas, sumScaled } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { asElementOf, loadElementNames } from "@/lib/as-element";
import { prisma } from "@/lib/db";
import { loadBands } from "@/lib/score-store";
import { unitKey } from "@/lib/judge-store";
import { dayOf, effectiveOn, type Effective } from "@/lib/judgement-date";
import { LAW_ORDER_SELECT, compareLawOrder, lawOrderKey } from "@/lib/law-order";
import type { JudgementHitDto, MatchedProductDto, ProductJudgementDto } from "@/lib/types";

/**
 * 判定結果を、画面に出せる形に組み立てる。
 *
 * 判定の行は**判定の単位**（区分でまとめる区分は区分、それ以外は法文物質名）ごとにある
 * （2026-09-15 決定）。法律名・区分名・法文物質名は判定の行に持っていない
 * （二重に持つと必ず食い違うため）。ここで引いて足す。
 */

/**
 * その製品の判定を、法律・区分の並び順で返す。**その法規制バージョンの行だけ。**
 * 判定は版ごとに持っているので、絞らないと前の版の結果が混ざる
 *
 * `withHits` が false のときは根拠を伏せる。組成を見られない人に
 * 「何が何％入っているか」を渡すことになるため。**法文物質名の名前も根拠のうち**
 * （名前が並べば、その物質が入っていると分かる）なので、伏せる相手には
 * 区分ごとに 1 行にまとめて、該当／非該当と確認の要否だけを出す
 */
export async function toJudgementDtos(
  productId: string,
  withHits: boolean,
  versionId: string,
): Promise<ProductJudgementDto[]> {
  const [rows, decisions] = await Promise.all([
    loadJudgementRows({ productId, versionId }, withHits),
    /*
      前提が変わって当てはめなかった人の判断。**何を外したのかを画面に出す**ため。
      「以前の判断があった」とだけ言われても、判断し直す人は何を見ればよいか分からない
    */
    prisma.productDecision.findMany({
      where: { productId },
      select: {
        categoryId: true,
        statutorySubstanceId: true,
        verdict: true,
        decidedBy: true,
        decidedAt: true,
        decidedNote: true,
      },
    }),
  ]);
  const decisionOf = new Map(
    decisions.map((d) => [unitKey(d.categoryId, d.statutorySubstanceId || null), d]),
  );
  const dropped = new Map(
    rows
      .filter((r) => r.reviewReasons.includes("decisionDropped"))
      .flatMap((r) => {
        const key = unitKey(r.categoryId, r.statutorySubstanceId || null);
        const d = decisionOf.get(key);
        return d ? [[key, d] as const] : [];
      }),
  );
  return buildJudgementDtos(rows, withHits, dropped);
}

/**
 * 判定の行を読む。**根拠を伏せる相手には、根拠（hits）を DB からも引かない。**
 * 引いてから捨てると、開発時のサーバー部品のデバッグ出力など、DTO を通らない経路から
 * 漏れる余地が残る（実際に開発サーバーの応答に含まれていた。2026-09-13）。
 * 「根拠があるか」だけは件数で持ち、`hitsWithheld` に使う
 */
async function loadJudgementRows(
  where: Prisma.ProductJudgementWhereInput,
  withHits: boolean,
): Promise<JudgementRow[]> {
  if (withHits) return prisma.productJudgement.findMany({ where, select: JUDGEMENT_SELECT });
  const rows = await prisma.productJudgement.findMany({
    where,
    select: { ...JUDGEMENT_SELECT, hits: false },
  });
  return rows.map((r) => ({ ...r, hits: [] }));
}

/** 前提が変わって当てはめなかった人の判断（判定の単位ごと） */
type DroppedDecision = {
  verdict: "APPLICABLE" | "NOT_APPLICABLE" | null;
  decidedBy: string;
  decidedAt: Date;
  decidedNote: string | null;
};

/** 保存してある判定の読みかた。その場で計算した判定も同じ形に組み立てて、同じ組み立てを通す */
const JUDGEMENT_SELECT = {
  id: true,
  categoryId: true,
  statutorySubstanceId: true,
  verdict: true,
  source: true,
  systemVerdict: true,
  needsReview: true,
  reviewReasons: true,
  decidedBy: true,
  decidedAt: true,
  decidedNote: true,
  computedAt: true,
  versionId: true,
  judgedAsOf: true,
  effective: true,
  hits: {
    select: { statutorySubstanceId: true, total: true, contributions: true, excluded: true },
  },
  // 根拠を伏せるときも「根拠があるか」は要る（伏せたことを画面に伝えるため）
  _count: { select: { hits: true } },
  category: {
    select: {
      nameJa: true,
      nameEn: true,
      nameOriginal: true,
      displayOrder: true,
      score: true,
      aggregation: true,
      metalEtc: true,
      // 区分ごと効いていないときの印に、区分の期間が要る
      effectiveFrom: true,
      effectiveTo: true,
      law: {
        select: {
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          // 並びは地域 → 国 → 法律。国ごとに1から振ってあるので、国まで見ないと決まらない
          ...LAW_ORDER_SELECT,
          // 国の名前も出す。並びに要る項目は残す
          country: {
            select: {
              code: true,
              nameJa: true,
              nameEn: true,
              displayOrder: true,
              // 地域の名前も出す（国の左の欄）。id は合算表が地域ごとに列をまとめる鍵
              region: {
                select: { id: true, code: true, nameJa: true, nameEn: true, displayOrder: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductJudgementSelect;

export type JudgementRow = Prisma.ProductJudgementGetPayload<{ select: typeof JUDGEMENT_SELECT }>;

/** 法文物質名の名前・番号・適用期間などをまとめて引く */
async function loadSubstanceInfo(ids: string[]) {
  if (ids.length === 0) return new Map<string, SubstanceInfo>();
  const rows = await prisma.statutorySubstance.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      nameJa: true,
      nameOriginal: true,
      officialNumber: true,
      effectiveFrom: true,
      effectiveTo: true,
      aggregation: true,
      metalEtc: true,
      // 要確認の文言に、実際の条文を出すため（2026-09-20 指示）
      applicableCondition: true,
    },
  });
  return new Map(rows.map((s) => [s.id, s]));
}
type SubstanceInfo = Prisma.StatutorySubstanceGetPayload<{
  select: {
    id: true;
    nameJa: true;
    nameOriginal: true;
    officialNumber: true;
    effectiveFrom: true;
    effectiveTo: true;
    aggregation: true;
    metalEtc: true;
    applicableCondition: true;
  };
}>;

/**
 * 判定の行を画面の形に組み立てる。
 * `dropped` は前提が変わって当てはめなかった人の判断（判定の単位ごと）
 */
async function buildJudgementDtos(
  rows: JudgementRow[],
  withHits: boolean,
  dropped: Map<string, DroppedDecision>,
): Promise<ProductJudgementDto[]> {
  // 根拠を伏せる相手には、区分ごとに 1 行にまとめる（法文物質名の名前も根拠のうち）
  const shown = withHits ? rows : foldByCategory(rows);

  // 名前はまとめて引く。1件ずつ引くと、行の数だけ問い合わせが増える
  const substanceIds = withHits
    ? [...new Set(shown.map((r) => r.statutorySubstanceId).filter((v) => v !== ""))]
    : [];
  const actorIds = [
    ...new Set([
      ...shown.map((r) => r.decidedBy).filter((v) => v !== null),
      ...[...dropped.values()].map((d) => d.decidedBy),
    ]),
  ];
  const [infoOf, users, elementNames] = await Promise.all([
    loadSubstanceInfo(substanceIds),
    actorIds.length === 0
      ? []
      : prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, email: true },
        }),
    // 「鉛として」を添えるための元素の名前
    loadElementNames(),
  ]);
  const userOf = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));

  /*
    行ごとのスコアを出すために、寄与しているCASの物質スコアを引く。
    **CAS番号で引く。**判定の根拠はCASで持っており、物質のidは持っていない
  */
  const hitCas = withHits
    ? [
        ...new Set(
          shown.flatMap((r) =>
            r.hits.flatMap((h) =>
              ((h.contributions ?? []) as { cas: string }[]).map((c) => normalizeCas(c.cas)),
            ),
          ),
        ),
      ]
    : [];
  const scored =
    hitCas.length === 0
      ? []
      : await prisma.substance.findMany({
          where: { casNormalized: { in: hitCas }, deletedAt: null },
          select: { casNormalized: true, score: true },
          distinct: ["casNormalized"],
        });
  const scoreOf = new Map(scored.map((x) => [x.casNormalized ?? "", x.score.toString()]));
  // 画面にはランクを出し、スコアは浮かせて見せる（2026-09-15 指示）。段は物質の一覧と同じ対応表
  const bands = withHits && hitCas.length > 0 ? await loadBands() : [];

  return shown
    .map((r) => {
      const info = r.statutorySubstanceId ? infoOf.get(r.statutorySubstanceId) : undefined;
      const mark = effectiveMark(r, info ?? null);
      const inForce = r.effective === "IN_FORCE";
      return {
        id: r.id,
        categoryId: r.categoryId,
        categoryScore: r.category.score.toString(),
        statutorySubstanceId: r.statutorySubstanceId || null,
        statutoryName: info ? (info.nameJa ?? info.nameOriginal) : null,
        officialNumber: info?.officialNumber ?? null,
        applicableCondition: info?.applicableCondition ?? null,
        asElement: info ? asElementOf(elementNames, r.category, info) : null,
        ...mark,
        lawCode: r.category.law.code,
        lawNameJa: r.category.law.nameJa,
        lawNameEn: r.category.law.nameEn,
        lawNameOriginal: r.category.law.nameOriginal,
        regionCode: r.category.law.country.region.code,
        regionNameJa: r.category.law.country.region.nameJa,
        regionNameEn: r.category.law.country.region.nameEn,
        countryCode: r.category.law.country.code,
        countryNameJa: r.category.law.country.nameJa,
        countryNameEn: r.category.law.country.nameEn,
        categoryNameJa: r.category.nameJa,
        categoryNameEn: r.category.nameEn,
        categoryNameOriginal: r.category.nameOriginal,
        // 効いていないものは該当に数えない（施行前・適用終了の非該当）。人の判断もここでは効かない
        verdict: inForce ? r.verdict : "NOT_APPLICABLE",
        source: inForce ? r.source : "SYSTEM",
        systemVerdict: r.systemVerdict,
        needsReview: inForce && r.needsReview,
        reviewReasons: inForce ? r.reviewReasons : [],
        decidedByName: inForce && r.decidedBy ? (userOf.get(r.decidedBy) ?? null) : null,
        decidedAt: inForce ? (r.decidedAt?.toISOString() ?? null) : null,
        decidedNote: inForce ? r.decidedNote : null,
        droppedDecision: inForce
          ? droppedOf(dropped.get(unitKey(r.categoryId, r.statutorySubstanceId || null)), userOf)
          : null,
        computedAt: r.computedAt.toISOString(),
        versionId: r.versionId,
        hits: withHits
          ? r.hits.map((h): JudgementHitDto => {
              const contributions = (h.contributions ?? []) as {
                cas: string;
                pct: string;
                type?: string;
              }[];
              const excluded = (h.excluded ?? []) as {
                cas: string;
                pct: string;
                type: string;
              }[];
              const score = sumScores(
                contributions.map((c) => scoreOf.get(normalizeCas(c.cas)) ?? "0"),
              );
              return {
                name: info ? (info.nameJa ?? info.nameOriginal) : null,
                officialNumber: info?.officialNumber ?? null,
                applicableCondition: info?.applicableCondition ?? null,
                asElement: info ? asElementOf(elementNames, r.category, info) : null,
                contributions,
                excluded,
                total: h.total?.toString() ?? null,
                effective: mark.effective,
                effectiveFrom: mark.effectiveFrom,
                effectiveTo: mark.effectiveTo,
                /*
                  その行を作った物質のスコア。**合算した行は寄与ぶんを足す。**
                  含有率を足して1行にしている以上、スコアも同じ数え方にそろえる
                */
                score,
                scoreRank: rankOf(score, bands),
              };
            })
          : [],
        hitsWithheld: !withHits && r._count.hits > 0,
        // 並びは地域 → 国 → 法律 → 区分 → 法文物質名。画面の法規制と同じ並びにする
        _order: lawOrderKey(r.category.law, r.category.displayOrder),
        _sub: info?.officialNumber ?? "",
      };
    })
    .sort(
      (a, b) =>
        compareLawOrder(a._order, b._order) ||
        // 同じ区分の中は、該当を先に、あとは番号の順
        Number(b.verdict === "APPLICABLE") - Number(a.verdict === "APPLICABLE") ||
        a._sub.localeCompare(b._sub, undefined, { numeric: true }),
    )
    .map(({ _order, _sub, ...rest }) => rest);
}

/**
 * 根拠を伏せる相手向けに、判定の単位の行を区分ごとに 1 行にまとめる。
 * 該当がひとつでもあれば該当、確認が残っていればそのまま、理由は合わせる
 */
function foldByCategory(rows: JudgementRow[]): JudgementRow[] {
  const byCategory = new Map<string, JudgementRow>();
  for (const r of rows) {
    const cur = byCategory.get(r.categoryId);
    if (!cur) {
      byCategory.set(r.categoryId, {
        ...r,
        statutorySubstanceId: "",
        decidedBy: null,
        decidedAt: null,
        decidedNote: null,
      });
      continue;
    }
    const hit = (x: JudgementRow) => x.effective === "IN_FORCE" && x.verdict === "APPLICABLE";
    byCategory.set(r.categoryId, {
      ...cur,
      verdict: hit(cur) || hit(r) ? "APPLICABLE" : "NOT_APPLICABLE",
      // どれか 1 つでも効いていれば、区分としては効いている
      effective:
        cur.effective === "IN_FORCE" || r.effective === "IN_FORCE" ? "IN_FORCE" : cur.effective,
      systemVerdict:
        cur.systemVerdict === "APPLICABLE" || r.systemVerdict === "APPLICABLE"
          ? "APPLICABLE"
          : "NOT_APPLICABLE",
      source: cur.source === "USER" || r.source === "USER" ? "USER" : "SYSTEM",
      needsReview: cur.needsReview || r.needsReview,
      reviewReasons: [...new Set([...cur.reviewReasons, ...r.reviewReasons])],
      computedAt: cur.computedAt > r.computedAt ? cur.computedAt : r.computedAt,
      _count: { hits: cur._count.hits + r._count.hits },
    });
  }
  return [...byCategory.values()];
}

/** 当てはめなかった人の判断を、画面の形にする。無ければ null */
function droppedOf(
  d: DroppedDecision | undefined,
  userOf: Map<string, string>,
): ProductJudgementDto["droppedDecision"] {
  if (!d) return null;
  return {
    verdict: d.verdict,
    decidedByName: userOf.get(d.decidedBy) ?? null,
    decidedAt: d.decidedAt.toISOString(),
    decidedNote: d.decidedNote,
  };
}

/**
 * 「効いているか」の印。判定の行に付けた印（判定対象日で見たもの）をそのまま出し、
 * 効いていないときは、区分ごとなのか法文物質名だけなのかと、その期間を添える。
 * 区分の期間で効いていなければ区分ごと（区分が無効になる日は中の法文物質名も無効。2026-09-22 決定）
 */
function effectiveMark(
  r: {
    judgedAsOf: Date;
    effective: Effective;
    category: { effectiveFrom: Date | null; effectiveTo: Date | null };
  },
  info: { effectiveFrom: Date | null; effectiveTo: Date | null } | null,
): {
  judgedAsOf: string;
  effective: Effective;
  effectiveScope: "category" | "substance" | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
} {
  const judgedAsOf = dayOf(r.judgedAsOf) ?? "";
  if (r.effective === "IN_FORCE") {
    return {
      judgedAsOf,
      effective: "IN_FORCE",
      effectiveScope: null,
      effectiveFrom: null,
      effectiveTo: null,
    };
  }
  const byCategory = effectiveOn(r.category.effectiveFrom, r.category.effectiveTo, judgedAsOf);
  const scope = byCategory !== "IN_FORCE" ? "category" : "substance";
  const src =
    scope === "category" ? r.category : (info ?? { effectiveFrom: null, effectiveTo: null });
  return {
    judgedAsOf,
    effective: r.effective,
    effectiveScope: scope,
    effectiveFrom: dayOf(src.effectiveFrom),
    effectiveTo: dayOf(src.effectiveTo),
  };
}

/** スコアの合計。小数を落とさないよう、文字列のまま足す */
function sumScores(values: string[]): string {
  if (values.length === 0) return "0";
  return fromScaled(sumScaled(values));
}

/**
 * この区分に当たる製品を出す（法規制の画面からの逆引き）。
 *
 * 「この法律に引っかかる製品はどれか」を、製品を1つずつ開かずに知るためのもの。
 * 1 行＝製品 × 判定の単位（法文物質名）。
 *
 * 返すのは2種類だけ。
 *
 *   該当したもの                   … この区分に引っかかる製品（当たった法文物質名ごと）
 *   非該当だが確認が残っているもの … **引っかからないと言い切れていない**製品
 *
 * 2つ目を落とすと、法規制の側から見たときに
 * 「調べたが当たらなかった」ものと「判断できなかった」ものが同じ扱いになる。
 * 換算係数が無い・組成が分からない、といった理由で判断できなかったものこそ
 * 人に見てほしいので、必ず並べる。
 *
 * **これ以外の非該当は返さない。**全製品が並んで、目当てのものが埋もれる。
 *
 * `visibility` には製品一覧と同じ条件を渡すこと。
 * **見えない製品は件数にも入れない。**在ることが分かるだけで
 * 「この会社はこの規制物質を扱っている」と伝わってしまう。
 * 根拠を伏せる相手には、製品ごとに 1 行にまとめる（法文物質名の名前も根拠のうち）
 */
export async function toMatchedProducts(
  categoryId: string,
  visibility: Prisma.ProductWhereInput,
  withHits: boolean,
  /** 現在の法規制バージョン。判定は版ごとにあるので、この版の行だけを見る */
  versionId: string,
): Promise<MatchedProductDto[]> {
  const where = {
    categoryId,
    versionId,
    // 効いていないもの（施行前・適用終了）は該当に数えない。要確認も付かないので並ばない
    OR: [{ verdict: "APPLICABLE" as const, effective: "IN_FORCE" as const }, { needsReview: true }],
    product: { deletedAt: null, ...visibility },
  };
  const select = {
    statutorySubstanceId: true,
    verdict: true,
    source: true,
    needsReview: true,
    reviewReasons: true,
    computedAt: true,
    judgedAsOf: true,
    effective: true,
    product: { select: { id: true, code: true, nameJa: true, nameEn: true, status: true } },
    hits: {
      select: { statutorySubstanceId: true, total: true, contributions: true, excluded: true },
    },
    _count: { select: { hits: true } },
  } satisfies Prisma.ProductJudgementSelect;
  type Row = Prisma.ProductJudgementGetPayload<{ select: typeof select }>;
  // 根拠を伏せる相手には、根拠を DB からも引かない（toJudgementDtos と同じ理由）
  const raw: Row[] = withHits
    ? await prisma.productJudgement.findMany({ where, select })
    : (await prisma.productJudgement.findMany({ where, select: { ...select, hits: false } })).map(
        (r) => ({ ...r, hits: [] }),
      );
  // 伏せる相手には製品ごとに 1 行
  const rows = withHits ? raw : foldByProduct(raw);

  const infoOf = await loadSubstanceInfo(
    withHits ? [...new Set(rows.map((r) => r.statutorySubstanceId).filter((v) => v !== ""))] : [],
  );
  // 「鉛として」を添えるために、区分のまとめかたと元素の名前も引く
  const [category, elementNames] = await Promise.all([
    prisma.regulationCategory.findUniqueOrThrow({
      where: { id: categoryId },
      select: { aggregation: true, metalEtc: true, effectiveFrom: true, effectiveTo: true },
    }),
    loadElementNames(),
  ]);

  return (
    rows
      .map((r) => {
        const info = r.statutorySubstanceId ? infoOf.get(r.statutorySubstanceId) : undefined;
        const mark = effectiveMark({ ...r, category }, info ?? null);
        return {
          productId: r.product.id,
          code: r.product.code,
          nameJa: r.product.nameJa,
          nameEn: r.product.nameEn,
          status: r.product.status,
          statutorySubstanceId: r.statutorySubstanceId || null,
          statutoryName: info ? (info.nameJa ?? info.nameOriginal) : null,
          officialNumber: info?.officialNumber ?? null,
          applicableCondition: info?.applicableCondition ?? null,
          asElement: info ? asElementOf(elementNames, category, info) : null,
          judgedAsOf: mark.judgedAsOf,
          effective: mark.effective,
          effectiveFrom: mark.effectiveFrom,
          effectiveTo: mark.effectiveTo,
          verdict: r.verdict,
          source: r.source,
          needsReview: r.needsReview,
          reviewReasons: r.reviewReasons,
          computedAt: r.computedAt.toISOString(),
          hits: withHits
            ? r.hits.map((h): JudgementHitDto => ({
                name: info ? (info.nameJa ?? info.nameOriginal) : null,
                officialNumber: info?.officialNumber ?? null,
                applicableCondition: info?.applicableCondition ?? null,
                asElement: info ? asElementOf(elementNames, category, info) : null,
                contributions: (h.contributions ?? []) as {
                  cas: string;
                  pct: string;
                  type?: string;
                }[],
                excluded: (h.excluded ?? []) as { cas: string; pct: string; type: string }[],
                total: h.total?.toString() ?? null,
                effective: mark.effective,
                effectiveFrom: mark.effectiveFrom,
                effectiveTo: mark.effectiveTo,
              }))
            : [],
          hitsWithheld: !withHits && r._count.hits > 0,
          _sub: info?.officialNumber ?? "",
        };
      })
      /*
        該当したものを先に並べる。それがこの画面の答えだから。
        判断できなかったものは、そのあとに続ける（付け足しであることが並びで分かる）。
        同じ製品の中は番号の順
      */
      .sort(
        (a, b) =>
          Number(b.verdict === "APPLICABLE") - Number(a.verdict === "APPLICABLE") ||
          a.code.localeCompare(b.code, undefined, { numeric: true }) ||
          a._sub.localeCompare(b._sub, undefined, { numeric: true }),
      )
      .map(({ _sub, ...rest }) => rest)
  );
}

/** 根拠を伏せる相手向けに、判定の単位の行を製品ごとに 1 行にまとめる */
function foldByProduct<
  R extends {
    product: { id: string };
    statutorySubstanceId: string;
    verdict: "APPLICABLE" | "NOT_APPLICABLE";
    source: "SYSTEM" | "USER";
    needsReview: boolean;
    reviewReasons: string[];
    computedAt: Date;
    judgedAsOf: Date;
    effective: Effective;
    _count: { hits: number };
  },
>(rows: R[]): R[] {
  const byProduct = new Map<string, R>();
  for (const r of rows) {
    const cur = byProduct.get(r.product.id);
    if (!cur) {
      byProduct.set(r.product.id, { ...r, statutorySubstanceId: "" });
      continue;
    }
    byProduct.set(r.product.id, {
      ...cur,
      verdict:
        cur.verdict === "APPLICABLE" || r.verdict === "APPLICABLE"
          ? "APPLICABLE"
          : "NOT_APPLICABLE",
      source: cur.source === "USER" || r.source === "USER" ? "USER" : "SYSTEM",
      needsReview: cur.needsReview || r.needsReview,
      reviewReasons: [...new Set([...cur.reviewReasons, ...r.reviewReasons])],
      computedAt: cur.computedAt > r.computedAt ? cur.computedAt : r.computedAt,
      _count: { hits: cur._count.hits + r._count.hits },
    });
  }
  return [...byProduct.values()];
}
