"use client";

import type { Locale } from "@chem/shared";
import { GripVertical } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { StaleEditNotice } from "@/components/stale-edit-notice";
import { readStaleEdit, type StaleEditInfo } from "@/lib/stale-edit";
import type { ApiError } from "@/lib/types";
import type { AdoptionRuleDto } from "@/lib/ghs/data-dto";
import { countryName } from "@/lib/ghs/countries";
import { ghsMessages } from "@/lib/ghs/messages";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

interface RulesDto {
  country: string;
  saved: boolean;
  rules: AdoptionRuleDto[];
  /** 楽観的ロックの印。保存時にそのまま送り返す */
  stamp: string;
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
  const t = ghsMessages(locale).data.rules;
  const { m } = useI18n();
  // つかんでいる行と、いま落とそうとしている行（ほかの一覧と同じ動き。components/data-table）
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [data, setData] = useState<RulesDto | null>(null);
  const [rules, setRules] = useState<AdoptionRuleDto[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ほかの管理者が先に保存していた知らせ
  const [stale, setStale] = useState<StaleEditInfo | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/ghs-data/rules?country=${encodeURIComponent(country)}`);
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

  /** 引いた行を、落とした行の位置へ移す（ほかの一覧の並べ替えと同じ決まり。例: api/countries/[id]/move） */
  const move = (fromKey: string, toKey: string) => {
    const moving = rules.find((r) => r.sourceCode === fromKey);
    if (!moving || fromKey === toKey) return;
    const next = rules.filter((r) => r.sourceCode !== fromKey);
    next.splice(
      next.findIndex((r) => r.sourceCode === toKey),
      0,
      moving,
    );
    setRules(next);
    setDirty(true);
  };
  const toggleFill = (i: number, v: boolean) => {
    setRules(rules.map((r, k) => (k === i ? { ...r, fillCannotClassify: v } : r)));
    setDirty(true);
  };

  /** 保存。`force` は「このまま保存する」（ほかの管理者の変更を見たうえで上書きする） */
  async function save(force = false) {
    setBusy(true);
    setError(null);
    if (!force) setStale(null);
    try {
      const res = await fetch("/api/ghs-data/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          rules: rules.map((r) => ({
            sourceCode: r.sourceCode,
            fillCannotClassify: r.fillCannotClassify,
          })),
          // 楽観的ロックの印（lib/edit-stamp.ts）
          stamp: data?.stamp ?? "0:0",
          force: force || undefined,
        }),
      });
      // ほかの管理者が先に保存していた。並びはそのまま残し、見てから決めてもらう
      const staleInfo = await readStaleEdit(res);
      if (staleInfo) {
        setStale(staleInfo);
        return;
      }
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
        <StaleEditNotice
          stale={stale}
          saving={busy}
          onForce={() => void save(true)}
          onDismiss={() => setStale(null)}
        />
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
          {rules.map((r, i) => {
            const key = r.sourceCode;
            const canDrop = isAdmin && !busy && dragKey !== null && dragKey !== key;
            return (
              <li
                key={key}
                // 落とし先になれるよう、重ねているあいだは既定の動きを止める
                onDragOver={
                  canDrop
                    ? (e) => {
                        e.preventDefault();
                        setOverKey(key);
                      }
                    : undefined
                }
                onDrop={
                  canDrop
                    ? (e) => {
                        e.preventDefault();
                        const from = dragKey;
                        setDragKey(null);
                        setOverKey(null);
                        move(from, key);
                      }
                    : undefined
                }
                className={cn(
                  "flex flex-wrap items-center gap-3 px-3 py-2 text-sm",
                  // いま落とそうとしている行が分かるよう、上端に線を引く
                  overKey === key && dragKey && "border-primary border-t-2",
                  dragKey === key && "opacity-50",
                )}
              >
                {isAdmin && (
                  <span
                    draggable={!busy}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox は中身を入れないと掴めない
                      e.dataTransfer.setData("text/plain", key);
                      setDragKey(key);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    title={m.table.reorder}
                    aria-label={m.table.reorder}
                    className="text-muted-foreground hover:text-foreground flex cursor-grab justify-center active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" />
                  </span>
                )}
                <span className="text-muted-foreground w-5 tabular-nums">{i + 1}</span>
                <span className="min-w-40 font-medium">{nameOf(r.sourceCode)}</span>
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
            );
          })}
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
