"use client";

import {
  emptyTableState,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_PRIORITIES,
  FEEDBACK_PRIORITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  isOpenFeedback,
  serializeTableState,
  type FeedbackDto,
  type FeedbackKind,
  type FeedbackPriority,
  type FeedbackStatus,
  type TableState,
} from "@chem/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { FeedbackPeek } from "@/components/feedback-peek";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { cn } from "@/lib/utils";

/** 直したものが上に来るほうが追いやすい */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "updatedAt", direction: "desc" }]);

const STORAGE_KEY = "chem.table.feedback";

const EMPTY_FORM = {
  id: "",
  title: "",
  body: "",
  kind: "BUG" as FeedbackKind,
  priority: "MEDIUM" as FeedbackPriority,
  status: "OPEN" as FeedbackStatus,
  reply: "",
};

const SELECT_CLASS = "border-input bg-background h-9 rounded-none border px-2 text-sm";

/** 重要度は「高」だけ目を引かせる。中と低は並の見た目でよい */
const PRIORITY_CLASS: Record<FeedbackPriority, string> = {
  HIGH: "text-destructive font-bold",
  MEDIUM: "",
  LOW: "text-muted-foreground",
};

/**
 * フィードバック。
 *
 * 開発中に気づいたことを書き留めておくための、簡単な課題管理。
 * 項目が少ないので別画面を作らず、一覧の上のフォームで追加・編集する
 * （金属換算係数の画面と同じ形）。
 *
 * 本番を作るときに、この画面ごとメニューから外す。
 * そのため文言は多言語にせず、日本語のまま書いている。
 */
