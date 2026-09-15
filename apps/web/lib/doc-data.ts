import {
  applyOrgChoices,
  DOCUMENT_TABLE_DEFS,
  openOrgBlocks,
  ORG_ITEM_PREFIX,
  ORG_NAME_ITEM,
  orgBlockKey,
  parseOrgChoices,
  pickName,
  pickStatutoryName,
  RECIPIENT_ITEM_PREFIX,
  type DocumentContent,
  PICK_COMPANY_KEY,
  PICK_DEPARTMENT_KEY,
} from "@chem/shared";
import type { DocumentTable, DocumentTarget, Locale, Messages } from "@chem/shared";
import type { Actor } from "@/lib/authz";
import { aggregateComposition } from "@/lib/composition-aggregate";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { visibilityWhere } from "@/lib/product-service";
import { pickOrganisation } from "@/lib/user-organisations";
import type { RenderInput } from "@/lib/doc-render";
import { getCurrentVersion } from "@/lib/current-version";
import { toJudgementDtos } from "@/lib/judgement-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";
import { buildSubstanceMatrix } from "@/lib/substance-matrix";

/**
 * 帳票に流すデータを集める。
 *
 * **画面が使っているものと同じところから引く。**
 * 帳票のために引き直すと、画面と帳票で数が食い違ったときに
 * どちらが正しいのか誰にも分からなくなる。
 *
 * **見る権限は、呼んだ人のもので判断する。**
 * 組成を見られない人が帳票から組成を持ち出せてはいけない。
 * 見られない表は、集める段階で外す（そのぶんの枠ごと出ない）。
 */

export interface DocData {
  /** 表題に出す。生成の記録にも残す */
  code: string;
  values: RenderInput["values"];
  tables: RenderInput["tables"];
  /**
   * 法規制判定の表に根拠（当たった法文物質名）が載っているか。
   * 載っていれば組成と同じ扱い（組成を見られる人にしか、できあがった帳票を見せない）
   */
  judgementWithBasis: boolean;
}

function tableDef(key: DocumentTable, locale: Locale) {
  const def = DOCUMENT_TABLE_DEFS.find((t) => t.key === key);
  return (def?.columns ?? []).map((c) => ({
    key: c.key,
    label: locale === "en" ? c.labelEn : c.labelJa,
  }));
}

/**
 * 組織まわりの値。
 *
 * **所属する会社・所属部署は、いつも作った人のもの。**差し替えられない。
 * **任意の会社・任意の部署は、作るときに選んだもの。**自分が所属していない組織も選べる
 * （2026-09-13 指示。以前の「差出人」と「差出人を選べる権限」はこれに置き換えた）。
 *
 * **宛先は、選ばれたときだけ入る。**「宛先を使う」印の付いた様式でだけ選ばせる。
 *
 * 組織の項目は打たれたものをそのまま流す。持っていない項目は空欄になる
 * （組織ごとに項目が違うので、無いことは誤りではない）。
 */
export interface DocParties {
  /** 任意の会社（組織のID）。種別が「会社」でなければ捨てる */
  companyId?: string | null;
  /** 任意の部署（組織のID）。種別が「部署」でなければ捨てる */
  departmentId?: string | null;
  recipientId?: string | null;
  /**
   * 様式が名指ししている組織のid（組織ブロック）。
   * **様式から取り出して渡す。**差出人・宛先とは別で、誰が作っても同じものが出る
   */
  organisationIds?: string[];
}

const ORG_SELECT = {
  nameJa: true,
  nameEn: true,
  items: { select: { label: true, value: true } },
} as const;

