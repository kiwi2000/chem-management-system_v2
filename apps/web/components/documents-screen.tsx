"use client";

import {
  DOCUMENT_TARGETS,
  emptyTableState,
  openOrgBlocks,
  ORGANISATION_KINDS,
  pickName,
  serializeTableState,
  type ColumnKind,
  type TableState,
  fieldKeysIn,
  PICK_COMPANY_KEY,
  PICK_DEPARTMENT_KEY,
} from "@chem/shared";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DocTargetPicker } from "@/components/doc-target-picker";
import { DocTemplatePicker } from "@/components/doc-template-picker";
import type { TableColumn } from "@/components/data-table/types";
import type { ProductListOptions } from "@/components/product-list-columns";
import type { SubstanceListOptions } from "@/components/substance-list-columns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { useOrganisations } from "@/lib/use-organisations";
import type {
  ApiError,
  DocBatchJobDto,
  DocumentTemplateDto,
  GeneratedDocumentDto,
  ListResponse,
} from "@/lib/types";
import { documentHref, type DocPickSelection } from "@/lib/doc-batch";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "generatedAt", direction: "desc" }]);

const columnKinds = [
  { key: "targetCode", kind: "text" },
  { key: "templateCode", kind: "text" },
  { key: "target", kind: "enum" },
  { key: "hasComposition", kind: "enum" },
  { key: "generatedAt", kind: "date" },
] satisfies { key: string; kind: ColumnKind }[];

/** 生成の状況の表。並べ替えも絞り込みも無い（新しい順に 20 件だけ） */
const JOBS_STATE: TableState = emptyTableState([]);

