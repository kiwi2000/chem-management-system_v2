import { normalizeCas, normalizeCode, TEXT_OPERATORS, type TextOperator } from "@chem/shared";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { CompositionCandidateDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 候補は選ぶためのものなので、多すぎても選べない */
const LIMIT = 50;

const SELECT = { id: true, code: true, nameJa: true, nameEn: true } as const;
/** 物質はCAS番号も返す。原材料は持たないので null を足す */
const SELECT_SUBSTANCE = { ...SELECT, casNumber: true } as const;
/** 原材料は、中身を持っているかも返す（足した行に展開の印を出すため） */
const SELECT_PRODUCT = {
  ...SELECT,
  _count: { select: { compositionLines: true } },
} as const;

/**
 * 名称の突合。前方・後方・完全は Prisma の演算子にそのまま対応する。
 * 探す範囲は2つ。既定は主名称の日本語だけで、広げると英語名と別名も見る。
 * 別名まで含めると件数が増えて絞りにくくなるので、既定は狭いほうにしてある。
 */
function nameWhere(name: string, op: TextOperator, wide: boolean) {
  const mode = "insensitive" as const;
  const cond =
    op === "startsWith"
      ? { startsWith: name, mode }
      : op === "endsWith"
        ? { endsWith: name, mode }
        : op === "equals"
          ? { equals: name, mode }
          : { contains: name, mode };
  if (!wide) return [{ nameJa: cond }];
  return [
    { nameJa: cond },
    { nameEn: cond },
    // 別名は子テーブル。1件でも当たれば該当とする
    { aliases: { some: { OR: [{ nameJa: cond }, { nameEn: cond }] } } },
  ];
}

/**
 * GET /api/composition/candidates
 *   ?id=...&cas=...&name=...&nameOp=contains|startsWith|endsWith|equals
 *   &substance=1&product=1&exclude=<製品ID>
 *
 * 組成に入れられる物質・原材料を探す。指定した条件はすべて満たすもの（AND）。
 *
 * CAS を指定したときの扱いが物質と原材料で違う。
 * 物質はそれ自身の CAS で突き合わせるが、原材料は CAS を持たないので、
 * 「その CAS を組成に含む製品」を対象にする。目的の物質が入っている原材料を
 * 探したい、という使い方に合わせたもの。
 *
 * 権限は PRODUCT_EDIT。組成を組む以上、構成要素の名前が見えないと作業にならないため、
 * 物質の閲覧権限とは切り離している（返す情報をコードと名称に絞ることで釣り合いを取る）。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  const cas = (url.searchParams.get("cas") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim();
  const rawOp = url.searchParams.get("nameOp") ?? "contains";
  const nameOp: TextOperator = (TEXT_OPERATORS as readonly string[]).includes(rawOp)
    ? (rawOp as TextOperator)
    : "contains";
  // 名称を探す範囲。all は英語名と別名も見る
  const wideName = url.searchParams.get("nameScope") === "all";
  const wantSubstance = url.searchParams.get("substance") !== "0";
  const wantProduct = url.searchParams.get("product") !== "0";
  const exclude = url.searchParams.get("exclude");

  // 条件が何も無いときは全件を返さない（選ぶための一覧なので、まず絞ってもらう）
  if (id === "" && cas === "" && name === "") return Response.json({ items: [] });

  const common = [
    ...(id === "" ? [] : [{ codeNormalized: { contains: normalizeCode(id) } }]),
    ...(name === "" ? [] : [{ OR: nameWhere(name, nameOp, wideName) }]),
  ];
  const casNormalized = normalizeCas(cas);

  const items: CompositionCandidateDto[] = [];

  if (wantSubstance) {
    const rows = await prisma.substance.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        publishState: "PUBLISHED",
        ...(cas === "" ? {} : { casNormalized }),
        AND: common,
      },
      select: SELECT_SUBSTANCE,
      orderBy: { codeNormalized: "asc" },
      take: LIMIT,
    });
    items.push(...rows.map((r) => ({ ...r, hasComposition: false, kind: "substance" as const })));
  }

  if (wantProduct) {
    const rows = await prisma.product.findMany({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        // 公開されていないものは、まだ他の人に使わせない
        publishState: "PUBLISHED",
        usableAsMaterial: true,
        // 自分自身は原材料にできない（循環になる）
        ...(exclude ? { id: { not: exclude } } : {}),
        // CAS は原材料自身ではなく、その組成に含まれる物質で突き合わせる
        ...(cas === ""
          ? {}
          : { compositionLines: { some: { substance: { casNormalized, deletedAt: null } } } }),
        AND: common,
      },
      select: SELECT_PRODUCT,
      orderBy: { codeNormalized: "asc" },
      take: LIMIT,
    });
    items.push(
      ...rows.map(({ _count, ...r }) => ({
        ...r,
        casNumber: null,
        hasComposition: _count.compositionLines > 0,
        kind: "product" as const,
      })),
    );
  }

  return Response.json({ items });
}
