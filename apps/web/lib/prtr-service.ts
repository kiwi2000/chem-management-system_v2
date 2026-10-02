import {
  isBothZero,
  normalizeCode,
  PRTR_IMPORT_FIELDS,
  type Messages,
  type PrtrImportInput,
  type PrtrImportKind,
  type PrtrProductMethod,
} from "@chem/shared";
import {
  Prisma,
  type PrtrEntry,
  type PrtrMeasured,
  type PrtrQuantity,
  type PrtrSummary,
  type PrtrSummaryRow,
} from "@prisma/client";
import ExcelJS from "exceljs";
import { getCurrentVersion } from "@/lib/current-version";
import { prisma } from "@/lib/db";
import { notDisabledIn } from "@/lib/enabled-sources";
import type {
  PrtrEntryDto,
  PrtrImportInspectDto,
  PrtrImportResultDto,
  PrtrMeasuredDto,
  PrtrQuantityDto,
  PrtrSubstanceCandidateDto,
  PrtrSummaryMeta,
  PrtrSummaryRowDto,
} from "@/lib/types";

/**
 * PRTR 届出データの入力（S22。2026-10-02 設計）。
 *
 * 所属（組織）× 年度で 1 組。計算方法ごとの区画:
 *   物質収支・排出係数 = 製品ごとの取扱量・出荷量（`prtr_quantities`、`method` で区画を分ける）
 *   実測値 = 物質ごとの取扱量・排出量（`prtr_measured`）
 * 排出量集計は 3 つの方法の排出量を物質ごとに足す。開くたびに計算し直す「いまの集計」と、
 * 「保存」で写し取る「保存した集計」（未確定 → 確定）を同じ表に `saved` の印で持つ。
 * 所属の絞り込み（誰がどこの分を入れられるか）は lib/authz.ts の `requirePrtrOrg` / `prtrOrgsOf`
 */

/** ファイルの上限。数量の表は数千行で足りる */
export const PRTR_IMPORT_FILE_MAX = 10 * 1024 * 1024;

const KG = /^\d{1,15}(\.\d{1,3})?$/;

// ── DTO ───────────────────────────────────────────────

export const QUANTITY_INCLUDE = {
  product: { select: { code: true, nameJa: true, nameEn: true } },
} as const;

export const MEASURED_INCLUDE = {
  statutorySubstance: {
    select: { officialNumber: true, nameJa: true, nameEn: true, nameOriginal: true },
  },
  substance: { select: { code: true, nameJa: true } },
} as const;

type QuantityRow = PrtrQuantity & {
  product: { code: string; nameJa: string; nameEn: string | null };
};
type MeasuredRow = PrtrMeasured & {
  statutorySubstance: {
    officialNumber: string | null;
    nameJa: string | null;
    nameEn: string | null;
    nameOriginal: string;
  };
  substance: { code: string; nameJa: string } | null;
};

/** 行を更新した人の名前（表示名が無ければメール）。消えた人は入らない。画面の「登録者」列に出す */
export async function updaterNames(
  rows: { updatedBy: string | null }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.updatedBy).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.displayName ?? u.email]));
}

export function toQuantityDto(q: QuantityRow, names: Map<string, string>): PrtrQuantityDto {
  return {
    id: q.id,
    method: q.method === "FACTOR" ? "FACTOR" : "BALANCE",
    productId: q.productId,
    productCode: q.product.code,
    productNameJa: q.product.nameJa,
    productNameEn: q.product.nameEn,
    purchasedKg: q.purchasedKg.toString(),
    shippedKg: q.shippedKg?.toString() ?? null,
    source: q.source,
    updatedByName: q.updatedBy ? (names.get(q.updatedBy) ?? null) : null,
    updatedAt: q.updatedAt.toISOString(),
  };
}

export function toMeasuredDto(x: MeasuredRow, names: Map<string, string>): PrtrMeasuredDto {
  const substance = x.substance;
  return {
    id: x.id,
    statutorySubstanceId: x.statutorySubstanceId,
    officialNumber: x.statutorySubstance.officialNumber,
    statutoryNameJa: x.statutorySubstance.nameJa,
    statutoryNameEn: x.statutorySubstance.nameEn,
    statutoryNameOriginal: x.statutorySubstance.nameOriginal,
    substanceCode: substance?.code ?? null,
    substanceNameJa: substance?.nameJa ?? null,
    handledKg: x.handledKg?.toString() ?? null,
    measuredKg: x.measuredKg.toString(),
    source: x.source,
    updatedByName: x.updatedBy ? (names.get(x.updatedBy) ?? null) : null,
    updatedAt: x.updatedAt.toISOString(),
  };
}

