"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * 切れているセルの中身を、**押したときに**全部出す。
 *
 * **素の吹き出し（`title`）は使わない。**出るまでが遅く、見た目もそろわず、
 * 長い文でも途中で切られる端末がある。同じ字で、全部を出す。
 *
 * **マウスを置いただけでは出さない。**表の上を通るたびに出ると読みにくく、
 * また、出ている間しか触れないので**中身を写せない**。
 * 押して開き、外を押すと閉じる形なら、選んで写せて、大きさも変えられる。
 *
 * **切れていないセルでは出さない。**全部見えているのに窓が重なると、
 * 読んでいるものが隠れるだけになる。
 *
 * **表ごとにセルを包まず、表そのものに付ける。**
 * 一覧（`DataTable`）は列の定義から組み立てるので包むのは簡単だが、
 * 判定表や組成表は手で組んでいて、セルの数だけ書き換えることになる。
 * ここでは表の中で起きた操作を1か所で受け、
 * 押されたセルの中身をそのまま複製して出す。**どの表でも付け足しは1行で済む。**
 *
 * **セル自身が押されたときの動きを持つ表は、`data-cell-click` を付けること。**
 * 判定表のように、押すと別の窓が開くセルでは、両方が同時に開いてしまう。
 *
 * 使いかた:
 *
 * ```tsx
 * const peek = useTablePeek<HTMLDivElement>();
 * <div ref={peek.attach} className="overflow-x-auto">
 *   <table>…</table>
 * </div>
 * {peek.node}
 * ```
 */

/**
 * 窓の幅の上限。
 *
 * **幅は中身に合わせる。**短い中身にこの幅の枠を出すと、
 * 中身より枠のほうが目立って読みにくい。いちばん長い行の幅に縮める
 * （`max-content` が、改行で区切ったうちのいちばん長い行に合わせてくれる）。
 * ここを超える行は、この幅で折り返す。**つまみで引けば、この上限より広げられる**
 */
const MAX_WIDTH = 504;

/** つまみを置く角。下の両角だけ（上へ広げると、押したセルから離れていく） */
const CORNERS = ["left", "right"] as const;

/**
 * つまみの絵柄。**斜めの線を角に三角で切って2本だけ出す。**
 * 左右は互いの鏡写し。色は文字色から取るので、明るい配色でも暗い配色でも馴染む。
 *
 * 切り取る三角を角の近くに寄せてあるので、いちばん長い（角から遠い）線は出ない。
 * **掴める広さはこれで狭くならない。**絵柄はこの中の別の層に描いてあり、
 * 押されたことを受けるのは切り取っていない四角のほう
 */
function gripLook(corner: (typeof CORNERS)[number]) {
  return {
    backgroundImage: `repeating-linear-gradient(${
      corner === "left" ? 45 : 135
    }deg, currentColor 0 1px, transparent 1px 3px)`,
    clipPath:
      corner === "left"
        ? "polygon(0 30%, 70% 100%, 0 100%)"
        : "polygon(100% 30%, 100% 100%, 30% 100%)",
  };
}

/** つまみで縮められる下限。これより小さいと、何が出ているのか分からなくなる */
const MIN_WIDTH = 160;
const MIN_HEIGHT = 56;

