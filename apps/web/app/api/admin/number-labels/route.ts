import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import type { NumberLabelDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 物質の詳細に「各種番号」として出す一覧の設定。
 *
 * 官報公示整理番号や政令番号は、**その法令の名簿が振っている番号**であって
 * 物質そのものの属性ではない。だから物質側には持たず、区分に呼び名を入れておき、
 * CASリンクをたどって出す（決定 0008、`apps/web/lib/substance-numbers.ts`）。
 *
 * **呼び名を入れた区分だけが出る。**
 * どの区分にも番号は入っているので、全部出すと1物質で20行を超え、
 * 本当に引きたい番号が埋もれる。ここで出すものを選ぶ。
 */

/** GET /api/admin/number-labels — 区分の一覧と、いまの設定 */
export async function GET() {
  const actor = await requirePermission("ADMIN");
  if (actor instanceof Response) return actor;

  const categories = await prisma.regulationCategory.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      nameJa: true,
      nameEn: true,
      nameOriginal: true,
      numberLabel: true,
      displayOrder: true,
      law: {
        select: {
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          displayOrder: true,
          country: { select: { nameJa: true, nameEn: true } },
        },
      },
      classes: {
        select: {
          statutorySubstances: {
            where: { deletedAt: null, officialNumber: { not: null } },
            select: { officialNumber: true },
            // 何が入っているのか分かれば選べる。全部は要らない
            take: 3,
            orderBy: { displayOrder: "asc" },
          },
          _count: {
            select: {
              statutorySubstances: { where: { deletedAt: null, officialNumber: { not: null } } },
            },
          },
        },
      },
    },
    orderBy: [{ law: { displayOrder: "asc" } }, { displayOrder: "asc" }],
  });

  const items: NumberLabelDto[] = categories.map((c) => ({
    categoryId: c.id,
    lawNameJa: c.law.nameJa,
    lawNameEn: c.law.nameEn,
    lawNameOriginal: c.law.nameOriginal,
    countryNameJa: c.law.country.nameJa,
    countryNameEn: c.law.country.nameEn,
    categoryNameJa: c.nameJa,
    categoryNameEn: c.nameEn,
    categoryNameOriginal: c.nameOriginal,
    numberLabel: c.numberLabel,
    numberCount: c.classes.reduce((n, cl) => n + cl._count.statutorySubstances, 0),
    samples: c.classes
      .flatMap((cl) => cl.statutorySubstances.map((s) => s.officialNumber))
      .filter((v) => v !== null)
      .slice(0, 3),
  }));

  return Response.json({ items });
}

/**
 * PUT /api/admin/number-labels — 呼び名をまとめて保存する。
 *
 * 空文字は「出さない」の意味なので null にして持つ
 * （空文字のまま持つと、見出しが空の行が画面に並ぶ）。
 */
export async function PUT(req: Request) {
  const actor = await requirePermission("ADMIN");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const items = (body as { items?: { categoryId?: unknown; numberLabel?: unknown }[] })?.items;
  if (!Array.isArray(items)) return jsonError(400, "validation_error", m.errors.validation);

  const changes: { id: string; numberLabel: string | null }[] = [];
  for (const it of items) {
    if (typeof it?.categoryId !== "string") {
      return jsonError(400, "validation_error", m.errors.validation);
    }
    const raw = typeof it.numberLabel === "string" ? it.numberLabel.trim() : "";
    if (raw.length > 100) return jsonError(400, "validation_error", m.errors.validation);
    changes.push({ id: it.categoryId, numberLabel: raw === "" ? null : raw });
  }

  await prisma.$transaction(
    changes.map((c) =>
      prisma.regulationCategory.update({
        where: { id: c.id },
        data: { numberLabel: c.numberLabel, updatedBy: actor.user.id },
      }),
    ),
  );

  return Response.json({ saved: changes.length });
}