/** 所属 × 年度の届出データの頭と件数、確定の状態。頭が無ければ entry は null */
export async function loadEntry(organisationId: string, fiscalYear: number): Promise<PrtrEntryDto> {
  const entry = await prisma.prtrEntry.findUnique({
    where: { organisationId_fiscalYear: { organisationId, fiscalYear } },
    include: {
      _count: { select: { measured: true } },
      summary: { select: { confirmedAt: true } },
    },
  });
  if (!entry) {
    return { entry: null, balanceCount: 0, factorCount: 0, measuredCount: 0, confirmed: false };
  }
  const grouped = await prisma.prtrQuantity.groupBy({
    by: ["method"],
    where: { entryId: entry.id },
    _count: { _all: true },
  });
  const count = (k: string) => grouped.find((g) => g.method === k)?._count._all ?? 0;
  return {
    entry: toEntryHead(entry),
    balanceCount: count("BALANCE"),
    factorCount: count("FACTOR"),
    measuredCount: entry._count.measured,
    confirmed: entry.summary?.confirmedAt != null,
  };
}

export function toEntryHead(e: PrtrEntry): NonNullable<PrtrEntryDto["entry"]> {
  return {
    id: e.id,
    organisationId: e.organisationId,
    fiscalYear: e.fiscalYear,
    factorPct: e.factorPct?.toString() ?? null,
    note: e.note,
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** 集計が確定しているか。確定中は入力（製品・物質・係数）を変えられない */
export async function isConfirmed(entryId: string): Promise<boolean> {
  const s = await prisma.prtrSummary.findUnique({
    where: { entryId },
    select: { confirmedAt: true },
  });
  return s?.confirmedAt != null;
}

// ── 突合 ──────────────────────────────────────────────

/** 製品コードで製品を当てる（消した製品は当てない） */
export async function findProductByCode(code: string) {
  return prisma.product.findFirst({
    where: { codeNormalized: normalizeCode(code), deletedAt: null },
    select: { id: true, code: true, nameJa: true, nameEn: true },
  });
}

/** 現在の版で、化管法 第一種（C1）／特定第一種（SC1）の法文物質名に結び付く CAS リンクの条件 */
function prtrLinkWhere(versionId: string): Prisma.StatutoryCasLinkWhereInput {
  return {
    versionId,
    excluded: false,
    ...notDisabledIn(versionId),
    statutorySubstance: {
      deletedAt: null,
      regulationClass: {
        category: { code: { in: ["C1", "SC1"] }, deletedAt: null, law: { code: "JP-PRTR" } },
      },
    },
  };
}

/** 第一種指定化学物質に当たる CAS（正規化済み）の全体。物質検索の総数を数えるのに使う */
async function prtrCasList(): Promise<string[]> {
  const version = await getCurrentVersion();
  if (!version) return [];
  const links = await prisma.statutoryCasLink.findMany({
    where: prtrLinkWhere(version.id),
    select: { casNormalized: true },
    distinct: ["casNormalized"],
  });
  return links.map((l) => l.casNormalized);
}

/** CAS（正規化済み）→ 現在の版で結び付く化管法 第一種（C1）／特定第一種（SC1）の法文物質名。C1 を優先 */
async function prtrStatutoryByCas(
  casList: string[],
): Promise<
  Map<
    string,
    { id: string; officialNumber: string | null; nameJa: string | null; nameOriginal: string }
  >
> {
  const out = new Map<
    string,
    { id: string; officialNumber: string | null; nameJa: string | null; nameOriginal: string }
  >();
  if (casList.length === 0) return out;
  const version = await getCurrentVersion();
  if (!version) return out;
  const links = await prisma.statutoryCasLink.findMany({
    where: { ...prtrLinkWhere(version.id), casNormalized: { in: casList } },
    select: {
      casNormalized: true,
      statutorySubstanceId: true,
      statutorySubstance: {
        select: {
          officialNumber: true,
          nameJa: true,
          nameOriginal: true,
          regulationClass: { select: { category: { select: { code: true } } } },
        },
      },
    },
  });
  for (const l of links) {
    const cur = out.get(l.casNormalized);
    const isC1 = l.statutorySubstance.regulationClass.category.code === "C1";
    // どちらにも結び付けば C1 を採る（届出の別紙はどちらも同じ 1 枚）
    if (cur && !isC1) continue;
    out.set(l.casNormalized, {
      id: l.statutorySubstanceId,
      officialNumber: l.statutorySubstance.officialNumber,
      nameJa: l.statutorySubstance.nameJa,
      nameOriginal: l.statutorySubstance.nameOriginal,
    });
  }
  return out;
}

export type MeasuredResolve =
  | {
      ok: true;
      statutorySubstanceId: string;
      substance: { id: string; code: string; nameJa: string };
    }
  | { ok: false; reason: "substance_not_found" | "not_prtr" };

/**
 * 物質コード → 化管法の第一種指定化学物質（法文物質名）。
 * その物質の CAS が現在のバージョンで結び付く化管法 C1（第一種）か SC1（特定第一種）の法文物質名に当てる
 */
export async function resolveMeasuredSubstance(code: string): Promise<MeasuredResolve> {
  const substance = await prisma.substance.findFirst({
    where: { codeNormalized: normalizeCode(code), deletedAt: null },
    select: { id: true, code: true, nameJa: true, casNormalized: true },
  });
  if (!substance) return { ok: false, reason: "substance_not_found" };
  if (!substance.casNormalized) return { ok: false, reason: "not_prtr" };
  const hit = (await prtrStatutoryByCas([substance.casNormalized])).get(substance.casNormalized);
  if (!hit) return { ok: false, reason: "not_prtr" };
  return {
    ok: true,
    statutorySubstanceId: hit.id,
    substance: { id: substance.id, code: substance.code, nameJa: substance.nameJa },
  };
}

/**
 * 実測値の区画の「物質検索」。コードの一部・CAS（完全一致）・名称の一部で物質を探し、
 * 化管法の第一種指定化学物質に当たるものだけを返す（最大 limit 件）。
 * total は当たる物質の総数（画面は limit を超えたとき「全 N 件」と出す。製品検索と同じ形）
 */
export async function searchPrtrSubstances(
  q: { code: string; cas: string; name: string },
  limit = 20,
): Promise<{ items: PrtrSubstanceCandidateDto[]; total: number }> {
  const and: Prisma.SubstanceWhereInput[] = [];
  if (q.code) and.push({ codeNormalized: { contains: normalizeCode(q.code) } });
  if (q.cas) and.push({ casNormalized: normalizeCode(q.cas) });
  if (q.name) {
    const match = { contains: q.name, mode: "insensitive" as const };
    and.push({
      OR: [
        { nameJa: match },
        { nameEn: match },
        { aliases: { some: { OR: [{ nameJa: match }, { nameEn: match }] } } },
      ],
    });
  }
  if (and.length === 0) return { items: [], total: 0 };
  // 当たる物質だけを数えるため、第一種指定化学物質の CAS の全体で絞ってから引く
  const prtrCas = await prtrCasList();
  if (prtrCas.length === 0) return { items: [], total: 0 };
  const where: Prisma.SubstanceWhereInput = {
    deletedAt: null,
    casNormalized: { in: prtrCas },
    AND: and,
  };
  const [subs, total] = await Promise.all([
    prisma.substance.findMany({
      where,
      select: {
        id: true,
        code: true,
        nameJa: true,
        nameEn: true,
        casNumber: true,
        casNormalized: true,
      },
      orderBy: { codeNormalized: "asc" },
      take: limit,
    }),
    prisma.substance.count({ where }),
  ]);
  const byCas = await prtrStatutoryByCas([
    ...new Set(subs.map((s) => s.casNormalized).filter((c): c is string => !!c)),
  ]);
  const items: PrtrSubstanceCandidateDto[] = [];
  for (const s of subs) {
    const hit = s.casNormalized ? byCas.get(s.casNormalized) : undefined;
    if (!hit) continue;
    items.push({
      id: s.id,
      code: s.code,
      nameJa: s.nameJa,
      nameEn: s.nameEn,
      casNumber: s.casNumber,
      statutorySubstanceId: hit.id,
      officialNumber: hit.officialNumber,
      statutoryNameJa: hit.nameJa,
      statutoryNameOriginal: hit.nameOriginal,
    });
  }
  return { items, total };
}

// ── ファイルの読み取り ─────────────────────────────────

/** UTF-8（BOM 可）。UTF-8 として読めなければ Shift_JIS（Excel の既定の CSV）として読み直す */
function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

/** 区切り文字付きの文字列を行 × 列に。引用符（"）の中の区切りと改行、"" は 1 つの " として扱う */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // 空行は落とす
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Excel は最初のシート。セルの値は文字にする（数式は結果、日付はそのまま文字） */
async function parseExcel(bytes: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const values = row.values as unknown[];
    // exceljs は 1 始まりの配列で返す
    for (let c = 1; c < values.length; c++) cells.push(cellToText(values[c]));
    if (cells.some((c) => c.trim() !== "")) rows.push(cells);
  });
  return rows;
}

function cellToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.result !== undefined) return cellToText(o.result);
    if (o.text !== undefined) return String(o.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v);
}

/** ファイル名の拡張子で形式を決めて、行 × 列にする。読めなければ null */
export async function readRows(fileName: string, bytes: Buffer): Promise<string[][] | null> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  try {
    if (ext === "xlsx") return await parseExcel(bytes);
    if (ext === "tsv" || ext === "txt") return parseDelimited(decodeText(bytes), "\t");
    if (ext === "csv") {
      const text = decodeText(bytes);
      // Excel が TSV を .csv で出すこともあるので、1 行目にタブがあればタブ区切り
      const first = text.split(/\r?\n/, 1)[0] ?? "";
      return parseDelimited(text, first.includes("\t") && !first.includes(",") ? "\t" : ",");
    }
    return null;
  } catch {
    return null;
  }
}

export function inspectRows(rows: string[][]): PrtrImportInspectDto | null {
  const headers = rows[0];
  if (!headers || headers.every((h) => h.trim() === "")) return null;
  return {
    headers: headers.map((h) => h.trim()),
    sample: rows.slice(1, 6),
    rowCount: rows.length - 1,
  };
}

// ── 取り込み（下見と実行） ─────────────────────────────

interface ParsedQuantity {
  line: number;
  productId: string;
  productCode: string;
  purchasedKg: string;
  shippedKg: string;
  nameMismatch: boolean;
}

