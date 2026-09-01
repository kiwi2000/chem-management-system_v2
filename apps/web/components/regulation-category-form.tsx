"use client";

import { THRESHOLD_BASES, type ThresholdBasis } from "@chem/shared";
import { useState } from "react";
import {
  DEFAULT_THRESHOLD,
  Field,
  NameFields,
  ThresholdFields,
  type NameDraft,
  type ThresholdDraft,
} from "@/components/law-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, LanguageDto, RegulationCategoryDto } from "@/lib/types";

interface Draft extends NameDraft, ThresholdDraft {
  code: string;
  displayOrder: number;
  interactionGroup: string;
  rank: string;
  thresholdBasis: ThresholdBasis;
  judged: boolean;
  note: string;
}

/**
 * 区分の入力欄。
 * ここの閾値は法文物質名を作るときのひな型で、判定には使わない。
 */
export function RegulationCategoryForm({
  languages,
  lawId,
  initial,
  onSaved,
  onCancel,
}: {
  languages: LanguageDto[];
  /** どの法律にぶら下げるか */
  lawId: string;
  /** 編集するとき渡す。null なら新規 */
  initial: RegulationCategoryDto | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { m, locale } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => ({
    code: initial?.code ?? "",
    nameOriginal: initial?.nameOriginal ?? "",
    nameLang: initial?.nameLang ?? languages[0]?.code ?? "",
    nameJa: initial?.nameJa ?? "",
    nameEn: initial?.nameEn ?? "",
    thresholdLower: initial?.thresholdLower ?? DEFAULT_THRESHOLD.thresholdLower,
    lowerBound: initial?.lowerBound ?? DEFAULT_THRESHOLD.lowerBound,
    thresholdUpper: initial?.thresholdUpper ?? DEFAULT_THRESHOLD.thresholdUpper,
    upperBound: initial?.upperBound ?? DEFAULT_THRESHOLD.upperBound,
    displayOrder: initial?.displayOrder ?? 0,
    interactionGroup: initial?.interactionGroup ?? "",
    rank: initial?.rank === undefined || initial?.rank === null ? "" : String(initial.rank),
    thresholdBasis: initial?.thresholdBasis ?? "PRODUCT",
    // 既定は「使う」。持つだけにしたいものだけ外す
    judged: initial?.judged ?? true,
    note: initial?.note ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(
        initial ? `/api/regulation-categories/${initial.id}` : "/api/regulation-categories",
        {
          method: initial ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: draft.code,
            lawId,
            nameOriginal: draft.nameOriginal,
            nameLang: draft.nameLang,
            nameJa: draft.nameJa || null,
            nameEn: draft.nameEn || null,
            thresholdLower: draft.thresholdLower,
            lowerBound: draft.lowerBound,
            thresholdUpper: draft.thresholdUpper,
            upperBound: draft.upperBound,
            displayOrder: Number(draft.displayOrder) || 0,
            interactionGroup: draft.interactionGroup || null,
            rank: draft.rank === "" ? null : Number(draft.rank),
            thresholdBasis: draft.thresholdBasis,
            judged: draft.judged,
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
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {initial ? m.regulationCategories.editTitle : m.regulationCategories.newTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="flex flex-wrap items-start gap-3">
            <Field label={m.regulationCategories.code} htmlFor="cat-code" className="w-28">
              <Input
                id="cat-code"
                required
                maxLength={50}
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                className="font-mono"
              />
            </Field>
            <Field label={m.regulationCategories.displayOrder} htmlFor="cat-order" className="w-20">
              <Input
                id="cat-order"
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
              idPrefix="cat"
              languages={languages}
              locale={locale}
              labels={{
                nameOriginal: m.regulationCategories.nameOriginal,
                nameLang: m.regulationCategories.nameLang,
                nameJa: m.regulationCategories.nameJa,
                nameEn: m.regulationCategories.nameEn,
              }}
              value={draft}
              onChange={(v) => setDraft({ ...draft, ...v })}
            />
          </div>

          <ThresholdFields
            idPrefix="cat"
            label={m.regulationCategories.threshold}
            hint={m.regulationCategories.thresholdHint}
            middleLabel={m.regulationCategories.content}
            lowerLabel={m.regulationCategories.lower}
            upperLabel={m.regulationCategories.upper}
            bounds={m.regulationCategories.bounds}
            value={draft}
            onChange={(v) => setDraft({ ...draft, ...v })}
          />

          <div className="flex flex-wrap items-start gap-3">
            <Field
              label={m.regulationCategories.interactionGroup}
              htmlFor="cat-interaction"
              hint={m.regulationCategories.interactionHint}
              className="w-52"
            >
              <Input
                id="cat-interaction"
                maxLength={50}
                value={draft.interactionGroup}
                onChange={(e) => setDraft({ ...draft, interactionGroup: e.target.value })}
              />
            </Field>
            <Field label={m.regulationCategories.rank} htmlFor="cat-rank" className="w-20">
              <Input
                id="cat-rank"
                type="number"
                min={0}
                max={999}
                value={draft.rank}
                onChange={(e) => setDraft({ ...draft, rank: e.target.value })}
              />
            </Field>
          </div>

          <Field
            label={m.regulationCategories.thresholdBasis}
            htmlFor="cat-basis"
            hint={m.regulationCategories.thresholdBasisHint}
            className="w-72"
          >
            <select
              id="cat-basis"
              value={draft.thresholdBasis}
              onChange={(e) =>
                setDraft({ ...draft, thresholdBasis: e.target.value as ThresholdBasis })
              }
              className="border-input bg-background h-9 w-full rounded-none border px-2 text-sm"
            >
              {THRESHOLD_BASES.map((b) => (
                <option key={b} value={b}>
                  {m.regulationCategories.thresholdBases[b]}
                </option>
              ))}
            </select>
          </Field>

          {/*
            判定に出すかどうか。**閾値の基準の隣に置く。**
            どちらも「この区分が判定でどう扱われるか」を決めるもので、
            離すと片方だけ直したことに気づけない
          */}
          <Field
            label={m.regulationCategories.judged}
            htmlFor="cat-judged"
            hint={m.regulationCategories.judgedHint}
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                id="cat-judged"
                type="checkbox"
                checked={draft.judged}
                onChange={(e) => setDraft({ ...draft, judged: e.target.checked })}
                className="size-4"
              />
              {m.regulationCategories.judgedLabel}
            </label>
          </Field>

          <Field label={m.regulationCategories.note} htmlFor="cat-note">
            <Input
              id="cat-note"
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
