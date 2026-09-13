import { fromScaled, normalizeCas, sumScaled } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { asElementOf, loadElementNames } from "@/lib/as-element";
import { prisma } from "@/lib/db";
import { computeJudgements, loadFactors, loadRules } from "@/lib/judge-store";
import { LAW_ORDER_SELECT, compareLawOrder, lawOrderKey } from "@/lib/law-order";
import { getAppSettings } from "@/lib/settings";
import type { MatchedProductDto, ProductJudgementDto } from "@/lib/types";

/**
 * 判定結果を、画面に出せる形に組み立てる。
 *
 * 法律名・区分名・物質名は判定の行に持っていない
 * （二重に持つと必ず食い違うため）。ここで引いて足す。
 */

/**
 * その製品の判定を、法律・区分の並び順で返す。**その法規制バージョンの行だけ。**
 * 判定は版ごとに持っているので、絞らないと前の版の結果が混ざる
 *
 * `withHits` が false のときは根拠を伏せる。組成を見られない人に
 * 「何が何％入っているか」を渡すことになるため。
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
        verdict: true,
        decidedBy: true,
        decidedAt: true,
        decidedNote: true,
      },
    }),
  ]);
  const dropped = new Map(
    rows
      .filter((r) => r.reviewReasons.includes("decisionDropped"))
      .flatMap((r) => {
        const d = decisions.find((x) => x.categoryId === r.categoryId);
        return d ? [[r.categoryId, d] as const] : [];
      }),
  );
  return buildJudgementDtos(rows, withHits, todayInJapan(), dropped);
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

/** 前提が変わって当てはめなかった人の判断（区分ごと） */
type DroppedDecision = {
  verdict: "APPLICABLE" | "NOT_APPLICABLE" | null;
  decidedBy: string;
  decidedAt: Date;
  decidedNote: string | null;
};