interface ParsedMeasured {
  line: number;
  statutorySubstanceId: string;
  substanceId: string;
  handledKg: string | null;
  measuredKg: string;
  nameMismatch: boolean;
}

const cellAt = (row: string[], i: number | undefined) => (i == null ? "" : (row[i] ?? "").trim());

/** 製品ごとの数量の取り込み。列の割り当てに従って読み、製品コードで当てる。取扱量・出荷量とも要る */
async function parseQuantities(
  rows: string[][],
  mapping: Record<string, number>,
  m: Messages,
): Promise<{ ok: ParsedQuantity[]; errors: { line: number; message: string }[] }> {
  const ok: ParsedQuantity[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const line = r + 1;
    const code = cellAt(row, mapping.productCode);
    const purchased = cellAt(row, mapping.purchasedKg).replace(/,/g, "");
    const shipped = cellAt(row, mapping.shippedKg).replace(/,/g, "");
    if (code === "") {
      errors.push({ line, message: `${m.prtr.quantities.productCode}: ${m.validation.required}` });
      continue;
    }
    const product = await findProductByCode(code);
    if (!product) {
      errors.push({ line, message: m.prtr.quantities.productNotFound(code) });
      continue;
    }
    if (!KG.test(purchased)) {
      errors.push({ line, message: `${m.prtr.quantities.purchasedKg}: ${m.prtr.validation.kg}` });
      continue;
    }
    if (!KG.test(shipped)) {
      errors.push({ line, message: `${m.prtr.quantities.shippedKg}: ${m.prtr.validation.kg}` });
      continue;
    }
    if (isBothZero(purchased, shipped)) {
      errors.push({ line, message: m.prtr.validation.bothZero });
      continue;
    }
    const key = normalizeCode(code);
    if (seen.has(key)) {
      errors.push({
        line,
        message: `${m.prtr.quantities.productCode} ${code}: ${m.prtr.validation.duplicateRow}`,
      });
      continue;
    }
    seen.add(key);
    const name = cellAt(row, mapping.productName);
    ok.push({
      line,
      productId: product.id,
      productCode: product.code,
      purchasedKg: purchased,
      shippedKg: shipped,
      nameMismatch: name !== "" && name !== product.nameJa && name !== (product.nameEn ?? ""),
    });
  }
  return { ok, errors };
}

/** 実測値の区画の取り込み。物質コードで当て、第一種指定化学物質に変換する。排出量は要る、取扱量は任意 */
async function parseMeasured(
  rows: string[][],
  mapping: Record<string, number>,
  m: Messages,
): Promise<{ ok: ParsedMeasured[]; errors: { line: number; message: string }[] }> {
  const ok: ParsedMeasured[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const line = r + 1;
    const code = cellAt(row, mapping.substanceCode);
    const handled = cellAt(row, mapping.handledKg).replace(/,/g, "");
    const kg = cellAt(row, mapping.measuredKg).replace(/,/g, "");
    if (code === "") {
      errors.push({ line, message: `${m.prtr.measured.substanceCode}: ${m.validation.required}` });
      continue;
    }
    const resolved = await resolveMeasuredSubstance(code);
    if (!resolved.ok) {
      errors.push({
        line,
        message:
          resolved.reason === "substance_not_found"
            ? m.prtr.measured.substanceNotFound(code)
            : m.prtr.measured.notPrtrSubstance(code),
      });
      continue;
    }
    if (handled !== "" && !KG.test(handled)) {
      errors.push({ line, message: `${m.prtr.measured.handledKg}: ${m.prtr.validation.kg}` });
      continue;
    }
    if (!KG.test(kg)) {
      errors.push({ line, message: `${m.prtr.measured.measuredKg}: ${m.prtr.validation.kg}` });
      continue;
    }
    if (seen.has(resolved.statutorySubstanceId)) {
      errors.push({ line, message: `${code}: ${m.prtr.validation.duplicateRow}` });
      continue;
    }
    seen.add(resolved.statutorySubstanceId);
    const name = cellAt(row, mapping.substanceName);
    ok.push({
      line,
      statutorySubstanceId: resolved.statutorySubstanceId,
      substanceId: resolved.substance.id,
      handledKg: handled === "" ? null : handled,
      measuredKg: kg,
      nameMismatch: name !== "" && name !== resolved.substance.nameJa,
    });
  }
  return { ok, errors };
}

/** 必須の項目に列が割り当たっているか */
export function missingRequired(kind: PrtrImportKind, mapping: Record<string, number>): string[] {
  return PRTR_IMPORT_FIELDS[kind]
    .filter((f) => f.required && mapping[f.key] == null)
    .map((f) => f.key);
}

/**
 * 取り込みの下見と実行。**下見（dryRun）は何も書かない。**
 * 製品ごとの数量: 指定した区画（物質収支・排出係数）の表に入れる。重ね方は「上書き＋追加」か「その表を全部入れ替え」。
 * 実測値: 既に行がある物質があれば上書きの答えを待つ
 */
