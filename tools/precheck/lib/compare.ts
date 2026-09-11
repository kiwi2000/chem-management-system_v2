/**
 * 顧客の写し（customer）を当方の正規データ（base）と突き合わせ、顧客が何を変えたかを一覧にする。
 * 次に渡す配布パッケージ（next）があれば、その変更が配布物とぶつかるかも見る。
 *
 * 影響の分けかた（取り込みの下見でも同じ分けかたを使う）
 *   display   … 表示だけ。名称・備考・並び順・番号・結び付きの出典文。判定は変わらない
 *   judgement … 判定が変わる。閾値・合算・金属換算・適用条件・適用開始日／終了日・判定に使うか・
 *               兼ね合い・スコア・結び付きの追加／非該当
 *   key       … 突き合わせの鍵が変わる。行の削除、別の分類への付け替え、コードの付け替えの疑い
 *
 * 扱いの案
 *   keep       … 顧客のものを残す（そのまま取り込んでよい）
 *   keep-check … 顧客のものを残すが、判定に効くので人が一度見る
 *   discuss    … 配布物とぶつかる、または鍵が変わる。顧客と相談して決める
 */
import type {
  CategorySnap,
  ClassSnap,
  LawSnap,
  LinkSnap,
  Snapshot,
  SubstanceSnap,
} from "./snapshot";

export type Kind = "law" | "category" | "class" | "substance" | "link";
export type Change = "added" | "removed" | "changed" | "moved";
export type Impact = "display" | "judgement" | "key";
export type Conflict = "absent" | "agree" | "conflict" | "n/a";
export type Proposal = "keep" | "keep-check" | "discuss";

export interface Finding {
  kind: Kind;
  law: string;
  category: string;
  class: string;
  substance: string;
  cas: string;
  /** 人が読むための名前（日本語名があればそれ、無ければ原文） */
  name: string;
  change: Change;
  /** 変えた項目。行ごとの追加・削除・付け替えのときは空 */
  field: string;
  customer: string;
  base: string;
  next: string;
  impact: Impact;
  conflict: Conflict;
  proposal: Proposal;
  remark: string;
}

export interface Summary {
  counts: Record<Impact, Record<Proposal, number>>;
  total: number;
  hasNext: boolean;
}

export interface Report {
  customerLabel: string;
  baseLabel: string;
  nextLabel: string | null;
  summary: Summary;
  findings: Finding[];
}

/** 表示だけの項目 */
const DISPLAY_FIELDS = new Set([
  "nameOriginal",
  "nameLang",
  "nameJa",
  "nameEn",
  "displayOrder",
  "note",
  "officialNumber",
  "countryCode",
  "casNumber",
  "text",
  "textJa",
]);

/** 判定が変わる項目 */
const JUDGEMENT_FIELDS = new Set([
  "thresholdLower",
  "lowerBound",
  "thresholdUpper",
  "upperBound",
  "aggregation",
  "metalEtc",
  "thresholdBasis",
  "judged",
  "effectiveFrom",
  "effectiveTo",
  "applicableCondition",
  "interactionGroup",
  "rank",
  "score",
  "excluded",
]);

/** 項目の日本語名（報告に出す） */
export const FIELD_LABELS: Record<string, string> = {
  nameOriginal: "原文の名称",
  nameLang: "原文の言語",
  nameJa: "名称（日本語）",
  nameEn: "名称（英語）",
  displayOrder: "並び順",
  note: "備考",
  officialNumber: "法律上の番号",
  countryCode: "国",
  casNumber: "CAS の書きかた",
  text: "出典データ",
  textJa: "出典データ（日本語）",
  thresholdLower: "下限値",
  lowerBound: "下限の不等号",
  thresholdUpper: "上限値",
  upperBound: "上限の不等号",
  aggregation: "合算",
  metalEtc: "金属換算",
  thresholdBasis: "閾値の対象",
  judged: "判定に使う",
  effectiveFrom: "適用開始日",
  effectiveTo: "適用終了日",
  applicableCondition: "適用条件",
  interactionGroup: "兼ね合いグループ",
  rank: "rank",
  score: "スコア",
  excluded: "非該当",
};

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function impactOfField(field: string): Impact {
  if (JUDGEMENT_FIELDS.has(field)) return "judgement";
  if (DISPLAY_FIELDS.has(field)) return "display";
  // 知らない項目は安全側（判定に効くものとして扱う）。項目を足したときはここの表も直す
  return "judgement";
}

function proposalFor(impact: Impact, change: Change, conflict: Conflict, kind: Kind): Proposal {
  if (change === "moved") return "discuss";
  if (change === "removed") return conflict === "conflict" ? "discuss" : "keep";
  if (change === "added") {
    if (conflict === "conflict") return "discuss";
    // 顧客が足した結び付きは残す。行そのものを足したときは、判定に効くので一度見る
    return kind === "link" ? "keep" : "keep-check";
  }
  if (impact === "display") return "keep";
  return conflict === "conflict" ? "discuss" : "keep-check";
}

