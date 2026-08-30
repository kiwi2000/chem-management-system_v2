"use client";

import {
  emptyTableState,
  kindLabelOf,
  ORGANISATION_KINDS,
  pickName,
  serializeTableState,
  type OrganisationKind,
  type TableState,
} from "@chem/shared";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/lib/use-me";
import type { ApiError, ListResponse, OrganisationDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const STORAGE_KEY = "chem.table.organisations";
const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

interface ItemDraft {
  label: string;
  value: string;
}

const EMPTY_FORM = {
  id: "",
  code: "",
  kind: "COMPANY" as OrganisationKind,
  kindLabel: "",
  nameJa: "",
  nameEn: "",
  displayOrder: 0,
  activeFlag: true,
  items: [] as ItemDraft[],
};

/**
 * 組織。会社・部署・取引先・そのほかを、種別で見分けて1つの表に置く。
 *
 * **持つ項目を決めない。**名称・住所・電話・登録番号…と、
 * 求められるものが提出先によって違う。項目名も値も打ってもらう。
 * ここで付けた項目名が、そのままドキュメントの差込項目になる。
 *
 * **見るのは誰でも。**帳票の宛先に選ぶために引く。
 * 作る・直す・消すには `ORG_EDIT` が要る
 */
export function OrganisationSection() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("ORG_EDIT");
  /** 種別の呼び名。画面の言語で出す */
  const kindNames = useMemo(
    () => ({
      COMPANY: m.organisations.kindCompany,
      DEPARTMENT: m.organisations.kindDepartment,
      PARTNER: m.organisations.kindPartner,
      OTHER: m.organisations.kindOther,
    }),
    [m],
  );

  const [form, setForm] = useState({ ...EMPTY_FORM });
  /* 書く欄は押されてから出す（フィードバックなどと同じ形） */
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ListResponse<OrganisationDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<OrganisationDto>[]>(
    () => [
      {
        key: "code",
        header: m.organisations.code,
        kind: "text",
        width: 120,
        className: "font-mono text-xs",
        render: (o) => o.code,
      },
      {
        key: "kind",
        header: m.organisations.kind,
        kind: "enum",
        width: 110,
        options: ORGANISATION_KINDS.map((k) => ({ value: k, label: kindNames[k] })),
        render: (o) => kindLabelOf(o.kind, o.kindLabel, kindNames),
      },
      {
        key: "nameJa",
        header: m.organisations.nameJa,
        kind: "text",
        width: 240,
        render: (o) => pickName(locale, o.nameJa, o.nameEn),
      },
      {
        key: "itemCount",
        header: m.organisations.itemCount,
        kind: "number",
        width: 88,
        sortable: false,
        filterable: false,
        className: "text-right text-xs",
        // 中身そのものは表に出さない。会社ごとに項目が違い、列にできない
        render: (o) => String(o.items.length),
      },
      {
        key: "memberCount",
        header: m.organisations.memberCount,
        kind: "number",
        width: 96,
        sortable: false,
        filterable: false,
        className: "text-right text-xs",
        render: (o) => String(o.memberCount),
      },
      {
        key: "displayOrder",
        header: m.organisations.displayOrder,
        kind: "number",
        width: 88,
        className: "text-right text-xs",
        render: (o) => String(o.displayOrder),
      },
      {
        key: "activeFlag",
        header: m.common.activeHeader,
        kind: "enum",
        filterLabelHidden: true,
        width: 72,
        className: "text-center",
        options: [
          { value: "true", label: m.users.active },
          { value: "false", label: m.users.inactive },
        ],
        render: (o) => (
          <StatusIcon
            active={o.activeFlag}
            activeLabel={m.users.active}
            inactiveLabel={m.users.inactive}
          />
        ),
      },
    ],
    [m, locale, kindNames],
  );

  const { state, setState, reset, ready } = useTableState(STORAGE_KEY, columns, DEFAULT_STATE);
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/organisations?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    setData((await res.json()) as ListResponse<OrganisationDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  function startNew() {
    setError(null);
    setForm({ ...EMPTY_FORM, items: [] });
    setOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(editing ? `/api/organisations/${form.id}` : "/api/organisations", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          kind: form.kind,
          // 「そのほか」以外では捨てる。種別を変えたときに古い呼び名が残らないように
          kindLabel: form.kind === "OTHER" ? form.kindLabel : null,
          nameJa: form.nameJa,
          nameEn: form.nameEn,
          displayOrder: form.displayOrder,
          activeFlag: form.activeFlag,
          // 打ちかけの空行は送らない。項目名が無いものは項目として意味がない
          items: form.items.filter((x) => x.label.trim() !== ""),
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setForm({ ...EMPTY_FORM, items: [] });
      setOpen(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteSelected(targets: OrganisationDto[]) {
    setError(null);
    for (const o of targets) {
      const res = await fetch(`/api/organisations/${o.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (form.id === o.id) {
        setForm({ ...EMPTY_FORM, items: [] });
        setOpen(false);
      }
    }
    void load();
  }

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setForm((f) => ({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  return (
    <section className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {open && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {form.id ? m.organisations.editTitle : m.organisations.newTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="org-code">{m.organisations.code}</Label>
                  <Input
                    id="org-code"
                    value={form.code}
                    maxLength={20}
                    required
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-32 font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-kind">{m.organisations.kind}</Label>
                  <select
                    id="org-kind"
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value as OrganisationKind })}
                    className="border-input bg-background h-9 w-32 rounded-none border px-2 text-sm"
                  >
                    {ORGANISATION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {kindNames[k]}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 呼び名は「そのほか」のときだけ。ほかの種別では置き場所も取らない */}
                {form.kind === "OTHER" && (
                  <div className="space-y-2">
                    <Label htmlFor="org-kind-label">{m.organisations.kindLabel}</Label>
                    <Input
                      id="org-kind-label"
                      value={form.kindLabel}
                      maxLength={30}
                      onChange={(e) => setForm({ ...form, kindLabel: e.target.value })}
                      className="w-40"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="org-name-ja">{m.organisations.nameJa}</Label>
                  <Input
                    id="org-name-ja"
                    value={form.nameJa}
                    maxLength={100}
                    required
                    onChange={(e) => setForm({ ...form, nameJa: e.target.value })}
                    className="w-64"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-name-en">
                    {m.organisations.nameEn}
                    <span className="text-muted-foreground">{m.common.optional}</span>
                  </Label>
                  <Input
                    id="org-name-en"
                    value={form.nameEn}
                    maxLength={100}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                    className="w-64"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-order">{m.organisations.displayOrder}</Label>
                  <Input
                    id="org-order"
                    type="number"
                    min={0}
                    max={9999}
                    value={form.displayOrder}
                    onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })}
                    className="w-24"
                  />
                </div>
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.activeFlag}
                    onChange={(e) => setForm({ ...form, activeFlag: e.target.checked })}
                  />
                  {m.groups.activeFlag}
                </label>
              </div>

              {/* 項目。名前も値も打ってもらう */}
              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">{m.organisations.items}</p>
                <p className="text-muted-foreground text-xs">{m.organisations.itemsHint}</p>
                {form.items.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{m.organisations.noItems}</p>
                ) : (
                  <div className="space-y-2">
                    {form.items.map((it, i) => (
                      <div key={i} className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`org-label-${i}`} className="text-xs">
                            {m.organisations.label}
                          </Label>
                          <Input
                            id={`org-label-${i}`}
                            value={it.label}
                            maxLength={60}
                            placeholder={m.organisations.labelPlaceholder}
                            onChange={(e) => setItem(i, { label: e.target.value })}
                            className="w-48"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`org-value-${i}`} className="text-xs">
                            {m.organisations.value}
                          </Label>
                          <Input
                            id={`org-value-${i}`}
                            value={it.value}
                            maxLength={500}
                            placeholder={m.organisations.valuePlaceholder}
                            onChange={(e) => setItem(i, { value: e.target.value })}
                            className="w-96"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={m.common.delete}
                          aria-label={m.common.delete}
                          onClick={() =>
                            setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={form.items.length >= 50}
                  onClick={() =>
                    setForm((f) => ({ ...f, items: [...f.items, { label: "", value: "" }] }))
                  }
                >
                  {m.organisations.addItem}
                </Button>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setForm({ ...EMPTY_FORM, items: [] });
                    setOpen(false);
                  }}
                >
                  {m.common.discard}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <DataTable
        title={m.organisations.title}
        storageKey={STORAGE_KEY}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(o) => o.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.organisations.empty}
        // 作る・直す・消すは権限のある人だけ。見るのは誰でもできる
        create={open || !editable ? undefined : { onClick: startNew }}
        selectable={editable}
        onDeleteSelected={editable ? onDeleteSelected : undefined}
        // この画面は詳細を別に持たないので、鉛筆で上のフォームに読み込む
        rowAction={
          editable
            ? {
                onClick: (o) => {
                  setForm({
                    id: o.id,
                    code: o.code,
                    kind: o.kind,
                    kindLabel: o.kindLabel ?? "",
                    nameJa: o.nameJa,
                    nameEn: o.nameEn ?? "",
                    displayOrder: o.displayOrder,
                    activeFlag: o.activeFlag,
                    items: o.items.map((x) => ({ ...x })),
                  });
                  setOpen(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                },
              }
            : undefined
        }
      />
    </section>
  );
}
