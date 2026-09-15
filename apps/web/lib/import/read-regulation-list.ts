import {
  DATA_SET_FORMAT,
  REGULATION_LIST_COLUMNS,
  looksLikeCas,
  mapHeader,
  normalizeCas,
  normalizeCode,
  parseTable,
  type LawSnap,
  type Snapshot,
} from "@chem/shared";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * 利用者の規制リスト（TSV。1 行 = 法文物質名 1 つ × CAS 1 つ）を Snapshot の形に読み替える。
 * そのあとは当方のデータセットと同じ突き合わせ（stage-snapshot.ts）に流す（決定 0011 §2）。
 *
 * 対応づけ（決定 0011 §3）
 *   - コードの列があればコードで。無ければ名前（法律・区分・分類）と「番号＋法文物質名」で本体を探し、
 *     無ければ新しく作る。作るときのコードは名前から決める（同じ名前なら次回も同じコード）
 *   - 分類の列が空なら「（分類なし）」を 1 つ置く（本体は区分の下に分類を必ず持つ）
 *   - 結び付きはデータソース USER、現在の法規制バージョン
 * 表記ゆれ（前後の空白・全角半角）は正規化して同一視し、「似ているが別扱いになる行」は notes に出す
 */

export const USER_SOURCE_CODE = "USER";
export const DEFAULT_CLASS_CODE = "DEFAULT";

export interface ReadResult {
  snapshot: Snapshot;
  /** 読めなかった行（元ファイルの行番号と理由） */
  errors: { line: number; message: string }[];
  notes: string[];
  rows: number;
}

/** 名前からコードを作る（英数字はそのまま、それ以外はハッシュ）。同じ名前なら同じコード */
export function codeFromName(prefix: string, name: string): string {
  const n = normalizeCode(name);
  const ascii = n.replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const hash = createHash("sha1").update(n).digest("hex").slice(0, 6).toUpperCase();
  return ascii ? `${prefix}-${ascii}-${hash}` : `${prefix}-${hash}`;
}

/** 表記ゆれの吸収（前後の空白・全角英数字・連続する空白） */
function key(s: string): string {
  return normalizeCode(s).replace(/\s+/g, " ");
}

interface Ctx {
  lawByName: Map<string, { code: string; countryCode: string }>;
  lawByCode: Map<string, { code: string; countryCode: string }>;
  catByLawName: Map<string, string>; // `${lawCode}|${name}` → code
  catByLawCode: Map<string, string>; // `${lawCode}|${code}` → code
  classByCatName: Map<string, string>; // `${lawCode}/${catCode}|${name}` → code
  subByClassKey: Map<string, string>; // `${lawCode}/${catCode}/${classCode}|${number}|${name}` → code
  defaultCountry: string;
}

