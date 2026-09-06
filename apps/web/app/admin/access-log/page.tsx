"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { BarChart3, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { countryName } from "@/lib/country-name";
import { useI18n } from "@/lib/i18n-client";
import type { AccessLogDto, ApiError, ListResponse, UserSummaryDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/** 新しいものから。記録を追うときは、まず直近を見る */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "at", direction: "desc" }]);

const STORAGE_KEY = "chem.table.accessLog";

/**
 * アクセス記録。
 *
 * 入口の出来事（ログイン）と、データが外へ出る出来事（組成を見た）を
 * **同じ並びで**出す。分けると
 * 「見慣れない場所から入って、そのあと組成を立て続けに開いた」
 * という流れが見えなくなる。事故のときに、いちばん見たいのがそれ。
 *
 * 種類で絞れば、ログインだけ・持ち出しだけの並びにもなる。
 */
export default function AccessLogPage() {
  const { m, locale } = useI18n();
  const ask = useConfirm();

  /** 誰で絞るかの選択肢。人の名前は利用者の表にしかないので、別に引く */
  const [users, setUsers] = useState<UserSummaryDto[]>([]);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/users?size=200");
      if (res.ok) setUsers(((await res.json()) as ListResponse<UserSummaryDto>).items);
    })();
  }, []);

  const columns = useMemo<TableColumn<AccessLogDto>[]>(
    () => [
      {
        key: "at",
        header: m.accessLog.at,
        kind: "date",
        width: 175,
        className: "text-xs tabular-nums",
        // 日付だけでは足りない。何時何分に起きたかが手がかりになる
        render: (r) => new Date(r.at).toLocaleString(locale),
      },
      {
        key: "action",
        header: m.accessLog.action,
        kind: "enum",
        width: 150,
        options: [
          { value: "login", label: m.accessLog.actionLogin },
          { value: "login_failed", label: m.accessLog.actionLoginFailed },
          { value: "logout", label: m.accessLog.actionLogout },
          { value: "mfa_enable", label: m.accessLog.actionMfaEnable },
          { value: "mfa_disable", label: m.accessLog.actionMfaDisable },
          { value: "passkey_add", label: m.accessLog.actionPasskeyAdd },
          { value: "passkey_remove", label: m.accessLog.actionPasskeyRemove },
          { value: "view", label: m.accessLog.actionView },
          { value: "export", label: m.accessLog.actionExport },
          { value: "import", label: m.accessLog.actionImport },
        ],
        render: (r) => (
          <span className={r.action === "login_failed" ? "text-destructive font-medium" : ""}>
            {actionLabel(m, r)}
          </span>
        ),
      },
      {
        key: "actorId",
        header: m.accessLog.actor,
        kind: "enum",
        width: 130,
        options: users.map((u) => ({ value: u.id, label: u.displayName ?? u.email })),
        // ログインの失敗では利用者が分からないことがある。試されたアドレスを出す
        render: (r) => r.actorName ?? r.email ?? "",
      },
      {
        key: "target",
        header: m.accessLog.target,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 280,
        // ログインなら試されたアドレス、持ち出しなら対象の製品
        render: (r) =>
          r.productName ? (
            <span>
              <span className="text-muted-foreground mr-2 font-mono text-xs">{r.productCode}</span>
              {r.productName}
            </span>
          ) : r.productId ? (
            // 製品が消されても記録は残る。何を見たかは分からなくなる
            <span className="text-muted-foreground text-xs">{m.accessLog.goneProduct}</span>
          ) : (
            <span className="font-mono text-xs">{r.email ?? ""}</span>
          ),
      },
      {
        key: "detail",
        header: m.accessLog.detail,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 175,
        // 失敗なら理由、持ち出しなら件数。列を分けるほどの中身ではない
        render: (r) =>
          r.reason ? (
            reasonLabel(m, r.reason)
          ) : r.lineCount !== null ? (
            <span className="text-muted-foreground text-xs">
              {m.accessLog.lineCount(r.lineCount)}
            </span>
          ) : (
            ""
          ),
      },
      {
        key: "ip",
        header: m.accessLog.ip,
        kind: "text",
        sortable: false,
        // 記録の中をたどって絞る（`access-log-shared.ts`）
        width: 150,
        className: "font-mono text-xs",
        render: (r) => r.ip ?? "",
      },
      {
        // 分かるのは割り当て国であって、その人が今いる場所ではない
        key: "country",
        header: m.accessLog.place,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 110,
        render: (r) => countryName(r.country, locale, { local: m.accessLog.localPlace }),
      },
      {
        key: "userAgent",
        header: m.accessLog.device,
        kind: "text",
        sortable: false,
        /*
          絞るのは**生の文字列**に対して。画面には「Chrome」などに直して出しているので、
          打つ言葉と出ている言葉が違う。入力例を添えて、そのことを伝える
        */
        filterPlaceholder: "Chrome / Windows",
        width: 175,
        className: "text-muted-foreground text-xs",
        // 生の文字列は長いうえに読めない。使っているものだけを出す
        render: (r) => deviceLabel(r.userAgent),
      },
    ],
    [m, locale, users],
  );

  const { state, setState, ready } = useTableState(STORAGE_KEY, columns, DEFAULT_STATE);

  const [data, setData] = useState<ListResponse<AccessLogDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [purgeDays, setPurgeDays] = useState("");

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/access-log?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<AccessLogDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function remove(body: { ids?: string[]; days?: number }, confirmText: string) {
    if (!(await ask({ message: confirmText, destructive: true }))) return;
    setError(null);
    const res = await fetch("/api/admin/access-log", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const e = (await res.json().catch(() => null)) as ApiError | null;
      setError(e?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    const { count } = (await res.json()) as { count: number };
    setNotice(m.accessLog.removed(count));
    await load();
  }

  /*
    何日ぶん残すかは、その時々で違う。決め打ちのボタンを並べるより、
    打ってもらうほうが早い。**数字だけ**受け取る（`inputMode` はスマホ用）
  */
  const days = Number(purgeDays);
  const daysOk = /^\d+$/.test(purgeDays) && days >= 1;

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground mt-1 text-sm">{m.accessLog.lead}</p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/admin/access-log/stats" />}
        >
          <BarChart3 className="mr-1 size-4" />
          {m.accessLog.analysis}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <DataTable
        title={m.accessLog.title}
        storageKey={STORAGE_KEY}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.accessLog.empty}
        selectable
        onDeleteSelected={(rows) =>
          void remove({ ids: rows.map((r) => r.id) }, m.accessLog.confirmSelected(rows.length))
        }
        headerActions={
          /* 古い記録は溜まる一方なので、日数を打ってまとめて消せるようにする */
          <div className="flex items-center gap-1.5">
            <Input
              value={purgeDays}
              onChange={(e) => setPurgeDays(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="h-8 w-16 text-right"
              aria-label={m.accessLog.purgeDays}
            />
            <span className="text-muted-foreground text-sm whitespace-nowrap">
              {m.accessLog.purgeLabel}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!daysOk}
              onClick={() => {
                void remove({ days }, m.accessLog.confirmDays(days));
                setPurgeDays("");
              }}
            >
              <Trash2 className="mr-1 size-3.5" />
              {m.accessLog.purgeRun}
            </Button>
          </div>
        }
      />
    </div>
  );
}

