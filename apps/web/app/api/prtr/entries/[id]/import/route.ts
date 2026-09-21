import { prtrImportSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import {
  inspectRows,
  missingRequired,
  PRTR_IMPORT_FILE_MAX,
  readRows,
  runImport,
} from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/prtr/entries/[id]/import — ファイルから取り込む（S22）。
 *
 * multipart で `file` と `step` を受け取る。
 *   step=inspect … 1 行目を見出しとして読み、見出しと最初の数行を返す（列の割り当てに使う）
 *   step=run     … `input`（JSON: kind / mapping / mode / overwrite / dryRun）に従って下見か実行
 * ファイルは毎回送り直す（サーバーに一時保存しない）。CSV / TSV / Excel（.xlsx）
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", m.errors.validation);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "no_file", m.prtr.import.unreadableFile);
  if (file.size > PRTR_IMPORT_FILE_MAX) return jsonError(413, "too_large", m.prtr.import.tooLarge);
  const rows = await readRows(file.name, Buffer.from(await file.arrayBuffer()));
  if (!rows) return jsonError(400, "unreadable", m.prtr.import.unreadableFile);
  const inspected = inspectRows(rows);
  if (!inspected) return jsonError(400, "no_header", m.prtr.import.noHeader);

  const step = form.get("step");
  if (step === "inspect") return Response.json(inspected);

  let input: unknown;
  try {
    input = JSON.parse(String(form.get("input") ?? ""));
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrImportSchema.safeParse(input);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  if (parsed.data.kind === "measured" && entry.method !== "MEASURED") {
    return jsonError(400, "validation_error", m.prtr.import.measuredNeedsMethod);
  }
  const missing = missingRequired(parsed.data.kind, parsed.data.mapping);
  if (missing.length > 0) {
    const label = m.prtr.import.fields[missing[0] as keyof typeof m.prtr.import.fields];
    return jsonError(400, "validation_error", m.prtr.import.required(label));
  }
  if (inspected.rowCount === 0) return jsonError(400, "no_rows", m.prtr.import.noRows);

  const result = await runImport(entry, rows, parsed.data, actor.user.id, m);
  if (result.applied) {
    await writeAudit({
      entity: "prtr_entries",
      entityId: id,
      action: "import",
      actorId: actor.user.id,
      diff: {
        kind: parsed.data.kind,
        fileName: file.name,
        added: result.willAdd,
        updated: result.willUpdate,
        removed: result.willRemove,
      },
    });
  }
  return Response.json(result);
}
