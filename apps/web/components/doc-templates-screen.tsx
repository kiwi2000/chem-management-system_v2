"use client";

import {
  DOCUMENT_TARGETS,
  emptyTableState,
  pickName,
  serializeTableState,
  type ColumnKind,
  type DocumentTarget,
  type TableState,
} from "@chem/shared";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, DocumentTemplateDto, ListResponse } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

/** 既定は通番の順。作った順に並ぶ */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "seq", direction: "asc" }]);

interface Draft {
  code: string;
  nameJa: string;
  nameEn: string;
  target: DocumentTarget;
  locale: string;
  active: boolean;
  note: string;
}
const EMPTY: Draft = {
  code: "",
  nameJa: "",
  nameEn: "",
  target: "PRODUCT",
  locale: "JA",
  active: true,
  note: "",
};

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";
/** 日時。秒までは要らない（一覧で読むのは「いつごろか」） */
function fmt(iso: string, locale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 新しい行の目印。保存するまで id が無い */
const NEW_ID = "__new__";

/** 絞り込みに使える列。サーバー側の `DOC_TEMPLATE_COLUMNS` と鍵をそろえること */
const columnKinds = [
  { key: "code", kind: "text" },
  { key: "nameJa", kind: "text" },
  { key: "nameEn", kind: "text" },
  { key: "target", kind: "enum" },
  { key: "locale", kind: "enum" },
  { key: "active", kind: "enum" },
  { key: "seq", kind: "number" },
  { key: "createdAt", kind: "date" },
  { key: "updatedAt", kind: "date" },
] satisfies { key: string; kind: ColumnKind }[];

/**
 * ドキュメント生成のテンプレートの一覧。
 *
 * **ここで作るのは入れものだけ。**名前・対象・言語まで。
 * ブロックを並べるのは「中身を編集」から別の画面で行う。
 * 1つの画面に混ぜると、名前を直したいだけのときに重い編集画面が開く。
 */
export function DocTemplatesScreen() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const editable = can("DOC_TEMPLATE_EDIT");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [adding, setAdding] = useState(false);

  const [data, setData] = useState<ListResponse<DocumentTemplateDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.docTemplates",
    columnKinds,
    DEFAULT_STATE,
  );
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/doc-templates?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<DocumentTemplateDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  function startNew() {
    setError(null);
    setDraft(EMPTY);
    setAdding(true);
    setEditingId(null);
  }

  function startEdit(t: DocumentTemplateDto) {
    setError(null);
    setAdding(false);
    setEditingId(t.id);
    setDraft({
      code: t.code,
      nameJa: t.nameJa,
      nameEn: t.nameEn ?? "",
      target: t.target,
      locale: t.locale,
      active: t.active,
      note: t.note ?? "",
    });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        code: draft.code,
        nameJa: draft.nameJa,
        nameEn: draft.nameEn || null,
        target: draft.target,
        locale: draft.locale,
        active: draft.active,
        note: draft.note || null,
      };
      const res = await fetch(adding ? "/api/doc-templates" : `/api/doc-templates/${editingId}`, {
        method: adding ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      cancel();
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteSelected(targets: DocumentTemplateDto[]) {
    setError(null);
    for (const t of targets) {
      const res = await fetch(`/api/doc-templates/${t.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void load();
  }

  const editingRow = (t: DocumentTemplateDto) => adding === false && editingId === t.id;

  const columns: TableColumn<DocumentTemplateDto>[] = useMemo(
    () => [
      {
        key: "seq",
        header: m.docTemplates.seq,
        kind: "number",
        width: 64,
        className: "text-right tabular-nums",
        // 自動で振るので、打つ欄は出さない
        render: (t) => (t.id === NEW_ID ? null : t.seq),
      },
      {
        key: "code",
        header: m.docTemplates.code,
        kind: "text",
        nullable: false,
        width: 120,
        className: "font-mono text-xs",
        render: (t) =>
          editingRow(t) || t.id === NEW_ID ? (
            <Input
              className={CELL_INPUT}
              value={draft.code}
              aria-label={m.docTemplates.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
          ) : (
            // 中身の編集へ。ほかの一覧と同じく、コードから入る
            <Link
              href={`/doc-templates/${t.id}`}
              onClick={(e) => e.stopPropagation()}
              className="underline underline-offset-2"
            >
              {t.code}
            </Link>
          ),
      },
      {
        key: "nameJa",
        header: m.docTemplates.nameJa,
        kind: "text",
        nullable: false,
        width: 220,
        render: (t) =>
          editingRow(t) || t.id === NEW_ID ? (
            <Input
              className={CELL_INPUT}
              value={draft.nameJa}
              aria-label={m.docTemplates.nameJa}
              onChange={(e) => setDraft({ ...draft, nameJa: e.target.value })}
            />
          ) : (
            pickName(locale, t.nameJa, t.nameEn)
          ),
      },
      {
        key: "target",
        header: m.docTemplates.target,
        kind: "enum",
        width: 96,
        options: DOCUMENT_TARGETS.map((v) => ({ value: v, label: m.docTemplates.targets[v] })),
        render: (t) =>
          editingRow(t) || t.id === NEW_ID ? (
            <select
              className="border-input h-7 w-full rounded-none border bg-transparent px-1 text-sm"
              value={draft.target}
              aria-label={m.docTemplates.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value as DocumentTarget })}
            >
              {DOCUMENT_TARGETS.map((v) => (
                <option key={v} value={v}>
                  {m.docTemplates.targets[v]}
                </option>
              ))}
            </select>
          ) : (
            m.docTemplates.targets[t.target]
          ),
      },
      {
        key: "blocks",
        header: m.docTemplates.blocks,
        kind: "number",
        width: 88,
        sortable: false,
        filterable: false,
        className: "text-right",
        render: (t) =>
          t.id === NEW_ID ? null : (
            <span className="tabular-nums">{t.contentBroken ? "—" : t.blockCount}</span>
          ),
      },
      {
        key: "locale",
        header: m.docTemplates.locale,
        kind: "enum",
        width: 72,
        options: [
          { value: "JA", label: "JA" },
          { value: "EN", label: "EN" },
        ],
        render: (t) =>
          editingRow(t) || t.id === NEW_ID ? (
            <select
              className="border-input h-7 w-full rounded-none border bg-transparent px-1 text-sm"
              value={draft.locale}
              aria-label={m.docTemplates.locale}
              onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
            >
              <option value="JA">JA</option>
              <option value="EN">EN</option>
            </select>
          ) : (
            t.locale
          ),
      },
      {
        key: "active",
        header: m.docTemplates.active,
        kind: "enum",
        width: 72,
        options: [
          { value: "true", label: m.common.yes },
          { value: "false", label: m.common.no },
        ],
        render: (t) =>
          editingRow(t) || t.id === NEW_ID ? (
            <input
              type="checkbox"
              checked={draft.active}
              aria-label={m.docTemplates.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
          ) : t.active ? (
            m.common.yes
          ) : (
            m.common.no
          ),
      },
      {
        key: "createdAt",
        header: m.docTemplates.createdAt,
        kind: "date",
        width: 132,
        className: "whitespace-nowrap",
        render: (t) => (t.id === NEW_ID ? null : fmt(t.createdAt, locale)),
      },
      {
        key: "updatedAt",
        header: m.docTemplates.updatedAt,
        kind: "date",
        width: 132,
        className: "whitespace-nowrap",
        render: (t) => (t.id === NEW_ID ? null : fmt(t.updatedAt, locale)),
      },
      {
        key: "make",
        header: "",
        kind: "text",
        width: 96,
        sortable: false,
        filterable: false,
        render: (t) =>
          t.id === NEW_ID || !t.active ? null : (
            <Button
              size="sm"
              className="h-7"
              onClick={(e) => {
                e.stopPropagation();
                /*
                  **相手は製品・物質の一覧から選ぶ。**
                  探すための画面を別に作らず、いつも使っている絞り込みを
                  そのまま使えるようにする（保存した条件も効く）
                */
                router.push(
                  `${t.target === "PRODUCT" ? "/products" : "/substances"}?pickFor=${t.id}`,
                );
              }}
            >
              <FileText className="size-4" />
              {m.documents.make}
            </Button>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, locale, draft, adding, editingId],
  );

  const rows: DocumentTemplateDto[] | null =
    data === null
      ? null
      : adding
        ? [{ ...(EMPTY as unknown as DocumentTemplateDto), id: NEW_ID }, ...data.items]
        : data.items;

  /** 直しが要るテンプレート。開く前に気づけるよう、表の上で断る */
  const broken = (data?.items ?? []).filter((t) => t.contentBroken || t.unknownFields.length > 0);

  return (
    <div className="w-full space-y-3 p-3 pb-10 lg:p-4 lg:pb-12">
      <p className="text-muted-foreground text-sm">{m.docTemplates.lead}</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {broken.length > 0 && (
        <Alert>
          <AlertDescription>
            {broken.map((t) => (
              <span key={t.id} className="block">
                {t.code}：
                {t.contentBroken
                  ? m.docTemplates.contentBroken
                  : m.docTemplates.unknownFields(t.unknownFields.length)}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <DataTable
        title={m.docTemplates.title}
        storageKey="chem.table.docTemplates"
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.docTemplates.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        pageSizeOptions={[15, 25, 50, 100]}
        showFilters={false}
        create={editable && !adding && !editingId ? { onClick: startNew } : undefined}
        rowAction={
          editable && !adding && !editingId
            ? { label: m.common.edit, onClick: startEdit }
            : undefined
        }
        headerActions={
          adding || editingId ? (
            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={() => void save()}>
                {saving ? m.common.saving : m.common.save}
              </Button>
              <Button size="sm" variant="outline" onClick={cancel}>
                {m.common.cancel}
              </Button>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
