import { languageSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toLanguageDto } from "@/lib/language-service";
import { languageDelete } from "@/lib/language-delete";
import { runStampedDelete } from "@/lib/stamped-delete";
import { guardUnique } from "@/lib/unique-violation";

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
  const clash = async () => {
    const live = await prisma.language.findFirst({ where: { code: v.code, deletedAt: null } });
    return live
      ? jsonError(409, "duplicate_language_code", m.languages.duplicateCode(v.code))
      : null;
  };
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
  // 同じコードをほぼ同時に作られたら、一意の決まりで止まる。そのときもいつもの文で返す
  const written = await guardUnique(m, clash, async () =>
    existing
      ? await prisma.language.update({
          where: { id: existing.id },
          data: { ...data, deletedAt: null },
        })
      : await prisma.language.create({ data: { ...data, createdBy: actor.user.id } }),
  );
  if (written instanceof Response) return written;
  const id = written.id;

  await writeAudit({
    entity: "languages",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ id }, { status: 201 });
}

/**
 * DELETE /api/languages — まとめて削除（本文 `{ items: [{ id, stamp }], force? }`。lib/stamped-delete.ts）。
 * 言語（管理者だけ）。一覧を開いたあとでほかの人が変更していれば、何も消さずに知らせる
 */
export async function DELETE(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  return runStampedDelete(req, m, languageDelete(actor, m));
}