export async function runImport(
  entry: PrtrEntry,
  rows: string[][],
  input: PrtrImportInput,
  actorId: string,
  m: Messages,
): Promise<PrtrImportResultDto> {
  const result: PrtrImportResultDto = {
    readable: 0,
    unreadable: 0,
    willAdd: 0,
    willUpdate: 0,
    willRemove: 0,
    nameMismatch: 0,
    conflicts: 0,
    errors: [],
    applied: false,
    needsOverwrite: false,
  };

  if (input.kind === "quantities") {
    const method: PrtrProductMethod = input.method ?? "BALANCE";
    const parsed = await parseQuantities(rows, input.mapping, m);
    const existing = await prisma.prtrQuantity.findMany({
      where: { entryId: entry.id, method },
      select: { id: true, productId: true },
    });
    const byProduct = new Map(existing.map((q) => [q.productId, q.id]));
    const mode = input.mode ?? "upsert";
    result.readable = parsed.ok.length;
    result.unreadable = parsed.errors.length;
    result.errors = parsed.errors.slice(0, 50);
    result.nameMismatch = parsed.ok.filter((q) => q.nameMismatch).length;
    result.willUpdate = parsed.ok.filter((q) => byProduct.has(q.productId)).length;
    result.willAdd = parsed.ok.length - result.willUpdate;
    result.willRemove = mode === "replace" ? existing.length - result.willUpdate : 0;
    if (input.dryRun || parsed.ok.length === 0) return result;

    await prisma.$transaction(async (tx) => {
      if (mode === "replace") {
        // 入れ替えは、その区画の表の中だけ。もう一方の区画は触らない
        await tx.prtrQuantity.deleteMany({
          where: {
            entryId: entry.id,
            method,
            productId: { notIn: parsed.ok.map((q) => q.productId) },
          },
        });
      }
      for (const q of parsed.ok) {
        const data = {
          purchasedKg: new Prisma.Decimal(q.purchasedKg),
          shippedKg: new Prisma.Decimal(q.shippedKg),
          source: "IMPORT" as const,
          updatedBy: actorId,
        };
        await tx.prtrQuantity.upsert({
          where: {
            entryId_method_productId: { entryId: entry.id, method, productId: q.productId },
          },
          create: { entryId: entry.id, method, productId: q.productId, ...data },
          update: data,
        });
      }
      await tx.prtrEntry.update({ where: { id: entry.id }, data: { updatedBy: actorId } });
    });
    result.applied = true;
    return result;
  }

  // 実測値（物質ごとの取扱量・排出量）
  const parsed = await parseMeasured(rows, input.mapping, m);
  const existing = await prisma.prtrMeasured.findMany({
    where: { entryId: entry.id },
    select: { statutorySubstanceId: true },
  });
  const have = new Set(existing.map((x) => x.statutorySubstanceId));
  result.readable = parsed.ok.length;
  result.unreadable = parsed.errors.length;
  result.errors = parsed.errors.slice(0, 50);
  result.conflicts = parsed.ok.filter((x) => have.has(x.statutorySubstanceId)).length;
  result.nameMismatch = parsed.ok.filter((x) => x.nameMismatch).length;
  result.willUpdate = result.conflicts;
  result.willAdd = parsed.ok.length - result.conflicts;
  if (input.dryRun || parsed.ok.length === 0) return result;
  // 既に値がある物質に当たったら、OK の答えが無いかぎり何も取り込まない（中途半端にしない）
  if (result.conflicts > 0 && !input.overwrite) {
    result.needsOverwrite = true;
    return result;
  }
  await prisma.$transaction(async (tx) => {
    for (const x of parsed.ok) {
      const data = {
        handledKg: x.handledKg === null ? null : new Prisma.Decimal(x.handledKg),
        measuredKg: new Prisma.Decimal(x.measuredKg),
        substanceId: x.substanceId,
        source: "IMPORT" as const,
        updatedBy: actorId,
      };
      await tx.prtrMeasured.upsert({
        where: {
          entryId_statutorySubstanceId: {
            entryId: entry.id,
            statutorySubstanceId: x.statutorySubstanceId,
          },
        },
        create: { entryId: entry.id, statutorySubstanceId: x.statutorySubstanceId, ...data },
        update: data,
      });
    }
    await tx.prtrEntry.update({ where: { id: entry.id }, data: { updatedBy: actorId } });
  });
  result.applied = true;
  return result;
}

// ── 集計 ─────────────────────────────────────────────

/**
 * 届出要否の閾値（kg）。化管法の定め: 第一種 1 t、特定第一種 0.5 t。
 * 設定で変えられるようにするのは、要望が出てから
 */
export const PRTR_THRESHOLD_KG = "1000";
export const PRTR_THRESHOLD_SPECIFIC_KG = "500";

const D = (v: string | number | Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0);
/** kg の表示。小数 3 桁で丸め、末尾の 0 は落とす */
const kg = (v: Prisma.Decimal) => v.toDecimalPlaces(3).toString();

