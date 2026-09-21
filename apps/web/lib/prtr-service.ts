import {
  normalizeCode,
  PRTR_IMPORT_FIELDS,
  type Messages,
  type PrtrImportInput,
  type PrtrImportKind,
} from "@chem/shared";
import { Prisma, type PrtrEntry, type PrtrMeasured, type PrtrQuantity } from "@prisma/client";
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
} from "@/lib/types";

/**
 * PRTR 届出データの入力（S22）。
 *
 * 所属（組織）× 年度で 1 組。製品ごとの数量と、実測値のときは物質ごとの kg。
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

export function toQuantityDto(q: QuantityRow): PrtrQuantityDto {
  return {
    id: q.id,
    productId: q.productId,
    productCode: q.product.code,
    productNameJa: q.product.nameJa,
    productNameEn: q.product.nameEn,
    purchasedKg: q.purchasedKg.toString(),
    shippedKg: q.shippedKg?.toString() ?? null,
    source: q.source,
    updatedAt: q.updatedAt.toISOString(),
  };
}

export function toMeasuredDto(x: MeasuredRow): PrtrMeasuredDto {
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
    measuredKg: x.measuredKg.toString(),
    source: x.source,
    updatedAt: x.updatedAt.toISOString(),
  };
}

/** 所属 × 年度の届出データを丸ごと読む。頭が無ければ entry は null */
export async function loadEntry(organisationId: string, fiscalYear: number): Promise<PrtrEntryDto> {
  const entry = await prisma.prtrEntry.findUnique({
    where: { organisationId_fiscalYear: { organisationId, fiscalYear } },
    include: {
      quantities: { include: QUANTITY_INCLUDE, orderBy: { product: { codeNormalized: "asc" } } },
      measured: {
        include: MEASURED_INCLUDE,
        orderBy: { statutorySubstance: { displayOrder: "asc" } },
      },
    },
  });
  if (!entry) return { entry: null, quantities: [], measured: [] };
  return {
    entry: toEntryHead(entry),
    quantities: entry.quantities.map(toQuantityDto),
    measured: entry.measured.map(toMeasuredDto),
  };
}

export function toEntryHead(e: PrtrEntry): NonNullable<PrtrEntryDto["entry"]> {
  return {
    id: e.id,
    organisationId: e.organisationId,
    fiscalYear: e.fiscalYear,
    method: e.method,
    factorPct: e.factorPct?.toString() ?? null,
    note: e.note,
    updatedAt: e.updatedAt.toISOString(),
  };
}

// ── 突合 ──────────────────────────────────────────────

/** 製品コードで製品を当てる（消した製品は当てない） */
export async function findProductByCode(code: string) {
  return prisma.product.findFirst({
    where: { codeNormalized: normalizeCode(code), deletedAt: null },
    select: { id: true, code: true, nameJa: true, nameEn: true },
  });
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
 * その物質の CAS が現在のバージョンで結び付く化管法 C1（第一種）か SC1（特定第一種）の法文物質名に当てる。
 * どちらにも結び付けば C1 を採る（届出の別紙はどちらも同じ 1 枚）
 */
export async function resolveMeasuredSubstance(code: string): Promise<MeasuredResolve> {
  const substance = await prisma.substance.findFirst({
    where: { codeNormalized: normalizeCode(code), deletedAt: null },
    select: { id: true, code: true, nameJa: true, casNormalized: true },
  });
  if (!substance) return { ok: false, reason: "substance_not_found" };
  if (!substance.casNormalized) return { ok: false, reason: "not_prtr" };
  const version = await getCurrentVersion();
  if (!version) return { ok: false, reason: "not_prtr" };
  const links = await prisma.statutoryCasLink.findMany({
    where: {
      versionId: version.id,
      casNormalized: substance.casNormalized,
      excluded: false,
      ...notDisabledIn(version.id),
      statutorySubstance: {
        deletedAt: null,
        regulationClass: {
          category: { code: { in: ["C1", "SC1"] }, deletedAt: null, law: { code: "JP-PRTR" } },
        },
      },
    },
    select: {
      statutorySubstanceId: true,
      statutorySubstance: {
        select: { regulationClass: { select: { category: { select: { code: true } } } } },
      },
    },
  });
  if (links.length === 0) return { ok: false, reason: "not_prtr" };
  const c1 = links.find((l) => l.statutorySubstance.regulationClass.category.code === "C1");
  return {
    ok: true,
    statutorySubstanceId: (c1 ?? links[0]!).statutorySubstanceId,
    substance: { id: substance.id, code: substance.code, nameJa: substance.nameJa },
  };
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
  shippedKg: string | null;
  nameMismatch: boolean;
}

interface ParsedMeasured {
  line: number;
  statutorySubstanceId: string;
  substanceId: string;
  measuredKg: string;
  nameMismatch: boolean;
}

const cellAt = (row: string[], i: number | undefined) => (i == null ? "" : (row[i] ?? "").trim());

/** 数量の取り込み。列の割り当てに従って読み、製品コードで当てる */
async function parseQuantities(
  rows: string[][],
  mapping: Record<string, number>,
  shippedRequired: boolean,
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
    if (shipped !== "" && !KG.test(shipped)) {
      errors.push({ line, message: `${m.prtr.quantities.shippedKg}: ${m.prtr.validation.kg}` });
      continue;
    }
    if (shipped === "" && shippedRequired) {
      errors.push({ line, message: m.prtr.quantities.shippedRequired });
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
      shippedKg: shipped === "" ? null : shipped,
      nameMismatch: name !== "" && name !== product.nameJa && name !== (product.nameEn ?? ""),
    });
  }
  return { ok, errors };
}

/** 実測値の取り込み。物質コードで当て、第一種指定化学物質に変換する */
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
 * 数量: 重ね方は「上書き＋追加」か「全部入れ替え」。実測値: 既に値がある物質があれば上書きの答えを待つ
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
    const shippedRequired = entry.method !== "MEASURED";
    const parsed = await parseQuantities(rows, input.mapping, shippedRequired, m);
    const existing = await prisma.prtrQuantity.findMany({
      where: { entryId: entry.id },
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
        await tx.prtrQuantity.deleteMany({
          where: { entryId: entry.id, productId: { notIn: parsed.ok.map((q) => q.productId) } },
        });
      }
      for (const q of parsed.ok) {
        const data = {
          purchasedKg: new Prisma.Decimal(q.purchasedKg),
          shippedKg: q.shippedKg === null ? null : new Prisma.Decimal(q.shippedKg),
          source: "IMPORT" as const,
          updatedBy: actorId,
        };
        await tx.prtrQuantity.upsert({
          where: { entryId_productId: { entryId: entry.id, productId: q.productId } },
          create: { entryId: entry.id, productId: q.productId, ...data },
          update: data,
        });
      }
      await tx.prtrEntry.update({ where: { id: entry.id }, data: { updatedBy: actorId } });
    });
    result.applied = true;
    return result;
  }

  // 実測値
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