/** 保存してある判定の読みかた。その場で計算した判定も同じ形に組み立てて、同じ組み立てを通す */
const JUDGEMENT_SELECT = {
  categoryId: true,
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
  hits: { select: { statutorySubstanceId: true, total: true, contributions: true } },
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
              // 地域の名前も出す（国の左の欄）
              region: { select: { code: true, nameJa: true, nameEn: true, displayOrder: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductJudgementSelect;

type JudgementRow = Prisma.ProductJudgementGetPayload<{ select: typeof JUDGEMENT_SELECT }>;

/**
 * 判定対象日を指定して、その場で判定する。**保持しない。**
 * その日に効いている区分と法文物質名（適用開始日・適用終了日で絞る）だけで、
 * 現在のバージョンの CAS リンクを使って計算する。「施行前」の印もその日で見る。
 * 前年度の報告のために 3 月時点で見たい、来年度の改正に備えて 4 月時点で見たい、というときのもの
 */
export async function toJudgementDtosAsOf(
  productId: string,
  asOf: string,
  withHits: boolean,
): Promise<{ items: ProductJudgementDto[]; versionCode: string | null }> {
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) return { items: [], versionCode: null };
  const [rules, factors, settings] = await Promise.all([
    loadRules(version.id, asOf),
    loadFactors(),
    getAppSettings(),
  ]);
  const results = await computeJudgements(productId, rules, factors, settings.conditionalLinkMode);
  const categories = await prisma.regulationCategory.findMany({
    where: { id: { in: results.map((r) => r.rule.categoryId) } },
    select: { id: true, ...JUDGEMENT_SELECT.category.select },
  });
  const categoryOf = new Map(categories.map((c) => [c.id, c]));
  const now = new Date();
  const rows: JudgementRow[] = results.flatMap(({ rule, result }) => {
    const found = categoryOf.get(rule.categoryId);
    if (!found) return [];
    const { id: _id, ...category } = found;
    return [
      {
        categoryId: rule.categoryId,
        verdict: result.verdict,
        source: "SYSTEM" as const,
        systemVerdict: result.verdict,
        needsReview: result.needsReview,
        reviewReasons: result.reasons,
        decidedBy: null,
        decidedAt: null,
        decidedNote: null,
        computedAt: now,
        versionId: version.id,
        hits: result.hits.map((h) => ({
          statutorySubstanceId: h.statutorySubstanceId,
          total: h.total === null ? null : new Prisma.Decimal(h.total),
          contributions: h.contributions,
        })),
        _count: { hits: result.hits.length },
        category,
      },
    ];
  });
  return {
    items: await buildJudgementDtos(rows, withHits, asOf, new Map()),
    versionCode: version.code,
  };
}

/**
 * 判定の行を画面の形に組み立てる。`today` は「施行前」を決める日
 * （保存してある判定なら今日、判定対象日を指定した判定ならその日）。
 * `dropped` は前提が変わって当てはめなかった人の判断（区分ごと）
 */
async function buildJudgementDtos(
  rows: JudgementRow[],
  withHits: boolean,
  today: string,
  dropped: Map<string, DroppedDecision>,
): Promise<ProductJudgementDto[]> {
  // 名前はまとめて引く。1件ずつ引くと、区分の数だけ問い合わせが増える
  const substanceIds = withHits
    ? [
        ...new Set(
          rows.flatMap((r) => r.hits.map((h) => h.statutorySubstanceId).filter((v) => v !== null)),
        ),
      ]
    : [];
  const actorIds = [
    ...new Set([
      ...rows.map((r) => r.decidedBy).filter((v) => v !== null),
      ...[...dropped.values()].map((d) => d.decidedBy),
    ]),
  ];
  const [substances, users, elementNames] = await Promise.all([
    substanceIds.length === 0
      ? []
      : prisma.statutorySubstance.findMany({
          where: { id: { in: substanceIds } },
          select: {
            id: true,
            nameJa: true,
            nameOriginal: true,
            officialNumber: true,
            effectiveFrom: true,
            aggregation: true,
            metalEtc: true,
          },
        }),
    actorIds.length === 0
      ? []
      : prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, email: true },
        }),
    // 「鉛として」を添えるための元素の名前
    loadElementNames(),
  ]);
  const infoOf = new Map(substances.map((s) => [s.id, s]));
  const userOf = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));

  /*
    行ごとのスコアを出すために、寄与しているCASの物質スコアを引く。
    **CAS番号で引く。**判定の根拠はCASで持っており、物質のidは持っていない
  */
  const hitCas = withHits
    ? [
        ...new Set(
          rows.flatMap((r) =>
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

  return rows
    .map((r) => ({
      categoryId: r.categoryId,
      categoryScore: r.category.score.toString(),
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
      verdict: r.verdict,
      source: r.source,
      systemVerdict: r.systemVerdict,
      needsReview: r.needsReview,
      reviewReasons: r.reviewReasons,
      decidedByName: r.decidedBy ? (userOf.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedNote: r.decidedNote,
      droppedDecision: droppedOf(dropped.get(r.categoryId), userOf),
      computedAt: r.computedAt.toISOString(),
      versionId: r.versionId,
      hits: withHits
        ? r.hits
            .map((h) => {
              // 区分そのものが当たったときは、指す法文物質名が無い
              const info = h.statutorySubstanceId ? infoOf.get(h.statutorySubstanceId) : undefined;
              const contributions = (h.contributions ?? []) as { cas: string; pct: string }[];
              return {
                name: info ? (info.nameJa ?? info.nameOriginal) : null,
                officialNumber: info?.officialNumber ?? null,
                asElement: info ? asElementOf(elementNames, r.category, info) : null,
                contributions,
                total: h.total?.toString() ?? null,
                ...effectiveMark(info?.effectiveFrom ?? null, today),
                /*
                  その行を作った物質のスコア。**合算した行は寄与ぶんを足す。**
                  含有率を足して1行にしている以上、スコアも同じ数え方にそろえる
                */
                score: sumScores(contributions.map((c) => scoreOf.get(normalizeCas(c.cas)) ?? "0")),
              };
            })
            // 多いものから。まず何が効いているかを見たい
            .sort((a, b) => maxPct(b) - maxPct(a))
        : [],
      hitsWithheld: !withHits && r._count.hits > 0,
      // 並びは地域 → 国 → 法律 → 区分。画面の法規制と同じ並びにする
      _order: lawOrderKey(r.category.law, r.category.displayOrder),
    }))
    .sort((a, b) => compareLawOrder(a._order, b._order))
    .map(({ _order, ...rest }) => rest);
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
 * 今日の日付（YYYY-MM-DD）。**日本の日付で決める。**
 * サーバーの時計が UTC でも、施行日の朝に「施行前」と出さないため
 */
function todayInJapan(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

/**
 * 適用開始日と「施行前」の印。適用開始日は日付だけの列（時刻なし、UTC の 0 時）なので
 * ISO 文字列の日付部分がそのまま登録した日付になる
 */
function effectiveMark(
  effectiveFrom: Date | null,
  today: string,
): { effectiveFrom: string | null; notYetEffective: boolean } {
  const from = effectiveFrom ? effectiveFrom.toISOString().slice(0, 10) : null;
  return { effectiveFrom: from, notYetEffective: from !== null && from > today };
}

/** スコアの合計。小数を落とさないよう、文字列のまま足す */
function sumScores(values: string[]): string {
  if (values.length === 0) return "0";
  return fromScaled(sumScaled(values));
}

/** 並べ替えに使う代表値。合計が無いときは、いちばん大きい寄与を見る */
function maxPct(h: { total: string | null; contributions: { pct: string }[] }): number {
  if (h.total !== null) return Number(h.total);
  return Math.max(0, ...h.contributions.map((c) => Number(c.pct)));
}

/**
 * この区分に当たる製品を出す（法規制の画面からの逆引き）。
 *
 * 「この法律に引っかかる製品はどれか」を、製品を1つずつ開かずに知るためのもの。
 *
 * 返すのは2種類だけ。
 *
 *   該当したもの                   … この区分に引っかかる製品
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
    OR: [{ verdict: "APPLICABLE" as const }, { needsReview: true }],
    product: { deletedAt: null, ...visibility },
  };
  const select = {
    verdict: true,
    source: true,
    needsReview: true,
    reviewReasons: true,
    computedAt: true,
    product: { select: { id: true, code: true, nameJa: true, nameEn: true, status: true } },
    hits: { select: { statutorySubstanceId: true, total: true, contributions: true } },
    _count: { select: { hits: true } },
  } satisfies Prisma.ProductJudgementSelect;
  // 根拠を伏せる相手には、根拠を DB からも引かない（toJudgementDtos と同じ理由）
  const rows: Prisma.ProductJudgementGetPayload<{ select: typeof select }>[] = withHits
    ? await prisma.productJudgement.findMany({ where, select })
    : (await prisma.productJudgement.findMany({ where, select: { ...select, hits: false } })).map(
        (r) => ({ ...r, hits: [] }),
      );

  const substanceIds = withHits
    ? [
        ...new Set(
          rows.flatMap((r) => r.hits.map((h) => h.statutorySubstanceId).filter((v) => v !== null)),
        ),
      ]
    : [];
  const substances =
    substanceIds.length === 0
      ? []
      : await prisma.statutorySubstance.findMany({
          where: { id: { in: substanceIds } },
          select: {
            id: true,
            nameJa: true,
            nameOriginal: true,
            officialNumber: true,
            effectiveFrom: true,
            aggregation: true,
            metalEtc: true,
          },
        });
  const infoOf = new Map(substances.map((s) => [s.id, s]));
  const today = todayInJapan();
  // 「鉛として」を添えるために、区分のまとめかたと元素の名前も引く
  const [category, elementNames] = await Promise.all([
    prisma.regulationCategory.findUniqueOrThrow({
      where: { id: categoryId },
      select: { aggregation: true, metalEtc: true },
    }),
    loadElementNames(),
  ]);

  return (
    rows
      .map((r) => ({
        productId: r.product.id,
        code: r.product.code,
        nameJa: r.product.nameJa,
        nameEn: r.product.nameEn,
        status: r.product.status,
        verdict: r.verdict,
        source: r.source,
        needsReview: r.needsReview,
        reviewReasons: r.reviewReasons,
        computedAt: r.computedAt.toISOString(),
        hits: withHits
          ? r.hits
              .map((h) => {
                const info = h.statutorySubstanceId
                  ? infoOf.get(h.statutorySubstanceId)
                  : undefined;
                return {
                  name: info ? (info.nameJa ?? info.nameOriginal) : null,
                  officialNumber: info?.officialNumber ?? null,
                  asElement: info ? asElementOf(elementNames, category, info) : null,
                  contributions: (h.contributions ?? []) as { cas: string; pct: string }[],
                  total: h.total?.toString() ?? null,
                  ...effectiveMark(info?.effectiveFrom ?? null, today),
                };
              })
              .sort((a, b) => maxPct(b) - maxPct(a))
          : [],
        hitsWithheld: !withHits && r._count.hits > 0,
      }))
      /*
        該当したものを先に並べる。それがこの画面の答えだから。
        判断できなかったものは、そのあとに続ける（付け足しであることが並びで分かる）。
      */
      .sort(
        (a, b) =>
          Number(b.verdict === "APPLICABLE") - Number(a.verdict === "APPLICABLE") ||
          a.code.localeCompare(b.code, undefined, { numeric: true }),
      )
  );
}
