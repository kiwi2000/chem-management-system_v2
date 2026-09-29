import { jsonError, requirePermission } from "@/lib/authz";
import { aggregateComposition } from "@/lib/composition-aggregate";
import { PRE_REACTION_INCLUDE, canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";
import type { CompositionDiffDto } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 重量% の文字列を数にする（表示用の差なので JS の数で足りる） */
const num = (s: string | null | undefined) =>
  s === null || s === undefined || s === "" ? 0 : Number(s);
const fmt = (n: number) => String(Math.round(n * 1_000_000) / 1_000_000);

/**
 * GET /api/products/[id]/composition/diff — 反応前と反応後の差分（S24 §3）。
 *
 * 反応前（写し）と反応後（登録組成）をそれぞれ末端まで下ろして CAS でまとめ、
 * **消えた・生じた・変わった**物質を並べる。あわせて金属換算係数で元素ごとの量を前後で足し、
 * ずれていれば知らせる（鉛・スズ・クロムなどは反応で増減しないはずなので、ずれは入力の誤りの疑い）。
 * 反応後の組成を入れていない製品では 404
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canViewComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheld);
  }
  if (!product.preReactionAt) return jsonError(404, "not_found", m.errors.notFound);

  const preLines = await prisma.productPreReactionLine.findMany({
    where: { productId: id },
    include: PRE_REACTION_INCLUDE,
    orderBy: { displayOrder: "asc" },
  });
  const [before, after] = await Promise.all([
    aggregateComposition(actor, id, { rootLines: preLines }),
    aggregateComposition(actor, id),
  ]);
  // 同じ CAS（CAS の無い物質は物質コード）× 不純物種別で突き合わせる
  const keyOf = (r: { casNumber: string | null; code: string; impurityTypeId: string }) =>
    `${r.casNumber?.trim().toUpperCase() || `code:${r.code}`}@${r.impurityTypeId}`;
  const beforeBy = new Map(before.rows.map((r) => [keyOf(r), r]));
  const afterBy = new Map(after.rows.map((r) => [keyOf(r), r]));
  const item = (r: (typeof before.rows)[number]) => ({
    casNumber: r.casNumber,
    code: r.code,
    nameJa: r.nameJa,
    nameEn: r.nameEn,
  });
  const removed: CompositionDiffDto["removed"] = [];
  const added: CompositionDiffDto["added"] = [];
  const changed: CompositionDiffDto["changed"] = [];
  for (const [k, r] of beforeBy) {
    const a = afterBy.get(k);
    if (!a) removed.push({ ...item(r), beforePct: r.totalPct });
    else if (num(a.totalPct) !== num(r.totalPct))
      changed.push({
        ...item(r),
        beforePct: r.totalPct,
        afterPct: a.totalPct,
        delta: fmt(num(a.totalPct) - num(r.totalPct)),
      });
  }
  for (const [k, a] of afterBy)
    if (!beforeBy.has(k)) added.push({ ...item(a), afterPct: a.totalPct });
  // 多い順に（消えたものは反応前の、生じたものは反応後の重量%）
  removed.sort((x, y) => num(y.beforePct) - num(x.beforePct));
  added.sort((x, y) => num(y.afterPct) - num(x.afterPct));
  changed.sort((x, y) => Math.abs(num(y.delta)) - Math.abs(num(x.delta)));

  // 元素の照合: 金属換算係数を持つ CAS について、元素ごとに 重量% × 係数 を足す
  const casKeys = [
    ...new Set(
      [...before.rows, ...after.rows].flatMap((r) =>
        r.casNumber ? [r.casNumber.trim().toUpperCase()] : [],
      ),
    ),
  ];
  const factors = casKeys.length
    ? await prisma.metalConversionFactor.findMany({
        where: { casNormalized: { in: casKeys }, deletedAt: null },
        select: { casNormalized: true, metalElement: true, ratioPct: true },
      })
    : [];
  const sumBy = (rows: typeof before.rows) => {
    const out = new Map<string, number>();
    for (const r of rows) {
      const cas = r.casNumber?.trim().toUpperCase();
      if (!cas) continue;
      for (const f of factors) {
        if (f.casNormalized !== cas) continue;
        out.set(
          f.metalElement,
          (out.get(f.metalElement) ?? 0) + (num(r.totalPct) * Number(f.ratioPct)) / 100,
        );
      }
    }
    return out;
  };
  const eb = sumBy(before.rows);
  const ea = sumBy(after.rows);
  const elements: CompositionDiffDto["elements"] = [...new Set([...eb.keys(), ...ea.keys()])]
    .sort()
    .map((el) => {
      const b = eb.get(el) ?? 0;
      const a = ea.get(el) ?? 0;
      // 小数第 4 位（0.0001%）までのずれは丸めの範囲として同じとみなす
      return {
        element: el,
        beforePct: fmt(b),
        afterPct: fmt(a),
        mismatch: Math.abs(a - b) > 0.0001,
      };
    });

  const body: CompositionDiffDto = {
    removed,
    added,
    changed,
    elements,
    blockedBefore: before.blocked.length,
    blockedAfter: after.blocked.length,
  };
  return Response.json(body);
}
