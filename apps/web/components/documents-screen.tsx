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
} from "@chem/shared";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DocTargetPicker } from "@/components/doc-target-picker";
import { DocTemplatePicker } from "@/components/doc-template-picker";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/lib/use-me";
import { useOrganisations } from "@/lib/use-organisations";
import type {
  ApiError,
  DocumentTemplateDto,
  GeneratedDocumentDto,
  ListResponse,
} from "@/lib/types";
import { batchHref, documentHref } from "@/lib/doc-batch";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "generatedAt", direction: "desc" }]);

const columnKinds = [
  { key: "targetCode", kind: "text" },
  { key: "templateCode", kind: "text" },
  { key: "target", kind: "enum" },
  { key: "hasComposition", kind: "enum" },
  { key: "generatedAt", kind: "date" },
] satisfies { key: string; kind: ColumnKind }[];

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

/**
 * ドキュメント生成の画面。
 *
 * 上で**様式を選んで作り**、下に**自分が作ったもの**が並ぶ。
 * 様式そのものを直すのは別の画面（テンプレート編集）で、要る権限も違う。
 */
export function DocumentsScreen() {
  const { m, locale } = useI18n();
  const router = useRouter();

  /*
    選んだ様式。**選ぶと、この画面の中に相手の一覧が出る。**
    以前は製品・物質の画面へ飛ばしていたが、
    帳票を作りに来た人を別の画面へ移すと、どこにいるのか分からなくなる
  */
  const [picked, setPicked] = useState<DocumentTemplateDto | null>(null);
  /** ③で選ばれている相手。④の「生成」で使う */
  const [targetIds, setTargetIds] = useState<string[]>([]);
  /*
    差出人と宛先。**組織から選ぶ。**
    差出人は権限のある人だけが変えられる（既定は自分の会社）
  */
  const { can } = useMe();
  const canPickSender = can("DOCUMENT_SENDER");
  const [senderId, setSenderId] = useState("");
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

  /**
   * 選んだものを消す。
   * **消せるのは自分が作ったものだけ**（この表には自分のものしか出ない）。
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
    ],
    [m, locale],
  );

  /*
    差出人と宛先を、作る先へ渡す。
    **宛先を使わない様式には付けない。**付けても捨てられるが、
    URL に出ていると「効いている」と読めてしまう
  */
  const partyParams = (t: DocumentTemplateDto) => ({
    ...(senderId ? { from: senderId } : {}),
    ...(t.usesRecipient && recipientId ? { to: recipientId } : {}),
    org: openBlocks.flatMap((b) => (orgChoices[b.id] ? [`${b.id}:${orgChoices[b.id]}`] : [])),
  });

  /*
    **宛先を持たないテンプレートでは、宛先の段ごと出さない。**
    選んでも紙に出ないものを聞くと、効いていると読めてしまう。
    差出人を選べる人には、そのために出す
  */
  const asksParties =
    picked !== null && (picked.usesRecipient || canPickSender || openBlocks.length > 0);
  /** ②の見出し。出る欄だけを並べる（無い欄の名前を書かない） */
  const step2Label = m.documents.step2Pick(
    [
      canPickSender ? m.documents.sender : null,
      picked?.usesRecipient ? m.documents.recipient : null,
      openBlocks.length > 0 ? m.documents.orgBlockShort : null,
    ]
      .filter((v): v is string => v !== null)
      .join(locale === "ja" ? "・" : ", "),
  );

  /*
    段の見出し。**出す段だけで番号を数える。**
    宛先の段を飛ばしたときに ①③④ と並ぶと、抜けたように見える
  */
  const stepShown = [true, asksParties, true, true];
  const step = (n: number, label: string) =>
    `${"①②③④"[stepShown.slice(0, n).filter(Boolean).length - 1]} ${label}`;

  /** 選ばれた相手で作る。1件なら1枚、複数ならまとめて */
  function make() {
    if (!picked || targetIds.length === 0) return;
    const parties = partyParams(picked);
    router.push(
      targetIds.length === 1
        ? documentHref(picked.id, targetIds[0]!, parties)
        : batchHref(picked.id, targetIds, parties),
    );
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
        <p className="text-sm font-medium">{step(1, m.documents.step1)}</p>
        <DocTemplatePicker
          selectedId={picked?.id ?? null}
          onSelect={(t) => {
            setPicked(t);
            // テンプレートが変われば、選んでいた相手も外す（対象そのものが変わる）
            setTargetIds([]);
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
          <p className="text-sm font-medium">{step(2, step2Label)}</p>
          <div className="flex flex-wrap items-end gap-3">
            {canPickSender && (
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">{m.documents.sender}</span>
                <select
                  aria-label={m.documents.sender}
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  className="border-input bg-background block h-9 w-56 rounded-none border px-2 text-sm"
                >
                  <option value="">{m.documents.senderDefault}</option>
                  {orgOptions.map((o) => (
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

      {/* ③ 作る相手。テンプレートで対象（製品か物質か）が決まる */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">{step(3, m.documents.step3)}</p>
        {picked ? (
          <DocTargetPicker
            key={picked.id}
            target={picked.target}
            // Excel・Word はまとめて作れない。選ばせてから断らない
            single={picked.kind !== "BLOCK"}
            onSelectionChange={setTargetIds}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{m.documents.pickTemplateFirst}</p>
        )}
      </div>

      {/* ④ 生成。**手順の最後に、押すためのボタンとして置く** */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">{step(4, m.documents.step4)}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!picked || targetIds.length === 0} onClick={make}>
            <FileText className="size-4" />
            {m.documents.make}
          </Button>
          <span className="text-muted-foreground text-sm">
            {targetIds.length > 0
              ? m.documents.pickedCount(targetIds.length)
              : m.documents.pickNoneYet}
          </span>
        </div>
      </div>

      {/* 下：自分が作ったもの */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">{m.documents.mine}</p>
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
          pageSizeOptions={[15, 25, 50, 100]}
          hintText={m.documents.savedHint}
        />
      </div>
    </div>
  );
}