export function useTablePeek<T extends HTMLElement = HTMLDivElement>() {
  /*
    **枠は「状態」で持つ。**参照（`useRef`）で持つと、
    表が読み込みのあとに描かれる画面で、監視を付けるときにまだ枠が無く、
    そのまま付かずじまいになる（実際にそうなった）
  */
  const [scope, setScope] = useState<T | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** 中身を入れる箱。枠とは分ける（つまみが中身と一緒に流れてしまわないように） */
  const body = useRef<HTMLDivElement>(null);
  /** いま開いているセル。中身の複製元 */
  const cell = useRef<HTMLElement | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  /*
    出したあとに測った大きさ。
    **測る前は中身なり、測ってからは決め打ち。**
    決め打ちに変えるのは、そこから先を**つまみで自由に変えられるようにする**ため
    （中身なりのままだと、上限で止まって広げられない）
  */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /** 左下のつまみを掴んだときの姿。ここからの差で大きさを決める */
  const drag = useRef<{ x: number; y: number; w: number; h: number; left: number } | null>(null);

  const close = useCallback(() => {
    cell.current = null;
    setAt(null);
    setSize(null);
  }, []);

  useEffect(() => {
    const root = scope;
    if (root === null) return;

    const open = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const td = target.closest("td, th");
      if (!(td instanceof HTMLElement) || !root.contains(td)) return;
      // 同じセルをもう一度押したら閉じる
      if (td === cell.current) return close();
      if (!worthShowing(td, target)) return;
      cell.current = td;
      setSize(null);
      setAt(placeFor(td));
    };

    /*
      **押せることが分かるようにする。**
      見た目は他のセルと同じなので、指の形が変わらないと押せると気づけない。
      React の状態にはしない（表全体が描き直しになる）
    */
    const hint = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const td = target.closest("td, th");
      if (!(td instanceof HTMLElement) || !root.contains(td)) return;
      if (td.dataset.peekHinted === "1") return;
      td.dataset.peekHinted = "1";
      if (worthShowing(td, target)) td.style.cursor = "pointer";
    };
    const unhint = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const td = target.closest("td, th");
      if (!(td instanceof HTMLElement)) return;
      delete td.dataset.peekHinted;
      td.style.removeProperty("cursor");
    };

    root.addEventListener("click", open);
    root.addEventListener("mouseover", hint);
    root.addEventListener("mouseout", unhint);
    // 行を両押しして詳細を開くときは、窓を残さない
    root.addEventListener("dblclick", close);
    return () => {
      root.removeEventListener("click", open);
      root.removeEventListener("mouseover", hint);
      root.removeEventListener("mouseout", unhint);
      root.removeEventListener("dblclick", close);
    };
  }, [scope, close]);

  /* 外を押したら閉じる。窓の中と、開いたセルの上は「外」ではない */
  useEffect(() => {
    if (at === null) return;
    const away = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (pop.current?.contains(target)) return;
      if (cell.current?.contains(target)) return;
      close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", away);
    document.addEventListener("keydown", esc);
    // 画面の大きさが変わると置き場所が合わなくなる
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
    };
  }, [at, close]);

  /*
    **中身は複製して出す。**元のセルは列の幅と行の高さで切ってあるので、
    切るための指定（行数の打ち切り・高さの上限・1行に収める指定）は複製から外す。
    外さないと、窓の中でも同じところで切れてしまう
  */
  useEffect(() => {
    const box = body.current;
    const from = cell.current;
    if (at === null || box === null || from === null) return;
    const copy = [...from.childNodes].map((n) => n.cloneNode(true));
    for (const n of copy) if (n instanceof HTMLElement) unclip(n);
    box.replaceChildren(...copy);
  }, [at]);

  /*
    **出したあとに測って、大きさを決め、画面へ収まる位置まで寄せる。**
    幅も高さも中身しだいで、出す前には分からない。長い備考をセルの真下に置くと、
    下半分が画面の外へ出て読めなくなる（実際にそうなった）。
    画面より高い中身は、上端から目一杯まで出して、残りは窓の中で送ってもらう
  */
  useEffect(() => {
    const box = pop.current;
    if (at === null || box === null || size !== null) return;
    const b = box.getBoundingClientRect();
    // ここで大きさを決め打ちに変える。以降はつまみで自由に変えられる
    setSize({ w: Math.ceil(b.width), h: Math.ceil(b.height) });
    const view = viewport();
    const top = Math.max(8, Math.min(at.top, view.h - 8 - b.height));
    const left = Math.max(8, Math.min(at.left, view.w - 8 - b.width));
    if (Math.abs(top - at.top) > 1 || Math.abs(left - at.left) > 1) setAt({ top, left });
  }, [at, size]);

  const node =
    at &&
    createPortal(
      <div
        ref={pop}
        style={{
          top: at.top,
          left: at.left,
          /*
            **最初の大きさは中身に合わせる。**いちばん長い行の幅で、上限まで。
            測ったあとは決め打ちに変え、上限も外す。
            上限を残したままだと、**つまみでそこから先へ引けない**
          */
          width: size === null ? "max-content" : size.w,
          height: size?.h,
          /*
            **広げても画面からはみ出させない。**置いた場所から右下へ伸びるので、
            上限は「そこから画面の端まで」。はみ出すと、広げたぶんが読めなくなる。
            測る前は場所がまだ動くので、画面いっぱいを上限にしておく
          */
          maxWidth:
            size === null ? Math.min(MAX_WIDTH, viewport().w - 16) : viewport().w - at.left - 8,
          maxHeight: size === null ? viewport().h - 16 : viewport().h - at.top - 8,
        }}
        /*
          **両下角のつまみで大きさを変えられる。**中身が多いときに広げて読むため。
          変えた大きさはその1回かぎりで、次に開くときはまた中身に合った大きさに戻る。

          **画面まかせの `resize` は使わない。**右下にしか付かないうえ、
          絵柄が画面まかせなので、左下に足したものと見た目がそろわない。
          両方とも自前にして、同じ絵柄・同じ動きにする
        */
        className="bg-popover fixed z-50 flex flex-col overflow-hidden rounded-md border shadow-md"
      >
        {/*
          **打った改行のまま出す。**セルの中は幅と高さに合わせて切ってあるが、
          ここは全部を読むための場所なので、書いたとおりの形で見せる
        */}
        <div
          ref={body}
          className="min-h-0 flex-1 overflow-auto px-2.5 py-2 text-sm break-words whitespace-pre-wrap"
        />

        {CORNERS.map((corner) => (
          <div
            key={corner}
            /*
              読み上げには乗せない。**掴んで引くためだけのもの**で、
              中身は窓の中にそのまま出ている（ここを使わなくても全部読める）
            */
            aria-hidden="true"
            /*
              **枠の外に置かない。**中に置くことで、掴んでも「窓の外を押した」と
              見なされず、窓が閉じない
            */
            className={cn(
              "text-muted-foreground/60 hover:text-muted-foreground absolute bottom-0 size-3.5 touch-none",
              corner === "left" ? "left-0 cursor-nesw-resize" : "right-0 cursor-nwse-resize",
            )}
            onPointerDown={(e) => {
              const box = pop.current;
              if (box === null) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              const r = box.getBoundingClientRect();
              drag.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, left: r.left };
            }}
            onPointerMove={(e) => {
              const from = drag.current;
              if (from === null) return;
              const view = viewport();
              let left = from.left;
              let width: number;
              if (corner === "left") {
                // 左へ引くと、幅が増えたぶんだけ左端が戻る（掴んだ角がカーソルに付いてくる）
                left = Math.max(8, from.left + (e.clientX - from.x));
                width = Math.max(MIN_WIDTH, from.w + (from.left - left));
                // 幅が下限で止まったら、左端もそこで止める
                if (width === MIN_WIDTH) left = from.left + from.w - MIN_WIDTH;
              } else {
                const room = view.w - from.left - 8;
                width = Math.max(MIN_WIDTH, Math.min(from.w + (e.clientX - from.x), room));
              }
              const room = view.h - at.top - 8;
              const height = Math.max(MIN_HEIGHT, Math.min(from.h + (e.clientY - from.y), room));
              setAt({ top: at.top, left: Math.round(left) });
              setSize({ w: Math.round(width), h: Math.round(height) });
            }}
            onPointerUp={(e) => {
              drag.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          >
            {/* 絵柄だけを別の層に描く。掴む相手は切り取っていない四角のほう */}
            <span className="absolute inset-0" style={gripLook(corner)} />
          </div>
        ))}
      </div>,
      document.body,
    );

  return {
    /** 表を包む枠に渡す。`ref={peek.attach}`、または他の参照と一緒に呼ぶ */
    attach: setScope,
    node,
  };
}

