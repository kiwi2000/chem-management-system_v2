import type { Prisma } from "@prisma/client";
import type { Messages } from "@chem/shared";
import { z } from "zod";
import { jsonError } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { nameOf } from "@/lib/edit-stamp";
import { PAGE_SIZE_MAX } from "@chem/shared";

/**
 * 削除の楽観的ロック（2026-11-24 指示）。
 *
 * 一覧を開いたあとでほかの人が変更したものを、黙って消さない。決まりは次のとおり。
 *
 * - **全部か、何もしないか。**まとめて消すとき、1 つでも消せないもの（ほかの人の変更・使われている・権限が無い）が
 *   あれば何も消さない。一部だけ消えると、何が残ったのかを利用者が探すことになるため
 * - ほかの人が変更していたら 409 `stale_delete`（誰が・いつ）。利用者が「このまま削除する」を選べば `force` を付けて
 *   送り直し、そのときは変更の食い違いだけを見逃す（権限・状態・使われているかは、いまの行でもう一度確かめる）
 * - **消してあるものは「すでに削除されています」。**ほかのものは消す（選んだものが全部消えた状態になるので迷わない）
 * - 見えないものは「見つかりません」のまま（見えないものがあったことを知らせない。S31 仕様 7 章）
 *
 * 確かめる順は、見えるか → 消してあるか → 変更されていないか → 消してよいか。
 * 論理削除は更新時刻も進めるので、印を先に見ると、消えたものを「変更された」と言ってしまう。
 *
 * 書き込みは 1 つのトランザクションで行い、各行を「読んだときの更新時刻のまま」の条件で消す。
 * 確かめてから書くまでの間に変わった行があれば、全部を取り消して食い違いとして返す。
 * ファイルの片付けと操作の記録は、書き込みが確定してから行う。
 *
 * 使いかた（一覧の API の DELETE）:
 *
 *   export async function DELETE(req: Request) {
 *     const actor = await requirePermission("REGULATION_EDIT");
 *     if (actor instanceof Response) return actor;
 *     return runStampedDelete(req, await getServerMessages(), countryDelete(actor));
 *   }
 *
 * 付け忘れは lib/stamped-delete-coverage.test.ts が検出する
 */

/** 送られてくる本文。印は一覧の DTO の `stamp`（更新時刻のミリ秒） */
export const deleteRequestSchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1), stamp: z.string().min(1) }))
    .min(1)
    .max(PAGE_SIZE_MAX),
  force: z.boolean().optional(),
});

/** 消す候補の 1 行。`deleted` は論理削除の済んだもの */
export interface DeleteRow {
  id: string;
  /** 利用者に見せる名前（コードなど）。消せない理由の文に使う */
  label: string;
  updatedAt: Date;
  updatedBy?: string | null;
  deleted?: boolean;
  /**
   * 読めたが、この人には見えないもの（宛先で見える人が決まるお知らせなど）。
   * 「見つかりません」で何も消さない。変更の有無や誰が変えたかも言わない
   */
  hidden?: boolean;
}

/** 表ごとの消しかた */
export interface DeleteSpec<R extends DeleteRow> {
  /**
   * 行を読む。**見えないものは返さない。**論理削除の済んだものは `deleted: true` で返す
   */
  load(ids: string[]): Promise<R[]>;
  /**
   * 行を本当に消してしまう表（物理削除）で、見える範囲の制限が無いなら true。
   * 読めない行を「すでに削除されている」とみなす。false なら「見つかりません」で何も消さない
   */
  missingMeansDeleted: boolean;
  /**
   * 消してよいか。だめなら理由の文を返す（権限・公開の状態・ほかで使われている）。
   * `batch` は今回いっしょに消すものの id。同じ回で消すもの同士の参照は数えない
   */
  refuse?(row: R, batch: ReadonlySet<string>): Promise<string | null>;
  /**
   * 書き込み（トランザクションの中）。`guard` を where に広げて updateMany / deleteMany し、当たった件数を返す。
   * 0 件なら、確かめたあとで変わったとみなして全部を取り消す
   */
  remove(tx: Prisma.TransactionClient, row: R, guard: { updatedAt: Date }): Promise<number>;
  /** 確定したあとの片付け（ファイルを消す・付随するものを直す） */
  after?(rows: R[]): Promise<void>;
  /**
   * 操作の記録。種類の混ざる表（法令の木）は、行ごとに表の名前と元の id を返す
   */
  audit: {
    entity: string | ((row: R) => string);
    entityId?: (row: R) => string;
    actorId: string;
    diff(row: R): Record<string, unknown>;
  };
}

/** 書き込みの途中で、確かめたあとに変わった行が見つかったとき */
class ChangedDuringDelete extends Error {
  constructor() {
    super("changed_during_delete");
  }
}

