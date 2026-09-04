"use client";

import { pickName, pickStatutoryName } from "@chem/shared";
import { CircleHelp, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SourceChip } from "@/components/source-chip";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { HIT_CLASS, NEAR_MISS_CLASS, NOT_ADOPTED_CLASS, REVIEW_CLASS } from "@/lib/mark-styles";
import type { CellDetailDto, CellStatutoryDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 分類＋番号＋法文物質名。分類や番号を持たないものは詰める */
function labelOf(x: CellStatutoryDto, locale: ReturnType<typeof useI18n>["locale"]) {
  const cls = pickStatutoryName(locale, x.classNameOriginal, x.classNameJa, x.classNameEn);
  const name = pickStatutoryName(locale, x.nameOriginal, x.nameJa, x.nameEn);
  return [cls, x.officialNumber, name].filter(Boolean).join(" ");
}

/** 出どころの文章。画面の言語で選ぶ（日本語訳があれば日本語、無ければ原文） */
function dataOf(x: CellStatutoryDto, locale: ReturnType<typeof useI18n>["locale"]) {
  return locale === "ja" ? (x.dataTextJa ?? x.dataText) : x.dataText;
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
  productId,
  showNearMiss,
  onClose,
}: {
  cas: string;
  categoryId: string;
  /** その製品の判定を見て、当たり・要確認・含有率不足を分ける */
  productId: string;
  /**
   * 含有率不足で当たっていないものを出すか。
   * **表のボタンに従う。**表では隠れているのに窓にだけ出ると、数が合わなく見える
   */
  showNearMiss: boolean;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<CellDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const params = new URLSearchParams({ cas, categoryId, productId });
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
  }, [cas, categoryId, productId, m]);

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
                {/* 地域 › 国 › 法律 › 規制区分。どこの何の話かを、上から順にたどれるようにする */}
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {[
                    pickName(locale, data.regionNameJa, data.regionNameEn),
                    pickName(locale, data.countryNameJa, data.countryNameEn),
                    pickStatutoryName(locale, data.lawNameOriginal, data.lawNameJa, data.lawNameEn),
                    pickStatutoryName(
                      locale,
                      data.categoryNameOriginal,
                      data.categoryNameJa,
                      data.categoryNameEn,
                    ),
                  ]
                    .filter(Boolean)
                    .join(" › ")}
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
                      {v.sources.map((s) => {
                        /*
                          含有率不足のものは、表のボタンが押されているときだけ出す。
                          隠すと何も残らないデータソースは「—」になる
                        */
                        const items = s.items.filter((x) => showNearMiss || !x.nearMiss);
                        return (
                          <li key={s.id} className="space-y-0.5 text-xs">
                            {/*
                              **印は法文物質名の1行ごとに付ける。**表のセルと同じ付けかた。
                              データソースごとにまとめて1つだけ付けていたころは、
                              表と数が合わず、どの行がどのデータのものか読み取りにくかった
                            */}
                            {items.length === 0 ? (
                              <span className="flex gap-1.5">
                                <SourceChip source={s} className="mt-0.5" />
                                <span className="text-muted-foreground">—</span>
                              </span>
                            ) : (
                              items.map((x) => (
                                <span
                                  key={`${x.officialNumber}/${x.nameOriginal}`}
                                  className="flex gap-1.5"
                                >
                                  <SourceChip source={s} className="mt-0.5" />
                                  <span
                                    /*
                                      **色は結果、太字は採用。**
                                      青＝該当、オレンジ＝含有率不足で非該当、黒＝採用されなかった。
                                      青と三角が同じ行に並ぶと「採用されたのに非該当」に読めるので、
                                      色を勝ち負けに使わない
                                    */
                                    className={cn(
                                      "min-w-0 flex-1 break-words",
                                      x.adopted && "font-bold",
                                      x.adopted
                                        ? x.hit
                                          ? HIT_CLASS
                                          : NEAR_MISS_CLASS
                                        : NOT_ADOPTED_CLASS,
                                    )}
                                  >
                                    {/* 印は表と同じもの。?＝要確認、三角＝含有率不足 */}
                                    {x.needsReview && (
                                      <CircleHelp
                                        className={cn(
                                          "mr-0.5 inline size-3 align-[-0.1em]",
                                          REVIEW_CLASS,
                                        )}
                                      />
                                    )}
                                    {x.nearMiss && (
                                      <TriangleAlert
                                        className={cn(
                                          "mr-0.5 inline size-3 align-[-0.1em]",
                                          NEAR_MISS_CLASS,
                                        )}
                                      />
                                    )}
                                    {labelOf(x, locale)}
                                    {/* 出どころの文章。ここでは切らずに全部出す（表では1行で切っている） */}
                                    {dataOf(x, locale) && (
                                      <span className="text-muted-foreground block font-normal whitespace-pre-wrap">
                                        {dataOf(x, locale)}
                                      </span>
                                    )}
                                  </span>
                                </span>
                              ))
                            )}
                          </li>
                        );
                      })}
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
