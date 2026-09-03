"use client";

import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITIES,
  FEEDBACK_PRIORITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  type FeedbackCommentDto,
  type FeedbackDetailDto,
  type FeedbackKind,
  type FeedbackPriority,
  type FeedbackStatus,
} from "@chem/shared";
import { Reply, Trash2 } from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL } from "@/lib/page-shell";
import type { ApiError } from "@/lib/types";
import { cn } from "@/lib/utils";

const SELECT_CLASS = "border-input bg-background h-9 rounded-none border px-2 text-sm";

/**
 * 返信先。
 * undefined … 書く欄を出していない
 * null      … 元の書き込みへの返信
 * 文字列    … その返信への返信
 */
type ReplyTarget = string | null | undefined;

/**
 * フィードバックの詳細。書き込みと、返信のやり取り。
 *
 * **書いた内容は直さない。返信を重ねる。**元の書き込みにも、どの返信にも
 * （自分のものにも）返信できる。直せるのは種別・重要度・ステータスだけで、
 * 受け取った側がここで対応の状況を進める。
 *
 * 一覧と同じく開発中だけの画面なので、文言は日本語のまま書いている。
 */
export default function FeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { m, locale } = useI18n();
  const ask = useConfirm();

  const [detail, setDetail] = useState<FeedbackDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 種別・重要度・ステータス。読み込んだ値から始め、変えたときだけ保存ボタンを効かせる
  const [state, setState] = useState<{
    kind: FeedbackKind;
    priority: FeedbackPriority;
    status: FeedbackStatus;
  } | null>(null);
  const [savingState, setSavingState] = useState(false);

  const [replyTo, setReplyTo] = useState<ReplyTarget>(undefined);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/feedback/${id}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    const d = (await res.json()) as FeedbackDetailDto;
    setDetail(d);
    setState({ kind: d.item.kind, priority: d.item.priority, status: d.item.status });
  }, [id, m]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 親ごとに子を引けるようにしておく。木の描画はここから辿る */
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, FeedbackCommentDto[]>();
    for (const c of detail?.comments ?? []) {
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [detail]);

  const stateChanged =
    detail !== null &&
    state !== null &&
    (state.kind !== detail.item.kind ||
      state.priority !== detail.item.priority ||
      state.status !== detail.item.status);

  async function saveState() {
    if (!state) return;
    setError(null);
    setSavingState(true);
    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      void load();
    } finally {
      setSavingState(false);
    }
  }

  function openReply(target: string | null) {
    // 別の場所を押したら、書きかけは捨てずに欄だけ移す
    setReplyTo(target);
  }

  function closeReply() {
    setReplyTo(undefined);
    setReplyBody("");
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (replyTo === undefined) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/feedback/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody, parentId: replyTo }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      closeReply();
      void load();
    } finally {
      setSending(false);
    }
  }

  async function removeComment(c: FeedbackCommentDto) {
    if (!(await ask({ message: "この返信を消しますか？", destructive: true }))) return;
    setError(null);
    const res = await fetch(`/api/feedback/${id}/comments/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    void load();
  }

  /** 返信を書く欄。元の書き込みの下にも、各返信の下にも同じものを出す */
  const replyBox = (target: string | null) =>
    replyTo === target ? (
      <form onSubmit={sendReply} className="mt-2 space-y-2">
        <textarea
          autoFocus
          required
          rows={4}
          maxLength={5000}
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
          placeholder={target === null ? "この書き込みへの返信" : "この返信への返信"}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={sending}>
            {sending ? m.common.saving : "送信"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={closeReply}>
            {m.common.cancel}
          </Button>
        </div>
      </form>
    ) : null;

  /** 返信の木。深くなるほど左に線を足して、どれへの返信かが分かるようにする */
  const renderThread = (parentId: string | null, depth: number) => {
    const list = childrenOf.get(parentId);
    if (!list?.length) return null;
    return (
      <div className={cn("space-y-3", depth > 0 && "border-border ml-3 border-l pl-3")}>
        {list.map((c) => (
          <div key={c.id} className="space-y-1">
            <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="text-foreground font-medium">{c.byName ?? "—"}</span>
              <span>{new Date(c.createdAt).toLocaleString(locale)}</span>
            </div>
            {c.body === null ? (
              <p className="text-muted-foreground text-sm">（削除されました）</p>
            ) : (
              <p className="text-sm whitespace-pre-wrap">{c.body}</p>
            )}
            {c.body !== null && (
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => openReply(c.id)}
                >
                  <Reply className="mr-1 size-3.5" />
                  返信
                </Button>
                {c.canDelete && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground h-7 px-2 text-xs"
                    onClick={() => removeComment(c)}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    {m.common.delete}
                  </Button>
                )}
              </div>
            )}
            {replyBox(c.id)}
            {renderThread(c.id, depth + 1)}
          </div>
        ))}
      </div>
    );
  };

  const item = detail?.item ?? null;

  return (
    <div className={cn(PAGE_SHELL, "space-y-4")}>
      <div className="text-muted-foreground text-sm">
        <Link href="/feedback" className="underline underline-offset-2">
          ← フィードバック一覧
        </Link>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {item && state && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{item.title}</CardTitle>
              <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="text-foreground font-medium">{item.createdByName ?? "—"}</span>
                <span>{new Date(item.createdAt).toLocaleString(locale)}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm whitespace-pre-wrap">{item.body}</p>

              {/* 直せるのはここだけ。本文は直さず、返信で言い足す */}
              <div className="flex flex-wrap items-end gap-4 border-t pt-4">
                <div className="space-y-2">
                  <Label htmlFor="fb-kind">種別</Label>
                  <select
                    id="fb-kind"
                    value={state.kind}
                    onChange={(e) => setState({ ...state, kind: e.target.value as FeedbackKind })}
                    className={cn(SELECT_CLASS, "block w-32")}
                  >
                    {FEEDBACK_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {FEEDBACK_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fb-priority">重要度</Label>
                  <select
                    id="fb-priority"
                    value={state.priority}
                    onChange={(e) =>
                      setState({ ...state, priority: e.target.value as FeedbackPriority })
                    }
                    className={cn(SELECT_CLASS, "block w-24")}
                  >
                    {FEEDBACK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {FEEDBACK_PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fb-status">ステータス</Label>
                  <select
                    id="fb-status"
                    value={state.status}
                    onChange={(e) =>
                      setState({ ...state, status: e.target.value as FeedbackStatus })
                    }
                    className={cn(SELECT_CLASS, "block w-32")}
                  >
                    {FEEDBACK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {FEEDBACK_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!stateChanged || savingState}
                  onClick={saveState}
                >
                  {savingState ? m.common.saving : m.common.save}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                返信{item.replyCount > 0 ? `（${item.replyCount}件）` : ""}
              </CardTitle>
              {replyTo !== null && (
                <Button type="button" size="sm" variant="outline" onClick={() => openReply(null)}>
                  <Reply className="mr-1 size-3.5" />
                  この書き込みに返信
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {replyBox(null)}
              {item.replyCount === 0 && replyTo === undefined && (
                <p className="text-muted-foreground text-sm">まだ返信はありません</p>
              )}
              {renderThread(null, 0)}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
