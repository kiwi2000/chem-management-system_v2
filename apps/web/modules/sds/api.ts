import { isDay } from "@/lib/judgement-date";
import { writeAudit } from "@/lib/audit";
import { jsonError, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getLocale, getServerMessages } from "@/lib/i18n";
import {
  SOURCES,
  applyImport,
  ensureSeed,
  previewImport,
  type SourceCode,
} from "./ghs/import-service";
import { fieldOf, fileOf, parseMultipart } from "./lib/multipart";
import { sdsMessages } from "./messages";

/** 1 ファイルの上限。根拠一覧が 10 MB 強ある */
export const GHS_IMPORT_FILE_MAX_MB = 32;

/**
 * SDS モジュールの API（/api/modules/sds/…）。ログイン済みは本体が確かめている。
 *
 *   POST ghs/import   … multipart: sourceCode / label / publishedOn / step(preview|apply) / file / rationale?
 *   GET  ghs/releases … 取り込みの記録
 *
 * 取り込みはシステム管理者だけ（権限を足すのは、権限にモジュールの印を持たせる仕組みができてから）
 */
export async function sdsApi(req: Request, path: string[], actor: Actor): Promise<Response | null> {
  const key = `${req.method} ${path.join("/")}`;
  if (key === "GET ghs/releases") return listReleases();
  if (key === "POST ghs/import") return importGhs(req, actor);
  return null;
}

async function listReleases(): Promise<Response> {
  const items = await prisma.sdsGhsRelease.findMany({
    orderBy: [{ importedAt: "desc" }],
    include: { source: { select: { code: true, nameJa: true, nameEn: true } } },
    take: 100,
  });
  return Response.json({
    items: items.map((r) => ({
      id: r.id,
      sourceCode: r.source.code,
      sourceNameJa: r.source.nameJa,
      sourceNameEn: r.source.nameEn,
      label: r.label,
      publishedOn: r.publishedOn.toISOString().slice(0, 10),
      importedAt: r.importedAt.toISOString(),
      addedCount: r.addedCount,
      changedCount: r.changedCount,
      unchangedCount: r.unchangedCount,
      closedCount: r.closedCount,
      issueCount: r.issueCount,
    })),
  });
}

async function importGhs(req: Request, actor: Actor): Promise<Response> {
  const [m, locale] = await Promise.all([getServerMessages(), getLocale()]);
  const t = sdsMessages(locale).ghs.import;
  if (!actor.has("ADMIN")) return jsonError(403, "forbidden", t.adminOnly);

  // req.formData() は 10 MB のファイルで落ちるので、本文を丸ごと読んで自前で切る（lib/multipart.ts）
  const max = GHS_IMPORT_FILE_MAX_MB * 1024 * 1024;
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > max * 2 + 1024 * 1024)
    return jsonError(413, "too_large", t.tooLarge(GHS_IMPORT_FILE_MAX_MB));
  const parts = parseMultipart(body, req.headers.get("content-type"));
  if (!parts) {
    console.error(
      "sds ghs import: multipart parse failed",
      body.length,
      req.headers.get("content-type"),
    );
    return jsonError(400, "invalid_form", m.errors.validation);
  }
  const sourceCode = fieldOf(parts, "sourceCode") ?? "";
  if (!SOURCES.some((s) => s.code === sourceCode))
    return jsonError(400, "validation_error", m.errors.validation);
  const label = (fieldOf(parts, "label") ?? "").trim();
  if (!label) return jsonError(400, "validation_error", t.needLabel);
  const publishedOn = fieldOf(parts, "publishedOn") ?? "";
  if (!isDay(publishedOn)) return jsonError(400, "validation_error", t.needDate);
  const file = fileOf(parts, "file");
  if (!file) return jsonError(400, "no_file", t.needFile);
  const rationale = fileOf(parts, "rationale");
  if (file.data.length > max || (rationale && rationale.data.length > max)) {
    return jsonError(413, "too_large", t.tooLarge(GHS_IMPORT_FILE_MAX_MB));
  }

  await ensureSeed();
  const input = {
    sourceCode: sourceCode as SourceCode,
    label: label.slice(0, 120),
    publishedOn,
    fileName: (file.filename ?? "").slice(0, 255),
    main: file.data,
    rationale: rationale?.data,
  };
  let diff;
  try {
    diff = await previewImport(input);
  } catch {
    return jsonError(400, "unreadable", t.unreadable);
  }
  if (diff.fileIssues.length > 0) {
    const missing = diff.fileIssues.map((i) => i.replace(/^missing column: /, ""));
    return jsonError(400, "wrong_columns", t.wrongColumns(missing));
  }
  const summary = {
    parsed: diff.parsed,
    added: diff.added.length,
    changed: diff.changed.length,
    unchanged: diff.unchanged.length,
    disappeared: diff.disappeared.length,
    issues: diff.issues.length,
    // 画面に見せる例
    samples: [
      ...diff.added
        .slice(0, 10)
        .map((e) => ({ kind: "added", key: e.sourceKey + e.subKey, name: e.name })),
      ...diff.changed.slice(0, 10).map((c) => ({
        kind: "changed",
        key: c.next.sourceKey + c.next.subKey,
        name: c.next.name,
      })),
    ],
    issueSamples: [
      ...diff.issues.slice(0, 20),
      ...diff.disappeared.slice(0, 5).map((d) => `${d.sourceKey} ${d.name}: 見当たらず`),
    ],
  };
  if (fieldOf(parts, "step") !== "apply") return Response.json({ applied: false, ...summary });

  const { releaseId } = await applyImport(input, diff, actor.user.id);
  await writeAudit({
    entity: "sds_ghs_release",
    entityId: releaseId,
    action: "import",
    actorId: actor.user.id,
    diff: {
      sourceCode,
      label,
      publishedOn,
      fileName: input.fileName,
      added: summary.added,
      changed: summary.changed,
    },
  });
  return Response.json({ applied: true, releaseId, ...summary });
}
