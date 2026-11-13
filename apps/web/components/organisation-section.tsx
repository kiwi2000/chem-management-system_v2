"use client";

import { kindLabelOf, ORGANISATION_KINDS, pickName, type OrganisationKind } from "@chem/shared";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Handshake,
  Plus,
  Shapes,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { TABLE_TITLE } from "@/components/data-table/data-table";
import { EditButton } from "@/components/edit-button";
import { EditingBadge } from "@/components/editing-badge";
import { OrganisationSelect } from "@/components/organisation-select";
import { PermissionGroupChips } from "@/components/permission-group-chips";
import { ancestorIds, descendantIds, flattenOrgTree, orgPathLabel } from "@/lib/org-tree";
import { useOrganisationList } from "@/lib/use-organisations";
import { usePermissionGroupOptions } from "@/lib/use-permission-group-options";
import { StaleEditNotice } from "@/components/stale-edit-notice";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { readStaleEdit, type StaleEditInfo } from "@/lib/stale-edit";
import { useMe } from "@/lib/use-me";
import type { ApiError, OrganisationDto } from "@/lib/types";

/** 種別ごとの絵。組織図で会社・部署・取引先を見分ける */
const KIND_ICON = {
  COMPANY: Building2,
  DEPARTMENT: Users,
  PARTNER: Handshake,
  OTHER: Shapes,
} as const;

interface ItemDraft {
  label: string;
  value: string;
}

const EMPTY_FORM = {
  id: "",
  /** 読み込んだときの印（楽観的ロック）。既存のものを直すときだけ送る */
  stamp: "",
  code: "",
  kind: "COMPANY" as OrganisationKind,
  kindLabel: "",
  nameJa: "",
  nameEn: "",
  displayOrder: 0,
  activeFlag: true,
  /** 上の組織（S31）。空ならいちばん上 */
  parentId: "",
  /** 最初に選ばれる管理グループ（S31。システム管理グループの人だけが直す） */
  defaultGroupIds: [] as string[],
  items: [] as ItemDraft[],
};

/**
 * 組織。会社・部署・取引先・そのほかを、組織図（木）で見せる（2026-11-13。利用者が選んだ案 A）。
 * 左に組織図、右に選んだ組織の中身。まず表示のみで見せ、「編集」で書き換えられるようにする。
 *
 * **ここは一覧の共通の表（data-table）を使わない例外。**主役が上下の関係で、列で並べ替える場面がほとんど無い。
 * 件数も少ない（多くても数百）ので、全部を 1 回で読み、名称・コードで探す欄だけを置く。
 *
 * **持つ項目を決めない。**名称・住所・電話・登録番号…と、
 * 求められるものが提出先によって違う。項目名も値も打ってもらう。
 * ここで付けた項目名が、そのままドキュメントの差込項目になる。
 *
 * **見るのは誰でも。**帳票の宛先に選ぶために引く。
 * 作る・直す・消すには `ORG_EDIT` が要る
 */
