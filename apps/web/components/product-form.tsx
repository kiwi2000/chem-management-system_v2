"use client";

import { pickName } from "@chem/shared";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { AliasList } from "@/components/alias-list";
import { FieldError } from "@/components/field-error";
import { MultiSelect } from "@/components/multi-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import { CompositionEditor } from "@/components/composition-editor";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@chem/shared";
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
  /**
   * 組成を見せてよいか。見せない相手には、この節ごと出さない。
   * 製品を編集できるなら組成も見られる（権限の含意）ので、新規登録では常に見せる。
   */
  canViewComposition?: boolean;
  /**
   * 組成と備考のあいだに挟むもの（法規制の判定）。
   * 組成を見ながら考えたいので、この順にする
   */
  afterComposition?: ReactNode;
  /** 組成の合計チェックの設定。組成エディタに渡す */
  settings?: AppSettings;
}

/** 直す単位。保存先が分かれているので、節ごとに開け閉めする */
type Section = "basic" | "composition" | "note";

export function ProductForm({
  initial,
  defs,
  canEdit,
  modelOptions,
  useOptions,
  canViewComposition = true,
  afterComposition,
  settings,
}: Props) {
  const router = useRouter();
  const { m, locale } = useI18n();
  /**
   * 新規登録は「基本情報 → 組成 → 備考」の順に進める。
   * 組成の入力には製品のIDが要るので、基本情報の段で先に登録してしまう。
   */
  const wizard = !initial;
  /**
   * どの節を直しているか。既存データは節ごとに「編集」を押して直す。
   * 同時に2か所は直せない。保存先が分かれていて、片方を捨てたときに
   * もう片方まで巻き戻ってしまうのを避けるため。
   */
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  /** 断った理由と、断った相手の節。押した場所の近くに出すために節も持つ */
  const [blocked, setBlocked] = useState<{ section: Section; message: string } | null>(null);
  // 新規登録は段ごとに全部入力できる。既存データは選んだ節だけ
  const isEditing = (sec: Section) => (wizard ? true : canEdit && editingSection === sec);

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

  const [step, setStep] = useState(1);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const targetId = initial?.id ?? createdId;

  const [error, setError] = useState<string | null>(null);
  // どの項目が悪いのかを、その欄の下に出す
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
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

  const sectionLabel: Record<Section, string> = {
    basic: m.products.basic,
    composition: m.composition.title,
    note: m.products.note,
  };

  /** 他の節を直している最中は、そちらを片付けてもらう */
  function tryEdit(sec: Section) {
    if (editingSection !== null && editingSection !== sec) {
      setBlocked({
        section: sec,
        message: m.products.editingElsewhere(sectionLabel[editingSection]),
      });
      return;
    }
    setBlocked(null);
    setError(null);
    setFieldErrors({});
    setEditingSection(sec);
  }

  /** 書きかけを捨てて、読み取りに戻す */
  function discard(sec: Section) {
    if (sec === "basic") {
      setCode(initial?.code ?? "");
      setNameJa(initial?.nameJa ?? "");
      setNameEn(initial?.nameEn ?? "");
      setStatus(initial?.status ?? "ACTIVE");
      setUsableAsMaterial(initial?.usableAsMaterial ?? false);
      setModelValue(initial?.modelValue ?? "");
      setUses(initial?.uses ?? []);
      setAliasesJa(initial?.aliases.flatMap((a) => (a.nameJa ? [a.nameJa] : [])) ?? []);
      setAliasesEn(initial?.aliases.flatMap((a) => (a.nameEn ? [a.nameEn] : [])) ?? []);
      const vals: Record<string, string> = {};
      const units: Record<string, string> = {};
      for (const p of initial?.properties ?? []) {
        vals[p.propertyDefId] = p.valueNum ?? p.valueText ?? "";
        if (p.unit) units[p.propertyDefId] = p.unit;
      }
      setPropValues(vals);
      setPropUnits(units);
    }
    if (sec === "note") setNote(initial?.note ?? "");
    setError(null);
    setFieldErrors({});
    finishEditing();
  }

  /** 編集を終えたときの後始末。断りのメッセージも一緒に片付ける */
  function finishEditing() {
    setEditingSection(null);
    setBlocked(null);
  }

  /**
   * 断ったことを、押したボタンのすぐ上に出す。
   * 画面の一番上に出すと、下の節を触っているときに見えないため。
   */
  function blockedNotice(sec: Section) {
    if (blocked?.section !== sec) return null;
    return (
      <Alert variant="destructive">
        <AlertDescription>{blocked.message}</AlertDescription>
      </Alert>
    );
  }

  /** 節ごとの見出しに出す「編集」ボタン、または編集中の印 */
  function sectionAction(sec: Section) {
    if (wizard || !canEdit) return null;
    return isEditing(sec) ? (
      // 節が長いので、見出しの側でもやめられるようにする（下まで送らずに済む）
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{m.common.editMode}</Badge>
        <Button type="button" size="sm" variant="outline" onClick={() => discard(sec)}>
          {m.common.discard}
        </Button>
      </span>
    ) : (
      // 物質・お知らせ・利用者の「編集」と同じ塗りのボタンにそろえる
      <Button type="button" size="sm" onClick={() => tryEdit(sec)}>
        <Pencil className="mr-1 size-3.5" />
        {m.common.edit}
      </Button>
    );
  }

  /** 節ごとの保存・破棄。組成は自分で持っているのでここには出さない */
  function sectionButtons(sec: Section) {
    if (wizard || !isEditing(sec)) return null;
    return (
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? m.common.saving : m.common.save}
        </Button>
        <Button type="button" variant="outline" onClick={() => discard(sec)}>
          {m.common.discard}
        </Button>
      </div>
    );
  }

  /** 書き込みを1か所にまとめる。段によって作る／直すが変わるだけで、送る中身は同じ */
  async function save(): Promise<{ id: string; warnings: string[] } | null> {
    const res = await fetch(targetId ? `/api/products/${targetId}` : "/api/products", {
      method: targetId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody()),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return null;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      setFieldErrors(toFieldErrors(body?.error.details));
      return null;
    }
    const body = (await res.json()) as { id?: string; warnings?: string[] };
    return { id: body.id ?? targetId ?? "", warnings: body.warnings ?? [] };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setWarnings([]);

    // 組成の段は、エディタ側が自分で保存する。ここでは進むだけ
    if (wizard && step === 2) {
      setStep(3);
      return;
    }

    setSaving(true);
    try {
      const done = await save();
      if (!done) return;

      // 基本情報を登録できたら、そのIDで組成を入力させる
      if (wizard && step === 1) {
        setCreatedId(done.id);
        setStep(2);
        router.refresh();
        return;
      }

      // 警告があるときは一覧に戻らず、その場で確認してもらう（S5と同じ作法）
      if (done.warnings.length > 0) {
        setWarnings(done.warnings);
        finishEditing();
        router.refresh();
        return;
      }
      // 既存データは、続けて別の節を直せるようその場に留まる
      if (!wizard) {
        finishEditing();
        router.refresh();
        return;
      }
      router.push(done.id ? `/products/${done.id}` : "/products");
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
      {wizard && (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {[m.products.basic, m.composition.title, m.products.note].map((label, i) => {
            const n = i + 1;
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border text-xs",
                    n === step && "border-primary bg-primary text-primary-foreground font-medium",
                    n < step && "border-primary text-primary",
                    n > step && "text-muted-foreground",
                  )}
                >
                  {n}
                </span>
                <span className={n === step ? "font-medium" : "text-muted-foreground"}>
                  {label}
                </span>
                {n < 3 && <span className="text-muted-foreground px-1">›</span>}
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-4">
          {blockedNotice("basic")}
          {(!wizard || step === 1) && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">{m.products.basic}</CardTitle>
                {sectionAction("basic")}
              </CardHeader>
              <CardContent className="space-y-4">
                <fieldset disabled={!isEditing("basic")} className="space-y-4">
                  <div className="flex flex-wrap gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="code">{m.products.code}</Label>
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
                    </div>
                    {/* 見出しはチェックの状態そのもの（有効／無効）を出す */}
                    <div className="space-y-2">
                      <Label htmlFor="status" className="block text-center">
                        {status === "ACTIVE"
                          ? m.products.statusActive
                          : m.products.statusDiscontinued}
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
                        disabled={!isEditing("basic")}
                      />
                    </div>
                    {defs.map((d) => (
                      <div key={d.id} className="space-y-2">
                        <Label htmlFor={`prop-${d.id}`}>
                          {pickName(locale, d.labelJa, d.labelEn)}
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={`prop-${d.id}`}
                            inputMode={d.dataType === "NUMBER" ? "decimal" : "text"}
                            value={propValues[d.id] ?? ""}
                            onChange={(e) =>
                              setPropValues({ ...propValues, [d.id]: e.target.value })
                            }
                            className="w-48"
                          />
                          {d.dataType === "NUMBER" && (
                            <Input
                              aria-label={`${pickName(locale, d.labelJa, d.labelEn)} ${m.common.unit}`}
                              value={propUnits[d.id] ?? d.defaultUnit ?? ""}
                              onChange={(e) =>
                                setPropUnits({ ...propUnits, [d.id]: e.target.value })
                              }
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
                      aria-invalid={Boolean(fieldError("nameJa"))}
                      className="w-full"
                    />
                    <FieldError message={fieldError("nameJa")} />
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
                      aria-invalid={Boolean(fieldError("nameEn"))}
                      className="w-full"
                    />
                    <FieldError message={fieldError("nameEn")} />
                  </div>

                  <FieldError message={fieldError("aliases")} />
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
                </fieldset>
                {sectionButtons("basic")}
              </CardContent>
            </Card>
          )}

          {blockedNotice("composition")}
          {/* 組成は備考より前に出す。開け閉めはこの節だけで完結する */}
          {(!wizard || step === 2) && canViewComposition && targetId && settings && (
            <CompositionEditor
              productId={targetId}
              settings={settings}
              editing={isEditing("composition")}
              onRequestEdit={wizard ? undefined : () => tryEdit("composition")}
              onFinishEdit={finishEditing}
            />
          )}

          {/* 判定は組成のすぐ下。組成を見ながら考えるため */}
          {(!wizard || step === 2) && afterComposition}

          {blockedNotice("note")}
          {(!wizard || step === 3) && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">
                  {m.products.note}
                  {m.common.optional}
                </CardTitle>
                {sectionAction("note")}
              </CardHeader>
              <CardContent>
                <fieldset disabled={!isEditing("note")}>
                  <textarea
                    id="note"
                    rows={3}
                    aria-label={m.products.note}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    aria-invalid={Boolean(fieldError("note"))}
                    className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
                  />
                </fieldset>
                {sectionButtons("note")}
              </CardContent>
            </Card>
          )}
        </div>

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

        {/* 新規登録は段ごとに進む。既存データの保存は節ごとのボタンで行う */}
        {wizard && (
          <div className="space-y-2">
            {step === 2 && (
              <p className="text-muted-foreground text-sm">{m.products.compositionStepHint}</p>
            )}
            <div className="flex gap-2">
              {step > 1 && (
                <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                  {m.common.back}
                </Button>
              )}
              <Button type="submit" disabled={saving}>
                {saving ? m.common.saving : step < 3 ? m.common.next : m.common.save}
              </Button>
              {step === 1 && (
                <Button type="button" variant="outline" onClick={() => router.push("/products")}>
                  {m.common.cancel}
                </Button>
              )}
            </div>
            {step > 1 && (
              <p className="text-muted-foreground text-xs">{m.products.wizardSavedHint}</p>
            )}
          </div>
        )}
      </form>

      {!wizard && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/products")}>
            {m.common.back}
          </Button>
        </div>
      )}
    </div>
  );
}