/**
 * 所属 × 年度の「いまの集計」（第一種指定化学物質ごと）。**開くたびに丸ごと作り直して保存する**
 * （`saved=false` の行。保存した集計 `saved=true` の行は触らない）。
 *
 * 含有率は製品の**判定結果**（現在の版、化管法 第一種・特定第一種で該当）から取る。
 * 裾切値未満の製品と、不純物種別で除外した物質はそこで落ちている。
 *   取扱量 = 物質収支の製品の取扱量 × 含有率 ＋ 排出係数の製品の取扱量 × 含有率 ＋ 実測値の物質の取扱量
 *   排出量 = 物質収支（取扱量 − 出荷量）× 含有率 ＋ 排出係数 出荷量 × 含有率 × 係数 ÷ 100 ＋ 実測値の排出量
 *   排出係数の製品の取扱量は届出要否の判断にだけ使う（物質収支には入れない）。
 *   どの方法でも出せなければ排出量は null。内訳（物質収支／排出係数／実測値）も残す
 * 特定第一種は第一種の一部なので、同じ物質が両方の区分で該当する。届出は物質 1 つに 1 行なので、
 * **法律上の番号（管理番号）で 1 行にまとめ**、特定第一種に入っていればその閾値（0.5 t）を使う。
 * 同じ製品が両方の区分で当たっても数量は 1 回しか足さない。届出要否は取扱量の合計で見る。
 * 判定がまだ無い製品（現在の版で判定していない製品）は数えて知らせ、集計には入れない
 */
