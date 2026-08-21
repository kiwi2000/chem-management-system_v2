import { normalizeCode } from "@chem/shared";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { CompositionElementDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 候補は選ぶためのものなので、多すぎても選べない */
const LIMIT = 20;

const SELECT = { id: true, code: true, nameJa: true, nameEn: true } as const;
/** 物質はCAS番号も返す。原材料は持たないので null を足す */
const SELECT_SUBSTANCE = { ...SELECT, casNumber: true } as const;

/**
 * GET /api/composition/candidates?kind=substance|product&q=...&exclude=<製品ID>
 *
 * 組成に入れられる物質・原材料を、コードか名称の部分一致で探す。
 * 一覧APIは列ごとのフィルター（AND）なので「コードか名称のどちらかに一致」が作れず、
 * 選択用に専用の入口を用意した。返すのはコードと名称だけ。
 *
 * 権限は PRODUCT_EDIT。組成を組む以上、構成要素の名前が見えないと作業にならないため、
 * 物質の閲覧権限とは切り離している（返す情報をコードと名称に絞ることで釣り合いを取る）。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "product" ? "product" : "substance";
  const q = (url.searchParams.get("q") ?? "").trim();
  const exclude = url.searchParams.get("exclude");

  if (q === "") return Response.json({ items: [] });

  // コードは正規化列で、名称はそのまま大文字小文字を無視して突合する
  const byCode = { codeNormalized: { contains: normalizeCode(q) } };
  const byName = [
    { nameJa: { contains: q, mode: "insensitive" as const } },
    { nameEn: { contains: q, mode: "insensitive" as const } },
  ];

  if (kind === "product") {
    const items = await prisma.product.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        // 公開されていないものは、まだ他の人に使わせない
        publishState: "PUBLISHED",
        usableAsMaterial: true,
        // 自分自身は原材料にできない（循環になる）
        ...(exclude ? { id: { not: exclude } } : {}),
        OR: [byCode, ...byName],
      },
      select: SELECT,
      orderBy: { codeNormalized: "asc" },
      take: LIMIT,
    });
    const withoutCas = items.map((i) => ({ ...i, casNumber: null }));
    return Response.json({ items: withoutCas satisfies CompositionElementDto[] });
  }

  const items = await prisma.substance.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      publishState: "PUBLISHED",
      OR: [byCode, ...byName],
    },
    select: SELECT_SUBSTANCE,
    orderBy: { codeNormalized: "asc" },
    take: LIMIT,
  });
  return Response.json({ items: items satisfies CompositionElementDto[] });
}
