import { looksLikeCas, normalizeCas } from "@chem/shared";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { defaultHCodes } from "./catalog-data";
import type { ParseResult, ParsedClassification, ParsedEntry } from "./nite";

/**
 * EU CLP 規則 附属書VI（調和分類）の読み手（S23 段 0）。
 *
 * 読むのは ECHA が配っている Excel（`annex_vi_clp_table_atpNN_en.xlsx`）の **History シート**。
 * Index 番号ごとに、CLP 原文からの全ての版（ATP・CELEX・適用日 `In application`）が並ぶ。
 *
 * 出すのは「いま効いている版」と「これから効く版」（将来の ATP）だけ（過去の版は入れない。S23 §5-2）。
 * 行ごとに適用開始日を持ち、将来の版があれば、いまの版に適用終了日（将来の版の前日）を付ける。
 * 「Index # deleted」の版は削除で、前の版を閉じる。
 *
 * 分類は「Hazard Class and Category Code(s)」の 1 行 1 項目。H コードは並びの列から、クラスごとの候補で拾う
 * （行の対応がずれることがあるので、位置ではなく候補で合わせる）。急性毒性の経路は H コードで決める
 */

/** 見出しの文字（ECHA の Excel のまま） */
const COLS = {
  index: "Index No",
  atp: "ATP",
  celex: "CELEX",
  name: "Chemical Name",
  ec: "EC No",
  cas: "CAS No",
  cls: "Hazard Class and Category Code(s)",
  hcls: "Classification Hazard Statement Code(s)",
  pict: "Labelling Pictogram, Signal Word Code(s)",
  hlab: "Labelling Hazard Statement Code(s)",
  euh: "Labelling Suppl. Hazard Statement Code(s)",
  limits: "M, SCL, ATE",
  notes: "Notes",
  comment: "Comment",
  date: "In application",
} as const;

/** EU の略号 → クラスコード。区分の付け方が特殊なものは `fixedCategory` */
const EU_CLASSES: { abbrev: string; code: string; fixedCategory?: string }[] = [
  { abbrev: "Unst. Expl.", code: "EXPL", fixedCategory: "UNSTABLE" },
  { abbrev: "Expl.", code: "EXPL" },
  { abbrev: "Chem. Unst. Gas", code: "CHEM_UNST_GAS" },
  { abbrev: "Flam. Gas", code: "FLAM_GAS" },
  { abbrev: "Pyr. Gas", code: "PYR_GAS", fixedCategory: "1" },
  { abbrev: "Flam. Aerosol", code: "AEROSOL" },
  { abbrev: "Aerosol", code: "AEROSOL" },
  { abbrev: "Ox. Gas", code: "OX_GAS" },
  { abbrev: "Press. Gas", code: "PRESS_GAS", fixedCategory: "UNSPEC" },
  { abbrev: "Flam. Liq.", code: "FLAM_LIQ" },
  { abbrev: "Flam. Sol.", code: "FLAM_SOL" },
  { abbrev: "Self-react.", code: "SELF_REACT" },
  { abbrev: "Pyr. Liq.", code: "PYR_LIQ" },
  { abbrev: "Pyr. Sol.", code: "PYR_SOL" },
  { abbrev: "Self-heat.", code: "SELF_HEAT" },
  { abbrev: "Water-react.", code: "WATER_REACT" },
  { abbrev: "Ox. Liq.", code: "OX_LIQ" },
  { abbrev: "Ox. Sol.", code: "OX_SOL" },
  { abbrev: "Org. Perox.", code: "ORG_PEROX" },
  { abbrev: "Met. Corr.", code: "MET_CORR" },
  { abbrev: "Desens. Expl.", code: "DESENS_EXPL" },
  { abbrev: "Acute Tox.", code: "ACUTE_TOX" }, // 経路は H コードで決める
  { abbrev: "Skin Corr.", code: "SKIN_CORR_IRRIT" },
  { abbrev: "Skin Irrit.", code: "SKIN_CORR_IRRIT" },
  { abbrev: "Eye Dam.", code: "EYE_DAM_IRRIT" },
  { abbrev: "Eye Irrit.", code: "EYE_DAM_IRRIT" },
  { abbrev: "Resp. Sens.", code: "RESP_SENS" },
  { abbrev: "Skin Sens.", code: "SKIN_SENS" },
  { abbrev: "Muta.", code: "MUTA" },
  { abbrev: "Carc.", code: "CARC" },
  { abbrev: "Repr.", code: "REPR" },
  { abbrev: "Lact.", code: "REPR", fixedCategory: "LACT" },
  { abbrev: "STOT SE", code: "STOT_SE" },
  { abbrev: "STOT RE", code: "STOT_RE" },
  { abbrev: "Asp. Tox.", code: "ASP_TOX" },
  { abbrev: "Aquatic Acute", code: "AQUATIC_ACUTE" },
  { abbrev: "Aquatic Chronic", code: "AQUATIC_CHRONIC" },
  { abbrev: "Ozone", code: "OZONE", fixedCategory: "1" },
];

