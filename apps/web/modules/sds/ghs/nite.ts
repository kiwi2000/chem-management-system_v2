import { looksLikeCas, normalizeCas } from "@chem/shared";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { defaultHCodes } from "./catalog-data";

/**
 * NITE「政府による GHS 分類結果」の読み手（S23 段 0）。
 *
 * 読むのは **NITE 統合版**（物質ごとに最新の結果を 1 行、35 のクラスが各 1 列）と、
 * 任意で **根拠一覧**（縦持ち。項目ごとの分類根拠・分類年度・分類ガイダンス）。
 * 統合版は全件の写しなので、取り込みは「丸ごと配布」として差分を出す（import-service）。
 *
 * ここは Excel の中身を「項目（物質）と、その分類の並び」に起こすだけで、DB を知らない。
 * 読めなかったセルは捨てずに `issues` に残す（取り込みを 1 セルで止めない）
 */

export type ClassStatus =
  "CLASSIFIED" | "NOT_CLASSIFIED" | "CANNOT_CLASSIFY" | "NOT_APPLICABLE" | "NOT_EVALUATED";

export interface ParsedClassification {
  hazardClass: string;
  /** 区分。該当しない等のときは空 */
  category: string;
  status: ClassStatus;
  targetOrgans?: string;
  /** カタログか標的臓器の文から引いた H コード */
  hCodes: string[];
  rawClassText: string;
  /** 根拠一覧から（あれば） */
  ghsRevision?: string;
  classifiedIn?: string;
  rationale?: string;
  /** 最小分類の印（EU の * ** ***）と、H コードが原典に書いてあったか */
  minimumClassification?: string;
  hCodesOrigin?: "SOURCE" | "CATALOG";
}

export interface ParsedEntry {
  /** 物質 ID（m-nite-<CAS>、形態違いは末尾 a/b/c。CAS 無しは m-nite-nocas-NNNN） */
  sourceKey: string;
  subKey: string;
  /** CAS（1 セルに複数並ぶことがある。26 物質） */
  cas: { raw: string; normalized: string }[];
  name: string;
  classifications: ParsedClassification[];
  rawRow: string;
  issues: string[];
  /** 行ごとの適用開始日・終了日（EU の ATP のように出典が持つとき。無ければ公表の日付） */
  effectiveFrom?: string;
  effectiveTo?: string;
  nameEn?: string;
  ecNumber?: string;
  conditionText?: string;
  notesRaw?: string;
  amendingAct?: string;
  labellingRaw?: string;
  limitsRaw?: string;
}

export interface ParseResult {
  entries: ParsedEntry[];
  /** ファイル全体の問題（見出しが違う等） */
  issues: string[];
}

/** 統合版の 35 列 → クラスコード。見出しの文字（全角スペース含む）は NITE のファイルのまま */
export const NITE_COLUMNS: Record<string, string> = {
  爆発物: "EXPL",
  可燃性ガス: "FLAM_GAS",
  エアゾール: "AEROSOL",
  酸化性ガス: "OX_GAS",
  高圧ガス: "PRESS_GAS",
  引火性液体: "FLAM_LIQ",
  可燃性固体: "FLAM_SOL",
  自己反応性化学品: "SELF_REACT",
  自然発火性液体: "PYR_LIQ",
  自然発火性固体: "PYR_SOL",
  自己発熱性化学品: "SELF_HEAT",
  水反応可燃性化学品: "WATER_REACT",
  酸化性液体: "OX_LIQ",
  酸化性固体: "OX_SOL",
  有機過酸化物: "ORG_PEROX",
  金属腐食性化学品: "MET_CORR",
  鈍性化爆発物: "DESENS_EXPL",
  "急性毒性（経口）": "ACUTE_TOX_ORAL",
  "急性毒性（経皮）": "ACUTE_TOX_DERMAL",
  "急性毒性（吸入：ガス）": "ACUTE_TOX_INHAL_GAS",
  "急性毒性（吸入：蒸気）": "ACUTE_TOX_INHAL_VAPOUR",
  "急性毒性（吸入：粉塵、ミスト）": "ACUTE_TOX_INHAL_DUST",
  "皮膚腐食性／刺激性": "SKIN_CORR_IRRIT",
  "眼に対する重篤な損傷性／眼刺激性": "EYE_DAM_IRRIT",
  呼吸器感作性: "RESP_SENS",
  皮膚感作性: "SKIN_SENS",
  生殖細胞変異原性: "MUTA",
  発がん性: "CARC",
  生殖毒性: "REPR",
  "特定標的臓器毒性（単回暴露）": "STOT_SE",
  "特定標的臓器毒性（反復暴露）": "STOT_RE",
  誤えん有害性: "ASP_TOX",
  "水生環境有害性　短期（急性）": "AQUATIC_ACUTE",
  "水生環境有害性　長期（慢性）": "AQUATIC_CHRONIC",
  オゾン層への有害性: "OZONE",
};

