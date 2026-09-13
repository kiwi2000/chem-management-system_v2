"use client";

import type { DocumentContent } from "@chem/shared";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BlockList, Labeled } from "@/components/doc-editor/block-list";
import { DocumentSheet } from "@/components/doc-editor/document-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL, PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { BlockStyleBar } from "@/components/doc-editor/block-style-bar";
import { TemplateFilePanel } from "@/components/doc-editor/template-file-panel";
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
  /** 編集で触っているブロック。プレビューで赤い細線で囲む（2026-09-13 指示） */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 上の欄（題名と帯）を出しているか。△で閉じて、編集の場所を広く使える（2026-09-13 指示） */
  const [headerOpen, setHeaderOpen] = useState(true);
  /*
    広い画面では、画面の高さいっぱいを使い、左（ブロック）と右（プレビュー）を別々に送る。
    画面の残りの高さは、上の帯（隠せるので高さが変わる）を測って決める。狭い画面では null（今までどおり）
  */
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  useEffect(() => {
    const bar = document.querySelector("header")?.parentElement ?? null;
    const update = () => {
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        setFrameHeight(null);
        return;
      }
      const top = bar ? bar.getBoundingClientRect().height : 0;
      setFrameHeight(Math.max(320, window.innerHeight - top));
    };
    update();
    window.addEventListener("resize", update);
    const ro = bar && "ResizeObserver" in window ? new ResizeObserver(update) : null;
    if (bar && ro) ro.observe(bar);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, []);
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

  /* 預かったファイルの様式は、ブロックも紙の向きも持たない。画面ごと差し替える */
  const isFile = template.kind !== "BLOCK";

  /* 広い画面のブロック編集は、画面の高さに収めて左右を別々に送る（預かったファイルの様式は今までどおり） */
  const framed = frameHeight !== null && !isFile;

  return (
    <div
      // 上の欄（案内・題名・帯）は間を詰める（2026-09-13 指示）。space-y は上下の両方に付いて詰めきれないので、子ごとに mt を書く
      className={cn(PAGE_SHELL, framed && "flex flex-col overflow-hidden")}
      style={framed ? { height: frameHeight } : undefined}
    >
      {/*
        いまどこにいるか。メニューの項目名から始める。
        右端に上の欄（題名と帯）をたたむつまみ。**開いても閉じても同じ場所**（2026-09-13 指示）。
        見た目はいちばん上の帯の開閉ボタンに合わせる。たたんでいる間は、この行の下に線を引いて本文と分ける
      */}
      <div
        className={cn(
          "flex items-center justify-between gap-2",
          !isFile && !headerOpen && "border-b pb-1",
        )}
      >
        <Breadcrumbs
          items={[
            { label: m.nav.documents },
            { label: m.docTemplates.title, href: "/doc-templates" },
            { label: `${template.code} ${template.nameJa}` },
          ]}
        />
        {!isFile && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={headerOpen}
            aria-label={headerOpen ? m.docEditor.headerCollapse : m.docEditor.headerExpand}
            title={headerOpen ? m.docEditor.headerCollapse : m.docEditor.headerExpand}
            className="bg-header text-header-foreground hover:bg-header/85 hover:text-header-foreground aria-expanded:bg-header aria-expanded:text-header-foreground dark:hover:bg-header/85 -my-1 shrink-0"
            onClick={() => setHeaderOpen((v) => !v)}
          >
            {headerOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        )}
      </div>

      {/* 上の欄（題名と帯）。閉じている間は何も出さない（名前は案内の行にある）。右はつまみの列を空けておく */}
      {headerOpen ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-b pb-1 pr-8">
          <h1 className="text-2xl font-semibold">
            {template.code} {template.nameJa}
          </h1>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-end justify-end gap-2">
              {isFile ? null : (
                <>
                  {/* 欄の上に小さく名前。ブロックの見出し行と同じ形（2026-09-13 指示） */}
                  <Labeled label={m.docEditor.orientationShort}>
                    <select
                      className={SELECT}
                      aria-label={m.docEditor.orientation}
                      disabled={!editable}
                      value={content.orientation}
                      onChange={(e) =>
                        edit({
                          ...content,
                          orientation: e.target.value as "portrait" | "landscape",
                        })
                      }
                    >
                      <option value="portrait">{m.docEditor.orientations.portrait}</option>
                      <option value="landscape">{m.docEditor.orientations.landscape}</option>
                    </select>
                  </Labeled>
                  {/*
            紙面ぜんたいの字。**各ブロックの既定になる。**
            ブロックの側で選ばれていれば、そちらが勝つ
          */}
                  <BlockStyleBar
                    level="document"
                    value={content.style}
                    onChange={(style) => edit({ ...content, style })}
                    fontLabel={m.docEditor.documentFont}
                  />
                  {/*
                  プレビューの切り替え。太字・斜体と同じマークだけの切り替えボタンにし、
                  押している間は背景を濃くする（2026-09-13 決定）。文言は吹き出しで
                */}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    aria-label={m.docEditor.preview}
                    title={preview ? m.docEditor.previewHide : m.docEditor.preview}
                    aria-pressed={preview}
                    className={cn("h-8 w-8", preview && "bg-accent text-foreground")}
                    onClick={() => setPreview((v) => !v)}
                  >
                    <Eye className="size-4" />
                  </Button>
                  {editable && (
                    <>
                      <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
                        {saving ? m.common.saving : m.common.save}
                      </Button>
                      {/* 取消は、保存していない変えぶんを捨てて、読み込んだところまで戻す */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saving || !dirty}
                        onClick={cancelEdits}
                      >
                        {m.common.discard}
                      </Button>
                    </>
                  )}
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
        </div>
      ) : null}

      {error && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {leaveWarning && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{m.docEditor.unsavedOnLeave}</AlertDescription>
        </Alert>
      )}

      {template.contentBroken && (
        <Alert className="mt-2">
          <AlertDescription>{m.docTemplates.contentBroken}</AlertDescription>
        </Alert>
      )}

      {template.unknownFields.length > 0 && (
        <Alert className="mt-2">
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
      {isFile ? (
        <div className="mt-4">
          <TemplateFilePanel
            template={template}
            editable={editable}
            orgItems={orgItems}
            onChanged={() => void load()}
          />
        </div>
      ) : (
        <div
          className={cn(
            "mt-1 gap-4",
            // 広い画面では残りの高さいっぱいに広げ、左右をそれぞれ送る（2026-09-13 指示）
            framed && "grid min-h-0 flex-1 grid-rows-1",
            framed && (preview ? "grid-cols-2" : "grid-cols-1"),
          )}
        >
          <div className={cn(framed && "min-h-0 overflow-y-auto pr-1")}>
            <BlockList
              // 会社の項目名が届く前に描いた差込は名前が鍵のまま残るので、届いたら作り直す
              key={`${revision}-${orgItems.length}`}
              blocks={content.blocks}
              target={template.target}
              orgItems={orgItems}
              onChange={(blocks) => edit({ ...content, blocks })}
              onActivate={setActiveId}
              activeId={activeId}
            />
          </div>

          {preview && sheet && (
            <div className={cn("mt-4", framed && "mt-0 min-h-0 overflow-y-auto")}>
              {/* 紙面そのものは本番と同じ部品で出す。別に組むと見た目が分かれる */}
              <div className="bg-muted/40 border p-2">
                {/* プレビューは見本の値。灰色の枠の中、紙のすぐ上に赤い細字でひとこと（2026-09-13 指示。幅によらず同じ場所） */}
                <p className="text-destructive mb-1 text-right text-xs font-normal">
                  {m.docEditor.previewNote}
                </p>
                <DocumentSheet doc={sheet} highlightId={activeId} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