/** 官報・Excel で見つかった表記揺れ（docs/GHS分類の原典/検証結果_DB項目.md §8） */
function normalizeToken(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/Β/g, "B") // ギリシャ文字のベータ
    .replace(/\bSkin\. Corr\./, "Skin Corr.")
    .replace(/\bSkin\. Sens\./, "Skin Sens.")
    .replace(/\bMuta (?=\d)/, "Muta. ")
    .replace(/\bFlam\. Gas\. /, "Flam. Gas ")
    .replace(/\bSelf-heat (?=\d)/, "Self-heat. ")
    .replace(/\bUnst\. Expl$/, "Unst. Expl.")
    .replace(/\bAquatic (Acute|Chronic)(?=\d)/, "Aquatic $1 ")
    .replace(/(\d)([a-c])$/, (_m, d: string, l: string) => d + l.toUpperCase())
    .trim();
}

export interface EuClassToken {
  hazardClass: string;
  category: string;
  /** 最小分類の印（`*` `**` `***`） */
  marks: string;
  raw: string;
}

/** 「Acute Tox. 4 *」→ クラス・区分・印 */
export function parseEuClassToken(raw: string): EuClassToken | null {
  const marks = (raw.match(/\*+/) ?? [""])[0];
  const t = normalizeToken(raw.replace(/\*+/g, ""));
  if (!t) return null;
  // 長い略号から順に当てる（"Unst. Expl." を "Expl." より先に）
  for (const def of [...EU_CLASSES].sort((a, b) => b.abbrev.length - a.abbrev.length)) {
    if (t === def.abbrev || t.startsWith(def.abbrev + " ")) {
      const rest = t.slice(def.abbrev.length).trim();
      const category = def.fixedCategory ?? (rest || "UNSPEC");
      if (!def.fixedCategory && rest && !/^[0-9A-G.]{1,4}$/.test(rest)) return null;
      return { hazardClass: def.code, category, marks, raw };
    }
  }
  return null;
}

/** 急性毒性の H コード → 経路つきのクラスと区分 */
const ACUTE_BY_H: Record<string, { code: string; category: string }> = {
  H300: { code: "ACUTE_TOX_ORAL", category: "1/2" },
  H301: { code: "ACUTE_TOX_ORAL", category: "3" },
  H302: { code: "ACUTE_TOX_ORAL", category: "4" },
  H303: { code: "ACUTE_TOX_ORAL", category: "5" },
  H310: { code: "ACUTE_TOX_DERMAL", category: "1/2" },
  H311: { code: "ACUTE_TOX_DERMAL", category: "3" },
  H312: { code: "ACUTE_TOX_DERMAL", category: "4" },
  H313: { code: "ACUTE_TOX_DERMAL", category: "5" },
  H330: { code: "ACUTE_TOX_INHAL", category: "1/2" },
  H331: { code: "ACUTE_TOX_INHAL", category: "3" },
  H332: { code: "ACUTE_TOX_INHAL", category: "4" },
  H333: { code: "ACUTE_TOX_INHAL", category: "5" },
};

/** クラス×区分に付き得る H コード（既定＋派生形） */
function candidateHCodes(hazardClass: string, category: string): string[] {
  const base = defaultHCodes(hazardClass, category);
  const extra: Record<string, string[]> = {
    CARC: ["H350", "H350i", "H351"],
    REPR:
      category === "LACT"
        ? ["H362"]
        : [
            "H360",
            "H360D",
            "H360F",
            "H360FD",
            "H360Fd",
            "H360Df",
            "H361",
            "H361d",
            "H361f",
            "H361fd",
          ],
    STOT_SE: category === "3" ? ["H335", "H336"] : base,
  };
  return [...new Set([...(extra[hazardClass] ?? []), ...base])];
}