const COL_CAS = "CAS";
const COL_NAME = "物質名称";
const COL_ID = "GHS分類結果_ID";

/** 全角の英数字・空白・括弧を半角に。NITE は `区分２` `区分1 （…）` のように揺れる */
function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(new RegExp(String.fromCharCode(0x3000), "g"), " ") // 全角スペース
    .replace(/，/g, "、")
    .replace(/（/g, "(")
    .replace(/）/g, ")");
}

/** `、` で切る。括弧の中（`感覚器（聴覚）` など入れ子あり）は切らない */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "、" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * CAS のセルを 1 つずつに分ける（`10326-41-7, 50-21-5, 598-82-3` のように並ぶことがある）。
 * CAS の形でないものは `invalid` に残す（行は捨てない。突き合わせに使わないだけ）
 */
export function splitCas(raw: string): {
  cas: { raw: string; normalized: string }[];
  invalid: string[];
} {
  const cas: { raw: string; normalized: string }[] = [];
  const invalid: string[] = [];
  for (const piece of toHalfWidth(raw).split(/[,、;/\s]+/)) {
    const p = piece.trim();
    if (!p || p === "-") continue;
    const n = normalizeCas(p);
    if (looksLikeCas(n)) cas.push({ raw: p, normalized: n });
    else invalid.push(p);
  }
  return { cas, invalid };
}

/** 高圧ガスの区分の呼び方（古いガイダンスの「高圧／低圧液化ガス」は液化ガスに寄せる） */
const PRESS_GAS_WORDS: Record<string, string> = {
  圧縮ガス: "COMPRESSED",
  液化ガス: "LIQUEFIED",
  高圧液化ガス: "LIQUEFIED",
  低圧液化ガス: "LIQUEFIED",
  深冷液化ガス: "REFRIG_LIQ",
  溶解ガス: "DISSOLVED",
};

/** STOT 単回 区分 3 の H は標的臓器の文で決まる */
function stotSe3HCodes(organs: string | undefined): string[] {
  const out: string[] = [];
  if (organs?.includes("気道")) out.push("H335");
  if (organs?.includes("麻酔")) out.push("H336");
  return out;
}

export interface CellParse {
  status: ClassStatus;
  items: { hazardClass: string; category: string; targetOrgans?: string; hCodes: string[] }[];
  /** 読めなかった部分（原文） */
  unknown?: string;
}

/**
 * 統合版の 1 セルを読む。
 *
 * - `-`（空）→ 未評価（鈍性化爆発物・オゾン層は古い分類に無い）
 * - `区分に該当しない（分類対象外）` → 分類対象外、`区分に該当しない` → 該当しない、`分類できない[…]` → 分類できない
 * - `区分1A`、`区分1（呼吸器）`、`等級1.1`、`不安定爆発物`、`タイプG`、`液化ガス`、
 *   `区分1、化学的に不安定なガス区分B`（→ 2 クラス）、`区分1B、授乳に対する…追加区分`（→ 2 区分）
 */
