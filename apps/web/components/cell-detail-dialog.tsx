"use client";

import { pickName, pickStatutoryName } from "@chem/shared";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SourceChip } from "@/components/source-chip";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { CellDetailDto, CellStatutoryDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 分類＋番号＋法文物質名。分類や番号を持たないものは詰める */
function labelOf(x: CellStatutoryDto, locale: ReturnType<typeof useI18n>["locale"]) {
  const cls = pickStatutoryName(locale, x.classNameOriginal, x.classNameJa, x.classNameEn);
  const name = pickStatutoryName(locale, x.nameOriginal, x.nameJa, x.nameEn);
  return [cls, x.officialNumber, name].filter(Boolean).join(" ");
}

/**
 * まとめ表のセルを押したときに開く窓。
 *
 * **1つの CAS × 1つの規制区分だけを見る。**軸を2つに減らさないと、
 * バージョン × データソース × 区分 × 物質の4つが同時に並んで読めない。
 *
 * バージョンを横に並べ、その下にデータソースを縦に並べる。
 * **並びはバージョンごとに違う**ので、左右で行の高さは揃わない。
 * 揃えようとすると、優先度が変わったことが見えなくなる。
 */
export function CellDetailDialog({
  cas,
  categoryId,
  onClose,
}: {
  cas: string;
  categoryId: string;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<CellDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const params = new URLSearchParams({ cas, categoryId });
      const res = await fetch(`/api/statutory-cas-links/cell?${params.toString()}`).catch(
        () => null,
      );
      if (!res || !alive) return;
      if (redirectIfUnauthorized(res)) return;
      if (!res.ok) {
        setError(m.errors.loadFailed(res.status));
        return;
      }
      setData((await res.json()) as CellDetailDto);
    })();
    return () => {
      alive = false;
    };
  }, [cas, categoryId, m]);

  // 逃げ道は必ず用意する。表の上に重なるので、閉じられないと詰む
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={m.composition.cellDetailTitle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background flex max-h-[85vh] w-full max-w-4xl flex-col rounded-md border shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{m.composition.cellDetailTitle}</p>
            {data && (
              <>
                {/* 見出しは物質ID・CAS・物質名。何を見ているかを最初に置く */}
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground font-mono text-xs">
                    {data.substanceCode ?? "—"}
                  </span>
                  <span className="text-muted-foreground mx-2 font-mono text-xs">{data.cas}</span>
                  <span>{pickName(locale, data.substanceNameJa, data.substanceNameEn)}</span>
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {pickStatutoryName(locale, data.lawNameOriginal, data.lawNameJa, data.lawNameEn)}
                  {" › "}
                  {pickStatutoryName(
                    locale,
                    data.categoryNameOriginal,
                    data.categoryNameJa,
                    data.categoryNameEn,
                  )}
                </p>
              </>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onClose}
            aria-label={m.common.close}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && <p className="text-destructive text-sm">{error}</p>}
          {!error && !data && <p className="text-muted-foreground text-sm">{m.common.loading}</p>}
          {data && (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.versions.map((v) => (
                <div key={v.code} className="min-w-0">
                  <p className="mb-2 text-sm font-medium">
                    {v.code}
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      {v.isCurrent ? m.composition.cellDetailCurrent : m.composition.cellDetailPast}
                    </span>
                  </p>
                  {v.sources.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {m.composition.cellDetailNoSources}
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {v.sources.map((s) => (
                        <li key={s.id} className="flex gap-1.5 text-xs">
                          <SourceChip source={s} className="mt-0.5" />
                          <span className="min-w-0 flex-1 break-words">
                            {s.items.length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              s.items.map((x) => (
                                <span
                                  key={`${x.officialNumber}/${x.nameOriginal}`}
                                  /* 採用されたものは赤字。どれが効いたのかを一目で読む */
                                  className={cn("block", x.adopted && "text-destructive font-bold")}
                                >
                                  {labelOf(x, locale)}
                                </span>
                              ))
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-muted-foreground border-t px-4 py-2 text-xs">
          {m.composition.cellDetailHint}
        </p>
      </div>
    </div>,
    document.body,
  );
}
