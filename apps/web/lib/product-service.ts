import { normalizeCode, type ProductInput, type PublishState } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { propertyWrites } from "@/lib/property-values";
import type { ProductDetailDto, ProductListItemDto } from "@/lib/types";

/**
 * 一覧に出す判定の引きかた。
 *
 * 判定は区分ごと・**法規制バージョンごと**に1行ずつある（当たらなかった区分も残る）。
 * 一覧に出すのは「いくつ当たったか」と「確認が残っているか」の2つだけなので、
 * その2つを出せる最小限の項目を、**現在のバージョンの行だけ**から引く。
 * 根拠（どのCASがいくら効いたか）は組成に近い情報なので、一覧には持ち出さない。
 * 版が無ければ何も引かない（判定のしようがない）
 */
function judgementsInclude(versionId: string | null) {
  return {
    where: { versionId: versionId ?? "" },
    select: { categoryId: true, verdict: true, needsReview: true, effective: true },
  } satisfies Prisma.Product$judgementsArgs;
}

/** 一覧に必要な関連（別名は件数だけ使う） */
export function productListInclude(versionId: string | null) {
  return {
    _count: { select: { aliases: true } },
    uses: { orderBy: { displayOrder: "asc" } },
    judgements: judgementsInclude(versionId),
    // 判定の行が 0 件でも「判定済み」と分かるように、最後に判定した版を見る
    expansion: { select: { judgedVersionId: true } },
  } satisfies Prisma.ProductInclude;
}

/** 詳細取得で必要になる関連 */
export function productInclude(versionId: string | null) {
  return {
    _count: { select: { aliases: true } },
    uses: { orderBy: { displayOrder: "asc" } },
    aliases: { orderBy: { displayOrder: "asc" } },
    properties: { include: { def: true } },
    // 一覧と同じ項目を作るために要る（詳細の判定表は別途 judgement-service が引く）
    judgements: judgementsInclude(versionId),
    expansion: { select: { judgedVersionId: true } },
  } satisfies Prisma.ProductInclude;
}

type ProductListRow = Prisma.ProductGetPayload<{
  include: ReturnType<typeof productListInclude>;
}>;
type ProductWithRelations = Prisma.ProductGetPayload<{
  include: ReturnType<typeof productInclude>;
}>;

/**
 * 一覧・詳細に出してよい製品の条件。
 *
 * 無効（廃番）と未公開のものは、作成者と `INACTIVE_VIEW` を持つ人にだけ見せる。
 * 一覧・件数・詳細のすべてに同じ条件を掛けること
 * （詳細は 403 ではなく 404。403 だと「その ID の製品は在る」と分かってしまうため）。
 *
 * 組成の構成要素として名前を出す場面には掛けない。掛けると、無効な原材料を含む
 * 親製品の組成が読めなくなるため（S9 で決定）。
 */
export function visibilityWhere(actor: Actor): Prisma.ProductWhereInput {
  if (actor.has("INACTIVE_VIEW")) return {};
  return {
    OR: [{ status: "ACTIVE", publishState: "PUBLISHED" }, { createdBy: actor.user.id }],
  };
}

/** 公開済のものだけを見せる条件（一覧の上の表・組成の候補） */
export const publishedWhere: Prisma.ProductWhereInput = {
  publishState: "PUBLISHED",
};

/** 書き換えてよいか。見えるだけでは足りず、無効・未公開は専用の権限が要る */
export function canEditProduct(
  actor: Actor,
  target: { status: string; publishState: PublishState; createdBy: string | null },
): boolean {
  if (!actor.has("PRODUCT_EDIT")) return false;
  // 承認待は誰も書き換えられない。直すなら取り下げてから
  if (target.publishState === "PENDING") return false;
  const restricted = target.status !== "ACTIVE" || target.publishState !== "PUBLISHED";
  if (!restricted) return true;
  return actor.has("INACTIVE_EDIT") || target.createdBy === actor.user.id;
}

export function toListItem(p: ProductListRow, versionId: string | null): ProductListItemDto {
  return {
    id: p.id,
    code: p.code,
    nameJa: p.nameJa,
    nameEn: p.nameEn,
    status: p.status,
    note: p.note,
    aliasCount: p._count.aliases,
    publishState: p.publishState,
    usableAsMaterial: p.usableAsMaterial,
    modelValue: p.modelValue,
    uses: p.uses.map((u) => u.value),
    updatedAt: p.updatedAt.toISOString(),
    // この版で判定したか（判定の行が 0 件でも判定済みのことがある。「該当なし」とは別）
    judged: versionId !== null && p.expansion?.judgedVersionId === versionId,
    // 当たった区分の数（同じ区分に法文物質名が何件当たっても 1 と数える。2026-09-15 決定）
    // 施行前・適用終了のものは該当に数えない（2026-09-22 決定）
    hitCount: new Set(
      p.judgements
        .filter((j) => j.verdict === "APPLICABLE" && j.effective === "IN_FORCE")
        .map((j) => j.categoryId),
    ).size,
    needsReview: p.judgements.some((j) => j.needsReview),
  };
}

export function toDetail(p: ProductWithRelations, versionId: string | null): ProductDetailDto {
  return {
    ...toListItem(p, versionId),
    aliases: p.aliases.map((a) => ({ nameJa: a.nameJa, nameEn: a.nameEn })),
    properties: p.properties.map((v) => ({
      propertyDefId: v.propertyDefId,
      valueText: v.valueText,
      valueNum: v.valueNum?.toString() ?? null,
      unit: v.unit,
    })),
  };
}

/**
 * 入力から DB に書く値へ。正規化はここに集約する。
 * コードはユーザーが決める業務キーなので原文（大小文字）を残し、突合は正規化列で行う。
 */
export function normalizeInput(input: ProductInput) {
  return {
    code: input.code.trim(),
    codeNormalized: normalizeCode(input.code),
    nameJa: input.nameJa.trim(),
    nameEn: input.nameEn?.trim() || null,
    status: input.status,
    note: input.note?.trim() || null,
    usableAsMaterial: input.usableAsMaterial,
    modelValue: input.modelValue?.trim() || null,
  };
}

/** 別名・拡張属性は入れ替え方式（差分を追うより単純で事故が少ない） */
export function childWrites(input: ProductInput) {
  return {
    aliases: input.aliases.map((a, i) => ({
      nameJa: a.nameJa?.trim() || null,
      nameEn: a.nameEn?.trim() || null,
      displayOrder: i + 1,
    })),
    uses: input.uses.map((value, i) => ({ value: value.trim(), displayOrder: i + 1 })),
    properties: propertyWrites(input.properties),
  };
}
