"use client";

import type { GazetteLawKind } from "@chem/shared";
import { useI18n } from "@/lib/i18n-client";

/**
 * 官報公示整理番号を1セルに並べる。
 * 区分ごとに列を分けると横に広がるので、1列の中で改行し、
 * 先頭に区分の1文字（化 / 安 / 他）を付けて見分けられるようにする。
 */
export function GazetteNumbers({
  items,
}: {
  items: { lawKind: GazetteLawKind; number: string }[];
}) {
  const { m } = useI18n();
  if (items.length === 0) return <span className="text-muted-foreground text-xs">—</span>;

  return (
    <span className="flex flex-col gap-0.5 font-mono text-xs">
      {items.map((g, i) => (
        <span key={i} title={`${m.substances.lawKinds[g.lawKind]} ${g.number}`}>
          <span className="text-muted-foreground mr-1">
            {m.substances.lawKindsShort[g.lawKind]}
          </span>
          {g.number}
        </span>
      ))}
    </span>
  );
}
