"use client";

import type { Permission } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PermissionPicker } from "@/components/permission-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

export default function NewUserPage() {
  const router = useRouter();
  const { m } = useI18n();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          displayName: displayName || null,
          initialPassword,
          permissions,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      router.push("/admin/users");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.users.newTitle}</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="email">{m.users.email}</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="max-w-md"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">
                {m.users.displayName}
                {m.common.optional}
              </Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="max-w-md"
              />
              <p className="text-muted-foreground text-xs">{m.users.displayNameHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw">{m.users.initialPassword}</Label>
              <Input
                id="pw"
                type="text"
                required
                value={initialPassword}
                onChange={(e) => setInitialPassword(e.target.value)}
                className="max-w-md font-mono"
              />
              <p className="text-muted-foreground text-xs">{m.users.initialPasswordHint}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.users.permissions}</CardTitle>
          </CardHeader>
          <CardContent>
            <PermissionPicker value={permissions} onChange={setPermissions} disabled={saving} />
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? m.common.saving : m.common.save}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/users")}>
            {m.common.cancel}
          </Button>
        </div>
      </form>
    </div>
  );
}