async function orgValues(
  actor: Actor,
  locale: Locale,
  parties: DocParties | undefined,
): Promise<[string, string][]> {
  const recipientId = parties?.recipientId;
  const me = await prisma.user.findUnique({
    where: { id: actor.user.id },
    select: {
      organisations: {
        select: {
          organisation: { select: { ...ORG_SELECT, id: true, kind: true, displayOrder: true } },
        },
      },
    },
  });
  /*
    所属は種別を問わず何件でもある。**会社は種別「会社」の先頭、所属は「部署」の先頭**を使う
    （利用者の編集画面の並びと同じ）
  */
  const mine = (me?.organisations ?? []).map((x) => x.organisation);
  const org = pickOrganisation(mine, "COMPANY");
  const department = pickOrganisation(mine, "DEPARTMENT");
  /*
    任意の会社・任意の部署。**種別が合わないものは捨てる**
    （URL に書けば部署の欄に会社が入る、という状態を作らない）。消された組織も捨てる
  */
  const pickedCompany = parties?.companyId
    ? await prisma.organisation.findFirst({
        where: { id: parties.companyId, deletedAt: null, kind: "COMPANY" },
        select: ORG_SELECT,
      })
    : null;
  const pickedDepartment = parties?.departmentId
    ? await prisma.organisation.findFirst({
        where: { id: parties.departmentId, deletedAt: null, kind: "DEPARTMENT" },
        select: ORG_SELECT,
      })
    : null;

  const to = recipientId
    ? await prisma.organisation.findFirst({
        where: { id: recipientId, deletedAt: null },
        select: ORG_SELECT,
      })
    : null;

  const out: [string, string][] = [
    ["org.name", org ? pickName(locale, org.nameJa, org.nameEn) : ""],
    ["org.group", department ? pickName(locale, department.nameJa, department.nameEn) : ""],
    [
      PICK_COMPANY_KEY,
      pickedCompany ? pickName(locale, pickedCompany.nameJa, pickedCompany.nameEn) : "",
    ],
    [
      PICK_DEPARTMENT_KEY,
      pickedDepartment ? pickName(locale, pickedDepartment.nameJa, pickedDepartment.nameEn) : "",
    ],
    ["to.name", to ? pickName(locale, to.nameJa, to.nameEn) : ""],
  ];
  for (const it of org?.items ?? []) out.push([`${ORG_ITEM_PREFIX}${it.label}`, it.value]);
  for (const it of to?.items ?? []) out.push([`${RECIPIENT_ITEM_PREFIX}${it.label}`, it.value]);
  return out;
}

/**
 * 生成するときに選んだ組織を、様式へ書き込む。
 *
 * **URL に書かれた組織は、そのまま信じない。**消された組織、様式が決めた種別と
 * 違う組織は捨てる（種別「取引先」の欄に会社を入れる、という穴を作らない）。
 * 様式で組織を決めてあるブロックは、何が来ても変えない
 */
export async function resolveOrgChoices(
  content: DocumentContent,
  raw: string | string[] | undefined,
): Promise<DocumentContent> {
  const wanted = parseOrgChoices(raw);
  const open = openOrgBlocks(content);
  if (open.length === 0 || wanted.size === 0) return content;
  const rows = await prisma.organisation.findMany({
    where: { id: { in: [...new Set(wanted.values())] }, deletedAt: null },
    select: { id: true, kind: true },
  });
  const kindOf = new Map(rows.map((o) => [o.id, o.kind]));
  const ok = new Map<string, string>();
  for (const b of open) {
    const id = wanted.get(b.id);
    if (!id) continue;
    const kind = kindOf.get(id);
    if (!kind || (b.kind && b.kind !== kind)) continue;
    ok.set(b.id, id);
  }
  return applyOrgChoices(content, ok);
}

/**
 * 様式が名指ししている組織。**組織ブロックのために読む。**
 *
 * 消された組織を指したままの様式は、値が空になるだけで紙面は出る
 * （出ないと、どこがおかしいのか分からなくなる）。
 */
async function namedOrgValues(ids: string[], locale: Locale): Promise<[string, string][]> {
  if (ids.length === 0) return [];
  const rows = await prisma.organisation.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, ...ORG_SELECT },
  });
  const out: [string, string][] = [];
  for (const o of rows) {
    out.push([orgBlockKey(o.id, ORG_NAME_ITEM), pickName(locale, o.nameJa, o.nameEn)]);
    for (const it of o.items) out.push([orgBlockKey(o.id, it.label), it.value]);
  }
  return out;
}

/** 共通の項目。どちらの対象でも同じ */
async function commonValues(
  actor: Actor,
  versionCode: string | null,
  locale: Locale,
  parties?: DocParties,
): Promise<[string, string][]> {
  const now = new Date();
  return [
    // 端末の時計ではなくサーバーの時刻。誰が作っても同じ値になる
    ["doc.generatedAt", now.toLocaleString(locale === "en" ? "en-US" : "ja-JP")],
    ["doc.generatedBy", actor.user.displayName ?? actor.user.email],
    ["doc.version", versionCode ?? ""],
    ...(await orgValues(actor, locale, parties)),
    ...(await namedOrgValues(parties?.organisationIds ?? [], locale)),
  ];
}

