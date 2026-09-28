"use client";

import type { Locale } from "@chem/shared";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import type { ApiError } from "@/lib/types";
import type { AdoptionRuleDto } from "../ghs/data-dto";
import { countryName } from "../ghs/countries";
import { sdsMessages } from "../messages";

interface RulesDto {
  country: string;
  saved: boolean;
  rules: AdoptionRuleDto[];
  sources: { code: string; nameJa: string; nameEn: string }[];
}

/**
 * 出典の採用順（国ごと）。上から順に、そのクラスを評価している最初の出典を採る（S23 §5-3）。
 * 誰でも見られる。並べ替えて保存できるのはシステム管理者だけ
 */
export function GhsAdoptionRules({
  locale,
  country,
  isAdmin,
  onSaved,
}: {
  locale: Locale;
  country: string;
  isAdmin: boolean;
  onSaved?: () => void;
}) {
  const t = sdsMessages(locale).data.rules;
  const [data, setData] = useState<RulesDto | null>(null);
  const [rules, setRules] = useState<AdoptionRuleDto[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setNotice(null);
    const res = await fetch(
      `/api/modules/sds/ghs-data/rules?country=${encodeURIComponent(country)}`,
    );
    if (!res.ok) {
      redirectIfUnauthorized(res);
      setData(null);
      return;
    }
    const body = (await res.json()) as RulesDto;
    setData(body);
    setRules(body.rules);
    setDirty(false);
  }, [country]);
  useEffect(() => {
    void load();
  }, [load]);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRules(next);
    setDirty(true);
  };
  const toggleFill = (i: number, v: boolean) => {
    setRules(rules.map((r, k) => (k === i ? { ...r, fillCannotClassify: v } : r)));
    setDirty(true);
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/modules/sds/ghs-data/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          rules: rules.map((r) => ({
            sourceCode: r.sourceCode,
            fillCannotClassify: r.fillCannotClassify,
          })),
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? `HTTP ${res.status}`);
        return;
      }
      await load();
      setNotice(t.saved);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (code: string) => {
    const s = data?.sources.find((x) => x.code === code);
    return s ? (locale === "ja" ? s.nameJa : s.nameEn) : code;
  };

  return (
    <Card collapsible={false}>
      <CardHeader>
        <CardTitle className="text-base">
          {t.title}（{countryName(country, locale)}）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">{t.lead}</p>
        {!isAdmin && <p className="text-muted-foreground text-sm">{t.adminOnly}</p>}
        {data && !data.saved && <p className="text-muted-foreground text-sm">{t.isDefault}</p>}
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
        <ol className="divide-y border">
          {rules.map((r, i) => (
            <li key={r.sourceCode} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="text-muted-foreground w-5 tabular-nums">{i + 1}</span>
              <span className="min-w-40 font-medium">{nameOf(r.sourceCode)}</span>
              {isAdmin && (
                <span className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t.up}
                    title={t.up}
                    disabled={i === 0 || busy}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t.down}
                    title={t.down}
                    disabled={i === rules.length - 1 || busy}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </span>
              )}
              <label className="text-muted-foreground flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={r.fillCannotClassify}
                  disabled={!isAdmin || busy}
                  onChange={(e) => toggleFill(i, e.target.checked)}
                />
                {t.fill}
              </label>
            </li>
          ))}
        </ol>
        {isAdmin && (
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={!dirty || busy} onClick={() => void save()}>
              {t.save}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
