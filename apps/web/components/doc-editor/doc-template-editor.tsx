"use client";

import type { DocumentContent } from "@chem/shared";
import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BlockList } from "@/components/doc-editor/block-list";
import { DocumentSheet } from "@/components/doc-editor/document-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { renderDocument } from "@/lib/doc-render";
import { addOrgBlockValues, sampleTables, sampleValues } from "@/lib/doc-sample";
import type { ApiError, DocumentTemplateDto } from "@/lib/types";
import { useOrganisations } from "@/lib/use-organisations";
import { useOrgItemLabels } from "@/lib/use-doc-fields";
import { useMe } from "@/lib/use-me";
import { cn } from "@/lib/utils";

const SELECT = "border-input h-8 rounded-none border bg-transparent px-2 text-sm";

/**
 * テンプレートの中身（ブロックの並び）を編集する画面。
 *
 * **保存は押したときだけ。**打つたびに送ると、
 * 書きかけの状態が保存され、離れたときに何が残るのか読めなくなる。
 * 離れる前に注意を出すのは、保存していない変えぶんがあるときだけ。
 */
export function DocTemplateEditor({ id }: { id: string }) {
  const { m } = useI18n();
  const { can } = useMe();
  const router = useRouter();
  const editable = can("DOC_TEMPLATE_EDIT");
  // 会社の自由項目。差込項目の一覧に足す
  const orgItems = useOrgItemLabels();
  const organisations = useOrganisations();
  /*
    プレビュー。**見本の値で出す。**本物を引くと保存が要り、
    「試しに幅を変えて見る」ができなくなる
  */
  const [preview, setPreview] = useState(false);
  /** 変えぶんを残したまま戻ろうとしたときの知らせ */
  const [leaveWarning, setLeaveWarning] = useState(false);
  /*
    読み込み直し・破棄のたびに増やして、**入力部品を作り直す。**
    文字を書く部品（TipTap）と幅の選択は、開いたときの値を自分で覚えている。
    値だけ差し替えても画面は古いままで、破棄したのに元に戻らなかった
  */
  const [revision, setRevision] = useState(0);

  const [template, setTemplate] = useState<DocumentTemplateDto | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/doc-templates/${id}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    const body = (await res.json()) as DocumentTemplateDto;
    setTemplate(body);
    setContent(body.content);
    setDirty(false);
    setRevision((v) => v + 1);
  }, [id, m]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 保存していない変えぶんがあるまま閉じられそうなときは、一度止める */
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  /** 取消。読み込んだところまで戻す（保存はしない） */
  function cancelEdits() {
    setContent(template?.content ?? null);
    setDirty(false);
    setError(null);
    setLeaveWarning(false);
    setRevision((v) => v + 1);
  }

  /**
   * 一覧へ戻る。
   * **変えぶんが残っているときは移らない。**知らせを出して、
   * 保存するか取消すかを選んでもらう
   */
  function goBack() {
    if (dirty) {
      setLeaveWarning(true);
      return;
    }
    router.push("/doc-templates");
  }

  function edit(next: DocumentContent) {
    setContent(next);
    setDirty(true);
    // 直し始めたら知らせは引っ込める。出しっぱなしだと何の話か分からなくなる
    setLeaveWarning(false);
  }

  async function save() {
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json()) as DocumentTemplateDto;
      setTemplate(body);
      setContent(body.content);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  /*
    様式の言語で出す。読んでいる人の言語ではない。
    英語の様式は、日本語で使っている人が見ても英語で出るのが正しい
  */
  const sheet = useMemo(() => {
    if (!template || !content) return null;
    const locale = template.locale === "en" ? "en" : "ja";
    return renderDocument({
      content,
      target: template.target,
      /*
        差込項目は見本の文字。**組織ブロックだけは本物を入れる。**
        名指しした組織は誰が作っても同じものが出るので、
        見本の文字にすると、確かめたい「実際にどう出るか」が分からない
      */
      values: addOrgBlockValues(
        sampleValues(template.target, orgItems, locale),
        content,
        organisations ?? [],
        locale,
      ),
      tables: sampleTables(locale),
    });
  }, [template, content, orgItems, organisations]);

  if (!template || !content) {
    return (
      <div className={PAGE_SHELL_STACKED}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        )}
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL_STACKED}>
      {/* いまどこにいるか。メニューの項目名から始める */}
      <Breadcrumbs
        items={[
          { label: m.nav.documents },
          { label: m.docTemplates.title, href: "/doc-templates" },
          { label: `${template.code} ${template.nameJa}` },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {template.code} {template.nameJa}
        </h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            {m.docEditor.orientation}
            <select
              className={SELECT}
              disabled={!editable}
              value={content.orientation}
              onChange={(e) =>
                edit({ ...content, orientation: e.target.value as "portrait" | "landscape" })
              }
            >
              <option value="portrait">{m.docEditor.orientations.portrait}</option>
              <option value="landscape">{m.docEditor.orientations.landscape}</option>
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={() => setPreview((v) => !v)}>
            <Eye className="size-4" />
            {preview ? m.docEditor.previewHide : m.docEditor.preview}
          </Button>
          {editable && (
            <>
              <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
                {saving ? m.common.saving : m.common.save}
              </Button>
              {/* 取消は、保存していない変えぶんを捨てて、読み込んだところまで戻す */}
              <Button size="sm" variant="outline" disabled={saving || !dirty} onClick={cancelEdits}>
                {m.common.discard}
              </Button>
            </>
          )}
          {/*
            戻るは**一覧へ移るだけ。**変えぶんが残っているときは、
            移らずに知らせる。ここで黙って捨てると、書いたものが消える
          */}
          <Button size="sm" variant="outline" onClick={goBack}>
            {m.common.back}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {leaveWarning && (
        <Alert variant="destructive">
          <AlertDescription>{m.docEditor.unsavedOnLeave}</AlertDescription>
        </Alert>
      )}

      {template.contentBroken && (
        <Alert>
          <AlertDescription>{m.docTemplates.contentBroken}</AlertDescription>
        </Alert>
      )}

      {template.unknownFields.length > 0 && (
        <Alert>
          <AlertDescription>
            {m.docTemplates.unknownFields(template.unknownFields.length)}
            <span className="block font-mono text-xs">{template.unknownFields.join(" ")}</span>
          </AlertDescription>
        </Alert>
      )}

      {/*
        プレビューを出しているあいだは左右に並べる。
        画面が狭いときは縦に積む（横に並べると、どちらも読めない幅になる）
      */}
      <div className={cn("gap-4", preview && "lg:grid lg:grid-cols-2 lg:items-start")}>
        <BlockList
          key={revision}
          blocks={content.blocks}
          target={template.target}
          orgItems={orgItems}
          onChange={(blocks) => edit({ ...content, blocks })}
        />

        {preview && sheet && (
          <div className="mt-4 lg:sticky lg:top-4 lg:mt-0">
            <Alert className="mb-2">
              <AlertDescription>{m.docEditor.previewNote}</AlertDescription>
            </Alert>
            {/* 紙面そのものは本番と同じ部品で出す。別に組むと見た目が分かれる */}
            <div className="bg-muted/40 max-h-[75vh] overflow-auto border p-2">
              <DocumentSheet doc={sheet} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
