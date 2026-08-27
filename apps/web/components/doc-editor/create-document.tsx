"use client";

import type { DocumentTarget } from "@chem/shared";
import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { DocumentTemplateDto, ListResponse } from "@/lib/types";

/**
 * 「帳票を作る」。製品や物質の詳細から呼ぶ。
 *
 * **テンプレートが1件も無いときは、何も出さない。**
 * 押しても選べないボタンを置くと、使えない機能があるように見える。
 */
export function CreateDocument({ target, targetId }: { target: DocumentTarget; targetId: string }) {
  const { m, locale } = useI18n();
  const router = useRouter();
  const [templates, setTemplates] = useState<DocumentTemplateDto[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(
        `/api/doc-templates?size=100&f.target=eq:${target}&f.active=eq:true`,
      ).catch(() => null);
      if (!res || !res.ok || !alive) return;
      const body = (await res.json()) as ListResponse<DocumentTemplateDto>;
      if (alive) setTemplates(body.items);
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  if (!templates || templates.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <FileText className="text-muted-foreground size-4" />
      <select
        className="border-input h-8 rounded-none border bg-transparent px-2 text-sm"
        aria-label={m.documents.create}
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          router.push(`/documents/${e.target.value}/${targetId}`);
        }}
      >
        <option value="">{m.documents.chooseTemplate}</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {locale === "en" ? (t.nameEn ?? t.nameJa) : t.nameJa}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 一覧に出す用の小さなボタン（いまは使っていないが、置き場所を決めておく） */
export function DocumentButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <FileText className="size-4" />
      {label}
    </Button>
  );
}
