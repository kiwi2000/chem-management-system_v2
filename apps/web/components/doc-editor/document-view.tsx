"use client";

import {
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  effectiveMargin,
  ownFontSize,
  fontStack,
  groupIntoRows,
  type BlockStyle,
  spacerMm,
  type BlockMargin,
  bandTextForPreview,
  DEFAULT_BAND_SIZE,
  DEFAULT_TITLE_SIZE,
  pageMarginOf,
  type PageMargin,
} from "@chem/shared";
import { Printer } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { createContext, useContext, type CSSProperties } from "react";
import { printPageMargin } from "@/components/doc-editor/print-orientation";
import type {
  RenderBlock,
  RenderLine,
  RenderedBand,
  RenderedDocument,
  RenderedPage,
} from "@/lib/doc-render";

/**
 * できあがった帳票を出す。
 *
 * **PDF はブラウザの印刷に任せる。**サーバーに変換の道具を置かずに済み、
 * 日本語も見ている人の端末のフォントで正しく出る。
 * 印刷の画面でプリンターを「PDFとして保存」に変えると PDF になるので、
 * その断りをボタンの横に添える（分かる人だけが使える機能にしない）。
 *
 * **保存するときのファイル名は、ページの題名で決まる。**
 * ここでは触らない。`document.title` を書き換えても Next.js が上書きするので、
 * 呼ぶ側（`generateMetadata`）で決めている。
 *
 * **紙に出るのは帳票だけ。**上のボタンや知らせは印刷では消える（`no-print`）。
 */
