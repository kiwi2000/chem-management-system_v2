import Link from "next/link";
import { SPEC_PAGES } from "./spec-pages";

/** 次のページへ送る。上から順に読めるようにするため */
export function SpecPager({ current }: { current: string }) {
  const i = SPEC_PAGES.findIndex((p) => p.href === current);
  const prev = i > 0 ? SPEC_PAGES[i - 1] : null;
  const next = i >= 0 && i < SPEC_PAGES.length - 1 ? SPEC_PAGES[i + 1] : null;

  return (
    <div className="border-border flex justify-between gap-4 border-t pt-4 text-sm">
      {prev ? (
        <Link href={prev.href} className="text-muted-foreground hover:text-foreground">
          ← {prev.label}
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="text-muted-foreground hover:text-foreground">
          {next.label} →
        </Link>
      )}
    </div>
  );
}
