"use client";

import { Bookmark, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { useOutsideClose } from "@/lib/use-outside-close";
import type { ApiError, SavedFilterDto } from "@/lib/types";

interface Props {
  /** どの一覧のものか。DataTable の storageKey をそのまま使う */
  tableKey: string;
  /** いまの状態をクエリ文字列にしたもの（保存する中身） */
  currentQuery: string;
  /** 保存した条件を選んだとき。クエリ文字列を読み込んで一覧に反映する */
  onLoad: (query: string) => void;
}

/**
 * フィルターの「保存」「読込」。
 * 一覧のある画面すべてで同じものを使うので、この部品に閉じ込めている。
 */
export function SavedFilters({ tableKey, currentQuery, onLoad }: Props) {
  const { m } = useI18n();
  const [items, setItems] = useState<SavedFilterDto[] | null>(null);
  const [openMenu, setOpenMenu] = useState<"save" | "load" | null>(null);
  const [title, setTitle] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const boxRef = useOutsideClose<HTMLDivElement>(openMenu !== null, closeMenu);

  const load = useCallback(async () => {
    const res = await fetch(`/api/saved-filters?tableKey=${encodeURIComponent(tableKey)}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: SavedFilterDto[] }).items);
  }, [tableKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave() {
    setError(null);
    const res = await fetch("/api/saved-filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableKey, title, query: currentQuery, shared }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    setTitle("");
    setShared(false);
    setOpenMenu(null);
    void load();
  }

  async function onDelete(f: SavedFilterDto) {
    if (!window.confirm(m.table.deleteSavedConfirm(f.title))) return;
    const res = await fetch(`/api/saved-filters/${f.id}`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    void load();
  }

  return (
    <div ref={boxRef} className="relative flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpenMenu((v) => (v === "save" ? null : "save"))}
        aria-expanded={openMenu === "save"}
      >
        <Bookmark className="mr-1 size-4" />
        {m.table.save}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpenMenu((v) => (v === "load" ? null : "load"))}
        aria-expanded={openMenu === "load"}
      >
        {m.table.load}
        {items && items.length > 0 && (
          <span className="text-muted-foreground ml-1 text-xs">({items.length})</span>
        )}
      </Button>

      {openMenu === "save" && (
        <div className="bg-background absolute top-9 left-0 z-20 w-80 space-y-2 rounded-md border p-3 shadow-md">
          <p className="text-sm font-medium">{m.table.saveTitle}</p>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={m.table.saveTitlePlaceholder}
            maxLength={100}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            {m.table.shareWithEveryone}
          </label>
          <p className="text-muted-foreground text-xs">{m.table.overwriteNotice}</p>
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={title.trim() === ""}
              onClick={() => void onSave()}
            >
              {m.common.save}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpenMenu(null)}>
              {m.common.cancel}
            </Button>
          </div>
        </div>
      )}

      {openMenu === "load" && (
        <div className="bg-background absolute top-9 left-0 z-20 max-h-72 w-80 overflow-auto rounded-md border p-2 shadow-md">
          {(!items || items.length === 0) && (
            <p className="text-muted-foreground p-2 text-sm">{m.table.noSavedFilters}</p>
          )}
          {items?.map((f) => (
            <div key={f.id} className="hover:bg-accent flex items-center gap-1 rounded p-1">
              <button
                type="button"
                className="flex-1 text-left text-sm"
                onClick={() => {
                  onLoad(f.query);
                  setOpenMenu(null);
                }}
              >
                <span className="block">{f.title}</span>
                {/* 自分のものは作成者を出さない（全部同じ名前が並んで読みにくいため） */}
                {f.shared && !f.mine && (
                  <span className="text-muted-foreground block text-xs">
                    {m.table.sharedBy(f.ownerName)}
                  </span>
                )}
              </button>
              {f.mine && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={m.common.delete}
                  className="text-destructive"
                  onClick={() => void onDelete(f)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {error && <p className="text-destructive p-2 text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
