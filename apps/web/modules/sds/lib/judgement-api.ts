import { jsonError, type Actor } from "@/lib/authz";
import { canEditComposition, canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";
import { computeProductJudgement, readProductJudgement, withholdIngredients } from "./judgement";

/**
 * 製品の GHS 判定の API（/api/modules/sds/ghs-judgement）。ログイン済みは本体の中継で確かめている。
 *
 *   GET  ghs-judgement?productId=&country=JP … 保存してある判定（無ければ 204）
 *   POST ghs-judgement { productId, country }  … 計算して保存し、結果を返す
 *
 * 結果は製品が見える人に。成分の名前・含有率・根拠は組成を見られる人にだけ（法規制判定と同じ）。
 * 計算できるのは組成を直せる人（判定は組成から決まるため）
 */
export async function judgementApi(
  req: Request,
  path: string[],
  actor: Actor,
): Promise<Response | null> {
  if (path.length !== 1 || path[0] !== "ghs-judgement") return null;
  const m = await getServerMessages();
  const url = new URL(req.url);
  let productId: string | null = null;
  let country = "JP";
  if (req.method === "GET") {
    productId = url.searchParams.get("productId");
    country = url.searchParams.get("country") ?? "JP";
  } else if (req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "invalid_json", m.errors.invalidJson);
    }
    const b = (body ?? {}) as { productId?: unknown; country?: unknown };
    productId = typeof b.productId === "string" ? b.productId : null;
    if (typeof b.country === "string" && b.country) country = b.country;
  } else {
    return null;
  }
  if (!productId || !/^[A-Za-z]{2}$/.test(country)) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  if (!actor.has("PRODUCT_VIEW")) return jsonError(403, "forbidden", m.errors.forbidden);

  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  const full = canViewComposition(actor, product);

  if (req.method === "POST") {
    if (!canEditComposition(actor, product)) {
      return jsonError(403, "forbidden", m.composition.withheldEdit);
    }
    const dto = await computeProductJudgement(actor, productId, country);
    return Response.json({ item: full ? dto : withholdIngredients(dto) });
  }
  const dto = await readProductJudgement(productId, country);
  if (!dto) return Response.json({ item: null });
  return Response.json({ item: full ? dto : withholdIngredients(dto) });
}
