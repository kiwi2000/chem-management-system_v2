"use client";

import {
  THRESHOLD_BOUNDS,
  boundSign,
  effectiveThreshold,
  formatThreshold,
  pickName,
  trimPct,
  type OwnThreshold,
  type ThresholdBound,
} from "@chem/shared";
import type { ReactNode } from "react";
import type { LanguageDto } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * 法規制マスタの入力欄で繰り返し出てくる部品。
 * 法律・区分・法文物質名で同じ形の欄（名称の4つ組、閾値の4欄）を使うため、ここにまとめる。
 */

export const SELECT_CLASS = "border-input bg-background h-9 w-full rounded-md border px-2 text-sm";

/** ラベルと入力欄の縦組み。幅は呼び出し側が決める */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export interface NameDraft {
  nameOriginal: string;
  nameLang: string;
  nameJa: string;
  nameEn: string;
}

/**
 * 名称の4つ組。
 * 原文を必須にしてあるのは、中国や韓国の法律に日本語訳が無いことがあるため。
 * 表示は 日本語 → 英語 → 原文 の順に、あるものを出す。
 */
export function NameFields({
  idPrefix,
  labels,
  languages,
  locale,
  value,
  onChange,
  originalRequired = true,
}: {
  idPrefix: string;
  labels: { nameOriginal: string; nameLang: string; nameJa: string; nameEn: string };
  /** 選べる言語。管理の「言語」で登録したもの（打ち間違いで同じ言語が別扱いにならないように） */
  languages: LanguageDto[];
  /** 表示に使う言語（言語名の出し分け） */
  locale: "ja" | "en";
  value: NameDraft;
  onChange: (next: NameDraft) => void;
  originalRequired?: boolean;
}) {
  // 一覧から消えたコードが既に入っている行もあるので、いまの値は必ず選択肢に残す
  const options = languages.map((l) => ({
    code: l.code,
    label: `${l.code} ${pickName(locale, l.nameJa, l.nameEn)}`,
  }));
  if (value.nameLang && !options.some((o) => o.code === value.nameLang)) {
    options.push({ code: value.nameLang, label: value.nameLang });
  }
  return (
    <>
      <Field label={labels.nameOriginal} htmlFor={`${idPrefix}-name-original`} className="flex-1">
        <Input
          id={`${idPrefix}-name-original`}
          required={originalRequired}
          maxLength={500}
          value={value.nameOriginal}
          onChange={(e) => onChange({ ...value, nameOriginal: e.target.value })}
        />
      </Field>
      <Field label={labels.nameLang} htmlFor={`${idPrefix}-name-lang`} className="w-36">
        <select
          id={`${idPrefix}-name-lang`}
          required={originalRequired}
          value={value.nameLang}
          onChange={(e) => onChange({ ...value, nameLang: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={labels.nameJa} htmlFor={`${idPrefix}-name-ja`} className="flex-1">
        <Input
          id={`${idPrefix}-name-ja`}
          maxLength={500}
          value={value.nameJa}
          onChange={(e) => onChange({ ...value, nameJa: e.target.value })}
        />
      </Field>
      <Field label={labels.nameEn} htmlFor={`${idPrefix}-name-en`} className="flex-1">
        <Input
          id={`${idPrefix}-name-en`}
          maxLength={500}
          value={value.nameEn}
          onChange={(e) => onChange({ ...value, nameEn: e.target.value })}
        />
      </Field>
    </>
  );
}

/**
 * 閾値の入力中の値。法文物質名では空（""）が「区分の既定値に従う」。
 * 区分の欄では空にできない（`fallback` を渡さないと必須になる）
 */
export interface ThresholdDraft {
  thresholdLower: string;
  lowerBound: ThresholdBound | "";
  thresholdUpper: string;
  upperBound: ThresholdBound | "";
}

/** 区分の閾値。空の欄を埋める既定値 */
export interface ThresholdFallback {
  thresholdLower: string;
  lowerBound: ThresholdBound;
  thresholdUpper: string;
  upperBound: ThresholdBound;
}

export const DEFAULT_THRESHOLD: ThresholdFallback = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE",
  thresholdUpper: "100",
  upperBound: "INCLUSIVE",
};

/** 数字と小数点だけを通す。打っている途中の "12." や空欄も許す */
const NUMERIC = /^\d*\.?\d*$/;

/**
 * 閾値の4欄。
 * 並びは **下限値 不等号 含有率 不等号 上限値** で、式をそのまま読める形にしてある。
 * 一覧では `0 < x ≤ 100` の形にまとめて1列で見せる。
 *
 * 区分の欄では空にできない（すべて必須）。法文物質名の欄では `fallback`（区分の閾値）を渡すと
 * **空にできて、空の欄は区分の値が灰色で透けて見える**（入れた値と見分けが付くように）。
 */
export function ThresholdFields({
  idPrefix,
  label,
  hint,
  middleLabel,
  lowerLabel,
  upperLabel,
  bounds,
  value,
  onChange,
  fallback,
  fallbackLabel,
}: {
  idPrefix: string;
  label: string;
  hint?: string;
  /** 真ん中に置く言葉（例: 含有率（重量%）） */
  middleLabel: string;
  lowerLabel: string;
  upperLabel: string;
  /** 不等号の見せ方。下限も上限も同じ記号を使う */
  bounds: Record<ThresholdBound, string>;
  value: ThresholdDraft;
  onChange: (next: ThresholdDraft) => void;
  /** 空の欄を埋める区分の閾値。渡すと欄を空にできる */
  fallback?: ThresholdFallback;
  /** 区分の値の見出し（例: 区分の既定値） */
  fallbackLabel?: string;
}) {
  const sign = (key: "lowerBound" | "upperBound", ariaLabel: string) => (
    <select
      aria-label={ariaLabel}
      value={value[key]}
      onChange={(e) => onChange({ ...value, [key]: e.target.value as ThresholdBound | "" })}
      className={cn(
        SELECT_CLASS,
        "w-16 text-center",
        fallback && value[key] === "" && "text-muted-foreground",
      )}
    >
      {fallback && <option value="">{bounds[fallback[key]]}</option>}
      {THRESHOLD_BOUNDS.map((b) => (
        <option key={b} value={b}>
          {bounds[b]}
        </option>
      ))}
    </select>
  );

  const number = (key: "thresholdLower" | "thresholdUpper", id: string, ariaLabel: string) => (
    <Input
      id={id}
      required={!fallback}
      inputMode="decimal"
      aria-label={ariaLabel}
      value={value[key]}
      // 空欄のときは区分の値が薄く見える（入力した値とは色で見分ける）
      placeholder={fallback ? trimPct(fallback[key]) : undefined}
      // 数字と小数点しか入らないようにする（貼り付けもここを通る）
      onChange={(e) => {
        if (NUMERIC.test(e.target.value)) onChange({ ...value, [key]: e.target.value });
      }}
      className="w-24 text-right font-mono placeholder:text-muted-foreground/70"
    />
  );

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {number("thresholdLower", `${idPrefix}-lower`, lowerLabel)}
        {sign("lowerBound", lowerLabel)}
        <span className="px-1 text-sm">{middleLabel}</span>
        {sign("upperBound", upperLabel)}
        {number("thresholdUpper", `${idPrefix}-upper`, upperLabel)}
        {fallback && (
          <span className="text-muted-foreground font-mono text-xs">
            {fallbackLabel}{" "}
            {formatThreshold(
              fallback.thresholdLower,
              fallback.lowerBound,
              fallback.thresholdUpper,
              fallback.upperBound,
            )}
          </span>
        )}
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/**
 * 法文物質名の閾値を1行で見せる（一覧・見出し用）。
 * 区分の値で埋めた欄は灰色にし、1つでもあれば末尾に「（区分）」を付ける
 */
export function ThresholdText({
  own,
  category,
  fromCategoryLabel,
}: {
  own: OwnThreshold;
  category: ThresholdFallback;
  fromCategoryLabel: string;
}) {
  const t = effectiveThreshold(own, category);
  const part = (text: string, muted: boolean) => (
    <span className={cn(muted && "text-muted-foreground/70")}>{text}</span>
  );
  const any = Object.values(t.fromCategory).some(Boolean);
  return (
    <span className="font-mono whitespace-nowrap">
      {part(trimPct(t.thresholdLower), t.fromCategory.thresholdLower)}{" "}
      {part(boundSign(t.lowerBound), t.fromCategory.lowerBound)} x{" "}
      {part(boundSign(t.upperBound), t.fromCategory.upperBound)}{" "}
      {part(trimPct(t.thresholdUpper), t.fromCategory.thresholdUpper)}
      {any && <span className="text-muted-foreground/70 ml-1">{fromCategoryLabel}</span>}
    </span>
  );
}
