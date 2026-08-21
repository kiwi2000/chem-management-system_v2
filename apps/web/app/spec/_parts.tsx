import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 仕様書ページの部品。
 * 開発中だけの資料なので多言語にはせず、日本語で書く。
 */

export function PageHead({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground max-w-3xl leading-relaxed">{lead}</p>
    </div>
  );
}

export function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="border-border border-b pb-1 text-lg font-semibold">{title}</h2>
      <div className="max-w-3xl space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 pt-1">
      <h3 className="font-medium">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/** 本文。読みやすさのため行間を広めに取る */
export function P({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed">{children}</p>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((it, i) => (
        <li key={i} className="leading-relaxed">
          {it}
        </li>
      ))}
    </ul>
  );
}

/** 補足や注意。本文と区別が付くよう左に線を引く */
export function Note({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="border-primary/60 bg-muted/40 space-y-1 border-l-2 py-2 pl-3">
      {title && <div className="text-sm font-medium">{title}</div>}
      <div className="text-muted-foreground text-sm leading-relaxed">{children}</div>
    </div>
  );
}

/** 見出し付きの表。横に長くなったら表だけ横スクロールさせる */
export function SpecTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="border-border overflow-x-auto rounded-none border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/60">
            {head.map((h, i) => (
              <th key={i} className="border-border border-b p-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-border border-b last:border-b-0">
              {r.map((c, j) => (
                <td key={j} className="p-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATE_TONE = {
  draft: "bg-muted text-foreground border-border",
  pending: "border-amber-500/60 bg-amber-500/15 text-foreground",
  rejected: "border-destructive/60 bg-destructive/10 text-destructive",
  published: "border-emerald-500/60 bg-emerald-500/15 text-foreground",
} as const;

/** 状態を表す札。文章の中でも表の中でも同じ見た目にする */
export function StateChip({
  tone,
  children,
}: {
  tone: keyof typeof STATE_TONE;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-block border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATE_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** 用語。本文中で強調するために使う */
export function T({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}
