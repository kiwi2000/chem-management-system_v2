import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import type { NumberLabelChoiceDto, NumberLabelDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 物質の詳細に「各種番号」として出す番号の設定。
 *
 * ここに並べるのは**インベントリ番号**——その国の名簿が物質に振っている番号。
 * 日本なら化審法番号・安衛法番号、EU なら EC番号、米国なら TSCA の番号。
 * 物質そのものの属性ではないので物質側には持たず、区分に呼び名を入れておき、
 * CASリンクをたどって出す（決定 0008、`apps/web/lib/substance-numbers.ts`）。
 *
 * **数は少ない。**規制区分は29件あるが、番号として引きたいのはその一部だけ。
 * だから全部を並べて選ばせるのではなく、**選んで1件ずつ足す**形にしてある。
 */

/** 番号が入っている法文物質名の数と、その例を数える */
const COUNT_SELECT = {
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
} as const;

type CountRow = {
  classes: {
    statutorySubstances: { officialNumber: string | null }[];
    _count: { statutorySubstances: number };
  }[];
};

const numberCount = (c: CountRow) =>
  c.classes.reduce((n, cl) => n + cl._count.statutorySubstances, 0);
const samplesOf = (c: CountRow) =>
  c.classes
    .flatMap((cl) => cl.statutorySubstances.map((s) => s.officialNumber))
    .filter((v) => v !== null)
    .slice(0, 3);

/**
 * GET /api/admin/number-labels
 *
 * `items` … いま出している番号。並べた順に返す
 * `choices` … 足せる区分。**番号が1件も入っていない区分は返さない**
 *   （選んでも何も出ないものを選ばせない）
 */
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
      numberOrder: true,
      displayOrder: true,
      law: {
        select: {
          id: true,
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          displayOrder: true,
          country: { select: { nameJa: true, nameEn: true } },
        },
      },
      ...COUNT_SELECT,
    },
    orderBy: [{ law: { displayOrder: "asc" } }, { displayOrder: "asc" }],
  });

  const items: NumberLabelDto[] = categories
    .filter((c) => c.numberLabel !== null)
    .sort((a, b) => a.numberOrder - b.numberOrder)
    .map((c) => ({
      categoryId: c.id,
      lawNameJa: c.law.nameJa,
      lawNameEn: c.law.nameEn,
      lawNameOriginal: c.law.nameOriginal,
      countryNameJa: c.law.country.nameJa,
      countryNameEn: c.law.country.nameEn,
      categoryNameJa: c.nameJa,
      categoryNameEn: c.nameEn,
      categoryNameOriginal: c.nameOriginal,
      numberLabel: c.numberLabel as string,
      numberCount: numberCount(c),
      samples: samplesOf(c),
    }));

  const chosen = new Set(items.map((i) => i.categoryId));
  const choices: NumberLabelChoiceDto[] = categories
    .filter((c) => !chosen.has(c.id) && numberCount(c) > 0)
    .map((c) => ({
      categoryId: c.id,
      lawId: c.law.id,
      lawNameJa: c.law.nameJa,
      lawNameEn: c.law.nameEn,
      lawNameOriginal: c.law.nameOriginal,
      countryNameJa: c.law.country.nameJa,
      countryNameEn: c.law.country.nameEn,
      categoryNameJa: c.nameJa,
      categoryNameEn: c.nameEn,
      categoryNameOriginal: c.nameOriginal,
      numberCount: numberCount(c),
      samples: samplesOf(c),
    }));

  return Response.json({ items, choices });
}

/**
 * PUT /api/admin/number-labels — 並べた通りに保存する。
 *
 * 送られてきた並びがそのまま順番になる。
 * **送られてこなかった区分は「出さない」に戻す。**
 * 消したものを消えたままにするには、それしかない
 * （消した区分だけを別に送らせると、送り漏れで残り続ける）。
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

  const kept: { id: string; numberLabel: string; numberOrder: number }[] = [];
  for (const [i, it] of items.entries()) {
    if (typeof it?.categoryId !== "string") {
      return jsonError(400, "validation_error", m.errors.validation);
    }
    const label = typeof it.numberLabel === "string" ? it.numberLabel.trim() : "";
    // 呼び名が空だと、物質の画面で見出しの無い番号が並ぶ。空では受け取らない
    if (label === "" || label.length > 100) {
      return jsonError(400, "validation_error", m.errors.validation);
    }
    kept.push({ id: it.categoryId, numberLabel: label, numberOrder: i });
  }

  const keptIds = kept.map((k) => k.id);
  await prisma.$transaction([
    prisma.regulationCategory.updateMany({
      where: { numberLabel: { not: null }, id: { notIn: keptIds } },
      data: { numberLabel: null, numberOrder: 0 },
    }),
    ...kept.map((k) =>
      prisma.regulationCategory.update({
        where: { id: k.id },
        data: {
          numberLabel: k.numberLabel,
          numberOrder: k.numberOrder,
          updatedBy: actor.user.id,
        },
      }),
    ),
  ]);

  return Response.json({ saved: kept.length });
}
