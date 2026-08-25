"use client";

import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { countryName } from "@/lib/country-name";
import { useI18n } from "@/lib/i18n-client";
import type { AccessRiskKind, AccessStatsDto, ApiError } from "@/lib/types";

/** 見る範囲。短いと形が出ず、長いと古い話が混ざる */
const RANGES = [7, 30, 90];

/**
 * アクセス記録の分析。
 *
 * 記録は1件ずつ見ても何も分からない。**数えて初めて形が出る。**
 * 「いつも使っている形」を出しておいて、そこから外れたものに気づけるようにする。
 *
 * 図は自前で描く。棒と数字しか要らないので、そのために外から何かを
 * 読み込むと、このシステムの「外へ出さない」という作りを崩すことになる。
 */
export default function AccessStatsPage() {
  const { m, locale } = useI18n();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AccessStatsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/access-log/stats?days=${days}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    setData((await res.json()) as AccessStatsDto);
  }, [days, m]);

  useEffect(() => {
    void load();
  }, [load]);

  const place = (c: string | null) => countryName(c, locale, { local: m.accessLog.localPlace });

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{m.accessStats.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{m.accessStats.lead}</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={d === days ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {m.accessStats.lastDays(d)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href="/admin/access-log" />}
          >
            <ArrowLeft className="mr-1 size-4" />
            {m.accessStats.backToList}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!data && !error && <p className="text-muted-foreground text-sm">{m.common.loading}</p>}

      {data && (
        <>
          {/* まず全体の数。ここが普段と違えば、下の内訳を見る */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Total label={m.accessStats.totalLogin} value={data.totals.login} />
            <Total label={m.accessStats.totalFailed} value={data.totals.failed} warn />
            <Total label={m.accessStats.totalView} value={data.totals.view} />
            <Total label={m.accessStats.totalLockouts} value={data.totals.lockouts} warn />
          </div>

          {/* 気になる動きは、いちばん上に出す。埋もれさせない */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TriangleAlert className="size-4" />
                {m.accessStats.risks}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.risks.length === 0 ? (
                <p className="text-muted-foreground text-sm">{m.accessStats.noRisks}</p>
              ) : (
                <ul className="space-y-3">
                  {data.risks.map((r) => (
                    <li key={r.kind} className="space-y-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium">{riskTitle(m, r.kind)}</span>
                        <span className="text-muted-foreground text-sm">
                          {m.accessStats.times(r.count)}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">{riskWhy(m, r.kind)}</p>
                      <p className="text-sm">{r.samples.join(" ／ ")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.accessStats.byHour}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-3 text-xs">{m.accessStats.byHourWhy}</p>
              <HourChart data={data.byHour} m={m} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Ranking
              title={m.accessStats.topFailedUsers}
              why={m.accessStats.topFailedUsersWhy}
              empty={m.accessStats.none}
              rows={data.topFailedUsers.map((r) => ({
                key: r.email,
                label: r.email,
                value: r.count,
                suffix: m.accessStats.times(r.count),
              }))}
            />
            <Ranking
              title={m.accessStats.topFailedIps}
              why={m.accessStats.topFailedIpsWhy}
              empty={m.accessStats.none}
              rows={data.topFailedIps.map((r) => ({
                key: r.ip,
                label: r.ip,
                note: place(r.country),
                value: r.count,
                suffix: m.accessStats.times(r.count),
              }))}
            />
            <Ranking
              title={m.accessStats.topViewers}
              why={m.accessStats.topViewersWhy}
              empty={m.accessStats.none}
              rows={data.topViewers.map((r) => ({
                key: r.name,
                label: r.name,
                value: r.count,
                suffix: m.accessStats.viewCount(r.count),
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

type M = ReturnType<typeof useI18n>["m"];

function Total({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            // 0でない失敗は目に留まってほしい。0のときまで赤くすると、色が意味を失う
            warn && value > 0 ? "text-destructive" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * 時間帯ごとの棒。
 *
 * 24本を横に並べ、成功・失敗・組成を上へ積む。
 * 「普段は9〜18時に固まっている」という形が出れば、
 * そこから外れた棒が目に飛び込む。
 */
function HourChart({ data, m }: { data: AccessStatsDto["byHour"]; m: M }) {
  const max = Math.max(1, ...data.map((h) => h.login + h.failed + h.view));
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: 140 }}>
        {data.map((h) => {
          const total = h.login + h.failed + h.view;
          return (
            <div
              key={h.hour}
              className="flex flex-1 flex-col justify-end"
              style={{ height: "100%" }}
              title={`${h.hour}時 ／ ${m.accessStats.totalLogin} ${h.login} ／ ${m.accessStats.totalFailed} ${h.failed} ／ ${m.accessStats.totalView} ${h.view}`}
            >
              {/* 積む順は下から 成功・組成・失敗。失敗をいちばん上にして目立たせる */}
              <div
                className="bg-destructive"
                style={{ height: `${(h.failed / max) * 100}%` }}
                aria-hidden
              />
              <div
                className="bg-primary/40"
                style={{ height: `${(h.view / max) * 100}%` }}
                aria-hidden
              />
              <div
                className="bg-primary"
                style={{ height: `${(h.login / max) * 100}%` }}
                aria-hidden
              />
              <span className="sr-only">{`${h.hour}時 ${total}件`}</span>
            </div>
          );
        })}
      </div>
      <div className="text-muted-foreground mt-1 flex gap-[3px] text-[10px]">
        {data.map((h) => (
          // 3時間ごとにだけ数字を出す。全部出すと潰れて読めない
          <span key={h.hour} className="flex-1 text-center">
            {h.hour % 3 === 0 ? h.hour : ""}
          </span>
        ))}
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-xs">
        <Legend className="bg-primary" label={m.accessStats.totalLogin} />
        <Legend className="bg-primary/40" label={m.accessStats.totalView} />
        <Legend className="bg-destructive" label={m.accessStats.totalFailed} />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block size-3 rounded-sm ${className}`} aria-hidden />
      {label}
    </span>
  );
}

/** 上位の並び。棒の長さで、1位との差が一目で分かるようにする */
function Ranking({
  title,
  why,
  empty,
  rows,
}: {
  title: string;
  why: string;
  empty: string;
  rows: { key: string; label: string; note?: string; value: number; suffix: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-3 text-xs">{why}</p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{empty}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">
                    {r.label}
                    {r.note && <span className="text-muted-foreground ml-2 text-xs">{r.note}</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {r.suffix}
                  </span>
                </div>
                <div className="bg-muted h-1.5 w-full">
                  <div
                    className="bg-primary h-full"
                    style={{ width: `${(r.value / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function riskTitle(m: M, kind: AccessRiskKind): string {
  return m.accessStats.riskTitles[kind];
}

/** なぜ気になるのかを添える。理由が分からない警告は、そのうち読まれなくなる */
function riskWhy(m: M, kind: AccessRiskKind): string {
  return m.accessStats.riskWhy[kind];
}
