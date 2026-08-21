"use client";

import {
  COMPOSITION_MAX_DEPTH,
  pickName,
  ratioToPct,
  SCALED_HUNDRED,
  timesPct,
  toScaled,
  type Locale,
  type Ratio,
} from "@chem/shared";
import { ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { CompositionLineDto, CompositionResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 原材料の中身を、その行の下に入れ子で差し込む。
 *
 * 登録した組成は1段しか持っていない。原材料の中身は、その原材料を親として
 * 同じ入口をもう一度呼んで持ってくる。押された枝だけ、押されたときに取りに行く。
 *
 * 記録は置き換えない。登録した行はそのまま残し、展開した行を下に足すだけ。
 * 見分けが付くよう、展開した行は淡い背景と左の罫線で示す。
 *
 * 深さは気にしなくてよい。循環は保存時に止めているので（wouldCreateCycle）、
 * たどっていけば必ず終わる。COMPOSITION_MAX_DEPTH は、壊れた形が入ったときの安全網。
 */

/** 取りに行った結果。開けなかった理由も同じ形で持つ */
type Branch =
  | { state: "loading" }
  | { state: "ready"; data: CompositionResponse }
  | { state: "denied"; reason: "empty" | "forbidden" | "notFound" | "failed" };

/**
 * 枝を指す鍵。
 * 同じ原材料が2か所に出てくることがあるので、行のidを祖先から連ねて区別する。
 */
type Path = string;

export interface TreeState {
  /** 開いている枝 */
  open: Set<Path>;
  /** 取りに行った結果。閉じても捨てないので、開き直しても通信しない */
  branches: Map<Path, Branch>;
  toggle: (path: Path, productId: string) => void;
}

export function useCompositionTree(): TreeState {
  const [open, setOpen] = useState<Set<Path>>(new Set());
  const [branches, setBranches] = useState<Map<Path, Branch>>(new Map());

  const put = useCallback((path: Path, branch: Branch) => {
    setBranches((prev) => new Map(prev).set(path, branch));
  }, []);

  const toggle = useCallback(
    (path: Path, productId: string) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });

      // 一度取ったものは覚えておく。閉じて開き直しても取りに行かない
      setBranches((prev) => {
        if (prev.has(path)) return prev;
        void (async () => {
          put(path, { state: "loading" });
          const res = await fetch(`/api/products/${productId}/composition`).catch(() => null);
          if (!res) return put(path, { state: "denied", reason: "failed" });
          if (redirectIfUnauthorized(res)) return;
          if (res.status === 403) return put(path, { state: "denied", reason: "forbidden" });
          if (res.status === 404) return put(path, { state: "denied", reason: "notFound" });
          if (!res.ok) return put(path, { state: "denied", reason: "failed" });
          const data = (await res.json()) as CompositionResponse;
          if (data.lines.length === 0) return put(path, { state: "denied", reason: "empty" });
          put(path, { state: "ready", data });
        })();
        return new Map(prev).set(path, { state: "loading" });
      });
    },
    [put],
  );

  return { open, branches, toggle };
}

/** 展開の印。中身を持つ原材料の行にだけ出す */
export function ExpandToggle({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-foreground -my-1 -ml-1 inline-flex size-5 items-center justify-center align-middle"
    >
      <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
    </button>
  );
}

interface RowsProps {
  tree: TreeState;
  /** この枝の親の行を指す鍵 */
  path: Path;
  /** 製品全体に対する、この枝の入り口の比率 */
  ratio: Ratio;
  /** 換算値に添える「◯◯の中で」の◯◯ */
  parentName: string;
  depth: number;
  /** 結合の幅を合わせるための列数（編集中かどうかで変わる） */
  colSpan: number;
  /** 「原材料内」の列を出すか */
  showWithin: boolean;
  cellClass: string;
}

/**
 * 開いた枝の中身を行として返す。
 * 表の途中に差し込むので <tr> の配列を返す（<tbody> は親が持つ）。
 */
