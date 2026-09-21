"use client";

import { pickName } from "@chem/shared";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FieldError } from "@/components/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, PrtrRegistrantDto } from "@/lib/types";

type Key =
  | "nameKana"
  | "representName"
  | "representNameKana"
  | "agentName"
  | "agentNameKana"
  | "corporateNumber"
  | "lastYearCompanyName"
  | "zip"
  | "prefecture"
  | "city"
  | "town"
  | "prefectureKana"
  | "cityKana"
  | "townKana";

type Draft = Record<Key, string>;

const KEYS: Key[] = [
  "nameKana",
  "representName",
  "representNameKana",
  "agentName",
  "agentNameKana",
  "corporateNumber",
  "lastYearCompanyName",
  "zip",
  "prefecture",
  "city",
  "town",
  "prefectureKana",
  "cityKana",
  "townKana",
];

function draftOf(r: PrtrRegistrantDto): Draft {
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? ""])) as Draft;
}

/**
 * 事業者（届出者）（S22-1）。組織マスタの会社を選び、届出の本紙に要る項目を足す。
 * 会社を選ぶとまず読み取り専用で見せ、「編集」で書き換え可（別画面で開く既存データと同じ型）
 */
export function PrtrRegistrantSection() {
  const { m, locale } = useI18n();
  const t = m.prtr.registrants;
  const [items, setItems] = useState<PrtrRegistrantDto[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/prtr/registrants").catch(() => null);
    if (!res?.ok) {
      if (res) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
      }
      return;
    }
    const list = ((await res.json()) as ListResponse<PrtrRegistrantDto>).items;
    setItems(list);
    // 既定の事業者があればそれを、無ければ先頭を最初から出す
    setSelectedId(
      (cur) =>
        cur || list.find((x) => x.isDefault)?.organisationId || list[0]?.organisationId || "",
    );
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = items?.find((x) => x.organisationId === selectedId) ?? null;
  useEffect(() => {
    setDraft(selected ? draftOf(selected) : null);
    setEditing(false);
    setFieldErrors({});
  }, [selected]);

  async function save() {
    if (!selected || !draft) return;
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const body = Object.fromEntries(KEYS.map((k) => [k, draft[k] || null]));
      const res = await fetch(`/api/prtr/registrants/${selected.organisationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const b = (await res.json().catch(() => null)) as ApiError | null;
        setError(b?.error.message ?? m.errors.saveFailed(res.status));
        setFieldErrors(toFieldErrors(b?.error.details));
        return;
      }
      setNotice(t.saved);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const field = (
    key: Key,
    label: string,
    opts?: { width?: string; hint?: string; mono?: boolean },
  ) =>
    draft && (
      <div className={`space-y-1 ${opts?.width ?? "w-64"}`}>
        <Label htmlFor={`r-${key}`}>{label}</Label>
        <Input
          id={`r-${key}`}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          aria-invalid={Boolean(fieldError(key))}
          className={`h-8 ${opts?.mono ? "font-mono" : ""}`}
        />
        {opts?.hint && <p className="text-muted-foreground text-xs">{opts.hint}</p>}
        <FieldError message={fieldError(key)} />
      </div>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <p className="text-muted-foreground mt-1 text-sm">{t.lead}</p>
      </CardHeader>
      <CardContent className="space-y-4">
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
        {items && items.length === 0 && (
          <p className="text-muted-foreground text-sm">{t.noCompanies}</p>
        )}
        {items && items.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="reg-org">{t.organisation}</Label>
              <select
                id="reg-org"
                value={selectedId}
                disabled={editing}
                onChange={(e) => setSelectedId(e.target.value)}
                className="border-input bg-background h-8 max-w-md rounded-none border px-2 text-sm"
              >
                {items.map((x) => (
                  <option key={x.organisationId} value={x.organisationId}>
                    {x.organisationCode}{" "}
                    {pickName(locale, x.organisationNameJa, x.organisationNameEn)}
                  </option>
                ))}
              </select>
            </div>
            {selected?.isDefault && <Badge variant="secondary">{t.isDefault}</Badge>}
            {selected && !editing && (
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 size-3.5" />
                {m.common.edit}
              </Button>
            )}
            {selected && !editing && <Badge variant="outline">{m.prtr.viewOnly}</Badge>}
            {selected && editing && (
              <>
                <Badge variant="secondary">{m.common.editMode}</Badge>
                <Button size="sm" disabled={saving} onClick={() => void save()}>
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft(draftOf(selected));
                    setEditing(false);
                  }}
                >
                  {m.common.discard}
                </Button>
              </>
            )}
          </div>
        )}
        {selected && !selected.hasDetails && !editing && (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        )}
        {selected && draft && (
          <fieldset disabled={!editing} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {field("nameKana", t.nameKana, { width: "w-80" })}
              {field("corporateNumber", t.corporateNumber, {
                width: "w-56",
                mono: true,
                hint: t.corporateNumberHint,
              })}
              {field("lastYearCompanyName", t.lastYearCompanyName, {
                width: "w-80",
                hint: t.lastYearCompanyNameHint,
              })}
            </div>
            <div className="flex flex-wrap gap-4">
              {field("representName", t.representName, { width: "w-80" })}
              {field("representNameKana", t.representNameKana, { width: "w-80" })}
              {field("agentName", t.agentName, { width: "w-80" })}
              {field("agentNameKana", t.agentNameKana, { width: "w-80" })}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{t.address}</p>
              <div className="flex flex-wrap gap-4">
                {field("zip", m.prtr.groups.zip, { width: "w-40", mono: true })}
                {field("prefecture", m.prtr.groups.prefecture, { width: "w-48" })}
                {field("city", m.prtr.groups.city, { width: "w-64" })}
                {field("town", m.prtr.groups.town, { width: "w-96" })}
              </div>
              <div className="mt-4 flex flex-wrap gap-4">
                {field("prefectureKana", m.prtr.groups.prefectureKana, { width: "w-48" })}
                {field("cityKana", m.prtr.groups.cityKana, { width: "w-64" })}
                {field("townKana", m.prtr.groups.townKana, { width: "w-96" })}
              </div>
            </div>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
