"use client";

import {
  DEFAULT_FONT,
  effectiveMargin,
  fontStack,
  groupIntoRows,
  type BlockStyle,
  spacerMm,
  type BlockMargin,
} from "@chem/shared";
import { Printer } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { CSSProperties } from "react";
import type { RenderBlock, RenderLine, RenderedDocument } from "@/lib/doc-render";

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
export function DocumentSheet({
  doc,
  highlightIds,
  cornerNote,
}: {
  doc: RenderedDocument;
  /** 編集画面で選んでいるブロックの id（複数可）。そのブロックを赤い細線で囲む（刷るときは渡さない） */
  highlightIds?: readonly string[];
  /** 紙の右上の角に重ねる短い断り（編集画面の「見本の値」。刷るときは渡さない） */
  cornerNote?: string;
}) {
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
      }}
      className="relative mx-auto my-4 max-w-[210mm] bg-white p-[15mm] text-black shadow print:m-0 print:max-w-none print:p-0 print:shadow-none"
    >
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
      {groupIntoRows(doc.blocks).map((row, i) =>
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

/** 見出しレベルごとの既定の大きさ。字の大きさを指定すればそちらが勝つ */
const HEADING_SIZE = {
  1: "18pt",
  2: "16pt",
  3: "14pt",
  4: "12pt",
  5: "11pt",
  6: "10.5pt",
} as const;

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
  /*
    字の大きさ。**ブロック → 紙面ぜんたい → 種類ごとの既定**の順に強い。
    中身に大きさを直接書いていると、外側で指定しても効かない
    （親から受け継ぐ字は、子に書いた指定に負ける）ので、ここで解く
  */
  const size = b.style?.size ?? doc?.size;
  const fs = (fallback: string) => (size ? `${size}pt` : fallback);
  // 余白は外側の入れもの（Block）に付く。ここの margin はすべて 0
  switch (b.kind) {
    case "heading":
      return (
        <div
          style={{
            fontSize: fs(HEADING_SIZE[b.level]),
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
        <div style={{ margin: 0, fontSize: fs("10.5pt"), lineHeight: 1.6 }}>
          {b.lines.map((l, i) => (
            <Line key={i} line={l} />
          ))}
        </div>
      );
    case "fields":
      return (
        <table
          style={{
            margin: 0,
            borderCollapse: "collapse",
            fontSize: fs("10.5pt"),
            // 右寄せのときは枠いっぱいに広げて、値を右端にそろえる
            ...(b.valueAlign === "right" ? { width: "100%" } : {}),
          }}
        >
          <tbody>
            {b.items.map((it, i) => (
              <tr key={i}>
                <th
                  style={{
                    textAlign: "left",
                    fontWeight: 400,
                    // ラベルと値の間は mm で決められる。省略は 6mm
                    padding: `1mm ${b.gap ?? 6}mm 1mm 0`,
                    /*
                      右寄せのときは値を折らず、狭ければラベルの側を折る（氏名が途中で折れないように）。
                      左寄せは今までどおりラベルを折らない
                    */
                    whiteSpace: b.valueAlign === "right" ? "normal" : "nowrap",
                    verticalAlign: "top",
                    // ラベルだけの字。ブロックの字の上に重ねる
                    ...styleOf(b.labelStyle),
                  }}
                >
                  {it.label}
                </th>
                <td
                  style={{
                    padding: "1mm 0",
                    textAlign: b.valueAlign ?? "left",
                    whiteSpace: b.valueAlign === "right" ? "nowrap" : "normal",
                    verticalAlign: "top",
                  }}
                >
                  {it.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    /*
      組織の項目。**行ごとに寄せを持つので、表ではなく行で組む。**
      表で組むと、左の見出しの幅に引きずられて、右寄せが揃わない
    */
    case "orgItems":
      return (
        <div style={{ margin: 0, fontSize: fs("10.5pt") }}>
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
            <p style={{ margin: "0 0 1mm", fontSize: fs("10.5pt"), fontWeight: 700 }}>
              {b.caption}
            </p>
          )}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: fs("9pt"),
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
          <div style={{ margin: 0, fontSize: fs("10.5pt") }}>
            <div style={{ marginBottom: gap }}>{b.label}</div>
            {line}
          </div>
        );
      }
      return (
        <div style={{ margin: 0, fontSize: fs("10.5pt"), whiteSpace: "nowrap" }}>
          <span style={{ marginRight: gap }}>{b.label}</span>
          {line}
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
