import { normalizeCas, normalizeCode, TEXT_OPERATORS, type TextOperator } from "@chem/shared";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { CompositionCandidateDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 1ページに出す件数（2026-09-18 指示でページ送りにした）。
 *
 * **以前は 50 件で打ち切って、そのことを何も伝えていなかった。**
 * 51件目以降は無いのと同じに見え、表の上の全選択も出ている50件しか選ばない。
 * いまは全体の件数を返し、ページで送る
 */
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

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
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "") || 1);
  const sizeRaw = Number(url.searchParams.get("size") ?? "") || PAGE_SIZE_DEFAULT;
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, sizeRaw));

  // 条件が何も無いときは全件を返さない（選ぶための一覧なので、まず絞ってもらう）
  if (id === "" && cas === "" && name === "") {
    return Response.json({ items: [], total: 0, page: 1, pageSize });
  }

  const common = [
    ...(id === "" ? [] : [{ codeNormalized: { contains: normalizeCode(id) } }]),
    ...(name === "" ? [] : [{ OR: nameWhere(name, nameOp, wideName) }]),
  ];
  const casNormalized = normalizeCas(cas);

  const substanceWhere = {
    deletedAt: null,
    status: "ACTIVE" as const,
    publishState: "PUBLISHED" as const,
    ...(cas === "" ? {} : { casNormalized }),
    AND: common,
  };
  const productWhere = {
    deletedAt: null,
    status: "ACTIVE" as const,
    // 公開されていないものは、まだ他の人に使わせない
    publishState: "PUBLISHED" as const,
    usableAsMaterial: true,
    // 自分自身は原材料にできない（循環になる）
    ...(exclude ? { id: { not: exclude } } : {}),
    // CAS は原材料自身ではなく、その組成に含まれる物質で突き合わせる
    ...(cas === ""
      ? {}
      : { compositionLines: { some: { substance: { casNormalized, deletedAt: null } } } }),
    AND: common,
  };

  /*
    **並びは「物質を全部 → 原材料を全部」、それぞれコード順。**
    2つの表をまたいで1つの並びにすると SQL を1本書くことになるが、
    この画面は選ぶためのものなので、種類ごとにまとまっているほうが探しやすい。
    ページの切り出しは、2つの件数から計算する
  */
  const [substanceTotal, productTotal] = await Promise.all([
    wantSubstance ? prisma.substance.count({ where: substanceWhere }) : Promise.resolve(0),
    wantProduct ? prisma.product.count({ where: productWhere }) : Promise.resolve(0),
  ]);

  const offset = (page - 1) * pageSize;
  const items: CompositionCandidateDto[] = [];

  if (wantSubstance && offset < substanceTotal) {
    const rows = await prisma.substance.findMany({
      where: substanceWhere,
      select: SELECT_SUBSTANCE,
      orderBy: { codeNormalized: "asc" },
      skip: offset,
      take: Math.min(pageSize, substanceTotal - offset),
    });
    items.push(...rows.map((r) => ({ ...r, hasComposition: false, kind: "substance" as const })));
  }

  const rest = pageSize - items.length;
  if (wantProduct && rest > 0) {
    const rows = await prisma.product.findMany({
      where: productWhere,
      select: SELECT_PRODUCT,
      orderBy: { codeNormalized: "asc" },
      // 物質を使い切ったあとの続きから
      skip: Math.max(0, offset - substanceTotal),
      take: rest,
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

  return Response.json({ items, total: substanceTotal + productTotal, page, pageSize });
}
