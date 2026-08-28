"use client";

import { WIDTH_MAX, WIDTH_MIN, WIDTH_PERCENTS, widthPercent, type BlockWidth } from "@chem/shared";
import { useState } from "react";
import { useI18n } from "@/lib/i18n-client";

const SELECT = "border-input ml-2 h-6 rounded-none border bg-transparent px-1 text-xs";

/** 一覧に無い％を打つときに選ぶ値 */
const CUSTOM = "custom";

/** 「自由(%)」に切り替えたとき、打ち始める前の値 */
const CUSTOM_START = 45;

type Mode = "preset" | "auto" | "custom";

function initialMode(value: BlockWidth | undefined): Mode {
  if (value === "auto") return "auto";
  const pct = widthPercent(value);
  return pct !== null && (WIDTH_PERCENTS as readonly number[]).includes(pct) ? "preset" : "custom";
}

/**
 * ブロックの幅を選ぶ。
 *
 * よく使う％を並べ、**均等**と**自由入力**を足してある。
 * 均等はその行の残りを、均等どうしで等分する。
 *
 * **どれを選んでいるかは、この中で覚える。**値から毎回決め直すと、
 * 「均等」から「自由(%)」に切り替えたときに、値がまだ `auto` のままなので
 * 選択が「均等」に戻ってしまう（実際にそうなった）。
 * ブロックごとに1つ置く（呼ぶ側が `key` を付ける）ので、覚えていて困らない。
 */
export function WidthSelect({
  value,
  onChange,
}: {
  value: BlockWidth | undefined;
  onChange: (w: BlockWidth) => void;
}) {
  const { m } = useI18n();
  const pct = widthPercent(value);
  const [mode, setMode] = useState<Mode>(() => initialMode(value));
  const [typed, setTyped] = useState(() => (pct === null ? String(CUSTOM_START) : String(pct)));

  const selected = mode === "auto" ? "auto" : mode === "custom" ? CUSTOM : String(pct ?? 100);

  return (
    <>
      <select
        className={SELECT}
        aria-label={m.docEditor.width}
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "auto") {
            setMode("auto");
            onChange("auto");
            return;
          }
          if (v === CUSTOM) {
            setMode("custom");
            /*
              **切り替えたその場で数にする。**`auto` のまま置くと、
              打ち込むまで幅が均等のままで、選んだものと出ているものが食い違う
            */
            const start = pct ?? CUSTOM_START;
            setTyped(String(start));
            onChange(start);
            return;
          }
          setMode("preset");
          onChange(Number(v));
        }}
      >
        {WIDTH_PERCENTS.map((p) => (
          <option key={p} value={p}>
            {p === 100 ? m.docEditor.widthFull : `${p}%`}
          </option>
        ))}
        <option value="auto">{m.docEditor.widthAuto}</option>
        <option value={CUSTOM}>{m.docEditor.widthCustom}</option>
      </select>

      {mode === "custom" && (
        <input
          type="number"
          min={WIDTH_MIN}
          max={WIDTH_MAX}
          value={typed}
          aria-label={m.docEditor.widthCustom}
          className="border-input ml-1 h-6 w-14 rounded-none border bg-transparent px-1 text-xs"
          onChange={(e) => {
            setTyped(e.target.value);
            const n = Number(e.target.value);
            // 範囲の外は幅にしない。打っている途中の空欄も、そのままにしておく
            if (Number.isInteger(n) && n >= WIDTH_MIN && n <= WIDTH_MAX) onChange(n);
          }}
        />
      )}
    </>
  );
}
