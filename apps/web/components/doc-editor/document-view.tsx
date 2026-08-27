"use client";

import { Printer } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
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

      {/* 紙面。画面では枠を付け、印刷では枠を消す */}
      <div className="mx-auto my-4 max-w-[210mm] bg-white p-[15mm] text-black shadow print:m-0 print:max-w-none print:p-0 print:shadow-none">
        {doc.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
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

const HEADING_SIZE = { 1: "18pt", 2: "14pt", 3: "12pt" } as const;
const SPACER = { sm: "4mm", md: "8mm", lg: "16mm" } as const;

function Block({ block: b }: { block: RenderBlock }) {
  switch (b.kind) {
    case "heading":
      return (
        <div style={{ fontSize: HEADING_SIZE[b.level], fontWeight: 700, margin: "0 0 3mm" }}>
          {b.lines.map((l, i) => (
            <Line key={i} line={l} />
          ))}
        </div>
      );
    case "text":
      return (
        <div style={{ margin: "0 0 3mm", fontSize: "10.5pt", lineHeight: 1.6 }}>
          {b.lines.map((l, i) => (
            <Line key={i} line={l} />
          ))}
        </div>
      );
    case "fields":
      return (
        <table style={{ margin: "0 0 4mm", borderCollapse: "collapse", fontSize: "10.5pt" }}>
          <tbody>
            {b.items.map((it, i) => (
              <tr key={i}>
                <th
                  style={{
                    textAlign: "left",
                    fontWeight: 400,
                    padding: "1mm 6mm 1mm 0",
                    whiteSpace: "nowrap",
                    verticalAlign: "top",
                  }}
                >
                  {it.label}
                </th>
                <td style={{ padding: "1mm 0" }}>{it.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "table":
      return (
        <div style={{ margin: "0 0 5mm" }}>
          {b.caption && (
            <p style={{ margin: "0 0 1mm", fontSize: "10.5pt", fontWeight: 700 }}>{b.caption}</p>
          )}
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "9pt",
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
      return <hr style={{ border: 0, borderTop: "0.4mm solid #000", margin: "4mm 0" }} />;
    case "spacer":
      return <div style={{ height: SPACER[b.size] }} />;
    case "pageBreak":
      return <div style={{ pageBreakAfter: "always", breakAfter: "page" }} />;
    case "signature":
      return (
        <div style={{ margin: "8mm 0 0", fontSize: "10.5pt" }}>
          <span style={{ marginRight: "4mm" }}>{b.label}</span>
          <span
            style={{ display: "inline-block", width: "60mm", borderBottom: "0.3mm solid #000" }}
          />
        </div>
      );
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
