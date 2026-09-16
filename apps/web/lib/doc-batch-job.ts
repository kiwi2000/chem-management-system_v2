import {
  emptyTableState,
  getMessages,
  isLocale,
  organisationIdsIn,
  parseOrgChoices,
  parseTableState,
  type DocSelection,
  type DocumentTarget,
} from "@chem/shared";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { actorOf, type Actor } from "@/lib/authz";
import { getCurrentVersion } from "@/lib/current-version";
import { prisma } from "@/lib/db";
import { collectFor, containsComposition, resolveOrgChoices } from "@/lib/doc-data";
import { currentOutputDir, writePdfFile } from "@/lib/doc-files";
import { renderDocument } from "@/lib/doc-render";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";
import { ORGANISATION_COLUMNS, productColumns, SUBSTANCE_COLUMNS } from "@/lib/list-columns";
import { closeBrowser, internalBaseUrl, renderPdf } from "@/lib/pdf";
import { makePrintToken } from "@/lib/print-token";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { getAppSettings } from "@/lib/settings";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { DocBatchJobDto } from "@/lib/types";

/**
 * 帳票を作る仕事（バックグラウンド処理。2026-09-16 指示）。
 *
 * 頼まれたぶんを **1 つずつ順に** 作り、進み具合を DocumentBatchJob に書く。
 * 1 件ごとに、紙面のデータを残してから **PDF ファイルを作って出力先フォルダーに置く**。
 * 画面は数秒おきに聞きに来る。画面を離れても仕事は続き、できたものは
 * 「自分が作ったドキュメント」に並ぶ（1 件ずつでも zip でも落とせる）。
 *
 * **頼んだ人の権限のまま動く。**見る権限が無い相手は作れなかった数に入る。
 * PDF だけ作れなかったときは記録に理由を残し、紙面のデータは残す（画面では開ける）。
 * サーバーが 1 台のあいだは、待ち行列をこのモジュールの変数で持つ。
 *
 * **生きているかは DB の heartbeatAt で見る**（メモリの記録には頼らない）。
 * 走らせている側が 1 件ごとに更新し、待っている仕事にも同じ時刻を書く。
 * 待ち・実行中なのにそれが古ければ、サーバーが再起動して途切れたと分かる
 * （開発時はモジュールが作り直されてメモリの記録が消えることがあり、そのせいで
 * 走っている仕事を「中断」と誤ったことがあった）
 */

/** これより長く生きている印が更新されなければ、途切れたとみなす */
const STALE_MS = 60_000;

const queue: string[] = [];
let active: string | null = null;

/** 待ち行列に入れる。空いていればすぐ走る */
export function enqueueDocBatch(jobId: string): void {
  if (active === jobId || queue.includes(jobId)) return;
  queue.push(jobId);
  void pump();
}

async function pump(): Promise<void> {
  if (active) return;
  const next = queue.shift();
  if (!next) return;
  active = next;
  try {
    await run(next);
  } finally {
    active = null;
    // 続きが無ければブラウザを閉じてメモリを返す
    if (queue.length === 0) await closeBrowser();
    void pump();
  }
}

/** 生きている印。走っているものと、この後ろで待っているものに同じ時刻を書く */
async function heartbeat(jobId: string, data: Prisma.DocumentBatchJobUpdateManyMutationInput = {}) {
  const now = new Date();
  await prisma.documentBatchJob.update({
    where: { id: jobId },
    data: { ...data, heartbeatAt: now },
  });
  if (queue.length > 0) {
    await prisma.documentBatchJob.updateMany({
      where: { id: { in: [...queue] } },
      data: { heartbeatAt: now },
    });
  }
}

/** 一覧の既定の並び（製品・物質とも コード順） */
const LIST_DEFAULT = emptyTableState([{ column: "code", direction: "asc" }]);

/**
 * 作る相手の ID を決める。
 * 絞り込みの条件で頼まれたときは、**一覧の API と同じ列・同じ見える範囲**で引き直す
 * （見えないものは件数にも入らない）。並びも一覧と同じにして、刷ったときの順が画面と揃うようにする
 */
