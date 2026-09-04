"use client";

import { pickName, pickStatutoryName } from "@chem/shared";
import { ChevronDown, ChevronRight, CircleHelp, TriangleAlert } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CELL_CLIP, OPAQUE_MUTED_40, OPAQUE_MUTED_50 } from "@/components/ui/table";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CellDetailDialog } from "@/components/cell-detail-dialog";
import { DiffChip, SourceChips, type SourceInfo } from "@/components/source-chip";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { useColumnVisibility } from "@/lib/use-column-visibility";
import { NEAR_MISS_CLASS, REVIEW_CLASS } from "@/lib/mark-styles";
import type {
  ApiError,
  CompositionAggregateDto,
  RowRegulationDto,
  RowStatutoryDto,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * CASでまとめた組成。
 *
 * 原材料は末端の物質まで下ろされ、同じCAS番号のものは1行にまとまっている。
 * 法規制の判定に使うのはこの値なので、計算はサーバー側で行い、ここは出すだけにする
 * （画面で組み立てると、判定と表示で別々の計算になってしまう）。
 *
 * 寄与元が複数ある行だけ押して開ける。名称は、そのCASの代表物質から取っている。
 */

/** 長い語もセルの中で折り返す。折り返せないものは CELL_CLIP で隠れる */
const CELL = "border-r px-2 py-1 break-words last:border-r-0";

/**
 * 左に貼り付ける列の数。CAS・物質ID・物質名・重量%・スコア・備考まで（組成そのものの列は全部）。
 *
 * 法規制の列は地域を分けるとどこまでも右へ伸びるので、
 * 横に送ると**いま見ている行がどの物質のものか分からなくなる**。
 * 貼り付ける幅は合わせて956px。画面が狭いと法規制を見る場所が減るので、
 * 引いて広げるほうは `frozen` の上限（見えている幅の6割）で止まる。
 */
/** 組成そのものの列（CAS〜備考）の鍵 */
type HeadKey = "casNumber" | "substanceId" | "name" | "contentPct" | "score" | "note";

/**
 * 当たってはいないが、CAS が載っているものに付ける印。
 *
 * **赤字だけでは足りない。**この表の赤字には、もとから「確認が残っている」という
 * 意味がある（下の法規制判定の表と同じ色）。同じ色のまま増やすと、
 * 「人が見なければいけないもの」と「配合が変われば当たるもの」を取り違える
 */
function NearMark() {
  return <TriangleAlert className="mr-0.5 inline size-3 align-[-0.1em]" aria-hidden />;
}

/**
 * 判定に確認が残っているものに付ける印。**「?」の丸。**
 *
 * 「この判定は変わるかもしれない、正しくないかもしれない」という意味。
 * 三角は**含有率不足**のほうで使っているので、同じ形にすると取り違える。
 *
 * **下の法規制判定の表と同じ印にする。**同じことを2か所で別の印にすると、
 * 同じものだと分からない。
 *
 * 数字ごと赤くしていたころは「当たった7件のうち何件が要確認か」が読めなかった。
 * 印と件数を分けて出す
 */
function ReviewMark() {
  return <CircleHelp className="mr-0.5 inline size-3 align-[-0.1em]" aria-hidden />;
}

/*
  貼り付けた列の背景。**透けさせない。**
  透けると、下を流れていく法規制の列が透けて見える。
  行の色（`bg-muted/40` など）と同じ色を、透けない形で作る
*/
const STICKY_PLAIN = "bg-background";

/*
  見出しの罫線。**貼り付けた見出しは枠線が描かれない**（`border-collapse` の表で
  sticky にすると線が消える）ので、影で線を引く。
  見出しは4段あるので、右だけでなく**下にも**線を引いて、全部のセルを囲う
*/
const HEAD_GRID = [
  "shadow-[inset_0_1px_0_0_var(--border)]",
  "[&_th]:shadow-[inset_-1px_-1px_0_0_var(--border)]",
].join(" ");

/** 行を指す鍵。CASを持たない物質は自分のコードで区別する */
const keyOf = (row: { casNumber: string | null; code: string }) => row.casNumber ?? row.code;

interface Props {
  productId: string;
  /** 開いている行。見出しの「展開」「閉じる」から操るので、状態は親が持つ */
  open: Set<string>;
  onOpenChange: (next: Set<string>) => void;
  /** 開ける行の鍵。親がボタンを出すかどうかの判断に使う */
  onExpandableChange: (keys: string[]) => void;
  /**
   * **CAS は載っているのに当たっていない**法文物質名を、赤字で出すか。
   * 出すあいだは、そのためだけの区分も列に加わる（切ると元の列に戻る）
   */
  showNearMiss?: boolean;
  /** 判定に使われたデータソースの印を、セルの先頭に出すか */
  showSources?: boolean;
  /** 前のバージョンに無かったものに印を付けるか */
  showDiff?: boolean;
  /** 比べた相手のバージョンを親へ返す（ボタンの説明に使う） */
  onPreviousVersionChange?: (code: string | null) => void;
  /** 読み込んだデータソースの並びを親へ返す（札に出すため） */
  onSourcesChange?: (sources: SourceInfo[]) => void;
}

/**
 * 列の並びと既定の幅。
 *
 * 「かかる法規制」は**目印**なので、物質名より狭くてよい。
 * 規制の中身は下の判定表が受け持つ。
 */
const HEADS: {
  key: string;
  width: number;
  label: (m: ReturnType<typeof useI18n>["m"]) => string;
  className?: string;
}[] = [
  // CAS番号は最長12桁（1001756-09-7）。等幅の小さい文字でこの幅に収まる
  { key: "casNumber", width: 104, label: (m) => m.composition.casNumber },
  { key: "substanceId", width: 96, label: (m) => m.composition.aggregateSubstanceId },
  { key: "name", width: 256, label: (m) => m.composition.aggregateName },
  {
    key: "contentPct",
    /*
      **この列に入りうるいちばん長い値が、隠れずに収まる幅。**
      含有率は小数第6位まで持つので、最長は「100.000001%」の87px。
      左右の余白16pxを足すと103px。画面の拡大表示（125%まで）でも欠けないよう、
      120px を既定にする（72px・88px・104px では環境によって末尾の「%」が欠けた）
    */
    width: 120,
    label: (m) => m.composition.contentPct,
    className: "text-right whitespace-nowrap",
  },
  /*
    物質のスコア。**重量%の右に置く。**当たっている規制区分の点数の合計で、
    組成とは関係しない値だが、物質ごとの重みを重量%と並べて読めるようにする
  */
  {
    key: "score",
    /*
      **見出しの「スコア」がちょうど収まる幅。**14pxの全角3文字で42px、
      左右の余白16pxを足して58px。値のほうは短い数字なので、これで足りる。
      桁の多い点を付けたときは、つまみで引いて広げられる
    */
    width: 60,
    label: (m) => m.score.substanceScore,
    className: "text-right whitespace-nowrap",
  },
  /*
    上の組成表を出さない組成があるので、備考はこちらでも受け持つ。
    **2行で切る。**仕入れ先や但し書きが長く入ることがあり、
    行の高さがそこだけ伸びて表が読みにくくなる。
    切れたセルは押せば全部出る（`cell-peek`）
  */
  { key: "note", width: 320, label: (m) => m.composition.note },
];

/**
 * 該当法規制の列。**地域でまとめておき、押すと規制区分ごとに分かれる。**
 *
 * この製品で該当している区分だけを列にする。全区分を並べると、
 * ほとんど空の列が延々と続いて、どこに印が付いているのか読めなくなる。
 *
 * 押していないあいだは地域が1列（国内・国際）。
 * 押すと、その地域の該当区分の数だけ列に分かれ、地域名のあった場所が区分名になる。
 */
/**
 * 見出しの文字が入るのに要る幅（px）。
 *
 * 法規の列は**見出しが地域名や区分名になるので、長さが読むまで分からない**。
 * 決め打ちの幅にすると、短い地域は余り、長い地域は切れる（「EU加盟国」が
 * 「EU加…」になっていた）。
 *
 * 実際に描くのと同じ字で測る。字が読み込まれる前や、画面が無いところでは
 * 測れないので、そのときは1文字ぶんの目安で数える。**測った値と目安の広いほう**を
 * 使い、足りずに切れることのないようにする。
 */
const TEXT_SIZER = (() => {
  let ctx: CanvasRenderingContext2D | null | undefined;
  return (label: string): number => {
    if (typeof document === "undefined") return 0;
    if (ctx === undefined) {
      ctx = document.createElement("canvas").getContext("2d");
      // 見出しの字（太さ500・14px）。表の見出しと同じにする
      if (ctx) ctx.font = `500 14px ${getComputedStyle(document.body).fontFamily}`;
    }
    return ctx ? ctx.measureText(label).width : 0;
  };
})();

function labelWidth(label: string): number {
  let px = 0;
  for (const ch of label) px += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 14 : 9;
  return Math.ceil(Math.max(px, TEXT_SIZER(label)));
}

interface LeafColumn {
  /** 列の鍵。幅を覚える単位になるので、地域・区分の id をそのまま使う */
  key: string;
  regionId: string;
  /** 区分の列なら、その区分の id。地域のままなら null */
  categoryId: string | null;
  label: string;
  /** その列が受け持つ規制区分の id */
  categoryIds: Set<string>;
  width: number;
}

/** 地域のまとまり。見出しで地域名のセルを横に伸ばすのに要る */
interface RegionGroup {
  regionId: string;
  label: string;
  expanded: boolean;
  /** この地域が占める列の数 */
  span: number;
}

/**
 * 法律のまとまり。**区分名だけでは何の法律か分からない**ので、
 * 分けた地域の下にもう1段置いて、法律名を出す。
 * 分けていない地域は、この段も地域名のセルが貫く
 */
interface LawGroup {
  /** 開け閉めを覚える鍵。地域＋法律名（法律の id は判定の結果に載っていない） */
  key: string;
  regionId: string;
  label: string;
  /** この法律が占める列の数。閉じているときは 1 */
  span: number;
  /** 閉じているか。閉じると、その法律の区分が1列にまとまる */
  closed: boolean;
  /** この法律が受け持つ規制区分の id */
  categoryIds: Set<string>;
}

/** 法律の開け閉めを覚える鍵。地域が違えば別ものとして数える */
function lawKeyOf(regionId: string, law: string) {
  return `${regionId}::${law}`;
}

/** 出ている行から、法規の列を組み立てる */
function leafColumns(
  rows: { regulations: RowRegulationDto[] }[],
  openRegions: Set<string>,
  closedLaws: Set<string>,
  locale: ReturnType<typeof useI18n>["locale"],
): { leaves: LeafColumn[]; groups: RegionGroup[]; lawGroups: LawGroup[] } {
  /** 地域 → その地域で該当している区分（並び順つき） */
  const regions = new Map<
    string,
    {
      order: number;
      label: string;
      categories: Map<string, { order: number; law: string; name: string }>;
    }
  >();
  for (const row of rows) {
    for (const r of row.regulations) {
      const region = regions.get(r.regionId) ?? {
        order: r.regionOrder,
        label: pickName(locale, r.regionNameJa, r.regionNameEn),
        categories: new Map(),
      };
      region.categories.set(r.categoryId, {
        order: r.categoryOrder,
        law: pickStatutoryName(locale, r.lawNameOriginal, r.lawNameJa, r.lawNameEn),
        name: pickStatutoryName(locale, r.categoryNameOriginal, r.categoryNameJa, r.categoryNameEn),
      });
      regions.set(r.regionId, region);
    }
  }

  /*
    見出しは**区分名だけ**にする。中国の法律名は「危険化学品安全管理条例」のように長く、
    前に付けると列が名前で埋まって、第1次と第2次のような**末尾の違いが切れて見えなくなる**。
    同じ区分名が2つ以上の法律にあるときだけ、法律名を前に足して区別する。
  */
  const nameCount = new Map<string, number>();
  for (const region of regions.values()) {
    for (const c of region.categories.values()) {
      nameCount.set(c.name, (nameCount.get(c.name) ?? 0) + 1);
    }
  }
  const labelOf = (c: { law: string; name: string }) =>
    (nameCount.get(c.name) ?? 0) > 1 ? `${c.law} ${c.name}` : c.name;

  const leaves: LeafColumn[] = [];
  const groups: RegionGroup[] = [];
  const lawGroups: LawGroup[] = [];
  for (const [regionId, region] of [...regions.entries()].sort((a, b) => a[1].order - b[1].order)) {
    if (!openRegions.has(regionId)) {
      leaves.push({
        key: `region:${regionId}`,
        regionId,
        categoryId: null,
        label: region.label,
        categoryIds: new Set(region.categories.keys()),
        /*
          **見出しがちょうど入るだけ**にする。右に余りを作らない。
          文字のほかに要るのは、左右の余白（8+8）・すきま（4）・開閉の記号（12）。
          最後の1pxは、はしたの丸めで最後の字が「…」に化けるのを防ぐぶん
        */
        width: labelWidth(region.label) + 33,
      });
      groups.push({ regionId, label: region.label, expanded: false, span: 1 });
      continue;
    }
    const categories = [...region.categories.entries()].sort((a, b) => a[1].order - b[1].order);
    /*
      並びは区分の順（法律 → 区分）なので、同じ法律の区分は必ず隣り合う。
      隣が同じ法律なら、同じまとまりに入れる
    */
    const laws: { law: string; items: typeof categories }[] = [];
    for (const entry of categories) {
      const last = laws[laws.length - 1];
      if (last && last.law === entry[1].law) last.items.push(entry);
      else laws.push({ law: entry[1].law, items: [entry] });
    }

    let span = 0;
    for (const g of laws) {
      const key = lawKeyOf(regionId, g.law);
      const categoryIds = new Set(g.items.map(([categoryId]) => categoryId));
      /*
        **閉じた法律は1列にまとめる。**地域を閉じたときと同じ扱いで、
        中身は件数になる。法律が多い地域で、見たいものだけを開いておくため
      */
      if (closedLaws.has(key)) {
        leaves.push({
          key: `law:${key}`,
          regionId,
          categoryId: null,
          label: g.law,
          categoryIds,
          // 見出しがちょうど入るだけ。左右の余白・すきま・開閉の記号のぶんを足す
          width: labelWidth(g.law) + 33,
        });
        lawGroups.push({ key, regionId, label: g.law, span: 1, closed: true, categoryIds });
        span += 1;
        continue;
      }
      for (const [categoryId, c] of g.items) {
        const label = labelOf(c);
        leaves.push({
          key: `category:${categoryId}`,
          regionId,
          categoryId,
          label,
          categoryIds: new Set([categoryId]),
          /*
            区分まで分けると、中身が「分類＋番号＋法文物質名」の字になる。
            見出しの長さだけで決めると狭すぎるので、下限を広めに取る（幅は引いて変えられる）
          */
          width: Math.min(280, Math.max(180, labelWidth(label) + 20)),
        });
      }
      lawGroups.push({
        key,
        regionId,
        label: g.law,
        span: g.items.length,
        closed: false,
        categoryIds,
      });
      span += g.items.length;
    }
    groups.push({ regionId, label: region.label, expanded: true, span });
  }
  return { leaves, groups, lawGroups };
}

export function CompositionAggregateTable({
  productId,
  open,
  onOpenChange,
  onExpandableChange,
  showNearMiss = false,
  showSources = false,
  showDiff = false,
  onSourcesChange,
  onPreviousVersionChange,
}: Props) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<CompositionAggregateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 区分まで分けて見ている地域。地域名を押すたびに出し入れする */
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());
  /** 閉じている法律。**開いているのが既定**で、閉じたものだけを覚える */
  const [closedLaws, setClosedLaws] = useState<Set<string>>(new Set());
  /**
   * 押して開いているセル。**区分まで分けた列だけ**開ける。
   * 地域でまとめた列は区分がいくつも重なっており、どれを見せるか決まらない
   */
  const [cell, setCell] = useState<{ cas: string; categoryId: string } | null>(null);
  /**
   * その区分に該当する行だけを見ている、という状態。
   * **区分名を押すと絞る。**押して閉じるのではない（閉じるのは地域名の役目）。
   */
  const [focus, setFocus] = useState<{ categoryId: string; label: string } | null>(null);

  /*
    列は**出しているものから作る**。赤字を出しているあいだは、
    そのためだけに当たっている区分も列に加える。切ると元の列に戻る
  */
  const columnRows = (data?.rows ?? []).map((r) => ({
    regulations: showNearMiss ? [...r.regulations, ...r.nearMiss] : r.regulations,
  }));
  const { leaves, groups, lawGroups } = leafColumns(columnRows, openRegions, closedLaws, locale);
  /*
    **組成そのものの列（CAS〜備考）は出し入れできる。**隠したぶんは端末に覚える。
    法規の列は中身で増減するので対象にしない。全部隠すと行が読めなくなるので、最後の1つは残す
  */
  const {
    hidden: hiddenHeads,
    toggle: toggleHead,
    reset: resetHeads,
    changed: headsChanged,
  } = useColumnVisibility("chem.table.compositionAggregate.v4.columns");
  const heads = HEADS.filter((h) => !hiddenHeads.has(h.key));
  const FROZEN = heads.length;
  /** 出している列の中での位置。貼り付ける列の座標はこれで引く */
  const headAt = (key: HeadKey) => heads.findIndex((h) => h.key === key);
  const [headsOpen, setHeadsOpen] = useState(false);
  // 列幅は一覧と同じ規則。法規の列は中身で増減するが、鍵が id なので幅は覚えたまま
  const cols = useResizableColumns(
    /*
      **末尾の版を上げると、覚えている列幅を捨てて既定から始め直す。**
      含有率の列が狭すぎて「%」が欠けていたのを直したが、
      一度でも幅を引いた人には古い幅が残り、直らなかったため。
      v4 … 備考を広げ、スコアを見出しぶんまで詰めた
    */
    "chem.table.compositionAggregate.v4",
    [...heads, ...leaves],
    // 規制区分に分けると列が増える。詰めずに、はみ出したぶんは横に送る
    { shrinkToFit: false, frozen: FROZEN },
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/products/${productId}/composition/aggregate`).catch(() => null);
      if (!res || !alive) return;
      if (redirectIfUnauthorized(res)) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        if (alive) setError(body?.error.message ?? m.errors.loadFailed(res.status));
        return;
      }
      const body = (await res.json()) as CompositionAggregateDto;
      if (alive) setData(body);
    })();
    return () => {
      alive = false;
    };
  }, [productId, m]);

  // 取れたら、開ける行の鍵を親に渡す（見出しのボタンを出すかどうかの判断に使う）
  useEffect(() => {
    onExpandableChange(
      (data?.rows ?? []).filter((r) => r.contributions.length > 1).map((r) => keyOf(r)),
    );
  }, [data, onExpandableChange]);

  // 印の意味を並べる札は親が出す。読み込んだ並びをそのまま渡す
  useEffect(() => {
    onSourcesChange?.(data?.sources ?? []);
  }, [data, onSourcesChange]);

  useEffect(() => {
    onPreviousVersionChange?.(data?.previousVersion ?? null);
  }, [data, onPreviousVersionChange]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <p className="text-muted-foreground text-sm">{m.common.loading}</p>;

  /**
   * 地域を、規制区分に分けて見るか、まとめて見るか。
   * 格納するときは、その地域の区分での絞り込みも解く（見えない列で絞られたままになるため）。
   */
  const toggleRegion = (regionId: string) => {
    const next = new Set(openRegions);
    if (next.has(regionId)) {
      next.delete(regionId);
      if (focus && leaves.some((c) => c.categoryId === focus.categoryId && c.regionId === regionId))
        setFocus(null);
    } else {
      next.add(regionId);
    }
    setOpenRegions(next);
  };

  /**
   * 法律を開け閉めする。閉じると、その法律の区分が1列にまとまる。
   * **閉じる法律の区分で絞り込んでいたら、絞り込みを外す。**
   * 列が消えたのに絞り込みだけが残ると、行が減った理由が画面から読み取れない
   */
  const toggleLaw = (g: LawGroup) => {
    const next = new Set(closedLaws);
    if (next.has(g.key)) {
      next.delete(g.key);
    } else {
      next.add(g.key);
      if (focus && g.categoryIds.has(focus.categoryId)) setFocus(null);
    }
    setClosedLaws(next);
  };

  /**
   * 表に出す行。区分で絞っているときは、その区分に該当するものだけ。
   * **合計は出さない。**絞った行だけを足した数字を「合計」と書くと、
   * 製品全体の合計と取り違える。
   */
  const visible = focus
    ? data.rows.filter((r) => r.regulations.some((x) => x.categoryId === focus.categoryId))
    : data.rows;

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onOpenChange(next);
  };

  return (
    <div className="space-y-3">
      {/* セルを押して開く窓。表の外に描くので、表の横スクロールに切られない */}
      {cell && (
        <CellDetailDialog
          cas={cell.cas}
          categoryId={cell.categoryId}
          productId={productId}
          showNearMiss={showNearMiss}
          onClose={() => setCell(null)}
        />
      )}
      {/*
       * 開けなかった枝があると、この表は不完全になる。
       * 数字は完成して見えてしまうので、表より先に、目立つ形で伝える。
       */}
      {data.blocked.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{m.composition.aggregateIncomplete(data.blocked.length)}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {data.blocked.map((b, i) => (
                <li key={`${b.code}-${i}`}>
                  <span className="font-mono text-xs">{b.code}</span>{" "}
                  {pickName(locale, b.nameJa, b.nameEn)}（{b.pct}%）—{" "}
                  {b.reason === "empty" ? m.composition.expandEmpty : m.composition.expandNotFound}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {data.truncated > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{m.composition.expandTooDeep}</AlertDescription>
        </Alert>
      )}

      {/* 区分で絞っているあいだは、そのことと解きかたを必ず出す */}
      {focus && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {m.composition.aggregateFocused(focus.label, visible.length)}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setFocus(null)}>
            {m.composition.aggregateShowAllRows}
          </Button>
        </div>
      )}

      {/* 組成そのものの列（CAS〜備考）の出し入れ。一覧の「表示項目」と同じ言葉・同じ形 */}
      {data.rows.length > 0 && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setHeadsOpen((v) => !v)}
            aria-expanded={headsOpen}
          >
            {headsOpen ? (
              <ChevronDown className="mr-1 size-4" />
            ) : (
              <ChevronRight className="mr-1 size-4" />
            )}
            {m.table.columnPanel}
            {hiddenHeads.size > 0 && (
              <Badge variant="secondary" className="ml-1">
                {m.table.hiddenCount(hiddenHeads.size)}
              </Badge>
            )}
          </Button>
          {headsOpen && (
            <div className="bg-background space-y-3 rounded-md border p-4">
              <div className="flex flex-wrap items-center gap-2 border-b pb-3">
                <span className="text-sm font-medium">{m.table.columnPanel}</span>
                <Button variant="outline" size="sm" disabled={!headsChanged} onClick={resetHeads}>
                  {m.table.resetColumns}
                </Button>
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-1">
                {HEADS.map((h) => {
                  const shown = !hiddenHeads.has(h.key);
                  // 全部隠すと行が読めなくなる。最後の1つは外させない
                  const last = shown && heads.length <= 1;
                  return (
                    <li key={h.key} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={shown}
                        disabled={last}
                        onChange={() => toggleHead(h.key)}
                      />
                      <span className={cn(!shown && "text-muted-foreground")}>{h.label(m)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {data.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{m.composition.empty}</p>
      ) : (
        /*
          **表の箱に高さを決める。**行が多いとき、横のスクロールバーは表のいちばん下に付く。
          ページを下まで送らないと触れず、そこまで送ると見出しが画面から消えていた。
          箱の中で行を送る形にすると、見出しは上に貼り付いたまま、
          スクロールバーも箱の下端にあるので、どちらも見ながら動かせる
        */
        <div ref={cols.scrollerRef} className="max-h-[70vh] overflow-auto">
          {/* 切れているセルにマウスを置いたとき、中身を全部出す吹き出し */}
          {cols.peek}
          <table
            {...cols.tableProps}
            className={cn(
              "table-fixed border-collapse border text-sm",
              CELL_CLIP,
              cols.tableProps.className,
            )}
          >
            <colgroup>{cols.cols()}</colgroup>
            {/*
              見出しは2段。上の段は「該当法規制」の見出しだけで、
              下の段が地域（押すと規制区分に分かれる）。
              組成そのものの列は2段ぶんの高さを取る。
            */}
            {/*
              見出しは3段。
                1段目 … 「該当法規制」の見出し
                2段目 … 地域。**分けても地域名のセルは残す**（横に伸びて、どこまでが
                        その地域かが分かる）。押すと分ける／格納する
                3段目 … 規制区分。押すと**その区分に該当する行だけ**になる（格納ではない）
              組成そのものの列は3段ぶんの高さを取る。
            */}
            {/*
              見出しは箱の上に貼り付ける。**色は行ではなく `thead` に置く。**
              行に置くと、枠線を重ねて描く表（`border-collapse: collapse`）では
              いちばん上の1〜2pxが塗られず、流れていく行がそこから覗く
            */}
            <thead
              className={cn(
                "table-head-solid text-table-head-foreground sticky top-0 z-20",
                HEAD_GRID,
              )}
            >
              <tr className="border-t text-left">
                {heads.map(({ key, label, className }, at) => {
                  const frozen = cols.frozenProps(at);
                  return (
                    <th
                      key={key}
                      rowSpan={4}
                      // 貼り付ける列は position が sticky になる。つまみはその中に置ける
                      className={cn(
                        CELL,
                        "align-bottom font-medium",
                        at < FROZEN ? "table-head-solid" : "relative",
                        frozen.className,
                        className,
                      )}
                      // 左に貼り付ける見出しは、上と左の両方で貼り付く角なので前に出す
                      style={frozen.style ? { ...frozen.style, zIndex: 30 } : undefined}
                    >
                      {label(m)}
                      {cols.handle(key, `${label(m)} ${m.table.resize}`)}
                    </th>
                  );
                })}
                {leaves.length > 0 && (
                  <th colSpan={leaves.length} className={cn(CELL, "text-center font-medium")}>
                    {m.composition.aggregateRegulations}
                  </th>
                )}
              </tr>

              <tr className="text-left">
                {groups.map((g) => (
                  <th
                    key={g.regionId}
                    colSpan={g.span}
                    // 分けていない地域は、下の段まで貫いて1つのセルにする
                    rowSpan={g.expanded ? 1 : 3}
                    className={cn(CELL, "relative p-0 font-medium", g.expanded && "text-center")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRegion(g.regionId)}
                      aria-expanded={g.expanded}
                      title={
                        g.expanded
                          ? `${g.label} — ${m.composition.aggregateGroupByRegion}`
                          : `${g.label} — ${m.composition.aggregateSplitByCategory}`
                      }
                      className={cn(
                        "hover:bg-accent/60 flex w-full items-center gap-1 px-2 py-1",
                        g.expanded ? "justify-center" : "text-left",
                      )}
                    >
                      <ChevronRight
                        className={cn(
                          "text-muted-foreground size-3 shrink-0 transition-transform",
                          g.expanded && "rotate-90",
                        )}
                      />
                      <span className="truncate">{g.label}</span>
                    </button>
                    {/* 分けていない地域の列は、ここが幅を変える場所になる */}
                    {!g.expanded &&
                      cols.handle(`region:${g.regionId}`, `${g.label} ${m.table.resize}`)}
                  </th>
                ))}
              </tr>

              {/*
                法律の段。**区分名だけでは何の法律か分からない**ので、区分の1つ上に置く。
                分けていない地域はこの段も地域名のセルが貫くので、ここには出さない
              */}
              {lawGroups.length > 0 && (
                <tr className="text-left">
                  {lawGroups.map((g) => (
                    <th
                      key={g.key}
                      colSpan={g.span}
                      // 閉じた法律は、下の区分の段まで貫いて1つのセルにする
                      rowSpan={g.closed ? 2 : 1}
                      className={cn(CELL, "relative p-0 font-medium")}
                    >
                      <button
                        type="button"
                        onClick={() => toggleLaw(g)}
                        aria-expanded={!g.closed}
                        title={
                          g.closed
                            ? `${g.label} — ${m.composition.aggregateSplitByCategory}`
                            : `${g.label} — ${m.composition.aggregateGroupByLaw}`
                        }
                        className={cn(
                          "hover:bg-accent/60 flex w-full items-center gap-1 px-2 py-1",
                          g.closed ? "text-left" : "justify-center",
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "text-muted-foreground size-3 shrink-0 transition-transform",
                            !g.closed && "rotate-90",
                          )}
                        />
                        <span className="truncate">{g.label}</span>
                      </button>
                      {/* 閉じた法律の列は、ここが幅を変える場所になる */}
                      {g.closed && cols.handle(`law:${g.key}`, `${g.label} ${m.table.resize}`)}
                    </th>
                  ))}
                </tr>
              )}

              {/* 分けている地域が無ければ、区分の段そのものを出さない */}
              <tr className="border-b text-left">
                {leaves
                  .filter((c) => c.categoryId !== null)
                  .map((c) => {
                    const picked = focus?.categoryId === c.categoryId;
                    return (
                      <th key={c.key} className={cn(CELL, "relative p-0 font-medium")}>
                        <button
                          type="button"
                          onClick={() =>
                            setFocus(
                              picked
                                ? null
                                : { categoryId: c.categoryId as string, label: c.label },
                            )
                          }
                          aria-pressed={picked}
                          title={`${c.label} — ${picked ? m.composition.aggregateShowAllRows : m.composition.aggregateOnlyThis}`}
                          className={cn(
                            "hover:bg-accent/60 flex w-full items-center px-2 py-1 text-left",
                            picked && "bg-accent text-foreground",
                          )}
                        >
                          <span className="truncate">{c.label}</span>
                        </button>
                        {cols.handle(c.key, `${c.label} ${m.table.resize}`)}
                      </th>
                    );
                  })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const key = keyOf(row);
                const many = row.contributions.length > 1;
                const shown = open.has(key);
                return (
                  <Fragment key={key}>
                    <tr className="border-b">
                      {heads.map((h, at) => {
                        const frozen = cols.frozenProps(at);
                        switch (h.key) {
                          case "casNumber":
                            return (
                              <td
                                key={h.key}
                                className={cn(CELL, STICKY_PLAIN, "font-mono text-xs")}
                                style={frozen.style}
                              >
                                {row.casNumber ?? (
                                  <span className="text-muted-foreground font-sans">
                                    {m.composition.aggregateNoCas}
                                  </span>
                                )}
                              </td>
                            );
                          case "substanceId":
                            return (
                              <td
                                key={h.key}
                                className={cn(CELL, STICKY_PLAIN, "font-mono text-xs")}
                                style={frozen.style}
                              >
                                {row.code}
                              </td>
                            );
                          case "name":
                            return (
                              <td
                                key={h.key}
                                className={cn(CELL, STICKY_PLAIN)}
                                style={frozen.style}
                              >
                                {many ? (
                                  <button
                                    type="button"
                                    onClick={() => toggle(key)}
                                    aria-expanded={shown}
                                    aria-label={
                                      shown
                                        ? m.composition.collapse
                                        : m.composition.aggregateShowSources
                                    }
                                    className="hover:text-foreground -ml-1 inline-flex items-center gap-1 text-left"
                                  >
                                    <ChevronRight
                                      className={cn(
                                        "text-muted-foreground size-4 shrink-0 transition-transform",
                                        shown && "rotate-90",
                                      )}
                                    />
                                    {pickName(locale, row.nameJa, row.nameEn)}
                                  </button>
                                ) : (
                                  pickName(locale, row.nameJa, row.nameEn)
                                )}
                              </td>
                            );
                          case "contentPct":
                            return (
                              <td
                                key={h.key}
                                className={cn(CELL, STICKY_PLAIN, "text-right whitespace-nowrap")}
                                style={frozen.style}
                              >
                                {row.totalPct}%
                              </td>
                            );
                          case "score":
                            return (
                              <td
                                key={h.key}
                                className={cn(
                                  CELL,
                                  STICKY_PLAIN,
                                  "text-right font-mono whitespace-nowrap",
                                )}
                                style={frozen.style}
                              >
                                {row.score}
                              </td>
                            );
                          default:
                            return (
                              <td
                                key={h.key}
                                className={cn(
                                  CELL,
                                  STICKY_PLAIN,
                                  frozen.className,
                                  "text-muted-foreground text-xs",
                                )}
                                style={frozen.style}
                              >
                                <span className="line-clamp-2">{row.note}</span>
                              </td>
                            );
                        }
                      })}
                      {leaves.map((c) => {
                        const hit = row.regulations.filter((r) => c.categoryIds.has(r.categoryId));
                        const near = showNearMiss
                          ? row.nearMiss.filter((r) => c.categoryIds.has(r.categoryId))
                          : [];
                        const openable = c.categoryId !== null && row.casNumber !== null;
                        return (
                          <td
                            key={c.key}
                            className={cn(CELL, "text-center", openable && "hover:bg-muted/60")}
                            /*
                              押すと、その CAS × その区分を
                              バージョン・データソース別に開く。
                              **区分まで分けた列だけ**（地域でまとめた列は相手が決まらない）
                            */
                            onClick={
                              openable
                                ? () =>
                                    setCell({
                                      cas: row.casNumber as string,
                                      categoryId: c.categoryId as string,
                                    })
                                : undefined
                            }
                            /*
                              このセルは押されたときの動きを自分で持っている。
                              印を付けて、中身を出すだけの窓が同時に開かないようにする
                            */
                            data-cell-click={openable ? "" : undefined}
                            title={openable ? m.composition.cellDetailOpen : undefined}
                          >
                            <RegulationMark
                              hits={hit}
                              near={near}
                              expanded={c.categoryId !== null}
                              locale={locale}
                              sources={showSources ? (data.sources ?? []) : []}
                              showDiff={showDiff}
                              diffLabel={m.composition.diffMark(data.previousVersion ?? "")}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {/*
                     * 内訳は物質コードと、製品全体に対する重量%だけ。
                     * どの原材料から来たかは登録組成のほうを見れば分かる。
                     * 数字を上の行と同じ列に置くので、足すと合計になることが目で追える。
                     */}
                    {many &&
                      shown &&
                      row.contributions.map((c, i) => (
                        <tr key={`${key}-${i}`} className="bg-muted/40 border-b">
                          {heads.map((h, at) => {
                            const frozen = cols.frozenProps(at);
                            switch (h.key) {
                              case "substanceId":
                                return (
                                  <td
                                    key={h.key}
                                    className={cn(
                                      CELL,
                                      OPAQUE_MUTED_40,
                                      "text-muted-foreground pl-6 font-mono text-xs",
                                    )}
                                    style={frozen.style}
                                  >
                                    {c.code}
                                  </td>
                                );
                              // まとめる前の名前。代表と同じでも空欄にはしない（空欄は「入っていない」に見える）
                              case "name":
                                return (
                                  <td
                                    key={h.key}
                                    className={cn(
                                      CELL,
                                      OPAQUE_MUTED_40,
                                      "text-muted-foreground pl-6 text-xs",
                                    )}
                                    style={frozen.style}
                                  >
                                    {pickName(locale, c.nameJa, c.nameEn)}
                                  </td>
                                );
                              case "contentPct":
                                return (
                                  <td
                                    key={h.key}
                                    className={cn(
                                      CELL,
                                      OPAQUE_MUTED_40,
                                      "text-muted-foreground text-right text-xs whitespace-nowrap",
                                    )}
                                    style={frozen.style}
                                  >
                                    {c.pct}%
                                  </td>
                                );
                              // CAS・スコア・備考は内訳の行では出さない（スコアは物質ごとの値）
                              default:
                                return (
                                  <td
                                    key={h.key}
                                    className={cn(CELL, OPAQUE_MUTED_40, frozen.className)}
                                    style={frozen.style}
                                  />
                                );
                            }
                          })}
                          {leaves.map((c) => (
                            <td key={c.key} className={CELL} />
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            {!focus && (
              <tfoot>
                <tr className="bg-muted/50 border-t">
                  {/*
                    合計は3列ぶんをまたぐ。ここは貼り付ける範囲とちょうど同じなので、
                    1つのセルのまま左に貼り付けられる
                  */}
                  {/*
                    「合計」の札は、CAS・物質ID・物質名のうち出している列をまたぐ。
                    3つとも隠していれば、重量%の欄に札ごと入れる
                  */}
                  {(() => {
                    const labelSpan = heads.filter((h) =>
                      ["casNumber", "substanceId", "name"].includes(h.key),
                    ).length;
                    return (
                      <>
                        {labelSpan > 0 && (
                          <td
                            className={cn(CELL, OPAQUE_MUTED_50, "text-right font-medium")}
                            style={cols.frozenProps(0).style}
                            colSpan={labelSpan}
                          >
                            {m.composition.sumLabel}
                          </td>
                        )}
                        {headAt("contentPct") >= 0 && (
                          <td
                            className={cn(CELL, OPAQUE_MUTED_50, "text-right font-medium")}
                            style={cols.frozenProps(headAt("contentPct")).style}
                          >
                            {labelSpan === 0 && `${m.composition.sumLabel} `}
                            {data.totalPct}%
                          </td>
                        )}
                        {/* スコアのぶん。合計は出さない（物質ごとの値を足しても意味を持たない） */}
                        {headAt("score") >= 0 && (
                          <td
                            className={cn(CELL, OPAQUE_MUTED_50)}
                            style={cols.frozenProps(headAt("score")).style}
                          />
                        )}
                        {/* 備考のぶん。ここを抜かすと右端が1列ずれて、最後のセルだけ色が付かない */}
                        {headAt("note") >= 0 && (
                          <td
                            className={cn(
                              CELL,
                              OPAQUE_MUTED_50,
                              cols.frozenProps(headAt("note")).className,
                            )}
                            style={cols.frozenProps(headAt("note")).style}
                          />
                        )}
                      </>
                    );
                  })()}
                  {leaves.map((c) => (
                    <td key={c.key} className={CELL} />
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * その物質が、その列の規制に当たっているかどうかの印。
 *
 *   地域の列（まとめているとき） … **当たっている規制区分の個数**
 *   区分の列（分けたとき）       … 当たっていれば印、当たっていなければ空
 *
 * **空欄は「かかっていない」ではなく「該当が無い」。**
 * まだ判定していない製品でも空になるので、下の判定表と合わせて読む。
 *
 * 確認が残っている区分は、判定表と同じ赤にする。
 * 地域にまとめているときは、1つでも残っていれば赤くする
 * （まとめた中に見なければいけないものが隠れる、という事故を防ぐ）。
 */
function RegulationMark({
  hits,
  near,
  expanded,
  locale,
  sources,
  showDiff,
  diffLabel,
}: {
  hits: RowRegulationDto[];
  /** CAS は載っているが当たっていないもの。赤字で添える */
  near: RowRegulationDto[];
  expanded: boolean;
  locale: ReturnType<typeof useI18n>["locale"];
  /**
   * データソースの並び。空なら印を出さない。
   * **印は判定に使われた結び付きの出どころ**で、判定した時点のものを出す
   */
  sources: SourceInfo[];
  /** 前のバージョンに無かったものに印を付けるか */
  showDiff: boolean;
  /** 差分の印に添える説明 */
  diffLabel: string;
}) {
  if (hits.length === 0 && near.length === 0)
    return <span className="text-muted-foreground">—</span>;
  const needsReview = hits.some((h) => h.needsReview);
  const pathOf = (list: RowRegulationDto[]) =>
    list
      .map(
        (h) =>
          `${pickStatutoryName(locale, h.lawNameOriginal, h.lawNameJa, h.lawNameEn)} › ${pickStatutoryName(locale, h.categoryNameOriginal, h.categoryNameJa, h.categoryNameEn)}`,
      )
      .join("\n");
  const title = pathOf(hits);
  const nearTitle = pathOf(near);
  /*
    区分まで分けている列は、**何に当たったのかを字で出す**。
    分類＋番号＋法文物質名。分類は名前を持たない受け皿もあるので、無ければ詰める。
    印だけでは、同じ区分の中のどの号に当たったのかが分からない。

    地域でまとめている列は件数のまま。区分がいくつも重なるので、
    ここに字を並べると1つの列に何行も入ってしまう。
  */
  if (!expanded) {
    /*
      当たった件数のうしろに、**印を付けた件数**を添える。
      数字ごと赤くしていたころは、何件が要確認なのかが読めなかった
    */
    const reviewCount = hits.filter((h) => h.needsReview).length;
    // そのセルに関わったデータソース。重複なく、優先度の順のまま
    const cellSources = [...new Set([...hits, ...near].flatMap((h) => h.sourceIds))];
    return (
      <span className="tabular-nums">
        <SourceChips ids={cellSources} sources={sources} />
        {showDiff && [...hits, ...near].some((h) => h.changed) && <DiffChip label={diffLabel} />}
        {hits.length > 0 && <span title={title}>{hits.length}</span>}
        {reviewCount > 0 && (
          <span title={title} className={REVIEW_CLASS}>
            {" "}
            <ReviewMark />
            {reviewCount}
          </span>
        )}
        {near.length > 0 && (
          <span title={nearTitle} className={NEAR_MISS_CLASS}>
            {hits.length > 0 || reviewCount > 0 ? " " : ""}
            <NearMark />
            {near.length}
          </span>
        )}
      </span>
    );
  }
  /* 要確認かどうかは**法文物質名ごと**に持つ。区分をまたいで並ぶことがあるため */
  const labels = hits.flatMap((h) =>
    /*
      **データソースは法文物質名ごとに持つ。**同じ区分でも、号によって
      どのデータソースから来た結び付きかが違うことがある
    */
    statutoryLabels(h, locale).map((t, i) => ({
      t,
      review: h.needsReview,
      sourceIds: h.statutory[i]?.sourceIds ?? h.sourceIds,
      changed: h.statutory[i]?.changed ?? h.changed,
      data: dataLine(h.statutory[i]?.data ?? [], locale),
    })),
  );
  const nearLabels = near.flatMap((h) =>
    statutoryLabels(h, locale).map((t, i) => ({
      t,
      sourceIds: h.statutory[i]?.sourceIds ?? h.sourceIds,
      changed: h.statutory[i]?.changed ?? h.changed,
      data: dataLine(h.statutory[i]?.data ?? [], locale),
    })),
  );
  /*
    出どころの文章。**「データソース」を押しているときだけ、名前の下に1行**添える。
    入りきらない分は「…」で切る。全文はセルを押して出る小ウィンドウで読む
  */
  const showData = sources.length > 0;
  const DATA_LINE = "text-muted-foreground block truncate font-sans text-[11px] leading-tight";
  return (
    <span className="block text-left text-xs">
      {hits.length > 0 && (
        <span title={title} className="block">
          {/* 名前が取れないのは、区分そのものでまとめて当たったとき */}
          {labels.length === 0 ? (
            <span className={needsReview ? REVIEW_CLASS : ""}>
              <SourceChips ids={hits.flatMap((h) => h.sourceIds)} sources={sources} />
              {showDiff && hits.some((h) => h.changed) && <DiffChip label={diffLabel} />}
              {needsReview && <ReviewMark />}●
            </span>
          ) : (
            labels.map(({ t, review, sourceIds, changed, data }) => (
              <span key={t} className="block">
                <span className={cn("block", review ? REVIEW_CLASS : "")}>
                  <SourceChips ids={sourceIds} sources={sources} />
                  {showDiff && changed && <DiffChip label={diffLabel} />}
                  {review && <ReviewMark />}
                  {t}
                </span>
                {showData && data && (
                  <span className={DATA_LINE} title={data}>
                    {data}
                  </span>
                )}
              </span>
            ))
          )}
        </span>
      )}
      {/*
        当たってはいないが、CAS が載っているもの。**当たったものと見分けが付くよう赤字にする。**
        含有率が変われば該当するので、気を付ける相手として出す
      */}
      {nearLabels.map(({ t, sourceIds, changed, data }) => (
        <span key={`near-${t}`} className="block">
          <span title={nearTitle} className={cn("block", NEAR_MISS_CLASS)}>
            <SourceChips ids={sourceIds} sources={sources} />
            {showDiff && changed && <DiffChip label={diffLabel} />}
            <NearMark />
            {t}
          </span>
          {showData && data && (
            <span className={DATA_LINE} title={data}>
              {data}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/** 法文物質名の1行ぶんの字。分類＋番号＋名前（分類は無ければ詰める） */
/**
 * セルに添える出どころの文章。**優先度がいちばん高いデータソースのものを1つ**。
 * 画面の言語で選ぶ（日本語訳があれば日本語、無ければ原文）
 */
function dataLine(
  data: RowStatutoryDto["data"],
  locale: ReturnType<typeof useI18n>["locale"],
): string | null {
  const d = data[0];
  if (!d) return null;
  return locale === "ja" ? (d.textJa ?? d.text) : d.text;
}

function statutoryLabels(
  h: RowRegulationDto,
  locale: ReturnType<typeof useI18n>["locale"],
): string[] {
  return h.statutory.map((sub) =>
    [
      sub.classNameOriginal
        ? pickStatutoryName(locale, sub.classNameOriginal, sub.classNameJa, sub.classNameEn)
        : "",
      sub.officialNumber ?? "",
      pickStatutoryName(locale, sub.nameOriginal, sub.nameJa, sub.nameEn),
    ]
      .filter(Boolean)
      .join(" "),
  );
}
