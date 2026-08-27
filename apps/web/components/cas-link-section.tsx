"use client";

import { emptyTableState, type TableState } from "@chem/shared";
import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { slideClass, type SlideDir } from "@/components/category-header";
import { SubstancePeek } from "@/components/substance-peek";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { VersionSourcePicker, type VersionSource } from "@/components/version-source-picker";
import type {
  ApiError,
  ListResponse,
  StatutoryCasLinkDto,
  StatutorySubstanceDto,
} from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { cn } from "@/lib/utils";

/** 並びはサーバー側で決まっている（CAS → 優先度）ので、表では並べ替えない */
const DEFAULT_STATE: TableState = {
  ...emptyTableState(),
  pageSize: 200,
};

const SELECT_CLASS = "border-input bg-background h-8 rounded-none border px-2 text-sm";

/** 追加・編集の入力欄 */
interface Draft {
  casNumber: string;
  sourceId: string;
  excluded: boolean;
  note: string;
}
const EMPTY: Draft = { casNumber: "", sourceId: "", excluded: false, note: "" };

/** サーバーが返す一覧。どのバージョンを見ているかも一緒に返る */
interface CasLinkResponse extends ListResponse<StatutoryCasLinkDto> {
  version: { id: string; code: string; isCurrent: boolean } | null;
}

/**
 * 法文物質名に結び付いたCAS番号。
 *
 * 同じCASでもデータソースの数だけ行が出る。まとめると、どのデータソースを
 * 直せばよいか分からなくなるため。「使用」の印が付いている行が、
 * 優先度で解いた結果として実際に採られているもの。
 *
 * バージョンとデータソースは普段いじらない（既定は現在のバージョンと、
 * そのバージョンで優先度がいちばん高いデータソース）。
 * 過去のものを見たいときだけ切り替える。
 */
