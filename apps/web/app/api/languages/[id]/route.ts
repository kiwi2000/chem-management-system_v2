import { languageSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { countLanguageUses } from "@/lib/language-service";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/languages/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.language.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = languageSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  const clash = async () => {
    if (v.code === existing.code) return null;
    const other = await prisma.language.findUnique({ where: { code: v.code } });
    return other && other.deletedAt === null
      ? jsonError(409, "duplicate_language_code", m.languages.duplicateCode(v.code))
      : null;
  };
  if (v.code !== existing.code) {
    const clashed = await clash();
    if (clashed) return clashed;
    // コードは法規制の側に文字列で入っているので、使われていたら変えさせない
    const uses = await countLanguageUses(existing.code);
    if (uses > 0) return jsonError(409, "referenced", m.languages.inUse(uses));
  }

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している。
  // 同じコードへほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  // （消した言語のコードも一意の決まりに残っているので、それと重なったときは一般の文になる）
  const hit = await guardUnique(m, clash, () =>
    prisma.language.updateMany({
      where: { id, ...stampWhere(lock) },
      data: {
        code: v.code,
        nameJa: v.nameJa,
        nameEn: v.nameEn,
        displayOrder: v.displayOrder,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.language.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  await writeAudit({
    entity: "languages",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  const after = await prisma.language.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}
