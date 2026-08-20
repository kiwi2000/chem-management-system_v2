"use client";

import { GAZETTE_LAW_KINDS, pickName, type AppSettings, type GazetteLawKind } from "@chem/shared";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AliasList } from "@/components/alias-list";
import { FieldError } from "@/components/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, PropertyDefDto, SubstanceDetailDto } from "@/lib/types";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";

interface Props {
  /** 未指定なら新規登録 */
  initial?: SubstanceDetailDto;
  defs: PropertyDefDto[];
  /** CAS欄の厳しさはシステム設定で変わる */
  settings: AppSettings;
  /**
   * 編集できるか。既存データを開いたときは、まず読み取り専用で見せて
   * 「編集」ボタンを押してから書き換えられるようにする（誤操作を防ぐため）。
   */
  canEdit: boolean;
}

interface GazetteRow {
  lawKind: GazetteLawKind;
  number: string;
}

const selectClass = "border-input bg-background h-9 rounded-none border px-2 text-sm";

export function SubstanceForm({ initial, defs, settings, canEdit }: Props) {
  const router = useRouter();
  const { m, locale } = useI18n();
  // 新規登録は最初から入力できる。既存データは「編集」を押すまで読み取り専用
  const [editing, setEditing] = useState(!initial);
  const readOnly = !canEdit || !editing;

  const [code, setCode] = useState(initial?.code ?? "");
  const [casNumber, setCasNumber] = useState(initial?.casNumber ?? "");
  const [status, setStatus] = useState(initial?.status ?? "ACTIVE");
  const [note, setNote] = useState(initial?.note ?? "");
  const [mainNameJa, setMainNameJa] = useState(initial?.mainNameJa ?? "");
  const [mainNameEn, setMainNameEn] = useState(initial?.mainNameEn ?? "");
  // 日本語別名と英語別名は1対1にならないため、別々の一覧として持つ
  const [subNamesJa, setSubNamesJa] = useState<string[]>(
    initial?.subNames.flatMap((n) => (n.nameJa ? [n.nameJa] : [])) ?? [],
  );
  const [subNamesEn, setSubNamesEn] = useState<string[]>(
    initial?.subNames.flatMap((n) => (n.nameEn ? [n.nameEn] : [])) ?? [],
  );
  const [gazette, setGazette] = useState<GazetteRow[]>(
    initial?.gazetteNumbers.map((g) => ({ lawKind: g.lawKind, number: g.number })) ?? [],
  );
  // 拡張属性は「定義ID → 入力値（文字列）」で持つ。数値も文字列のまま送る
  const [propValues, setPropValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of initial?.properties ?? []) {
      init[p.propertyDefId] = p.valueNum ?? p.valueText ?? "";
    }
    return init;
  });
  const [propUnits, setPropUnits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of initial?.properties ?? []) if (p.unit) init[p.propertyDefId] = p.unit;
    return init;
  });

  const [error, setError] = useState<string | null>(null);
  // どの項目が悪いのかを、その欄の下に出す
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function buildBody() {
    return {
      code,
      casNumber: casNumber || null,
      status,
      note: note || null,
      mainNameJa,
      mainNameEn: mainNameEn || null,
      subNames: [
        ...subNamesJa.filter((n) => n.trim() !== "").map((n) => ({ nameJa: n, nameEn: null })),
        ...subNamesEn.filter((n) => n.trim() !== "").map((n) => ({ nameJa: null, nameEn: n })),
      ],
      gazetteNumbers: gazette.filter((g) => g.number.trim() !== ""),
      properties: defs
        .map((d) => {
          const raw = (propValues[d.id] ?? "").trim();
          if (raw === "") return null;
          return {
            propertyDefId: d.id,
            valueText: d.dataType === "TEXT" ? raw : null,
            valueNum: d.dataType === "NUMBER" ? raw : null,
            unit: propUnits[d.id] || d.defaultUnit || null,
          };
        })
        .filter((p) => p !== null),
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setWarnings([]);
    setSaving(true);
    try {
      const res = await fetch(initial ? `/api/substances/${initial.id}` : "/api/substances", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        setFieldErrors(toFieldErrors(body?.error.details));
        return;
      }
      const body = (await res.json()) as { warnings?: string[] };
      // 警告があるときは一覧に戻らず、その場で確認してもらう。
      // 保存は済んでいるので表示に戻す（続けて書き換えるなら「編集」を押し直す）
      if (body.warnings && body.warnings.length > 0) {
        setWarnings(body.warnings);
        if (initial) setEditing(false);
        router.refresh();
        return;
      }
      router.push("/substances");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/*
        既存データは画面が長いので、状態と編集ボタンを上にも出す。
        このバーは form の外に置く。中に置くと、押し方によっては送信（保存）と
        受け取られる余地があるため。
      */}
      {initial && (readOnly ? canEdit : true) && (
        <div className="flex items-center gap-3">
          {readOnly ? (
            <Button type="button" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 size-3.5" />
              {m.common.edit}
            </Button>
          ) : (
            <Badge variant="secondary">{m.common.editMode}</Badge>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset disabled={readOnly} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.substances.basic}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">{m.substances.code}</Label>
                  <Input
                    id="code"
                    required
                    maxLength={20}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    aria-invalid={Boolean(fieldError("code"))}
                    className="w-56 font-mono"
                  />
                  <FieldError message={fieldError("code")} />
                  <p className="text-muted-foreground text-xs">{m.substances.codeHint}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cas">
                    {m.substances.casNumber}
                    {!settings.casRequired && m.common.optional}
                  </Label>
                  <Input
                    id="cas"
                    maxLength={20}
                    required={settings.casRequired}
                    value={casNumber}
                    onChange={(e) => setCasNumber(e.target.value)}
                    aria-invalid={Boolean(fieldError("casNumber"))}
                    className="w-56 font-mono"
                    placeholder="7439-92-1"
                  />
                  <FieldError message={fieldError("casNumber")} />
                  {!settings.casRequired && (
                    <p className="text-muted-foreground text-xs">{m.substances.casHint}</p>
                  )}
                </div>
                {/* 見出しは置かず、チェックの有無をそのまま有効／無効の文言で示す */}
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    id="status"
                    type="checkbox"
                    aria-label={m.substances.status}
                    checked={status === "ACTIVE"}
                    onChange={(e) => setStatus(e.target.checked ? "ACTIVE" : "DISCONTINUED")}
                  />
                  {status === "ACTIVE"
                    ? m.substances.statusActive
                    : m.substances.statusDiscontinued}
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="note">
                  {m.substances.note}
                  {m.common.optional}
                </Label>
                <textarea
                  id="note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-invalid={Boolean(fieldError("note"))}
                  className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.substances.names}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mainJa">
                  {m.substances.mainName} / {m.substances.nameJa}
                </Label>
                <Input
                  id="mainJa"
                  required
                  value={mainNameJa}
                  onChange={(e) => setMainNameJa(e.target.value)}
                  aria-invalid={Boolean(fieldError("mainNameJa"))}
                  className="w-full"
                />
                <FieldError message={fieldError("mainNameJa")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mainEn">
                  {m.substances.mainName} / {m.substances.nameEn}
                  {m.common.optional}
                </Label>
                <Input
                  id="mainEn"
                  value={mainNameEn}
                  onChange={(e) => setMainNameEn(e.target.value)}
                  aria-invalid={Boolean(fieldError("mainNameEn"))}
                  className="w-full"
                />
                <FieldError message={fieldError("mainNameEn")} />
              </div>

              <FieldError message={fieldError("subNames")} />
              <AliasList
                label={m.substances.subNamesJa}
                addLabel={m.substances.addSubNameJa}
                idPrefix="subNameJa"
                values={subNamesJa}
                onChange={setSubNamesJa}
              />
              <AliasList
                label={m.substances.subNamesEn}
                addLabel={m.substances.addSubNameEn}
                idPrefix="subNameEn"
                values={subNamesEn}
                onChange={setSubNamesEn}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.substances.gazette}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground text-xs">{m.substances.gazetteHint}</p>
              {gazette.map((g, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`${m.substances.gazetteLawKind} ${i + 1}`}
                    value={g.lawKind}
                    onChange={(e) =>
                      setGazette(
                        gazette.map((x, j) =>
                          j === i ? { ...x, lawKind: e.target.value as GazetteLawKind } : x,
                        ),
                      )
                    }
                    className={selectClass}
                  >
                    {GAZETTE_LAW_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {m.substances.lawKinds[k]}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label={`${m.substances.gazetteNumber} ${i + 1}`}
                    value={g.number}
                    maxLength={50}
                    onChange={(e) =>
                      setGazette(
                        gazette.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)),
                      )
                    }
                    className="w-56 font-mono"
                    placeholder="1-234"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setGazette(gazette.filter((_, j) => j !== i))}
                  >
                    {m.common.remove}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setGazette([...gazette, { lawKind: "CSCL", number: "" }])}
              >
                {m.substances.addGazette}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.substances.properties}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {defs.length === 0 && (
                <p className="text-muted-foreground text-sm">{m.substances.propertiesEmpty}</p>
              )}
              {defs.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={`prop-${d.id}`} className="w-48">
                    {pickName(locale, d.labelJa, d.labelEn)}
                  </Label>
                  <Input
                    id={`prop-${d.id}`}
                    inputMode={d.dataType === "NUMBER" ? "decimal" : "text"}
                    value={propValues[d.id] ?? ""}
                    onChange={(e) => setPropValues({ ...propValues, [d.id]: e.target.value })}
                    className="w-64"
                  />
                  {d.dataType === "NUMBER" && (
                    <Input
                      aria-label={`${pickName(locale, d.labelJa, d.labelEn)} ${m.common.unit}`}
                      value={propUnits[d.id] ?? d.defaultUnit ?? ""}
                      onChange={(e) => setPropUnits({ ...propUnits, [d.id]: e.target.value })}
                      className="w-28"
                      placeholder={m.common.unit}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </fieldset>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert>
            <AlertDescription>
              <p className="font-medium">{m.substances.savedWithWarnings}</p>
              <ul className="mt-1 list-disc pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* 保存ボタンは編集中だけ。表示のみのときは form の中に送信ボタンを置かない */}
        {!readOnly && (
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // 既存データの編集をやめるときは、書きかけを捨てて表示に戻す
                if (initial) router.refresh();
                else router.push("/substances");
                setEditing(!initial);
              }}
            >
              {m.common.cancel}
            </Button>
          </div>
        )}
      </form>

      {readOnly && (
        <div className="flex gap-2">
          {canEdit && (
            <Button type="button" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 size-4" />
              {m.common.edit}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => router.push("/substances")}>
            {m.common.back}
          </Button>
        </div>
      )}
    </div>
  );
}
