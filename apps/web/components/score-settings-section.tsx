"use client";

import { type RankBand, checkBands, describeBand } from "@chem/shared";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

/**
 * 物質のスコアをランクに読み替える対応表。**システム設定の一部**。
 *
 * 段の数は決めない。名前も数字でなくてよい。
 * 境目は値と不等号で持ち、隣どうしで同じ値を使えるようにしてある。
 *
 * **保存すると全物質を計算し直す。**段が変われば同じスコアでもランクが変わるため。
 * 件数が多いので、押してから戻るまで数秒待つ。
 */
export function ScoreSettingsSection() {
  const { m } = useI18n();
  const [bands, setBands] = useState<RankBand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/substance-rank-bands");
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setError(m.errors.loadFailed(res.status));
        setBands([]);
        return;
      }
      setBands(((await res.json()) as { items: RankBand[] }).items);
    })();
  }, [m]);

  function edit(i: number, patch: Partial<RankBand>) {
    setBands((prev) => prev?.map((b, j) => (i === j ? { ...b, ...patch } : b)) ?? prev);
  }

  function add() {
    setBands((prev) => [
      ...(prev ?? []),
      {
        label: "",
        lowerValue: "",
        lowerBound: "INCLUSIVE",
        upperValue: "",
        upperBound: "EXCLUSIVE",
        displayOrder: (prev?.length ?? 0) + 1,
      },
    ]);
  }

  async function save() {
    if (!bands) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/substance-rank-bands", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: bands.map((b, i) => ({
            label: b.label,
            lowerValue: b.lowerValue ?? "",
            lowerBound: b.lowerBound,
            upperValue: b.upperValue ?? "",
            upperBound: b.upperBound,
            displayOrder: i + 1,
            note: b.note ?? null,
          })),
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const { rescored } = (await res.json()) as { rescored: number };
      setNotice(m.score.recalcDone(rescored));
    } finally {
      setBusy(false);
    }
  }

  async function recalc() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/substances/rescore", { method: "POST" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const { rescored } = (await res.json()) as { rescored: number };
      setNotice(m.score.recalcDone(rescored));
    } finally {
      setBusy(false);
    }
  }

  if (!bands) return null;

  // 境目の見落とし。保存は止めず、気づきとして出すだけ
  const warnings = checkBands(bands);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m.score.bands}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-xs">{m.score.bandsHint}</p>

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

        {bands.length === 0 && <p className="text-muted-foreground text-sm">{m.score.bandEmpty}</p>}

        {bands.length > 0 && (
          <div className="space-y-2">
            {bands.map((b, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <div className="w-28 space-y-1">
                  {i === 0 && <Label className="text-xs">{m.score.bandLabel}</Label>}
                  <Input
                    value={b.label}
                    maxLength={50}
                    onChange={(e) => edit(i, { label: e.target.value })}
                  />
                </div>

                <div className="w-24 space-y-1">
                  {i === 0 && <Label className="text-xs">{m.score.bandLower}</Label>}
                  <Input
                    inputMode="decimal"
                    value={b.lowerValue ?? ""}
                    onChange={(e) => edit(i, { lowerValue: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <select
                  value={b.lowerBound ?? "INCLUSIVE"}
                  onChange={(e) =>
                    edit(i, { lowerBound: e.target.value as RankBand["lowerBound"] })
                  }
                  className="border-input bg-background h-9 rounded-none border px-2 text-sm"
                >
                  <option value="INCLUSIVE">{m.score.bandBoundInclusive}</option>
                  <option value="EXCLUSIVE">{m.score.bandBoundExclusive}</option>
                </select>

                <div className="w-24 space-y-1">
                  {i === 0 && <Label className="text-xs">{m.score.bandUpper}</Label>}
                  <Input
                    inputMode="decimal"
                    value={b.upperValue ?? ""}
                    onChange={(e) => edit(i, { upperValue: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <select
                  value={b.upperBound ?? "EXCLUSIVE"}
                  onChange={(e) =>
                    edit(i, { upperBound: e.target.value as RankBand["upperBound"] })
                  }
                  className="border-input bg-background h-9 rounded-none border px-2 text-sm"
                >
                  <option value="EXCLUSIVE">{m.score.bandUpperExclusive}</option>
                  <option value="INCLUSIVE">{m.score.bandUpperInclusive}</option>
                </select>

                <span className="text-muted-foreground pb-2 font-mono text-xs">
                  {describeBand(b)}
                </span>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={m.common.delete}
                  onClick={() => setBands(bands.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <Alert>
            <AlertDescription>
              <ul className="list-disc pl-4 text-xs">
                {warnings.map((w, i) => (
                  <li key={i}>
                    {w.kind === "overlap" && m.score.warnOverlap(w.at[0]!, w.at[1]!)}
                    {w.kind === "gap" && m.score.warnGap(w.at[0]!, w.at[1]!)}
                    {w.kind === "unreachable" && m.score.warnUnreachable(w.at[0]!)}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={add} disabled={busy}>
            <Plus className="mr-1 size-4" />
            {m.score.bandAdd}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {m.common.save}
          </Button>
          <span className="grow" />
          <Button type="button" variant="outline" onClick={() => void recalc()} disabled={busy}>
            {m.score.recalc}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{m.score.recalcHint}</p>
      </CardContent>
    </Card>
  );
}
