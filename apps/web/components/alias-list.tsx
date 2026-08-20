"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";

interface Props {
  /** 見出し（「日本語別名」など） */
  label: string;
  /** 追加ボタンの文言 */
  addLabel: string;
  /** 入力欄の id と aria-label に使う接頭辞。画面内で一意にすること */
  idPrefix: string;
  values: string[];
  onChange: (next: string[]) => void;
}

/**
 * 別名の一覧。1行1名称で、日本語と英語をそれぞれ独立した一覧として扱う。
 * 日英の件数は一致しないため、対にして並べない（S7の見直し）。
 */
export function AliasList({ label, addLabel, idPrefix, values, onChange }: Props) {
  const { m } = useI18n();
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-${i}`}
            aria-label={`${label} ${i + 1}`}
            value={v}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
            className="w-full"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive shrink-0"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            {m.common.remove}
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ""])}>
        {addLabel}
      </Button>
    </div>
  );
}