export async function resolveTargetIds(
  actor: Actor,
  target: DocumentTarget,
  selection: DocSelection,
): Promise<string[]> {
  // 対象なしは 1 枚だけ。相手の id は使わない
  if (target === "NONE") return [""];
  if (selection.mode === "ids") return [...new Set(selection.ids)];
  const params = new URLSearchParams(selection.filter);
  if (target === "ORGANISATION") {
    const state = parseTableState(
      params,
      ORGANISATION_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
      emptyTableState([{ column: "displayOrder", direction: "asc" }]),
    );
    const rows = await prisma.organisation.findMany({
      where: { deletedAt: null, ...buildWhere(ORGANISATION_COLUMNS, state.filters) },
      orderBy: buildOrderBy(ORGANISATION_COLUMNS, state.sort, { displayOrder: "asc" }),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  if (target === "PRODUCT") {
    const version = await getCurrentVersion();
    const columns = productColumns(version?.id ?? null, actor.has("COMPOSITION_VIEW"));
    const state = parseTableState(
      params,
      columns.map((c) => ({ key: c.key, kind: c.kind })),
      LIST_DEFAULT,
    );
    const rows = await prisma.product.findMany({
      where: {
        deletedAt: null,
        ...productVisibility(actor),
        ...buildWhere(columns, state.filters),
      },
      orderBy: buildOrderBy(columns, state.sort, { codeNormalized: "asc" }),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  const state = parseTableState(
    params,
    SUBSTANCE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    LIST_DEFAULT,
  );
  const rows = await prisma.substance.findMany({
    where: {
      deletedAt: null,
      ...substanceVisibility(actor),
      ...buildWhere(SUBSTANCE_COLUMNS, state.filters),
    },
    orderBy: buildOrderBy(SUBSTANCE_COLUMNS, state.sort, { codeNormalized: "asc" }),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** ファイル名の {対象名} に使う名前。対象なしはテンプレートの名前 */
function targetNameOf(
  target: DocumentTarget,
  data: { code: string; values: Map<string, string> },
): string | undefined {
  switch (target) {
    case "PRODUCT":
      return data.values.get("product.nameJa");
    case "SUBSTANCE":
      return data.values.get("substance.nameJa");
    case "ORGANISATION":
      return data.values.get("organisation.name");
    case "NONE":
      return undefined;
  }
}

/** 仕事に添えた差出人・宛先（1 件ずつ作るときの URL と同じ形） */
export interface DocBatchParams {
  company?: string | null;
  department?: string | null;
  to?: string | null;
  org?: string[];
}

/**
 * 1 枚の PDF を作って置く。**失敗しても投げない**（理由を記録に残して次へ進む）
 */
async function makePdf(
  docId: string,
  vars: { template: string; code: string; name: string; version: string; seq: number },
  outDir: string,
  pattern: string,
  m: ReturnType<typeof getMessages>,
): Promise<void> {
  try {
    const url = `${internalBaseUrl()}/print/${docId}?t=${encodeURIComponent(makePrintToken(docId))}`;
    const pdf = await renderPdf(url);
    const file = await writePdfFile(outDir, pattern, { ...vars, at: new Date() }, pdf);
    await prisma.generatedDocument.update({ where: { id: docId }, data: { ...file } });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await prisma.generatedDocument.update({
      where: { id: docId },
      data: { fileError: `${m.documents.fileFailed}: ${reason}`.slice(0, 1000) },
    });
  }
}

async function run(jobId: string): Promise<void> {
  const job = await prisma.documentBatchJob.findUnique({
    where: { id: jobId },
    include: { template: { select: DOC_TEMPLATE_SELECT } },
  });
  if (!job || job.status !== "QUEUED") return;

  const template = toDocTemplateDto(job.template);
  const lower = template.locale.toLowerCase();
  const locale = isLocale(lower) ? lower : "ja";
  const m = getMessages(locale);

  await heartbeat(jobId, { status: "RUNNING", startedAt: new Date() });

  try {
    // 頼んだ人の権限で動く。途中で権限を外された人の仕事は、そこで止める
    const actor = await actorOf(job.createdBy);
    if (!actor || !actor.has("DOCUMENT_CREATE")) {
      await heartbeat(jobId, {
        status: "FAILED",
        error: m.documents.jobNoAccess,
        finishedAt: new Date(),
      });
      return;
    }

    const p = (job.params ?? {}) as DocBatchParams;
    // 生成するときに選んだ組織を、様式の組織ブロックへ書き込む（様式で決めてあるものは変えない）
    const content = await resolveOrgChoices(template.content, p.org);
    const parties = {
      companyId: p.company ?? null,
      departmentId: p.department ?? null,
      recipientId: template.usesRecipient ? (p.to ?? null) : null,
      organisationIds: organisationIdsIn(content),
    };
    const orgChoices = parseOrgChoices(p.org);

    const ids = await resolveTargetIds(actor, template.target, job.selection as DocSelection);
    await heartbeat(jobId, { total: ids.length });

    // 出力先とファイル名の書式は、走り始めた時点の設定を使う（途中で変えても、この仕事は変えない）
    const settings = await getAppSettings();
    const outDir = await currentOutputDir();
    const pattern = settings.documentFileNamePattern;

    let done = 0;
    let missed = 0;
    const missedIds: string[] = [];
    for (const id of ids) {
      try {
        // 見る権限は、集める側が対象ごとに判断する（見られないものは null）
        const data = await collectFor(actor, template.target, id, locale, m, parties);
        if (!data) {
          missed++;
          missedIds.push(id);
        } else {
          const doc = renderDocument({
            content,
            target: template.target,
            values: data.values,
            tables: data.tables,
          });
          const version = data.values.get("doc.version") ?? "";
          const created = await prisma.generatedDocument.create({
            data: {
              templateId: template.id,
              targetRef: id,
              // 対象なしは相手が無いので、テンプレートのコードを控えにする
              targetCode: data.code || template.code,
              generatedBy: actor.user.id,
              // 出した紙面をそのまま残す。あとで開いたときに当時の内容が出る
              content: doc as unknown as object,
              hasComposition: containsComposition(content, data),
              params: {
                version,
                ...(parties.companyId ? { companyId: parties.companyId } : {}),
                ...(parties.departmentId ? { departmentId: parties.departmentId } : {}),
                ...(parties.recipientId ? { recipientId: parties.recipientId } : {}),
                ...(orgChoices.size ? { organisations: Object.fromEntries(orgChoices) } : {}),
              },
              batchJobId: jobId,
            },
            select: { id: true },
          });
          await makePdf(
            created.id,
            {
              template: template.code,
              code: data.code || template.code,
              name: targetNameOf(template.target, data) ?? template.nameJa,
              version,
              seq: done + 1,
            },
            outDir,
            pattern,
            m,
          );
        }
      } catch {
        // 1 件の失敗で全部を止めない。作れなかった数に入れて先へ進む
        missed++;
        missedIds.push(id);
      }
      done++;
      // 進み具合と生きている印を 1 件ごとに書く（帳票 1 枚に比べれば安い）
      await heartbeat(jobId, { done, missed });
    }

    // 持ち出しの記録。組成が載ることがあるので、閲覧としても残す
    await writeAudit({
      entity: "generated_documents",
      entityId: template.id,
      action: "export",
      actorId: actor.user.id,
      diff: { template: template.code, count: done - missed, batch: jobId },
    });
    await heartbeat(jobId, {
      status: "DONE",
      done,
      missed,
      error: null,
      finishedAt: new Date(),
      summary: { missedIds: missedIds.slice(0, 200) },
    });
  } catch (err) {
    await heartbeat(jobId, {
      status: "FAILED",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date(),
    });
  }
}

/** 画面に出す項目。紙面そのものは持たない */
export const JOB_SELECT = {
  id: true,
  status: true,
  total: true,
  done: true,
  missed: true,
  error: true,
  createdAt: true,
  finishedAt: true,
  template: { select: { code: true, nameJa: true, nameEn: true, target: true } },
} satisfies Prisma.DocumentBatchJobSelect;

type JobRow = Prisma.DocumentBatchJobGetPayload<{ select: typeof JOB_SELECT }>;

export function toJobDto(j: JobRow): DocBatchJobDto {
  return {
    id: j.id,
    templateCode: j.template.code,
    templateNameJa: j.template.nameJa,
    templateNameEn: j.template.nameEn,
    target: j.template.target,
    status: j.status,
    total: j.total,
    done: j.done,
    missed: j.missed,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

/** 待ち・実行中で、生きている印が古いもの（サーバーが再起動して途切れた） */
const staleWhere = (userId: string): Prisma.DocumentBatchJobWhereInput => ({
  createdBy: userId,
  status: { in: ["QUEUED", "RUNNING"] },
  heartbeatAt: { lt: new Date(Date.now() - STALE_MS) },
});

/** サーバーが再起動して途切れた仕事に印を付ける（一覧を読むときに呼ぶ） */
export async function markInterrupted(userId: string, message: string): Promise<void> {
  await prisma.documentBatchJob.updateMany({
    where: staleWhere(userId),
    data: { status: "FAILED", error: message, finishedAt: new Date() },
  });
}

/** その人の、いま走っている（待っている）仕事の数。左メニューの印に使う */
export async function countRunningFor(userId: string): Promise<number> {
  return prisma.documentBatchJob.count({
    where: {
      createdBy: userId,
      status: { in: ["QUEUED", "RUNNING"] },
      heartbeatAt: { gte: new Date(Date.now() - STALE_MS) },
    },
  });
}