/** 日時。秒までは要らない（一覧で読むのは「いつごろか」） */
function fmt(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const POLL_MS = 2000;

/**
 * ドキュメント生成の画面。
 *
 * 上で**様式を選んで作り**、下に**自分が作ったもの**が並ぶ。
 * 様式そのものを直すのは別の画面（テンプレート編集）で、要る権限も違う。
 *
 * 複数を選んだときはバックグラウンド処理に頼み、進み具合を「生成の状況」に出す（2026-09-16）。
 * 作っているあいだも他の画面で作業できる
 */
export function DocumentsScreen({
  product,
  substance,
}: {
  /** 相手選びの表に渡す選択肢（製品一覧と同じもの） */
  product: ProductListOptions;
  /** 同じく物質一覧の選択肢 */
  substance: SubstanceListOptions;
}) {
  const { m, locale } = useI18n();
  const router = useRouter();

  /*
    選んだ様式。**選ぶと、この画面の中に相手の一覧が出る。**
    以前は製品・物質の画面へ飛ばしていたが、
    帳票を作りに来た人を別の画面へ移すと、どこにいるのか分からなくなる
  */
  const [picked, setPicked] = useState<DocumentTemplateDto | null>(null);
  /** ③で選ばれている相手。④の「生成」で使う */
  const [selection, setSelection] = useState<DocPickSelection | null>(null);
  /** 生成を頼んだあと、相手の表を作り直して選択を消すための合図 */
  const [pickerToken, setPickerToken] = useState(0);
  /*
    任意の会社・任意の部署と宛先。**組織から選ぶ。**
    所属する会社・部署は作った人のものが自動で入るので、ここでは聞かない
  */
  const [companyId, setCompanyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const organisations = useOrganisations();
  const orgOptions = useMemo(
    () => (organisations ?? []).filter((o) => o.activeFlag),
    [organisations],
  );
  /*
    組織ブロックのうち、様式で組織を決めていないもの。**ここで選んでもらう。**
    種別だけ決めてあるブロックはその種別の中から、何も決めていないブロックは
    種別で絞ってから選ぶ。選ばなければ、そのブロックは空のまま出る
  */
  const openBlocks = useMemo(() => (picked ? openOrgBlocks(picked.content) : []), [picked]);
  /*
    任意の会社・任意の部署。**様式がその項目を使っているときだけ聞く。**
    選べるのは種別が合う組織ぜんぶ（自分が所属していなくてもよい。2026-09-13 指示）
  */
  const usedKeys = useMemo(
    () => (picked ? fieldKeysIn(picked.content) : new Set<string>()),
    [picked],
  );
  const asksCompany = usedKeys.has(PICK_COMPANY_KEY);
  const asksDepartment = usedKeys.has(PICK_DEPARTMENT_KEY);
  const companyOptions = useMemo(
    () => orgOptions.filter((o) => o.kind === "COMPANY"),
    [orgOptions],
  );
  const departmentOptions = useMemo(
    () => orgOptions.filter((o) => o.kind === "DEPARTMENT"),
    [orgOptions],
  );
  const [orgChoices, setOrgChoices] = useState<Record<string, string>>({});
  const [orgKindFilter, setOrgKindFilter] = useState<Record<string, string>>({});
  const kindNames = useMemo(
    () => ({
      COMPANY: m.organisations.kindCompany,
      DEPARTMENT: m.organisations.kindDepartment,
      PARTNER: m.organisations.kindPartner,
      OTHER: m.organisations.kindOther,
    }),
    [m],
  );
  const [data, setData] = useState<ListResponse<GeneratedDocumentDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 生成を頼んだときの知らせ */
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const { state, setState, ready } = useTableState(
    "chem.table.documents",
    columnKinds,
    DEFAULT_STATE,
  );
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/documents?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<GeneratedDocumentDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /*
    生成の状況（まとめて頼んだ仕事）。走っているあいだは数秒おきに聞きに行き、
    終わったら「自分が作ったドキュメント」も読み直す
  */
  const [jobs, setJobs] = useState<DocBatchJobDto[] | null>(null);
  const running = (jobs ?? []).some((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/documents/batch").catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { items: DocBatchJobDto[] };
    setJobs(body.items);
  }, []);
  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void loadJobs(), POLL_MS);
    return () => window.clearInterval(id);
  }, [running, loadJobs]);
  // 走っていたものが終わったら、できたものを一覧に出す
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (wasRunning && !running) void load();
    setWasRunning(running);
  }, [running, wasRunning, load]);

  /** 生成状況から選んだ仕事を消す（記録だけ。できた帳票は残る）。走っている最中のものは断られる */
  async function deleteJobs(targets: DocBatchJobDto[]) {
    setError(null);
    for (const j of targets) {
      const res = await fetch(`/api/documents/batch/${j.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void loadJobs();
  }

  /**
   * 選んだものを消す。
   * **消せるのは自分が作ったものと、権限があれば他人のもの**（見せてよいものだけが表に出る）。
   * 印を付けるのではなく本当に消すので、押したあとは元に戻せない
   */
  async function onDeleteSelected(targets: GeneratedDocumentDto[]) {
    setError(null);
    for (const d of targets) {
      const res = await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void load();
  }

  const columns: TableColumn<GeneratedDocumentDto>[] = useMemo(
    () => [
      {
        key: "generatedAt",
        header: m.documents.generatedAt,
        kind: "date",
        width: 140,
        className: "whitespace-nowrap",
        // 押すと、出したときの紙面をそのまま開く（作り直さない）
        render: (d) => (
          <Link href={`/documents/saved/${d.id}`} className="underline underline-offset-2">
            {fmt(d.generatedAt, locale)}
          </Link>
        ),
      },
      {
        key: "templateCode",
        header: m.documents.template,
        kind: "text",
        width: 200,
        render: (d) => `${d.templateCode} ${pickName(locale, d.templateNameJa, d.templateNameEn)}`,
      },
      {
        key: "target",
        header: m.documents.targetKind,
        kind: "enum",
        width: 88,
        options: DOCUMENT_TARGETS.map((v) => ({ value: v, label: m.docTemplates.targets[v] })),
        render: (d) => m.docTemplates.targets[d.target],
      },
      {
        key: "targetCode",
        header: m.documents.targetCode,
        kind: "text",
        width: 170,
        className: "font-mono text-xs",
        // 描きかたを渡さないと空欄になる（共通テーブルは既定の描きかたを持たない）
        render: (d) => d.targetCode,
      },
      {
        // 誰が作ったか。他人のものが見える権限のときに意味を持つ（自分のものは薄く出す）
        key: "createdBy",
        header: m.documents.createdBy,
        kind: "text",
        width: 120,
        sortable: false,
        filterable: false,
        className: "text-xs",
        render: (d) => (
          <span className={d.mine ? "text-muted-foreground" : undefined}>
            {d.createdByName ?? ""}
          </span>
        ),
      },
      {
        key: "hasComposition",
        header: m.documents.hasComposition,
        kind: "enum",
        width: 96,
        options: [
          { value: "true", label: m.common.yes },
          { value: "false", label: m.common.no },
        ],
        render: (d) => (d.hasComposition ? m.common.yes : ""),
      },
      {
        key: "version",
        header: m.documents.version,
        kind: "text",
        width: 96,
        sortable: false,
        filterable: false,
        render: (d) => d.version,
      },
      {
        // 作った PDF。押すと落ちる。まだ作っている途中・作れなかったときはその旨
        key: "file",
        header: m.documents.file,
        kind: "text",
        width: 260,
        sortable: false,
        filterable: false,
        className: "text-xs",
        render: (d) =>
          d.fileName ? (
            <a
              href={`/api/documents/${d.id}/file`}
              className="text-primary underline underline-offset-2"
              title={
                d.fileSize !== null ? `${Math.max(1, Math.round(d.fileSize / 1024))} KB` : undefined
              }
            >
              {d.fileName}
            </a>
          ) : d.fileError ? (
            <span className="text-destructive" title={d.fileError}>
              {m.documents.fileFailed}
            </span>
          ) : (
            <span className="text-muted-foreground">{m.documents.fileMaking}</span>
          ),
      },
    ],
    [m, locale],
  );

  /**
   * 選んだ帳票の PDF を落とす。1 件ならそのファイル、複数なら zip。
   * ファイルが無いものは飛ばされ、その数が知らせに出る
   */
  async function downloadSelected(targets: GeneratedDocumentDto[]) {
    setError(null);
    const withFile = targets.filter((d) => d.fileName);
    if (withFile.length === 0) {
      setError(m.documents.downloadNone);
      return;
    }
    if (withFile.length === 1 && targets.length === 1) {
      window.location.href = `/api/documents/${withFile[0]!.id}/file`;
      return;
    }
    const res = await fetch("/api/documents/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: withFile.map((d) => d.id) }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    const skipped =
      Number(res.headers.get("X-Chem-Skipped") ?? "0") + (targets.length - withFile.length);
    const name =
      res.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ??
      "documents.zip";
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = decodeURIComponent(name);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (skipped > 0) setNotice(m.documents.downloadSkipped(skipped));
  }

  /** 生成の状況の列。進み具合は数字と帯で */
  const jobColumns: TableColumn<DocBatchJobDto>[] = useMemo(
    () => [
      {
        key: "createdAt",
        header: m.documents.jobRequestedAt,
        kind: "date",
        width: 140,
        sortable: false,
        filterable: false,
        className: "whitespace-nowrap",
        render: (j) => fmt(j.createdAt, locale),
      },
      {
        key: "template",
        header: m.documents.template,
        kind: "text",
        width: 200,
        sortable: false,
        filterable: false,
        render: (j) => `${j.templateCode} ${pickName(locale, j.templateNameJa, j.templateNameEn)}`,
      },
      {
        key: "target",
        header: m.documents.targetKind,
        kind: "text",
        width: 88,
        sortable: false,
        filterable: false,
        render: (j) => m.docTemplates.targets[j.target],
      },
      {
        key: "progress",
        header: m.documents.jobProgress,
        kind: "text",
        width: 180,
        sortable: false,
        filterable: false,
        render: (j) => {
          const pct = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
          return (
            <div className="space-y-1">
              <div className="text-xs tabular-nums">
                {j.done} / {j.total}
                {j.missed > 0 && (
                  <span className="text-destructive ml-2">{m.documents.jobMissed(j.missed)}</span>
                )}
              </div>
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded">
                <div
                  className={j.status === "FAILED" ? "bg-destructive h-full" : "bg-primary h-full"}
                  style={{ width: `${j.status === "DONE" ? 100 : pct}%` }}
                />
              </div>
            </div>
          );
        },
      },
      {
        key: "status",
        header: m.documents.jobStatus,
        kind: "text",
        width: 220,
        sortable: false,
        filterable: false,
        className: "text-xs",
        render: (j) => (
          <div className="flex flex-wrap items-center gap-2">
            <span className={j.status === "FAILED" ? "text-destructive" : undefined}>
              {m.documents.jobStatuses[j.status] ?? j.status}
            </span>
            {j.status === "DONE" && j.done - j.missed > 0 && (
              <Link
                href={`/documents/batch/${j.id}`}
                className="text-primary underline underline-offset-2"
              >
                {m.documents.jobOpen}
              </Link>
            )}
            {j.status === "DONE" && j.done - j.missed > 0 && (
              <a
                href={`/api/documents/batch/${j.id}/zip`}
                className="text-primary underline underline-offset-2"
              >
                {m.documents.downloadZip}
              </a>
            )}
            {j.error && <span className="text-destructive">{j.error}</span>}
          </div>
        ),
      },
    ],
    [m, locale],
  );

  /*
    差出人と宛先を、作る先へ渡す。
    **宛先を使わない様式には付けない。**付けても捨てられるが、
    URL に出ていると「効いている」と読めてしまう
  */
  const partyParams = (t: DocumentTemplateDto) => ({
    ...(asksCompany && companyId ? { company: companyId } : {}),
    ...(asksDepartment && departmentId ? { department: departmentId } : {}),
    ...(t.usesRecipient && recipientId ? { to: recipientId } : {}),
    org: openBlocks.flatMap((b) => (orgChoices[b.id] ? [`${b.id}:${orgChoices[b.id]}`] : [])),
  });

  /*
    **宛先を持たないテンプレートでは、宛先の段ごと出さない。**
    選んでも紙に出ないものを聞くと、効いていると読めてしまう。
    差出人を選べる人には、そのために出す
  */
  const asksParties =
    picked !== null &&
    (picked.usesRecipient || asksCompany || asksDepartment || openBlocks.length > 0);
  /** ②の見出し。出る欄だけを並べる（無い欄の名前を書かない） */
  const step2Label = m.documents.step2Pick(
    [
      asksCompany ? m.documents.pickCompany : null,
      asksDepartment ? m.documents.pickDepartment : null,
      picked?.usesRecipient ? m.documents.recipient : null,
      openBlocks.length > 0 ? m.documents.orgBlockShort : null,
    ]
      .filter((v): v is string => v !== null)
      .join(locale === "ja" ? "・" : ", "),
  );

  /** 段の見出し。番号は付けない（2026-09-16 指示。見出しだけで分かるように大きめに出す） */
  const HEADING = "text-lg font-semibold";
  /** 相手の段の見出しは、テンプレートの対象（製品か物質か）で変える */
  const step3Label = picked
    ? picked.target === "PRODUCT"
      ? m.documents.step3Product
      : m.documents.step3Substance
    : m.documents.step3;

  /** 選ばれている件数（全件のときは絞り込みに当たる数） */
  const selectedCount =
    selection === null ? 0 : selection.mode === "ids" ? selection.ids.length : selection.total;

  /**
   * 選ばれた相手で作る。**1件ならその場で開き、複数ならバックグラウンド処理に頼む。**
   * 頼んだあとは相手の選択を消し、生成の状況に並べる（終わるまで他の作業ができる）
   */
  async function make() {
    if (!picked || !selection) return;
    const parties = partyParams(picked);
    // Excel・Word は 1 件ずつその場で落とす（PDF にはしない。保留）。画面編集の様式は何件でも仕事に頼む
    if (picked.kind !== "BLOCK") {
      if (selection.mode === "ids" && selection.ids.length === 1) {
        router.push(documentHref(picked.id, selection.ids[0]!, parties));
      }
      return;
    }
    setError(null);
    setNotice(null);
    setStarting(true);
    try {
      const res = await fetch("/api/documents/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: picked.id,
          selection:
            selection.mode === "ids"
              ? { mode: "ids", ids: selection.ids }
              : { mode: "all", filter: selection.filter },
          ...parties,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json()) as { id: string; total: number };
      setNotice(m.documents.batchStarted(body.total));
      setSelection(null);
      setPickerToken((v) => v + 1);
      void loadJobs();
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="w-full space-y-4 p-3 pb-10 lg:p-4 lg:pb-12">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ① テンプレートを選ぶ。表から選ぶ（数が増えても探せるように） */}
      <div className="space-y-2">
        <p className={HEADING}>{m.documents.step1}</p>
        <DocTemplatePicker
          selectedId={picked?.id ?? null}
          onSelect={(t) => {
            setPicked(t);
            // テンプレートが変われば、選んでいた相手も外す（対象そのものが変わる）
            setSelection(null);
            setNotice(null);
            if (!t.usesRecipient) setRecipientId("");
            // 組織ブロックはテンプレートごとに違うので、選び直し
            setOrgChoices({});
            setOrgKindFilter({});
          }}
        />
      </div>

      {/*
        ② 差出人と宛先。
        **宛先を使うテンプレートでだけ、この段を出す。**
        使わないテンプレートで聞くと、選んでも紙に出ないものを選ばせることになる。
        差出人は権限のある人にだけ出す（既定は自分の会社）
      */}
      {asksParties && (
        <div className="space-y-2 border-t pt-4">
          <p className={HEADING}>{step2Label}</p>
          <div className="flex flex-wrap items-end gap-3">
            {asksCompany && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">{m.documents.pickCompany}</span>
                <select
                  aria-label={m.documents.pickCompany}
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="border-input bg-background block h-9 w-56 rounded-none border px-2 text-sm"
                >
                  <option value="">{m.documents.pickNone}</option>
                  {companyOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {pickName(locale, o.nameJa, o.nameEn)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {asksDepartment && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">{m.documents.pickDepartment}</span>
                <select
                  aria-label={m.documents.pickDepartment}
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="border-input bg-background block h-9 w-56 rounded-none border px-2 text-sm"
                >
                  <option value="">{m.documents.pickNone}</option>
                  {departmentOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {pickName(locale, o.nameJa, o.nameEn)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {picked?.usesRecipient && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">{m.documents.recipient}</span>
                <select
                  aria-label={m.documents.recipient}
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value)}
                  className="border-input bg-background block h-9 w-56 rounded-none border px-2 text-sm"
                >
                  <option value="">{m.documents.recipientNone}</option>
                  {orgOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {pickName(locale, o.nameJa, o.nameEn)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {/* 組織ブロック。様式で決めていないぶんを、紙面の順に聞く */}
            {openBlocks.map((b, n) => {
              const kind = b.kind ?? orgKindFilter[b.id] ?? "";
              return (
                <div key={b.id} className="space-y-1">
                  <span className="text-muted-foreground text-xs">
                    {m.documents.orgBlockChoice(n + 1)}
                    {b.kind ? `（${kindNames[b.kind]}）` : ""}
                  </span>
                  <div className="flex gap-2">
                    {b.kind === null && (
                      <select
                        aria-label={m.docEditor.orgBlockKind}
                        value={kind}
                        onChange={(e) => {
                          setOrgKindFilter({ ...orgKindFilter, [b.id]: e.target.value });
                          // 種別を変えたら、前に選んだ組織は外す（種別が合わなくなる）
                          setOrgChoices({ ...orgChoices, [b.id]: "" });
                        }}
                        className="border-input bg-background block h-9 w-36 rounded-none border px-2 text-sm"
                      >
                        <option value="">{m.documents.orgKindAll}</option>
                        {ORGANISATION_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {kindNames[k]}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      aria-label={m.documents.orgBlockChoice(n + 1)}
                      value={orgChoices[b.id] ?? ""}
                      onChange={(e) => setOrgChoices({ ...orgChoices, [b.id]: e.target.value })}
                      className="border-input bg-background block h-9 w-56 rounded-none border px-2 text-sm"
                    >
                      <option value="">{m.documents.orgNotChosen}</option>
                      {orgOptions
                        .filter((o) => kind === "" || o.kind === kind)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {pickName(locale, o.nameJa, o.nameEn)}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
          {openBlocks.length > 0 && (
            <p className="text-muted-foreground text-xs">{m.documents.orgNotChosenHint}</p>
          )}
        </div>
      )}

      {/* ③ 作る相手。テンプレートで対象（製品か物質か）が決まる。表は製品・物質の一覧と同じ */}
      <div className="space-y-2 border-t pt-4">
        <p className={HEADING}>{step3Label}</p>
        {picked ? (
          <DocTargetPicker
            key={`${picked.id}:${pickerToken}`}
            target={picked.target}
            // Excel・Word はまとめて作れない。選ばせてから断らない
            single={picked.kind !== "BLOCK"}
            product={product}
            substance={substance}
            onSelectionChange={setSelection}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{m.documents.pickTemplateFirst}</p>
        )}
      </div>

      {/* ④ 生成。**手順の最後に、押すためのボタンとして置く** */}
      <div className="space-y-2 border-t pt-4">
        <p className={HEADING}>{m.documents.step4}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!picked || !selection || starting} onClick={() => void make()}>
            <FileText className="size-4" />
            {m.documents.make}
          </Button>
          <span className="text-muted-foreground text-sm">
            {selectedCount > 0
              ? selection?.mode === "all"
                ? m.documents.allSelected(selectedCount)
                : m.documents.pickedCount(selectedCount)
              : m.documents.pickNoneYet}
          </span>
        </div>
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* 生成の状況（まとめて頼んだ仕事）。無ければ出さない */}
      {jobs !== null && jobs.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className={HEADING}>{m.documents.jobsTitle}</p>
          <DataTable
            storageKey="chem.table.docBatchJobs"
            columns={jobColumns}
            rows={jobs}
            rowKey={(j) => j.id}
            total={jobs.length}
            state={JOBS_STATE}
            defaultState={JOBS_STATE}
            onStateChange={() => {}}
            emptyMessage={m.documents.jobsNone}
            showFilters={false}
            showPager={false}
            selectable
            onDeleteSelected={deleteJobs}
            hintText={m.documents.jobsHint}
          />
        </div>
      )}

      {/* 下：自分が作ったもの */}
      <div className="space-y-2 border-t pt-4">
        <p className={HEADING}>{m.documents.mine}</p>
        <DataTable
          storageKey="chem.table.documents"
          columns={columns}
          rows={data?.items ?? null}
          rowKey={(d) => d.id}
          total={data?.total ?? 0}
          state={state}
          defaultState={DEFAULT_STATE}
          onStateChange={setState}
          emptyMessage={m.documents.noneYet}
          selectable
          onDeleteSelected={onDeleteSelected}
          // 選んだぶんを落とす（1 件なら PDF そのもの、複数なら zip）
          bulkAction={{ label: m.documents.download, run: downloadSelected }}
          pageSizeOptions={[15, 25, 50, 100]}
          hintText={m.documents.savedHint}
        />
      </div>
    </div>
  );
}
