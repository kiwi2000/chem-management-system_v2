import Link from "next/link";
import { Fragment } from "react";

export interface Crumb {
  label: string;
  /** 押して移れる先。省くと、ただの文字になる（メニューの見出しなど） */
  href?: string;
}

/**
 * いまどこにいるかの道筋。
 *
 * **メニューの項目名から始める。**「法規制 › 法律 › 化審法 › …」のように、
 * 左のメニューのどこを辿って来たのかが分かる形にする。
 * 途中を省くと、階層の深い画面で自分の位置を見失う。
 *
 * **最後は押せない。**いま開いている画面なので、押しても行き先が無い。
 * 押せるものと押せないものを色で分ける。
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="breadcrumb" className="text-muted-foreground text-sm">
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span className="px-2" aria-hidden>
              ›
            </span>
          )}
          {c.href && i < items.length - 1 ? (
            <Link href={c.href} className="underline underline-offset-2">
              {c.label}
            </Link>
          ) : (
            <span className={i === items.length - 1 ? "text-foreground" : undefined}>
              {c.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
