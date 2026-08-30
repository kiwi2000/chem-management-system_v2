"use client";

import { describePasswordPolicy, expandPermissions, pickName, type Permission } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldError } from "@/components/field-error";
import { GroupSelect } from "@/components/group-select";
import { PermissionPicker } from "@/components/permission-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { firstError, summaryError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import { passwordProblem } from "@/lib/password-check";
import { usePasswordPolicy } from "@/lib/use-password-policy";
import { useOrganisations } from "@/lib/use-organisations";
import type { ApiError } from "@/lib/types";
import { useGroups } from "@/lib/use-groups";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

export default function NewUserPage() {
  const router = useRouter();
  const { m, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [organisationId, setOrganisationId] = useState("");
  const organisations = useOrganisations();
  const [newsGroupId, setNewsGroupId] = useState("");
  const groups = useGroups();
  const [error, setError] = useState<string | null>(null);
  // どの項目が悪いのかを、その欄の下に出す
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [saving, setSaving] = useState(false);

  const policy = usePasswordPolicy();
  // 打っている最中から決まりを見る。送ってから断られるより早く気づける
  const pwProblem = passwordProblem(initialPassword, m, policy);

  // 「他人のお知らせも編集できる」を選ぶと投稿もできるので、含意を展開して見る
  const canPost = expandPermissions(permissions).includes("NEWS_POST");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
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
          departmentId: departmentId || null,
          organisationId: organisationId || null,
          newsGroupId: newsGroupId || null,
        }),
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
      router.push("/admin/users");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={PAGE_SHELL_STACKED}>
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
                aria-invalid={Boolean(fieldError("email"))}
                className="max-w-md"
              />
              <FieldError message={fieldError("email")} />
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
                aria-invalid={Boolean(fieldError("displayName"))}
                className="max-w-md"
              />
              <FieldError message={fieldError("displayName")} />
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
                aria-invalid={Boolean(pwProblem ?? fieldError("initialPassword"))}
                className="max-w-md font-mono"
              />
              <FieldError message={pwProblem ?? fieldError("initialPassword")} />
              <p className="text-muted-foreground text-xs">{describePasswordPolicy(m, policy)}</p>
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
                  .filter((o) => o.activeFlag)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {pickName(locale, o.nameJa, o.nameEn)}
                    </option>
                  ))}
              </select>
              <p className="text-muted-foreground text-xs">{m.users.organisationHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">{m.users.department}</Label>
              {/* 組織のうち種別が「部署」のものから選ぶ */}
              <select
                id="department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="border-input bg-background h-9 w-full rounded-none border px-2 text-sm"
              >
                <option value="">{m.groups.none}</option>
                {(organisations ?? [])
                  .filter((o) => o.kind === "DEPARTMENT" && o.activeFlag)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {pickName(locale, o.nameJa, o.nameEn)}
                    </option>
                  ))}
              </select>
              <p className="text-muted-foreground text-xs">{m.users.departmentHint}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.users.permissions}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PermissionPicker value={permissions} onChange={setPermissions} disabled={saving} />
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

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={saving || Boolean(pwProblem)}>
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
