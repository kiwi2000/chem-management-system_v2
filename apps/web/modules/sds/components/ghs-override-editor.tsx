"use client";

import { pickName, type Locale } from "@chem/shared";
import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import type { ApiError } from "@/lib/types";
import { GHS_CATALOG } from "../ghs/catalog-data";
import { countryName } from "../ghs/countries";
import type { GhsDataRowDto, GhsStatus, OverrideDto } from "../ghs/data-dto";
import { sdsMessages } from "../messages";
import { categoryText } from "./ghs-data-table";

/** 1 クラスぶんの入力。status が null なら「上書きしない」 */
interface Draft {
  status: GhsStatus | null;
  category: string;
  targetOrgans: string;
}

const CHOICES: GhsStatus[] = ["CLASSIFIED", "NOT_CLASSIFIED", "CANNOT_CLASSIFY", "NOT_APPLICABLE"];

/**
 * 自社判定の登録（物質 1 つぶん）。クラスごとに、いま採用している分類を左に見せ、右で上書きを選ぶ。
 * 保存は「その物質 × 効く国」の上書きを丸ごと置き換える（理由は 1 つ）
 */
export function GhsOverrideEditor({
  locale,
  row,
  country,
  onClose,
  onSaved,
}: {
  locale: Locale;
  row: GhsDataRowDto;
  country: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const all = sdsMessages(locale);
  const t = all.data.edit;
  const ja = locale === "ja";
  /** 効く国: ""＝全ての国、それ以外＝いま選んでいる国だけ */
  const [scope, setScope] = useState<string>("");
  const [existing, setExisting] = useState<OverrideDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 登録済みの上書きを読んで、効く国ごとの下書きに直す
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(
        `/api/modules/sds/ghs-data/overrides?substanceId=${encodeURIComponent(row.id)}`,
      );
      if (!res.ok) {
        redirectIfUnauthorized(res);
        if (alive) setExisting([]);
        return;
      }
      const body = (await res.json()) as { items: OverrideDto[] };
      if (alive) setExisting(body.items);
    })();
    return () => {
      alive = false;
    };
  }, [row.id]);

  useEffect(() => {
    if (!existing) return;
    const mine = existing.filter((o) => o.country === scope);
    const next: Record<string, Draft> = {};
    for (const o of mine) {
      // 同じクラスに複数の区分があるときは、最初の 1 つを出す（複数区分の上書きは段 1 で）
      if (next[o.hazardClass]) continue;
      next[o.hazardClass] = {
        status: o.status,
        category: o.category,
        targetOrgans: o.targetOrgans ?? "",
      };
    }
    setDrafts(next);
    setReason(mine[0]?.reason ?? "");
  }, [existing, scope]);

  const existingCount = useMemo(
    () => existing?.filter((o) => o.country === scope).length ?? 0,
    [existing, scope],
  );

  const setDraft = (cls: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({
      ...d,
      [cls]: { status: null, category: "", targetOrgans: "", ...d[cls], ...patch },
    }));

  async function save() {
    setError(null);
    const items = Object.entries(drafts)
      .filter(([, d]) => d.status !== null)
      .map(([hazardClass, d]) => ({
        hazardClass,
        status: d.status!,
        category: d.status === "CLASSIFIED" ? d.category : "",
        targetOrgans:
          d.status === "CLASSIFIED" && d.targetOrgans.trim() ? d.targetOrgans.trim() : null,
      }));
    if (items.length > 0 && !reason.trim()) return setError(t.needReason);
    for (const it of items) {
      if (it.status === "CLASSIFIED" && !it.category) {
        const cls = GHS_CATALOG.find((c) => c.code === it.hazardClass);
        return setError(t.needCategory(cls ? (ja ? cls.nameJa : cls.nameEn) : it.hazardClass));
      }
    }
    setBusy(true);
    try {
      const res = await fetch("/api/modules/sds/ghs-data/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substanceId: row.id, country: scope, reason: reason.trim(), items }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? `HTTP ${res.status}`);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const adoptedText = (cls: string): string => {
    const c = row.cells[cls];
    if (!c || c.status === "NOT_EVALUATED") return all.ghs.status.NOT_EVALUATED;
    const from = c.from ? ` (${all.data.sourceShort[c.from] ?? c.from})` : "";
    if (c.status !== "CLASSIFIED") return `${all.ghs.status[c.status]}${from}`;
    return `${c.items.map((it) => categoryText(cls, it.category, ja)).join("、")}${from}`;
  };

  return (
    <Card collapsible={false}>
      <CardHeader>
        <CardTitle className="text-base">
          {t.title(row.code, pickName(locale, row.nameJa, row.nameEn))}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="font-medium">{t.country}</span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="ghs-ov-scope"
              checked={scope === ""}
              onChange={() => setScope("")}
            />
            {t.allCountries}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="ghs-ov-scope"
              checked={scope === country}
              onChange={() => setScope(country)}
            />
            {t.onlyCountry(countryName(country, locale))}
          </label>
          <span className="text-muted-foreground text-xs">{t.existing(existingCount)}</span>
        </div>
        {/* 登録済みの上書きを読み終えるまで入力欄を出さない（読み終えた瞬間に下書きを置き換えるため） */}
        <div className="overflow-x-auto" hidden={existing === null}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-1 pr-3 font-medium">{t.hazardClass}</th>
                <th className="py-1 pr-3 font-medium">{t.adopted}</th>
                <th className="py-1 pr-3 font-medium">{t.override}</th>
                <th className="py-1 pr-3 font-medium">{t.category}</th>
                <th className="py-1 font-medium">{t.organs}</th>
              </tr>
            </thead>
            <tbody>
              {GHS_CATALOG.map((cls) => {
                const d = drafts[cls.code] ?? { status: null, category: "", targetOrgans: "" };
                return (
                  <tr key={cls.code} className="border-b align-top">
                    <td className="py-1 pr-3 whitespace-nowrap">{ja ? cls.nameJa : cls.nameEn}</td>
                    <td className="text-muted-foreground py-1 pr-3">{adoptedText(cls.code)}</td>
                    <td className="py-1 pr-3">
                      <select
                        aria-label={`${t.override} ${ja ? cls.nameJa : cls.nameEn}`}
                        value={d.status ?? ""}
                        disabled={busy}
                        onChange={(e) =>
                          setDraft(cls.code, {
                            status: (e.target.value || null) as GhsStatus | null,
                          })
                        }
                        className="border-input bg-background h-7 rounded-none border px-1 text-xs"
                      >
                        <option value="">{t.none}</option>
                        {CHOICES.map((s) => (
                          <option key={s} value={s}>
                            {all.ghs.status[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-3">
                      {d.status === "CLASSIFIED" && (
                        <select
                          aria-label={`${t.category} ${ja ? cls.nameJa : cls.nameEn}`}
                          value={d.category}
                          disabled={busy}
                          onChange={(e) => setDraft(cls.code, { category: e.target.value })}
                          className="border-input bg-background h-7 rounded-none border px-1 text-xs"
                        >
                          <option value="">—</option>
                          {cls.categories.map((k) => (
                            <option key={k.category} value={k.category}>
                              {ja
                                ? (k.nameJa ?? `区分${k.category}`)
                                : (k.nameEn ?? `Category ${k.category}`)}
                              {k.hCodes && k.hCodes.length > 0 ? ` (${k.hCodes.join(", ")})` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-1">
                      {d.status === "CLASSIFIED" && (
                        <Input
                          aria-label={`${t.organs} ${ja ? cls.nameJa : cls.nameEn}`}
                          value={d.targetOrgans}
                          disabled={busy}
                          onChange={(e) => setDraft(cls.code, { targetOrgans: e.target.value })}
                          className="h-7 text-xs"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ghs-ov-reason">{t.reason}</Label>
          <textarea
            id="ghs-ov-reason"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="border-input bg-background w-full rounded-none border px-2 py-1 text-sm"
          />
          <p className="text-muted-foreground text-xs">{t.reasonHint}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || existing === null}
            onClick={() => void save()}
          >
            {t.save}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