export function OrganisationSection() {
  const { m, locale } = useI18n();
  const { me, can } = useMe();
  const editable = can("ORG_EDIT");
  // 最初に選ばれる管理グループは、システム管理グループの人にだけ出す（S31 画面設計 6 章）
  const isAdmin = me?.isAdmin ?? false;
  // 組織図と、上の組織の選択肢のもと。この画面で組織を書き換えるので、保存・削除のたびに読み直す
  const { items: allOrgs, reload: reloadAllOrgs } = useOrganisationList();
  const groupOptions = usePermissionGroupOptions(isAdmin);
  const adminGroups = useMemo(
    () => (groupOptions?.groups ?? []).filter((g) => !g.isSystemAdmin),
    [groupOptions],
  );
  /** 種別の呼び名。画面の言語で出す */
  const kindNames = useMemo(
    () => ({
      COMPANY: m.organisations.kindCompany,
      DEPARTMENT: m.organisations.kindDepartment,
      PARTNER: m.organisations.kindPartner,
      OTHER: m.organisations.kindOther,
    }),
    [m],
  );

  const ask = useConfirm();
  const [form, setForm] = useState({ ...EMPTY_FORM });
  /** 開いたときの入力（書き換えたかどうかを見るため） */
  const [formAtStart, setFormAtStart] = useState("");
  /** 右側に出しているもの。view は表示のみ、edit は選んだ組織の編集、new は新規登録 */
  const [mode, setMode] = useState<"view" | "edit" | "new">("view");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 閉じている枝（下の組織を隠している組織の id）。最初は全部開いている */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  /** つかんで動かしている組織と、いま上に重なっている置き先（"" はいちばん上） */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** ほかの人が先に保存していた知らせ */
  const [stale, setStale] = useState<StaleEditInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const orgs = useMemo(() => allOrgs ?? [], [allOrgs]);
  const tree = useMemo(() => flattenOrgTree(orgs), [orgs]);
  /** 下に組織を持つ組織 */
  const parents = useMemo(
    () => new Set(orgs.map((o) => o.parentId).filter((v): v is string => v !== null)),
    [orgs],
  );
  const selected = orgs.find((o) => o.id === selectedId) ?? null;
  const name = (o: OrganisationDto) => pickName(locale, o.nameJa, o.nameEn);

  /** 組織図に出す行。探しているときは当たった組織とその上を出し、開閉は見ない */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q !== "") {
      const keep = new Set<string>();
      for (const o of orgs) {
        if ([o.code, o.nameJa, o.nameEn ?? ""].some((s) => s.toLowerCase().includes(q))) {
          for (const id of ancestorIds(orgs, o.id)) keep.add(id);
        }
      }
      return tree.filter((x) => keep.has(x.org.id));
    }
    const out: typeof tree = [];
    let hideBelow: number | null = null;
    for (const x of tree) {
      if (hideBelow !== null) {
        if (x.depth > hideBelow) continue;
        hideBelow = null;
      }
      out.push(x);
      if (closed.has(x.org.id)) hideBelow = x.depth;
    }
    return out;
  }, [tree, orgs, closed, search]);

  /** 書きかけがあれば、捨ててよいか確かめる。進めてよければ true */
  async function leaveEditing(): Promise<boolean> {
    if (mode === "view") return true;
    if (JSON.stringify(form) !== formAtStart) {
      if (!(await ask({ message: m.organisations.discardConfirm }))) return false;
    }
    setMode("view");
    setStale(null);
    setError(null);
    return true;
  }

  async function select(id: string) {
    if (id === selectedId && mode === "view") return;
    if (!(await leaveEditing())) return;
    setSelectedId(id);
  }

  function openForm(next: typeof EMPTY_FORM, nextMode: "edit" | "new") {
    setError(null);
    setStale(null);
    setForm(next);
    setFormAtStart(JSON.stringify(next));
    setMode(nextMode);
  }

  /** 新規登録。parent を渡すと、その組織の下に足す形で開く（上の組織が入り、種別は部署） */
  async function startNew(parent?: OrganisationDto) {
    if (!(await leaveEditing())) return;
    openForm(
      parent
        ? { ...EMPTY_FORM, items: [], parentId: parent.id, kind: "DEPARTMENT" }
        : { ...EMPTY_FORM, items: [] },
      "new",
    );
  }

  function startEdit(o: OrganisationDto) {
    openForm(
      {
        id: o.id,
        stamp: o.stamp,
        code: o.code,
        kind: o.kind,
        kindLabel: o.kindLabel ?? "",
        nameJa: o.nameJa,
        nameEn: o.nameEn ?? "",
        displayOrder: o.displayOrder,
        activeFlag: o.activeFlag,
        parentId: o.parentId ?? "",
        defaultGroupIds: o.defaultGroupIds ?? [],
        items: o.items.map((x) => ({ ...x })),
      },
      "edit",
    );
  }

  const toggleBranch = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save(force = false) {
    setError(null);
    if (!force) setStale(null);
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(editing ? `/api/organisations/${form.id}` : "/api/organisations", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 既存のものなら印を添える（楽観的ロック）。force は「このまま保存する」
          ...(editing ? { stamp: form.stamp, force: force || undefined } : {}),
          code: form.code,
          kind: form.kind,
          // 「そのほか」以外では捨てる。種別を変えたときに古い呼び名が残らないように
          kindLabel: form.kind === "OTHER" ? form.kindLabel : null,
          nameJa: form.nameJa,
          nameEn: form.nameEn,
          displayOrder: form.displayOrder,
          activeFlag: form.activeFlag,
          parentId: form.parentId || null,
          // システム設定の一部。システム管理グループの人だけが送る（ほかの人が送っても無視される）
          ...(isAdmin ? { defaultGroupIds: form.defaultGroupIds } : {}),
          // 打ちかけの空行は送らない。項目名が無いものは項目として意味がない
          items: form.items.filter((x) => x.label.trim() !== ""),
        }),
      });
      // ほかの人が先に保存していた。入力はそのまま残し、見てから決めてもらう
      const staleInfo = await readStaleEdit(res);
      if (staleInfo) {
        setStale(staleInfo);
        return;
      }
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      // 新しく作ったものは、返ってきた id を選んだ状態にする
      const savedId = editing
        ? form.id
        : (((await res.json().catch(() => null)) as { id?: string } | null)?.id ?? null);
      await reloadAllOrgs();
      if (savedId) setSelectedId(savedId);
      setMode("view");
    } finally {
      setSaving(false);
    }
  }

  /*
    つかんで動かす（2026-11-13）。置いた先の組織の下へ移す。"" に置くと、いちばん上にする。
    探しているとき・編集中は動かさない（見えている形が組織図そのものでない・書きかけがある）。
    指で触る端末ではつかめないので、編集の「上位組織」の欄も残してある
  */
  const canDrag = editable && mode === "view" && search.trim() === "";

  /** その組織を置けない先（自分・自分の下・いまの上の組織）。上下が輪にならないように */
  const blocked = useMemo(() => {
    const out = new Set<string>();
    const dragged = orgs.find((o) => o.id === dragId);
    if (!dragged) return out;
    out.add(dragged.id);
    for (const id of descendantIds(orgs, dragged.id)) out.add(id);
    // いまの上の組織に置いても何も変わらない
    out.add(dragged.parentId ?? "");
    return out;
  }, [orgs, dragId]);

  async function moveTo(o: OrganisationDto, parentId: string) {
    const parent = orgs.find((x) => x.id === parentId);
    const message = parent
      ? m.organisations.moveConfirm(name(o), name(parent))
      : m.organisations.moveToTopConfirm(name(o));
    if (!(await ask({ message, confirmLabel: m.organisations.moveLabel }))) return;
    setError(null);
    // 上の組織だけを変えて、ほかは読み込んだときのまま送る（印も添える。楽観的ロック）
    const res = await fetch(`/api/organisations/${o.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stamp: o.stamp,
        code: o.code,
        kind: o.kind,
        kindLabel: o.kind === "OTHER" ? o.kindLabel : null,
        nameJa: o.nameJa,
        nameEn: o.nameEn ?? "",
        displayOrder: o.displayOrder,
        activeFlag: o.activeFlag,
        parentId: parentId || null,
        ...(isAdmin ? { defaultGroupIds: o.defaultGroupIds ?? [] } : {}),
        items: o.items,
      }),
    });
    // ほかの人が先に直していたら、動かさずに読み直して知らせる
    if (await readStaleEdit(res)) {
      setError(m.errors.staleEdit);
      await reloadAllOrgs();
      return;
    }
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    // 移した先が閉じていたら開く（移したものが見えなくならないように）
    if (parentId) {
      setClosed((prev) => {
        if (!prev.has(parentId)) return prev;
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
    await reloadAllOrgs();
    setSelectedId(o.id);
  }

  /** 置いたとき。置けない先なら何もしない */
  function onDropAt(targetId: string) {
    const dragged = orgs.find((o) => o.id === dragId);
    setDragId(null);
    setDropId(null);
    if (!dragged || blocked.has(targetId)) return;
    void moveTo(dragged, targetId);
  }

  /** 選んだ組織を消す。人が所属している・下に組織がある、は API が断る */
  async function remove(o: OrganisationDto) {
    if (!(await ask({ message: m.organisations.deleteConfirm(name(o)), destructive: true }))) {
      return;
    }
    setError(null);
    const res = await fetch(`/api/organisations/${o.id}`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    setSelectedId(null);
    await reloadAllOrgs();
  }

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setForm((f) => ({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  /*
    項目の並べ替え。**紙面に出る順がこの順になる。**
    つまみで引く形にはしない。数が少なく、1つずつ動かすほうが狙った位置に置きやすい
  */
  const moveItem = (i: number, to: number) =>
    setForm((f) => {
      if (to < 0 || to >= f.items.length) return f;
      const items = [...f.items];
      const [moved] = items.splice(i, 1);
      if (moved) items.splice(to, 0, moved);
      return { ...f, items };
    });

  const kindOf = (o: OrganisationDto) => kindLabelOf(o.kind, o.kindLabel, kindNames);
  const groupNames = (ids: string[] | undefined) =>
    (ids ?? [])
      .map((id) => adminGroups.find((g) => g.id === id))
      .filter((g) => g !== undefined)
      .map((g) => pickName(locale, g.nameJa, g.nameEn))
      .join(locale === "ja" ? "・" : ", ");

  return (
    <section className="space-y-3">
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

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        {/* 左: 組織図。押すと右に中身が出る */}
        <div className="bg-background space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={TABLE_TITLE}>{m.organisations.title}</h2>
            {editable && (
              <Button
                variant="outline"
                size="icon"
                className="text-primary border-primary/40 hover:bg-primary/10 hover:text-primary size-8"
                title={m.table.create}
                aria-label={m.table.create}
                onClick={() => void startNew()}
              >
                <Plus className="size-4" />
              </Button>
            )}
            {/* 枝があるときだけ。開閉できるものを足したら、まとめて開け閉めできるようにする決まり */}
            {parents.size > 0 && (
              <span className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={closed.size === 0}
                  onClick={() => setClosed(new Set())}
                >
                  {m.organisations.expandAll}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={[...parents].every((id) => closed.has(id))}
                  onClick={() => setClosed(new Set(parents))}
                >
                  {m.organisations.collapseAll}
                </Button>
              </span>
            )}
          </div>
          <Input
            type="search"
            value={search}
            placeholder={m.organisations.searchPlaceholder}
            aria-label={m.organisations.searchPlaceholder}
            onChange={(e) => setSearch(e.target.value)}
          />
          {canDrag && orgs.length > 1 && (
            <p className="text-muted-foreground px-1 text-xs">{m.organisations.dragHint}</p>
          )}
          {/* つかんでいる間だけ出す置き場。置くと、いちばん上の組織になる */}
          {dragId !== null && !blocked.has("") && (
            <div
              data-drop-top
              className={`rounded-sm border border-dashed px-2 py-2 text-xs ${
                dropId === "" ? "border-primary bg-primary/10" : "text-muted-foreground"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropId("");
              }}
              onDragLeave={() => setDropId((v) => (v === "" ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                onDropAt("");
              }}
            >
              {m.organisations.dropTop}
            </div>
          )}
          {allOrgs === null ? (
            <p className="text-muted-foreground p-2 text-sm">{m.common.loading}</p>
          ) : orgs.length === 0 ? (
            <p className="text-muted-foreground p-2 text-sm">{m.organisations.empty}</p>
          ) : visible.length === 0 ? (
            <p className="text-muted-foreground p-2 text-sm">{m.organisations.noMatch}</p>
          ) : (
            <ul aria-label={m.organisations.tree} className="space-y-0.5">
              {visible.map(({ org, depth }) => {
                const Icon = KIND_ICON[org.kind];
                const isOpen = !closed.has(org.id);
                const isSelected = org.id === selectedId;
                return (
                  <li
                    key={org.id}
                    data-org-code={org.code}
                    className={`flex items-center gap-1 rounded-sm ${
                      isSelected ? "bg-primary/10" : "hover:bg-muted/60"
                    } ${dropId === org.id ? "ring-primary ring-2" : ""} ${
                      dragId === org.id ? "opacity-50" : ""
                    } ${canDrag ? "cursor-grab" : ""}`}
                    style={{ paddingLeft: `${depth * 1.25}rem` }}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", org.code);
                      setDragId(org.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropId(null);
                    }}
                    onDragOver={(e) => {
                      // 置ける先だけ受ける（受けないと、置けない印のまま）
                      if (dragId === null || blocked.has(org.id)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropId(org.id);
                    }}
                    onDragLeave={() => setDropId((v) => (v === org.id ? null : v))}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDropAt(org.id);
                    }}
                  >
                    {/* 探しているときは、当たったものとその上を全部出すので、開閉は置かない */}
                    {parents.has(org.id) && search.trim() === "" ? (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground flex size-7 shrink-0 items-center justify-center"
                        aria-expanded={isOpen}
                        aria-label={
                          isOpen ? m.organisations.closeBranch : m.organisations.openBranch
                        }
                        title={isOpen ? m.organisations.closeBranch : m.organisations.openBranch}
                        onClick={() => toggleBranch(org.id)}
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                    ) : (
                      <span className="size-7 shrink-0" aria-hidden />
                    )}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm"
                      aria-current={isSelected ? "true" : undefined}
                      title={`${kindOf(org)} ${org.code}`}
                      onClick={() => void select(org.id)}
                    >
                      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                      <span
                        className={`truncate ${isSelected ? "font-semibold" : ""} ${
                          org.activeFlag ? "" : "text-muted-foreground line-through"
                        }`}
                      >
                        {name(org)}
                      </span>
                      {!org.activeFlag && (
                        <Badge variant="outline" className="shrink-0 px-1 text-[10px]">
                          {m.users.inactive}
                        </Badge>
                      )}
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                        {m.organisations.people(org.memberCount)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 右: 選んだ組織。まず表示のみ、「編集」で書き換える */}
        {mode !== "view" ? (
          <Card collapsible={false}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base">
                {mode === "edit" ? m.organisations.editTitle : m.organisations.newTitle}
                <EditingBadge />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
                className="space-y-4"
              >
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="org-code">{m.organisations.code}</Label>
                    <Input
                      id="org-code"
                      value={form.code}
                      maxLength={20}
                      required
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      className="w-32 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-kind">{m.organisations.kind}</Label>
                    <select
                      id="org-kind"
                      value={form.kind}
                      onChange={(e) =>
                        setForm({ ...form, kind: e.target.value as OrganisationKind })
                      }
                      className="border-input bg-background h-9 w-32 rounded-none border px-2 text-sm"
                    >
                      {ORGANISATION_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {kindNames[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* 呼び名は「そのほか」のときだけ。ほかの種別では置き場所も取らない */}
                  {form.kind === "OTHER" && (
                    <div className="space-y-2">
                      <Label htmlFor="org-kind-label">{m.organisations.kindLabel}</Label>
                      <Input
                        id="org-kind-label"
                        value={form.kindLabel}
                        maxLength={30}
                        onChange={(e) => setForm({ ...form, kindLabel: e.target.value })}
                        className="w-40"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="org-name-ja">{m.organisations.nameJa}</Label>
                    <Input
                      id="org-name-ja"
                      value={form.nameJa}
                      maxLength={100}
                      required
                      onChange={(e) => setForm({ ...form, nameJa: e.target.value })}
                      className="w-64"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-name-en">
                      {m.organisations.nameEn}
                      <span className="text-muted-foreground">{m.common.optional}</span>
                    </Label>
                    <Input
                      id="org-name-en"
                      value={form.nameEn}
                      maxLength={100}
                      onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                      className="w-64"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-order">{m.organisations.displayOrder}</Label>
                    <Input
                      id="org-order"
                      type="number"
                      min={0}
                      max={9999}
                      value={form.displayOrder}
                      onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })}
                      className="w-24"
                    />
                  </div>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.activeFlag}
                      onChange={(e) => setForm({ ...form, activeFlag: e.target.checked })}
                    />
                    {m.organisations.activeFlag}
                  </label>
                </div>
                {/* 上の組織（S31）。自分と自分の下は選べない */}
                <div className="space-y-2">
                  <Label htmlFor="org-parent">{m.organisations.parent}</Label>
                  <OrganisationSelect
                    id="org-parent"
                    organisations={allOrgs}
                    value={form.parentId}
                    exclude={
                      form.id
                        ? new Set([form.id, ...descendantIds(allOrgs ?? [], form.id)])
                        : undefined
                    }
                    noneLabel={m.organisations.parentNone}
                    onChange={(v) => setForm({ ...form, parentId: v })}
                  />
                  <p className="text-muted-foreground text-xs">{m.organisations.parentHint}</p>
                </div>
                {isAdmin && (
                  <div className="space-y-2">
                    <Label>{m.organisations.defaultGroups}</Label>
                    <PermissionGroupChips
                      options={adminGroups}
                      value={form.defaultGroupIds}
                      onChange={(v) => setForm({ ...form, defaultGroupIds: v })}
                      emptyLabel={m.users.permissionGroupsNone}
                    />
                    <p className="text-muted-foreground text-xs">
                      {m.organisations.defaultGroupsHint}
                    </p>
                  </div>
                )}

                {/* 項目。名前も値も打ってもらう */}
                <div className="space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">{m.organisations.items}</p>
                  <p className="text-muted-foreground text-xs">{m.organisations.itemsHint}</p>
                  {form.items.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{m.organisations.noItems}</p>
                  ) : (
                    <div className="space-y-2">
                      {form.items.map((it, i) => (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label htmlFor={`org-label-${i}`} className="text-xs">
                              {m.organisations.label}
                            </Label>
                            <Input
                              id={`org-label-${i}`}
                              value={it.label}
                              maxLength={60}
                              placeholder={m.organisations.labelPlaceholder}
                              onChange={(e) => setItem(i, { label: e.target.value })}
                              className="w-48"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`org-value-${i}`} className="text-xs">
                              {m.organisations.value}
                            </Label>
                            <Input
                              id={`org-value-${i}`}
                              value={it.value}
                              maxLength={500}
                              placeholder={m.organisations.valuePlaceholder}
                              onChange={(e) => setItem(i, { value: e.target.value })}
                              className="w-96 max-w-full"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title={m.organisations.moveUp}
                            aria-label={m.organisations.moveUp}
                            disabled={i === 0}
                            onClick={() => moveItem(i, i - 1)}
                          >
                            <ChevronUp className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title={m.organisations.moveDown}
                            aria-label={m.organisations.moveDown}
                            disabled={i === form.items.length - 1}
                            onClick={() => moveItem(i, i + 1)}
                          >
                            <ChevronDown className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title={m.common.delete}
                            aria-label={m.common.delete}
                            onClick={() =>
                              setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }))
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={form.items.length >= 50}
                    onClick={() =>
                      setForm((f) => ({ ...f, items: [...f.items, { label: "", value: "" }] }))
                    }
                  >
                    {m.organisations.addItem}
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? m.common.saving : m.common.save}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      // 書きかけを捨てて、表示に戻す
                      setStale(null);
                      setError(null);
                      setMode("view");
                    }}
                  >
                    {m.common.discard}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : selected ? (
          <Card collapsible={false}>
            <CardHeader>
              {selected.parentId && (
                <p className="text-muted-foreground text-xs">
                  {orgPathLabel(orgs, selected.parentId, name)}
                </p>
              )}
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {name(selected)}
                <Badge variant="secondary" className="px-1.5">
                  {kindOf(selected)}
                </Badge>
                {editable && (
                  <span className="ml-auto flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void startNew(selected)}
                    >
                      <Plus className="mr-1 size-3.5" />
                      {m.organisations.addChild}
                    </Button>
                    <EditButton onClick={() => startEdit(selected)} />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title={m.common.delete}
                      aria-label={m.common.delete}
                      onClick={() => void remove(selected)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{m.organisations.code}</dt>
                <dd className="font-mono text-xs leading-5">{selected.code}</dd>
                {selected.nameEn && (
                  <>
                    <dt className="text-muted-foreground">{m.organisations.nameEn}</dt>
                    <dd>{selected.nameEn}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">{m.organisations.parent}</dt>
                <dd>
                  {selected.parentId
                    ? orgPathLabel(orgs, selected.parentId, name)
                    : m.organisations.parentNone}
                </dd>
                <dt className="text-muted-foreground">{m.organisations.memberCount}</dt>
                <dd>{m.organisations.people(selected.memberCount)}</dd>
                <dt className="text-muted-foreground">{m.organisations.displayOrder}</dt>
                <dd>{selected.displayOrder}</dd>
                <dt className="text-muted-foreground">{m.common.activeHeader}</dt>
                <dd className="flex items-center gap-1">
                  <StatusIcon
                    active={selected.activeFlag}
                    activeLabel={m.users.active}
                    inactiveLabel={m.users.inactive}
                  />
                  {selected.activeFlag ? m.users.active : m.users.inactive}
                </dd>
                {isAdmin && (
                  <>
                    <dt className="text-muted-foreground">{m.organisations.defaultGroups}</dt>
                    <dd>{groupNames(selected.defaultGroupIds) || m.users.permissionGroupsNone}</dd>
                  </>
                )}
              </dl>
              {/* 項目。帳票の差込項目になるもの */}
              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">{m.organisations.items}</p>
                {selected.items.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{m.organisations.noItems}</p>
                ) : (
                  <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
                    {selected.items.map((it, i) => (
                      <div key={i} className="contents">
                        <dt className="text-muted-foreground">{it.label}</dt>
                        <dd className="break-words whitespace-pre-wrap">{it.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="text-muted-foreground rounded-md border border-dashed p-6 text-sm">
            {orgs.length === 0 ? m.organisations.empty : m.organisations.selectHint}
          </div>
        )}
      </div>
    </section>
  );
}
