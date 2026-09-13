"use client";

import type { DocumentContent } from "@chem/shared";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BlockList, Labeled } from "@/components/doc-editor/block-list";
import { DocumentSheet } from "@/components/doc-editor/document-view";
import { FontSizeInput } from "@/components/doc-editor/font-size-input";
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

const SELECT = "border-input h-7 rounded-none border bg-transparent px-2 text-sm";

/*
  プレビューまわりの好みは端末に覚える（2026-09-13 指示）。
  開くたびに閉じたり半々に戻ったりすると、使う人が毎回直すことになる
*/
const PREVIEW_KEY = "chem.docEditor.preview";
const SPLIT_KEY = "chem.docEditor.split";
const ZOOM_KEY = "chem.docEditor.zoom";
/** 左（ブロック一覧）の幅の割合。これより外には狭くしない（片方が使えない幅になる） */
const SPLIT_MIN = 0.25;
const SPLIT_MAX = 0.75;
/** 紙面の表示倍率（%） */
const ZOOM_MIN = 25;
const ZOOM_MAX = 200;
const ZOOM_PRESETS = [50, 75, 100, 125, 150] as const;

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
  const editable = can("DOC_TEMPLATE_EDIT");
  // 会社の自由項目。差込項目の一覧に足す
  const orgItems = useOrgItemLabels();
  const organisations = useOrganisations();
  /*
    プレビュー。**見本の値で出す。**本物を引くと保存が要り、
    「試しに幅を変えて見る」ができなくなる
  */
  const [preview, setPreview] = useState(true);
  /** 左（ブロック一覧）の幅の割合。広い画面で真ん中の線をつまんで変える（2026-09-13 指示） */
  const [split, setSplit] = useState(0.5);
  /** 線をつまんでいる間。文字が選択されないようにする */
  const [dragging, setDragging] = useState(false);
  /** 紙面の表示倍率（%）。100 で実寸 */
  const [zoom, setZoom] = useState(100);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const p = window.localStorage.getItem(PREVIEW_KEY);
      if (p !== null) setPreview(p === "1");
      const s = Number(window.localStorage.getItem(SPLIT_KEY));
      if (s >= SPLIT_MIN && s <= SPLIT_MAX) setSplit(s);
      const z = Number(window.localStorage.getItem(ZOOM_KEY));
      if (z >= ZOOM_MIN && z <= ZOOM_MAX) setZoom(z);
    } catch {
      // 記憶できない環境（保存領域が使えない）では既定のまま
    }
  }, []);
  function remember(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 同上
    }
  }
  function togglePreview() {
    setPreview((v) => {
      remember(PREVIEW_KEY, v ? "0" : "1");
      return !v;
    });
  }
  function changeSplit(next: number) {
    const v = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, next));
    setSplit(v);
    remember(SPLIT_KEY, String(v));
  }
  function changeZoom(next: number | undefined) {
    const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next ?? 100));
    setZoom(v);
    remember(ZOOM_KEY, String(v));
  }
  /** 真ん中の線をつまんで動かす。ポインタを捕まえるので、線から外れても追いかける */
  function onGutterDown(e: React.PointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 捕まえられない種類のポインタでも、線の上で動かすぶんには効く
    }
    setDragging(true);
  }
  function onGutterMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !bodyRef.current) return;
    const rect = bodyRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (e.clientX - rect.left) / rect.width)));
  }
  function onGutterUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 同上
    }
    setDragging(false);
    remember(SPLIT_KEY, String(split));
  }
  /**
   * 編集で選んでいるブロック（複数可）。プレビューで赤い細線で囲む（2026-09-13 指示）。
   * Ctrl を押しながらで足し引き、Shift で範囲。選びかたの決まりは BlockList にある
   */
  const [activeIds, setActiveIds] = useState<string[]>([]);
  /** 上の欄（題名と帯）を出しているか。△で閉じて、編集の場所を広く使える（2026-09-13 指示） */
  const [headerOpen, setHeaderOpen] = useState(true);
  /*
    開け閉めの途中か。**滑らかに高さを変える**（2026-09-13 指示）ので、その間だけ中身をはみ出させない。
    ずっと隠していると、帯の中のサイズ候補（下に開く一覧）が切れてしまう
  */
  const [headerSliding, setHeaderSliding] = useState(false);
  function toggleHeader() {
    setHeaderOpen((v) => !v);
    setHeaderSliding(true);
    // transitionend は動きを切っている環境では来ないので、時間で戻す（動きの長さ 200ms より少し長く）
    window.setTimeout(() => setHeaderSliding(false), 260);
  }
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
   * 案内の行のリンクで一覧へ戻るときの見張り（「戻る」ボタンは無くした。同じ行き先が案内の行にある。2026-09-13 指示）。
   * **変えぶんが残っているときは移らない。**知らせを出して、保存するか取消すかを選んでもらう
   */
  function guardLeave() {
    if (!dirty) return true;
    setLeaveWarning(true);
    return false;
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
      // 上の欄（案内・題名・帯）は間を詰める（2026-09-13 指示）。space-y は上下の両方に付いて詰めきれないので、子ごとに mt を書く。
      // いちばん上の帯と案内の間も、ほかの画面より狭くする
      className={cn(PAGE_SHELL, "pt-3 lg:pt-3", framed && "flex flex-col overflow-hidden")}
      style={framed ? { height: frameHeight } : undefined}
    >
      {/* いまどこにいるか。メニューの項目名から始める */}
      <Breadcrumbs
        items={[
          { label: m.nav.documents },
          { label: m.docTemplates.title, href: "/doc-templates" },
          { label: `${template.code} ${template.nameJa}` },
        ]}
        beforeNavigate={guardLeave}
      />

      {/*
        上の欄（題名と帯）。閉じている間は何も出さない（名前は案内の行にある）。
        右端はつまみ（下の行、右に寄せて上に重なる）の分だけ空けておく（2026-09-13 指示）
      */}
      {/* 高さは grid の行で 1fr ⇄ 0fr。中身の高さを測らずに滑らかに開け閉めできる。閉じている間は押せない（inert） */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,margin-top] duration-200 motion-reduce:transition-none",
          headerOpen ? "mt-2 grid-rows-[1fr]" : "mt-0 grid-rows-[0fr]",
        )}
        aria-hidden={!headerOpen}
        inert={!headerOpen}
      >
        <div className={cn("min-h-0", (!headerOpen || headerSliding) && "overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-3 pr-12">
            <h1 className="text-2xl font-semibold">
              {template.code} {template.nameJa}
            </h1>
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap items-end justify-end gap-2">
                {isFile ? null : (
                  <>
                    {/*
                      紙面の表示倍率（%）。候補から選ぶか、数を打つ。
                      紙面の上に置くと縦の場所を食うので、帯の「向き」の左に置く（2026-09-13 指示）
                    */}
                    <Labeled label={m.docEditor.previewZoom}>
                      <span className="flex items-center gap-0.5">
                        <FontSizeInput
                          value={zoom}
                          onChange={changeZoom}
                          label={m.docEditor.previewZoomHint}
                          presets={ZOOM_PRESETS}
                          min={ZOOM_MIN}
                          max={ZOOM_MAX}
                          step={5}
                          className="border-input bg-background h-7 w-14 rounded-none border px-1 text-xs"
                        />
                        <span className="text-muted-foreground text-xs">%</span>
                      </span>
                    </Labeled>
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
                      className={cn("h-7 w-7", preview && "bg-accent text-foreground")}
                      onClick={togglePreview}
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
              </div>
            </div>
          </div>
        </div>
      </div>
      {!isFile && (
        <div className="-mt-2 flex justify-end border-b">
          {/*
            上の欄をたたむつまみ。線にまたがる小さな札で、**開いても閉じても右端の同じ形**。
            上の行（開いていれば帯、たたんでいれば案内）に半分重ねて詰める。ただし線はぴったり付けず少し空ける（2026-09-13 指示）
          */}
          <button
            type="button"
            aria-expanded={headerOpen}
            aria-label={headerOpen ? m.docEditor.headerCollapse : m.docEditor.headerExpand}
            title={headerOpen ? m.docEditor.headerCollapse : m.docEditor.headerExpand}
            className="text-muted-foreground hover:text-foreground bg-background -mb-px flex h-4 w-10 items-center justify-center border border-b-0"
            onClick={toggleHeader}
          >
            {headerOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        </div>
      )}

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
          ref={bodyRef}
          className={cn(
            "mt-2",
            // 広い画面では残りの高さいっぱいに広げ、左右をそれぞれ送る（2026-09-13 指示）。
            // 列の幅は真ん中の線で決まる（左 : 線 : 右）
            framed && "grid min-h-0 flex-1 grid-rows-1",
            dragging && "select-none",
          )}
          style={
            framed
              ? { gridTemplateColumns: preview ? `${split}fr 1rem ${1 - split}fr` : "1fr" }
              : undefined
          }
        >
          <div className={cn(framed && "min-h-0 overflow-y-auto pr-1")}>
            <BlockList
              // 会社の項目名が届く前に描いた差込は名前が鍵のまま残るので、届いたら作り直す
              key={`${revision}-${orgItems.length}`}
              blocks={content.blocks}
              target={template.target}
              orgItems={orgItems}
              onChange={(blocks) => edit({ ...content, blocks })}
              onActivate={setActiveIds}
              activeIds={activeIds}
            />
          </div>

          {framed && preview && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={m.docEditor.splitHandle}
              title={m.docEditor.splitHandle}
              // 真ん中の線。つまんで左右の比率を変え、二度押しで半々に戻す（2026-09-13 指示）。
              // 画面の分割線と同じく、真ん中に短い棒を出して「つまめる」ことを示す
              className="group flex min-h-0 cursor-col-resize touch-none items-center justify-center"
              onPointerDown={onGutterDown}
              onPointerMove={onGutterMove}
              onPointerUp={onGutterUp}
              onPointerCancel={onGutterUp}
              onDoubleClick={() => changeSplit(0.5)}
            >
              <div
                className={cn(
                  "bg-border group-hover:bg-foreground/40 h-8 w-1 rounded-full",
                  dragging && "bg-foreground/40",
                )}
              />
            </div>
          )}

          {preview && sheet && (
            <div className={cn("mt-4", framed && "mt-0 min-h-0 overflow-y-auto")}>
              {/* 紙面そのものは本番と同じ部品で出す。別に組むと見た目が分かれる */}
              <div className="bg-muted/40 overflow-x-auto border p-2">
                {/*
                  紙は上下に my-4 を持つ。灰色の枠との間を最小にしたいので、直下の上の余白だけ消す。倍率は zoom で紙ごと縮める。
                  「見本の値」の断りは紙の右上の角に重ねる（行を使わない。2026-09-13 指示）
                */}
                <div className="*:mt-0" style={{ zoom: zoom / 100 }}>
                  <DocumentSheet
                    doc={sheet}
                    highlightIds={activeIds}
                    cornerNote={m.docEditor.previewNote}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
