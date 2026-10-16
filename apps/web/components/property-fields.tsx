"use client";

import { pickName, PROPERTY_GROUPS, type Locale, type Messages } from "@chem/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { PropertyDefDto, PropertyOptionDto, PropertyValueDto } from "@/lib/types";

const selectClass = "border-input bg-background h-9 rounded-none border px-2 text-sm";

/** 条件の選択肢で「その他」を選んだ印（コードとは重ならない） */
const OTHER = "__other";

/** 1 項目ぶんの書きかけ。値も数値も文字列のまま持つ */
export interface PropertyDraftItem {
  value: string;
  unit: string;
  /** 選択肢のコード、「その他」なら OTHER、指定なしなら空 */
  conditionCode: string;
  conditionText: string;
}

/** 定義ID → 書きかけ */
export type PropertyDraft = Record<string, PropertyDraftItem>;

const EMPTY: PropertyDraftItem = { value: "", unit: "", conditionCode: "", conditionText: "" };

/** 保存済みの値から書きかけを作る（読み込み時と「破棄」のとき） */
export function initialPropertyDraft(values: PropertyValueDto[] | undefined): PropertyDraft {
  const draft: PropertyDraft = {};
  for (const p of values ?? []) {
    draft[p.propertyDefId] = {
      value: p.valueNum ?? p.valueText ?? "",
      unit: p.unit ?? "",
      conditionCode: p.conditionCode ?? (p.conditionText ? OTHER : ""),
      conditionText: p.conditionText ?? "",
    };
  }
  return draft;
}

/** 条件の欄を出すか。テキストの項目は、条件も文の中に書けるので出さない */
const hasCondition = (d: PropertyDefDto) => d.dataType !== "TEXT";

/** 送る形にする。値が空の項目は送らない（空の項目は行を作らず、場所を取らない） */
export function propertyBody(defs: PropertyDefDto[], draft: PropertyDraft) {
  return defs.flatMap((d) => {
    const item = draft[d.id] ?? EMPTY;
    const raw = item.value.trim();
    if (raw === "") return [];
    const free = d.conditionOptions.length === 0 || item.conditionCode === OTHER;
    const conditionText = hasCondition(d) && free ? item.conditionText.trim() || null : null;
    const conditionCode =
      hasCondition(d) && !free && item.conditionCode !== "" ? item.conditionCode : null;
    return [
      {
        propertyDefId: d.id,
        valueText: d.dataType === "NUMBER" ? null : raw,
        valueNum: d.dataType === "NUMBER" ? raw : null,
        unit: d.dataType === "NUMBER" ? item.unit || d.defaultUnit || null : null,
        conditionCode,
        conditionText,
      },
    ];
  });
}

const optionLabel = (locale: Locale, o: PropertyOptionDto) =>
  pickName(locale, o.labelJa, o.labelEn);

/** 表示のみのときの 1 項目の文字（値・単位・条件） */
function displayText(
  d: PropertyDefDto,
  item: PropertyDraftItem,
  locale: Locale,
  m: Messages,
): string {
  const value =
    d.dataType === "CHOICE"
      ? (() => {
          const o = d.valueOptions.find((x) => x.code === item.value);
          return o ? optionLabel(locale, o) : item.value;
        })()
      : item.value;
  const unit = d.dataType === "NUMBER" ? item.unit || d.defaultUnit || "" : "";
  const cond =
    item.conditionCode && item.conditionCode !== OTHER
      ? (() => {
          const o = d.conditionOptions.find((x) => x.code === item.conditionCode);
          return o ? optionLabel(locale, o) : item.conditionCode;
        })()
      : item.conditionText;
  const head = unit ? `${value} ${unit}` : value;
  return cond ? `${head}（${m.propertyValues.condition}: ${cond}）` : head;
}

interface Props {
  defs: PropertyDefDto[];
  draft: PropertyDraft;
  onChange: (draft: PropertyDraft) => void;
  /** 表示のみ。値の入った項目だけを、まとまりごとに並べる */
  readOnly: boolean;
}

/**
 * 物質・製品の拡張属性の欄（2026-10-17）。
 * - まとまり（物理的・化学的性質／健康への影響／環境への影響／その他）ごとに開け閉めする
 * - 表示のみのときは値の入った項目だけを出す。空の項目は場所を取らない
 * - 編集のときは使う項目を全部出す。「使わない」にした項目も、値が入っていれば出す（消さずに直せるように）
 * - 種類が「選択肢」の項目は選ぶ欄。数値と選択肢の項目には、測定の条件の欄を付ける
 */