/** 出す値打ちがあるか。切れていない、または中身を写せないセルでは出さない */
function worthShowing(td: HTMLElement, target: Element) {
  if (td.textContent?.trim() === "") return false;
  /*
    **セル自身が押されたときの動きを持つ表では出さない。**
    判定表のように、押すと別の窓が開くセルでは、両方が同時に開いてしまう
  */
  if (td.closest("[data-cell-click]")) return false;
  /*
    **押した先が操作するものなら、そちらに譲る。**
    リンク・ボタン・チェックボックス、列幅や行の高さのつまみ。
    入力欄のあるセルも外す（打っている途中の値は複製に写らないため）
  */
  if (target.closest("a, button, input, textarea, select, label, [role='separator']")) return false;
  if (td.querySelector("input, textarea, select")) return false;
  return clipped(td);
}

/*
  切れているかどうか。
  1行に収めている列は横で、行数で止めている列は縦ではみ出す。
  **中の要素も見る。**「各種番号」のように1つのセルへ何行も入れている列は、
  外側は収まっていて中の行だけが切れている
*/
function clipped(td: HTMLElement) {
  const over = (el: Element) =>
    el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  if (over(td)) return true;
  return [...td.querySelectorAll("*")].some(over);
}

/**
 * 画面の広さ。
 *
 * **`100vw` は使わない。**横に出るスクロールバーのぶんを含むので、
 * その幅だけ窓がバーの下へ潜り、はみ出したところが読めなくなる
 */
function viewport() {
  return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
}

/** 窓はセルのすぐ下。下に置けないときだけ上へ回す（高さは出してから測る） */
function placeFor(td: HTMLElement) {
  const r = td.getBoundingClientRect();
  const below = r.bottom + 4;
  const room = viewport().h - below;
  return { top: room < 120 ? Math.max(8, r.top - 8) : below, left: r.left };
}

/** 複製から「切るための指定」を外す */
function unclip(el: HTMLElement) {
  for (const n of [el, ...el.querySelectorAll("*")]) {
    if (!(n instanceof HTMLElement)) continue;
    n.style.removeProperty("-webkit-line-clamp");
    n.style.removeProperty("max-height");
    n.style.removeProperty("height");
    n.style.overflow = "visible";
    // **`normal` にはしない。**打った改行が空白1つに潰れてしまう
    n.style.whiteSpace = "pre-wrap";
    n.style.textOverflow = "clip";
  }
}