export function parseNiteCell(hazardClass: string, raw: string | null | undefined): CellParse {
  const v = toHalfWidth(String(raw ?? "")).trim();
  if (v === "" || v === "-" || v === "－") return { status: "NOT_EVALUATED", items: [] };
  if (v.startsWith("区分に該当しない(分類対象外)") || v.startsWith("分類対象外"))
    return { status: "NOT_APPLICABLE", items: [] };
  if (v.startsWith("区分に該当しない") || v.startsWith("区分外"))
    return { status: "NOT_CLASSIFIED", items: [] };
  if (v.startsWith("分類できない")) return { status: "CANNOT_CLASSIFY", items: [] };

  const items: CellParse["items"] = [];
  const unknown: string[] = [];
  for (const part of splitTopLevel(v)) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^区分\s*([0-9]+(?:\.[0-9]+)?[A-C]?)\s*(?:\((.*)\))?$/))) {
      const category = m[1]!;
      const organs = m[2]?.trim() || undefined;
      const hCodes =
        hazardClass === "STOT_SE" && category === "3"
          ? stotSe3HCodes(organs)
          : defaultHCodes(hazardClass, category);
      items.push({ hazardClass, category, targetOrgans: organs, hCodes });
    } else if ((m = part.match(/^等級\s*([0-9]\.[0-9])$/))) {
      items.push({ hazardClass, category: m[1]!, hCodes: defaultHCodes(hazardClass, m[1]!) });
    } else if (part === "不安定爆発物") {
      items.push({
        hazardClass,
        category: "UNSTABLE",
        hCodes: defaultHCodes(hazardClass, "UNSTABLE"),
      });
    } else if ((m = part.match(/^タイプ\s*([A-G])$/))) {
      items.push({ hazardClass, category: m[1]!, hCodes: defaultHCodes(hazardClass, m[1]!) });
    } else if (hazardClass === "PRESS_GAS" && PRESS_GAS_WORDS[part]) {
      const category = PRESS_GAS_WORDS[part]!;
      items.push({ hazardClass, category, hCodes: defaultHCodes(hazardClass, category) });
    } else if (
      (m = part.match(/^(?:化学的に不安定なガス\s*)?区分\s*([AB])$/)) ||
      (m = part.match(/^([AB])$/))
    ) {
      // 可燃性ガスの列に併記される「化学的に不安定なガス」
      items.push({
        hazardClass: "CHEM_UNST_GAS",
        category: m[1]!,
        hCodes: defaultHCodes("CHEM_UNST_GAS", m[1]!),
      });
    } else if (/授乳/.test(part)) {
      items.push({ hazardClass: "REPR", category: "LACT", hCodes: defaultHCodes("REPR", "LACT") });
    } else {
      unknown.push(part);
    }
  }
  if (items.length === 0) return { status: "NOT_EVALUATED", items: [], unknown: v };
  return { status: "CLASSIFIED", items, unknown: unknown.length ? unknown.join("、") : undefined };
}

/** 根拠一覧の「分類ガイダンス」から GHS 改訂版を取り出す（`GHS 6版` → `6`、`GHS 初版` → `1`） */
export function revisionOfGuidance(guidance: string | null | undefined): string | undefined {
  const g = toHalfWidth(String(guidance ?? ""));
  if (/初版/.test(g)) return "1";
  const m = g.match(/GHS\s*([0-9]+)\s*版/);
  return m ? m[1] : undefined;
}

type Rationale = Map<
  string,
  Map<string, { rationale: string; classifiedIn: string; revision?: string }>