export async function collectForProduct(
  actor: Actor,
  productId: string,
  locale: Locale,
  m: Messages,
  parties?: DocParties,
): Promise<DocData | null> {
  // 一覧・詳細で見えない製品（未公開・無効）は、帳票にもしない
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null, ...visibilityWhere(actor) },
    select: {
      id: true,
      code: true,
      nameJa: true,
      nameEn: true,
      note: true,
      publishState: true,
      createdBy: true,
      modelValue: true,
      uses: { orderBy: { displayOrder: "asc" }, select: { value: true } },
    },
  });
  if (!product) return null;

  const version = await getCurrentVersion();
  /*
    判定は法規制バージョンごとにあるので、書類に載せるのは現在のバージョンの結果。
    **根拠（当たった法文物質名）は、組成を見られる人にだけ。**製品の画面と同じ。
    法文物質名が並べば「この製品にその物質が入っている」と分かる。見られない人の帳票は、
    区分ごとの該非だけ（番号と法文物質名の欄は空）
  */
  const withHits = canViewComposition(actor, product as never);
  const judgements = version ? await toJudgementDtos(product.id, withHits, version.id) : [];
  const hit = judgements.filter((j) => j.verdict === "APPLICABLE");
  const hitCategories = new Set(hit.map((j) => j.categoryId)).size;

  const values = new Map<string, string>([
    ...(await commonValues(actor, version?.code ?? null, locale, parties)),
    ["product.code", product.code],
    ["product.nameJa", product.nameJa],
    ["product.nameEn", product.nameEn ?? ""],
    ["product.modelName", product.modelValue ?? ""],
    // 用途は複数ある。並びは画面と同じ順で、読点でつなぐ
    ["product.useName", product.uses.map((u) => u.value).join("、")],
    ["product.note", product.note ?? ""],
    ["product.judgementCount", String(hitCategories)],
  ]);

  const tables: RenderInput["tables"] = new Map();

  // --- 法規制判定 -------------------------------------------------------------
  tables.set("judgement", {
    columns: tableDef("judgement", locale),
    /*
      判定の単位（当たった法文物質名）ごとに1行。**区分の名前だけでは足りない。**
      受け取った相手が確かめるのは「どの号か」なので、番号と名前まで出す。
      根拠を伏せる相手には区分ごとに 1 行（番号と名前は空）
    */
    rows: hit.map((j) => ({
      law: pickStatutoryName(locale, j.lawNameOriginal, j.lawNameJa, j.lawNameEn),
      category: pickStatutoryName(
        locale,
        j.categoryNameOriginal,
        j.categoryNameJa,
        j.categoryNameEn,
      ),
      verdict: m.judgements.applicable,
      needsReview: j.needsReview ? m.common.yes : "",
      officialNumber: j.officialNumber ?? "",
      statutoryName: j.statutoryName ?? "",
    })),
  });

  /*
    **組成は見られる人にだけ。**帳票は持ち出せる形なので、
    画面で伏せているものが紙に出ることがあってはならない
  */
  if (canViewComposition(actor, product as never)) {
    const lines = await prisma.compositionLine.findMany({
      where: { parentProductId: product.id },
      orderBy: { displayOrder: "asc" },
      select: {
        contentPct: true,
        note: true,
        substance: { select: { code: true, casNumber: true, nameJa: true, nameEn: true } },
        childProduct: { select: { code: true, nameJa: true, nameEn: true } },
      },
    });
    tables.set("composition", {
      columns: tableDef("composition", locale),
      rows: lines.map((l) => ({
        code: l.substance?.code ?? l.childProduct?.code ?? "",
        casNumber: l.substance?.casNumber ?? "",
        name: l.substance
          ? pickName(locale, l.substance.nameJa, l.substance.nameEn)
          : pickName(locale, l.childProduct?.nameJa, l.childProduct?.nameEn),
        contentPct: l.contentPct?.toString() ?? "",
        note: l.note ?? "",
      })),
    });

    const agg = await aggregateComposition(actor, product.id);
    tables.set("compositionAggregate", {
      columns: tableDef("compositionAggregate", locale),
      rows: agg.rows.map((r) => ({
        casNumber: r.casNumber ?? "",
        code: r.code,
        name: pickName(locale, r.nameJa, r.nameEn),
        totalPct: `${r.totalPct}`,
        note: r.note ?? "",
      })),
    });
  }

  return {
    code: product.code,
    values,
    tables,
    judgementWithBasis: withHits && hit.some((j) => j.statutoryName !== null),
  };
}

