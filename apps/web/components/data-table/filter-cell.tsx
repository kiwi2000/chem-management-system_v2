"use client";

import {
  DATE_OPERATORS,
  NUMBER_OPERATORS,
  TEXT_OPERATORS,
  needsSecondValue,
  needsValue,
  type ColumnFilter,
  type ListOperator,
  type Messages,
  splitNumericTokens,
  splitTextTokens,
} from "@chem/shared";
import { useCallback, useEffect, useState } from "react";
import { useOutsideClose } from "@/lib/use-outside-close";
import { ImeInput, ImeTextarea } from "./ime-field";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import type { TableColumn } from "./types";

const selectClass = "border-input bg-background h-8 w-20 shrink-0 rounded-none border px-1 text-xs";

interface Props<T> {
  column: TableColumn<T>;
  value: ColumnFilter | undefined;
  onChange: (next: ColumnFilter | undefined) => void;
}

/** 列ごとのフィルター入力。種類（文字列・数値・日付・選択肢）で見た目が変わる */
export function FilterCell<T>({ column, value, onChange }: Props<T>) {
  const { m } = useI18n();
  const ops = m.table.operators as Record<string, string>;

  // 「以上」を選んでから数字を入れる、という順序を保てるように、
  // 値が空でも選んだ演算子は覚えておく（条件としてはまだ送らない）
  const appliedOp = value && value.kind !== "enum" ? value.op : null;
  const [pickedOp, setPickedOp] = useState<string | null>(null);
  // 選択肢の小窓。外側のクリックと Esc で閉じる
  const [enumOpen, setEnumOpen] = useState(false);
  const closeEnum = useCallback(() => setEnumOpen(false), []);
  const enumBoxRef = useOutsideClose<HTMLDivElement>(enumOpen, closeEnum);
  useEffect(() => {
    if (appliedOp) setPickedOp(appliedOp);
  }, [appliedOp]);

  // まとめて入力する列。打っている途中の改行を消さないよう、入力欄の文字列はそのまま持つ
  const appliedValues = value?.kind === "list" ? value.values : [];
  const appliedKey = appliedValues.join("|");
  const [listText, setListText] = useState(appliedValues.join("\n"));
  // 入力が空でも選んだ条件は覚えておく（覚えないと選ぶたびに既定へ戻ってしまう）
  const [pickedListOp, setPickedListOp] = useState<ListOperator>("any");
  useEffect(() => {
    if (value?.kind === "list") setPickedListOp(value.op);
  }, [value]);
  // 打った文字の分けかた。CAS番号は数字の並び、名前は行やカンマで分ける
  const splitTokens = column.tokens === "text" ? splitTextTokens : splitNumericTokens;
  useEffect(() => {
    // 保存した条件の読込・条件のクリアなど、外から変わったときだけ入力欄を合わせる
    setListText((prev) =>
      splitTokens(prev).join("|") === appliedKey ? prev : appliedKey.split("|").join("\n"),
    );
  }, [appliedKey, splitTokens]);

  if (column.kind === "list") {
    const mode = value?.kind === "list" ? value.op : pickedListOp;

    /*
      選択肢が決まっている列（規制区分など）は、打ち込ませずに選ばせる。
      CAS番号のように**打ち込むしかない列**とは入力の形が違うだけで、
      「すべて含む／いずれかを含む」の切り替えは同じ。
    */
    if (column.options) {
      const options = column.options;
      const toggle = (v: string, checked: boolean) => {
        const next = checked ? [...appliedValues, v] : appliedValues.filter((x) => x !== v);
        onChange(next.length > 0 ? { kind: "list", op: mode, values: next } : undefined);
      };
      const label =
        appliedValues.length === 0
          ? m.table.all
          : options
              .filter((o) => appliedValues.includes(o.value))
              .map((o) => o.label)
              .join(", ");
      return (
        <div className="flex w-full items-start gap-1.5">
          <div ref={enumBoxRef} className="relative min-w-0 flex-1">
            <button
              type="button"
              aria-expanded={enumOpen}
              onClick={() => setEnumOpen((v) => !v)}
              className="border-input bg-background flex h-8 w-full cursor-pointer items-center truncate rounded-none border px-2 text-xs"
              title={label}
            >
              {label}
            </button>
            {enumOpen && (
              <div className="bg-background absolute z-20 max-h-72 min-w-64 space-y-1 overflow-y-auto rounded-md border p-2 shadow-md">
                {options.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={appliedValues.includes(o.value)}
                      onChange={(e) => toggle(o.value, e.target.checked)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <select
            aria-label={`${column.header} ${m.table.condition}`}
            value={mode}
            onChange={(e) => {
              const next = e.target.value as ListOperator;
              setPickedListOp(next);
              if (appliedValues.length > 0) {
                onChange({ kind: "list", op: next, values: appliedValues });
              }
            }}
            className="border-input bg-background h-8 shrink-0 rounded-none border px-1 text-xs"
          >
            <option value="any">{m.table.operators.any}</option>
            <option value="all">{m.table.operators.all}</option>
          </select>
        </div>
      );
    }

    const emitList = (raw: string, nextMode: ListOperator) => {
      const next = splitTokens(raw);
      onChange(next.length > 0 ? { kind: "list", op: nextMode, values: next } : undefined);
    };
    return (
      <div className="flex w-full items-start gap-1.5">
        <ImeTextarea
          aria-label={column.header}
          rows={3}
          value={listText}
          placeholder={column.filterPlaceholder}
          onValueChange={(next) => {
            setListText(next);
            emitList(next, mode);
          }}
          className="border-input bg-background min-w-0 flex-1 rounded-none border px-2 py-1 text-xs"
        />
        <select
          aria-label={`${column.header} ${m.table.condition}`}
          value={mode}
          onChange={(e) => {
            const next = e.target.value as ListOperator;
            setPickedListOp(next);
            emitList(listText, next);
          }}
          className={selectClass}
        >
          <option value="any">{m.table.operators.any}</option>
          <option value="all">{m.table.operators.all}</option>
        </select>
      </div>
    );
  }

  if (column.kind === "enum") {
    const selected = value?.kind === "enum" ? value.values : [];
    const options = column.options ?? [];

    /**
     * 選択肢を1つ切り替える。
     *
     * 「すべて」の状態から1つ触ったときは、その1つだけを指したものとして扱う。
     * （入れたら「それだけ」、外したら「それ以外」。
     * 全部選ばれている扱いにして足すと、逆に全部に印が付いてしまう）
     * 全部選ばれた状態と、1つも選ばれていない状態は、どちらも「絞らない」に落とす。
     */
    const toggle = (value_: string, checked: boolean) => {
      if (selected.length === 0) {
        const only = checked ? [value_] : options.map((o) => o.value).filter((v) => v !== value_);
        onChange(only.length === 0 ? undefined : { kind: "enum", values: only });
        return;
      }
      const next = checked ? [...selected, value_] : selected.filter((v) => v !== value_);
      const all = next.length === 0 || next.length === options.length;
      onChange(all ? undefined : { kind: "enum", values: next });
    };

    // 選択肢が2つだけの列（有効/無効・はい/いいえ）は、開かずにその場で出す
    if (options.length === 2) {
      return (
        <div className="flex h-8 items-center gap-4">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={selected.length === 0 || selected.includes(o.value)}
                onChange={(e) => toggle(o.value, e.target.checked)}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }

    const label =
      selected.length === 0
        ? m.table.all
        : options
            .filter((o) => selected.includes(o.value))
            .map((o) => o.label)
            .join(", ");
    return (
      <div ref={enumBoxRef} className="relative w-64">
        <button
          type="button"
          aria-expanded={enumOpen}
          onClick={() => setEnumOpen((v) => !v)}
          className="border-input bg-background flex h-8 w-full cursor-pointer items-center truncate rounded-none border px-2 text-xs"
          title={label}
        >
          {label}
        </button>
        {enumOpen && (
          <div className="bg-background absolute z-20 mt-1 min-w-40 space-y-1 rounded-md border p-2 shadow-md">
            {options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={(e) => toggle(o.value, e.target.checked)}
                />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  const allOperators =
    column.kind === "text"
      ? TEXT_OPERATORS
      : column.kind === "number"
        ? NUMBER_OPERATORS
        : DATE_OPERATORS;
  // 必須の列では「空白」「空白でない」を出さない（選んでも結果が変わらないため）
  const operators =
    column.nullable === false
      ? allOperators.filter((o) => o !== "empty" && o !== "notEmpty")
      : allOperators;
  const defaultOp = operators[0] as string;
  const op = appliedOp ?? pickedOp ?? defaultOp;
  const v1 = value && value.kind !== "enum" && value.kind !== "list" ? value.value : "";
  const v2 =
    value && (value.kind === "number" || value.kind === "date") ? (value.value2 ?? "") : "";
  const inputType = column.kind === "date" ? "date" : "text";

  function emit(nextOp: string, nextV1: string, nextV2: string) {
    if (!needsValue(nextOp)) {
      onChange({ kind: column.kind, op: nextOp, value: "" } as ColumnFilter);
      return;
    }
    if (nextV1 === "") {
      onChange(undefined);
      return;
    }
    onChange({ kind: column.kind, op: nextOp, value: nextV1, value2: nextV2 } as ColumnFilter);
  }

  // 「範囲」など値を2つ取る条件のときだけ広げる。それ以外は全部同じ幅に揃える
  const wide = needsValue(op) && needsSecondValue(op) && column.kind !== "text";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        column.filterFullWidth ? "w-full" : wide ? "w-[26rem]" : "w-64",
      )}
    >
      {needsValue(op) && (
        <ImeInput
          aria-label={`${column.header} ${m.table.filterValue}`}
          type={inputType}
          value={v1}
          onValueChange={(next) => emit(op, next, v2)}
          className="h-8 min-w-0 flex-1 text-xs"
        />
      )}
      {needsValue(op) && needsSecondValue(op) && column.kind !== "text" && (
        <ImeInput
          aria-label={`${column.header} ${m.table.filterValue2}`}
          type={inputType}
          value={v2}
          onValueChange={(next) => emit(op, v1, next)}
          className="h-8 min-w-0 flex-1 text-xs"
        />
      )}
      {/* 条件は値の後ろ。まず何を入れるかに目が行くようにする */}
      <select
        aria-label={`${column.header} ${m.table.condition}`}
        value={op}
        onChange={(e) => {
          setPickedOp(e.target.value);
          emit(e.target.value, v1, v2);
        }}
        className={cn(selectClass, !needsValue(op) && "ml-auto")}
      >
        {operators.map((o) => (
          <option key={o} value={o}>
            {ops[o] ?? o}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 型合わせ用（辞書の operators は全演算子を持つ） */
export type OperatorLabels = Messages["table"]["operators"];
