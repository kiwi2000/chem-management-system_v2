import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 仕様書ページの部品。
 * 開発中だけの資料なので多言語にはせず、日本語で書く。
 */

/**
 * 日本語の文の途中に紛れ込む半角スペースを取り除く。
 *
 * JSX は、書き手が読みやすさのために入れた改行を、半角スペース1つに置き換える。
 * 英語なら単語の区切りとして正しいが、日本語では文の途中に隙間ができてしまう。
 * 原稿を1行に詰めれば直るものの、書くたびに気を付けるのは現実的ではないので、
 * 出すときに落とす。
 *
 * 落とすのは「両側が日本語の文字」で「半角スペース」のときだけ。
 * 全角スペース（表の見出しの区切りなどで使う）と、
 * 英数字と日本語の間の空け方（意図して空けている）はそのまま残す。
 */
const JA = "\u3001-\u303F\u3040-\u30FF\u4E00-\u9FFF\uFF01-\uFFEF";
const STRAY_SPACE = new RegExp(`([${JA}]) +(?=[${JA}])`, "g");

function ja(text: string): string {
  return text.replace(STRAY_SPACE, "$1");
}

/** 直下の文字だけを直す。入れ子の部品は、その部品が自分で直す */
function tidy(children: ReactNode): ReactNode {
  return Children.map(children, (child) => (typeof child === "string" ? ja(child) : child));
}

export function PageHead({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground max-w-3xl leading-relaxed">{ja(lead)}</p>
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
    // 目印を付けておくと、検索結果からこの節へ直接飛べる
    <section id={id ?? title} className="scroll-mt-20 space-y-3">
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
  return <p className="leading-relaxed">{tidy(children)}</p>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((it, i) => (
        <li key={i} className="leading-relaxed">
          {tidy(it)}
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
      <div className="text-muted-foreground text-sm leading-relaxed">{tidy(children)}</div>
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
                {ja(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-border border-b last:border-b-0">
              {r.map((c, j) => (
                <td key={j} className="p-2 align-top">
                  {tidy(c)}
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
  return <span className="font-medium">{tidy(children)}</span>;
}
