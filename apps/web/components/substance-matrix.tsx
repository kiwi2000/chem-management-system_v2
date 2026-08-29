"use client";

import { ChevronRight, FoldVertical, UnfoldVertical } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { CELL_CLIP, OPAQUE_MUTED_40, OPAQUE_MUTED_50 } from "@/components/ui/table";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";
import type { MatrixColumn, MatrixValue, SubstanceMatrix } from "@/lib/substance-matrix";
import { cn } from "@/lib/utils";

/**
 * 物質1件を、バージョンを横に並べて見る表。
 *
 * インベントリの番号と、当たっている法規制を**同じ形**で出す。
 * 見たいのは「前のバージョンから変わったかどうか」なので、
 * 現在のバージョンと1つ前が隣り合う並びにしてある。
 *
 * 列は3段。
 *
 * ```
 * 地域        国内                        EU
 * 種類        化審法番号     安衛法番号    EC番号
 * バージョン  2026Q3 2026Q2  2026Q3 …     2026Q3 …
 * ```
 *
 * **地域でまとめて畳める。**国内だけ見たい、というときに横に伸びすぎないため。
 * 値が複数あるセルは行に割る。**無いところはハイフン**で、
 * 「まだ入れていない」のか「載っていない」のかを取り違えないようにする。
 */

/**
 * 見出しの文字を、セルの幅で切る入れ物。
 *
 * 切るのは**中身だけ**。セルそのものを `overflow-hidden` にすると、
 * 境目をまたいで置いた列幅のつまみまで切り取られて掴めなくなる。
 */
function Clip({ children }: { children: ReactNode }) {
  return <span className="block overflow-hidden text-ellipsis">{children}</span>;
}

/** 選んだデータソースの値。目立たせて、他と見分けられるようにする */
const HIT = "bg-primary/15";

function ValueCell({
  values,
  row,
  sourceId,
}: {
  values: MatrixValue[];
  row: number;
  sourceId: string | null;
}) {
  const v = values[row];
  if (!v) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "block overflow-hidden px-1 text-ellipsis",
        sourceId && v.sourceId === sourceId && HIT,
      )}
      title={v.note ?? v.text}
    >
      {v.text}
    </span>
  );
}

/**
 * 1つの表（インベントリ、または法規制）。
 *
 * 列の段は最大4つ。
 *
 * ```
 * 地域        国内                                    ← 畳める
 * 法律        化審法            安衛法                 ← 畳める（parentHeader を渡したときだけ）
 * 区分        第一種特定  …     表示対象物質  …
 * バージョン  2026Q3 2026Q2     2026Q3 2026Q2
 * ```
 *
 * **法律の段は、渡されたときだけ出す。**インベントリでは、種類の名前
 * （化審法番号）と親の名前（ENCS（化審法））がほとんど同じことを言うので、
 * 段を足すと同じ言葉が2回並ぶだけになる。
 */