export async function collectForSubstance(
  actor: Actor,
  substanceId: string,
  locale: Locale,
  parties?: DocParties,
): Promise<DocData | null> {
  const substance = await prisma.substance.findFirst({
    where: { id: substanceId, deletedAt: null, ...substanceVisibility(actor) },
    select: {
      id: true,
      code: true,
      casNumber: true,
      casNormalized: true,
      nameJa: true,
      nameEn: true,
      note: true,
    },
  });
  if (!substance) return null;

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { code: true },
  });

  const values = new Map<string, string>([
    ...(await commonValues(actor, version?.code ?? null, locale, parties)),
    ["substance.code", substance.code],
    ["substance.casNumber", substance.casNumber ?? ""],
    ["substance.nameJa", substance.nameJa],
    ["substance.nameEn", substance.nameEn ?? ""],
    ["substance.note", substance.note ?? ""],
  ]);

  const tables: RenderInput["tables"] = new Map();
  if (substance.casNormalized) {
    /*
      画面の表（該当法規・インベントリ番号）は、バージョンを2つ並べて出す。
      **帳票では現在のバージョンだけ。**紙に2つ並べても、
      どちらの数字で判断したのかが読み取れない
      */
    // 名前もテンプレートの言語で出す（画面は見ている人の言語のまま）
    const matrix = await buildSubstanceMatrix(substance.casNormalized, locale);
    const head = matrix.versions[0];
    const cellText = (key: string) =>
      head ? (matrix.regulation.cells[`${key}/${head.id}`] ?? []) : [];

    tables.set("substanceRegulation", {
      columns: tableDef("substanceRegulation", locale),
      rows: matrix.regulation.columns.flatMap((c) =>
        cellText(c.key).map((v) => ({
          law: c.parentLabel ?? "",
          category: c.label,
          officialNumber: "",
          statutoryName: v.text,
        })),
      ),
    });

    const invText = (key: string) =>
      head ? (matrix.inventory.cells[`${key}/${head.id}`] ?? []) : [];
    tables.set("substanceInventory", {
      columns: tableDef("substanceInventory", locale),
      rows: matrix.inventory.columns.flatMap((c) =>
        invText(c.key).map((v) => ({
          inventory: c.label,
          country: c.countryName ?? "",
          value: v.text,
        })),
      ),
    });
  }

  return { code: substance.code, values, tables, judgementWithBasis: false };
}

/** 対象の種類に応じて集める */
export async function collectFor(
  actor: Actor,
  target: DocumentTarget,
  targetId: string,
  locale: Locale,
  m: Messages,
  parties?: DocParties,
): Promise<DocData | null> {
  return target === "PRODUCT"
    ? collectForProduct(actor, targetId, locale, m, parties)
    : collectForSubstance(actor, targetId, locale, parties);
}

/**
 * その紙面に組成が載っているか。
 *
 * **テンプレートが組成の表を置いていて、かつ実際に中身が取れたとき**だけ真。
 * 組成を見られない人が作ったものには最初から入らないので、
 * そのぶんは偽になる（開くときに要らぬ制限をかけないため）。
 */
export function containsComposition(
  content: { blocks: { kind: string; table?: string }[] },
  data: Pick<DocData, "tables" | "judgementWithBasis">,
): boolean {
  return content.blocks.some(
    (b) =>
      b.kind === "table" &&
      ((b.table === "composition" || b.table === "compositionAggregate") && data.tables.has(b.table)
        ? true
        : // 判定の根拠（法文物質名）が載っていれば、それも組成のうち
          b.table === "judgement" && data.judgementWithBasis),
  );
}
