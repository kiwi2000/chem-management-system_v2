"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { countryName } from "@/lib/country-name";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, LoginLogDto, UserSummaryDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/** 新しいものから。記録を追うときは、まず直近を見る */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "at", direction: "desc" }]);

/**
 * ログインの記録。
 *
 * 「誰かが他人のパスワードを試している」に気づくための画面。
 * 成功だけを見ても分からないので、**失敗と、その理由まで**出す。
 * 入力されたパスワードは記録していない（記録そのものが漏れる元になるため）。
 */
export default function LoginLogPage() {
  const { m, locale } = useI18n();

  /** 誰で絞るかの選択肢。人の名前は利用者の表にしかないので、別に引く */
  const [users, setUsers] = useState<UserSummaryDto[]>([]);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/users?size=200");
      if (res.ok) setUsers(((await res.json()) as ListResponse<UserSummaryDto>).items);
    })();
  }, []);

  const columns = useMemo<TableColumn<LoginLogDto>[]>(
    () => [
      {
        key: "at",
        header: m.loginLog.at,
        kind: "date",
        width: 175,
        className: "text-xs tabular-nums",
        // 日付だけでは足りない。何時何分に試されたかが手がかりになる
        render: (r) => new Date(r.at).toLocaleString(locale),
      },
      {
        key: "action",
        header: m.loginLog.result,
        kind: "enum",
        width: 110,
        options: [
          { value: "login", label: m.loginLog.success },
          { value: "login_failed", label: m.loginLog.failed },
          { value: "logout", label: m.loginLog.logout },
        ],
        render: (r) => (
          <span className={r.action === "login_failed" ? "text-destructive font-medium" : ""}>
            {resultLabel(m, r.action)}
          </span>
        ),
      },
      {
        key: "email",
        header: m.loginLog.email,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 230,
        className: "font-mono text-xs",
        render: (r) => r.email ?? "",
      },
      {
        key: "actorId",
        header: m.loginLog.actor,
        kind: "enum",
        width: 130,
        options: users.map((u) => ({ value: u.id, label: u.displayName ?? u.email })),
        render: (r) => r.actorName ?? "",
      },
      {
        key: "reason",
        header: m.loginLog.reason,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 175,
        render: (r) => (r.reason ? reasonLabel(m, r.reason) : ""),
      },
      {
        key: "ip",
        header: m.loginLog.ip,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 150,
        className: "font-mono text-xs",
        render: (r) => r.ip ?? "",
      },
      {
        // 場所は「見慣れない国から入られていないか」に気づくためのもの。
        // 分かるのは割り当て国であって、その人が今いる場所ではない
        key: "country",
        header: m.loginLog.place,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 110,
        render: (r) => countryName(r.country, locale, { local: m.loginLog.localPlace }),
      },
      {
        key: "userAgent",
        header: m.loginLog.device,
        kind: "text",
        sortable: false,
        filterable: false,
        width: 200,
        className: "text-muted-foreground text-xs",
        // 生の文字列は長いうえに読めない。使っているものだけを出す
        render: (r) => deviceLabel(r.userAgent),
      },
    ],
    [m, locale, users],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.loginLog",
    columns,
    DEFAULT_STATE,
  );

  const [data, setData] = useState<ListResponse<LoginLogDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/login-log?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<LoginLogDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{m.loginLog.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{m.loginLog.lead}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.loginLog"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.loginLog.empty}
      />
    </div>
  );
}

type M = ReturnType<typeof useI18n>["m"];

function resultLabel(m: M, action: string): string {
  if (action === "login") return m.loginLog.success;
  if (action === "logout") return m.loginLog.logout;
  return m.loginLog.failed;
}

/** 失敗の理由。管理者が次に何をすべきかが分かる言葉にする */
function reasonLabel(m: M, reason: string): string {
  const table: Record<string, string> = {
    unknown_user: m.loginLog.reasonUnknownUser,
    inactive: m.loginLog.reasonInactive,
    locked_out: m.loginLog.reasonLockedOut,
    locked_now: m.loginLog.reasonLockedNow,
    bad_password: m.loginLog.reasonBadPassword,
    bad_totp: m.loginLog.reasonBadTotp,
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