async function loadContext(): Promise<Ctx> {
  const laws = await prisma.law.findMany({
    where: { deletedAt: null },
    select: {
      code: true,
      codeNormalized: true,
      nameOriginal: true,
      nameJa: true,
      nameEn: true,
      country: { select: { code: true } },
      categories: {
        where: { deletedAt: null },
        select: {
          code: true,
          codeNormalized: true,
          nameOriginal: true,
          nameJa: true,
          nameEn: true,
          classes: {
            where: { deletedAt: null },
            select: {
              code: true,
              codeNormalized: true,
              nameOriginal: true,
              nameJa: true,
              nameEn: true,
              statutorySubstances: {
                where: { deletedAt: null },
                select: {
                  code: true,
                  codeNormalized: true,
                  officialNumber: true,
                  nameOriginal: true,
                  nameJa: true,
                  nameEn: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const ctx: Ctx = {
    lawByName: new Map(),
    lawByCode: new Map(),
    catByLawName: new Map(),
    catByLawCode: new Map(),
    classByCatName: new Map(),
    subByClassKey: new Map(),
    defaultCountry: "JP",
  };
  const names = (v: {
    nameOriginal?: string | null;
    nameJa?: string | null;
    nameEn?: string | null;
  }) => [v.nameOriginal, v.nameJa, v.nameEn].filter((x): x is string => !!x);
  for (const l of laws) {
    const info = { code: l.code, countryCode: l.country.code };
    ctx.lawByCode.set(l.codeNormalized, info);
    for (const n of names(l)) if (!ctx.lawByName.has(key(n))) ctx.lawByName.set(key(n), info);
    for (const c of l.categories) {
      ctx.catByLawCode.set(`${l.code}|${c.codeNormalized}`, c.code);
      for (const n of names(c)) {
        const k = `${l.code}|${key(n)}`;
        if (!ctx.catByLawName.has(k)) ctx.catByLawName.set(k, c.code);
      }
      for (const k of c.classes) {
        const catPath = `${l.code}/${c.code}`;
        for (const n of names(k)) {
          const kk = `${catPath}|${key(n)}`;
          if (!ctx.classByCatName.has(kk)) ctx.classByCatName.set(kk, k.code);
        }
        if (k.codeNormalized === DEFAULT_CLASS_CODE) ctx.classByCatName.set(`${catPath}|`, k.code);
        for (const s of k.statutorySubstances) {
          const clsPath = `${catPath}/${k.code}`;
          for (const n of names(s)) {
            const sk = `${clsPath}|${key(s.officialNumber ?? "")}|${key(n)}`;
            if (!ctx.subByClassKey.has(sk)) ctx.subByClassKey.set(sk, s.code);
          }
        }
      }
    }
  }
  const jp = await prisma.country.findFirst({
    where: { codeNormalized: "JP" },
    select: { code: true },
  });
  if (!jp) {
    const any = await prisma.country.findFirst({
      orderBy: { displayOrder: "asc" },
      select: { code: true },
    });
    ctx.defaultCountry = any?.code ?? "JP";
  }
  return ctx;
}

const BOUNDS = new Set(["EXCLUSIVE", "INCLUSIVE"]);
function bound(raw: string, fallback: "EXCLUSIVE" | "INCLUSIVE"): string {
  const v = raw.trim().toUpperCase();
  if (BOUNDS.has(v)) return v;
  if (v === "<" || v === ">" || v === "未満" || v === "超") return "EXCLUSIVE";
  if (v === "<=" || v === ">=" || v === "≤" || v === "≥" || v === "以下" || v === "以上")
    return "INCLUSIVE";
  return fallback;
}

function pct(raw: string, fallback: string): string {
  const s = raw.replace(/[%％\s]/g, "");
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : fallback;
}

/** 法文物質名の閾値。空欄・読めない値は null（区分の既定値に従う） */
function pctOrNull(raw: string): string | null {
  const s = raw.replace(/[%％\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}
function boundOrNull(raw: string): string | null {
  if (raw.trim() === "") return null;
  const v = bound(raw, "EXCLUSIVE");
  // bound() は読めないと fallback を返すので、読めたかどうかを別に見る
  return bound(raw, "INCLUSIVE") === v ? v : null;
}

export async function readRegulationList(text: string): Promise<ReadResult> {
  const table = parseTable(text);
  const map = mapHeader(table.header, REGULATION_LIST_COLUMNS);
  const errors: ReadResult["errors"] = [];
  const notes: string[] = [];
  if (map.missing.length > 0) {
    return {
      snapshot: emptySnapshot(),
      errors: [{ line: 1, message: `必須の列がありません: ${map.missing.join("、")}` }],
      notes,
      rows: table.rows.length,
    };
  }
  if (map.unknown.length > 0) notes.push(`使わない列: ${map.unknown.join("、")}`);
  const col = (row: string[], k: string) => {
    const i = map.index[k];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const ctx = await loadContext();
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { code: true, asOf: true },
  });
  if (!version) {
    return {
      snapshot: emptySnapshot(),
      errors: [
        {
          line: 0,
          message:
            "現在の法規制バージョンがありません。先に外部データベースでバージョンを作ってください",
        },
      ],
      notes,
      rows: table.rows.length,
    };
  }

  // 木を組む（法律 → 区分 → 分類 → 法文物質名 → 結び付き）
  const laws = new Map<string, LawSnap>();
  const seenNames = new Map<string, string>(); // 正規化した名前 → 最初に出た表記（表記ゆれの検出）
  const noteVariant = (kind: string, raw: string) => {
    const k = `${kind}|${key(raw)}`;
    const first = seenNames.get(k);
    if (first === undefined) seenNames.set(k, raw);
    else if (first !== raw) notes.push(`${kind}「${first}」と「${raw}」は同じものとして扱いました`);
  };

  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const lawName = col(row, "law");
    const catName = col(row, "category");
    const subName = col(row, "substance");
    const casRaw = col(row, "cas");
    if (!lawName || !catName || !subName || !casRaw) {
      errors.push({ line, message: "法律・規制区分・法文物質名・CAS のどれかが空です" });
      return;
    }
    const cas = normalizeCas(casRaw);
    if (!looksLikeCas(cas)) {
      errors.push({ line, message: `CAS の形が違います: ${casRaw}` });
      return;
    }
    noteVariant("法律", lawName);
    noteVariant("規制区分", catName);
    noteVariant("法文物質名", subName);

    // 法律
    const lawCodeCol = col(row, "lawCode");
    let lawInfo = lawCodeCol
      ? ctx.lawByCode.get(normalizeCode(lawCodeCol))
      : ctx.lawByName.get(key(lawName));
    if (!lawInfo) {
      lawInfo = {
        code: lawCodeCol || codeFromName("U", lawName),
        countryCode: col(row, "country") || ctx.defaultCountry,
      };
      ctx.lawByName.set(key(lawName), lawInfo);
      ctx.lawByCode.set(normalizeCode(lawInfo.code), lawInfo);
    }
    let law = laws.get(lawInfo.code);
    if (!law) {
      law = {
        code: lawInfo.code,
        countryCode: lawInfo.countryCode,
        nameOriginal: lawName,
        nameLang: "JA",
        nameJa: lawName,
        nameEn: null,
        displayOrder: 900,
        note: null,
        categories: [],
      };
      laws.set(law.code, law);
    }

    // 区分
    const catCodeCol = col(row, "categoryCode");
    let catCode = catCodeCol
      ? ctx.catByLawCode.get(`${law.code}|${normalizeCode(catCodeCol)}`)
      : ctx.catByLawName.get(`${law.code}|${key(catName)}`);
    if (!catCode) {
      catCode = catCodeCol || codeFromName("C", catName);
      ctx.catByLawName.set(`${law.code}|${key(catName)}`, catCode);
      ctx.catByLawCode.set(`${law.code}|${normalizeCode(catCode)}`, catCode);
    }
    let cat = law.categories.find((c) => c.code === catCode);
    if (!cat) {
      cat = {
        code: catCode,
        nameOriginal: catName,
        nameLang: "JA",
        nameJa: catName,
        nameEn: null,
        displayOrder: law.categories.length + 1,
        thresholdLower: pct(col(row, "thresholdLower"), "0"),
        lowerBound: bound(col(row, "lowerBound"), "EXCLUSIVE"),
        thresholdUpper: pct(col(row, "thresholdUpper"), "100"),
        upperBound: bound(col(row, "upperBound"), "INCLUSIVE"),
        aggregation: "NONE",
        metalEtc: null,
        thresholdBasis: "PRODUCT",
        judged: true,
        effectiveFrom: null,
        effectiveTo: null,
        interactionGroup: null,
        rank: null,
        score: "0",
        note: null,
        classes: [],
      };
      law.categories.push(cat);
    }

    // 分類（空なら DEFAULT）
    const className = col(row, "class");
    const classCodeCol = col(row, "classCode");
    const catPath = `${law.code}/${cat.code}`;
    let classCode = classCodeCol
      ? classCodeCol
      : className
        ? ctx.classByCatName.get(`${catPath}|${key(className)}`)
        : (ctx.classByCatName.get(`${catPath}|`) ?? DEFAULT_CLASS_CODE);
    if (!classCode) {
      classCode = codeFromName("K", className);
      ctx.classByCatName.set(`${catPath}|${key(className)}`, classCode);
    }
    let cls = cat.classes.find((c) => c.code === classCode);
    if (!cls) {
      cls = {
        code: classCode,
        nameOriginal: className || null,
        nameLang: className ? "JA" : null,
        nameJa: className || null,
        nameEn: null,
        displayOrder: cat.classes.length + 1,
        interactionGroup: null,
        rank: null,
        note: null,
        substances: [],
      };
      cat.classes.push(cls);
    }

    // 法文物質名（番号＋名前で同定。番号だけでは同定しない）
    const number = col(row, "number");
    const subCodeCol = col(row, "substanceCode");
    const clsPath = `${catPath}/${cls.code}`;
    let subCode = subCodeCol || ctx.subByClassKey.get(`${clsPath}|${key(number)}|${key(subName)}`);
    if (!subCode) {
      subCode = codeFromName("S", `${number}|${subName}`);
      ctx.subByClassKey.set(`${clsPath}|${key(number)}|${key(subName)}`, subCode);
    }
    let sub = cls.substances.find((s) => s.code === subCode);
    if (!sub) {
      sub = {
        code: subCode,
        officialNumber: number || null,
        nameOriginal: subName,
        nameLang: "JA",
        nameJa: subName,
        nameEn: null,
        displayOrder: cls.substances.length + 1,
        // 空の欄は空のまま（区分の既定値に従う）。区分の値を写さない
        thresholdLower: pctOrNull(col(row, "thresholdLower")),
        lowerBound: boundOrNull(col(row, "lowerBound")),
        thresholdUpper: pctOrNull(col(row, "thresholdUpper")),
        upperBound: boundOrNull(col(row, "upperBound")),
        aggregation: "NONE",
        metalEtc: null,
        effectiveFrom: null,
        effectiveTo: null,
        applicableCondition: col(row, "condition") || null,
        note: col(row, "note") || null,
        links: [],
      };
      cls.substances.push(sub);
    } else {
      // 同じ法文物質名の行で閾値が食い違えば止める（どちらが正しいか分からない）
      const lo = pctOrNull(col(row, "thresholdLower"));
      const hi = pctOrNull(col(row, "thresholdUpper"));
      if (lo !== sub.thresholdLower || hi !== sub.thresholdUpper) {
        const show = (v: string | null) => v ?? "（空）";
        errors.push({
          line,
          message: `「${subName}」の閾値が前の行と食い違います（${show(sub.thresholdLower)}〜${show(sub.thresholdUpper)} と ${show(lo)}〜${show(hi)}）`,
        });
        return;
      }
    }
    if (sub.links.some((l) => normalizeCas(l.cas) === cas)) {
      notes.push(`${line} 行目: 「${subName}」の CAS ${cas} は重複しているので 1 つにしました`);
      return;
    }
    const excludedRaw = col(row, "excluded").toLowerCase();
    sub.links.push({
      version: version.code,
      source: USER_SOURCE_CODE,
      cas,
      casNumber: casRaw,
      excluded:
        excludedRaw === "1" ||
        excludedRaw === "true" ||
        excludedRaw === "○" ||
        excludedRaw === "はい",
      note: null,
      text: null,
      textJa: null,
    });
  });

  const snapshot: Snapshot = {
    format: DATA_SET_FORMAT,
    takenAt: new Date().toISOString(),
    label: "利用者の規制リスト",
    versions: [
      { code: version.code, asOf: version.asOf.toISOString().slice(0, 10), isCurrent: true },
    ],
    sources: [{ code: USER_SOURCE_CODE }],
    laws: [...laws.values()],
  };
  return { snapshot, errors, notes, rows: table.rows.length };
}

function emptySnapshot(): Snapshot {
  return {
    format: DATA_SET_FORMAT,
    takenAt: new Date().toISOString(),
    label: "",
    versions: [],
    sources: [],
    laws: [],
  };
}
