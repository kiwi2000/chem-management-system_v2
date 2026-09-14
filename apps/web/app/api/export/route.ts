import JSZip from "jszip";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import {
  exportDataSet,
  exportProducts,
  exportRegulationList,
  exportSubstances,
} from "@/lib/import/export";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  kind: z.enum(["DATA_SET", "REGULATION_LIST", "PRODUCTS", "SUBSTANCES"]),
  law: z.string().max(50).optional(),
  source: z.string().max(50).optional(),
  /** データセットに入れるデータソース（カンマ区切り）。省くと全部 */
  sources: z.string().max(500).optional(),
});

/**
 * GET /api/export?kind=… — ファイルを書き出す（決定 0011）。
 * 書き出したものは、そのまま「インポート」で読める。製品は見られるものだけ、組成は権限のある人だけ
 */
export async function GET(req: Request) {
  const actor = await requirePermission("DATA_EXPORT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success)
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  const q = parsed.data;
  const stamp = new Date().toISOString().slice(0, 10);

  let body: string | Buffer;
  let fileName: string;
  let contentType: string;
  if (q.kind === "DATA_SET") {
    const sources = q.sources
      ? q.sources
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    // 写しは 200 MB を超える（LOLI の版）ので ZIP に包む。インポートは ZIP のまま受け付ける
    const snap = await exportDataSet(`export ${stamp}`, sources);
    const zip = new JSZip();
    zip.file(`chem-data-set-${stamp}.json`, JSON.stringify(snap));
    body = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    fileName = `chem-data-set-${stamp}.zip`;
    contentType = "application/zip";
  } else {
    body =
      q.kind === "REGULATION_LIST"
        ? await exportRegulationList({ lawCode: q.law, sourceCode: q.source })
        : q.kind === "PRODUCTS"
          ? await exportProducts(actor)
          : await exportSubstances();
    const stem =
      q.kind === "REGULATION_LIST"
        ? "regulation-list"
        : q.kind === "PRODUCTS"
          ? "products"
          : "substances";
    fileName = `chem-${stem}-${stamp}.tsv`;
    contentType = "text/tab-separated-values; charset=utf-8";
  }
  await writeAudit({
    entity: "export",
    action: "export",
    actorId: actor.user.id,
    diff: {
      kind: q.kind,
      law: q.law ?? null,
      source: q.source ?? null,
      sources: q.sources ?? null,
      bytes: body.length,
    },
  });
  return new Response(typeof body === "string" ? body : new Blob([new Uint8Array(body)]), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
