import { jsonError, requirePermission } from "@/lib/authz";
import { canViewComposition } from "@/lib/composition-service";
import { getCurrentVersion } from "@/lib/current-version";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toJudgementDtos, toJudgementDtosAsOf } from "@/lib/judgement-service";
import { visibilityWhere } from "@/lib/product-service";
import { premisesChangedAt } from "@/lib/rejudge-job";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/judgements — その製品の法規制判定。
 *
 * 判定そのものは「製品を見られる」人なら読める。
 * ただし**根拠（何が何％入っていたか）は組成に近い情報**なので、
 * 組成を見られない人には伏せる。伏せたことは画面に伝える
 * （空なのか伏せたのかが分からないと、入っていないと読まれてしまう）。
 */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);

  /*
    `asOf=YYYY-MM-DD` を付けると、**その日に効いている規制でその場で判定し直す**（保存しない）。
    前年度の報告のために 3 月時点で見る、改正に備えて 4 月時点で見る、というときのもの
  */
  const asOf = new URL(req.url).searchParams.get("asOf");
  if (asOf) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`)))
      return jsonError(400, "validation", m.validation.dateFormat);
    const { items, versionCode } = await toJudgementDtosAsOf(
      id,
      asOf,
      canViewComposition(actor, product),
    );
    return Response.json({
      items,
      computedAt: new Date().toISOString(),
      versionCode,
      stale: false,
      asOf,
    });
  }

  /*
    **判定は法規制バージョンごとに持っている。出すのは現在のバージョンの行だけ**（2026-09-12 決定）。
    現在のバージョンを切り替えただけでは計算し直さないので、その版の行がまだ無いことがある。
    そのときは空で返し、「この版の判定はまだ無い」と画面で伝える
    （前の版の結果を出すと、その版の結果のように読まれてしまう。実際に起きた）
  */
  const current = await getCurrentVersion();
  const items = current
    ? await toJudgementDtos(id, canViewComposition(actor, product), current.id)
    : [];

  /*
    **いつ・どの前提で出した判定か**を添える。
    法規制側のデータを変えても判定は自動でやり直されないので、
    計算日時より後に前提が変わっていれば「古い可能性がある」と画面で伝える
  */
  const computedAt = items.reduce<string | null>(
    (acc, j) => (acc === null || j.computedAt > acc ? j.computedAt : acc),
    null,
  );
  const changedAt = current ? await premisesChangedAt(current.id) : null;
  const stale =
    items.length > 0 &&
    computedAt !== null &&
    changedAt !== null &&
    changedAt.toISOString() > computedAt;
  // この版の判定は無いが、別の版では判定してある（＝切り替えたまま判定し直していない）
  const judgedElsewhere =
    items.length === 0 &&
    (await prisma.productJudgement.findFirst({
      where: { productId: id },
      select: { id: true },
    })) !== null;

  return Response.json({
    items,
    computedAt,
    versionCode: current?.code ?? null,
    stale,
    judgedElsewhere,
  });
}
