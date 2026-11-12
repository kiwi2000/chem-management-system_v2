"use client";

import {
  ALL_MARKS,
  dependentMarks,
  dependentsOf,
  expandPermissions,
  GROUP_PERMISSIONS,
  impliedMarks,
  lacksSubstanceForComposition,
  linkMarks,
  NO_MARKS,
  PERMISSION_GROUP_SELF,
  PERMISSION_GROUPS,
  PERMISSION_MARKS,
  pickName,
  type Permission,
  type PermissionMark,
  type PermissionMarks,
} from "@chem/shared";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { EditButton } from "@/components/edit-button";
import { EditingBadge } from "@/components/editing-badge";
import { FieldError } from "@/components/field-error";
import { OptionChecklist } from "@/components/option-checklist";
import { StaleEditNotice } from "@/components/stale-edit-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, summaryError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { readStaleEdit, type StaleEditInfo } from "@/lib/stale-edit";
import type {
  ApiError,
  ListResponse,
  PermissionGroupDetailDto,
  PermissionGroupListItemDto,
  UserSummaryDto,
} from "@/lib/types";
import { useOutsideClose } from "@/lib/use-outside-close";
import { cn } from "@/lib/utils";

/** 表の 1 行（画面の中）。manual は自分で付けた印。連動の印は表示のときに補う */
interface RowState {
  targetGroupId: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  manual: PermissionMarks;
}

/** 読み込んだ印から、ほかの印に連動して付いているものを除いて「自分で付けた印」にする */
function manualOf(marks: PermissionMarks): PermissionMarks {
  const out = { ...marks };
  for (const k of PERMISSION_MARKS) {
    if (!marks[k]) continue;
    const others = { ...marks, [k]: false };
    if (impliedMarks(others).has(k) || linkMarks(others)[k]) {
      // 他の印から導けるなら、自分で付けたものとしない
      out[k] = false;
    }
  }
  return out;
}

/** 表の列（参照・編集 × 3） */
const COLS: { mark: PermissionMark; group: "product" | "composition" | "substance" }[] = [
  { mark: "productView", group: "product" },
  { mark: "productEdit", group: "product" },
  { mark: "compositionView", group: "composition" },
  { mark: "compositionEdit", group: "composition" },
  { mark: "substanceView", group: "substance" },
  { mark: "substanceEdit", group: "substance" },
];

/** 表とは別の権限の並び（画面のまとまり。製品・組成・物質・システムは除く） */
const PERMISSION_SECTIONS = PERMISSION_GROUPS.map((g) => ({
  key: g.key,
  permissions: g.permissions.filter((p) => GROUP_PERMISSIONS.includes(p)),
})).filter((g) => g.permissions.length > 0);

/**
 * 権限グループの登録・詳細（S31 画面設計 3 章）。
 * 既存は表示のみで開き、「編集」で書き換え可にする。人の追加・削除は保存を待たずに確定する
 */
