"use client";

import { pickName } from "@chem/shared";
import {
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleHelp,
  Droplets,
  TriangleAlert,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { RejudgeButton } from "@/components/rejudge-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import { ResizableBox } from "@/components/data-table/resizable-box";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { bindJudgementControls, publishJudgementState } from "@/lib/judgement-controls";
import { JUDGEMENTS_CHANGED } from "@/lib/judgements-refresh";
import { useI18n } from "@/lib/i18n-client";
import { NEAR_MISS_CLASS, REVIEW_CLASS } from "@/lib/mark-styles";
import { cn } from "@/lib/utils";
import type { ApiError, JudgementHitDto, ProductJudgementDto } from "@/lib/types";

/**
 * その製品の法規制判定。
 *
 * 表にする。**1行＝判定の単位 1 件**（2026-09-15 決定）。判定の単位は「まとめる単位」と同じで、
 * 区分でまとめる区分は区分そのもの、それ以外は法文物質名（製品にその CAS が入っているものだけ）。
 * 該当／非該当のラベルと「判定修正」は判定の単位の行に付く。
 * 法文物質名が単位の区分では、区分の行は国・法律と同じ「n 件中 m 件に該当」の見出しで、
 * 押すと中の法文物質名の行が開く。
 *
 * 判定（該当／非該当）と「人が見たかどうか」は**別の列**に出す。
 * 確認しても判定が変わらないことは普通にあるので、混ぜない。
 */
export type M = ReturnType<typeof useI18n>["m"];

/** 組成の表と同じ枠線・余白。並べて見るので、見た目をそろえる */
/*
  罫線は**セルが自分の右と下に引く**（border-separate）。
  隣と共有する collapse だと、貼り付けた見出しの縁で、下を流れる行の罫線が覗いてちらつく
  （合算表・物質の表と同じ直しかた）。行（tr）の罫線は separate では描かれないので、
  行に付けたい線は `[&>td]:…` でセルに付ける
*/
// 右端の列の線が表の右の外枠になる。左の外枠は各行の先頭のセルが引く（表の `[&_tr>*:first-child]:border-l`）
const CELL = "border-r border-b px-2 py-1";

/**
 * 列の並びと既定の幅。**見出しと幅を1か所に持つ。**
 * 別々に書くと、列を足したときに幅だけ古いまま残って気づけない。
 *
 * **判定の列は置かない。**既定では該当したものしか並べず、絞りを外したときだけ非該当のラベルを付ける。
 *
 * 重量%と該当CASは2つで1組。**間に別の列を挟まないこと**（合算かどうかが読めなくなる）。
 * スコアはその右に置く。**CASの隣**なので、どの物質の点数かが読める。
 */
const HEADS: { key: string; width: number; label: (m: M) => string; className?: string }[] = [
  // 地域が左端。地域ごとに1つのセルで、その地域の国の行をまたぐ（2026-09-11 指示）
  { key: "region", width: 88, label: (m) => m.laws.region },
  // 行は国ごとにまとまっていて、国の行を押すと中（法律・区分）が開く
  { key: "country", width: 88, label: (m) => m.laws.country },
  { key: "law", width: 80, label: (m) => m.judgements.law },
  // 区分の行にだけ開閉のつまみが付く。そのぶん少し広く取る
  { key: "category", width: 176, label: (m) => m.judgements.category },
  { key: "number", width: 56, label: (m) => m.judgements.number },
  // 1280px の画面で表がなるべく収まるよう、長い文字の列は少し詰める（切れた分は押せば読める）
  { key: "statutoryName", width: 240, label: (m) => m.judgements.statutoryName },
  { key: "content", width: 72, label: (m) => m.judgements.content, className: "text-right" },
  { key: "matchedCas", width: 96, label: (m) => m.judgements.matchedCas },
  // ランクを出し、スコアは浮かせて見せる（2026-09-15 指示）。組成の表と同じ
  { key: "rank", width: 60, label: (m) => m.score.substanceRank, className: "text-center" },
  { key: "warning", width: 200, label: (m) => m.judgements.warning },
];

/**
 * 操作の列。編集できる人にだけ出るので、列の並びとは別に持つ。
 *
 * **「判定修正」を押したときに開く欄が収まる幅にする。**
 * 押していないあいだはボタン1つぶんで足りるが、開くと根拠の入力欄と
 * ボタン3つがこの中に入る。狭いままだと文字が切れて読めなかった
 */
const ACTION_COLUMN = { key: "actions", width: 224 };

export function ProductJudgements({
  productId,
  canEdit,
  version,
}: {
  productId: string;
  canEdit: boolean;
  /**
   * この判定に使った法規制のバージョン。
   * **どのバージョンで出した結果かが分からないと、印刷して人に渡せない。**
   */
  version: string | null;
}) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<ProductJudgementDto[] | null>(null);
  /** いつ・どの前提で出した判定か。前提が変わっていれば古い可能性がある */
  const [stamp, setStamp] = useState<{
    computedAt: string | null;
    versionCode: string | null;
    stale: boolean;
    /** 古い理由が「施行日・適用終了日を跨いだ」か */
    staleByDate: boolean;
    /** この版の判定は無いが、別の版では判定してある（切り替えたまま判定し直していない） */
    judgedElsewhere: boolean;
    /** この版で判定した（行が 0 件なら、どの法規制にも関わらない製品） */
    judged: boolean;
    /** 判定対象日と、サーバーの今日。違えば「今日の規制ではない」と断る */
    judgedAsOf: string | null;
    today: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** いま根拠を書いている判定の行（id）。null なら誰も書いていない */
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * 中身（法文物質名の行）を開いている区分。
   * **既定は全部閉じる。**当たった区分が何かをまず見せ、
   * 中身は必要なものだけ開く（区分ごとに何行も続くと、何件当たったのか読めない）。
   */
  const [open, setOpen] = useState<Set<string>>(new Set());
  /**
   * 開いている国。**既定は全部閉じる。**まず国ごとの件数だけを見せ、
   * 見たい国だけ開く（法律と区分は国の数だけ続くので、閉じておかないと長い）
   */
  const [openCountries, setOpenCountries] = useState<Set<string>>(new Set());
  /** 開いている法律。鍵は「国コード/法律コード」（同じ法律コードが国をまたぐことはないが、念のため） */
  const [openLaws, setOpenLaws] = useState<Set<string>>(new Set());
  /**
   * 非該当も出すか。**既定は出さない。**
   * ふだん見たいのは当たったものだけだが、**非該当に直した判定を戻す口が要る**のと、
   * 「入っているが含有率が足りない」法文物質名を確かめたいことがあるので、押して全部出せる
   * （組成の表の「含有率不足による非該当」と同じもの。2026-09-15 決定。見せ方も同じにした 2026-09-22）
   */
  const [showNotApplicable, setShowNotApplicable] = useState(false);
  // 上の合算表にも同じ見出しと「再計算」があるので、置き場（judgement-controls）で共有する
  useEffect(() => {
    bindJudgementControls(productId);
  }, [productId]);
  // 列幅は一覧と同じ規則。操作の列は、出るときだけ幅を数に入れる
  const cols = useResizableColumns(
    // 末尾の版を上げると、覚えている列幅を捨てて既定から始め直す
    "chem.table.productJudgements.v5",
    [...HEADS, ...(canEdit ? [ACTION_COLUMN] : [])],
    // 幅を詰めない。詰めると製品ごと・画面幅ごとに列の位置が動いて見比べられない
    { shrinkToFit: false, rowLabel: m.table.resizeRows },
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/products/${productId}/judgements`).catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    const body = (await res.json()) as {
      items: ProductJudgementDto[];
      computedAt: string | null;
      versionCode: string | null;
      stale: boolean;
      staleByDate?: boolean;
      judgedElsewhere?: boolean;
      judged?: boolean;
      judgedAsOf?: string | null;
      today?: string | null;
    };
    setItems(body.items);
    setStamp({
      computedAt: body.computedAt,
      versionCode: body.versionCode,
      stale: body.stale,
      staleByDate: body.staleByDate ?? false,
      judgedElsewhere: body.judgedElsewhere ?? false,
      judged: body.judged ?? false,
      judgedAsOf: body.judgedAsOf ?? null,
      today: body.today ?? null,
    });
  }, [productId, m]);

  useEffect(() => {
    void load();
  }, [load]);

  // いつ・どの版の判定か、前提が変わったか、「再計算」を押せる人かを、上の合算表にも知らせる
  useEffect(() => {
    publishJudgementState({
      versionCode: stamp?.versionCode ?? version,
      computedAt: stamp?.computedAt ?? null,
      judgedAsOf: stamp?.judgedAsOf ?? null,
      today: stamp?.today ?? null,
      stale: stamp?.stale ?? false,
      staleByDate: stamp?.staleByDate ?? false,
      canRejudge: canEdit,
      reviewCount: items?.filter((j) => j.needsReview).length ?? 0,
    });
  }, [stamp, version, canEdit, items]);

  /*
    組成を保存すると、サーバー側で展開結果と判定を作り直している。
    この枠は別に読み込んでいるので、合図を受けて読み直す。
    でないと上のCAS合算表とこの表が食い違う（2026-09-19 報告）
  */
  useEffect(() => {
    const onChanged = () => void load();
    window.addEventListener(JUDGEMENTS_CHANGED, onChanged);
    return () => window.removeEventListener(JUDGEMENTS_CHANGED, onChanged);
  }, [load]);

  async function decide(judgementId: string, verdict?: "APPLICABLE" | "NOT_APPLICABLE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/judgements/${judgementId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, note: note.trim() || null }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setEditing(null);
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.judgements.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        </CardContent>
      </Card>
    );
  }

  const applicable = items.filter((j) => j.verdict === "APPLICABLE");
  const shown = showNotApplicable ? items : applicable;
  // 要確認の数は絞り込みに関わらず全部で数える（上の合算表の印の横と同じ数。2026-09-22 指示）
  const review = items.filter((j) => j.needsReview);

  /*
    国ごとにまとめる。並びは地域 → 国 → 法律 → 区分 → 判定の単位なので、隣が同じなら同じまとまり。
    国・法律・区分の行に出す件数は、絞り込みに関わらず全部の単位で数える
  */
  interface CategoryGroup {
    categoryId: string;
    label: string;
    /**
     * 区分そのものが判定の単位（区分でまとめる区分。根拠を伏せた相手にも区分ごとに 1 行で届く）なら
     * その 1 行。法文物質名が単位なら、開いたときに並ぶ行
     */
    unit: "category" | "substance";
    items: ProductJudgementDto[];
  }
  interface LawGroup {
    key: string;
    label: string;
    categories: CategoryGroup[];
  }
  const countries: {
    code: string;
    label: string;
    region: string;
    regionLabel: string;
    /** 国の中は法律ごとにまとめる。法律の欄も1つのセルにして、押すと区分が開く（2026-09-11 指示） */
    laws: LawGroup[];
  }[] = [];
  for (const j of shown) {
    const lawKey = `${j.countryCode}/${j.lawCode}`;
    const lawLabel = pickName(locale, j.lawNameJa ?? j.lawNameOriginal, j.lawNameEn);
    const catLabel = pickName(locale, j.categoryNameJa ?? j.categoryNameOriginal, j.categoryNameEn);
    const unit = j.statutorySubstanceId === null ? "category" : "substance";
    let country = countries[countries.length - 1];
    if (!country || country.code !== j.countryCode) {
      country = {
        code: j.countryCode,
        label: pickName(locale, j.countryNameJa, j.countryNameEn),
        region: j.regionCode,
        regionLabel: pickName(locale, j.regionNameJa, j.regionNameEn),
        laws: [],
      };
      countries.push(country);
    }
    let law = country.laws[country.laws.length - 1];
    if (!law || law.key !== lawKey) {
      law = { key: lawKey, label: lawLabel, categories: [] };
      country.laws.push(law);
    }
    const cat = law.categories[law.categories.length - 1];
    if (cat && cat.categoryId === j.categoryId) cat.items.push(j);
    else law.categories.push({ categoryId: j.categoryId, label: catLabel, unit, items: [j] });
  }
  const lawKeys = countries.flatMap((c) => c.laws.map((l) => l.key));
  /** 区分を開いたとき、中に並ぶ行の数。区分そのものが単位なら根拠の行が 1 つ（あれば） */
  const childrenOf = (g: CategoryGroup) =>
    g.unit === "category" ? (g.items[0]?.hits.length ? 1 : 0) : g.items.length;
  /** 中身を持つ区分。「開」「閉」を出すかどうかの判断に使う */
  const openable = countries
    .flatMap((c) => c.laws.flatMap((l) => l.categories))
    .filter((g) => childrenOf(g) > 0)
    .map((g) => g.categoryId);
  /** 法律が何行ぶんを占めるか。閉じていれば1行、開いていれば区分と開いた中身の行のぶんが足される */
  const lawSpanOf = (l: LawGroup) =>
    openLaws.has(l.key)
      ? 1 + l.categories.reduce((n, g) => n + 1 + (open.has(g.categoryId) ? childrenOf(g) : 0), 0)
      : 1;
  /** 国が何行ぶんを占めるか。閉じていれば1行、開いていれば中の法律のぶん */
  const spanOf = (c: (typeof countries)[number]) =>
    openCountries.has(c.code) ? 1 + c.laws.reduce((n, l) => n + lawSpanOf(l), 0) : 1;
  /*
    地域の欄は**同じ地域の国をまとめて1つ**にする。並びは地域 → 国なので、
    隣が同じ地域なら同じまとまり。最初の国の行に置き、その地域の国の行を全部またぐ
  */
  const regionSpan = new Map<number, number>();
  countries.forEach((c, i) => {
    if (i > 0 && countries[i - 1]!.region === c.region) return;
    let span = 0;
    for (let k = i; k < countries.length && countries[k]!.region === c.region; k++) {
      span += spanOf(countries[k]!);
    }
    regionSpan.set(i, span);
  });
  /** 国・法律・区分の行に出す件数。絞り込みに関わらず、その中の全部の単位で数える */
  type Totals = { total: number; applicable: number; review: number };
  const tally = (keyOf: (j: ProductJudgementDto) => string) => {
    const map = new Map<string, Totals>();
    for (const j of items) {
      const key = keyOf(j);
      const t = map.get(key) ?? { total: 0, applicable: 0, review: 0 };
      t.total += 1;
      if (j.verdict === "APPLICABLE") t.applicable += 1;
      if (j.needsReview) t.review += 1;
      map.set(key, t);
    }
    return map;
  };
  const countryTotals = tally((j) => j.countryCode);
  const lawTotals = tally((j) => `${j.countryCode}/${j.lawCode}`);
  const categoryTotals = tally((j) => j.categoryId);
  const summaryText = (t: Totals | undefined) =>
    [
      m.judgements.summary(t?.applicable ?? 0, t?.total ?? 0),
      t && t.review > 0 ? m.judgements.reviewCount(t.review) : null,
    ]
      .filter(Boolean)
      .join(" ・ ");
  const allCountriesOpen = countries.every((c) => openCountries.has(c.code));
  const allLawsOpen = lawKeys.every((k) => openLaws.has(k));
  /** 国・法律・区分がすべて開いているか（「開」を出さない条件）／どれも開いていないか（「閉」を出さない条件） */
  const allJudgementOpen = allCountriesOpen && allLawsOpen && openable.every((id) => open.has(id));
  const noneJudgementOpen = open.size === 0 && openCountries.size === 0 && openLaws.size === 0;

  const toggle = (categoryId: string) => {
    const next = new Set(open);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    setOpen(next);
  };
  const toggleCountry = (code: string) => {
    const next = new Set(openCountries);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setOpenCountries(next);
  };
  const toggleLaw = (key: string) => {
    const next = new Set(openLaws);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenLaws(next);
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {m.judgements.title}
          {/*
            いつ・どのバージョンで出した判定か。**印刷して人に渡すのに要る。**
            判定に控えたバージョンがあればそれを、無ければ現在のバージョンを出す
          */}
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {[
              stamp?.versionCode ?? version,
              stamp?.computedAt
                ? m.judgements.computedAt(new Date(stamp.computedAt).toLocaleString(locale))
                : null,
              // 判定対象日は読み取りだけ。変えるには「再計算」で日付を選ぶ（2026-09-22 決定）
              stamp?.judgedAsOf ? m.judgements.judgedAsOf(stamp.judgedAsOf) : null,
            ]
              .filter(Boolean)
              .join(" ・ ")}
          </span>
          {/* 今日でない日付で判定してある。帳票にもこの判定が載るので、はっきり断る */}
          {stamp?.judgedAsOf && stamp.today && stamp.judgedAsOf !== stamp.today && (
            <span className="text-destructive ml-2 inline-flex items-center gap-1 text-xs font-normal">
              <TriangleAlert className="size-3" />
              {m.judgements.notToday(stamp.judgedAsOf)}
            </span>
          )}
          {/* 前提（CASリンク・閾値・バージョン）が計算より後に変わった、または施行日・終了日を跨いだ */}
          {stamp?.stale && (
            <span
              className="text-destructive ml-2 inline-flex items-center gap-1 text-xs font-normal"
              title={stamp.staleByDate ? undefined : m.judgements.staleHint}
            >
              <TriangleAlert className="size-3" />
              {stamp.staleByDate ? m.judgements.staleByDate : m.judgements.stale}
            </span>
          )}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* 「開」「閉」は行の先頭（他の表と同じ並び。2026-09-12 指示）。国・法律・区分をまとめて開け閉めする */}
          {countries.length > 0 && (
            <div className="mr-auto flex items-center gap-1">
              {!allJudgementOpen && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title={m.composition.expandAllHint}
                  onClick={() => {
                    setOpenCountries(new Set(countries.map((c) => c.code)));
                    setOpenLaws(new Set(lawKeys));
                    setOpen(new Set(openable));
                  }}
                >
                  <ChevronsUpDown className="mr-1 size-3.5" />
                  {m.composition.expandAll}
                </Button>
              )}
              {!noneJudgementOpen && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title={m.composition.collapseAllHint}
                  onClick={() => {
                    setOpen(new Set());
                    setOpenLaws(new Set());
                    setOpenCountries(new Set());
                  }}
                >
                  <ChevronsDownUp className="mr-1 size-3.5" />
                  {m.composition.collapseAll}
                </Button>
              )}
            </div>
          )}
          <span className="text-muted-foreground">
            {m.judgements.summary(applicable.length, items.length)}
          </span>
          {/* 上の合算表の「? 要確認」と同じ見た目（赤字・印・件数。2026-09-22 指示） */}
          {review.length > 0 && (
            <span
              className={cn(REVIEW_CLASS, "inline-flex items-center gap-1 text-xs")}
              title={m.judgements.needsReviewHint}
            >
              <CircleHelp className="size-3" />
              {m.judgements.reviewCount(review.length)}
            </span>
          )}
          {/*
            再計算。押すと判定対象日を尋ねてから判定し直す（既定は今日。2026-09-22 決定）。
            日付を選べる口でもあるので、前提が変わっていなくても常に出す（判定を直せる人に）
          */}
          {canEdit && (
            <RejudgeButton productId={productId} today={stamp?.today ?? null} onError={setError} />
          )}
          {/*
            非該当も出す切り替え。組成の表の「含有率不足による非該当」と同じ見せ方:
            押しているときは字と印を橙の太字にし、件数はボタンの外に出す（押しても増えないことがある）
          */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={showNotApplicable}
            title={m.judgements.notApplicableHint}
            onClick={() => setShowNotApplicable((v) => !v)}
            className={cn(
              showNotApplicable &&
                cn(NEAR_MISS_CLASS, "hover:text-orange-600 dark:hover:text-orange-400 font-bold"),
            )}
          >
            <TriangleAlert className="mr-1 size-3.5" />
            {m.judgements.notApplicableShow}
          </Button>
          <span className="text-muted-foreground text-sm">
            {m.judgements.notApplicableCount(items.length - applicable.length)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {/*
              判定は法規制バージョンごとに持つ。切り替えた直後はその版の判定がまだ無いので、
              「まだ判定していない」とは分けて伝える（前の版の結果を出すと取り違える）
            */}
            {stamp?.judged
              ? m.judgements.noneRelated
              : stamp?.judgedElsewhere && stamp.versionCode
                ? m.judgements.notJudgedForVersion(stamp.versionCode)
                : m.judgements.empty}
          </p>
        ) : (
          /*
            横に長く、行も多くなる表なので、**この箱の中だけで縦横に送る**
            （画面全体を振らない）。高さを決めておくと、横のスクロールバーが
            箱の下端に来るので、見出しを見ながら動かせる
          */
          <ResizableBox
            storageKey="chem.box.productJudgements"
            scrollerRef={cols.scrollerRef}
            {...cols.rowProps}
          >
            {/* 切れているセルにマウスを置いたとき、中身を全部出す吹き出し */}
            {cols.peek}
            {cols.stickyBar}
            {/*
              table-fixed にして、幅を列の側で決める。
              自動幅だと、法文物質名の長いものが1件あるだけで表全体の形が変わり、
              製品ごとに列の位置がずれて見比べられなくなる。
              幅は一覧と同じ規則で、見出しの右端をつまんで変えられる。
            */}
            <Table
              {...cols.tableProps}
              className={cn(
                "table-fixed border-separate border-spacing-0 text-sm [&_tr>*:first-child]:border-l",
                cols.tableProps.className,
              )}
              // 外側の箱で流すので、表を包む枠は流さない（入れ子にすると見出しを貼り付けられない）
              containerClassName="overflow-visible"
            >
              <colgroup>{cols.cols()}</colgroup>
              {/*
                見出しは箱の上に貼り付ける。**色は行ではなく `TableHeader` に置く。**
                行に置くと、枠線を重ねて描く表（`border-collapse: collapse`）では
                いちばん上の1〜2pxが塗られず、流れていく行がそこから覗く
              */}
              <TableHeader
                className={cn(
                  // th は自分の字色を持つ（text-foreground）ので、見出しの字色を継がせる
                  "table-head-solid text-table-head-foreground sticky top-0 z-20 [&_th]:text-inherit",
                )}
              >
                {/* 色と枠線は組成の表にそろえる。並べて見るので、別物に見えると困る */}
                <TableRow className="hover:bg-transparent [&>th]:border-t">
                  {HEADS.map(({ key, label, className }, i) => (
                    <TableHead key={key} className={cn(CELL, "relative h-auto", className)}>
                      {/* 行の高さのつまみは、いちばん左の見出しに1つだけ */}
                      {i === 0 && cols.rowHandle()}
                      {label(m)}
                      {cols.handle(key, `${label(m)} ${m.table.resize}`)}
                    </TableHead>
                  ))}
                  {canEdit && (
                    <TableHead className={cn(CELL, "relative h-auto")}>
                      {cols.handle("actions", m.table.resize)}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {countries.map((c, ci) => {
                  const countryOpen = openCountries.has(c.code);
                  const t = countryTotals.get(c.code) ?? { total: 0, applicable: 0, review: 0 };
                  /*
                    国の欄は**その国の行を全部またいで1つ**にする（2026-09-11 指示）。
                    開いているあいだは、区分の行と、開いた区分の法文物質名の行のぶんだけ縦に伸びる
                  */
                  const span = spanOf(c);
                  const region = regionSpan.get(ci);
                  return (
                    <Fragment key={`country:${c.code}`}>
                      {/* 国の行。押すと、その国の法律と区分が開く。件数はその国の全区分で数える */}
                      <TableRow className="bg-muted/60">
                        {/* 地域の欄。その地域の最初の国の行にだけ置き、地域の行を全部またぐ */}
                        {region !== undefined && (
                          <TableCell
                            className={cn(CELL, "bg-muted/60 align-top font-medium")}
                            rowSpan={region}
                          >
                            <OneLine text={c.regionLabel} />
                          </TableCell>
                        )}
                        <TableCell
                          className={cn(CELL, "bg-muted/60 align-top font-medium")}
                          rowSpan={span}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCountry(c.code)}
                            aria-expanded={countryOpen}
                            aria-label={countryOpen ? m.composition.collapse : m.composition.expand}
                            className="hover:text-foreground -ml-1 flex w-full items-center gap-1 text-left"
                          >
                            <ChevronRight
                              className={cn(
                                "text-muted-foreground size-4 shrink-0 transition-transform",
                                countryOpen && "rotate-90",
                              )}
                            />
                            <OneLine text={c.label} />
                          </button>
                        </TableCell>
                        <TableCell
                          className={cn(CELL, "text-muted-foreground align-top text-xs")}
                          colSpan={HEADS.length - 2 + (canEdit ? 1 : 0)}
                        >
                          {summaryText(t)}
                        </TableCell>
                      </TableRow>
                      {countryOpen &&
                        c.laws.map((l) => {
                          const lawOpen = openLaws.has(l.key);
                          return (
                            <Fragment key={`law:${l.key}`}>
                              {/* 法律の行。国と同じく、押すと中の区分が開く。欄は法律の行を全部またぐ */}
                              <TableRow className="bg-muted/30">
                                <TableCell
                                  className={cn(CELL, "bg-muted/30 align-top font-medium")}
                                  rowSpan={lawSpanOf(l)}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleLaw(l.key)}
                                    aria-expanded={lawOpen}
                                    aria-label={
                                      lawOpen ? m.composition.collapse : m.composition.expand
                                    }
                                    className="hover:text-foreground -ml-1 flex w-full items-center gap-1 text-left"
                                  >
                                    <ChevronRight
                                      className={cn(
                                        "text-muted-foreground size-4 shrink-0 transition-transform",
                                        lawOpen && "rotate-90",
                                      )}
                                    />
                                    <OneLine text={l.label} />
                                  </button>
                                </TableCell>
                                <TableCell
                                  className={cn(CELL, "text-muted-foreground align-top text-xs")}
                                  colSpan={HEADS.length - 3 + (canEdit ? 1 : 0)}
                                >
                                  {summaryText(lawTotals.get(l.key))}
                                </TableCell>
                              </TableRow>
                              {lawOpen &&
                                l.categories.map((g) => {
                                  const opened = open.has(g.categoryId);
                                  const many = childrenOf(g) > 0;
                                  /*
                                    区分そのものが判定の単位（区分でまとめる区分・根拠を伏せた相手）なら、
                                    区分の行にラベルと判定修正を置き、開くと根拠の行が 1 つ出る。
                                    法文物質名が単位なら、区分の行は件数の見出しで、開くと単位の行が並ぶ
                                  */
                                  const own = g.unit === "category" ? g.items[0]! : null;
                                  return (
                                    <Fragment key={g.categoryId}>
                                      <TableRow>
                                        <TableCell className={cn(CELL, "align-top")}>
                                          {many ? (
                                            <button
                                              type="button"
                                              onClick={() => toggle(g.categoryId)}
                                              aria-expanded={opened}
                                              aria-label={
                                                opened
                                                  ? m.composition.collapse
                                                  : m.composition.expand
                                              }
                                              className="hover:text-foreground -ml-1 flex w-full items-center gap-1 text-left"
                                            >
                                              <ChevronRight
                                                className={cn(
                                                  "text-muted-foreground size-4 shrink-0 transition-transform",
                                                  opened && "rotate-90",
                                                )}
                                              />
                                              <OneLine text={g.label} />
                                            </button>
                                          ) : (
                                            /* 区分そのものが単位のとき、非該当なら名前を ⚠ 付きの橙色の字にする（非該当を出しているとき） */
                                            <OneLine
                                              text={g.label}
                                              notApplicable={
                                                !!own &&
                                                own.verdict !== "APPLICABLE" &&
                                                own.effective === "IN_FORCE"
                                              }
                                              dimmed={!!own && own.effective !== "IN_FORCE"}
                                            />
                                          )}
                                          {/* 区分ごと施行前・適用終了なら、区分の行に印を付ける（中の行には付けない） */}
                                          {(() => {
                                            const ce = categoryEffective(g);
                                            return ce ? (
                                              <Badge variant="outline" className="mt-1">
                                                {effectiveLabel(m, ce)}
                                              </Badge>
                                            ) : null;
                                          })()}
                                        </TableCell>
                                        <TableCell className={CELL} />
                                        {/*
                                          法文物質名が単位なら、ここは件数の見出し。
                                          区分そのものが単位なら、閉じているあいだ根拠の件数を出す
                                          （空欄にすると「何にも当たっていない」に見える）
                                        */}
                                        <TableCell
                                          className={cn(
                                            CELL,
                                            "text-muted-foreground align-top text-xs",
                                          )}
                                        >
                                          {own
                                            ? many && !opened && m.judgements.hitCount(1)
                                            : summaryText(categoryTotals.get(g.categoryId))}
                                          {own?.hitsWithheld && (
                                            <span className="block">
                                              {m.judgements.basisWithheld}
                                            </span>
                                          )}
                                        </TableCell>
                                        <TableCell className={CELL} />
                                        <TableCell className={CELL} />
                                        {/* ランクは物質に付くものなので、区分の行には出さない */}
                                        <TableCell className={CELL} />
                                        <TableCell className={cn(CELL, "align-top")}>
                                          {own && <Warning j={own} m={m} locale={locale} />}
                                        </TableCell>
                                        {canEdit && (
                                          <TableCell className={cn(CELL, "align-top")}>
                                            {own && (
                                              <Actions
                                                j={own}
                                                m={m}
                                                editing={editing}
                                                note={note}
                                                busy={busy}
                                                setEditing={setEditing}
                                                setNote={setNote}
                                                decide={decide}
                                              />
                                            )}
                                          </TableCell>
                                        )}
                                      </TableRow>

                                      {/* 中身。区分そのものが単位なら根拠の行、法文物質名が単位なら判定の単位の行 */}
                                      {opened &&
                                        (own
                                          ? own.hits.map((h, i) => (
                                              <TableRow
                                                key={`${g.categoryId}-${i}`}
                                                className="bg-muted/40"
                                              >
                                                <TableCell className={CELL} />
                                                <TableCell
                                                  className={cn(
                                                    CELL,
                                                    "align-top font-mono text-xs",
                                                  )}
                                                >
                                                  {h.officialNumber ?? ""}
                                                </TableCell>
                                                <TableCell className={cn(CELL, "align-top")}>
                                                  <OneLine text={hitName(h, locale, m)} />
                                                </TableCell>
                                                <MatchedCells hit={h} m={m} cellClass={CELL} />
                                                <RankCell h={h} m={m} />
                                                <TableCell className={CELL} />
                                                {canEdit && <TableCell className={CELL} />}
                                              </TableRow>
                                            ))
                                          : g.items.map((j) => (
                                              <TableRow key={j.id} className="bg-muted/40">
                                                <TableCell className={CELL} />
                                                <TableCell
                                                  className={cn(
                                                    CELL,
                                                    "align-top font-mono text-xs",
                                                  )}
                                                >
                                                  {j.officialNumber ?? ""}
                                                </TableCell>
                                                <TableCell className={cn(CELL, "align-top")}>
                                                  {/*
                                                    判定の列は置いていない。非該当を出しているときだけ、
                                                    非該当のものは名前が ⚠ 付きの橙色の字になる（組成の表と同じ印。普通の字＝該当）
                                                  */}
                                                  <OneLine
                                                    text={unitName(j, locale, m)}
                                                    notApplicable={
                                                      j.verdict !== "APPLICABLE" &&
                                                      j.effective === "IN_FORCE"
                                                    }
                                                    dimmed={j.effective !== "IN_FORCE"}
                                                  />
                                                  {/*
                                                    施行前・適用終了。該当に数えない非該当で、いつから・いつまでかを添える
                                                    （2026-09-22 決定）。区分ごとのときは区分の行に付けるので、ここには付けない
                                                  */}
                                                  {j.effective !== "IN_FORCE" &&
                                                    j.effectiveScope !== "category" && (
                                                      <Badge variant="outline" className="mt-1">
                                                        {effectiveLabel(m, j)}
                                                      </Badge>
                                                    )}
                                                </TableCell>
                                                {j.hits[0] ? (
                                                  <MatchedCells
                                                    hit={j.hits[0]}
                                                    m={m}
                                                    cellClass={CELL}
                                                  />
                                                ) : (
                                                  <>
                                                    <TableCell className={CELL} />
                                                    <TableCell className={CELL} />
                                                  </>
                                                )}
                                                <RankCell h={j.hits[0]} m={m} />
                                                <TableCell className={cn(CELL, "align-top")}>
                                                  <Warning j={j} m={m} locale={locale} />
                                                </TableCell>
                                                {canEdit && (
                                                  <TableCell className={cn(CELL, "align-top")}>
                                                    <Actions
                                                      j={j}
                                                      m={m}
                                                      editing={editing}
                                                      note={note}
                                                      busy={busy}
                                                      setEditing={setEditing}
                                                      setNote={setNote}
                                                      decide={decide}
                                                    />
                                                  </TableCell>
                                                )}
                                              </TableRow>
                                            )))}
                                    </Fragment>
                                  );
                                })}
                            </Fragment>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </ResizableBox>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 「確認する」「判定修正」の欄。判定の単位の行（区分そのものが単位なら区分の行）に置く。
 * 施行前・適用終了の行は該当に数えない非該当なので、確認も修正もできない（2026-09-22 決定）
 */
function Actions({
  j,
  m,
  editing,
  note,
  busy,
  setEditing,
  setNote,
  decide,
}: {
  j: ProductJudgementDto;
  m: M;
  editing: string | null;
  note: string;
  busy: boolean;
  setEditing: (id: string | null) => void;
  setNote: (v: string) => void;
  decide: (judgementId: string, verdict?: "APPLICABLE" | "NOT_APPLICABLE") => Promise<void>;
}) {
  if (j.effective !== "IN_FORCE") return null;
  if (editing !== j.id) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setEditing(j.id);
          setNote(j.decidedNote ?? "");
        }}
      >
        {j.needsReview ? m.judgements.review : m.judgements.change}
      </Button>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        // 列の幅いっぱい。決め打ちにすると列より広くなって切れる
        className="h-8 w-full"
        placeholder={m.judgements.notePlaceholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={busy} onClick={() => void decide(j.id)}>
          <Check className="mr-1 size-3.5" />
          {/* いまの判定のまま確認する。文言はいまの判定（非該当なら「非該当」） */}
          {j.verdict === "APPLICABLE" ? m.judgements.changeToYes : m.judgements.changeToNot}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void decide(j.id, j.verdict === "APPLICABLE" ? "NOT_APPLICABLE" : "APPLICABLE")
          }
        >
          {j.verdict === "APPLICABLE" ? m.judgements.changeToNot : m.judgements.changeToYes}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(null);
            setNote("");
          }}
        >
          {m.common.cancel}
        </Button>
      </div>
    </div>
  );
}

/** その行を作った物質のランク。スコア（合算した行は寄与ぶんの合計）は浮かせて見せる */
function RankCell({ h, m }: { h: JudgementHitDto | undefined; m: M }) {
  return (
    <TableCell
      className={cn(CELL, "text-center align-top whitespace-nowrap")}
      title={h?.score !== undefined ? m.score.scoreOf(h.score) : undefined}
    >
      {h?.score !== undefined ? (h.scoreRank ?? m.score.noRank) : ""}
    </TableCell>
  );
}

/**
 * 判定の単位の行に添える警告。**確認が残っているかどうかと、誰がいつ確認したか。**
 *
 * 理由の無い警告は読まれなくなるので、なぜ気になるのかを必ず添える。
 */
function Warning({
  j,
  m,
  locale,
}: {
  j: ProductJudgementDto;
  m: M;
  locale: ReturnType<typeof useI18n>["locale"];
}) {
  /*
    不純物種別で除外した寄与（S21）。**黙って消さない。**
    「その CAS は入っているのに非該当」の理由がここでしか読めない
  */
  const excluded = j.hits.flatMap((h) => h.excluded ?? []);

  return (
    <>
      {excluded.length > 0 && (
        <p
          className="text-muted-foreground inline-flex items-center gap-1 text-xs"
          title={m.impurityTypes.excludedHint}
        >
          <Droplets className="size-3" />
          {m.impurityTypes.excluded}
          <span className="font-mono">
            （{excluded.map((x) => `${x.cas} ${x.pct}%`).join("、")}）
          </span>
        </p>
      )}
      {/*
        **警告と要確認は別。**要確認でなくても、気を付けることがあれば必ず出す。
        条件つきで結ばれたCASは、システム設定によっては要確認にせず警告だけになる
      */}
      {j.reviewReasons.length > 0 && (
        <div className="space-y-1">
          {/* 囲みも太字も付けない。行の幅を食うので、印と色だけで示す */}
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              j.needsReview ? "text-destructive" : "text-muted-foreground",
            )}
            title={j.needsReview ? m.judgements.needsReviewHint : undefined}
          >
            {/*
              **要確認と警告で印を分ける。**要確認は「判定が変わるかもしれない」なので
              「?」、警告は気を付ける相手なので三角。同じ印だと区別が付かない
            */}
            {j.needsReview ? (
              <CircleHelp className="size-3" />
            ) : (
              <TriangleAlert className="size-3" />
            )}
            {j.needsReview ? m.judgements.needsReview : m.judgements.warning}
          </span>
          <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
            {reasonTexts(m, j).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {/* 前提が変わって当てはめなかった以前の判断。何を外したのかが分からないと判断し直せない */}
          {j.droppedDecision && (
            <p className="text-muted-foreground pl-4 text-xs">
              {m.judgements.droppedDecision(
                j.droppedDecision.verdict === null
                  ? m.judgements.droppedConfirmOnly
                  : j.droppedDecision.verdict === "APPLICABLE"
                    ? m.judgements.applicable
                    : m.judgements.notApplicable,
                j.droppedDecision.decidedByName ?? "",
                new Date(j.droppedDecision.decidedAt).toLocaleString(locale),
              )}
              {j.droppedDecision.decidedNote && ` — ${j.droppedDecision.decidedNote}`}
            </p>
          )}
        </div>
      )}
      {!j.needsReview && j.decidedByName && (
        <p className="text-muted-foreground text-xs">
          {m.judgements.decidedBy(
            j.decidedByName,
            j.decidedAt ? new Date(j.decidedAt).toLocaleString(locale) : "",
          )}
          {j.decidedNote && ` — ${j.decidedNote}`}
        </p>
      )}
      {j.source === "USER" && (
        <Badge variant="outline" className="mt-1">
          {m.judgements.byUser}
        </Badge>
      )}
    </>
  );
}

/**
 * 当たった含有率と CAS の出しかた。**含有率のセルと CAS のセットで1組。**
 * 必ず隣り合わせで置く（間に別の列を挟むと読めなくなる）。
 *
 * **合算したのか、個別に当たったのかは「区切り線」で見分ける。**
 * どちらも複数の CAS が縦に並ぶので、見分けが付かないと
 * 「足して超えた」のか「それぞれが超えた」のかを取り違える。
 *
 *   合算 … 含有率は合計ひとつ。CAS はその下に並ぶだけで、線は入らない
 *   個別 … CAS ごとに薄い線で区切り、その左に各 CAS の含有率を並べる
 *
 * 「合算」の札は出さない。**通常は合算で、CAS が1つなら区別する意味も無い。**
 * 札を並べると、読む値より札のほうが目立つ。
 *
 * 1つの CAS が1行を超えないようにしてある。行が増えると表が縦に伸び、
 * 何件当たったのかが読み取りにくくなるため。
 */
export function MatchedCells({
  hit,
  m,
  cellClass = "",
}: {
  hit: JudgementHitDto;
  m: M;
  /** セルに足す枠線・余白。並べる表に合わせる */
  cellClass?: string;
}) {
  // 合計が入っているのは、まとめて比べたときだけ
  const aggregated = hit.total !== null;

  if (aggregated) {
    return (
      <>
        <TableCell
          className={cn(cellClass, "text-right align-top font-mono tabular-nums")}
          title={m.judgements.aggregated}
        >
          {hit.total}%
        </TableCell>
        <TableCell className={cn(cellClass, "align-top font-mono text-xs")}>
          {hit.contributions.map((c) => (
            // 各CASがいくら効いたかは、合算では畳んである。触れれば読める
            <div key={c.cas} title={`${c.cas} ${c.pct}%`}>
              {c.cas}
            </div>
          ))}
        </TableCell>
      </>
    );
  }

  /** 区切り線の高さを左右で揃えるため、同じ余白・同じ文字の大きさで並べる */
  const cell = "px-2 py-1 leading-5";
  return (
    <>
      <TableCell className={cn(cellClass, "p-0 align-top")} title={m.judgements.individually}>
        <div className="divide-border/60 divide-y">
          {hit.contributions.map((c) => (
            <div key={c.cas} className={`${cell} text-right font-mono tabular-nums`}>
              {c.pct}%
            </div>
          ))}
        </div>
      </TableCell>
      <TableCell className={cn(cellClass, "p-0 align-top")}>
        <div className="divide-border/60 divide-y">
          {hit.contributions.map((c) => (
            <div key={c.cas} className={`${cell} font-mono text-xs`}>
              {c.cas}
            </div>
          ))}
        </div>
      </TableCell>
    </>
  );
}

/**
 * 長い名前を1行に収める。**行を増やさないために、セルの中だけ横に送る。**
 * 折り返すと1件で何行も使い、何件当たったのかが読み取れなくなる。
 *
 * **スクロールバーは出さない。**表の中に細い横棒が何本も並ぶと、
 * 行の区切りと見分けが付かず、表そのものが読みにくくなる。
 * 全文は触れれば読める（title）。
 */
/**
 * 当たった法文物質名の1行ぶんの字。
 * 元素換算でまとめて判定したものは、名前の後ろに「（鉛として）」と添える（2026-09-11 指示）。
 * 区分そのものが当たったときは「（区分の合計）」
 */
export function hitName(
  h: JudgementHitDto,
  locale: ReturnType<typeof useI18n>["locale"],
  m: M,
): string {
  if (!h.name) return m.judgements.categoryItself;
  if (!h.asElement) return h.name;
  return `${h.name} ${m.judgements.asElement(locale === "ja" ? h.asElement.nameJa : h.asElement.nameEn)}`;
}

/**
 * 施行前・適用終了の印の文言。区分ごとなら「区分の…」と断る。
 * 該当に数えない非該当であることが、いつから・いつまでかと一緒に読める（2026-09-22 決定）
 */
export function effectiveLabel(
  m: M,
  j: {
    effective: "IN_FORCE" | "NOT_YET" | "EXPIRED";
    effectiveScope: "category" | "substance" | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  },
): string {
  const byCategory = j.effectiveScope === "category";
  if (j.effective === "NOT_YET") {
    return byCategory
      ? m.judgements.notYetCategory(j.effectiveFrom ?? "")
      : m.judgements.notYetEffective(j.effectiveFrom ?? "");
  }
  return byCategory
    ? m.judgements.expiredCategory(j.effectiveTo ?? "")
    : m.judgements.expired(j.effectiveTo ?? "");
}

/** その区分の行に付ける印。中の行がすべて「区分ごと効いていない」なら、その 1 件を返す */
function categoryEffective(g: { items: ProductJudgementDto[] }): ProductJudgementDto | null {
  const first = g.items[0];
  if (!first || first.effectiveScope !== "category") return null;
  return g.items.every((x) => x.effectiveScope === "category") ? first : null;
}

/** 判定の単位の行の名前。区分そのものが単位なら「（区分の合計）」、元素換算なら「（鉛として）」を添える */
export function unitName(
  j: Pick<ProductJudgementDto, "statutoryName" | "asElement">,
  locale: ReturnType<typeof useI18n>["locale"],
  m: M,
): string {
  if (!j.statutoryName) return m.judgements.categoryItself;
  if (!j.asElement) return j.statutoryName;
  return `${j.statutoryName} ${m.judgements.asElement(locale === "ja" ? j.asElement.nameJa : j.asElement.nameEn)}`;
}

export function OneLine({
  text,
  notApplicable,
  dimmed,
}: {
  text: string;
  notApplicable?: boolean;
  /** 施行前・適用終了の行。薄い字にして、効いていないことを見た目でも示す */
  dimmed?: boolean;
}) {
  const { m } = useI18n();
  return (
    <div
      className={cn(
        "overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        notApplicable && NEAR_MISS_CLASS,
        dimmed && "text-muted-foreground",
      )}
      title={notApplicable ? text + "\n" + m.judgements.notApplicable : text}
    >
      {/* 非該当の印。組成の表の「含有率不足による非該当」と同じ三角 */}
      {notApplicable && (
        <TriangleAlert className="mr-0.5 inline size-3 align-[-0.1em]" aria-hidden />
      )}
      {text}
    </div>
  );
}

/**
 * 判定の行に付いている適用条件。
 * 法文物質名が単位ならその条件、区分が単位なら当たった法文物質名の条件を重複なしで集める
 */
export function conditionsOf(j: {
  applicableCondition: string | null;
  hits?: { applicableCondition: string | null }[];
}): string[] {
  const list = [j.applicableCondition, ...(j.hits ?? []).map((h) => h.applicableCondition)]
    .map((c) => (c ?? "").trim())
    .filter((c) => c !== "");
  return [...new Set(list)];
}

/**
 * 要確認の理由の並び。**適用条件が書いてあれば、決まり文句ではなく条文そのものを出す**
 * （2026-09-20 指示。毎回同じ文では何を確かめればよいのか分からない。
 * 「適用条件「…」。この条件に当たらなければ…」の飾りも外し、条文だけにする）
 */
export function reasonTexts(
  m: M,
  j: {
    reviewReasons: string[];
    applicableCondition: string | null;
    hits?: { applicableCondition: string | null }[];
  },
): string[] {
  const conditions = conditionsOf(j);
  return j.reviewReasons.flatMap((r) =>
    r === "conditionalExclusion" && conditions.length > 0 ? conditions : [reasonText(m, r)],
  );
}

/** なぜ確認が要るのか。次に何をすべきかが分かる言葉にする */
export function reasonText(m: M, reason: string): string {
  const table: Record<string, string> = {
    missingFactor: m.judgements.reasonMissingFactor,
    unknownComposition: m.judgements.reasonUnknown,
    truncated: m.judgements.reasonTruncated,
    conditionalExclusion: m.judgements.reasonConditional,
    unfilledThreshold: m.judgements.reasonUnfilled,
    conditionalLink: m.judgements.reasonConditionalLink,
    homogeneousMaterial: m.judgements.reasonHomogeneous,
    decisionDropped: m.judgements.reasonDecisionDropped,
  };
  return table[reason] ?? reason;
}