export function CasLinkSection({
  substance,
  picked,
  onPickedChange,
  slideDir,
  onShown,
}: {
  substance: StatutorySubstanceDto;
  /** 見ているバージョンとデータソース。null なら現在のバージョン */
  picked: VersionSource | null;
  /** 切り替えは親が持つ。法文物質名を移っても選んだ組を保つため */
  onPickedChange: (next: VersionSource) => void;
  slideDir: SlideDir;
  /** 新しい法文物質名の中身を出し終えた合図。見出しはこれに合わせて切り替わる */
  onShown?: () => void;
}) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  /** いま画面に出している法文物質名。渡されたものとずれているあいだは前の中身のまま */
  const [shownId, setShownId] = useState<string | null>(null);
  const [data, setData] = useState<CasLinkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 追加中は null 以外。編集中は行のid */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** 覗いている物質。null なら小窓は閉じている */
  const [peekId, setPeekId] = useState<string | null>(null);

  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  /** 先読みで取り終えた問い合わせ。同じものをもう一度投げないための目印 */
  const lastKey = useRef<string | null>(null);

  const columns = useMemo<TableColumn<StatutoryCasLinkDto>[]>(
    () => [
      {
        key: "casNumber",
        header: m.casLinks.casNumber,
        kind: "text",
        width: 130,
        sortable: false,
        filterable: false,
        className: "font-mono text-xs",
        render: (r) => r.casNumber,
      },
      {
        // CAS番号だけでは何なのか分からないので、名前を隣に置く。
        // 名前は物質マスタの代表物質から引く（二重に持たない）
        key: "casName",
        header: m.casLinks.casName,
        kind: "text",
        width: 400,
        sortable: false,
        filterable: false,
        render: (r) => {
          const label =
            (locale === "ja"
              ? (r.substanceNameJa ?? r.substanceNameEn)
              : (r.substanceNameEn ?? r.substanceNameJa)) ?? "";
          // 押すとその物質を覗ける。画面を移らないので、閉じれば元の場所に戻る
          return r.substanceId ? (
            <button
              type="button"
              onClick={() => setPeekId(r.substanceId)}
              className="hover:text-foreground w-full truncate text-left underline-offset-2 hover:underline"
            >
              {label}
            </button>
          ) : (
            label
          );
        },
      },
      {
        key: "excluded",
        header: m.casLinks.status,
        kind: "enum",
        width: 62,
        sortable: false,
        filterable: false,
        className: "text-center text-xs",
        render: (r) => (
          // 非該当は打ち消しの意味なので、色を変えて目に留まるようにする
          <span className={cn(r.excluded && "text-destructive font-medium")}>
            {r.excluded ? m.casLinks.notApplicable : m.casLinks.applicable}
          </span>
        ),
      },
      {
        key: "used",
        header: m.casLinks.used,
        kind: "enum",
        width: 48,
        sortable: false,
        filterable: false,
        className: "text-center",
        // 印が付いている行が、優先度で解いた結果として採られているもの
        render: (r) =>
          r.used ? (
            <Check className="text-primary mx-auto size-4" aria-label={m.casLinks.used} />
          ) : null,
      },
      {
        key: "note",
        header: m.casLinks.note,
        kind: "text",
        width: 240,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        render: (r) => r.note ?? "",
      },
    ],
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.casLinks",
    columns,
    DEFAULT_STATE,
  );

  const fetchLinks = useCallback(async (substanceId: string, vs: VersionSource | null) => {
    const params = new URLSearchParams({ statutorySubstanceId: substanceId });
    if (vs?.versionId) params.set("versionId", vs.versionId);
    if (vs?.sourceId) params.set("sourceId", vs.sourceId);
    const res = await fetch(`/api/statutory-cas-links?${params.toString()}`).catch(() => null);
    if (!res) return null;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return null;
      return null;
    }
    return (await res.json()) as CasLinkResponse;
  }, []);

  /*
    法文物質名が変わったら、中身を取り終えてから画面を入れ替える。
    先に空にすると、行が届くたびに上からぱらぱら出てきて横の動きが見えなくなる。
  */
  useEffect(() => {
    if (!ready) return;
    const key = `${substance.id}/${picked?.versionId ?? ""}/${picked?.sourceId ?? ""}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    let alive = true;
    void (async () => {
      const body = await fetchLinks(substance.id, picked);
      if (!alive) return;
      setData(body ?? { items: [], total: 0, page: 1, pageSize: 0, version: null });
      setShownId(substance.id);
      setEditingId(null);
      onShownRef.current?.();
    })();
    return () => {
      alive = false;
    };
  }, [ready, substance.id, picked, fetchLinks]);

  /** 保存・削除のあとの取り直し。法文物質名は変わらないので中身は消さない */
  const reload = useCallback(async () => {
    const body = await fetchLinks(substance.id, picked);
    if (body) setData(body);
  }, [fetchLinks, substance.id, picked]);

  function startNew() {
    setError(null);
    // 入る先は、表の上で選んでいるバージョンとデータソース
    setDraft({ ...EMPTY, sourceId: picked?.sourceId ?? "" });
    setEditingId("new");
  }

  function startEdit(r: StatutoryCasLinkDto) {
    setError(null);
    setDraft({
      casNumber: r.casNumber,
      sourceId: r.sourceId,
      excluded: r.excluded,
      note: r.note ?? "",
    });
    setEditingId(r.id);
  }

  async function save() {
    const version = data?.version;
    if (!version) return;
    setError(null);
    setSaving(true);
    try {
      const creating = editingId === "new";
      const res = await fetch(
        creating ? "/api/statutory-cas-links" : `/api/statutory-cas-links/${editingId}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            versionId: version.id,
            statutorySubstanceId: substance.id,
            // データソースは表の上で選んだもの。入力欄には出さない
            sourceId: picked?.sourceId ?? draft.sourceId,
            casNumber: draft.casNumber,
            excluded: draft.excluded,
            note: draft.note || null,
          }),
        },
      );
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setEditingId(null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteSelected(targets: StatutoryCasLinkDto[]) {
    setError(null);
    for (const r of targets) {
      const res = await fetch(`/api/statutory-cas-links/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === r.id) setEditingId(null);
    }
    await reload();
  }

  const version = data?.version ?? null;
  const canSave = draft.casNumber.trim() !== "" && !!picked?.sourceId && version !== null;

  return (
    <section key={shownId ?? "empty"} className={cn("space-y-3", slideClass(slideDir))}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {data && version === null && (
        <Alert>
          <AlertDescription>{m.casLinks.noVersion}</AlertDescription>
        </Alert>
      )}

      {/* 追加・編集の欄。項目が4つなので1行に収める */}
      {editable && editingId && (
        <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
          <div className="w-40 space-y-1">
            <Label htmlFor="cl-cas">{m.casLinks.casNumber}</Label>
            <Input
              id="cl-cas"
              maxLength={20}
              value={draft.casNumber}
              onChange={(e) => setDraft({ ...draft, casNumber: e.target.value })}
              className="h-8 font-mono"
              placeholder="7439-92-1"
            />
          </div>
          <div className="w-32 space-y-1">
            <Label htmlFor="cl-status">{m.casLinks.status}</Label>
            <select
              id="cl-status"
              value={draft.excluded ? "1" : "0"}
              onChange={(e) => setDraft({ ...draft, excluded: e.target.value === "1" })}
              className={`${SELECT_CLASS} w-full`}
            >
              <option value="0">{m.casLinks.applicable}</option>
              <option value="1">{m.casLinks.notApplicable}</option>
            </select>
          </div>
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="cl-note">{m.casLinks.note}</Label>
            <Input
              id="cl-note"
              maxLength={2000}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              className="h-8"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!canSave || saving} onClick={() => void save()}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
              {m.common.cancel}
            </Button>
          </div>
        </div>
      )}

      <DataTable
        storageKey="chem.table.casLinks"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.casLinks.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        showFilters={false}
        showPager={false}
        // データソースが決まらないと、足しても入れる先がない
        create={
          editable && !editingId && version && picked?.sourceId ? { onClick: startNew } : undefined
        }
        headerActions={
          /* インベントリの中身と同じ並び・同じ順（バージョン → データソース） */
          <VersionSourcePicker
            value={picked}
            onChange={onPickedChange}
            hint={m.casLinks.usedHint}
          />
        }
        // 編集は行の右端の鉛筆から
        rowAction={
          editable ? { onClick: startEdit, disabled: () => editingId !== null } : undefined
        }
      />

      <SubstancePeek substanceId={peekId} onClose={() => setPeekId(null)} />
    </section>
  );
}
