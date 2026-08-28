"use client";

import { useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { LinkSetVersionDto, LinkVersionSourceDto, ListResponse } from "@/lib/types";

/** 表の上に置く選択欄。表の見出しの高さに合わせる */
const SELECT_CLASS = "border-input bg-background h-8 rounded-none border px-2 text-sm";

export interface VersionSource {
  versionId: string;
  sourceId: string;
}

/**
 * バージョンとデータソースを選ぶ欄。
 *
 * **CASを行として持つ表は、どれもこの2つで中身が決まる。**
 * 法規制の対象CASも、インベントリの中身も同じなので、部品を1つにして
 * 置き場所も並びも揃える（画面ごとに違うと、同じことをしているのに迷う）。
 *
 * 順は**バージョンが先、データソースが後**。
 * データソースの選択肢はバージョンごとに違う（`LinkVersionSource`）ので、
 * バージョンが決まらないと出せない。
 *
 * 選べるのは**それぞれ1つだけ**。組み合わせを1つに絞って見る作りにしてある。
 * 複数を混ぜて出すと、同じCASが何行も並んで、どれが効いているのか読めなくなる。
 */
export function VersionSourcePicker({
  value,
  onChange,
  /** 右に添える一言。画面ごとの注意書き */
  hint,
  /**
   * 「合算」の名前。渡すと選択肢のいちばん上に出る。
   * **渡さない画面では出ない。**合算の意味を持たない表もあるため
   */
  mergedLabel,
}: {
  value: VersionSource | null;
  onChange: (next: VersionSource) => void;
  hint?: string;
  mergedLabel?: string;
}) {
  const { m } = useI18n();
  const [versions, setVersions] = useState<LinkSetVersionDto[]>([]);
  const [sources, setSources] = useState<LinkVersionSourceDto[]>([]);

  /*
    バージョンは数が知れているので全部引く。
    **初期値は現在のバージョン。**ふだん見たいのはそれで、
    過去のものは調べるときだけ切り替える
  */
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/link-versions?size=200").catch(() => null);
      if (!res?.ok) return;
      const items = ((await res.json()) as ListResponse<LinkSetVersionDto>).items;
      setVersions(items);
      if (value === null) {
        const current = items.find((v) => v.isCurrent) ?? items[0];
        if (current) onChange({ versionId: current.id, sourceId: "" });
      }
    })();
    // 最初の1回だけ。選び直しは onChange 側で持つ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** そのバージョンに並んでいるデータソースだけを出す（優先度の順） */
  const loadSources = useCallback(
    async (versionId: string, keep: string) => {
      const res = await fetch(`/api/link-version-sources?versionId=${versionId}`).catch(() => null);
      if (!res?.ok) return;
      const items = ((await res.json()) as ListResponse<LinkVersionSourceDto>).items;
      setSources(items);
      /*
        バージョンを切り替えると、いま選んでいるデータソースが
        そのバージョンに無いことがある。無ければ優先度がいちばん高いものへ寄せる
      */
      /*
        合算を出す画面では、**空のままでよい**（空＝合算）。
        出さない画面では、優先度がいちばん高いものへ寄せる
      */
      const stillThere =
        items.some((s) => s.sourceId === keep) || (mergedLabel !== undefined && keep === "");
      const next = stillThere ? keep : (items[0]?.sourceId ?? "");
      if (next !== keep) onChange({ versionId, sourceId: next });
    },
    [onChange, mergedLabel],
  );

  useEffect(() => {
    if (!value?.versionId) return;
    void loadSources(value.versionId, value.sourceId);
    // データソースの選び直しだけでは引き直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.versionId]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="vs-version" className="text-muted-foreground text-xs">
        {m.casLinks.version}
      </Label>
      <select
        id="vs-version"
        value={value?.versionId ?? ""}
        onChange={(e) => onChange({ versionId: e.target.value, sourceId: value?.sourceId ?? "" })}
        className={SELECT_CLASS}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.code}
            {v.isCurrent ? ` (${m.casLinks.currentVersion})` : ""}
          </option>
        ))}
      </select>

      <Label htmlFor="vs-source" className="text-muted-foreground text-xs">
        {m.casLinks.source}
      </Label>
      <select
        id="vs-source"
        value={value?.sourceId ?? ""}
        onChange={(e) => onChange({ versionId: value?.versionId ?? "", sourceId: e.target.value })}
        className={SELECT_CLASS}
        // このバージョンに1つも並んでいなければ選びようがない
        disabled={sources.length === 0}
      >
        {/* 合算はいちばん上。ふだん見たいのは、優先度で解いたあとの結果 */}
        {mergedLabel !== undefined && <option value="">{mergedLabel}</option>}
        {sources.length === 0 && mergedLabel === undefined && (
          <option value="">{m.casLinks.noSourceInVersion}</option>
        )}
        {sources.map((s) => (
          <option key={s.sourceId} value={s.sourceId}>
            {s.sourceCode}
          </option>
        ))}
      </select>

      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}
