import { rankBandSchema } from "@chem/shared";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { recomputeAllScores } from "@/lib/score-store";

export const dynamic = "force-dynamic";

/**
 * 物質のスコアをランクに読み替える対応表。
 *
 * **システム設定の一部なので、参照も変更も管理者だけ**（CLAUDE.md §4）。
 * 段の数は決めないので、一覧をまるごと受け取って入れ替える。
 * 1段ずつ足し引きさせると、並び順と境目の整合を画面と両方で見ることになる。
 */

/** GET /api/substance-rank-bands — 段の一覧 */
export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const bands = await prisma.substanceRankBand.findMany({
    where: { deletedAt: null },
    orderBy: { displayOrder: "asc" },
    select: {
      id: true,
      label: true,
      lowerValue: true,
      lowerBound: true,
      upperValue: true,
      upperBound: true,
      displayOrder: true,
      note: true,
    },
  });

  return Response.json({
    items: bands.map((b) => ({
      id: b.id,
      label: b.label,
      lowerValue: b.lowerValue?.toString() ?? null,
      lowerBound: b.lowerBound,
      upperValue: b.upperValue?.toString() ?? null,
      upperBound: b.upperBound,
      displayOrder: b.displayOrder,
      note: b.note,
    })),
  });
}

/**
 * PUT /api/substance-rank-bands — 一覧をまるごと入れ替える。
 * **入れ替えたら全物質を計算し直す。**段が変われば、同じスコアでもランクが変わるため。
 */
export async function PUT(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }

  // 段が増えすぎると画面が壊れるので上限を置く。運用で足りる数を大きく超えた値
  const schema = z.object({ items: z.array(rankBandSchema(m)).max(100) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }

  const items = parsed.data.items;

  await prisma.$transaction([
    // 消してから入れ直す。段には他から参照される鍵が無いので、これで済む
    prisma.substanceRankBand.deleteMany({}),
    prisma.substanceRankBand.createMany({
      data: items.map((b, i) => ({
        label: b.label,
        lowerValue: b.lowerValue === "" ? null : b.lowerValue,
        lowerBound: b.lowerValue === "" ? null : (b.lowerBound ?? "INCLUSIVE"),
        upperValue: b.upperValue === "" ? null : b.upperValue,
        upperBound: b.upperValue === "" ? null : (b.upperBound ?? "EXCLUSIVE"),
        displayOrder: b.displayOrder || i + 1,
        note: b.note ?? null,
        updatedBy: actor.user.id,
      })),
    }),
  ]);

  const rescored = await recomputeAllScores();

  await writeAudit({
    entity: "substance_rank_bands",
    action: "update",
    actorId: actor.user.id,
    diff: { count: items.length, labels: items.map((b) => b.label) },
  });

  return Response.json({ ok: true, rescored });
}
