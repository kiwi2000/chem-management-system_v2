"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { createPasskey, passkeySupported } from "@/lib/passkey-client";
import type { ApiError } from "@/lib/types";

interface Item {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * 自分のパスキー。
 *
 * **端末ごとに1つ登録する。**会社のPCと自宅のPCの両方から入るなら、両方で登録する。
 * 1台失くしても、別の端末から入り直して外せる。
 */
export function PasskeySection() {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 端末が対応しているかは、画面が出てから調べる（サーバー側では分からない）
  const [supported, setSupported] = useState(true);

  useEffect(() => setSupported(passkeySupported()), []);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/passkey").catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { items: Item[] };
    setItems(body.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setError(null);
    setBusy(true);
    try {
      const optRes = await fetch("/api/auth/passkey/register", { method: "POST" });
      if (!optRes.ok) {
        if (redirectIfUnauthorized(optRes)) return;
        const b = (await optRes.json().catch(() => null)) as ApiError | null;
        setError(b?.error.message ?? m.passkey.failed);
        return;
      }
      const outcome = await createPasskey(await optRes.json());
      if (!outcome.ok) {
        // やめただけなら赤い文字を出さない。壊れたように見せない
        if (outcome.reason === "cancelled") return;
        setError(outcome.reason === "unsupported" ? m.passkey.unsupported : m.passkey.failed);
        return;
      }
      const res = await fetch("/api/auth/passkey/register", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: outcome.value, deviceLabel: label.trim() }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const b = (await res.json().catch(() => null)) as ApiError | null;
        setError(b?.error.message ?? m.passkey.failed);
        return;
      }
      setLabel("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(it: Item) {
    if (!confirm(m.passkey.confirmRemove(it.deviceLabel))) return;
    setError(null);
    const res = await fetch(`/api/auth/passkey/${it.id}`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const b = (await res.json().catch(() => null)) as ApiError | null;
      setError(b?.error.message ?? m.errors.deleteFailed);
      return;
    }
    await load();
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "ja-JP");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m.passkey.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{m.passkey.lead}</p>
        <p className="text-muted-foreground text-sm">{m.passkey.why}</p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!supported ? (
          <Alert>
            <AlertDescription>{m.passkey.unsupported}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="pk-label">{m.passkey.deviceLabel}</Label>
              <Input
                id="pk-label"
                value={label}
                maxLength={60}
                placeholder={m.passkey.devicePlaceholder}
                onChange={(e) => setLabel(e.target.value)}
                className="w-64"
              />
            </div>
            <Button disabled={busy || label.trim() === ""} onClick={() => void add()}>
              {m.passkey.add}
            </Button>
          </div>
        )}
        <p className="text-muted-foreground text-xs">{m.passkey.deviceLabelHint}</p>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">{m.passkey.registered}</p>
          {items === null ? (
            <p className="text-muted-foreground text-sm">{m.common.loading}</p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{m.passkey.none}</p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">{it.deviceLabel}</span>
                  <span className="text-muted-foreground text-xs">
                    {m.passkey.createdAt} {fmt(it.createdAt)} ／ {m.passkey.lastUsedAt}{" "}
                    {it.lastUsedAt ? fmt(it.lastUsedAt) : m.passkey.neverUsed}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={m.passkey.remove}
                    aria-label={`${m.passkey.remove}: ${it.deviceLabel}`}
                    onClick={() => void remove(it)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
