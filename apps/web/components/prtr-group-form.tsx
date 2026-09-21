"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldError } from "@/components/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, PrtrGroupDto } from "@/lib/types";

/** 画面で持つ値。数は文字列で持ち、送るときに直す */
interface Draft {
  code: string;
  nameJa: string;
  nameKana: string;
  nameEn: string;
  zip: string;
  prefecture: string;
  city: string;
  town: string;
  prefectureKana: string;
  cityKana: string;
  townKana: string;
  employeeNum: string;
  displayOrder: string;
  note: string;
}

const EMPTY: Draft = {
  code: "",
  nameJa: "",
  nameKana: "",
  nameEn: "",
  zip: "",
  prefecture: "",
  city: "",
  town: "",
  prefectureKana: "",
  cityKana: "",
  townKana: "",
  employeeNum: "",
  displayOrder: "",
  note: "",
};

function draftOf(g: PrtrGroupDto): Draft {
  return {
    code: g.code,
    nameJa: g.nameJa,
    nameKana: g.nameKana ?? "",
    nameEn: g.nameEn ?? "",
    zip: g.zip ?? "",
    prefecture: g.prefecture ?? "",
    city: g.city ?? "",
    town: g.town ?? "",
    prefectureKana: g.prefectureKana ?? "",
    cityKana: g.cityKana ?? "",
    townKana: g.townKana ?? "",
    employeeNum: g.employeeNum === null ? "" : String(g.employeeNum),
    displayOrder: String(g.displayOrder),
    note: g.note ?? "",
  };
}

/**
 * グループ（届出上の事業所）の登録・詳細（S22-1）。
 *
 * 既存のものは**まず読み取り専用で見せ、「編集」で書き換え可**にする（製品・物質と同じ型）。
 * 項目が多いので一覧の上のフォームではなく、この別画面に置く
 */
export function PrtrGroupForm({ initial }: { initial: PrtrGroupDto | null }) {
  const { m } = useI18n();
  const router = useRouter();
  const t = m.prtr.groups;
  const [draft, setDraft] = useState<Draft>(initial ? draftOf(initial) : EMPTY);
  const [editing, setEditing] = useState(!initial);
  const readOnly = !editing;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [key]: e.target.value });

  async function save() {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const body = {
        code: draft.code,
        nameJa: draft.nameJa,
        nameKana: draft.nameKana || null,
        nameEn: draft.nameEn || null,
        zip: draft.zip || null,
        prefecture: draft.prefecture || null,
        city: draft.city || null,
        town: draft.town || null,
        prefectureKana: draft.prefectureKana || null,
        cityKana: draft.cityKana || null,
        townKana: draft.townKana || null,
        employeeNum: draft.employeeNum.trim() === "" ? null : Number(draft.employeeNum),
        displayOrder: draft.displayOrder.trim() === "" ? undefined : Number(draft.displayOrder),
        note: draft.note || null,
      };
      const res = await fetch(initial ? `/api/prtr/groups/${initial.id}` : "/api/prtr/groups", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const b = (await res.json().catch(() => null)) as ApiError | null;
        setError(b?.error.message ?? m.errors.saveFailed(res.status));
        setFieldErrors(toFieldErrors(b?.error.details));
        return;
      }
      if (!initial) {
        const { id } = (await res.json()) as { id: string };
        router.push(`/prtr/groups/${id}`);
        router.refresh();
        return;
      }
      setNotice(t.saved);
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const field = (
    key: keyof Draft,
    label: string,
    opts?: { width?: string; hint?: string; type?: string; mono?: boolean },
  ) => (
    <div className={`space-y-1 ${opts?.width ?? "w-64"}`}>
      <Label htmlFor={`g-${key}`}>{label}</Label>
      <Input
        id={`g-${key}`}
        type={opts?.type ?? "text"}
        value={draft[key]}
        onChange={set(key)}
        aria-invalid={Boolean(fieldError(key))}
        className={`h-8 ${opts?.mono ? "font-mono" : ""}`}
      />
      {opts?.hint && <p className="text-muted-foreground text-xs">{opts.hint}</p>}
      <FieldError message={fieldError(key)} />
    </div>
  );

  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      {readOnly ? (
        <>
          <Button key="edit" type="button" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 size-3.5" />
            {m.common.edit}
          </Button>
          <Button
            key="back"
            type="button"
            size="sm"
            variant="outline"
            onClick={() => router.push("/prtr/groups")}
          >
            {t.backToList}
          </Button>
        </>
      ) : (
        <>
          {initial && <Badge variant="secondary">{m.common.editMode}</Badge>}
          <Button key="save" type="button" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? m.common.saving : m.common.save}
          </Button>
          <Button
            key="cancel"
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (initial) {
                setDraft(draftOf(initial));
                setEditing(false);
              } else {
                router.push("/prtr/groups");
              }
            }}
          >
            {initial ? m.common.discard : m.common.cancel}
          </Button>
        </>
      )}
      {readOnly && <Badge variant="outline">{m.prtr.viewOnly}</Badge>}
    </div>
  );

  return (
    <div className="space-y-4">
      {bar}
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
      <fieldset disabled={readOnly} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            {field("code", t.code, { width: "w-40", mono: true })}
            {field("nameJa", t.name, { width: "w-80" })}
            {field("nameKana", t.nameKana, { width: "w-80" })}
            {field("nameEn", t.nameEn, { width: "w-80" })}
            {field("employeeNum", t.employeeNum, {
              width: "w-48",
              type: "number",
              hint: t.employeeNumHint,
            })}
            {field("displayOrder", t.displayOrder, { width: "w-32", type: "number" })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.address}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {field("zip", t.zip, { width: "w-40", mono: true })}
              {field("prefecture", t.prefecture, { width: "w-48" })}
              {field("city", t.city, { width: "w-64" })}
              {field("town", t.town, { width: "w-96" })}
            </div>
            <div className="flex flex-wrap gap-4">
              {field("prefectureKana", t.prefectureKana, { width: "w-48" })}
              {field("cityKana", t.cityKana, { width: "w-64" })}
              {field("townKana", t.townKana, { width: "w-96" })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">{field("note", t.note, { width: "w-full" })}</CardContent>
        </Card>
      </fieldset>
      {initial && bar}
    </div>
  );
}
