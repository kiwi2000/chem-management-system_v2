"use client";

import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { SubstanceDetailDto } from "@/lib/types";
import { useOutsideClose } from "@/lib/use-outside-close";

/**
 * 物質の中身をその場で覗く小窓。右から滑り込んで、裏の表に重なる。
 *
 * 対象CASの一覧から「この番号は本当にこの物質か」を確かめるためのもの。
 * 別の画面へ移ってしまうと、法律 → 区分 → 法文物質名 → 対象CAS と
 * たどってきた道のりが失われ、戻るのに4回選び直すことになる。
 * 重ねるだけにすれば、閉じた瞬間に元の場所へ戻る。
 *
 * 閉じかたは3つ用意する（×・Esc・外側を押す）。
 * 覗くだけのものなので、閉じる手間は限りなく小さくしておく。
 */
export function SubstancePeek({
  substanceId,
  onClose,
}: {
  /** 覗く物質。null なら閉じている */
  substanceId: string | null;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const [item, setItem] = useState<SubstanceDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => onClose(), [onClose]);
  const boxRef = useOutsideClose<HTMLDivElement>(substanceId !== null, close);

  useEffect(() => {
    if (!substanceId) {
      setItem(null);
      return;
    }
    let alive = true;
    setItem(null);
    setError(null);
    void (async () => {
      const res = await fetch(`/api/substances/${substanceId}`).catch(() => null);
      if (!res || !alive) return;
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setError(m.errors.loadFailed(res.status));
        return;
      }
      // 詳細は { item: … } で包まれて返る
      const body = (await res.json()) as { item: SubstanceDetailDto };
      if (alive) setItem(body.item);
    })();
    return () => {
      alive = false;
    };
  }, [substanceId, m]);

  // Esc で閉じる。覗いたまま次の操作に移れないと、かえって手間が増える
  useEffect(() => {
    if (!substanceId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [substanceId, close]);

  if (!substanceId) return null;

  const name = (ja: string | null, en: string | null) =>
    (locale === "ja" ? (ja ?? en) : (en ?? ja)) ?? "";

  return (
    // 画面の右に貼り付ける。裏の表は見えたままにして、どこを見ていたか分かるようにする
    <div
      ref={boxRef}
      role="dialog"
      aria-label={m.substances.detailTitle}
      className="bg-background animate-in slide-in-from-right-8 fade-in fixed top-14 right-0 bottom-0 z-30 flex w-[26rem] max-w-full flex-col border-l shadow-lg duration-200"
    >
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="flex-1 truncate text-sm font-semibold">{m.substances.detailTitle}</h2>
        {item && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            title={m.substances.detailTitle}
            aria-label={m.substances.detailTitle}
            nativeButton={false}
            render={<Link href={`/substances/${item.id}`} target="_blank" />}
          >
            <ExternalLink className="size-4" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={m.common.close}
          aria-label={m.common.close}
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        {!item && !error && <p className="text-muted-foreground">{m.common.loading}</p>}

        {item && (
          <>
            <Row label={m.substances.code}>
              <span className="font-mono">{item.code}</span>
            </Row>
            <Row label={m.substances.casNumber}>
              <span className="font-mono">{item.casNumber ?? ""}</span>
            </Row>
            <Row label={m.substances.mainName}>
              <div>{name(item.mainNameJa, item.mainNameEn)}</div>
              {/* もう一方の言語も出す。同じ物質か確かめるときの手がかりになる */}
              {item.mainNameEn && item.mainNameJa !== item.mainNameEn && (
                <div className="text-muted-foreground text-xs">
                  {locale === "ja" ? item.mainNameEn : item.mainNameJa}
                </div>
              )}
            </Row>

            {(item.subNames?.length ?? 0) > 0 && (
              <Row label={m.substances.subNames}>
                <ul className="space-y-0.5">
                  {item.subNames.map((n, i) => (
                    <li key={i}>{name(n.nameJa, n.nameEn)}</li>
                  ))}
                </ul>
              </Row>
            )}

            <Row label={m.substances.status}>
              {item.status === "ACTIVE"
                ? m.substances.statusActive
                : m.substances.statusDiscontinued}
            </Row>

            {item.note && <Row label={m.substances.note}>{item.note}</Row>}
          </>
        )}
      </div>
    </div>
  );
}

/** 見出しと中身を縦に積む。項目が長くても折り返せるようにする */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="break-words">{children}</div>
    </div>
  );
}
