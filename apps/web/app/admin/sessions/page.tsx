"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, SessionDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/** 状態の色。信号と同じ緑・黄・赤。表の丸と絞り込みのボタンで同じ色を使う */
const STATUS_COLOR = {
  active: "#22c55e",
  idle: "#eab308",
  ended: "#ef4444",
} as const;

/** 最後に動いた人から。誰がいま使っているかを見る画面なので */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "lastSeenAt", direction: "desc" }]);

/**
 * ログイン中の利用者。**いま生きているセッション**を1行ずつ並べる。
 *
 * 同じ人が2つの端末から入っていれば2行。行を選んで「ログアウトさせる」と、
 * その端末のログインが切れる（相手の画面には理由が出る）。
 * メンテナンスに入る前に、誰が使っているかを見る・全員を落とすのに使う。
 */
export default function SessionsPage() {
  const { m, locale } = useI18n();

  /** 状態の言葉。切れた理由もここから引く */
  const reasonLabel = useCallback(
    (r: string | null) =>
      r === "logout"
        ? m.sessions.reasonLogout
        : r === "idle"
          ? m.sessions.reasonIdle
          : r === "expired"
            ? m.sessions.reasonExpired
            : r === "settings"
              ? m.sessions.reasonSettings
              : r === "maintenance"
                ? m.sessions.reasonMaintenance
                : r === "admin"
                  ? m.sessions.reasonAdmin
                  : "",
    [m],
  );

  const columns = useMemo<TableColumn<SessionDto>[]>(
    () => [
      {
        /*
          状態は先頭に。**信号と同じ、塗りつぶしの丸だけ**で示す。
          緑＝アクティブ、黄＝休止中（次の操作で切れる）、赤＝終了
        */
        key: "status",
        header: m.sessions.status,
        kind: "enum",
        nullable: false,
        width: 80,
        sortable: false,
        // 絞り込みはボタンの並び。押すと、表の丸と同じ色が付く
        filterAsButtons: true,
        options: [
          { value: "active", label: m.sessions.statusActive, color: STATUS_COLOR.active },
          { value: "idle", label: m.sessions.statusIdle, color: STATUS_COLOR.idle },
          { value: "ended", label: m.sessions.statusEnded, color: STATUS_COLOR.ended },
        ],
        className: "text-center",
        render: (s) => {
          // 文字は出さない。信号と同じ色の塗りつぶしの丸だけ（言葉はマウスを置いたときと読み上げ用）
          const label =
            s.status === "active"
              ? m.sessions.statusActive
              : s.status === "idle"
                ? m.sessions.statusIdle
                : m.sessions.statusEnded;
          return (
            <span
              role="img"
              aria-label={label}
              title={label}
              className="inline-block size-3.5 rounded-full"
              style={{ backgroundColor: STATUS_COLOR[s.status] }}
            />
          );
        },
      },
      {
        key: "email",
        header: m.sessions.email,
        kind: "text",
        nullable: false,
        width: 220,
        sortable: false,
        render: (s) => (
          <span className="font-mono text-xs">
            {s.email}
            {/* 自分の行。切ると自分が追い出されるので、印を付けておく */}
            {s.isCurrent && (
              <Badge variant="secondary" className="ml-2">
                {m.sessions.current}
              </Badge>
            )}
          </span>
        ),
      },
      {
        key: "displayName",
        header: m.sessions.displayName,
        kind: "text",
        width: 140,
        sortable: false,
        render: (s) => (
          <span>
            {s.displayName ?? ""}
            {s.isAdmin && (
              <Badge variant="outline" className="ml-2">
                {m.sessions.admin}
              </Badge>
            )}
          </span>
        ),
      },
      {
        key: "createdAt",
        header: m.sessions.loggedInAt,
        kind: "date",
        nullable: false,
        width: 165,
        className: "text-xs tabular-nums",
        render: (s) => new Date(s.createdAt).toLocaleString(locale),
      },
      {
        key: "lastSeenAt",
        header: m.sessions.lastSeenAt,
        kind: "date",
        nullable: false,
        width: 165,
        className: "text-xs tabular-nums",
        render: (s) => new Date(s.lastSeenAt).toLocaleString(locale),
      },
      {
        // 終わった日時と理由。生きている行は空
        key: "endedAt",
        header: m.sessions.endedAt,
        kind: "date",
        width: 230,
        className: "text-muted-foreground text-xs tabular-nums",
        render: (s) =>
          s.endedAt
            ? `${new Date(s.endedAt).toLocaleString(locale)} ${reasonLabel(s.endedReason)}`
            : s.status === "ended"
              ? reasonLabel(s.endedReason)
              : "",
      },
      {
        key: "expiresAt",
        header: m.sessions.expiresAt,
        kind: "date",
        nullable: false,
        width: 165,
        className: "text-muted-foreground text-xs tabular-nums",
        render: (s) => new Date(s.expiresAt).toLocaleString(locale),
      },
      {
        key: "ipAddress",
        header: m.sessions.ip,
        kind: "text",
        width: 130,
        className: "font-mono text-xs",
        render: (s) => s.ipAddress ?? "",
      },
      {
        key: "userAgent",
        header: m.sessions.device,
        kind: "text",
        width: 320,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        clampLines: 2,
        render: (s) => s.userAgent ?? "",
      },
    ],
    [m, locale, reasonLabel],
  );

  const { state, setState, ready } = useTableState("chem.table.sessions", columns, DEFAULT_STATE);
  const [data, setData] = useState<ListResponse<SessionDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/sessions?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: state.pageSize });
      return;
    }
    setData((await res.json()) as ListResponse<SessionDto>);
    // state.pageSize はエラー時の表示にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // 誰かが入った・出たはすぐ変わるので、開いているあいだは 30 秒おきに取り直す
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [ready, load]);

  /** 選んだセッションを切る。確認は共通テーブル側で出す。終わっているものは飛ばす */
  async function endSelected(targets: SessionDto[]) {
    setError(null);
    for (const s of targets.filter((t) => t.status !== "ended")) {
      const res = await fetch(`/api/admin/sessions/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        break;
      }
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <p className="text-muted-foreground text-sm">{m.sessions.description}</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        title={m.sessions.title}
        storageKey="chem.table.sessions"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(s) => s.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.sessions.empty}
        // 終わった行は薄く。生きているものと見分けるため
        rowClassName={(s) => (s.status === "ended" ? "text-muted-foreground" : undefined)}
        selectable
        // 消すのではなく「ログアウトさせる」。ごみ箱ではなく、その言葉のボタンにする
        bulkAction={{
          label: m.sessions.endSelected,
          confirm: (n) => m.sessions.endSelectedConfirm(n),
          run: endSelected,
        }}
        filterLayout={[
          ["status"],
          ["email", "displayName"],
          ["ipAddress"],
          ["createdAt", "lastSeenAt", "endedAt"],
        ]}
      />
    </div>
  );
}