export default function FeedbackPage() {
  const { m, locale } = useI18n();

  const columns = useMemo<TableColumn<FeedbackDto>[]>(
    () => [
      {
        // 未読の印。字は入れず、点ひとつで示す
        key: "unread",
        header: "",
        kind: "enum",
        width: 28,
        sortable: false,
        filterable: false,
        className: "text-center",
        render: (r) =>
          r.unread ? (
            <span
              className="bg-primary mx-auto block size-2 rounded-full"
              title="未読"
              aria-label="未読"
            />
          ) : null,
      },
      {
        key: "title",
        header: "タイトル",
        kind: "text",
        // 必ず入る列。「空白」で絞る意味が無い
        nullable: false,
        width: 260,
        filterFullWidth: true,
        render: (r) => <span className={r.unread ? "font-semibold" : undefined}>{r.title}</span>,
      },
      {
        key: "kind",
        header: "種別",
        kind: "enum",
        nullable: false,
        width: 90,
        options: FEEDBACK_KINDS.map((k) => ({ value: k, label: FEEDBACK_KIND_LABELS[k] })),
        render: (r) => FEEDBACK_KIND_LABELS[r.kind],
      },
      {
        key: "priority",
        header: "重要度",
        kind: "enum",
        nullable: false,
        width: 76,
        className: "text-center",
        options: FEEDBACK_PRIORITIES.map((p) => ({
          value: p,
          label: FEEDBACK_PRIORITY_LABELS[p],
        })),
        render: (r) => (
          <span className={PRIORITY_CLASS[r.priority]}>{FEEDBACK_PRIORITY_LABELS[r.priority]}</span>
        ),
      },
      {
        key: "status",
        header: "ステータス",
        kind: "enum",
        nullable: false,
        width: 96,
        options: FEEDBACK_STATUSES.map((s) => ({ value: s, label: FEEDBACK_STATUS_LABELS[s] })),
        render: (r) => (
          <span className={cn(!isOpenFeedback(r.status) && "text-muted-foreground")}>
            {FEEDBACK_STATUS_LABELS[r.status]}
          </span>
        ),
      },
      {
        key: "body",
        header: "内容",
        kind: "text",
        nullable: false,
        width: 320,
        filterFullWidth: true,
        multiline: true,
        // 3行で打ち切る。この幅だと1行30文字ほどなので、90文字あたりまで見える。
        // 全文は行を開いて読む
        clampLines: 3,
        render: (r) => r.body,
      },
      {
        key: "reply",
        header: "返事",
        kind: "text",
        width: 280,
        sortable: false,
        filterFullWidth: true,
        multiline: true,
        clampLines: 3,
        // 返事が付いていれば、誰がいつ返したかも小さく添える
        render: (r) =>
          r.reply ? (
            <div className="space-y-0.5">
              <div>{r.reply}</div>
              <div className="text-muted-foreground text-xs">
                {r.repliedByName ?? "—"}
                {r.repliedAt ? ` ${new Date(r.repliedAt).toLocaleString(locale)}` : ""}
              </div>
            </div>
          ) : (
            ""
          ),
      },
      {
        key: "createdByName",
        header: "投稿者",
        kind: "text",
        width: 110,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        render: (r) => r.createdByName ?? "—",
      },
      {
        key: "createdAt",
        header: "登録日時",
        kind: "date",
        nullable: false,
        width: 130,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.createdAt).toLocaleString(locale),
      },
      {
        key: "updatedAt",
        header: "更新日時",
        kind: "date",
        nullable: false,
        width: 130,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleString(locale),
      },
    ],
    [locale],
  );

  const { state, setState, reset, ready } = useTableState(STORAGE_KEY, columns, DEFAULT_STATE);

  const [data, setData] = useState<ListResponse<FeedbackDto> | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/feedback?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: state.pageSize });
      return;
    }
    setData((await res.json()) as ListResponse<FeedbackDto>);
    // state.pageSize はエラー時の表示にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /*
    開いたら「ここまで見た」と印を付ける。1回だけでよい。
    いま出ている行の未読の印は、印を付ける前の時刻で決まっているので消えない。
    開いた瞬間に消えると、何が新しかったのか分からなくなる。
  */
  /** 全文を開いている書き込み。一覧は3行で切っているので、続きはここで読む */
  const [peek, setPeek] = useState<FeedbackDto | null>(null);

  const marked = useRef(false);
  useEffect(() => {
    if (!ready || marked.current) return;
    marked.current = true;
    void fetch("/api/feedback/seen", { method: "POST" });
  }, [ready]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(editing ? `/api/feedback/${form.id}` : "/api/feedback", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          kind: form.kind,
          priority: form.priority,
          status: form.status,
          reply: form.reply,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setForm({ ...EMPTY_FORM });
      void load();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。ここは消す処理だけ */
  async function onDeleteSelected(targets: FeedbackDto[]) {
    setError(null);
    for (const f of targets) {
      const res = await fetch(`/api/feedback/${f.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (form.id === f.id) setForm({ ...EMPTY_FORM });
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">フィードバック</h1>
      <p className="text-muted-foreground text-sm">
        使ってみて気づいたことを書き留めておく場所です。不具合・要望・質問のどれでもかまいません。
        行をダブルクリックすると上のフォームに読み込まれ、内容やステータスを直せます。
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{form.id ? "編集" : "新規登録"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fb-title">タイトル</Label>
              <Input
                id="fb-title"
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="一覧のフィルターを開いたまま画面を移ると条件が消える"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fb-body">内容</Label>
              <textarea
                id="fb-body"
                required
                rows={5}
                maxLength={5000}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
                placeholder="どの画面で、何をしたら、どうなったかを書いてください"
              />
            </div>

            {form.id !== "" && (
              <div className="space-y-2">
                <Label htmlFor="fb-reply">返事</Label>
                <textarea
                  id="fb-reply"
                  rows={3}
                  maxLength={5000}
                  value={form.reply}
                  onChange={(e) => setForm({ ...form, reply: e.target.value })}
                  className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
                  placeholder="書いた人に伝えたいこと。直したか、直さないか、いつごろになるか"
                />
                <p className="text-muted-foreground text-xs">
                  書くと、一覧の「返事」に出ます。空にすると返事を取り消せます
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label htmlFor="fb-kind">種別</Label>
                <select
                  id="fb-kind"
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as FeedbackKind })}
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
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value as FeedbackPriority })
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
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as FeedbackStatus })}
                  className={cn(SELECT_CLASS, "block w-32")}
                >
                  {FEEDBACK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {FEEDBACK_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? m.common.saving : m.common.save}
                </Button>
                {form.id !== "" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm({ ...EMPTY_FORM })}
                  >
                    {m.common.discard}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <DataTable
        storageKey={STORAGE_KEY}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage="まだ投稿がありません"
        selectable
        onDeleteSelected={onDeleteSelected}
        // 行を押したら全文を出す。表では3行で切っているため
        selectedKey={peek?.id ?? null}
        onRowSelect={(f) => setPeek(f)}
        // 鉛筆で上のフォームに読み込む（システム全体で、鉛筆＝編集に揃えてある）
        rowAction={{
          onClick: (f) => {
            setForm({
              id: f.id,
              title: f.title,
              body: f.body,
              kind: f.kind,
              priority: f.priority,
              status: f.status,
              reply: f.reply ?? "",
            });
            window.scrollTo({ top: 0, behavior: "smooth" });
          },
        }}
        filterLayout={[
          ["title"],
          ["body"],
          ["reply"],
          ["kind", "priority", "status"],
          ["updatedAt"],
        ]}
      />
      <FeedbackPeek item={peek} onClose={() => setPeek(null)} />
    </div>
  );
}
