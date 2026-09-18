"use client";

import { IMPURITY_NONE, pickName, pickStatutoryName } from "@chem/shared";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  ImpurityExemptionsDto,
  ImpurityPatternDto,
  LawDto,
  ListResponse,
  RegulationCategoryDto,
  StatutorySubstanceDto,
} from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { cn } from "@/lib/utils";

/**
 * 不純物パターン（S21）。
 *
 * 上でパターンを選び、下でそのパターンを「非該当にする規制区分」を決める。
 * 区分の行の「例外」から、法文物質名ごとに区分の設定を上書きできる。
 *
 * **付け外しは 1 回ごとに保存する。**保存ボタンを押し忘れて設定が残らない、を防ぐため。
 * 設定を変えると判定の前提が変わるので、左下に「要再計算」が出る
 */

const EMPTY_FORM = { id: "", code: "", nameJa: "", nameEn: "", note: "" };

export default function ImpurityPatternsPage() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [patterns, setPatterns] = useState<ImpurityPatternDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 法律 → 区分。除外の表はこの並びで出す */
  const [laws, setLaws] = useState<LawDto[]>([]);
  const [categories, setCategories] = useState<RegulationCategoryDto[]>([]);
  const [openLaws, setOpenLaws] = useState<Set<string>>(new Set());
  const [exempt, setExempt] = useState<ImpurityExemptionsDto | null>(null);

  /** 例外を開いている区分 */
  const [exceptionsFor, setExceptionsFor] = useState<RegulationCategoryDto | null>(null);

  const selected = patterns.find((p) => p.id === selectedId) ?? null;

  const loadPatterns = useCallback(async () => {
    const res = await fetch("/api/impurity-patterns").catch(() => null);
    if (!res?.ok) {
      if (res) redirectIfUnauthorized(res);
      return;
    }
    const body = (await res.json()) as ListResponse<ImpurityPatternDto>;
    setPatterns(body.items);
    setSelectedId((cur) => cur ?? body.items.find((p) => p.id !== IMPURITY_NONE)?.id ?? null);
  }, []);

  useEffect(() => {
    void loadPatterns();
  }, [loadPatterns]);

  // 法律と区分は件数が知れているので全部引く
  useEffect(() => {
    void (async () => {
      const [l, c] = await Promise.all([
        fetch("/api/laws?size=200").catch(() => null),
        fetch("/api/regulation-categories?size=500").catch(() => null),
      ]);
      if (l?.ok) setLaws(((await l.json()) as ListResponse<LawDto>).items);
      if (c?.ok) setCategories(((await c.json()) as ListResponse<RegulationCategoryDto>).items);
    })();
  }, []);

  const loadExemptions = useCallback(async (patternId: string) => {
    const res = await fetch(`/api/impurity-patterns/${patternId}/exemptions`).catch(() => null);
    if (!res?.ok) return;
    setExempt((await res.json()) as ImpurityExemptionsDto);
  }, []);

  useEffect(() => {
    if (!selectedId || selectedId === IMPURITY_NONE) {
      setExempt(null);
      return;
    }
    void loadExemptions(selectedId);
  }, [selectedId, loadExemptions]);

  const byLaw = useMemo(() => {
    const out = new Map<string, RegulationCategoryDto[]>();
    for (const c of categories) {
      const list = out.get(c.lawId);
      if (list) list.push(c);
      else out.set(c.lawId, [c]);
    }
    return out;
  }, [categories]);

  const excluded = useMemo(() => new Set(exempt?.categoryIds ?? []), [exempt]);
  /** 区分ごとの、法文物質名の上書きの数（「例外 N 件」に出す） */
  const overridesByCategory = useMemo(() => {
    const out = new Map<string, number>();
    for (const x of exempt?.substances ?? []) {
      out.set(x.categoryId, (out.get(x.categoryId) ?? 0) + 1);
    }
    return out;
  }, [exempt]);

  /** 区分の付け外し。1 回ごとに保存する */
  async function toggleCategories(categoryIds: string[], next: boolean) {
    if (!selectedId || categoryIds.length === 0) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/impurity-patterns/${selectedId}/exemptions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds, excluded: next }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      await loadExemptions(selectedId);
    } finally {
      setSaving(false);
    }
  }

  async function savePattern() {
    setError(null);
    setSaving(true);
    try {
      const creating = form.id === "";
      const res = await fetch(
        creating ? "/api/impurity-patterns" : `/api/impurity-patterns/${form.id}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            nameJa: form.nameJa,
            nameEn: form.nameEn || null,
            note: form.note || null,
          }),
        },
      );
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setAdding(false);
      setForm(EMPTY_FORM);
      await loadPatterns();
    } finally {
      setSaving(false);
    }
  }

  async function removePattern(p: ImpurityPatternDto) {
    setError(null);
    const res = await fetch(`/api/impurity-patterns/${p.id}`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    if (selectedId === p.id) setSelectedId(null);
    await loadPatterns();
  }

  const lawName = (l: LawDto) => pickStatutoryName(locale, l.nameOriginal, l.nameJa, l.nameEn);
  const catName = (c: RegulationCategoryDto) =>
    pickStatutoryName(locale, c.nameOriginal, c.nameJa, c.nameEn);

  return (
    <div className="space-y-4 p-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{m.impurityPatterns.title}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{m.impurityPatterns.lead}</p>
          </div>
          {editable && !adding && (
            <Button
              size="sm"
              onClick={() => {
                setForm(EMPTY_FORM);
                setAdding(true);
              }}
            >
              {m.impurityPatterns.add}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {editable && adding && (
            <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
              <div className="w-28 space-y-1">
                <Label htmlFor="ip-code">{m.impurityPatterns.code}</Label>
                <Input
                  id="ip-code"
                  value={form.code}
                  maxLength={50}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="h-8"
                />
              </div>
              <div className="w-56 space-y-1">
                <Label htmlFor="ip-name">{m.impurityPatterns.name}</Label>
                <Input
                  id="ip-name"
                  value={form.nameJa}
                  maxLength={200}
                  onChange={(e) => setForm({ ...form, nameJa: e.target.value })}
                  className="h-8"
                />
              </div>
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="ip-note">{m.impurityPatterns.note}</Label>
                <Input
                  id="ip-note"
                  value={form.note}
                  maxLength={2000}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="h-8"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={saving || form.code.trim() === "" || form.nameJa.trim() === ""}
                  onClick={() => void savePattern()}
                >
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                  {m.common.cancel}
                </Button>
              </div>
            </div>
          )}

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="w-24 px-2 py-1 text-left">{m.impurityPatterns.code}</th>
                <th className="px-2 py-1 text-left">{m.impurityPatterns.name}</th>
                <th className="px-2 py-1 text-left">{m.impurityPatterns.note}</th>
                <th className="w-20 px-2 py-1 text-right">{m.impurityPatterns.substanceCount}</th>
                <th className="w-28 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "border-border cursor-pointer border-b",
                    selectedId === p.id && "bg-accent",
                  )}
                >
                  <td className="px-2 py-1 font-mono">{p.code}</td>
                  <td className="px-2 py-1">
                    {pickName(locale, p.nameJa, p.nameEn)}
                    {p.builtin && (
                      <span className="text-muted-foreground border-input ml-2 border px-1 text-xs">
                        {m.impurityPatterns.builtin}
                      </span>
                    )}
                  </td>
                  <td className="text-muted-foreground px-2 py-1 text-xs">{p.note}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    {p.substanceCount.toLocaleString(locale)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {editable && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setForm({
                              id: p.id,
                              code: p.code,
                              nameJa: p.nameJa,
                              nameEn: p.nameEn ?? "",
                              note: p.note ?? "",
                            });
                            setAdding(true);
                          }}
                        >
                          {m.common.edit}
                        </Button>
                        {!p.builtin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              void removePattern(p);
                            }}
                          >
                            {m.common.delete}
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {patterns.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-muted-foreground px-2 py-3 text-center">
                    {m.impurityPatterns.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {m.impurityPatterns.exemptions}
            {selected && (
              <span className="bg-primary text-primary-foreground rounded px-2 py-0.5 font-mono text-sm">
                {selected.code}
              </span>
            )}
          </CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">{m.impurityPatterns.exemptionsHint}</p>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="text-muted-foreground text-sm">{m.impurityPatterns.empty}</p>
          ) : selected.isNone ? (
            <Alert>
              <AlertDescription>{m.impurityPatterns.noneHasNoExemption}</AlertDescription>
            </Alert>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="w-10 px-2 py-1" />
                  <th className="px-2 py-1 text-left">{m.laws.title}</th>
                  <th className="w-32 px-2 py-1 text-center">{m.impurityPatterns.exclude}</th>
                  <th className="w-28 px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {laws.map((law) => {
                  const cats = byLaw.get(law.id) ?? [];
                  const on = cats.filter((c) => excluded.has(c.id)).length;
                  const open = openLaws.has(law.id);
                  return (
                    <ImpurityLawRows
                      key={law.id}
                      law={law}
                      cats={cats}
                      open={open}
                      onToggleOpen={() =>
                        setOpenLaws((prev) => {
                          const next = new Set(prev);
                          if (next.has(law.id)) next.delete(law.id);
                          else next.add(law.id);
                          return next;
                        })
                      }
                      allOn={cats.length > 0 && on === cats.length}
                      someOn={on > 0 && on < cats.length}
                      excluded={excluded}
                      editable={editable}
                      saving={saving}
                      lawName={lawName(law)}
                      catName={catName}
                      overrides={overridesByCategory}
                      onToggleLaw={(next) =>
                        void toggleCategories(
                          cats.map((c) => c.id),
                          next,
                        )
                      }
                      onToggleCategory={(id, next) => void toggleCategories([id], next)}
                      onOpenExceptions={setExceptionsFor}
                      exceptionsLabel={m.impurityPatterns.exceptions}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {exceptionsFor && selected && (
        <ExceptionsDialog
          pattern={selected}
          category={exceptionsFor}
          onClose={() => {
            setExceptionsFor(null);
            void loadExemptions(selected.id);
          }}
          editable={editable}
        />
      )}
    </div>
  );
}

/** 法律 1 件と、その区分の行 */
function ImpurityLawRows({
  law,
  cats,
  open,
  onToggleOpen,
  allOn,
  someOn,
  excluded,
  editable,
  saving,
  lawName,
  catName,
  overrides,
  onToggleLaw,
  onToggleCategory,
  onOpenExceptions,
  exceptionsLabel,
}: {
  law: LawDto;
  cats: RegulationCategoryDto[];
  open: boolean;
  onToggleOpen: () => void;
  allOn: boolean;
  someOn: boolean;
  excluded: Set<string>;
  editable: boolean;
  saving: boolean;
  lawName: string;
  catName: (c: RegulationCategoryDto) => string;
  overrides: Map<string, number>;
  onToggleLaw: (next: boolean) => void;
  onToggleCategory: (id: string, next: boolean) => void;
  onOpenExceptions: (c: RegulationCategoryDto) => void;
  exceptionsLabel: (n: number) => string;
}) {
  return (
    <>
      <tr className="border-border border-b">
        <td className="px-2 py-1">
          <button type="button" onClick={onToggleOpen} aria-expanded={open}>
            <ChevronRight
              className={cn(
                "text-muted-foreground size-4 transition-transform",
                open && "rotate-90",
              )}
            />
          </button>
        </td>
        <td className="px-2 py-1 font-medium">
          <span className="text-muted-foreground mr-2 font-mono text-xs">{law.code}</span>
          {lawName}
        </td>
        <td className="px-2 py-1 text-center">
          <input
            type="checkbox"
            checked={allOn}
            ref={(el) => {
              if (el) el.indeterminate = someOn;
            }}
            disabled={!editable || saving || cats.length === 0}
            aria-label={lawName}
            onChange={() => onToggleLaw(!allOn)}
          />
        </td>
        <td />
      </tr>
      {open &&
        cats.map((c) => (
          <tr key={c.id} className="border-border border-b">
            <td />
            <td className="px-2 py-1 pl-6">
              <span className="text-muted-foreground mr-2 font-mono text-xs">{c.code}</span>
              {catName(c)}
            </td>
            <td className="px-2 py-1 text-center">
              <input
                type="checkbox"
                checked={excluded.has(c.id)}
                disabled={!editable || saving}
                aria-label={catName(c)}
                onChange={() => onToggleCategory(c.id, !excluded.has(c.id))}
              />
            </td>
            <td className="px-2 py-1 text-right">
              <Button size="sm" variant="ghost" onClick={() => onOpenExceptions(c)}>
                {exceptionsLabel(overrides.get(c.id) ?? 0)}
              </Button>
            </td>
          </tr>
        ))}
    </>
  );
}

/** 法文物質名ごとの上書き */
function ExceptionsDialog({
  pattern,
  category,
  onClose,
  editable,
}: {
  pattern: ImpurityPatternDto;
  category: RegulationCategoryDto;
  onClose: () => void;
  editable: boolean;
}) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<StatutorySubstanceDto[]>([]);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [query, setQuery] = useState("");
  const [onlyExceptions, setOnlyExceptions] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ size: "200", "f.categoryId": `in:${category.id}` });
    if (query.trim() !== "") params.set("f.nameJa", `contains:${query.trim()}`);
    const [s, e] = await Promise.all([
      fetch(`/api/statutory-substances?${params.toString()}`).catch(() => null),
      fetch(`/api/impurity-patterns/${pattern.id}/exemptions`).catch(() => null),
    ]);
    if (s?.ok) setItems(((await s.json()) as ListResponse<StatutorySubstanceDto>).items);
    if (e?.ok) {
      const body = (await e.json()) as ImpurityExemptionsDto;
      setOverrides(new Map(body.substances.map((x) => [x.statutorySubstanceId, x.excluded])));
    }
  }, [category.id, pattern.id, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function set(statutorySubstanceId: string, excluded: boolean | null) {
    await fetch(`/api/impurity-patterns/${pattern.id}/exemptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statutorySubstanceId, excluded }),
    }).catch(() => null);
    await load();
  }

  const shown = onlyExceptions ? items.filter((s) => overrides.has(s.id)) : items;

  return (
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-6">
      <Card className="max-h-[80vh] w-[56rem] overflow-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{m.impurityPatterns.exceptionsTitle}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              {m.impurityPatterns.exceptionsHint}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>
            {m.common.close}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              value={query}
              placeholder={m.statutorySubstances.nameJa}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-64"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyExceptions}
                onChange={() => setOnlyExceptions(!onlyExceptions)}
              />
              {m.impurityPatterns.onlyExceptions}
            </label>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="px-2 py-1 text-left">{m.statutorySubstances.title}</th>
                <th className="w-64 px-2 py-1 text-left">{m.impurityPatterns.exclude}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const cur = overrides.get(s.id);
                const value = cur === undefined ? "" : cur ? "yes" : "no";
                return (
                  <tr key={s.id} className="border-border border-b">
                    <td className="px-2 py-1">
                      {pickStatutoryName(locale, s.nameOriginal, s.nameJa, s.nameEn)}
                    </td>
                    <td className="px-2 py-1">
                      <select
                        className="border-input bg-background h-8 w-full rounded-none border px-2 text-sm"
                        value={value}
                        disabled={!editable}
                        aria-label={m.impurityPatterns.exclude}
                        onChange={(e) =>
                          void set(s.id, e.target.value === "" ? null : e.target.value === "yes")
                        }
                      >
                        <option value="">{m.impurityPatterns.followCategory}</option>
                        <option value="yes">{m.impurityPatterns.excludeHere}</option>
                        <option value="no">{m.impurityPatterns.dontExcludeHere}</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