export function PropertyFields({ defs, draft, onChange, readOnly }: Props) {
  const { m, locale } = useI18n();
  const filled = (d: PropertyDefDto) => (draft[d.id]?.value ?? "").trim() !== "";
  const shown = defs.filter((d) => (readOnly ? filled(d) : d.activeFlag || filled(d)));

  if (defs.length === 0) {
    return <p className="text-muted-foreground text-sm">{m.substances.propertiesEmpty}</p>;
  }
  if (shown.length === 0) {
    return <p className="text-muted-foreground text-sm">{m.propertyValues.noValues}</p>;
  }

  const set = (id: string, patch: Partial<PropertyDraftItem>) =>
    onChange({ ...draft, [id]: { ...(draft[id] ?? EMPTY), ...patch } });

  return (
    <div className="space-y-3">
      {PROPERTY_GROUPS.map((g) => {
        const items = shown.filter((d) => d.group === g);
        if (items.length === 0) return null;
        return (
          <details key={g} open className="group/props">
            <summary className="cursor-pointer text-sm font-medium select-none">
              {m.propertyDefs.groups[g]}
              <span className="text-muted-foreground ml-2 text-xs">{items.length}</span>
            </summary>
            {readOnly ? (
              <dl className="mt-2 grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                {items.map((d) => (
                  <div key={d.id} className="contents">
                    <dt className="text-muted-foreground">
                      {pickName(locale, d.labelJa, d.labelEn)}
                    </dt>
                    <dd className="min-w-0 break-words">
                      {displayText(d, draft[d.id] ?? EMPTY, locale, m)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="mt-2 space-y-2">
                {items.map((d) => (
                  <PropertyInputRow
                    key={d.id}
                    def={d}
                    item={draft[d.id] ?? EMPTY}
                    onChange={(patch) => set(d.id, patch)}
                  />
                ))}
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}

/** 編集のときの 1 項目（値・単位・条件） */
function PropertyInputRow({
  def: d,
  item,
  onChange,
}: {
  def: PropertyDefDto;
  item: PropertyDraftItem;
  onChange: (patch: Partial<PropertyDraftItem>) => void;
}) {
  const { m, locale } = useI18n();
  const label = pickName(locale, d.labelJa, d.labelEn);
  const id = `prop-${d.id}`;
  // 新しく選べるのは「使う」選択肢だけ。入力済みの値が「使わない」選択肢なら、それも残して見せる
  const choices = d.valueOptions.filter((o) => o.activeFlag || o.code === item.value);
  const conds = d.conditionOptions.filter((o) => o.activeFlag || o.code === item.conditionCode);
  const inactive = (o: PropertyOptionDto) =>
    o.activeFlag ? "" : ` ${m.propertyValues.inactiveOption}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={id} className="w-56">
        {label}
      </Label>
      {d.dataType === "CHOICE" ? (
        <select
          id={id}
          value={item.value}
          onChange={(e) => onChange({ value: e.target.value })}
          className={`${selectClass} w-48`}
        >
          <option value="">{m.propertyValues.choiceNone}</option>
          {choices.map((o) => (
            <option key={o.id} value={o.code}>
              {optionLabel(locale, o)}
              {inactive(o)}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          inputMode={d.dataType === "NUMBER" ? "decimal" : "text"}
          value={item.value}
          onChange={(e) => onChange({ value: e.target.value })}
          className={d.dataType === "NUMBER" ? "w-32" : "w-64"}
        />
      )}
      {d.dataType === "NUMBER" && (
        <Input
          aria-label={`${label} ${m.common.unit}`}
          value={item.unit || d.defaultUnit || ""}
          onChange={(e) => onChange({ unit: e.target.value })}
          className="w-24"
          placeholder={m.common.unit}
        />
      )}
      {hasCondition(d) &&
        (d.conditionOptions.length > 0 ? (
          <>
            <select
              aria-label={`${label} ${m.propertyValues.condition}`}
              value={item.conditionCode}
              onChange={(e) => onChange({ conditionCode: e.target.value })}
              className={`${selectClass} w-44`}
            >
              <option value="">{m.propertyValues.conditionNone}</option>
              {conds.map((o) => (
                <option key={o.id} value={o.code}>
                  {optionLabel(locale, o)}
                  {inactive(o)}
                </option>
              ))}
              <option value={OTHER}>{m.propertyValues.conditionOther}</option>
            </select>
            {item.conditionCode === OTHER && (
              <Input
                aria-label={`${label} ${m.propertyValues.conditionOther}`}
                value={item.conditionText}
                maxLength={200}
                onChange={(e) => onChange({ conditionText: e.target.value })}
                className="w-48"
                placeholder={m.propertyValues.conditionOtherPlaceholder}
              />
            )}
          </>
        ) : (
          <Input
            aria-label={`${label} ${m.propertyValues.condition}`}
            value={item.conditionText}
            maxLength={200}
            onChange={(e) => onChange({ conditionText: e.target.value })}
            className="w-48"
            placeholder={m.propertyValues.condition}
          />
        ))}
    </div>
  );
}
