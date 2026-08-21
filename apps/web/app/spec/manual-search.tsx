"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SPEC_PAGES } from "./spec-pages";

/** 1件の見つかった場所 */
interface Hit {
  href: string;
  /** ページの見出し（目次と同じ文言） */
  page: string;
  /** その中の節の見出し。ページの冒頭で見つかったときは空 */
  section: string;
  /** 前後を少し添えた本文 */
  snippet: string;
}

/** 節ごとにばらした本文。検索はこれに対して行う */
interface Entry {
  href: string;
  page: string;
  section: string;
  text: string;
}

const MAX_HITS = 12;

/**
 * マニュアルの中を探す。
 *
 * 索引をあらかじめ作らず、開いたときに各ページを読みに行って組み立てる。
 * ページを書き足しても索引の更新を忘れる心配がないためで、
 * 全部で数ページしかないので読み込みも一度きりで済む。
 */
export function ManualSearch() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const building = useRef(false);

  async function buildIndex() {
    if (building.current || entries) return;
    building.current = true;
    setLoading(true);
    try {
      const parser = new DOMParser();
      const all: Entry[] = [];
      for (const page of SPEC_PAGES) {
        const res = await fetch(page.href).catch(() => null);
        if (!res?.ok) continue;
        const doc = parser.parseFromString(await res.text(), "text/html");
        const body = doc.querySelector("[data-manual-content]");
        if (!body) continue;

        // 節の見出しで区切りながら、本文を拾っていく
        let section = "";
        let buffer: string[] = [];
        const flush = () => {
          const text = buffer.join(" ").replace(/\s+/g, " ").trim();
          if (text) all.push({ href: page.href, page: page.label, section, text });
          buffer = [];
        };
        for (const el of body.querySelectorAll("h1, h2, h3, p, li, td, th")) {
          const text = el.textContent?.trim() ?? "";
          if (!text) continue;
          if (el.tagName === "H2") {
            flush();
            section = text;
            buffer.push(text);
            continue;
          }
          buffer.push(text);
        }
        flush();
      }
      setEntries(all);
    } finally {
      setLoading(false);
      building.current = false;
    }
  }

  // 入力欄に触れた時点で読み込みを始める（打ち終わってから待たせない）
  useEffect(() => {
    if (query.trim() !== "") void buildIndex();
    // buildIndex は状態を見て一度しか走らないので、依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const q = query.trim().toLowerCase();
  const hits: Hit[] = [];
  if (q !== "" && entries) {
    for (const e of entries) {
      const at = e.text.toLowerCase().indexOf(q);
      if (at < 0) continue;
      const from = Math.max(0, at - 20);
      hits.push({
        href: e.section ? `${e.href}#${encodeURIComponent(e.section)}` : e.href,
        page: e.page,
        section: e.section,
        snippet: (from > 0 ? "…" : "") + e.text.slice(from, at + q.length + 40) + "…",
      });
      if (hits.length >= MAX_HITS) break;
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => void buildIndex()}
          placeholder="マニュアルを探す"
          aria-label="マニュアルを探す"
          className="h-8 pr-7 pl-7 text-sm"
        />
        {query !== "" && (
          <button
            type="button"
            aria-label="消す"
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {q !== "" && (
        <div className="border-border max-h-96 overflow-y-auto border text-sm">
          {loading && !entries ? (
            <p className="text-muted-foreground p-2 text-xs">読み込み中…</p>
          ) : hits.length === 0 ? (
            <p className="text-muted-foreground p-2 text-xs">見つかりませんでした</p>
          ) : (
            <ul className="divide-y">
              {hits.map((h, i) => (
                <li key={i}>
                  <Link
                    href={h.href}
                    onClick={() => setQuery("")}
                    className="hover:bg-muted block px-2 py-1.5"
                  >
                    <span className="block text-xs font-medium">
                      {h.page}
                      {h.section && (
                        <span className="text-muted-foreground font-normal"> / {h.section}</span>
                      )}
                    </span>
                    <span className="text-muted-foreground block text-xs leading-snug">
                      {h.snippet}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
