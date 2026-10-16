"use client";

import type { Locale } from "@chem/shared";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ghsMessages } from "@/lib/ghs/messages";
import { GhsDataTable } from "./ghs-data-table";
import type { GhsLayerMarks } from "./ghs-marks";
import { GhsReleases } from "./ghs-releases";
import { GhsSourceTable } from "./ghs-source-table";

/** 取り込みのタブ。出典のコードと重ならない名前にする */
const IMPORT_TAB = "__import";

/** 選んだ切り替えを端末に覚える */
const TAB_KEY = "chem.ghsData.tab";

/**
 * GHS分類データの切り替え: 「物質」（物質マスタ起点。国の採用順＋自社判定）と、取り込み済みの出典ごとの表、
 * いちばん右に「取り込み」（取り込みの記録。入力欄は管理者だけ。2026-10-16 に別の画面からここへ移した）。
 * メニューは 2 段までなので、3 つ目の階層は画面の中のタブで持つ（2026-09-28 指示）
 */
export function GhsDataTabs({
  locale,
  canEdit,
  isAdmin,
  sources,
  linkLayers,
  importSources,
  marks,
}: {
  locale: Locale;
  canEdit: boolean;
  isAdmin: boolean;
  /** 取り込み済みの出典（1 件も取り込んでいない出典は出さない） */
  sources: { code: string; name: string }[];
  /** 付け外しできる結び付きの層（"LOLI" など） */
  linkLayers: string[];
  /** 取り込める出典（取り込みのタブの入力欄に並べる） */
  importSources: { code: string; name: string }[];
  /** 層の印（法規制の画面と同じ L・U など） */
  marks: GhsLayerMarks;
}) {
  const t = ghsMessages(locale).data;
  const [tab, setTab] = useState("substances");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (
        saved &&
        (saved === "substances" || saved === IMPORT_TAB || sources.some((s) => s.code === saved))
      )
        setTab(saved);
    } catch {
      /* 端末の保存領域が使えないときは「物質」のまま */
    }
  }, [sources]);
  const choose = (code: string) => {
    setTab(code);
    try {
      localStorage.setItem(TAB_KEY, code);
    } catch {
      /* 覚えられなくても動く */
    }
  };
  const tabs = [
    { code: "substances", name: t.tabs.substances },
    ...sources,
    { code: IMPORT_TAB, name: t.tabs.import },
  ];
  const tabClass = (active: boolean) =>
    cn(
      "-mb-px border-b-2 px-3 py-1.5 text-sm",
      active
        ? "border-primary text-primary font-medium"
        : "text-muted-foreground hover:text-foreground border-transparent",
    );
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t.tabs.label} className="flex flex-wrap gap-1 border-b">
        {tabs.map((x) => (
          <button
            key={x.code}
            type="button"
            role="tab"
            aria-selected={tab === x.code}
            className={tabClass(tab === x.code)}
            onClick={() => choose(x.code)}
          >
            {x.name}
          </button>
        ))}
      </div>
      {tab === "substances" ? (
        <>
          <p className="text-muted-foreground text-sm">{t.lead}</p>
          <GhsDataTable
            locale={locale}
            canEdit={canEdit}
            isAdmin={isAdmin}
            linkLayers={linkLayers}
            marks={marks}
          />
        </>
      ) : tab === IMPORT_TAB ? (
        <GhsReleases locale={locale} isAdmin={isAdmin} sources={importSources} />
      ) : (
        <GhsSourceTable
          key={tab}
          locale={locale}
          sourceCode={tab}
          sourceName={sources.find((s) => s.code === tab)?.name ?? tab}
          marks={marks}
        />
      )}
    </div>
  );
}
