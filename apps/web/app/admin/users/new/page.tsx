"use client";

import { describePasswordPolicy } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { FieldError } from "@/components/field-error";
import { OrganisationSelect } from "@/components/organisation-select";
import { PermissionGroupChips } from "@/components/permission-group-chips";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { firstError, summaryError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import { passwordProblem } from "@/lib/password-check";
import { usePasswordPolicy } from "@/lib/use-password-policy";
import { useOrganisations } from "@/lib/use-organisations";
import { usePermissionGroupOptions } from "@/lib/use-permission-group-options";
import { ancestorIds } from "@/lib/org-tree";
import type { ApiError } from "@/lib/types";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

export default function NewUserPage() {
  const router = useRouter();
  const { m } = useI18n();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  // S31: 組織は 1 つ。選ぶと「最初に選ばれる権限グループ」が入った状態になる（仕様 8-2）
  const [organisationId, setOrganisationId] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const organisations = useOrganisations();
  const groupOptions = usePermissionGroupOptions();
  const [error, setError] = useState<string | null>(null);
  // どの項目が悪いのかを、その欄の下に出す
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [saving, setSaving] = useState(false);

  const policy = usePasswordPolicy();
  // 打っている最中から決まりを見る。送ってから断られるより早く気づける
  const pwProblem = passwordProblem(initialPassword, m, policy);

  // 組織とその上の組織に設定した「最初に選ばれる権限グループ」
  const defaultsOf = useCallback(
    (orgId: string) =>
      new Set(
        ancestorIds(organisations ?? [], orgId || null).flatMap(
          (x) => groupOptions?.orgDefaults[x] ?? [],
        ),
      ),
    [organisations, groupOptions],
  );
  const defaults = useMemo(() => defaultsOf(organisationId), [defaultsOf, organisationId]);

  function changeOrganisation(next: string) {
    setOrganisationId(next);
    setGroupIds([...defaultsOf(next)]);
  }

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
          organisationId,
          groupIds,
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
              <OrganisationSelect
                id="organisation"
                organisations={organisations}
                value={organisationId}
                noneLabel={m.users.organisationNone}
                onChange={changeOrganisation}
              />
              <FieldError message={fieldError("organisationId")} />
              <p className="text-muted-foreground text-xs">{m.users.organisationHint}</p>
            </div>
            <div className="space-y-2">
              <Label>{m.users.permissionGroups}</Label>
              <PermissionGroupChips
                options={groupOptions?.groups ?? []}
                value={groupIds}
                onChange={setGroupIds}
                defaults={defaults}
                emptyLabel={m.users.permissionGroupsNone}
              />
              <p className="text-muted-foreground text-xs">{m.users.permissionGroupsHint}</p>
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
