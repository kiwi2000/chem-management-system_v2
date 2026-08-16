"use client";

import { pickName } from "@chem/shared";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ProductDetailDto, PropertyDefDto } from "@/lib/types";

interface Props {
  /** 未指定なら新規登録 */
  initial?: ProductDetailDto;
  defs: PropertyDefDto[];
  /**
   * 編集できるか。既存データを開いたときは、まず読み取り専用で見せて
   * 「編集」ボタンを押してから書き換えられるようにする（誤操作を防ぐため）。
   */
  canEdit: boolean;
  /** 非公開フラグを触れるか（PRODUCT_VIEW_PRIVATE）。サーバー側でも必ず確認する */
  canSetPrivate: boolean;
  /** 組成公開フラグを触れるか（COMPOSITION_VIEW_PRIVATE）。同上 */
  canSetCompositionPublic: boolean;
}

interface AliasRow {
  nameJa: string;
  nameEn: string;
}

const selectClass = "border-input bg-background h-9 rounded-md border px-2 text-sm";

export function ProductForm({
  initial,
  defs,
  canEdit,
  canSetPrivate,
  canSetCompositionPublic,
}: Props) {
  const router = useRouter();
  const { m, locale } = useI18n();
  // 新規登録は最初から入力できる。既存データは「編集」を押すまで読み取り専用
  const [editing, setEditing] = useState(!initial);
  const readOnly = !canEdit || !editing;

  const [code, setCode] = useState(initial?.code ?? "");
  const [nameJa, setNameJa] = useState(initial?.nameJa ?? "");
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? "");
  const [status, setStatus] = useState(initial?.status ?? "ACTIVE");
  const [note, setNote] = useState(initial?.note ?? "");
  const [usableAsMaterial, setUsableAsMaterial] = useState(initial?.usableAsMaterial ?? false);
  // 既定は「非公開でない・組成は公開」。サーバー側の既定値と揃えること
  const [privateFlag, setPrivateFlag] = useState(initial?.privateFlag ?? false);
  const [compositionPublicFlag, setCompositionPublicFlag] = useState(
    initial?.compositionPublicFlag ?? true,
  );
  const [aliases, setAliases] = useState<AliasRow[]>(
    initial?.aliases.map((a) => ({ nameJa: a.nameJa, nameEn: a.nameEn ?? "" })) ?? [],
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
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function buildBody() {
    return {
      code,
      nameJa,
      nameEn: nameEn || null,
      status,
      note: note || null,
      usableAsMaterial,
      privateFlag,
      compositionPublicFlag,
      aliases: aliases
        .filter((a) => a.nameJa.trim() !== "")
        .map((a) => ({ nameJa: a.nameJa, nameEn: a.nameEn || null })),
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
    setWarnings([]);
    setSaving(true);
    try {
      const res = await fetch(initial ? `/api/products/${initial.id}` : "/api/products", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json()) as { warnings?: string[] };
      // 警告があるときは一覧に戻らず、その場で確認してもらう（S5と同じ作法）
      if (body.warnings && body.warnings.length > 0) {
        setWarnings(body.warnings);
        if (initial) setEditing(false);
        router.refresh();
        return;
      }
      router.push("/products");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  /** 権限が無い機密フラグは、触れないことが分かるように理由も添える */
  function flagRow(
    id: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    hint: string,
    allowed: boolean,
  ) {
    return (
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={!allowed}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
        <p className="text-muted-foreground pl-6 text-xs">
          {allowed ? hint : m.products.flagLocked}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 既存データは画面が長いので、状態と編集ボタンを上にも出す（form の外に置く） */}
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
              <CardTitle className="text-base">{m.products.basic}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">{m.products.code}</Label>
                  <Input
                    id="code"
                    required
                    maxLength={20}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-56 font-mono"
                  />
                  <p className="text-muted-foreground text-xs">{m.products.codeHint}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">{m.products.status}</Label>
                  <select
                    id="status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as typeof status)}
                    className={selectClass}
                  >
                    <option value="ACTIVE">{m.products.statusActive}</option>
                    <option value="DISCONTINUED">{m.products.statusDiscontinued}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="note">
                  {m.products.note}
                  {m.common.optional}
                </Label>
                <textarea
                  id="note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.products.names}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label htmlFor="nameJa">{m.products.nameJa}</Label>
                  <Input
                    id="nameJa"
                    required
                    value={nameJa}
                    onChange={(e) => setNameJa(e.target.value)}
                    className="w-80"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nameEn">
                    {m.products.nameEn}
                    {m.common.optional}
                  </Label>
                  <Input
                    id="nameEn"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    className="w-80"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>{m.products.aliases}</Label>
                <p className="text-muted-foreground text-xs">{m.products.aliasHint}</p>
                {aliases.map((a, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={`${m.products.aliases} ${i + 1} ${m.products.nameJa}`}
                      value={a.nameJa}
                      onChange={(e) =>
                        setAliases(
                          aliases.map((x, j) => (j === i ? { ...x, nameJa: e.target.value } : x)),
                        )
                      }
                      className="w-80"
                    />
                    <Input
                      aria-label={`${m.products.aliases} ${i + 1} ${m.products.nameEn}`}
                      value={a.nameEn}
                      onChange={(e) =>
                        setAliases(
                          aliases.map((x, j) => (j === i ? { ...x, nameEn: e.target.value } : x)),
                        )
                      }
                      className="w-80"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setAliases(aliases.filter((_, j) => j !== i))}
                    >
                      {m.common.remove}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAliases([...aliases, { nameJa: "", nameEn: "" }])}
                >
                  {m.products.addAlias}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.products.flags}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {flagRow(
                "usableAsMaterial",
                usableAsMaterial,
                setUsableAsMaterial,
                m.products.usableAsMaterial,
                m.products.usableAsMaterialHint,
                true,
              )}
              {flagRow(
                "privateFlag",
                privateFlag,
                setPrivateFlag,
                m.products.privateFlag,
                m.products.privateFlagHint,
                canSetPrivate,
              )}
              {flagRow(
                "compositionPublicFlag",
                compositionPublicFlag,
                setCompositionPublicFlag,
                m.products.compositionPublicFlag,
                m.products.compositionPublicFlagHint,
                canSetCompositionPublic,
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{m.products.properties}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {defs.length === 0 && (
                <p className="text-muted-foreground text-sm">{m.products.propertiesEmpty}</p>
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
              <p className="font-medium">{m.products.savedWithWarnings}</p>
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
                else router.push("/products");
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
          <Button type="button" variant="outline" onClick={() => router.push("/products")}>
            {m.common.back}
          </Button>
        </div>
      )}
    </div>
  );
}
