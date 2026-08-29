"use client";

import {
  emptyTableState,
  formatThreshold,
  pickStatutoryName,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import {
  DEFAULT_THRESHOLD,
  Field,
  NameFields,
  ThresholdFields,
  type NameDraft,
  type ThresholdDraft,
} from "@/components/law-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { slideClass, type SlideDir } from "@/components/category-header";
import type {
  ApiError,
  LanguageDto,
  ListResponse,
  RegulationCategoryDto,
  RegulationClassDto,
  StatutorySubstanceDto,
} from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { cn } from "@/lib/utils";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

interface Draft extends NameDraft, ThresholdDraft {
  code: string;
  officialNumber: string;
  displayOrder: number;
  effectiveFrom: string;
  effectiveTo: string;
  applicableCondition: string;
  note: string;
}
const EMPTY: Draft = {
  code: "",
  officialNumber: "",
  nameOriginal: "",
  nameLang: "",
  nameJa: "",
  nameEn: "",
  ...DEFAULT_THRESHOLD,
  displayOrder: 0,
  effectiveFrom: "",
  effectiveTo: "",
  applicableCondition: "",
  note: "",
};

interface ClassDraft extends NameDraft {
  id: string | null;
  code: string;
}

const named = (c: RegulationClassDto) => c.nameOriginal !== null;

/**
 * 法文物質名と、その上に載る分類のタブ。
 *
 * 分類は、区分を分けないときも中では1件ある（表示名が空の受け皿）。
 * その1件だけのときはタブを出さない。利用者から見れば「分けたときだけ分類が出る」ことになる。
 */
export function StatutorySubstanceSection({
  languages,
  category,
  slideDir,
  onShown,
}: {
  languages: LanguageDto[];
  category: RegulationCategoryDto | null;
  /** 区分が入れ替わったときに滑らせる向き。1画面1段のときは要らない */
  slideDir?: SlideDir;
  /** 新しい区分の中身を画面に出したときに呼ぶ。見出しはこれに合わせて切り替わる */
  onShown?: () => void;
}) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [classes, setClasses] = useState<RegulationClassDto[]>([]);
  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [classDraft, setClassDraft] = useState<ClassDraft | null>(null);
  /**
   * いま画面に出している区分。渡された区分とずれているあいだは前の中身を出したままにする。
   * 先に空にしてしまうと、行が届くたびに上からぱらぱら出てきて、横の動きが見えなくなる。
   */
  const [shownId, setShownId] = useState<string | null>(null);

  const [data, setData] = useState<ListResponse<StatutorySubstanceDto> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<StatutorySubstanceDto>[]>(
    () => [
      {
        key: "displayOrder",
        header: m.statutorySubstances.displayOrder,
        kind: "number",
        width: 56,
        className: "text-muted-foreground text-right font-mono text-xs",
        render: (s) => s.displayOrder,
      },
      {
        key: "officialNumber",
        header: m.statutorySubstances.officialNumber,
        kind: "text",
        width: 90,
        className: "font-mono text-xs",
        render: (s) => s.officialNumber ?? "",
      },
      {
        key: "code",
        header: m.statutorySubstances.code,
        kind: "text",
        width: 110,
        className: "font-mono text-xs",
        // 押すと対象CASへ移る。インベントリのコードと同じ形
        render: (s) => (
          <Link
            href={`/statutory-substances/${s.id}`}
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-2"
          >
            {s.code}
          </Link>
        ),
      },
      {
        key: "nameJa",
        header: m.statutorySubstances.title,
        kind: "text",
        width: 320,
        render: (s) => pickStatutoryName(locale, s.nameOriginal, s.nameJa, s.nameEn),
      },
      {
        key: "threshold",
        header: m.statutorySubstances.threshold,
        kind: "text",
        width: 130,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground font-mono text-xs",
        render: (s) =>
          formatThreshold(s.thresholdLower, s.lowerBound, s.thresholdUpper, s.upperBound),
      },
      {
        key: "applicableCondition",
        header: m.statutorySubstances.applicableCondition,
        kind: "text",
        width: 220,
        className: "text-muted-foreground text-xs",
        render: (s) => s.applicableCondition ?? "",
      },
      {
        key: "casCount",
        header: m.statutorySubstances.casCount,
        kind: "number",
        width: 70,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-right text-xs",
        render: (s) => s.casCount,
      },
    ],
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.statutorySubstances",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => {
    const params = serializeTableState(state, DEFAULT_STATE);
    if (activeClassId) params.set("f.classId", `in:${activeClassId}`);
    return params.toString();
  }, [state, activeClassId]);

  /** 区分を先読みするときに、いまの並び・絞り込みを引き継ぐために覗く */
  const stateRef = useRef(state);
  stateRef.current = state;
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  /** 先読みで取り終えた問い合わせ。同じものをもう一度投げないための目印 */
  const lastQuery = useRef<string | null>(null);

  const fetchClasses = useCallback(async (categoryId: string) => {
    const res = await fetch(`/api/regulation-classes?categoryId=${categoryId}`).catch(() => null);
    if (!res || !res.ok) return null;
    return ((await res.json()) as { items: RegulationClassDto[] }).items;
  }, []);

  /** 分類のタブを取り直す（保存・削除のあと）。区分は変わらないので中身は消さない */
  const reloadClasses = useCallback(async () => {
    if (!category) return;
    const items = await fetchClasses(category.id);
    if (!items) return;
    setClasses(items);
    // 選んでいた分類が消えていたら、先頭に戻す
    setActiveClassId((prev) =>
      prev && items.some((c) => c.id === prev) ? prev : (items[0]?.id ?? null),
    );
  }, [category, fetchClasses]);

  const load = useCallback(async () => {
    if (!activeClassId) {
      setData(null);
      return;
    }
    setError(null);
    const res = await fetch(`/api/statutory-substances?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<StatutorySubstanceDto>);
  }, [query, activeClassId, m]);

  /**
   * 区分の切り替え。分類と1ページ目を裏で読み終えてから、まとめて差し替える。
   * 差し替えは1回の描き直しで済むので、表は出来上がった形のまま横から滑り込む。
   */
  useEffect(() => {
    if (!ready) return;
    const id = category?.id ?? null;
    if (id === shownId) return;
    if (id === null) {
      setClasses([]);
      setActiveClassId(null);
      setData(null);
      setShownId(null);
      lastQuery.current = null;
      onShownRef.current?.();
      return;
    }
    let alive = true;
    void (async () => {
      const items = await fetchClasses(id);
      const first = items?.[0]?.id ?? null;
      // 区分ごとに件数が違うので、ページは先頭に戻す
      const params = serializeTableState({ ...stateRef.current, page: 1 }, DEFAULT_STATE);
      if (first) params.set("f.classId", `in:${first}`);
      const res = first
        ? await fetch(`/api/statutory-substances?${params}`).catch(() => null)
        : null;
      const rows =
        res && res.ok ? ((await res.json()) as ListResponse<StatutorySubstanceDto>) : null;
      if (!alive) return;
      setClasses(items ?? []);
      setActiveClassId(first);
      setData(rows);
      setError(null);
      setEditingId(null);
      setClassDraft(null);
      lastQuery.current = params.toString();
      setState((prev) => ({ ...prev, page: 1 }));
      setShownId(id);
      onShownRef.current?.();
    })();
    return () => {
      alive = false;
    };
    // setState は毎回作り直されるので入れない（区分が変わったときだけ動かす）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, category, shownId, fetchClasses]);

  // 並べ替え・絞り込み・分類のタブを変えたとき。切り替えの最中は触らない
  useEffect(() => {
    if (!ready || !category || category.id !== shownId) return;
    if (lastQuery.current === query) return;
    lastQuery.current = query;
    void load();
  }, [ready, category, shownId, query, load]);

  // ---- 分類 ----

  const showTabs = classes.length > 1 || (classes.length === 1 && named(classes[0]!));

  /**
   * 分けていない区分に初めて名前を付けるときは、いまある受け皿に名前を付ける。
   * こうすると、ぶら下がっている法文物質名を動かさずに分けられる。
   */
  function startAddClass() {
    const only = classes.length === 1 ? classes[0] : undefined;
    if (only && !named(only)) {
      setClassDraft({
        id: only.id,
        code: only.code,
        ...toNameDraft(only, languages[0]?.code ?? ""),
      });
      return;
    }
    setClassDraft({
      id: null,
      code: `CLS${classes.length + 1}`,
      nameOriginal: "",
      nameLang: languages[0]?.code ?? "",
      nameJa: "",
      nameEn: "",
    });
  }

  function startEditClass(c: RegulationClassDto) {
    setClassDraft({ id: c.id, code: c.code, ...toNameDraft(c, languages[0]?.code ?? "") });
  }

  async function saveClass(e: React.FormEvent) {
    e.preventDefault();
    if (!classDraft || !category) return;
    setError(null);
    setSaving(true);
    try {
      const creating = classDraft.id === null;
      const res = await fetch(
        creating ? "/api/regulation-classes" : `/api/regulation-classes/${classDraft.id}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: classDraft.code,
            categoryId: category.id,
            nameOriginal: classDraft.nameOriginal || null,
            nameLang: classDraft.nameOriginal ? classDraft.nameLang : null,
            nameJa: classDraft.nameJa || null,
            nameEn: classDraft.nameEn || null,
            displayOrder: classes.length,
          }),
        },
      );
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setClassDraft(null);
      await reloadClasses();
    } finally {
      setSaving(false);
    }
  }

  /**
   * 分類を消す。
   *
   * 最後の1つだけは本当には消さない。区分は必ず分類を1件持つ決まりなので、
   * 名前だけを空にして受け皿に戻す。利用者から見れば「分けるのをやめた」だけで、
   * ぶら下がっている法文物質名はそのまま残る。
   */
  async function deleteClass() {
    if (!classDraft?.id || !category) return;
    const target = classes.find((c) => c.id === classDraft.id);
    if (!target) return;
    const label = pickStatutoryName(locale, target.nameOriginal, target.nameJa, target.nameEn);
    const last = classes.length === 1;
    const ask = last ? m.regulationClasses.undivideConfirm : m.regulationClasses.deleteConfirm;
    if (!confirm(ask(label, target.substanceCount))) return;

    setError(null);
    const res = await fetch(
      `/api/regulation-classes/${classDraft.id}`,
      last
        ? {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: target.code,
              categoryId: category.id,
              nameOriginal: null,
              nameLang: null,
              nameJa: null,
              nameEn: null,
              displayOrder: target.displayOrder,
            }),
          }
        : { method: "DELETE" },
    );
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    setClassDraft(null);
    await reloadClasses();
  }

  // ---- 法文物質名 ----

  function startNew() {
    setError(null);
    // 閾値は区分の既定を複写する。以後この行だけで完結し、区分を変えても伝わらない
    setDraft({
      ...EMPTY,
      nameLang: languages[0]?.code ?? "",
      thresholdLower: category?.thresholdLower ?? DEFAULT_THRESHOLD.thresholdLower,
      lowerBound: category?.lowerBound ?? DEFAULT_THRESHOLD.lowerBound,
      thresholdUpper: category?.thresholdUpper ?? DEFAULT_THRESHOLD.thresholdUpper,
      upperBound: category?.upperBound ?? DEFAULT_THRESHOLD.upperBound,
      displayOrder: (data?.total ?? 0) + 1,
    });
    setEditingId("new");
  }

  function startEdit(s: StatutorySubstanceDto) {
    setError(null);
    setDraft({
      code: s.code,
      officialNumber: s.officialNumber ?? "",
      nameOriginal: s.nameOriginal,
      nameLang: s.nameLang,
      nameJa: s.nameJa ?? "",
      nameEn: s.nameEn ?? "",
      thresholdLower: s.thresholdLower,
      lowerBound: s.lowerBound,
      thresholdUpper: s.thresholdUpper,
      upperBound: s.upperBound,
      displayOrder: s.displayOrder,
      effectiveFrom: s.effectiveFrom ?? "",
      effectiveTo: s.effectiveTo ?? "",
      applicableCondition: s.applicableCondition ?? "",
      note: s.note ?? "",
    });
    setEditingId(s.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!activeClassId) return;
    setError(null);
    setSaving(true);
    try {
      const creating = editingId === "new";
      const res = await fetch(
        creating ? "/api/statutory-substances" : `/api/statutory-substances/${editingId}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: draft.code,
            classId: activeClassId,
            officialNumber: draft.officialNumber || null,
            nameOriginal: draft.nameOriginal,
            nameLang: draft.nameLang,
            nameJa: draft.nameJa || null,
            nameEn: draft.nameEn || null,
            thresholdLower: draft.thresholdLower,
            lowerBound: draft.lowerBound,
            thresholdUpper: draft.thresholdUpper,
            upperBound: draft.upperBound,
            displayOrder: Number(draft.displayOrder) || 0,
            effectiveFrom: draft.effectiveFrom || null,
            effectiveTo: draft.effectiveTo || null,
            applicableCondition: draft.applicableCondition || null,
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
      void load();
      void reloadClasses();
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteSelected(targets: StatutorySubstanceDto[]) {
    setError(null);
    for (const s of targets) {
      const res = await fetch(`/api/statutory-substances/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === s.id) setEditingId(null);
    }
    void load();
    void reloadClasses();
  }

  return (
    // 見出し（法律名・区分名・件数）は上に固定された見出しが受け持つので、ここには置かない。
    // key を区分ごとに変えて、出来上がった表がまるごと横から滑り込むようにする
    <section key={shownId ?? "empty"} className={cn("space-y-3", slideClass(slideDir ?? null))}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {category && (
        <div className="flex flex-wrap items-center gap-1 border-b">
          {showTabs &&
            classes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveClassId(c.id)}
                onDoubleClick={editable ? () => startEditClass(c) : undefined}
                className={cn(
                  "-mb-px rounded-t-md border border-b-0 px-3 py-1.5 text-sm transition-colors",
                  activeClassId === c.id
                    ? "bg-background text-foreground border-border font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {named(c)
                  ? pickStatutoryName(locale, c.nameOriginal, c.nameJa, c.nameEn)
                  : m.regulationClasses.unnamed}
                <span className="text-muted-foreground ml-1.5 text-xs">{c.substanceCount}</span>
              </button>
            ))}
          {editable && (
            <button
              type="button"
              onClick={startAddClass}
              title={m.regulationClasses.add}
              aria-label={m.regulationClasses.add}
              className="text-muted-foreground hover:text-foreground -mb-px flex items-center gap-1 px-2 py-1.5 text-sm"
            >
              <Plus className="size-4" />
              {m.regulationClasses.title}
            </button>
          )}
        </div>
      )}

      {classDraft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {classDraft.id ? m.regulationClasses.editTitle : m.regulationClasses.addTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveClass} className="space-y-3">
              <div className="flex flex-wrap items-start gap-3">
                <NameFields
                  languages={languages}
                  locale={locale}
                  idPrefix="cls"
                  labels={{
                    nameOriginal: m.regulationClasses.name,
                    nameLang: m.regulationCategories.nameLang,
                    nameJa: m.regulationCategories.nameJa,
                    nameEn: m.regulationCategories.nameEn,
                  }}
                  value={classDraft}
                  onChange={(v) => setClassDraft({ ...classDraft, ...v })}
                  originalRequired={false}
                />
              </div>
              <p className="text-muted-foreground text-xs">{m.regulationClasses.hint}</p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setClassDraft(null)}
                >
                  {m.common.cancel}
                </Button>
                {/* 1つしか無くても出す。中では受け皿に戻すだけで、消えるわけではない */}
                {classDraft.id && (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="ml-auto size-8"
                    title={m.common.delete}
                    aria-label={m.common.delete}
                    onClick={() => void deleteClass()}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {editable && editingId && activeClassId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingId === "new"
                ? m.statutorySubstances.newTitle
                : m.statutorySubstances.editTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <div className="flex flex-wrap items-start gap-3">
                <Field label={m.statutorySubstances.code} htmlFor="sub-code" className="w-40">
                  <Input
                    id="sub-code"
                    required
                    maxLength={50}
                    value={draft.code}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                    className="font-mono"
                  />
                </Field>
                <Field
                  label={m.statutorySubstances.officialNumber}
                  htmlFor="sub-official"
                  hint={m.statutorySubstances.officialNumberHint}
                  className="w-40"
                >
                  <Input
                    id="sub-official"
                    maxLength={50}
                    value={draft.officialNumber}
                    onChange={(e) => setDraft({ ...draft, officialNumber: e.target.value })}
                    className="font-mono"
                  />
                </Field>
                <Field
                  label={m.statutorySubstances.displayOrder}
                  htmlFor="sub-order"
                  className="w-20"
                >
                  <Input
                    id="sub-order"
                    type="number"
                    min={0}
                    max={99999}
                    value={draft.displayOrder}
                    onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) })}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-start gap-3">
                <NameFields
                  languages={languages}
                  locale={locale}
                  idPrefix="sub"
                  labels={{
                    nameOriginal: m.statutorySubstances.nameOriginal,
                    nameLang: m.statutorySubstances.nameLang,
                    nameJa: m.statutorySubstances.nameJa,
                    nameEn: m.statutorySubstances.nameEn,
                  }}
                  value={draft}
                  onChange={(v) => setDraft({ ...draft, ...v })}
                />
              </div>

              <ThresholdFields
                idPrefix="sub"
                label={m.statutorySubstances.threshold}
                hint={m.statutorySubstances.thresholdHint}
                lowerLabel={m.statutorySubstances.lower}
                upperLabel={m.statutorySubstances.upper}
                bounds={m.regulationCategories.bounds}
                middleLabel={m.regulationCategories.content}
                value={draft}
                onChange={(v) => setDraft({ ...draft, ...v })}
              />

              <div className="flex flex-wrap items-start gap-3">
                <Field
                  label={m.statutorySubstances.effectiveFrom}
                  htmlFor="sub-from"
                  className="w-40"
                >
                  <Input
                    id="sub-from"
                    type="date"
                    value={draft.effectiveFrom}
                    onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
                  />
                </Field>
                <Field
                  label={m.statutorySubstances.effectiveTo}
                  htmlFor="sub-to"
                  hint={m.statutorySubstances.effectiveHint}
                  className="w-40"
                >
                  <Input
                    id="sub-to"
                    type="date"
                    value={draft.effectiveTo}
                    onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })}
                  />
                </Field>
              </div>

              <Field
                label={m.statutorySubstances.applicableCondition}
                htmlFor="sub-condition"
                hint={m.statutorySubstances.applicableConditionHint}
              >
                <Input
                  id="sub-condition"
                  maxLength={2000}
                  value={draft.applicableCondition}
                  onChange={(e) => setDraft({ ...draft, applicableCondition: e.target.value })}
                />
              </Field>

              <Field
                label={m.statutorySubstances.note}
                htmlFor="sub-note"
                hint={m.statutorySubstances.noteHint}
              >
                <Input
                  id="sub-note"
                  maxLength={2000}
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                />
              </Field>

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingId(null)}
                >
                  {m.common.cancel}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <DataTable
        storageKey="chem.table.statutorySubstances"
        columns={columns}
        rows={activeClassId ? (data?.items ?? null) : []}
        rowKey={(s) => s.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={category ? m.statutorySubstances.empty : m.statutorySubstances.selectCategory}
        selectable={editable && !!activeClassId}
        onDeleteSelected={onDeleteSelected}
        /*
          編集は行の右端の鉛筆から。**対象CASへはコードのリンクで移る。**
          行そのものを押しても移らない（ほかの一覧と揃えてある）
        */
        rowAction={editable ? { onClick: startEdit } : undefined}
        hintText={m.statutorySubstances.rowHint}
        create={
          editable && !editingId ? { onClick: startNew, disabled: !activeClassId } : undefined
        }
      />
    </section>
  );
}

function toNameDraft(c: RegulationClassDto, fallbackLang: string): NameDraft {
  return {
    nameOriginal: c.nameOriginal ?? "",
    nameLang: c.nameLang ?? fallbackLang,
    nameJa: c.nameJa ?? "",
    nameEn: c.nameEn ?? "",
  };
}
