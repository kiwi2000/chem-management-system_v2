"use client";

import { describePasswordPolicy, expandPermissions, pickName, type Permission } from "@chem/shared";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { FieldError } from "@/components/field-error";
import { GroupSelect } from "@/components/group-select";
import { PermissionPicker } from "@/components/permission-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGE_SHELL, PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { firstError, summaryError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import { passwordProblem } from "@/lib/password-check";
import { usePasswordPolicy } from "@/lib/use-password-policy";
import type { ApiError, MeDto, UserSummaryDto } from "@/lib/types";
import { useGroups } from "@/lib/use-groups";
import { useOrganisations } from "@/lib/use-organisations";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { m, locale } = useI18n();

  const [item, setItem] = useState<UserSummaryDto | null>(null);
  const [me, setMe] = useState<MeDto | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [activeFlag, setActiveFlag] = useState(true);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [orgGroupId, setOrgGroupId] = useState("");
  const [newsGroupId, setNewsGroupId] = useState("");
  const [organisationId, setOrganisationId] = useState("");
  const groups = useGroups();
  const organisations = useOrganisations();
  const [editing, setEditing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  // どの項目が悪いのかを、その欄の下に出す
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const policy = usePasswordPolicy();
  // 打っている最中から決まりを見る
  const pwProblem = passwordProblem(newPassword, m, policy);
  const [forceChange, setForceChange] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [uRes, meRes] = await Promise.all([fetch(`/api/admin/users/${id}`), fetch("/api/me")]);
    if (!uRes.ok) {
      if (redirectIfUnauthorized(uRes)) return;
      const body = (await uRes.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(uRes.status));
      return;
    }
    const u = ((await uRes.json()) as { item: UserSummaryDto }).item;
    setItem(u);
    setDisplayName(u.displayName ?? "");
    setActiveFlag(u.activeFlag);
    setPermissions(u.permissions);
    setOrgGroupId(u.orgGroupId ?? "");
    setOrganisationId(u.organisationId ?? "");
    setNewsGroupId(u.newsGroupId ?? "");
    if (meRes.ok) setMe((await meRes.json()) as MeDto);
  }, [id, m]);

  useEffect(() => {
    void load();
  }, [load]);

  const isSelf = me !== null && me.id === id;
  // 「他人のお知らせも編集できる」を選ぶと投稿もできるので、含意を展開して見る
  const canPost = expandPermissions(permissions).includes("NEWS_POST");

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName || null,
          permissions,
          activeFlag,
          orgGroupId: orgGroupId || null,
          organisationId: organisationId || null,
          newsGroupId: newsGroupId || null,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
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

  /**
   * パスキーの全消し。端末を失くした人の救済のためにある。
   * 2要素認証の強制解除と同じ役目
   */
  async function onResetPasskeys() {
    if (!confirm(m.passkey.adminResetConfirm)) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/users/${id}/passkeys`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    const { count } = (await res.json()) as { count: number };
    setNotice(m.passkey.adminResetDone(count));
    void load();
  }

  /**
   * 2要素認証の強制解除。端末を失くした人の救済のためにある。
   * これが無いと、本人が自分の口座から出られなくなる。
   */
  async function onResetMfa() {
    if (!confirm(m.mfa.adminResetConfirm)) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/admin/users/${id}/mfa`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    setNotice(m.common.saved);
    void load();
  }

  async function onResetPassword() {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    const res = await fetch(`/api/admin/users/${id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword, mustChangePassword: forceChange }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(
        summaryError(body?.error.details, body?.error.message ?? m.errors.saveFailed(res.status)),
      );
      setFieldErrors(toFieldErrors(body?.error.details));
      return;
    }
    setNewPassword("");
    setNotice(m.users.resetDone);
    void load();
  }

  if (!item) {
    return (
      <div className={PAGE_SHELL}>
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
    <div className={PAGE_SHELL_STACKED}>
      <h1 className="text-2xl font-semibold">{m.users.editTitle}</h1>

      {/* まず表示だけにして、「編集」を押してから書き換えられるようにする（物質・お知らせと同じ形） */}
      <div className="flex items-center gap-3">
        {editing ? (
          <Badge variant="secondary">{m.common.editMode}</Badge>
        ) : (
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
              <div className="space-y-2">
                <Label htmlFor="organisation">{m.users.organisation}</Label>
                {/* 会社は所属（部署）とは別。部署の無い人でも会社は決まる */}
                <select
                  id="organisation"
                  value={organisationId}
                  onChange={(e) => setOrganisationId(e.target.value)}
                  className="border-input bg-background h-9 max-w-xs rounded-none border px-2 text-sm"
                >
                  <option value="">{m.groups.none}</option>
                  {(organisations ?? [])
                    .filter((o) => o.activeFlag || o.id === organisationId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {pickName(locale, o.nameJa, o.nameEn)}
                      </option>
                    ))}
                </select>
                <p className="text-muted-foreground text-xs">{m.users.organisationHint}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="orgGroup">{m.users.orgGroup}</Label>
                <GroupSelect
                  id="orgGroup"
                  kind="ORG"
                  groups={groups}
                  value={orgGroupId}
                  locale={locale}
                  noneLabel={m.groups.none}
                  onChange={setOrgGroupId}
                />
                <p className="text-muted-foreground text-xs">{m.users.orgGroupHint}</p>
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
            <CardContent className="space-y-4">
              <PermissionPicker
                value={permissions}
                onChange={setPermissions}
                disabled={saving}
                adminLockedReason={isSelf ? m.users.selfNote : null}
              />
              {/* 投稿できる人にだけ意味があるので、権限が無いときは選ばせない */}
              <div className="space-y-2">
                <Label htmlFor="newsGroup">{m.users.newsGroup}</Label>
                <GroupSelect
                  id="newsGroup"
                  kind="NEWS"
                  groups={groups}
                  value={newsGroupId}
                  locale={locale}
                  noneLabel={m.groups.none}
                  disabled={!canPost}
                  onChange={setNewsGroupId}
                />
                <p className="text-muted-foreground text-xs">
                  {canPost ? m.users.newsGroupHint : m.users.newsGroupDisabled}
                </p>
              </div>
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
              {m.common.discard}
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
          <CardTitle className="text-base">{m.mfa.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            <span className="text-muted-foreground">{m.mfa.method} </span>
            <span className="font-medium">
              {item.mfaMethod === "totp" ? m.mfa.methodTotp : m.mfa.methodNone}
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={item.mfaMethod !== "totp"}
            onClick={() => void onResetMfa()}
          >
            {m.mfa.adminReset}
          </Button>
          {/* 認証アプリを登録していない人には、外すものが無いことを添える */}
          {item.mfaMethod !== "totp" && (
            <p className="text-muted-foreground text-xs">{m.mfa.notEnabledHere}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.passkey.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            <span className="text-muted-foreground">{m.passkey.registered} </span>
            <span className="font-medium">{m.passkey.deviceCount(item.passkeyCount)}</span>
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={item.passkeyCount === 0}
            onClick={() => void onResetPasskeys()}
          >
            {m.passkey.adminReset}
          </Button>
          {item.passkeyCount === 0 && (
            <p className="text-muted-foreground text-xs">{m.passkey.noneHere}</p>
          )}
        </CardContent>
      </Card>

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
              aria-invalid={Boolean(pwProblem ?? fieldError("newPassword"))}
              className="max-w-md font-mono"
            />
            <FieldError message={pwProblem ?? fieldError("newPassword")} />
            <p className="text-muted-foreground text-xs">{describePasswordPolicy(m, policy)}</p>
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