export interface EuRowParse {
  classifications: ParsedClassification[];
  issues: string[];
}

/**
 * 1 項目の「クラス・区分」列と「H コード」列を分類の並びにする。
 * H は候補で拾い、拾えなければカタログの既定（出どころは CATALOG）
 */
export function parseEuClassifications(clsText: string, hText: string): EuRowParse {
  const issues: string[] = [];
  const pool = hText
    .split(/\s+/)
    .map((h) => h.trim())
    .filter((h) => /^(EU)?H\d{3}/.test(h));
  const take = (cands: string[]): { code: string; marks: string } | null => {
    for (let i = 0; i < pool.length; i++) {
      const h = pool[i]!;
      const bare = h.replace(/\*+$/, "");
      if (cands.includes(bare)) {
        pool.splice(i, 1);
        return { code: bare, marks: (h.match(/\*+$/) ?? [""])[0] };
      }
    }
    return null;
  };
  const out: ParsedClassification[] = [];
  for (const line of clsText.split("\n")) {
    const raw = line.trim();
    if (!raw || /^\*+$/.test(raw)) continue; // 印だけの行（脚注の名残）は読み飛ばす
    const tok = parseEuClassToken(raw);
    if (!tok) {
      issues.push(`クラスの表記が読めない: ${raw}`);
      continue;
    }
    let hazardClass = tok.hazardClass;
    const category = tok.category;
    let hCodes: string[] = [];
    let origin: "SOURCE" | "CATALOG" = "CATALOG";
    let marks = tok.marks;
    if (hazardClass === "ACUTE_TOX") {
      // 経路は H コードで決める。区分 1・2 は同じ H なので、区分は略号の側の数字を使う
      const cands = Object.entries(ACUTE_BY_H)
        .filter(([, v]) => v.category === category || v.category.split("/").includes(category))
        .map(([h]) => h);
      const got = take(cands);
      if (!got) {
        issues.push(`急性毒性の経路が決まらない（H が無い）: ${raw}`);
        hazardClass = "ACUTE_TOX_ORAL";
      } else {
        hazardClass = ACUTE_BY_H[got.code]!.code;
        hCodes = [got.code];
        origin = "SOURCE";
        marks = marks || got.marks;
      }
    } else {
      const got = take(candidateHCodes(hazardClass, category));
      if (got) {
        hCodes = [got.code];
        origin = "SOURCE";
        marks = marks || got.marks;
      } else {
        hCodes = defaultHCodes(hazardClass, category);
      }
    }
    if (out.some((c) => c.hazardClass === hazardClass && c.category === category)) continue;
    out.push({
      hazardClass,
      category,
      status: "CLASSIFIED",
      hCodes,
      rawClassText: raw,
      minimumClassification: marks || undefined,
      hCodesOrigin: origin,
    });
  }
  return { classifications: out, issues };
}

/**
 * ExcelJS は「History」という名前のシートを開けない（Excel の予約名として拒む）。
 * ECHA の Excel はまさにその名前なので、xlsx（zip）の中の workbook.xml で名前を変えてから渡す
 */
async function renameReservedSheets(bytes: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.file("xl/workbook.xml");
  if (!f) return bytes;
  const xml = await f.async("string");
  if (!/name="History"/.test(xml)) return bytes;
  zip.file("xl/workbook.xml", xml.replace(/name="History"/g, 'name="History_"'));
  return zip.generateAsync({ type: "nodebuffer" });
}

interface Version {
  atp: string;
  celex: string;
  name: string;
  ec: string;
  cas: string;
  cls: string;
  hcls: string;
  pict: string;
  hlab: string;
  euh: string;
  limits: string;
  notes: string;
  comment: string;
  date: string;
  deleted: boolean;
  rawRow: string;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("");
  if (typeof v === "object" && "text" in v) return String(v.text);
  if (typeof v === "object" && "result" in v) return String(v.result ?? "");
  return String(v);
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** CAS の列（`10043-35-3 [1]` を改行で並べる）を 1 つずつに */
export function splitEuCas(raw: string): {
  cas: { raw: string; normalized: string }[];
  invalid: string[];
} {
  const cas: { raw: string; normalized: string }[] = [];
  const invalid: string[] = [];
  for (const line of raw.split(/\n|;/)) {
    const p = line.replace(/\[\d+\]/g, "").trim();
    if (!p || p === "-" || p === "—" || p === "–") continue;
    const n = normalizeCas(p);
    if (looksLikeCas(n)) cas.push({ raw: p, normalized: n });
    else invalid.push(p);
  }
  return { cas, invalid };
}

/**
 * History シートを読み、Index ごとに「いま効いている版」と「これから効く版」を項目にする。
 * `today` は YYYY-MM-DD（判定に使う日。テストで固定できるように引数）
 */
export async function readEuAnnexVi(bytes: Buffer, today: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await renameReservedSheets(bytes)) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("History") ?? wb.worksheets.find((w) => /history/i.test(w.name));
  if (!ws) return { entries: [], issues: ["missing sheet: History"] };