/** 印は更新時刻のミリ秒（lib/edit-stamp.ts の rowStamp と同じ） */
const stampOf = (row: DeleteRow) => String(row.updatedAt.getTime());

/** 食い違いの 409。どれを誰がいつ変えたか */
async function staleDelete<R extends DeleteRow>(m: Messages, rows: R[]): Promise<Response> {
  const stale = [];
  for (const r of rows) {
    stale.push({
      id: r.id,
      byName: r.updatedBy ? await nameOf(r.updatedBy) : null,
      at: r.updatedAt.toISOString(),
    });
  }
  return jsonError(409, "stale_delete", m.errors.staleDeleteTitle, { stale });
}

export async function runStampedDelete<R extends DeleteRow>(
  req: Request,
  m: Messages,
  spec: DeleteSpec<R>,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = deleteRequestSchema.safeParse(body);
  if (!parsed.success) {
    // 印の無い古い画面は、黙って通さない（編集と同じ。lib/edit-stamp.ts）
    return jsonError(400, "stamp_required", m.errors.stampRequired, parsed.error.flatten());
  }
  const sent = new Map(parsed.data.items.map((it) => [it.id, it.stamp]));
  return execute(m, spec, sent, parsed.data.force === true, false);
}

/** 確かめて消す。書くあいだに変わった行があれば、確かめからもう 1 回だけやり直す（retried） */
async function execute<R extends DeleteRow>(
  m: Messages,
  spec: DeleteSpec<R>,
  sent: ReadonlyMap<string, string>,
  force: boolean,
  retried: boolean,
): Promise<Response> {
  const ids = [...sent.keys()];

  // 1. 見えるか
  const rows = await spec.load(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = ids.filter((id) => !byId.has(id));
  if ((missing.length > 0 && !spec.missingMeansDeleted) || rows.some((r) => r.hidden)) {
    return jsonError(404, "not_found", m.errors.notFound);
  }

  // 2. 消してあるか（消してあるものは、ほかのものを消す妨げにしない）
  const alreadyDeleted = [...missing, ...rows.filter((r) => r.deleted).map((r) => r.id)];
  const live = rows.filter((r) => !r.deleted);
  if (live.length === 0) return Response.json({ ok: true, deleted: [], alreadyDeleted });

  // 3. 一覧を開いたあとで変わっていないか
  if (!force) {
    const stale = live.filter((r) => stampOf(r) !== sent.get(r.id));
    if (stale.length > 0) return staleDelete(m, stale);
  }

  // 4. 消してよいか（全部見てから、まとめて断る）
  const batch = new Set(live.map((r) => r.id));
  const refusals: { label: string; reason: string }[] = [];
  if (spec.refuse) {
    for (const r of live) {
      const reason = await spec.refuse(r, batch);
      if (reason) refusals.push({ label: r.label, reason });
    }
  }
  if (refusals.length > 0) {
    // 1 件だけ消すときは、理由の文をそのまま返す（これまでの 1 件ずつの削除と同じ文）
    const message =
      live.length === 1
        ? refusals[0]!.reason
        : m.errors.deleteRefused(
            refusals.map((x) => m.errors.deleteRefusedLine(x.label, x.reason)).join("\n"),
          );
    return jsonError(409, "delete_refused", message);
  }

  // 5. 書く。確かめたときの更新時刻のままの行だけを消す
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const r of live) {
          const hit = await spec.remove(tx, r, { updatedAt: r.updatedAt });
          if (hit === 0) throw new ChangedDuringDelete();
        }
      },
      { timeout: 60_000 },
    );
  } catch (e) {
    if (!(e instanceof ChangedDuringDelete)) throw e;
    // 確かめているあいだに、ほかの人が変えた・消した。何も書いていないので、確かめからやり直す。
    // 変えられたものは「ほかの人が変更しています」、消されたものは「すでに削除」に振り分けられる
    if (!retried) return execute(m, spec, sent, force, true);
    return jsonError(409, "delete_refused", m.errors.deleteFailed);
  }

  if (spec.after) await spec.after(live);
  for (const r of live) {
    const { entity, entityId } = spec.audit;
    await writeAudit({
      entity: typeof entity === "string" ? entity : entity(r),
      entityId: entityId ? entityId(r) : r.id,
      action: "delete",
      actorId: spec.audit.actorId,
      diff: spec.audit.diff(r),
    });
  }
  return Response.json({ ok: true, deleted: live.map((r) => r.id), alreadyDeleted });
}

/** 論理削除の一意制約を空けるための退避の値。原文の code はそのまま残す */
export function retiredCode(row: { codeNormalized: string; id: string }): string {
  return `${row.codeNormalized}:${row.id}`.slice(0, 64);
}