export async function summarizeEntry(entry: PrtrEntry, actorId: string): Promise<PrtrSummaryMeta> {
  const quantities = await prisma.prtrQuantity.findMany({
    where: { entryId: entry.id },
    select: { productId: true, method: true, purchasedKg: true, shippedKg: true },
  });
  const productIds = [...new Set(quantities.map((q) => q.productId))];
  const hasProduct = new Set(productIds);

  const version = await getCurrentVersion();
  const judgements =
    productIds.length && version
      ? await prisma.productJudgement.findMany({
          where: {
            productId: { in: productIds },
            versionId: version.id,
            statutorySubstanceId: { not: "" },
            // 施行前・適用終了のものは集計に載せない（2026-09-22 決定）
            effective: "IN_FORCE",
            category: { law: { code: "JP-PRTR" }, code: { in: ["C1", "SC1"] } },
          },
          select: {
            productId: true,
            statutorySubstanceId: true,
            verdict: true,
            category: { select: { code: true } },
            hits: { select: { total: true, contributions: true } },
          },
        })
      : [];
  // 「判定済み」は展開結果の判定版で見る。判定の行は当たった分しか無いので、
  // 化管法に当たらない製品は行が 0 件でも判定済み（決定 0012）
  const judgedProducts = new Set(
    productIds.length && version
      ? (
          await prisma.productExpansion.findMany({
            where: { productId: { in: productIds }, judgedVersionId: version.id },
            select: { productId: true },
          })
        ).map((x) => x.productId)
      : [],
  );

  // 実測値の区画（物質ごとの取扱量・排出量）。数量から当たらない物質も並べる
  const measured = await prisma.prtrMeasured.findMany({
    where: { entryId: entry.id },
    select: { statutorySubstanceId: true, handledKg: true, measuredKg: true },
  });

  const ids = [
    ...new Set([
      ...judgements.filter((j) => j.verdict === "APPLICABLE").map((j) => j.statutorySubstanceId),
      ...measured.map((x) => x.statutorySubstanceId),
    ]),
  ];
  const names = ids.length
    ? await prisma.statutorySubstance.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          officialNumber: true,
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          displayOrder: true,
          regulationClass: { select: { category: { select: { code: true } } } },
        },
      })
    : [];
  type Name = (typeof names)[number];
  const nameOf = new Map(names.map((n) => [n.id, n]));
  /** 法文物質名 → まとめ先の鍵（管理番号。無ければ自分の ID） */
  const keyOf = (id: string) => nameOf.get(id)?.officialNumber ?? id;

  interface Group {
    /** 表示に使う法文物質名（第一種の側を優先） */
    name: Name;
    specific: boolean;
    /** 製品ごとの含有率（%）。両方の区分で当たったときは大きいほう */
    pctByProduct: Map<string, Prisma.Decimal>;
    /** 実測値の区画: 取扱量の合計・排出量の合計 */
    handledDirect: Prisma.Decimal;
    measured: Prisma.Decimal | null;
  }
  const groups = new Map<string, Group>();
  const groupFor = (id: string): Group | null => {
    const name = nameOf.get(id);
    if (!name) return null;
    const key = keyOf(id);
    const specific = name.regulationClass.category.code === "SC1";
    let g = groups.get(key);
    if (!g) {
      g = { name, specific, pctByProduct: new Map(), handledDirect: D(0), measured: null };
      groups.set(key, g);
    } else {
      if (specific) g.specific = true;
      else if (g.name.regulationClass.category.code === "SC1") g.name = name;
    }
    return g;
  };

  for (const j of judgements) {
    if (j.verdict !== "APPLICABLE" || !hasProduct.has(j.productId)) continue;
    const g = groupFor(j.statutorySubstanceId);
    if (!g) continue;
    // 含有率: 合算した値があればそれ、無ければ CAS ごとの寄与を足す（根拠の行は通常 1 つ）
    const pct = j.hits.reduce(
      (sum, h) =>
        sum.plus(
          h.total !== null
            ? D(h.total)
            : (Array.isArray(h.contributions)
                ? (h.contributions as { pct?: string }[])
                : []
              ).reduce((s, c) => s.plus(D(c.pct ?? 0)), D(0)),
        ),
      D(0),
    );
    const prev = g.pctByProduct.get(j.productId);
    if (!prev || prev.lt(pct)) g.pctByProduct.set(j.productId, pct);
  }
  for (const x of measured) {
    const g = groupFor(x.statutorySubstanceId);
    if (!g) continue;
    if (x.handledKg !== null) g.handledDirect = g.handledDirect.plus(D(x.handledKg));
    g.measured = (g.measured ?? D(0)).plus(D(x.measuredKg));
  }

  const factor = entry.factorPct !== null ? D(entry.factorPct) : null;
  const factorMissing = factor === null && quantities.some((q) => q.method === "FACTOR");
  const rows = [...groups.values()].map((g) => {
    // 区画ごとの取扱量・出荷量（物質収支／排出係数）。その区画に行があるかも覚える（無ければ内訳は null）
    let handledB = D(0);
    let shippedB = D(0);
    let handledF = D(0);
    let shippedF = D(0);
    let hasB = false;
    let hasF = false;
    for (const q of quantities) {
      const pct = g.pctByProduct.get(q.productId);
      if (!pct) continue;
      const handled = D(q.purchasedKg).mul(pct).div(100);
      const shipped = D(q.shippedKg).mul(pct).div(100);
      if (q.method === "FACTOR") {
        hasF = true;
        handledF = handledF.plus(handled);
        shippedF = shippedF.plus(shipped);
      } else {
        hasB = true;
        handledB = handledB.plus(handled);
        shippedB = shippedB.plus(shipped);
      }
    }
    const handled = handledB.plus(handledF).plus(g.handledDirect);
    const shipped = shippedB.plus(shippedF);
    const releaseBalance = hasB ? handledB.minus(shippedB) : null;
    const releaseFactor = hasF && factor !== null ? shippedF.mul(factor).div(100) : null;
    const releaseMeasured = g.measured;
    const parts = [releaseMeasured, releaseBalance, releaseFactor].filter(
      (v): v is Prisma.Decimal => v !== null,
    );
    const release = parts.length === 0 ? null : parts.reduce((sum, v) => sum.plus(v), D(0));
    const threshold = D(g.specific ? PRTR_THRESHOLD_SPECIFIC_KG : PRTR_THRESHOLD_KG);
    const r3 = (v: Prisma.Decimal | null) => (v === null ? null : v.toDecimalPlaces(3));
    return {
      statutorySubstanceId: g.name.id,
      specific: g.specific,
      productCount: g.pctByProduct.size,
      handledKg: handled.toDecimalPlaces(3),
      shippedKg: shipped.toDecimalPlaces(3),
      releaseKg: r3(release),
      releaseMeasuredKg: r3(releaseMeasured),
      releaseBalanceKg: r3(releaseBalance),
      releaseFactorKg: r3(releaseFactor),
      needsReport: handled.gte(threshold),
    };
  });

  // いまの集計を消して、丸ごと入れ直す（保存した集計の行は残す）
  const head = {
    versionId: version?.id ?? null,
    factorPct: entry.factorPct,
    factorMissing,
    productCount: productIds.length,
    unjudgedProducts: productIds.filter((id) => !judgedProducts.has(id)).length,
    thresholdKg: D(PRTR_THRESHOLD_KG),
    thresholdSpecificKg: D(PRTR_THRESHOLD_SPECIFIC_KG),
    computedAt: new Date(),
    computedBy: actorId,
  };
  const saved = await prisma.$transaction(async (tx) => {
    const summary = await tx.prtrSummary.upsert({
      where: { entryId: entry.id },
      create: { entryId: entry.id, ...head },
      update: head,
    });
    await tx.prtrSummaryRow.deleteMany({ where: { summaryId: summary.id, saved: false } });
    if (rows.length) {
      await tx.prtrSummaryRow.createMany({
        data: rows.map((r) => ({ summaryId: summary.id, saved: false, ...r })),
      });
    }
    return tx.prtrSummary.findUniqueOrThrow({
      where: { id: summary.id },
      include: SUMMARY_HEAD_INCLUDE,
    });
  });
  return toSummaryMeta(saved);
}

