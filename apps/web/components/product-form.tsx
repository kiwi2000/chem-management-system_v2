"use client";

import { pickName } from "@chem/shared";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { AliasList } from "@/components/alias-list";
import { MultiSelect } from "@/components/multi-select";
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
  /** 型式で選べる値（システム設定）。並び順がそのまま表示順 */
  modelOptions: string[];
  /** 用途で選べる値（システム設定）。同上 */
  useOptions: string[];
  /** 組成の節。基本情報と備考の間に置きたいので、呼び出し側から受け取る（新規登録では無い） */
  composition?: React.ReactNode;
}

export function ProductForm({
  initial,
  defs,
  canEdit,
  modelOptions,
  useOptions,
  composition,
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
  const [modelValue, setModelValue] = useState(initial?.modelValue ?? "");
  const [uses, setUses] = useState<string[]>(initial?.uses ?? []);
  // 日本語別名と英語別名は1対1にならないため、別々の一覧として持つ
  const [aliasesJa, setAliasesJa] = useState<string[]>(
    initial?.aliases.flatMap((a) => (a.nameJa ? [a.nameJa] : [])) ?? [],
  );
  const [aliasesEn, setAliasesEn] = useState<string[]>(
    initial?.aliases.flatMap((a) => (a.nameEn ? [a.nameEn] : [])) ?? [],
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
      modelValue: modelValue || null,
      uses,
      aliases: [
        ...aliasesJa.filter((n) => n.trim() !== "").map((n) => ({ nameJa: n, nameEn: null })),
        ...aliasesEn.filter((n) => n.trim() !== "").map((n) => ({ nameJa: null, nameEn: n })),
      ],
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

  /**
   * チェックボックスの1項目。他の入力欄と同じく見出しを上に置き、
   * 説明は場所を取るのでホバー（とスクリーンリーダー）で読める形にとどめる。
   */
  function flagRow(
    id: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    hint: string,
  ) {
    return (
      <div className="space-y-2" title={hint}>
        {/* 見出しとチェックボックスは、横位置を互いの中央で揃える */}
        <Label htmlFor={id} className="block text-center">
          {label}
        </Label>
        <div className="flex h-9 items-center justify-center">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            aria-describedby={`${id}-help`}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span id={`${id}-help`} className="sr-only">
            {hint}
          </span>
        </div>
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
                </div>
                {/* 見出しはチェックの状態そのもの（有効／無効）を出す */}
                <div className="space-y-2">
                  <Label htmlFor="status" className="block text-center">
                    {status === "ACTIVE" ? m.products.statusActive : m.products.statusDiscontinued}
                  </Label>
                  <div className="flex h-9 items-center justify-center">
                    <input
                      id="status"
                      type="checkbox"
                      aria-label={m.products.status}
                      checked={status === "ACTIVE"}
                      onChange={(e) => setStatus(e.target.checked ? "ACTIVE" : "DISCONTINUED")}
                    />
                  </div>
                </div>
                {flagRow(
                  "usableAsMaterial",
                  usableAsMaterial,
                  setUsableAsMaterial,
                  m.products.usableAsMaterial,
                  m.products.usableAsMaterialHint,
                )}
                <div className="space-y-2">
                  <Label htmlFor="modelValue">{m.products.modelValue}</Label>
                  <select
                    id="modelValue"
                    value={modelValue}
                    onChange={(e) => setModelValue(e.target.value)}
                    className="border-input bg-background h-9 w-48 rounded-none border px-2 text-sm"
                  >
                    <option value="">{m.products.unselected}</option>
                    {/* 設定から消された値でも、選ばれていれば選択肢に残す（記録を勝手に変えない） */}
                    {(modelValue && !modelOptions.includes(modelValue)
                      ? [modelValue, ...modelOptions]
                      : modelOptions
                    ).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uses">{m.products.uses}</Label>
                  <MultiSelect
                    id="uses"
                    ariaLabel={m.products.uses}
                    placeholder={m.products.unselected}
                    options={useOptions}
                    values={uses}
                    onChange={setUses}
                    disabled={readOnly}
                  />
                </div>
                {defs.map((d) => (
                  <div key={d.id} className="space-y-2">
                    <Label htmlFor={`prop-${d.id}`}>{pickName(locale, d.labelJa, d.labelEn)}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`prop-${d.id}`}
                        inputMode={d.dataType === "NUMBER" ? "decimal" : "text"}
                        value={propValues[d.id] ?? ""}
                        onChange={(e) => setPropValues({ ...propValues, [d.id]: e.target.value })}
                        className="w-48"
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
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="nameJa">{m.products.nameJa}</Label>
                <Input
                  id="nameJa"
                  required
                  value={nameJa}
                  onChange={(e) => setNameJa(e.target.value)}
                  className="w-full"
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
                  className="w-full"
                />
              </div>

              <p className="text-muted-foreground text-xs">{m.products.aliasHint}</p>
              <AliasList
                label={m.products.aliasesJa}
                addLabel={m.products.addAliasJa}
                idPrefix="aliasJa"
                values={aliasesJa}
                onChange={setAliasesJa}
              />
              <AliasList
                label={m.products.aliasesEn}
                addLabel={m.products.addAliasEn}
                idPrefix="aliasEn"
                values={aliasesEn}
                onChange={setAliasesEn}
              />
            </CardContent>
          </Card>

          {/* 組成は別部品だが、備考より前に出したいのでフォームの内側に差し込む */}
          {composition}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {m.products.note}
                {m.common.optional}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                id="note"
                rows={3}
                aria-label={m.products.note}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
              />
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
