"use client";

import {
  PUBLISH_STATES,
  emptyTableState,
  pickName,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { batchHref } from "@/lib/doc-batch";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, SubstanceListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

interface Props {
  /** 公開が承認制か（申請ボタンを出すか、発行ボタンを出すかの判断） */
  approvalRequired: boolean;
  /** published=公開済だけ / working=まだ公開されていないもの */
  scope: "published" | "working";
  /** 節の見出し。1つしか出ないときは省く */
  title?: string;
  /** 相手側の表を読み直させるための合図 */
  reloadToken: number;
  onChanged: () => void;
}

export function SubstancesTable({ approvalRequired, scope, title, reloadToken, onChanged }: Props) {
  const { m, locale } = useI18n();
  /* 帳票の相手として選ばれに来ているか（製品の一覧と同じ） */
  const pickFor = useSearchParams().get("pickFor");
  const router = useRouter();
  const { can } = useMe();
  const editable = can("SUBSTANCE_EDIT");

  const columns = useMemo<TableColumn<SubstanceListItemDto>[]>(() => {
    const cols: TableColumn<SubstanceListItemDto>[] = [
      {
        key: "code",
        header: m.substances.code,
        kind: "text",
        // 必須の列。「空白」で絞る意味が無い
        nullable: false,
        // コード20文字・CAS12桁が等幅で収まる最小限の幅にする
        width: 104,
        className: "font-mono text-xs",
        // 押すと詳細へ移る。インベントリ・法規制のコードと同じ形
        render: (r) => (
          <Link
            href={pickFor ? `/documents/${pickFor}/${r.id}` : `/substances/${r.id}`}
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-2"
          >
            {r.code}
          </Link>
        ),
      },
      {
        key: "casNumber",
        header: m.substances.casNumber,
        kind: "text",
        width: 104,
        className: "font-mono text-xs",
        render: (r) => r.casNumber ?? "—",
      },
      {
        key: "nameJa",
        header: m.substances.nameJa,
        kind: "text",
        nullable: false,
        width: 240,
        render: (r) => (
          <>
            {pickName(locale, r.nameJa, r.nameEn)}
            {r.aliasCount > 0 && (
              <span className="text-muted-foreground ml-2 text-xs">+{r.aliasCount}</span>
            )}
          </>
        ),
      },
      {
        key: "nameEn",
        header: m.substances.nameEn,
        kind: "text",
        width: 200,
        className: "text-muted-foreground",
        render: (r) => r.nameEn ?? "",
      },
      {
        key: "status",
        header: m.common.activeHeader,
        kind: "enum",
        // 選択肢の文言（有効/無効）だけで分かるので、フィルターでは列名を出さない
        filterLabelHidden: true,
        width: 72,
        className: "text-center",
        options: [
          { value: "ACTIVE", label: m.substances.statusActive },
          { value: "DISCONTINUED", label: m.substances.statusDiscontinued },
        ],
        render: (r) => (
          <StatusIcon
            active={r.status !== "DISCONTINUED"}
            activeLabel={m.substances.statusActive}
            inactiveLabel={m.substances.statusDiscontinued}
          />
        ),
      },
      {
        key: "publishState",
        header: m.substances.publishState,
        kind: "enum",
        // 状態名はどれも3文字以内。切れない最小限まで詰める
        width: 64,
        className: "px-1 text-center text-xs",
        filterLabelHidden: true,
        options: PUBLISH_STATES.map((v) => ({ value: v, label: m.common.publishStates[v] })),
        // 却下は見落とすと放置されるので、赤の太字で目立たせる
        render: (r) =>
          r.publishState === "REJECTED" ? (
            <span className="text-destructive font-bold">
              {m.common.publishStates[r.publishState]}
            </span>
          ) : (
            m.common.publishStates[r.publishState]
          ),
      },
      {
        key: "numbers",
        header: m.substances.numbers,
        kind: "text",
        width: 150,
        sortable: false,
        filterable: false,
        className: "text-xs",
        // インベントリから引いた番号。呼び名を添えて1セルに複数行で出す
        render: (r) => (
          <div className="space-y-0.5">
            {r.numbers.map((n, k) => (
              <div key={k} className="truncate">
                <span className="text-muted-foreground">{n.label}</span>{" "}
                <span className="font-mono">{n.number}</span>
              </div>
            ))}
          </div>
        ),
      },
      {
        key: "note",
        header: m.substances.note,
        kind: "text",
        width: 200,
        className: "text-muted-foreground text-xs",
        render: (r) => r.note ?? "",
      },
      {
        key: "updatedAt",
        header: m.news.updatedAt,
        kind: "date",
        // 必ず入る列。「空白」で絞る意味が無い
        nullable: false,
        width: 92,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ];
    // 上の表は公開済しか並ばないので、状態の列は出さない（全部同じ値になるため）
    return scope === "working" ? cols : cols.filter((c) => c.key !== "publishState");
  }, [m, locale, scope, pickFor]);

  // 1画面に表が2つあるので、URLのクエリを節ごとに分ける
  const storageKey = `chem.table.substances.${scope}`;
  const { state, setState, reset, ready } = useTableState(
    storageKey,
    columns,
    DEFAULT_STATE,
    scope,
  );

  const [data, setData] = useState<ListResponse<SubstanceListItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = serializeTableState(state, DEFAULT_STATE);
    // 節で決まる条件は利用者が変えられないので、画面の状態とは別にここで足す
    params.set(
      "f.publishState",
      scope === "published" ? "in:PUBLISHED" : "in:DRAFT|PENDING|REJECTED",
    );
    return params.toString();
    // 文字列にしてから依存させることで、同じ条件での再取得を防ぐ
  }, [state, scope]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/substances?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: state.pageSize });
      return;
    }
    setData((await res.json()) as ListResponse<SubstanceListItemDto>);
    // state.pageSize はエラー時の表示にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load, reloadToken]);

  /** 確認は共通テーブル側で出す。ここは消す処理だけ */
  async function onDeleteSelected(targets: SubstanceListItemDto[]) {
    setError(null);
    for (const s of targets) {
      const res = await fetch(`/api/substances/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void load();
  }

  /** 選択した行をまとめて次の状態へ。権限が無いものはサーバー側で飛ばされる */
  async function runBulk(action: "submit" | "publish", targets: SubstanceListItemDto[]) {
    setError(null);
    const res = await fetch("/api/substances/publish-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targets.map((t) => t.id), action }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    const body = (await res.json()) as { updated: number; requested: number };
    if (body.updated < body.requested) {
      setError(m.common.actionDone(body.updated, body.requested));
    }
    onChanged();
  }

  return (
    <div className="w-full space-y-4">
      {/*
        帳票を作る相手を選んでいる最中。**この画面の絞り込みをそのまま使う。**
        選ぶための画面を別に作ると、こちらに条件が増えたときに向こうが取り残される
      */}
      {pickFor && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{m.documents.pickHere}</span>
            <Link href="/doc-templates" className="text-xs underline">
              {m.common.cancel}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey={storageKey}
        title={title ?? m.substances.title}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.substances.empty}
        create={editable && scope === "published" ? { href: "/substances/new" } : undefined}
        /*
          帳票の相手を選びに来ているときは、**誰でも選べる**。
          選ぶのは消すためではなく、まとめて作るためなので、
          編集の権限は要らない
        */
        selectable={editable || !!pickFor}
        onDeleteSelected={pickFor ? undefined : onDeleteSelected}
        bulkAction={
          pickFor
            ? {
                label: m.documents.makeSelected,
                confirm: m.documents.makeSelectedConfirm,
                run: (rows) =>
                  router.push(
                    batchHref(
                      pickFor,
                      rows.map((r) => r.id),
                    ),
                  ),
              }
            : scope === "working"
              ? {
                  label: approvalRequired ? m.common.submitSelected : m.common.publishSelected,
                  confirm: approvalRequired ? m.common.submitConfirm : m.common.publishConfirm,
                  run: (rows) => void runBulk(approvalRequired ? "submit" : "publish", rows),
                }
              : undefined
        }
        // 詳細へはコードのリンクから移る。編集はその画面の「編集」から行う
      />
    </div>
  );
}