export function DocumentView({
  doc,
  title,
  backHref,
}: {
  doc: RenderedDocument;
  title: string;
  backHref: string;
}) {
  const { m } = useI18n();
  const unknown = doc.warnings
    .filter((w) => w.startsWith("unknownFields:"))
    .flatMap((w) => w.slice("unknownFields:".length).split(","));

  return (
    <div className="w-full">
      <div className="no-print flex flex-wrap items-center justify-between gap-3 p-3 lg:p-4">
        <Link href={backHref} className="text-muted-foreground text-xs underline">
          {title}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-xs">{m.documents.printHint}</span>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" />
            {m.documents.print}
          </Button>
        </div>
      </div>

      {unknown.length > 0 && (
        <div className="no-print px-3 lg:px-4">
          <Alert>
            <AlertDescription>
              {m.documents.unknownFields}
              <span className="block font-mono text-xs">{unknown.join(" ")}</span>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <DocumentSheet doc={doc} />
    </div>
  );
}

/**
 * 紙面1枚ぶん。画面では枠を付け、印刷では枠を消す。
 * **まとめて作るときも同じものを使う。**別々に組むと見た目が分かれる
 */
/**
 * 画像ブロックの絵の出どころ。ふつうは API（ログインした人が見る）。
 * 印刷用ページ（PDF 化）は Cookie を持たないブラウザが開くので、data: URL を渡して埋め込む
 */
const ImageSourceContext = createContext<Record<string, string>>({});
export function imageSrc(sources: Record<string, string>, id: string): string {
  return sources[id] ?? `/api/images/${id}`;
}

export function DocumentSheet({
  doc,
  highlightIds,
  cornerNote,
  imageSources = {},
}: {
  doc: RenderedDocument;
  /** 画像 id → 絵の出どころ（data: URL）。省略すると API から読む */
  imageSources?: Record<string, string>;
  /** 編集画面で選んでいるブロックの id（複数可）。そのブロックを赤い細線で囲む（刷るときは渡さない） */
  highlightIds?: readonly string[];
  /** 紙の右上の角に重ねる短い断り（編集画面の「見本の値」。刷るときは渡さない） */
  cornerNote?: string;
}) {
  const page = doc.page;
  const margin = pageMarginOf(page);
  const printMargin = printPageMargin(page);
  const border = page?.border;
  const borderCss = border ? `${border.widthMm}mm ${border.style} ${border.color}` : undefined;
  const segments = segmentRows(groupIntoRows(doc.blocks), page);
  return (
    <div
      /*
        紙面ぜんたいの字。**ここに当てて、下へ受け継がせる。**
        ブロックの側で指定があれば、そちらが勝つ（子の指定は親より強い）
      */
      /* 選ばれていなければゴシック。刷る機械まかせにすると、人によって字が変わる */
      style={{
        fontFamily: fontStack(DEFAULT_FONT),
        ...styleOf(doc.style),
        ...decorOf(doc.style, false),
        // 余白は用紙の設定。刷るときは @page が持つので、PrintPageStyle が上書きする
        padding: `${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm`,
      }}
      className="doc-sheet relative mx-auto my-4 max-w-[210mm] bg-white text-black shadow print:m-0 print:max-w-none print:shadow-none"
    >
      {/* 用紙全体の枠。画面では紙面（この箱）の端から、刷るときは紙の端から測る（position: fixed は紙ごとに繰り返し描かれる） */}
      {border && borderCss && (
        <>
          <div
            className="pointer-events-none absolute print:hidden"
            style={{ inset: `${border.insetMm}mm`, border: borderCss }}
          />
          <div
            className="pointer-events-none hidden print:block"
            style={{
              position: "fixed",
              top: `${border.insetMm - printMargin.top}mm`,
              right: `${border.insetMm - printMargin.right}mm`,
              bottom: `${border.insetMm - printMargin.bottom}mm`,
              left: `${border.insetMm - printMargin.left}mm`,
              border: borderCss,
            }}
          />
        </>
      )}
      {/* ヘッダー・フッターの画面用の見本。刷るときは @page の余白の箱に出るので、ここでは隠す */}
      {page?.header && <BandPreview band={page.header} side="top" margin={margin} />}
      {page?.footer && <BandPreview band={page.footer} side="bottom" margin={margin} />}
      {cornerNote && (
        <p
          className="text-destructive absolute top-0 right-0 m-0 text-xs font-normal"
          style={{ top: "3mm", right: "3mm" }}
        >
          {cornerNote}
        </p>
      )}
      {/*
        横に並ぶものは、編集画面と同じ規則でまとめる（`groupIntoRows`）。
        別々に組むと、書いたとおりに刷られない
      */}
      {/*
        タイトルは 1 ページ目の中身の先頭。**最初の区間の中に入れる。**
        外に置くと、帯を出さない紙（pg-00 など）との境目で紙が変わり、タイトルだけの 1 枚目ができる
      */}
      <ImageSourceContext.Provider value={imageSources}>
        {segments.map((seg, s) => (
          <div key={s} className={`doc-${seg.name}`}>
            {s === 0 && page?.title && (
              <p
                style={{
                  margin: "0 0 4mm",
                  fontSize: `${page.title.size ?? DEFAULT_TITLE_SIZE}pt`,
                  fontWeight: page.title.bold === false ? 400 : 700,
                  textAlign: page.title.align ?? "center",
                  ...(page.title.color ? { color: page.title.color } : {}),
                }}
              >
                {page.title.text}
              </p>
            )}
            {seg.rows.map((row, i) =>
              row.blocks.length === 1 ? (
                <Block key={i} block={row.blocks[0]!} doc={doc.style} highlightIds={highlightIds} />
              ) : (
                <div key={i} style={{ display: "flex", gap: "4mm", alignItems: "flex-start" }}>
                  {row.blocks.map((b, j) => (
                    <div key={j} style={{ width: `${row.percents[j]}%` }}>
                      <Block block={b} doc={doc.style} highlightIds={highlightIds} />
                    </div>
                  ))}
                </div>
              ),
            )}
          </div>
        ))}
      </ImageSourceContext.Provider>
    </div>
  );
}

/**
 * 帯（ヘッダー・フッター）の開始ページより前の紙を、名前付きの紙（pg-<ヘッダー><フッター>）で包む。
 * ページは「改ページ」のブロックで数える。名前が変わる境目にある改ページは、
 * 紙の名前が変わるだけで紙が変わるので落とす（残すと白紙が挟まる）
 */
function segmentRows(
  rows: ReturnType<typeof groupIntoRows<RenderBlock>>,
  page: RenderedPage | undefined,
): { name: string; rows: ReturnType<typeof groupIntoRows<RenderBlock>> }[] {
  const hasH = !!page?.header;
  const hasF = !!page?.footer;
  const hs = page?.header?.startPage ?? 1;
  const fs = page?.footer?.startPage ?? 1;
  if ((!hasH || hs <= 1) && (!hasF || fs <= 1)) return [{ name: "pg-11", rows }];
  const out: { name: string; rows: typeof rows }[] = [];
  let breaks = 0;
  for (const row of rows) {
    const h = !hasH || breaks >= hs - 1 ? 1 : 0;
    const f = !hasF || breaks >= fs - 1 ? 1 : 0;
    const name = `pg-${h}${f}`;
    const last = out[out.length - 1];
    if (last && last.name === name) last.rows.push(row);
    else out.push({ name, rows: [row] });
    breaks += row.blocks.filter((b) => b.kind === "pageBreak").length;
  }
  // ブロックが無くても区間は 1 つ置く（タイトルの置き場）
  if (out.length === 0) out.push({ name: `pg-${hs <= 1 ? 1 : 0}${fs <= 1 ? 1 : 0}`, rows: [] });
  for (let i = 0; i < out.length - 1; i++) {
    const seg = out[i]!;
    const tail = seg.rows[seg.rows.length - 1];
    if (tail && tail.blocks.length === 1 && tail.blocks[0]!.kind === "pageBreak") seg.rows.pop();
  }
  return out;
}

/** ヘッダー・フッターの画面用の見本。紙面の上下の余白に薄く出す（ページ番号は 1 / 1） */
function BandPreview({
  band,
  side,
  margin,
}: {
  band: RenderedBand;
  side: "top" | "bottom";
  margin: PageMargin;
}) {
  const size = `${band.size ?? DEFAULT_BAND_SIZE}pt`;
  return (
    <div
      className="pointer-events-none absolute right-0 left-0 grid items-center print:hidden"
      style={{
        [side]: 0,
        height: `${side === "top" ? margin.top : margin.bottom}mm`,
        padding: `0 ${margin.right}mm 0 ${margin.left}mm`,
        gridTemplateColumns: "1fr auto 1fr",
        fontSize: size,
        whiteSpace: "pre",
        ...(band.color ? { color: band.color } : {}),
      }}
    >
      <span style={{ textAlign: "left" }}>{bandTextForPreview(band.left ?? "")}</span>
      <span style={{ textAlign: "center" }}>{bandTextForPreview(band.center ?? "")}</span>
      <span style={{ textAlign: "right" }}>{bandTextForPreview(band.right ?? "")}</span>
    </div>
  );
}

/** 段落1つ。装飾はそのまま style に流す */
function Line({ line }: { line: RenderLine }) {
  return (
    <p style={{ textAlign: line.align ?? "left", margin: 0 }}>
      {line.spans.map((s, i) => (
        <span
          key={i}
          style={{
            ...(s.bold ? { fontWeight: 700 } : {}),
            ...(s.italic ? { fontStyle: "italic" } : {}),
            ...(s.underline ? { textDecoration: "underline" } : {}),
            ...(s.color ? { color: s.color } : {}),
            ...(s.size ? { fontSize: `${s.size}pt` } : {}),
          }}
        >
          {s.text}
        </span>
      ))}
      {/* 空の行でも高さを保つ。詰まると原稿の見た目と変わってしまう */}
      {line.spans.every((s) => s.text === "") && " "}
    </p>
  );
}

/**
 * ブロック全体に効かせる字。
 *
 * **土台として当てる。**文章・見出しの中で文字ごとに指定があれば、そちらが勝つ
 * （子の指定は親より強い、という CSS の並びをそのまま使う）
 */
function styleOf(st: BlockStyle | undefined): CSSProperties {
  if (!st) return {};
  return {
    ...(fontStack(st.family) ? { fontFamily: fontStack(st.family) } : {}),
    ...(st.size ? { fontSize: `${st.size}pt` } : {}),
    ...(st.bold ? { fontWeight: 700 } : {}),
    ...(st.italic ? { fontStyle: "italic" } : {}),
    ...(st.underline ? { textDecoration: "underline" } : {}),
    ...(st.color ? { color: st.color } : {}),
  };
}

/** 背景の模様。薄い線や点を CSS の階調で描く（画像を持たない） */
function patternOf(kind: NonNullable<BlockStyle["pattern"]>, color: string): CSSProperties {
  const line = `${color} 0 0.25mm, transparent 0.25mm 2mm`;
  switch (kind) {
    case "stripes":
      return { backgroundImage: `repeating-linear-gradient(0deg, ${line})` };
    case "verticalStripes":
      return { backgroundImage: `repeating-linear-gradient(90deg, ${line})` };
    case "diagonal":
      return { backgroundImage: `repeating-linear-gradient(45deg, ${line})` };
    case "dots":
      return {
        backgroundImage: `radial-gradient(${color} 0.3mm, transparent 0.35mm)`,
        backgroundSize: "2mm 2mm",
      };
    case "grid":
      return {
        backgroundImage: `repeating-linear-gradient(0deg, ${line}), repeating-linear-gradient(90deg, ${line})`,
      };
  }
}

/**
 * ブロックの飾り（背景色・模様・枠線）。字の指定（styleOf）とは別に、入れものに当てる。
 * `pad` なら中身に少し余白を取る（紙面ぜんたいの入れものは自分の余白を持つので取らない）。
 * 背景は刷るときに落とされやすいので、色をそのまま刷るよう指定しておく
 */
function decorOf(st: BlockStyle | undefined, pad: boolean): CSSProperties {
  if (!st) return {};
  const out: CSSProperties = {};
  if (st.background) out.backgroundColor = st.background;
  if (st.pattern) Object.assign(out, patternOf(st.pattern, st.patternColor ?? "#9ca3af"));
  if (st.borderStyle) {
    out.border = `${st.borderWidth ?? 0.3}mm ${st.borderStyle} ${st.borderColor ?? "#000"}`;
  }
  if (Object.keys(out).length === 0) return {};
  if (pad) out.padding = "1.5mm 2mm";
  out.WebkitPrintColorAdjust = "exact";
  out.printColorAdjust = "exact";
  return out;
}

/** 余白を CSS にする（mm）。4辺とも書く */
function marginOf(mg: Required<BlockMargin>): CSSProperties {
  return {
    marginTop: `${mg.top}mm`,
    marginRight: `${mg.right}mm`,
    marginBottom: `${mg.bottom}mm`,
    marginLeft: `${mg.left}mm`,
  };
}

function Block({
  block: b,
  doc,
  highlightIds,
}: {
  block: RenderBlock;
  doc: BlockStyle | undefined;
  highlightIds?: readonly string[];
}) {
  const highlighted = !!b.id && !!highlightIds && highlightIds.includes(b.id);
  // 紙に出ないもの（横並びの区切り・改ページ）は入れものも余白も要らない
  if (b.kind === "rowBreak" || b.kind === "pageBreak") return <BlockBody block={b} doc={doc} />;
  /*
    余白は必ずここ（外側の入れもの）に付ける。中身の側には決め打ちの余白を置かない。
    書いていない辺は種類ごとに決まっていた頃の値で補う（`effectiveMargin`）ので、古い様式の見た目は変わらない
  */
  const wrap: CSSProperties = {
    ...styleOf(b.style),
    ...decorOf(b.style, true),
    ...marginOf(effectiveMargin(b.kind, b.margin)),
    // 編集画面のプレビューで、選んでいるブロックの場所が分かるように赤い細線で囲む
    ...(highlighted ? { outline: "0.3mm solid #dc2626", outlineOffset: "0.5mm" } : {}),
  };
  return (
    <div style={wrap}>
      <BlockBody block={b} doc={doc} />
    </div>
  );
}

function BlockBody({ block: b, doc }: { block: RenderBlock; doc: BlockStyle | undefined }) {
  const sources = useContext(ImageSourceContext);
  /*
    字の大きさ。**ブロックの指定 → 種類の既定（見出しはレベル、表は表用） → 紙面ぜんたい → 10.5**の順。
    編集画面の欄に出ている値と同じ計算にして、見たままが刷られるようにする（2026-09-14 決定）。
    中身に大きさを直接書いていると、外側で指定しても効かない
    （親から受け継ぐ字は、子に書いた指定に負ける）ので、ここで解く
  */
  const bodySize = doc?.size ?? DEFAULT_FONT_SIZE;
  const size = b.style?.size ?? ownFontSize(b) ?? bodySize;
  const fs = () => `${size}pt`;
  /** 表の表題は本文の大きさ（中身より一段大きい）。ブロックで指定していればそれ */
  const captionSize = `${b.style?.size ?? bodySize}pt`;
  // 余白は外側の入れもの（Block）に付く。ここの margin はすべて 0
  switch (b.kind) {
    case "heading":
      return (
        <div
          style={{
            fontSize: fs(),
            fontWeight: 700,
            margin: 0,
          }}
        >
          {b.lines.map((l, i) => (
            <Line key={i} line={l} />
          ))}
        </div>
      );
    case "text":
      return (
        <div style={{ margin: 0, fontSize: fs(), lineHeight: 1.6 }}>
          {b.lines.map((l, i) => (
            <Line key={i} line={l} />
          ))}
        </div>
      );
    case "fields": {
      // ラベルの位置（左／右）と幅（%）は様式で決められる（2026-09-16 指示）
      const labelRight = b.labelPosition === "right";
      const labelCell = (label: string) => (
        <th
          style={{
            textAlign: "left",
            fontWeight: 400,
            // ラベルと値の間は mm で決められる。省略は 6mm。右置きなら間は左側に付く
            padding: labelRight ? `1mm 0 1mm ${b.gap ?? 6}mm` : `1mm ${b.gap ?? 6}mm 1mm 0`,
            /*
              右寄せのときは値を折らず、狭ければラベルの側を折る（氏名が途中で折れないように）。
              左寄せは今までどおりラベルを折らない。幅を決めたときはその幅で折る
            */
            whiteSpace: b.valueAlign === "right" || b.labelWidth ? "normal" : "nowrap",
            verticalAlign: "top",
            ...(b.labelWidth ? { width: `${b.labelWidth}%` } : {}),
            // ラベルだけの字。ブロックの字の上に重ねる
            ...styleOf(b.labelStyle),
          }}
        >
          {label}
        </th>
      );
      const valueCell = (value: string) => (
        <td
          style={{
            padding: "1mm 0",
            textAlign: b.valueAlign ?? "left",
            whiteSpace: b.valueAlign === "right" ? "nowrap" : "normal",
            verticalAlign: "top",
          }}
        >
          {value}
        </td>
      );
      return (
        <table
          style={{
            margin: 0,
            borderCollapse: "collapse",
            fontSize: fs(),
            // 右寄せか、ラベルの幅を決めたときは枠いっぱいに広げる（割合はブロックの横幅に対して）
            ...(b.valueAlign === "right" || b.labelWidth ? { width: "100%" } : {}),
          }}
        >
          <tbody>
            {b.items.map((it, i) => (
              <tr key={i}>
                {labelRight ? valueCell(it.value) : labelCell(it.label)}
                {labelRight ? labelCell(it.label) : valueCell(it.value)}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "orgItems":
      return (
        <div style={{ margin: 0, fontSize: fs() }}>
          {b.items.map((it, i) => (
            <div key={i} style={{ textAlign: it.align, padding: "0.5mm 0" }}>
              {it.label && (
                <span style={{ marginRight: "3mm", whiteSpace: "nowrap" }}>{it.label}</span>
              )}
              {it.value}
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div style={{ margin: 0 }}>
          {b.caption && (
            <p style={{ margin: "0 0 1mm", fontSize: captionSize, fontWeight: 700 }}>{b.caption}</p>
          )}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: fs(),
              // 表が長いと途中で切れる。行の途中では切らない（下の tr で指定）
              pageBreakInside: "auto",
            }}
          >
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} style={CELL_HEAD}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  {r.map((c, j) => (
                    <td key={j} style={CELL}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "divider":
      return (
        <hr
          style={{
            border: 0,
            borderTop: "0.4mm solid #000",
            margin: 0,
          }}
        />
      );
    case "spacer":
      // 高さは mm。古い様式の3段（sm/md/lg）も mm に読み替える
      return <div style={{ height: `${spacerMm(b.size)}mm` }} />;
    case "rowBreak":
      // 横並びを切るためだけのもの。紙には何も出ない
      return null;
    case "pageBreak":
      return <div style={{ pageBreakAfter: "always", breakAfter: "page" }} />;
    case "signature": {
      // ラベルの置きかた（線の左／線の上）、ラベルと線の間、線の長さは様式で決められる
      const gap = `${b.gap ?? 4}mm`;
      const line = (
        <span
          style={{
            display: "inline-block",
            width: `${b.lineWidth ?? 60}mm`,
            maxWidth: "100%",
            borderBottom: "0.3mm solid #000",
          }}
        />
      );
      if (b.labelPosition === "above") {
        return (
          <div style={{ margin: 0, fontSize: fs() }}>
            <div style={{ marginBottom: gap }}>{b.label}</div>
            {line}
          </div>
        );
      }
      return (
        <div style={{ margin: 0, fontSize: fs(), whiteSpace: "nowrap" }}>
          <span style={{ marginRight: gap }}>{b.label}</span>
          {line}
        </div>
      );
    }
    case "image": {
      // 幅・高さは mm。片方だけなら縦横比で決まり、両方空なら元の大きさ（紙幅を超えれば縮む）
      const align = b.align ?? "left";
      return (
        <div style={{ margin: 0, textAlign: align }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- DB から出す絵。next/image は使えない */}
          <img
            src={imageSrc(sources, b.imageId)}
            alt=""
            style={{
              display: "inline-block",
              maxWidth: "100%",
              ...(b.widthMm !== undefined ? { width: `${b.widthMm}mm` } : {}),
              ...(b.heightMm !== undefined ? { height: `${b.heightMm}mm` } : {}),
            }}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

const CELL_HEAD: React.CSSProperties = {
  border: "0.2mm solid #000",
  padding: "1mm 2mm",
  textAlign: "left",
  // 表が次の紙にまたがっても、見出しは各ページに出る
  background: "#f0f0f0",
};
const CELL: React.CSSProperties = {
  border: "0.2mm solid #000",
  padding: "1mm 2mm",
  verticalAlign: "top",
};
