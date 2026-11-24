"use client";

import { useCallback } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

/**
 * 印を添えて消す（削除の楽観的ロック。サーバー側は lib/stamped-delete.ts）。
 *
 * - 一覧を開いたあとでほかの人が変更していたら、何も消さずに「ほかの人が変更しています」を出し、
 *   「このまま削除する」か「やめる」を選んでもらう。「やめる」なら何も消さない（呼んだ側が一覧を読み直す）
 * - 消してあったものは「すでに削除されていました」と知らせる（ほかのものは消える）
 * - 消せないもの（使われている・権限が無い）が 1 つでもあれば何も消さず、理由の文を `error` で返す
 *
 * 「選んだ N 件を削除しますか」の確かめは表の部品が先に出している。ここで出すのは、
 * 食い違いが分かったときの別の問いと、知らせだけ（lib/delete-confirm-coverage.test.ts）
 *
 * 使いかた:
 *
 *   const removeRows = useStampedDelete();
 *   const r = await removeRows("/api/countries", targets.map((c) => ({ id: c.id, stamp: c.stamp, label: c.code })));
 *   if (r.error) setError(r.error);
 *   void load();
 */

export interface DeleteTarget {
  id: string;
  /** 一覧の DTO の `stamp` */
  stamp: string;
  /** 知らせの文に出す名前（コードなど） */
  label: string;
}

export interface DeleteOutcome {
  /** 消えた（または、もともと消えていた）もの */
  deletedIds: string[];
  /** 画面に出す誤りの文。やめたとき・ログイン切れで移るときは無い */
  error?: string;
}

interface StaleRow {
  id: string;
  byName: string | null;
  at: string | null;
}

export function useStampedDelete() {
  const ask = useConfirm();
  const { m, locale } = useI18n();

  return useCallback(
    async (url: string, targets: DeleteTarget[]): Promise<DeleteOutcome> => {
      if (targets.length === 0) return { deletedIds: [] };
      const labelOf = new Map(targets.map((t) => [t.id, t.label]));
      const items = targets.map((t) => ({ id: t.id, stamp: t.stamp }));
      let force = false;
      for (;;) {
        const res = await fetch(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, force }),
        });
        if (res.ok) {
          const body = (await res.json()) as { deleted: string[]; alreadyDeleted: string[] };
          if (body.alreadyDeleted.length > 0) {
            const lines = body.alreadyDeleted
              .map((id) => m.errors.alreadyDeletedLine(labelOf.get(id) ?? id))
              .join("\n");
            await ask({
              message:
                body.deleted.length > 0
                  ? m.errors.alreadyDeletedSome(lines)
                  : m.errors.alreadyDeletedAll(lines),
              noticeOnly: true,
            });
          }
          return { deletedIds: [...body.deleted, ...body.alreadyDeleted] };
        }
        if (redirectIfUnauthorized(res)) return { deletedIds: [] };
        const body = (await res.json().catch(() => null)) as ApiError | null;
        if (body?.error.code === "stale_delete" && !force) {
          const stale = ((body.error.details as { stale?: StaleRow[] } | undefined)?.stale ??
            []) as StaleRow[];
          const lines = stale
            .map((s) =>
              m.errors.staleDeleteLine(
                labelOf.get(s.id) ?? s.id,
                s.byName ?? m.errors.staleEditSomeone,
                s.at ? new Date(s.at).toLocaleString(locale) : "-",
              ),
            )
            .join("\n");
          const go = await ask({
            title: m.errors.staleDeleteTitle,
            message: m.errors.staleDelete(lines),
            confirmLabel: m.errors.staleDeleteForce,
            cancelLabel: m.errors.staleDeleteCancel,
            destructive: true,
          });
          if (!go) return { deletedIds: [] };
          force = true;
          continue;
        }
        return { deletedIds: [], error: body?.error.message ?? m.errors.deleteFailed };
      }
    },
    [ask, m, locale],
  );
}
