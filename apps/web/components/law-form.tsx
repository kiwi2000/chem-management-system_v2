"use client";

import { pickName } from "@chem/shared";
import { useState } from "react";
import { Field, NameFields, SELECT_CLASS, type NameDraft } from "@/components/law-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, CountryDto, LanguageDto, LawDto } from "@/lib/types";

interface Draft extends NameDraft {
  code: string;
  countryId: string;
  displayOrder: number;
  note: string;
}

/** 法令の入力欄。項目が多いので行の中では直さず、表の上に開く */
export function LawForm({
  languages,
  countries,
  initial,
  onSaved,
  onCancel,
}: {
  languages: LanguageDto[];
  countries: CountryDto[];
  /** 編集するとき渡す。null なら新規 */
  initial: LawDto | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { m, locale } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => ({
    code: initial?.code ?? "",
    countryId: initial?.countryId ?? countries[0]?.id ?? "",
    nameOriginal: initial?.nameOriginal ?? "",
    nameLang: initial?.nameLang ?? languages[0]?.code ?? "",
    nameJa: initial?.nameJa ?? "",
    nameEn: initial?.nameEn ?? "",
    displayOrder: initial?.displayOrder ?? 0,
    note: initial?.note ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(initial ? `/api/laws/${initial.id}` : "/api/laws", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          countryId: draft.countryId,
          nameOriginal: draft.nameOriginal,
          nameLang: draft.nameLang,
          nameJa: draft.nameJa || null,
          nameEn: draft.nameEn || null,
          displayOrder: Number(draft.displayOrder) || 0,
          note: draft.note || null,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{initial ? m.laws.editTitle : m.laws.newTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex flex-wrap items-start gap-3">
            <Field label={m.laws.code} htmlFor="law-code" className="w-28">
              <Input
                id="law-code"
                required
                maxLength={50}
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                className="font-mono"
              />
            </Field>
            <Field label={m.laws.country} htmlFor="law-country" className="w-40">
              <select
                id="law-country"
                required
                value={draft.countryId}
                onChange={(e) => setDraft({ ...draft, countryId: e.target.value })}
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  —
                </option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pickName(locale, c.nameJa, c.nameEn)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={m.laws.displayOrder} htmlFor="law-order" className="w-20">
              <Input
                id="law-order"
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
              idPrefix="law"
              languages={languages}
              locale={locale}
              labels={{
                nameOriginal: m.laws.nameOriginal,
                nameLang: m.laws.nameLang,
                nameJa: m.laws.nameJa,
                nameEn: m.laws.nameEn,
              }}
              value={draft}
              onChange={(v) => setDraft({ ...draft, ...v })}
            />
          </div>

          <Field label={m.laws.note} htmlFor="law-note">
            <Input
              id="law-note"
              maxLength={2000}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              {m.common.cancel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
