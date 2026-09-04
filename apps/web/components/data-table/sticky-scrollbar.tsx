"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n-client";

/**
 * 画面の下に貼り付く横スクロールバー。
 *
 * **縦に長い表は、上のほうを読んでいるあいだ横の帯が画面の外にある。**
 * 横に動かすには表の下端まで送らなければならず、戻ってくると位置を見失う。
 * そこで、表が画面に見えていて、かつ本物の帯が画面の外にあるあいだだけ、
 * 画面の下端に同じ幅の帯を1本出し、表の横スクロールと連動させる。
 *
 * - 本物の帯が画面に入ったら消える（二重に出さない）
 * - 横にはみ出していない表には出さない
 * - 帯の見た目は、他のスクロールバーと同じ（globals.css の指定がそのまま効く）
 *
 * 使いかた（`useTablePeek` と同じ形。表を包む枠に付けるだけ）:
 *
 * ```tsx
 * const sticky = useStickyScrollbar<HTMLDivElement>();
 * <div ref={sticky.attach} className="overflow-x-auto">…</div>
 * {sticky.node}
 * ```
 */

/** 帯の高さ。つまみ（10px）に上下の余白を足したぶん */
const BAR_HEIGHT = 14;

interface Placement {
  left: number;
  width: number;
  scrollWidth: number;
}

export function useStickyScrollbar<T extends HTMLElement = HTMLDivElement>() {
  const { m } = useI18n();
  // 枠は「状態」で持つ。読み込みのあとに描かれる表でも、現れた時点で監視を付けられる
  const [el, setEl] = useState<T | null>(null);
  const attach = useCallback((node: T | null) => setEl(node), []);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  /** 連動中に、相手の scroll がこちらへ跳ね返ってこないようにする印 */
  const syncing = useRef(false);

  useEffect(() => {
    if (!el) return;

    const update = (e?: Event) => {
      // 帯自身のスクロールもここへ届く（capture）。それで位置を戻してしまわない
      if (e && e.target === bar.current) return;
      const rect = el.getBoundingClientRect();
      /*
        **横に送れる枠だけを相手にする。**overflow を visible にした枠（外側の箱に送らせている表）は
        scrollWidth が中身の幅を返すので、はみ出しているように見えるが、自分では送れない。
        そこに帯を出すと、外側の箱の帯と二重になり、動かしても効かない
      */
      const overflowX = getComputedStyle(el).overflowX;
      const scrollable = overflowX === "auto" || overflowX === "scroll";
      const overflowing = scrollable && el.scrollWidth > el.clientWidth + 1;
      // 表の下端（本物の帯の位置）が画面に入っていれば、こちらは要らない
      const realBarVisible = rect.bottom <= window.innerHeight;
      const inView = rect.top < window.innerHeight - BAR_HEIGHT && rect.bottom > 0;
      if (!overflowing || realBarVisible || !inView) {
        setPlacement(null);
        return;
      }
      setPlacement({ left: rect.left, width: el.clientWidth, scrollWidth: el.scrollWidth });
    };

    /** 表が横に送られたら帯を合わせる。帯を動かしたときは onBarScroll が逆向きに合わせる */
    const onTableScroll = () => {
      if (!bar.current || syncing.current) return;
      if (bar.current.scrollLeft === el.scrollLeft) return;
      syncing.current = true;
      bar.current.scrollLeft = el.scrollLeft;
      // 帯の scroll は次の描画で届くので、印はそこまで持つ
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    };

    update();
    // 画面のスクロールは、入れ子の箱で起きたものも拾う（capture）
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    el.addEventListener("scroll", onTableScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    ro?.observe(el);
    // 中身（表）の幅が変わったときも測り直す（列の出し入れ・幅の変更）
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
      el.removeEventListener("scroll", onTableScroll);
      ro?.disconnect();
    };
  }, [el]);

  /*
    帯を動かしたら表を合わせる。**帯は body に直接置く（portal）ので、React の onScroll では
    届かないことがある。**帯が現れたときに素の scroll を付ける。
    現れた直後は、その時点の表の位置に合わせる（表を送ってから下へ戻ってきた場合）
  */
  const shown = placement !== null;
  useEffect(() => {
    const node = bar.current;
    if (!shown || !el || !node) return;
    node.scrollLeft = el.scrollLeft;
    const onBarScroll = () => {
      if (syncing.current || el.scrollLeft === node.scrollLeft) return;
      syncing.current = true;
      el.scrollLeft = node.scrollLeft;
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    };
    node.addEventListener("scroll", onBarScroll, { passive: true });
    return () => node.removeEventListener("scroll", onBarScroll);
  }, [shown, el]);

  const node =
    placement && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={bar}
            role="scrollbar"
            aria-label={m.table.scrollSideways}
            aria-orientation="horizontal"
            aria-controls={undefined}
            aria-valuenow={0}
            className="fixed bottom-0 z-30 overflow-x-auto overflow-y-hidden"
            style={{ left: placement.left, width: placement.width, height: BAR_HEIGHT }}
          >
            {/* 帯を出すためだけの中身。表と同じ横幅にして、つまみの長さを合わせる */}
            <div style={{ width: placement.scrollWidth, height: 1 }} />
          </div>,
          document.body,
        )
      : null;

  return { attach, node };
}