export function CompositionTreeRows({
  tree,
  path,
  ratio,
  parentName,
  depth,
  colSpan,
  showWithin,
  cellClass,
}: RowsProps) {
  const { m, locale } = useI18n();
  const branch = tree.branches.get(path);
  if (!tree.open.has(path) || !branch) return null;

  if (branch.state === "loading") {
    return <NoteRow depth={depth} colSpan={colSpan} text={m.composition.expandLoading} />;
  }
  if (branch.state === "denied") {
    const text = {
      empty: m.composition.expandEmpty,
      forbidden: m.composition.expandForbidden,
      notFound: m.composition.expandNotFound,
      failed: m.composition.expandFailed,
    }[branch.reason];
    return <NoteRow depth={depth} colSpan={colSpan} text={text} />;
  }
  if (depth > COMPOSITION_MAX_DEPTH) {
    return <NoteRow depth={depth} colSpan={colSpan} text={m.composition.expandTooDeep} />;
  }

  const { lines, totalPct, balancePct } = branch.data;
  // 合計が 100% でない原材料は、下の値を足しても上の行の値にならない。黙って出さない
  const total = toScaled(totalPct);
  const uneven = balancePct === null && total !== null && total !== SCALED_HUNDRED;

  return (
    <>
      {uneven && (
        <NoteRow depth={depth} colSpan={colSpan} text={m.composition.expandTotalNot100(totalPct)} />
      )}
      {lines.map((line) => (
        <TreeRow
          key={line.id}
          line={line}
          tree={tree}
          parentPath={path}
          ratio={ratio}
          parentName={parentName}
          balancePct={balancePct}
          depth={depth}
          colSpan={colSpan}
          showWithin={showWithin}
          cellClass={cellClass}
          locale={locale}
        />
      ))}
    </>
  );
}

function TreeRow({
  line,
  tree,
  parentPath,
  ratio,
  parentName,
  balancePct,
  depth,
  colSpan,
  showWithin,
  cellClass,
  locale,
}: {
  line: CompositionLineDto;
  tree: TreeState;
  parentPath: Path;
  ratio: Ratio;
  parentName: string;
  balancePct: string | null;
  depth: number;
  colSpan: number;
  showWithin: boolean;
  cellClass: string;
  locale: Locale;
}) {
  const { m } = useI18n();
  const element = line.element;
  if (!element) return null;

  // 残部の行は自分では値を持たない。親の組成から計算した値を使う
  const within = line.isBalance ? balancePct : line.contentPct;
  const childRatio = within === null ? null : timesPct(ratio, within);
  const name = pickName(locale, element.nameJa, element.nameEn);

  const path = `${parentPath}/${line.id}`;
  const expandable = element.hasComposition && depth < COMPOSITION_MAX_DEPTH;
  const open = tree.open.has(path);

  return (
    <>
      <tr className="bg-muted/40 border-b">
        <td className={cn(cellClass, "font-mono text-xs")}>
          <span style={{ paddingLeft: depth * 14 }} className="inline-flex items-center gap-1">
            {expandable ? (
              <ExpandToggle
                open={open}
                onClick={() => tree.toggle(path, element.id)}
                label={open ? m.composition.collapse : m.composition.expand}
              />
            ) : (
              <span className="inline-block size-5" />
            )}
            {element.code}
          </span>
        </td>
        <td className={cn(cellClass, "font-mono text-xs")}>
          {element.casNumber ?? (
            <span className="text-muted-foreground font-sans">{m.composition.kindProduct}</span>
          )}
        </td>
        <td className={cellClass}>{name}</td>
        {/* 製品全体に対する値。法規制の判定はこちらを使う */}
        <td className={cn(cellClass, "text-right whitespace-nowrap")}>
          {childRatio === null ? (
            <span className="text-muted-foreground text-xs">{m.composition.balanceAuto}</span>
          ) : (
            `${ratioToPct(childRatio)}%`
          )}
        </td>
        {/*
         * その原材料の中での値。仕入先の資料と突き合わせるときに使う。
         * どの原材料の中での話かは字下げが示すので、行では名前をくり返さない。
         * 深く潜って見失ったときのために、マウスを乗せると元の文が出るようにしておく。
         */}
        {showWithin && (
          <td
            className={cn(cellClass, "text-muted-foreground text-right whitespace-nowrap")}
            title={within === null ? undefined : m.composition.withinParent(parentName, within)}
          >
            {within === null ? "" : `${within}%`}
          </td>
        )}
        <td className={cn(cellClass, "text-muted-foreground text-xs")}>{line.note}</td>
        {/* 編集中の操作列ぶん。展開行に操作は無い */}
        {colSpan > (showWithin ? 6 : 5) && <td className={cellClass} />}
      </tr>
      {expandable && childRatio !== null && (
        <CompositionTreeRows
          tree={tree}
          path={path}
          ratio={childRatio}
          parentName={name}
          depth={depth + 1}
          colSpan={colSpan}
          showWithin={showWithin}
          cellClass={cellClass}
        />
      )}
    </>
  );
}

/** 値のない行（読み込み中・開けない理由・注意書き） */
function NoteRow({ depth, colSpan, text }: { depth: number; colSpan: number; text: string }) {
  return (
    <tr className="bg-muted/40 border-b">
      <td className="text-muted-foreground px-2 py-1 text-xs" colSpan={colSpan}>
        <span style={{ paddingLeft: depth * 14 + 20 }}>{text}</span>
      </td>
    </tr>
  );
}
