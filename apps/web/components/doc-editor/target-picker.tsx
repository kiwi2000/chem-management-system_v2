"use client";

import type { DocumentTarget } from "@chem/shared";
import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";

interface Hit {
  id: string;
  code: string;
  name: string;
}

/**
 * 帳票を作る相手を探して選ぶ。
 *
 * **入口を2つにするための片方。**「この製品の帳票がほしい」ときは製品の画面から、
 * 「この様式で作りたい」ときはテンプレートの一覧から。
 * どちらの考えかたでもたどり着けるようにする。
 *
 * **コードと名前の両方で探す。**どちらで覚えているかは人によるので、
 * 1つの欄に打ってもらい、こちらで2通り問い合わせて混ぜる。
 */
export function TargetPicker({
  target,
  templateId,
  templateName,
  onClose,
}: {
  target: DocumentTarget;
  templateId: string;
  templateName: string;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const word = q.trim();
    if (word === "") {
      setHits(null);
      return;
    }
    let alive = true;
    // 打つたびに問い合わせない。手が止まってから探す
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const path = target === "PRODUCT" ? "/api/products" : "/api/substances";
        const [byCode, byName] = await Promise.all([
          fetch(`${path}?size=10&f.code=contains:${encodeURIComponent(word)}`).catch(() => null),
          fetch(`${path}?size=10&f.nameJa=contains:${encodeURIComponent(word)}`).catch(() => null),
        ]);
        if (!alive) return;
        const rows: Hit[] = [];
        const seen = new Set<string>();
        for (const res of [byCode, byName]) {
          if (!res || !res.ok) continue;
          const body = (await res.json()) as {
            items: { id: string; code: string; nameJa: string; nameEn: string | null }[];
          };
          for (const it of body.items) {
            if (seen.has(it.id)) continue;
            seen.add(it.id);
            rows.push({
              id: it.id,
              code: it.code,
              name: locale === "en" ? (it.nameEn ?? it.nameJa) : it.nameJa,
            });
          }
        }
        if (alive) setHits(rows);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, target, locale]);

  return (
    <div className="border-input space-y-2 rounded-none border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {m.documents.pickTargetFor(templateName, m.docTemplates.targets[target])}
        </p>
        <Button size="sm" variant="ghost" aria-label={m.common.cancel} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <Input
          autoFocus
          className="h-8 max-w-md"
          value={q}
          placeholder={m.documents.searchPlaceholder}
          aria-label={m.documents.searchPlaceholder}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {loading && <p className="text-muted-foreground text-sm">{m.common.loading}</p>}

      {!loading && hits !== null && hits.length === 0 && (
        <p className="text-muted-foreground text-sm">{m.documents.noTarget}</p>
      )}

      {!loading && hits !== null && hits.length > 0 && (
        <ul className="divide-border max-h-64 divide-y overflow-y-auto">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="hover:bg-accent flex w-full items-center gap-3 px-2 py-1.5 text-left text-sm"
                onClick={() => router.push(`/documents/${templateId}/${h.id}`)}
              >
                <span className="font-mono text-xs">{h.code}</span>
                <span className="truncate">{h.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