/** 行の中身を 1 つの文字列に。いまの集計と保存した集計が同じかを比べるためだけに使う */
function rowsFingerprint(
  rows: Pick<
    PrtrSummaryRow,
    | "statutorySubstanceId"
    | "specific"
    | "productCount"
    | "handledKg"
    | "shippedKg"
    | "releaseKg"
    | "releaseMeasuredKg"
    | "releaseBalanceKg"
    | "releaseFactorKg"
    | "needsReport"
  >[],
): string {
  return rows
    .map((r) =>
      [
        r.statutorySubstanceId,
        r.specific,
        r.productCount,
        r.handledKg.toString(),
        r.shippedKg?.toString() ?? "",
        r.releaseKg?.toString() ?? "",
        r.releaseMeasuredKg?.toString() ?? "",
        r.releaseBalanceKg?.toString() ?? "",
        r.releaseFactorKg?.toString() ?? "",
        r.needsReport,
      ].join("|"),
    )
    .sort()
    .join("\n");
}

/** いまの集計と保存した集計が違うか（保存していなければ、いまの集計に行があれば違う扱い） */
export async function summaryDiffers(summaryId: string, savedAt: Date | null): Promise<boolean> {
  const [working, saved] = await Promise.all([
    prisma.prtrSummaryRow.findMany({ where: { summaryId, saved: false } }),
    prisma.prtrSummaryRow.findMany({ where: { summaryId, saved: true } }),
  ]);
  if (savedAt === null) return working.length > 0;
  return rowsFingerprint(working) !== rowsFingerprint(saved);
}

/**
 * 「保存」: いまの集計を写し取って「保存した集計」にする（未確定になる）。
 * 「確定」: 保存した集計を確定にする（入力は読み取り専用になる）。「未確定に戻す」: 確定を外す
 */
export async function saveSummary(entryId: string, actorId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const summary = await tx.prtrSummary.findUniqueOrThrow({
      where: { entryId },
      include: { version: { select: { code: true } } },
    });
    const working = await tx.prtrSummaryRow.findMany({
      where: { summaryId: summary.id, saved: false },
    });
    await tx.prtrSummaryRow.deleteMany({ where: { summaryId: summary.id, saved: true } });
    if (working.length) {
      await tx.prtrSummaryRow.createMany({
        data: working.map(({ id: _id, ...r }) => ({ ...r, saved: true })),
      });
    }
    await tx.prtrSummary.update({
      where: { id: summary.id },
      data: {
        savedAt: new Date(),
        savedBy: actorId,
        savedVersionCode: summary.version?.code ?? null,
        savedFactorPct: summary.factorPct,
        confirmedAt: null,
        confirmedBy: null,
      },
    });
  });
}

export async function setConfirmed(entryId: string, actorId: string, on: boolean): Promise<void> {
  await prisma.prtrSummary.update({
    where: { entryId },
    data: on
      ? { confirmedAt: new Date(), confirmedBy: actorId }
      : { confirmedAt: null, confirmedBy: null },
  });
}

export const SUMMARY_HEAD_INCLUDE = { version: { select: { code: true } } } as const;
export const SUMMARY_ROW_INCLUDE = {
  statutorySubstance: {
    select: { officialNumber: true, nameJa: true, nameEn: true, nameOriginal: true },
  },
} as const;

export function toSummaryMeta(
  x: PrtrSummary & { version: { code: string } | null },
): PrtrSummaryMeta {
  return {
    computedAt: x.computedAt.toISOString(),
    versionCode: x.version?.code ?? null,
    factorPct: x.factorPct?.toString() ?? null,
    factorMissing: x.factorMissing,
    productCount: x.productCount,
    unjudgedProducts: x.unjudgedProducts,
    thresholdKg: kg(x.thresholdKg),
    thresholdSpecificKg: kg(x.thresholdSpecificKg),
    savedAt: x.savedAt?.toISOString() ?? null,
    savedVersionCode: x.savedVersionCode,
    confirmedAt: x.confirmedAt?.toISOString() ?? null,
    // 違うかどうかは API 側で付ける（行を読む必要があるため）
    unsavedChanges: false,
  };
}

export function toSummaryRowDto(
  r: PrtrSummaryRow & {
    statutorySubstance: {
      officialNumber: string | null;
      nameJa: string | null;
      nameEn: string | null;
      nameOriginal: string;
    };
  },
): PrtrSummaryRowDto {
  return {
    statutorySubstanceId: r.statutorySubstanceId,
    officialNumber: r.statutorySubstance.officialNumber,
    nameJa: r.statutorySubstance.nameJa,
    nameEn: r.statutorySubstance.nameEn,
    nameOriginal: r.statutorySubstance.nameOriginal,
    specific: r.specific,
    handledKg: kg(r.handledKg),
    shippedKg: r.shippedKg === null ? null : kg(r.shippedKg),
    releaseKg: r.releaseKg === null ? null : kg(r.releaseKg),
    releaseMeasuredKg: r.releaseMeasuredKg === null ? null : kg(r.releaseMeasuredKg),
    releaseBalanceKg: r.releaseBalanceKg === null ? null : kg(r.releaseBalanceKg),
    releaseFactorKg: r.releaseFactorKg === null ? null : kg(r.releaseFactorKg),
    needsReport: r.needsReport,
    productCount: r.productCount,
  };
}