>;

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && "text" in v) return String(v.text);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** 統合版（区分一覧）を読む */
export async function readNiteMain(bytes: Buffer, rationale?: Rationale): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { entries: [], issues: ["no worksheet"] };

  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    header[col] = cellText(cell.value).trim();
  });
  const colOf = (name: string) => header.findIndex((h) => h === name);
  const missing = [COL_CAS, COL_NAME, COL_ID, ...Object.keys(NITE_COLUMNS)].filter(
    (c) => colOf(c) < 0,
  );
  if (missing.length > 0)
    return { entries: [], issues: missing.map((c) => `missing column: ${c}`) };

  const classCols = Object.entries(NITE_COLUMNS).map(([name, code]) => ({
    col: colOf(name),
    code,
    name,
  }));
  const iCas = colOf(COL_CAS);
  const iName = colOf(COL_NAME);
  const iId = colOf(COL_ID);

  const entries: ParsedEntry[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const text = (i: number) => cellText(row.getCell(i).value);
    const id = text(iId).trim();
    const casCell = text(iCas).trim();
    if (!id && !casCell) return;
    // 形態違いは ID の末尾 a/b/c（m-nite-1234-56-7a）
    const sub = id.match(/^(m-nite-[0-9-]+)([a-z])$/);
    const sourceKey = sub ? sub[1]! : id || `m-nite-${casCell}`;
    const subKey = sub ? sub[2]! : "";
    const issues: string[] = [];
    const { cas, invalid } = splitCas(casCell);
    for (const bad of invalid) issues.push(`CAS の形でない: ${bad}`);
    const classifications: ParsedClassification[] = [];
    const rat = rationale?.get(id);
    for (const { col, code, name } of classCols) {
      const raw = text(col);
      const parsed = parseNiteCell(code, raw);
      if (parsed.unknown) issues.push(`${name}: ${parsed.unknown}`);
      const r = rat?.get(name);
      const extra = r
        ? { ghsRevision: r.revision, classifiedIn: r.classifiedIn, rationale: r.rationale }
        : {};
      if (parsed.status !== "CLASSIFIED") {
        classifications.push({
          hazardClass: code,
          category: "",
          status: parsed.status,
          hCodes: [],
          rawClassText: raw,
          ...extra,
        });
        continue;
      }
      for (const it of parsed.items) {
        // 同じクラス×区分が二度出たら（原典の重複）先のものを残す
        if (
          classifications.some(
            (c) => c.hazardClass === it.hazardClass && c.category === it.category,
          )
        )
          continue;
        classifications.push({
          hazardClass: it.hazardClass,
          category: it.category,
          status: "CLASSIFIED",
          targetOrgans: it.targetOrgans,
          hCodes: it.hCodes,
          rawClassText: raw,
          ...extra,
        });
      }
    }
    const rawRow = header
      .map((_, i) => (i === 0 ? null : text(i)))
      .filter((x) => x !== null)
      .join("\t");
    entries.push({
      sourceKey,
      subKey,
      cas,
      name: text(iName).trim(),
      classifications,
      rawRow,
      issues,
    });
  });
  return { entries, issues: [] };
}

/**
 * 根拠一覧（縦持ち・10 万行超）を流し読みして、物質 ID × 項目 → 根拠・年度・改訂版 にする。
 * 丸ごと読み込むと記憶域を食うので stream で
 */
export async function readNiteRationale(bytes: Buffer): Promise<Rationale> {
  const out: Rationale = new Map();
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {});
  let header: string[] | null = null;
  for await (const ws of reader) {
    for await (const row of ws) {
      const vals = (row.values as ExcelJS.CellValue[]).map(cellText);
      if (!header) {
        header = vals.map((v) => v.trim());
        continue;
      }
      const iId = header.indexOf("物質ID");
      const iItem = header.indexOf("危険有害性項目");
      const iRat = header.indexOf("分類根拠");
      const iYear = header.indexOf("分類年度");
      const iGuide = header.indexOf("分類ガイダンス");
      if (iId < 0 || iItem < 0) return out;
      const id = vals[iId]?.trim();
      const item = vals[iItem]?.trim();
      if (!id || !item) continue;
      let m = out.get(id);
      if (!m) out.set(id, (m = new Map()));
      m.set(item, {
        rationale: (vals[iRat] ?? "").trim(),
        classifiedIn: (vals[iYear] ?? "").trim(),
        revision: revisionOfGuidance(vals[iGuide]),
      });
    }
    break; // 最初のシートだけ
  }
  return out;
}

/** 項目の中身の指紋。変わったかどうかの比較に使う（根拠の文は含めない） */
export function contentHashOf(e: ParsedEntry): string {
  const cls = e.classifications
    .map((c) =>
      [
        c.hazardClass,
        c.category,
        c.status,
        c.targetOrgans ?? "",
        c.ghsRevision ?? "",
        c.classifiedIn ?? "",
      ].join("|"),
    )
    .sort();
  return createHash("sha256")
    .update(
      JSON.stringify([
        e.cas.map((c) => c.normalized),
        e.name,
        cls,
        e.effectiveFrom ?? "",
        e.effectiveTo ?? "",
        e.notesRaw ?? "",
        e.limitsRaw ?? "",
      ]),
    )
    .digest("hex");
}
