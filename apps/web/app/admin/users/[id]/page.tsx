"use client";

import type { Permission } from "@chem/shared";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { PermissionPicker } from "@/components/permission-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, MeDto, UserSummaryDto } from "@/lib/types";

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { m, locale } = useI18n();

  const [item, setItem] = useState<UserSummaryDto | null>(null);
  const [me, setMe] = useState<MeDto | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [activeFlag, setActiveFlag] = useState(true);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [uRes, meRes] = await Promise.all([fetch(`/api/admin/users/${id}`), fetch("/api/me")]);
    if (!uRes.ok) {
      const body = (await uRes.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(uRes.status));
      return;
    }
    const u = ((await uRes.json()) as { item: UserSummaryDto }).item;
    setItem(u);
    setDisplayName(u.displayName ?? "");
    setActiveFlag(u.activeFlag);
    setPermissions(u.permissions);
    if (meRes.ok) setMe((await meRes.json()) as MeDto);
  }, [id, m]);

  useEffect(() => {
    void load();
  }, [load]);

  const isSelf = me !== null && me.id === id;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName || null, permissions, activeFlag }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setNotice(m.common.saved);
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function onResetPassword() {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/users/${id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword, mustChangePassword: forceChange }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    setNewPassword("");
    setNotice(m.users.resetDone);
    void load();
  }

  if (!item) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground">{m.common.loading}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.users.editTitle}</h1>

      {/* まず表示だけにして、「編集」を押してから書き換えられるようにする（物質・お知らせと同じ形） */}
      <div className="flex items-center gap-3">
        <Badge variant={editing ? "secondary" : "outline"}>
          {editing ? m.common.editMode : m.common.viewMode}
        </Badge>
        {!editing && (
          <Button type="button" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 size-3.5" />
            {m.common.edit}
          </Button>
        )}
      </div>

      <form onSubmit={onSave} className="space-y-4">
        <fieldset disabled={!editing} className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-muted-foreground text-xs">{m.users.email}</div>
                  <div className="font-mono text-sm">{item.email}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">{m.users.lastLogin}</div>
                  <div className="text-sm">
                    {item.lastLoginAt
                      ? new Date(item.lastLoginAt).toLocaleString(locale)
                      : m.users.never}
                  </div>
                </div>
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
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={activeFlag}
                  disabled={isSelf}
                  onChange={(e) => setActiveFlag(e.target.checked)}
                />
                {m.users.activeFlag}
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.users.permissions}</CardTitle>
            </CardHeader>
            <CardContent>
              <PermissionPicker
                value={permissions}
                onChange={setPermissions}
                disabled={saving}
                adminLockedReason={isSelf ? m.users.selfNote : null}
              />
            </CardContent>
          </Card>
        </fieldset>

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

        {/* 表示のみのときは form の中に送信ボタンを置かない */}
        {editing && (
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // 書きかけを捨てて表示に戻す
                void load();
                setEditing(false);
              }}
            >
              {m.common.cancel}
            </Button>
          </div>
        )}
      </form>

      {!editing && (
        <Button type="button" variant="outline" onClick={() => router.push("/admin/users")}>
          {m.common.back}
        </Button>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.users.resetPassword}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="newpw">{m.users.newPassword}</Label>
            <Input
              id="newpw"
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="max-w-md font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={forceChange}
              onChange={(e) => setForceChange(e.target.checked)}
            />
            {m.users.forceChange}
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={newPassword.length === 0}
            onClick={() => void onResetPassword()}
          >
            {m.users.resetPassword}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
