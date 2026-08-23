import { languageSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toLanguageDto } from "@/lib/language-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/languages — 並び順で全部返す。
 * 件数が知れているので、絞り込みも改ページも持たない。
 * 選択肢として使うだけなので、ログインしていれば読める（登録は管理者だけ）。
 */
export async function GET() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const items = await prisma.language.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
  });
  return Response.json({ items: items.map(toLanguageDto) });
}

/** POST /api/languages — 追加。同じコードを消していた場合はその行を復活させる */
export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

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

  const existing = await prisma.language.findUnique({ where: { code: v.code } });
  if (existing && existing.deletedAt === null) {
    return jsonError(409, "duplicate_language_code", m.languages.duplicateCode(v.code));
  }

  const data = {
    code: v.code,
    nameJa: v.nameJa,
    nameEn: v.nameEn,
    displayOrder: v.displayOrder,
    updatedBy: actor.user.id,
  };

  // コードが一意なので、消したものはキーを退避させず復活で扱う
  const id = existing
    ? (
        await prisma.language.update({
          where: { id: existing.id },
          data: { ...data, deletedAt: null },
        })
      ).id
    : (await prisma.language.create({ data: { ...data, createdBy: actor.user.id } })).id;

  await writeAudit({
    entity: "languages",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ id }, { status: 201 });
}