function Matrix({
  title,
  columns,
  cells,
  versions,
  sourceId,
  emptyMessage,
  /** 中段（法律）の見出し。渡さなければ中段そのものを出さない */
  parentHeader,
  /** 列幅を端末に覚えるための鍵。表ごとに分ける */
  storageKey,
}: {
  title: string;
  columns: MatrixColumn[];
  cells: Record<string, MatrixValue[]>;
  versions: SubstanceMatrix["versions"];
  sourceId: string | null;
  emptyMessage: string;
  parentHeader?: string;
  storageKey: string;
}) {
  const { m } = useI18n();
  /** 畳んでいる地域と法律。既定はすべて開いている */
  const [foldedRegions, setFoldedRegions] = useState<Set<string>>(new Set());
  const [foldedParents, setFoldedParents] = useState<Set<string>>(new Set());

  /**
   * 地域 → 法律 → 列 の入れ子にする。
   *
   * **同じ地域・同じ法律は必ず1つのまとまりにする。**隣り合っているものだけを
   * 束ねると、列の並びによっては同じものが2つ3つに割れる。
   * 割れると、畳む印はIDで持っているのに見た目が食い違う。
   */
  const regions = useMemo(() => {
    const byRegion = new Map<
      string,
      {
        id: string;
        name: string;
        groups: Map<string, { key: string; label: string; columns: MatrixColumn[] }>;
      }
    >();
    for (const c of columns) {
      let r = byRegion.get(c.regionId);
      if (!r) {
        r = { id: c.regionId, name: c.regionName, groups: new Map() };
        byRegion.set(c.regionId, r);
      }
      // 中段を出さないときは、地域まるごとを1つのまとまりとして扱う
      const gk = parentHeader ? c.parentKey : `${c.regionId}/all`;
      const g = r.groups.get(gk);
      if (g) g.columns.push(c);
      else r.groups.set(gk, { key: gk, label: c.parentLabel, columns: [c] });
    }
    return [...byRegion.values()].map((r) => ({ ...r, groups: [...r.groups.values()] }));
  }, [columns, parentHeader]);

  /**
   * いちばん値の多いセルに合わせて行数を決める。最低1行。
   *
   * **数えるのは見えている列だけ。**畳んだ列まで数えると、
   * 何も出ていないのに空の行が何本も残って、表が間延びする
   */
  const rowCount = useMemo(() => {
    let n = 1;
    for (const c of columns) {
      if (foldedRegions.has(c.regionId)) continue;
      if (parentHeader && foldedParents.has(c.parentKey)) continue;
      for (const v of versions) n = Math.max(n, (cells[`${c.key}/${v.id}`] ?? []).length);
    }
    return n;
  }, [columns, versions, cells, foldedRegions, foldedParents, parentHeader]);

  const toggle = (set: Set<string>, put: (next: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    put(next);
  };

  /** 畳んだときは1列に潰れる。開いていれば配下のぶんだけ広がる */
  const groupSpan = (g: { key: string; columns: MatrixColumn[] }) =>
    foldedParents.has(g.key) ? 1 : g.columns.length * versions.length;
  const regionSpan = (r: (typeof regions)[number]) =>
    foldedRegions.has(r.id) ? 1 : r.groups.reduce((n, g) => n + groupSpan(g), 0);
  /** その地域に何列あるか（畳んだときの件数表示に使う） */
  const regionCols = (r: (typeof regions)[number]) =>
    r.groups.reduce((n, g) => n + g.columns.length, 0);

  /*
    畳んだ列の幅。**地域名が1行で収まるだけ**取る。
    足りないと見出しが折り返し、その行だけ背が高くなって段がそろわない
  */
  const FOLDED_WIDTH = 116;
  /*
    どの段も同じ高さにする。
    `h-8` で最低の高さをそろえ、`whitespace-nowrap` で折り返しを止める。
    畳んだときは中身の無いセルが並ぶので、これが無いと薄い帯になって並びが崩れる
  */
  /*
    セルそのものは**はみ出しを切らない。**切ると、境目をまたいで置いた
    つまみまで切り取られて掴めなくなる。長い文字は中の `Clip` で切る
  */
  const TH = "border-border h-8 border px-2 py-1 whitespace-nowrap";

  /*
    **幅を持つのは、実際に描いている列だけ。**
    畳むと列が1つに潰れるので、開いているぶんだけを並べて数を合わせる。
    畳んだ列にも鍵を与えておき、開き直したときに前の幅へ戻るようにする。
    列の数が中身で増えるので詰めない（`shrinkToFit: false`）。
    詰める側だと列が増えるほど細くなり、見出しが読めなくなる
  */
  const sizing: { key: string; width: number }[] = [{ key: "head", width: 96 }];
  for (const r of regions) {
    if (foldedRegions.has(r.id)) {
      sizing.push({ key: `fold:${r.id}`, width: FOLDED_WIDTH });
      continue;
    }
    for (const g of r.groups) {
      if (foldedParents.has(g.key)) {
        sizing.push({ key: `fold:${g.key}`, width: FOLDED_WIDTH });
        continue;
      }
      for (const c of g.columns) {
        for (const v of versions) sizing.push({ key: `${c.key}/${v.id}`, width: 160 });
      }
    }
  }
  const cols = useResizableColumns(storageKey, sizing, { shrinkToFit: false });

  /*
    **上の段からも掴めるようにする。**
    つまみが最下段（バージョン）にしかないと、高さが1行ぶんしかなく、
    上の段の境目を引こうとして空振りする。
    まとまりの右端は、その中の**いちばん右の列**の境目と同じなので、
    そこにも同じつまみを置く。
  */
  const lastVersion = versions[versions.length - 1]!;
  const keyOfColumn = (c: MatrixColumn) => `${c.key}/${lastVersion.id}`;
  const keyOfGroup = (g: { key: string; columns: MatrixColumn[] }) =>
    foldedParents.has(g.key) ? `fold:${g.key}` : keyOfColumn(g.columns[g.columns.length - 1]!);
  const keyOfRegion = (r: (typeof regions)[number]) =>
    foldedRegions.has(r.id) ? `fold:${r.id}` : keyOfGroup(r.groups[r.groups.length - 1]!);

  if (columns.length === 0) {
    // 列が無ければ畳むものも無い。ボタンは出さない
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-sm">{emptyMessage}</p>
      </div>
    );
  }

  /** 畳んだしるし。矢印の向きで開閉が分かる */
  const foldButton = (open: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="hover:text-foreground inline-flex items-center gap-1 text-left"
    >
      <ChevronRight
        className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        aria-hidden
      />
      {label}
    </button>
  );

  /** 地域も法律も、まとめて開く・閉じる。1つずつ押すのは手間なので */
  const allRegionIds = regions.map((r) => r.id);
  const allGroupKeys = regions.flatMap((r) => r.groups.map((g) => g.key));
  const anyFolded = foldedRegions.size > 0 || foldedParents.size > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {/* 他の表と同じ形。見出しから少し離して置く */}
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            title={m.composition.expandAll}
            aria-label={m.composition.expandAll}
            disabled={!anyFolded}
            onClick={() => {
              setFoldedRegions(new Set());
              setFoldedParents(new Set());
            }}
          >
            <UnfoldVertical className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            title={m.composition.collapseAll}
            aria-label={m.composition.collapseAll}
            disabled={foldedRegions.size === allRegionIds.length}
            onClick={() => {
              setFoldedRegions(new Set(allRegionIds));
              setFoldedParents(new Set(allGroupKeys));
            }}
          >
            <FoldVertical className="size-4" />
          </Button>
        </div>
      </div>
      {/*
        列が多いので、表の中だけ横に流す（画面ごと横に伸ばさない）。
        行も箱の中で送る。そうしないと、横のスクロールバーへ届くころには
        見出しが画面から消えている
      */}
      <div ref={cols.scrollerRef} className="max-h-[70vh] overflow-auto">
        {/* 切れているセルにマウスを置いたとき、中身を全部出す吹き出し */}
        {cols.peek}
        <table
          {...cols.tableProps}
          className={cn(
            "border-border table-fixed border-collapse border text-xs",
            CELL_CLIP,
            cols.tableProps.className,
          )}
        >
          <colgroup>{cols.cols()}</colgroup>
          {/* 見出しは箱の上に貼り付ける。下の行が透けないよう、色は不透明にする */}
          <thead className="sticky top-0 z-20">
            {/* 1段目：地域 */}
            <tr className={OPAQUE_MUTED_50}>
              <th className={cn(TH, "sticky left-0 z-10 bg-inherit text-left")}>
                {m.substanceMatrix.region}
              </th>
              {regions.map((r) => (
                <th
                  key={r.id}
                  colSpan={regionSpan(r)}
                  className={cn(TH, "relative text-left font-medium")}
                  title={r.name}
                >
                  <Clip>
                    {foldButton(!foldedRegions.has(r.id), r.name, () =>
                      toggle(foldedRegions, setFoldedRegions, r.id),
                    )}
                  </Clip>
                  {cols.handle(keyOfRegion(r), `${r.name} ${m.table.resize}`)}
                </th>
              ))}
            </tr>

            {/* 2段目：法律。渡されたときだけ出す */}
            {parentHeader && (
              <tr className={OPAQUE_MUTED_40}>
                <th className={cn(TH, "sticky left-0 z-10 bg-inherit text-left")}>
                  {parentHeader}
                </th>
                {regions.map((r) =>
                  foldedRegions.has(r.id) ? (
                    <th key={r.id} className={cn(TH, "text-muted-foreground")}>
                      {m.substanceMatrix.folded(regionCols(r))}
                    </th>
                  ) : (
                    r.groups.map((g) => (
                      <th
                        key={g.key}
                        colSpan={groupSpan(g)}
                        className={cn(TH, "relative text-left font-medium")}
                        title={g.label}
                      >
                        <Clip>
                          {foldButton(!foldedParents.has(g.key), g.label, () =>
                            toggle(foldedParents, setFoldedParents, g.key),
                          )}
                        </Clip>
                        {cols.handle(keyOfGroup(g), `${g.label} ${m.table.resize}`)}
                      </th>
                    ))
                  ),
                )}
              </tr>
            )}

            {/* 3段目：番号の種類（または規制区分） */}
            <tr className="bg-muted/30">
              <th className={cn(TH, "sticky left-0 z-10 bg-inherit")} />
              {regions.map((r) =>
                foldedRegions.has(r.id) ? (
                  <th key={r.id} className={cn(TH, "text-muted-foreground")}>
                    {/* 中段が無いときは、ここで件数を伝える */}
                    {parentHeader ? "" : m.substanceMatrix.folded(regionCols(r))}
                  </th>
                ) : (
                  r.groups.map((g) =>
                    foldedParents.has(g.key) ? (
                      <th key={g.key} className={cn(TH, "text-muted-foreground")}>
                        {m.substanceMatrix.folded(g.columns.length)}
                      </th>
                    ) : (
                      g.columns.map((c) => (
                        <th
                          key={c.key}
                          colSpan={versions.length}
                          className={cn(TH, "relative text-left font-medium")}
                          title={`${c.parentLabel}（${c.countryName}）`}
                        >
                          <Clip>{c.label}</Clip>
                          {cols.handle(keyOfColumn(c), `${c.label} ${m.table.resize}`)}
                        </th>
                      ))
                    ),
                  )
                ),
              )}
            </tr>

            {/* 4段目：バージョン。左が現在 */}
            <tr className="bg-muted/10">
              <th className={cn(TH, "sticky left-0 z-10 bg-inherit text-left relative")}>
                {m.casLinks.version}
                {cols.handle("head", `${m.casLinks.version} ${m.table.resize}`)}
              </th>
              {regions.map((r) =>
                foldedRegions.has(r.id) ? (
                  <th key={r.id} className={TH} />
                ) : (
                  r.groups.map((g) =>
                    foldedParents.has(g.key) ? (
                      <th key={g.key} className={TH} />
                    ) : (
                      g.columns.map((c) =>
                        versions.map((v) => (
                          <th
                            key={`${c.key}/${v.id}`}
                            className={cn(TH, "text-muted-foreground relative font-normal")}
                          >
                            {v.code}
                            {/* 幅を持つのはこの段。ここを引くと列が広がる */}
                            {cols.handle(
                              `${c.key}/${v.id}`,
                              `${c.label} ${v.code} ${m.table.resize}`,
                            )}
                          </th>
                        )),
                      )
                    ),
                  )
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <tr key={row}>
                <td className={cn(TH, "bg-background sticky left-0 z-10")} />
                {regions.map((r) =>
                  foldedRegions.has(r.id) ? (
                    <td key={r.id} className={TH} />
                  ) : (
                    r.groups.map((g) =>
                      foldedParents.has(g.key) ? (
                        <td key={g.key} className={TH} />
                      ) : (
                        g.columns.map((c) =>
                          versions.map((v) => (
                            <td
                              key={`${c.key}/${v.id}`}
                              className="border-border h-8 border px-1 py-1 font-mono whitespace-nowrap"
                            >
                              <ValueCell
                                values={cells[`${c.key}/${v.id}`] ?? []}
                                row={row}
                                sourceId={sourceId}
                              />
                            </td>
                          )),
                        )
                      ),
                    )
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * インベントリと該当法規を、1つの選択（データソース）で見る。
 * どちらも同じバージョンで並ぶので、選ぶところは1つにまとめてある。
 */
export function SubstanceMatrixSection({ data }: { data: SubstanceMatrix }) {
  const { m } = useI18n();
  /** 目立たせるデータソース。押すとすぐ切り替わる */
  const [sourceId, setSourceId] = useState<string | null>(data.sources[0]?.id ?? null);
  /** インベントリを全部出すか、番号として出しているものだけにするか */
  const [allInventories, setAllInventories] = useState(false);

  const invColumns = useMemo(
    () => (allInventories ? data.inventory.columns : data.inventory.columns.filter((c) => c.shown)),
    [allInventories, data.inventory.columns],
  );

  if (data.versions.length === 0) return null;

  return (
    /*
      2つの表とデータソースの選びかたで1つの札にする。
      データソースの選択は**両方の表に効く**ので、表ごとに分けると
      どちらに効いているのか分からなくなる
    */
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">{m.inventories.source}</span>
          {/* ボタンを並べる。押した瞬間に色が変わり、表の目立たせ方が切り替わる */}
          {data.sources.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={s.id === sourceId ? "default" : "outline"}
              onClick={() => setSourceId(s.id)}
            >
              {s.code}
            </Button>
          ))}
          <label className="text-muted-foreground ml-2 flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={allInventories}
              onChange={(e) => setAllInventories(e.target.checked)}
            />
            {m.substanceMatrix.showAllInventories}
          </label>
        </div>

        <Matrix
          title={m.substanceMatrix.inventoryTitle}
          columns={invColumns}
          cells={data.inventory.cells}
          versions={data.versions}
          sourceId={sourceId}
          emptyMessage={m.substanceMatrix.inventoryEmpty}
          storageKey="chem.table.substanceInventory"
        />
        <Matrix
          title={m.substanceMatrix.regulationTitle}
          columns={data.regulation.columns}
          cells={data.regulation.cells}
          versions={data.versions}
          sourceId={sourceId}
          emptyMessage={m.substanceMatrix.regulationEmpty}
          parentHeader={m.laws.title}
          storageKey="chem.table.substanceRegulation"
        />
      </CardContent>
    </Card>
  );
}