export function PermissionGroupForm({ id }: { id: string | null }) {
  const router = useRouter();
  const { m, locale } = useI18n();
  const ask = useConfirm();
  const isNew = id === null;

  const [item, setItem] = useState<PermissionGroupDetailDto | null>(null);
  const [all, setAll] = useState<PermissionGroupListItemDto[]>([]);
  const [editing, setEditing] = useState(isNew);
  const [code, setCode] = useState("");
  const [nameJa, setNameJa] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [rows, setRows] = useState<RowState[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [stale, setStale] = useState<StaleEditInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const nameOf = useCallback(
    (x: { nameJa: string; nameEn: string | null }) => pickName(locale, x.nameJa, x.nameEn),
    [locale],
  );

  const load = useCallback(async () => {
    setError(null);
    // 件数は受け付ける上限（PAGE_SIZE_MAX = 500）まで。超える数を頼むと黙って 15 件に落ちる（2026-11-12 に 1000 で起きた）
    const listRes = await fetch("/api/admin/permission-groups?size=500");
    if (listRes.ok)
      setAll(((await listRes.json()) as ListResponse<PermissionGroupListItemDto>).items);
    if (isNew) {
      // 新しく作るときは、自分の行に 6 つ全部の印が付いた状態から（画面設計 3-2）
      setRows([
        {
          targetGroupId: PERMISSION_GROUP_SELF,
          code: "",
          nameJa: "",
          nameEn: null,
          manual: { ...ALL_MARKS },
        },
      ]);
      return;
    }
    const res = await fetch(`/api/admin/permission-groups/${id}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    const g = ((await res.json()) as { item: PermissionGroupDetailDto }).item;
    setItem(g);
    setCode(g.code);
    setNameJa(g.nameJa);
    setNameEn(g.nameEn ?? "");
    setPermissions(g.permissions);
    setRows(
      g.rows.map((r) => ({
        targetGroupId: r.targetGroupId,
        code: r.targetCode,
        nameJa: r.targetNameJa,
        nameEn: r.targetNameEn,
        manual: manualOf(
          Object.fromEntries(PERMISSION_MARKS.map((k) => [k, r[k]])) as PermissionMarks,
        ),
      })),
    );
  }, [id, isNew, m]);

  useEffect(() => {
    void load();
  }, [load]);

  const sysAdmin = item?.isSystemAdmin ?? false;
  const selfId = isNew ? PERMISSION_GROUP_SELF : (id as string);
  const rowLabel = (r: RowState) =>
    r.targetGroupId === selfId
      ? `${nameJa || code || ""}${m.permGroups.self}`
      : `${nameOf(r)}（${r.code}）`;

  // 相手に選べる権限グループ（表にまだ無いもの。システム管理グループは相手にならない）
  const addable = useMemo(() => {
    const have = new Set(rows.map((r) => r.targetGroupId));
    const opts = all
      .filter((g) => !g.isSystemAdmin && !have.has(g.id) && g.id !== id)
      .map((g) => ({ value: g.id, label: `${nameOf(g)}（${g.code}）` }));
    if (!have.has(selfId)) opts.unshift({ value: selfId, label: m.permGroups.self });
    return opts;
  }, [all, rows, id, selfId, nameOf, m]);

  function addTargets(ids: string[]) {
    setRows((prev) => [
      ...prev,
      ...ids
        .filter((v) => !prev.some((r) => r.targetGroupId === v))
        .map((v) => {
          const g = all.find((x) => x.id === v);
          return {
            targetGroupId: v,
            code: g?.code ?? "",
            nameJa: g?.nameJa ?? "",
            nameEn: g?.nameEn ?? null,
            manual: { ...NO_MARKS },
          };
        }),
    ]);
  }

  function toggle(targetGroupId: string, mark: PermissionMark, on: boolean) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.targetGroupId !== targetGroupId) return r;
        const manual = { ...r.manual, [mark]: on };
        // 外すと、それを前提にしている印も外れる（参照を外すと編集も外れる。仕様 6-2）
        if (!on) for (const d of dependentMarks(mark)) manual[d] = false;
        return { ...r, manual };
      }),
    );
  }

  function togglePermission(p: Permission, on: boolean) {
    if (on) setPermissions((prev) => expandPermissions([...prev, p]));
    else {
      const drop = new Set<Permission>([p, ...dependentsOf(p)]);
      setPermissions((prev) => expandPermissions(prev.filter((x) => !drop.has(x))));
    }
  }

  async function save(force = false) {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    if (!force) setStale(null);
    setSaving(true);
    try {
      const body = {
        ...(isNew ? {} : { stamp: item?.stamp ?? "", force: force || undefined }),
        code,
        nameJa,
        nameEn: nameEn || null,
        rows: rows.map((r) => ({ targetGroupId: r.targetGroupId, ...linkMarks(r.manual) })),
        permissions,
      };
      const res = await fetch(
        isNew ? "/api/admin/permission-groups" : `/api/admin/permission-groups/${id}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const staleInfo = await readStaleEdit(res);
      if (staleInfo) {
        setStale(staleInfo);
        return;
      }
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const b = (await res.json().catch(() => null)) as ApiError | null;
        setError(
          summaryError(b?.error.details, b?.error.message ?? m.errors.saveFailed(res.status)),
        );
        setFieldErrors(toFieldErrors(b?.error.details));
        return;
      }
      if (isNew) {
        const { id: created } = (await res.json()) as { id: string };
        router.push(`/admin/permission-groups/${created}`);
        return;
      }
      setNotice(m.common.saved);
      setEditing(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && !item) {
    return (
      <div className={PAGE_SHELL_STACKED}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const fieldError = (key: string) => firstError(fieldErrors, key);
  const disabled = !editing || sysAdmin;

  return (
    <div className={PAGE_SHELL_STACKED}>
      <div className="text-muted-foreground text-xs">
        <Link href="/admin/permission-groups" className="underline underline-offset-2">
          {m.permGroups.title}
        </Link>
        {item ? ` › ${item.code}` : ""}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {isNew ? m.permGroups.newTitle : item ? nameOf(item) : ""}
        </h1>
        {sysAdmin && <Badge>{m.permGroups.systemAdmin}</Badge>}
        {editing && !sysAdmin ? (
          <EditingBadge />
        ) : (
          !sysAdmin && <EditButton onClick={() => setEditing(true)} />
        )}
      </div>

      {sysAdmin && (
        <Alert>
          <AlertDescription>{m.permGroups.systemAdminNote}</AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.permGroups.basic}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="pg-code">{m.permGroups.code}</Label>
              <Input
                id="pg-code"
                value={code}
                disabled={disabled}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={Boolean(fieldError("code"))}
              />
              <FieldError message={fieldError("code")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pg-name">{m.permGroups.nameJa}</Label>
              <Input
                id="pg-name"
                value={nameJa}
                disabled={disabled}
                onChange={(e) => setNameJa(e.target.value)}
                aria-invalid={Boolean(fieldError("nameJa"))}
              />
              <FieldError message={fieldError("nameJa")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pg-name-en">
                {m.permGroups.nameEn}
                {m.common.optional}
              </Label>
              <Input
                id="pg-name-en"
                value={nameEn}
                disabled={disabled}
                onChange={(e) => setNameEn(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {!sysAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {m.permGroups.tableTitle}
                <span className="text-muted-foreground ml-3 text-xs font-normal">
                  {m.permGroups.tableHint}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-xs">
                      <th rowSpan={2} className="border-b px-2 py-1 text-left font-semibold">
                        {m.permGroups.targetHeader}
                      </th>
                      <th colSpan={2} className="border-b border-l px-2 py-1 text-center">
                        {m.permGroups.productGroup}
                      </th>
                      <th colSpan={2} className="border-b border-l px-2 py-1 text-center">
                        {m.permGroups.compositionGroup}
                      </th>
                      <th colSpan={2} className="border-b border-l px-2 py-1 text-center">
                        {m.permGroups.substanceGroup}
                      </th>
                      <th rowSpan={2} className="border-b" />
                    </tr>
                    <tr className="bg-muted/50 text-xs">
                      {COLS.map((c, i) => (
                        <th
                          key={c.mark}
                          className={cn(
                            "border-b px-2 py-1 text-center font-normal",
                            i % 2 === 0 && "border-l",
                          )}
                        >
                          {c.mark.endsWith("View") ? m.permGroups.view : m.permGroups.edit}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const linked = linkMarks(r.manual);
                      const implied = impliedMarks(r.manual);
                      return (
                        <tr key={r.targetGroupId} className="border-b">
                          <td className="px-2 py-1 whitespace-nowrap">{rowLabel(r)}</td>
                          {COLS.map((c, i) => (
                            <td
                              key={c.mark}
                              className={cn("px-2 py-1 text-center", i % 2 === 0 && "border-l")}
                            >
                              <input
                                type="checkbox"
                                aria-label={`${rowLabel(r)} ${c.mark}`}
                                checked={linked[c.mark]}
                                disabled={disabled || implied.has(c.mark)}
                                className={cn(implied.has(c.mark) && "opacity-50")}
                                onChange={(e) => toggle(r.targetGroupId, c.mark, e.target.checked)}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1 text-right">
                            {!disabled && (
                              <button
                                type="button"
                                aria-label={m.permGroups.removeRow}
                                title={m.permGroups.removeRow}
                                onClick={() =>
                                  setRows((prev) =>
                                    prev.filter((x) => x.targetGroupId !== r.targetGroupId),
                                  )
                                }
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <X className="size-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!disabled && (
                <AddTargets options={addable} onAdd={addTargets} label={m.permGroups.addTarget} />
              )}
              <p className="text-muted-foreground text-xs">
                {m.permGroups.noTargetNote}。{m.permGroups.autoMarkHint}
              </p>
              {rows
                .filter((r) => lacksSubstanceForComposition(linkMarks(r.manual)))
                .map((r) => (
                  <Alert key={r.targetGroupId}>
                    <AlertDescription>{m.permGroups.lacksSubstance(rowLabel(r))}</AlertDescription>
                  </Alert>
                ))}
            </CardContent>
          </Card>
        )}

        {!sysAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {m.permGroups.permissionsTitle}
                <span className="text-muted-foreground ml-3 text-xs font-normal">
                  {m.permGroups.permissionsHint}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-8 gap-y-3">
              {PERMISSION_SECTIONS.map((sec) => (
                <fieldset key={sec.key} className="min-w-48 space-y-1">
                  <legend className="text-muted-foreground mb-1 text-xs font-medium">
                    {m.permissionGroups[sec.key as keyof typeof m.permissionGroups]}
                  </legend>
                  {sec.permissions.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={permissions.includes(p)}
                        disabled={disabled}
                        onChange={(e) => togglePermission(p, e.target.checked)}
                      />
                      {m.permissions[p as keyof typeof m.permissions]}
                    </label>
                  ))}
                </fieldset>
              ))}
            </CardContent>
          </Card>
        )}

        <StaleEditNotice
          stale={stale}
          saving={saving}
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
        {editing && !sysAdmin && (
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (isNew) {
                  router.push("/admin/permission-groups");
                  return;
                }
                void load();
                setStale(null);
                setEditing(false);
              }}
            >
              {isNew ? m.common.cancel : m.common.discard}
            </Button>
          </div>
        )}
      </form>

      {isNew ? (
        <p className="text-muted-foreground text-sm">{m.permGroups.membersAfterCreate}</p>
      ) : (
        item && <MembersCard group={item} onChanged={() => void load()} ask={ask} />
      )}
    </div>
  );
}

/** 相手の権限グループを足す小窓（選択肢の小窓。components/option-checklist.tsx） */
function AddTargets({
  options,
  onAdd,
  label,
}: {
  options: { value: string; label: string }[];
  onAdd: (ids: string[]) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const close = useCallback(() => {
    setOpen(false);
    setPicked((p) => {
      if (p.length > 0) onAdd(p);
      return [];
    });
  }, [onAdd]);
  const ref = useOutsideClose<HTMLDivElement>(open, close);
  return (
    <div ref={ref} className="relative inline-block">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label}
      </Button>
      {open && (
        <div className="bg-popover absolute z-20 mt-1 w-80 rounded-none border p-2 shadow-md">
          <OptionChecklist
            size="sm"
            options={options}
            isChecked={(v) => picked.includes(v)}
            onToggle={(v, on) => setPicked((p) => (on ? [...p, v] : p.filter((x) => x !== v)))}
            onSelectAll={(shown) => setPicked((p) => [...new Set([...p, ...shown])])}
            onClearAll={(shown) => setPicked((p) => p.filter((x) => !shown.includes(x)))}
          />
        </div>
      )}
    </div>
  );
}

/** 入っている人（その場で追加・削除する。画面設計の決定 1） */
function MembersCard({
  group,
  onChanged,
  ask,
}: {
  group: PermissionGroupDetailDto;
  onChanged: () => void;
  ask: ReturnType<typeof useConfirm>;
}) {
  const { m } = useI18n();
  const [users, setUsers] = useState<UserSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      // 足せるのは有効な人だけ（一覧の既定）。件数は受け付ける上限の 500 まで
      const res = await fetch("/api/admin/users?size=500");
      if (res.ok) setUsers(((await res.json()) as ListResponse<UserSummaryDto>).items);
    })();
  }, []);

  const memberIds = new Set(group.members.map((x) => x.userId));
  const options = users
    .filter((u) => !memberIds.has(u.id))
    .map((u) => ({
      value: u.id,
      label: u.displayName ? `${u.displayName}（${u.email}）` : u.email,
    }));
  const reasonLabel = (r: PermissionGroupDetailDto["members"][number]["reason"]) =>
    r === "DEFAULT"
      ? m.permGroups.reasonDEFAULT
      : r === "MIGRATED"
        ? m.permGroups.reasonMIGRATED
        : m.permGroups.reasonMANUAL;
  const lastAdmin = group.isSystemAdmin && group.members.filter((x) => x.activeFlag).length <= 1;

  async function add() {
    setOpen(false);
    if (picked.length === 0) return;
    setError(null);
    const res = await fetch(`/api/admin/permission-groups/${group.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: picked }),
    });
    setPicked([]);
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as ApiError | null;
      setError(b?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    onChanged();
  }

  async function remove(userId: string, who: string) {
    if (!(await ask({ message: m.permGroups.removeMemberConfirm(who), destructive: true }))) return;
    setError(null);
    const res = await fetch(
      `/api/admin/permission-groups/${group.id}/members?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as ApiError | null;
      setError(b?.error.message ?? m.errors.deleteFailed);
      return;
    }
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {m.permGroups.membersTitle}
          <span className="text-muted-foreground ml-3 text-xs font-normal">
            {m.permGroups.memberCountLabel(group.members.length)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground text-xs">
                <th className="border-b px-2 py-1 text-left">{m.users.displayName}</th>
                <th className="border-b px-2 py-1 text-left">{m.users.email}</th>
                <th className="border-b px-2 py-1 text-left">{m.users.organisation}</th>
                <th className="border-b px-2 py-1 text-left">{m.permGroups.reason}</th>
                <th className="border-b" />
              </tr>
            </thead>
            <tbody>
              {group.members.map((x) => (
                <tr key={x.userId} className="border-b">
                  <td className="px-2 py-1">
                    <Link
                      href={`/admin/users/${x.userId}`}
                      className="underline underline-offset-2"
                    >
                      {x.displayName ?? x.email}
                    </Link>
                  </td>
                  <td className="px-2 py-1 font-mono text-xs">{x.email}</td>
                  <td className="text-muted-foreground px-2 py-1 text-xs">
                    {x.organisationPath ?? ""}
                  </td>
                  <td className="text-muted-foreground px-2 py-1 text-xs">
                    {reasonLabel(x.reason)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {lastAdmin ? (
                      <span className="text-muted-foreground text-xs">
                        {m.permGroups.lastMember}
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={m.permGroups.removeMember}
                        title={m.permGroups.removeMember}
                        onClick={() => void remove(x.userId, x.displayName ?? x.email)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="relative inline-block">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (open ? void add() : setOpen(true))}
          >
            {m.permGroups.addMember}
          </Button>
          {open && (
            <div className="bg-popover absolute z-20 mt-1 w-96 rounded-none border p-2 shadow-md">
              <OptionChecklist
                size="sm"
                options={options}
                isChecked={(v) => picked.includes(v)}
                onToggle={(v, on) => setPicked((p) => (on ? [...p, v] : p.filter((y) => y !== v)))}
                onSelectAll={(shown) => setPicked((p) => [...new Set([...p, ...shown])])}
                onClearAll={(shown) => setPicked((p) => p.filter((y) => !shown.includes(y)))}
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                  {m.common.cancel}
                </Button>
                <Button type="button" size="sm" onClick={() => void add()}>
                  {m.common.add}
                </Button>
              </div>
            </div>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{m.permGroups.membersImmediate}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