type M = ReturnType<typeof useI18n>["m"];

/** 何が起きたか。組成は「見た」だけでも持ち出しなので、展開したかどうかまで出す */
function actionLabel(m: M, r: AccessLogDto): string {
  switch (r.action) {
    case "login":
      return m.accessLog.actionLogin;
    case "login_failed":
      return m.accessLog.actionLoginFailed;
    case "logout":
      return m.accessLog.actionLogout;
    case "mfa_enable":
      return m.accessLog.actionMfaEnable;
    case "mfa_disable":
      return m.accessLog.actionMfaDisable;
    case "passkey_add":
      return m.accessLog.actionPasskeyAdd;
    case "passkey_remove":
      return m.accessLog.actionPasskeyRemove;
    case "export":
      return m.accessLog.actionExport;
    case "import":
      return m.accessLog.actionImport;
    default:
      return r.expanded ? m.accessLog.actionViewExpanded : m.accessLog.actionView;
  }
}

/** 失敗の理由。管理者が次に何をすべきかが分かる言葉にする */
function reasonLabel(m: M, reason: string): string {
  const table: Record<string, string> = {
    unknown_user: m.accessLog.reasonUnknownUser,
    inactive: m.accessLog.reasonInactive,
    locked_out: m.accessLog.reasonLockedOut,
    locked_now: m.accessLog.reasonLockedNow,
    bad_password: m.accessLog.reasonBadPassword,
    bad_totp: m.accessLog.reasonBadTotp,
  };
  return table[reason] ?? reason;
}

/**
 * 使っている機械のあらまし。
 * 生の文字列は長すぎて表に入らないので、見て分かるところだけ拾う。
 * 「いつもWindowsの人が、急にスマートフォンから」に気づければ足りる。
 */
function deviceLabel(ua: string | null): string {
  if (!ua) return "";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone / iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return [os, browser].filter(Boolean).join(" / ") || ua.slice(0, 40);
}