const byCode = <T extends { code: string }>(list: T[]) =>
  new Map(list.map((x) => [x.code.trim().toUpperCase(), x]));

const linkKey = (l: LinkSnap) => `${l.version}/${l.source}/${l.cas}`;

const nameOf = (x: { nameJa?: string | null; nameOriginal?: string | null; code: string }) =>
  x.nameJa || x.nameOriginal || x.code;

/** 名前で「同じものらしい」を見るときの寄せかた */
const loose = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    // JavaScript の \s は全角の空白（U+3000）も含む
    .replace(/\s+/g, "")
    .replace(/[（）()]/g, "");

interface Where {
  law: string;
  category: string;
  class: string;
  substance: string;
  cas: string;
}

export function compare(customer: Snapshot, base: Snapshot, next: Snapshot | null): Report {
  const findings: Finding[] = [];
  const hasNext = next !== null;

  const push = (f: Omit<Finding, "proposal" | "conflict"> & { conflict: Conflict }): void => {
    findings.push({
      ...f,
      conflict: hasNext ? f.conflict : "n/a",
      proposal: proposalFor(f.impact, f.change, hasNext ? f.conflict : "n/a", f.kind),
    });
  };

  /** 項目ごとの差を見る。base と customer で違う項目を並べる */
  function diffFields<T extends object>(
    kind: Kind,
    where: Where,
    name: string,
    fields: (keyof T & string)[],
    c: T,
    b: T,
    n: T | undefined,
  ) {
    for (const field of fields) {
      const cv = str(c[field]);
      const bv = str(b[field]);
      if (cv === bv) continue;
      const nv = n ? str(n[field]) : "";
      let conflict: Conflict = "absent";
      if (n) conflict = nv === cv ? "agree" : "conflict";
      push({
        kind,
        ...where,
        name,
        change: "changed",
        field,
        customer: cv,
        base: bv,
        next: n ? nv : "",
        impact: impactOfField(field),
        conflict,
        remark: field === "officialNumber" ? "取り込みの突き合わせには使わない（鍵はコード）" : "",
      });
    }
  }

  /** 行の追加・削除。追加は「顧客が足した」、削除は「顧客が消した」 */
  function entity(
    kind: Kind,
    where: Where,
    name: string,
    change: "added" | "removed",
    inNext: boolean,
    remark = "",
  ) {
    const impact: Impact =
      change === "removed" ? "key" : kind === "law" || kind === "class" ? "display" : "judgement";
    push({
      kind,
      ...where,
      name,
      change,
      field: "",
      customer: change === "added" ? "あり" : "なし",
      base: change === "added" ? "なし" : "あり",
      next: hasNext ? (inNext ? "あり" : "なし") : "",
      impact,
      conflict: inNext ? "conflict" : "absent",
      remark:
        remark ||
        (change === "removed" && inNext
          ? "取り込むと戻る"
          : change === "added" && inNext
            ? "配布物に同じコードの行がある"
            : ""),
    });
  }

  // ---- 法律 ----
  const cLaws = byCode(customer.laws);
  const bLaws = byCode(base.laws);
  const nLaws = next ? byCode(next.laws) : new Map<string, LawSnap>();

  for (const [code, cl] of cLaws) {
    const bl = bLaws.get(code);
    const nl = nLaws.get(code);
    const where: Where = { law: cl.code, category: "", class: "", substance: "", cas: "" };
    if (!bl) {
      entity("law", where, nameOf(cl), "added", !!nl);
      continue;
    }
    diffFields<LawSnap>(
      "law",
      where,
      nameOf(cl),
      ["countryCode", "nameOriginal", "nameLang", "nameJa", "nameEn", "displayOrder", "note"],
      cl,
      bl,
      nl,
    );
    compareCategories(cl, bl, nl);
  }
  for (const [code, bl] of bLaws) {
    if (cLaws.has(code)) continue;
    entity(
      "law",
      { law: bl.code, category: "", class: "", substance: "", cas: "" },
      nameOf(bl),
      "removed",
      nLaws.has(code),
    );
  }

  function compareCategories(cl: LawSnap, bl: LawSnap, nl: LawSnap | undefined) {
    const cCats = byCode(cl.categories);
    const bCats = byCode(bl.categories);
    const nCats = nl ? byCode(nl.categories) : new Map<string, CategorySnap>();
    for (const [code, cc] of cCats) {
      const bc = bCats.get(code);
      const nc = nCats.get(code);
      const where: Where = { law: cl.code, category: cc.code, class: "", substance: "", cas: "" };
      if (!bc) {
        entity("category", where, nameOf(cc), "added", !!nc);
        continue;
      }
      diffFields<CategorySnap>(
        "category",
        where,
        nameOf(cc),
        [
          "nameOriginal",
          "nameLang",
          "nameJa",
          "nameEn",
          "displayOrder",
          "thresholdLower",
          "lowerBound",
          "thresholdUpper",
          "upperBound",
          "aggregation",
          "metalEtc",
          "thresholdBasis",
          "judged",
          "effectiveFrom",
          "effectiveTo",
          "interactionGroup",
          "rank",
          "score",
          "note",
        ],
        cc,
        bc,
        nc,
      );
      compareClasses(cl.code, cc, bc, nc);
    }
    for (const [code, bc] of bCats) {
      if (cCats.has(code)) continue;
      entity(
        "category",
        { law: cl.code, category: bc.code, class: "", substance: "", cas: "" },
        nameOf(bc),
        "removed",
        nCats.has(code),
      );
    }
  }

  function compareClasses(
    law: string,
    cc: CategorySnap,
    bc: CategorySnap,
    nc: CategorySnap | undefined,
  ) {
    const cCls = byCode(cc.classes);
    const bCls = byCode(bc.classes);
    const nCls = nc ? byCode(nc.classes) : new Map<string, ClassSnap>();

    // 区分の中で、法文物質名のコードがどの分類にあるかを引けるようにする（付け替えの検出）
    const bSubClass = new Map<string, string>();
    for (const k of bc.classes)
      for (const s of k.substances) bSubClass.set(s.code.trim().toUpperCase(), k.code);
    const cSubClass = new Map<string, string>();
    for (const k of cc.classes)
      for (const s of k.substances) cSubClass.set(s.code.trim().toUpperCase(), k.code);

    for (const [code, ck] of cCls) {
      const bk = bCls.get(code);
      const nk = nCls.get(code);
      const where: Where = { law, category: cc.code, class: ck.code, substance: "", cas: "" };
      if (!bk) {
        entity("class", where, nameOf({ ...ck, code: ck.code }), "added", !!nk);
        // 分類ごと足したときは、中の法文物質名も「足した」として並べる（付け替えでなければ）
        for (const s of ck.substances) {
          const sc = s.code.trim().toUpperCase();
          if (bSubClass.has(sc)) continue; // 付け替えは下で拾う
          entity(
            "substance",
            { ...where, substance: s.code },
            nameOf(s),
            "added",
            !!nk?.substances.some((x) => x.code.trim().toUpperCase() === sc),
          );
        }
        continue;
      }
      diffFields<ClassSnap>(
        "class",
        where,
        nameOf({ ...ck, code: ck.code }),
        [
          "nameOriginal",
          "nameLang",
          "nameJa",
          "nameEn",
          "displayOrder",
          "interactionGroup",
          "rank",
          "note",
        ],
        ck,
        bk,
        nk,
      );
      compareSubstances(law, cc.code, ck, bk, nk, bSubClass, cSubClass);
    }
    for (const [code, bk] of bCls) {
      if (cCls.has(code)) continue;
      entity(
        "class",
        { law, category: cc.code, class: bk.code, substance: "", cas: "" },
        nameOf({ ...bk, code: bk.code }),
        "removed",
        nCls.has(code),
      );
    }

    // 付け替え: 同じコードの法文物質名が、顧客側では別の分類にある
    for (const [sc, cClass] of cSubClass) {
      const bClass = bSubClass.get(sc);
      if (!bClass || bClass === cClass) continue;
      const s = cc.classes
        .find((k) => k.code === cClass)
        ?.substances.find((x) => x.code.trim().toUpperCase() === sc);
      if (!s) continue;
      push({
        kind: "substance",
        law,
        category: cc.code,
        class: cClass,
        substance: s.code,
        cas: "",
        name: nameOf(s),
        change: "moved",
        field: "class",
        customer: cClass,
        base: bClass,
        next: nc
          ? (nc.classes.find((k) => k.substances.some((x) => x.code.trim().toUpperCase() === sc))
              ?.code ?? "")
          : "",
        impact: "key",
        conflict: nc ? "conflict" : "absent",
        remark: "別の分類に付け替えてある",
      });
    }
  }

  function compareSubstances(
    law: string,
    category: string,
    ck: ClassSnap,
    bk: ClassSnap,
    nk: ClassSnap | undefined,
    bSubClass: Map<string, string>,
    cSubClass: Map<string, string>,
  ) {
    const cSubs = byCode(ck.substances);
    const bSubs = byCode(bk.substances);
    const nSubs = nk ? byCode(nk.substances) : new Map<string, SubstanceSnap>();

    // コードの付け替えの疑い: この分類で消えた行と足した行の名前が同じ
    const removedByName = new Map<string, SubstanceSnap>();
    for (const [code, bs] of bSubs) {
      if (!cSubs.has(code) && !cSubClass.has(code)) removedByName.set(loose(bs.nameOriginal), bs);
    }

    for (const [code, cs] of cSubs) {
      const bs = bSubs.get(code);
      const ns = nSubs.get(code);
      const where: Where = { law, category, class: ck.code, substance: cs.code, cas: "" };
      if (!bs) {
        if (bSubClass.has(code)) continue; // 付け替え（compareClasses で拾う）
        const twin = removedByName.get(loose(cs.nameOriginal));
        entity(
          "substance",
          where,
          nameOf(cs),
          "added",
          !!ns,
          twin ? `コードの付け替えの疑い（消えた ${twin.code} と同じ名前）` : "",
        );
        if (twin) {
          const last = findings[findings.length - 1];
          if (last) {
            last.impact = "key";
            last.proposal = "discuss";
          }
        }
        // 顧客が足した行の結び付きは、行ごと足したものとして数えない（行の追加で足りる）
        continue;
      }
      diffFields<SubstanceSnap>(
        "substance",
        where,
        nameOf(cs),
        [
          "officialNumber",
          "nameOriginal",
          "nameLang",
          "nameJa",
          "nameEn",
          "displayOrder",
          "thresholdLower",
          "lowerBound",
          "thresholdUpper",
          "upperBound",
          "aggregation",
          "metalEtc",
          "effectiveFrom",
          "effectiveTo",
          "applicableCondition",
          "note",
        ],
        cs,
        bs,
        ns,
      );
      compareLinks(where, nameOf(cs), cs, bs, ns);
    }
    for (const [code, bs] of bSubs) {
      if (cSubs.has(code) || cSubClass.has(code)) continue;
      const twin = ck.substances.find(
        (x) =>
          !bSubs.has(x.code.trim().toUpperCase()) &&
          loose(x.nameOriginal) === loose(bs.nameOriginal),
      );
      entity(
        "substance",
        { law, category, class: ck.code, substance: bs.code, cas: "" },
        nameOf(bs),
        "removed",
        nSubs.has(code),
        twin ? `コードの付け替えの疑い（足した ${twin.code} と同じ名前）` : "",
      );
      if (twin) {
        const last = findings[findings.length - 1];
        if (last) last.proposal = "discuss";
      }
    }
  }

  function compareLinks(
    where: Where,
    name: string,
    cs: SubstanceSnap,
    bs: SubstanceSnap,
    ns: SubstanceSnap | undefined,
  ) {
    const cL = new Map(cs.links.map((l) => [linkKey(l), l]));
    const bL = new Map(bs.links.map((l) => [linkKey(l), l]));
    const nL = ns ? new Map(ns.links.map((l) => [linkKey(l), l])) : new Map<string, LinkSnap>();
    for (const [key, cl] of cL) {
      const bl = bL.get(key);
      const nl = nL.get(key);
      const w: Where = { ...where, cas: `${cl.cas}（${cl.version}×${cl.source}）` };
      if (!bl) {
        entity("link", w, name, "added", !!nl);
        continue;
      }
      diffFields<LinkSnap>(
        "link",
        w,
        name,
        ["excluded", "casNumber", "note", "text", "textJa"],
        cl,
        bl,
        nl,
      );
    }
    for (const [key, bl] of bL) {
      if (cL.has(key)) continue;
      entity(
        "link",
        { ...where, cas: `${bl.cas}（${bl.version}×${bl.source}）` },
        name,
        "removed",
        nL.has(key),
      );
    }
  }

  // ---- まとめ ----
  const counts: Summary["counts"] = {
    display: { keep: 0, "keep-check": 0, discuss: 0 },
    judgement: { keep: 0, "keep-check": 0, discuss: 0 },
    key: { keep: 0, "keep-check": 0, discuss: 0 },
  };
  for (const f of findings) counts[f.impact][f.proposal] += 1;

  // 要相談 → 判定 → 表示 の順。同じ中では場所の順
  const rank: Record<Proposal, number> = { discuss: 0, "keep-check": 1, keep: 2 };
  findings.sort(
    (a, b) =>
      rank[a.proposal] - rank[b.proposal] ||
      `${a.law}/${a.category}/${a.class}/${a.substance}/${a.cas}`.localeCompare(
        `${b.law}/${b.category}/${b.class}/${b.substance}/${b.cas}`,
      ),
  );

  return {
    customerLabel: customer.label,
    baseLabel: base.label,
    nextLabel: next?.label ?? null,
    summary: { counts, total: findings.length, hasNext },
    findings,
  };
}
