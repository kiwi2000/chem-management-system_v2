"use client";

import {
  DATE_OPERATORS,
  NUMBER_OPERATORS,
  TEXT_OPERATORS,
  needsSecondValue,
  needsValue,
  type ColumnFilter,
  type Messages,
} from "@chem/shared";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";
import type { TableColumn } from "./types";

const selectClass = "border-input bg-background h-8 rounded-md border px-1 text-xs";

interface Props<T> {
  column: TableColumn<T>;
  value: ColumnFilter | undefined;
  onChange: (next: ColumnFilter | undefined) => void;
}

/** 列ごとの絞り込み入力。種類（文字列・数値・日付・選択肢）で見た目が変わる */
export function FilterCell<T>({ column, value, onChange }: Props<T>) {
  const { m } = useI18n();
  const ops = m.table.operators as Record<string, string>;

  // 「以上」を選んでから数字を入れる、という順序を保てるように、
  // 値が空でも選んだ演算子は覚えておく（条件としてはまだ送らない）
  const appliedOp = value && value.kind !== "enum" ? value.op : null;
  const [pickedOp, setPickedOp] = useState<string | null>(null);
  useEffect(() => {
    if (appliedOp) setPickedOp(appliedOp);
  }, [appliedOp]);

  if (column.kind === "enum") {
    const selected = value?.kind === "enum" ? value.values : [];
    const label =
      selected.length === 0
        ? m.table.all
        : (column.options ?? [])
            .filter((o) => selected.includes(o.value))
            .map((o) => o.label)
            .join(", ");
    return (
      <details className="relative">
        <summary
          className="border-input bg-background flex h-8 cursor-pointer items-center truncate rounded-md border px-2 text-xs"
          title={label}
        >
          {label}
        </summary>
        <div className="bg-background absolute z-20 mt-1 min-w-40 space-y-1 rounded-md border p-2 shadow-md">
          {(column.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, o.value]
                    : selected.filter((v) => v !== o.value);
                  onChange(next.length > 0 ? { kind: "enum", values: next } : undefined);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      </details>
    );
  }

  const operators =
    column.kind === "text"
      ? TEXT_OPERATORS
      : column.kind === "number"
        ? NUMBER_OPERATORS
        : DATE_OPERATORS;
  const defaultOp = operators[0] as string;
  const op = appliedOp ?? pickedOp ?? defaultOp;
  const v1 = value && value.kind !== "enum" ? value.value : "";
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

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={`${column.header} ${m.table.condition}`}
        value={op}
        onChange={(e) => {
          setPickedOp(e.target.value);
          emit(e.target.value, v1, v2);
        }}
        className={selectClass}
      >
        {operators.map((o) => (
          <option key={o} value={o}>
            {ops[o] ?? o}
          </option>
        ))}
      </select>
      {needsValue(op) && (
        <Input
          aria-label={`${column.header} ${m.table.filterValue}`}
          type={inputType}
          value={v1}
          onChange={(e) => emit(op, e.target.value, v2)}
          className="h-8 w-full min-w-16 text-xs"
        />
      )}
      {needsValue(op) && needsSecondValue(op) && column.kind !== "text" && (
        <Input
          aria-label={`${column.header} ${m.table.filterValue2}`}
          type={inputType}
          value={v2}
          onChange={(e) => emit(op, v1, e.target.value)}
          className="h-8 w-full min-w-16 text-xs"
        />
      )}
    </div>
  );
}

/** 型合わせ用（辞書の operators は全演算子を持つ） */
export type OperatorLabels = Messages["table"]["operators"];
