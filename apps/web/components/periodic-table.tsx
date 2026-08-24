"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n-client";
import type { ElementDto, ListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 周期表のマスの寸法。狭い画面では横に送って見てもらう */
const CELL_W = 38;
const CELL_H = 46;
/** 左端の周期番号を出す列 */
const LABEL_W = 18;

/** 分類。色を分ける単位で、化学の教科書のまとまりに合わせている */
type Cat =
  | "alkali"
  | "alkaline"
  | "transition"
  | "lanthanoid"
  | "actinoid"
  | "postTransition"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble";

/** 凡例に出す順。表の左上から右下へ向かう並びにしている */
const CATS: Cat[] = [
  "alkali",
  "alkaline",
  "transition",
  "lanthanoid",
  "actinoid",
  "postTransition",
  "metalloid",
  "nonmetal",
  "halogen",
  "noble",
];

const CAT_CLASS: Record<Cat, string> = {
  alkali: "bg-red-100 dark:bg-red-950/60",
  alkaline: "bg-orange-100 dark:bg-orange-950/60",
  transition: "bg-amber-100 dark:bg-amber-950/60",
  lanthanoid: "bg-lime-100 dark:bg-lime-950/60",
  actinoid: "bg-emerald-100 dark:bg-emerald-950/60",
  postTransition: "bg-teal-100 dark:bg-teal-950/60",
  metalloid: "bg-cyan-100 dark:bg-cyan-950/60",
  nonmetal: "bg-sky-100 dark:bg-sky-950/60",
  halogen: "bg-indigo-100 dark:bg-indigo-950/60",
  noble: "bg-violet-100 dark:bg-violet-950/60",
};

const IN = (z: number, ...list: number[]) => list.includes(z);

/** 元素番号から分類を決める。番号だけで決まるので、表を別に持たなくてよい */
function categoryOf(z: number): Cat {
  if (IN(z, 3, 11, 19, 37, 55, 87)) return "alkali";
  if (IN(z, 4, 12, 20, 38, 56, 88)) return "alkaline";
  if (z >= 57 && z <= 71) return "lanthanoid";
  if (z >= 89 && z <= 103) return "actinoid";
  if ((z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 72 && z <= 80)) return "transition";
  if (z >= 104 && z <= 112) return "transition";
  if (IN(z, 2, 10, 18, 36, 54, 86, 118)) return "noble";
  if (IN(z, 9, 17, 35, 53, 85, 117)) return "halogen";
  if (IN(z, 1, 6, 7, 8, 15, 16, 34)) return "nonmetal";
  if (IN(z, 5, 14, 32, 33, 51, 52)) return "metalloid";
  return "postTransition";
}

/**
 * 元素番号から周期表のマス目（行・列）を決める。
 *
 * 8行目は空けておき、ランタノイド・アクチノイドの2行を主表から切り離す
 * （教科書と同じ、下に外へ出した形）。
 */
function positionOf(z: number): { row: number; col: number } | null {
  if (z === 1) return { row: 1, col: 1 };
  if (z === 2) return { row: 1, col: 18 };
  if (z <= 4) return { row: 2, col: z - 2 };
  if (z <= 10) return { row: 2, col: z + 8 };
  if (z <= 12) return { row: 3, col: z - 10 };
  if (z <= 18) return { row: 3, col: z };
  if (z <= 36) return { row: 4, col: z - 18 };
  if (z <= 54) return { row: 5, col: z - 36 };
  if (z <= 56) return { row: 6, col: z - 54 };
  if (z <= 71) return { row: 9, col: z - 54 };
  if (z <= 86) return { row: 6, col: z - 68 };
  if (z <= 88) return { row: 7, col: z - 86 };
  if (z <= 103) return { row: 10, col: z - 86 };
  if (z <= 118) return { row: 7, col: z - 100 };
  // 900番台（シアンなど、元素でないもの）は周期表に居場所がない
  return null;
}

/** マス目の位置から元素番号を引く索引。描画のたびに探し回らないため */
const Z_AT = new Map<string, number>();
for (let z = 1; z <= 118; z++) {
  const p = positionOf(z);
  if (p) Z_AT.set(p.row + "-" + p.col, z);
}

/**
 * 周期表。
 *
 * 元素の表に登録されているものだけを塗り、未登録のマスは薄い点線で出す。
 * 判定には使わない、見て分かるためだけのお楽しみ。
 */
export function PeriodicTable({
  reloadToken,
  selected,
  onSelect,
}: {
  reloadToken: number;
  /** 表の側で選ばれている元素記号。そのマスを光らせる */
  selected: string | null;
  /** マスを押したときに、表の側の選択も合わせる */
  onSelect: (symbol: string) => void;
}) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<ElementDto[] | null>(null);

  const load = useCallback(async () => {
    // 118個しかないので、1ページで全部引く
    const res = await fetch("/api/elements?size=200").catch(() => null);
    if (!res?.ok) return;
    setItems(((await res.json()) as ListResponse<ElementDto>).items);
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  /** 番号から行を引く索引 */
  const byNumber = useMemo(() => {
    const map = new Map<number, ElementDto>();
    for (const e of items ?? []) map.set(e.atomicNumber, e);
    return map;
  }, [items]);

  /** 周期表に載らないもの（900番台）。下に注記で出す */
  const others = useMemo(
    () => (items ?? []).filter((e) => positionOf(e.atomicNumber) === null),
    [items],
  );

  const cells: React.ReactNode[] = [];

  // 見出しの行。左上は空けて、1〜18の族番号
  cells.push(<div key="corner" />);
  for (let g = 1; g <= 18; g++) {
    cells.push(
      <div key={"g" + g} className="text-muted-foreground text-center text-[10px] leading-4">
        {g}
      </div>,
    );
  }

  for (let row = 1; row <= 10; row++) {
    // 8行目は、主表とランタノイド・アクチノイドの間の隙間
    if (row === 8) {
      cells.push(<div key="gap" className="col-span-full h-3" />);
      continue;
    }
    cells.push(
      <div
        key={"p" + row}
        className="text-muted-foreground flex items-center justify-center text-[10px]"
      >
        {row <= 7 ? row : ""}
      </div>,
    );
    for (let col = 1; col <= 18; col++) {
      // ランタノイド・アクチノイドを外へ出した跡地。範囲を書いて下を見てもらう
      if ((row === 6 || row === 7) && col === 3) {
        cells.push(
          <div
            key={row + "-" + col}
            className={cn(
              "text-muted-foreground flex items-center justify-center border border-dashed text-[10px]",
              CAT_CLASS[row === 6 ? "lanthanoid" : "actinoid"],
            )}
            style={{ height: CELL_H }}
          >
            {row === 6 ? "57–71" : "89–103"}
          </div>,
        );
        continue;
      }

      const z = Z_AT.get(row + "-" + col);
      if (z === undefined) {
        cells.push(<div key={row + "-" + col} style={{ height: CELL_H }} />);
        continue;
      }
      const el = byNumber.get(z);
      cells.push(
        <button
          key={row + "-" + col}
          type="button"
          disabled={!el}
          title={el ? el.nameJa + " / " + el.nameEn : m.elements.unregistered}
          onClick={() => el && onSelect(el.symbol)}
          className={cn(
            "flex flex-col items-center justify-center overflow-hidden border px-0.5",
            el ? CAT_CLASS[categoryOf(z)] : "border-dashed opacity-40",
            el && "hover:brightness-95",
            // 表の側で選ばれている元素は光らせる
            el && el.symbol === selected && "chem-glow relative z-10",
          )}
          style={{ height: CELL_H }}
        >
          <span className="text-muted-foreground text-[9px] leading-none">{z}</span>
          <span className="font-mono text-[13px] leading-tight font-semibold">
            {el ? el.symbol : ""}
          </span>
          <span className="w-full truncate text-center text-[8px] leading-none">
            {el ? (locale === "ja" ? el.nameJa : el.nameEn) : ""}
          </span>
        </button>,
      );
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{m.elements.periodicTable}</h2>

      <div className="overflow-x-auto pb-1">
        <div
          className="grid gap-[2px]"
          style={{
            width: LABEL_W + 18 * (CELL_W + 2),
            gridTemplateColumns: LABEL_W + "px repeat(18, " + CELL_W + "px)",
          }}
        >
          {cells}
        </div>
      </div>

      {/* 凡例と、マスの見方の図解 */}
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">{m.elements.legend}</p>
          <ul className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {CATS.map((c) => (
              <li key={c} className="flex items-center gap-1.5 text-[11px]">
                <span className={cn("inline-block size-3 border", CAT_CLASS[c])} />
                {m.elements.cat[c]}
              </li>
            ))}
          </ul>
        </div>

        <CellGuide />
      </div>

      {others.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {m.elements.periodicNote}
          {"（" + others.map((e) => e.symbol + " " + e.nameJa).join("、") + "）"}
        </p>
      )}
    </section>
  );
}

/** マスの見方。どこに何が出ているかを、引き出し線で示す */
function CellGuide() {
  const { m } = useI18n();
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">{m.elements.guide}</p>
      <svg
        viewBox="0 0 250 92"
        className="text-muted-foreground h-[92px] w-[250px]"
        role="img"
        aria-label={m.elements.guide}
      >
        {/* 周期表の1マスを大きくしたもの */}
        <rect
          x="8"
          y="10"
          width="76"
          height="72"
          className="fill-sky-100 stroke-current dark:fill-sky-950/60"
          strokeWidth="1"
        />
        <text x="46" y="30" textAnchor="middle" className="fill-current text-[11px]">
          6
        </text>
        <text
          x="46"
          y="56"
          textAnchor="middle"
          className="fill-foreground font-mono text-[22px] font-semibold"
        >
          C
        </text>
        <text x="46" y="74" textAnchor="middle" className="fill-current text-[11px]">
          炭素
        </text>

        {/* 引き出し線 */}
        <g className="stroke-current" strokeWidth="1">
          <path d="M60 26 H108" fill="none" />
          <path d="M72 50 H108" fill="none" />
          <path d="M62 70 H108" fill="none" />
        </g>
        <g className="fill-current text-[11px]">
          <text x="114" y="29">
            {m.elements.atomicNumber}
          </text>
          <text x="114" y="53">
            {m.elements.symbol}
          </text>
          <text x="114" y="73">
            {m.elements.nameJa}
          </text>
        </g>
      </svg>
    </div>
  );
}