  // 見出しの行を探す（先頭にお断りの行があることがある）
  let headerRow = 0;
  const header: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (headerRow) return;
    const first = cellText(row.getCell(1).value).trim();
    if (first === COLS.index) {
      headerRow = n;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        header[col] = cellText(cell.value).trim();
      });
    }
  });
  if (!headerRow) return { entries: [], issues: [`missing column: ${COLS.index}`] };
  const colOf = (name: string) => header.findIndex((h) => h === name);
  const missing = Object.values(COLS).filter((c) => colOf(c) < 0);
  if (missing.length > 0)
    return { entries: [], issues: missing.map((c) => `missing column: ${c}`) };

  const byIndex = new Map<string, Version[]>();
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= headerRow) return;
    const t = (name: string) => cellText(row.getCell(colOf(name)).value).trim();
    const index = t(COLS.index);
    if (!index) return;
    const comment = t(COLS.comment);
    const v: Version = {
      atp: t(COLS.atp),
      celex: t(COLS.celex),
      name: t(COLS.name),
      ec: t(COLS.ec),
      cas: t(COLS.cas),
      cls: t(COLS.cls),
      hcls: t(COLS.hcls),
      pict: t(COLS.pict),
      hlab: t(COLS.hlab),
      euh: t(COLS.euh),
      limits: t(COLS.limits),
      notes: t(COLS.notes),
      comment,
      date: t(COLS.date).slice(0, 10),
      deleted: /deleted/i.test(comment) && !t(COLS.cls),
      rawRow: header
        .map((_, i) => (i === 0 ? null : cellText(row.getCell(i).value)))
        .filter((x) => x !== null)
        .join("\t"),
    };
    let list = byIndex.get(index);
    if (!list) byIndex.set(index, (list = []));
    list.push(v);
  });

  const entries: ParsedEntry[] = [];
  for (const [index, versions] of byIndex) {
    versions.sort((a, b) => a.date.localeCompare(b.date));
    const past = versions.filter((v) => v.date <= today);
    const future = versions.filter((v) => v.date > today);
    const current = past[past.length - 1];
    const timeline = [...(current ? [current] : []), ...future];
    timeline.forEach((v, i) => {
      if (v.deleted) return; // 削除の版は項目にしない（前の版を閉じるだけ）
      const next = timeline[i + 1];
      const { cas, invalid } = splitEuCas(v.cas);
      const parsed = parseEuClassifications(v.cls, v.hcls);
      const issues = [...invalid.map((x) => `CAS の形でない: ${x}`), ...parsed.issues];
      const ec =
        v.ec
          .split("\n")[0]
          ?.replace(/\[\d+\]/g, "")
          .trim() || undefined;
      const labelling = [v.pict, v.hlab, v.euh].filter(Boolean).join(" | ").replace(/\n/g, " ");
      entries.push({
        sourceKey: index,
        subKey: "",
        cas,
        name: v.name.replace(/\s*\n\s*/g, " "),
        classifications: parsed.classifications,
        rawRow: v.rawRow,
        issues,
        effectiveFrom: v.date,
        effectiveTo: next ? dayBefore(next.date) : undefined,
        ecNumber: ec,
        conditionText: /%/.test(v.name)
          ? v.name.replace(/\s*\n\s*/g, " ").slice(0, 200)
          : undefined,
        notesRaw: v.notes.replace(/\n/g, ",") || undefined,
        amendingAct: [v.atp, v.celex].filter(Boolean).join(" ") || undefined,
        labellingRaw: labelling || undefined,
        limitsRaw: v.limits.replace(/\n/g, " ") || undefined,
      });
      // 版の名前は分類の行にも持たせる（NITE の分類年度に当たるもの）
      for (const c of entries[entries.length - 1]!.classifications) c.classifiedIn = v.atp;
    });
  }
  return { entries, issues: [] };
}
