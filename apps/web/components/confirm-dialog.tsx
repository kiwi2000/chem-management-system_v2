"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

/**
 * 「本当に消しますか」の確認。
 *
 * **ブラウザ標準の confirm() は使わない。**見た目がアプリと違い、
 * 文言も画面ごとにばらつき、消す対象の件数や戻せるかどうかを揃えて出せない。
 * ここで1つにまとめ、どの画面でも同じ窓・同じ言葉で聞く。
 *
 * 使いかた（呼ぶ側は confirm() と同じ感覚で、答えが返るまで待つ）:
 *
 * ```tsx
 * const ask = useConfirm();
 * if (!(await ask({ message: m.table.deleteSelectedConfirm(n), destructive: true }))) return;
 * ```
 */

export interface ConfirmOptions {
  /** 何をするのかを1文で。件数があれば入れる */
  message: string;
  /** 見出し。省略すると「確認」 */
  title?: string;
  /** 進めるボタンの言葉。省略すると「OK」、destructive なら「削除する」 */
  confirmLabel?: string;
  /** 消す・戻せない操作なら true。進めるボタンが赤くなる */
  destructive?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { m } = useI18n();
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((options) => {
    // 前の問いが残っていたら「いいえ」で閉じる（重ねて出さない）
    resolver.current?.(false);
    setPending(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  };

  const value = useMemo(() => ask, [ask]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog.Root open={pending !== null} onOpenChange={(open) => !open && answer(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <AlertDialog.Popup className="bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-lg ring-1 ring-foreground/10 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <AlertDialog.Title className="text-base font-semibold">
              {pending?.title ?? m.common.confirmTitle}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
              {pending?.message}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => answer(false)} autoFocus>
                {m.common.cancel}
              </Button>
              <Button
                type="button"
                variant={pending?.destructive ? "destructive" : "default"}
                onClick={() => answer(true)}
              >
                {pending?.confirmLabel ?? (pending?.destructive ? m.common.delete : m.common.ok)}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}

/** 確認の窓を出して、答えを待つ。Provider の外で呼ぶと壊れるので、必ず AppShell の中で使う */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm は ConfirmProvider の中で使うこと");
  return ask;
}
