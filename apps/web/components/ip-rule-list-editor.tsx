"use client";

import { IP_RULES_MAX, isValidIpRule, type IpRuleEntry } from "@chem/shared";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";

/**
 * 接続元IPアドレスのリスト（許可リスト・拒否リスト）を 1 行ずつ書く欄（システム設定。2026-10-02）。
 *
 * 行はアドレス（または範囲）とメモ。保存はシステム設定の「保存」でまとめて行う。
 * 読めない書き方の行は、その場で枠を赤くして知らせる（保存はサーバーでも断る）
 */
export function IpRuleListEditor({
  id,
  title,
  rows,
  unused,
  onChange,
}: {
  id: string;
  title: string;
  rows: IpRuleEntry[];
  /** いまのやりかたで使っていないリスト。書けるが、薄く「いまは使っていません」と添える */
  unused: boolean;
  onChange: (rows: IpRuleEntry[]) => void;
}) {
  const { m } = useI18n();
  const t = m.settings;
  const set = (i: number, patch: Partial<IpRuleEntry>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2" id={id}>
      <p className="text-sm font-medium">
        {title}
        {unused && <span className="text-muted-foreground ml-2 text-xs">（{t.ipListUnused}）</span>}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t.ipListEmpty}</p>
      ) : (
        <div className="space-y-1">
          <div className="text-muted-foreground flex gap-2 text-xs">
            <span className="w-64">{t.ipAddress}</span>
            <span className="flex-1">{t.ipNote}</span>
          </div>
          {rows.map((r, i) => {
            const bad = r.address.trim() !== "" && !isValidIpRule(r.address);
            return (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`${title} ${t.ipAddress} ${i + 1}`}
                  value={r.address}
                  autoComplete="off"
                  maxLength={64}
                  aria-invalid={bad}
                  onChange={(e) => set(i, { address: e.target.value })}
                  className="h-8 w-64 font-mono"
                />
                <Input
                  aria-label={`${title} ${t.ipNote} ${i + 1}`}
                  value={r.note}
                  maxLength={100}
                  onChange={(e) => set(i, { note: e.target.value })}
                  className="h-8 flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  aria-label={`${t.ipRemove} ${i + 1}`}
                  title={t.ipRemove}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={rows.length >= IP_RULES_MAX}
        onClick={() => onChange([...rows, { address: "", note: "" }])}
      >
        <Plus className="size-4" />
        {t.ipAdd}
      </Button>
    </div>
  );
}
