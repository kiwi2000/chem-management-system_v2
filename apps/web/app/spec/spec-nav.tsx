"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SPEC_PAGES } from "./spec-pages";

export function SpecNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {SPEC_PAGES.map((p) => {
        const active = pathname === p.href;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={active ? "page" : undefined}
            style={active ? { backgroundColor: "var(--secondary)" } : undefined}
            className={cn(
              "block px-3 py-1.5 text-sm transition-colors",
              active
                ? "text-foreground font-medium"
                : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
            )}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
