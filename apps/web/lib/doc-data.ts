import {
  DOCUMENT_TABLE_DEFS,
  ORG_ITEM_PREFIX,
  ORG_NAME_ITEM,
  orgBlockKey,
  pickName,
  pickStatutoryName,
  RECIPIENT_ITEM_PREFIX,
} from "@chem/shared";
import type { DocumentTable, DocumentTarget, Locale, Messages } from "@chem/shared";
import type { Actor } from "@/lib/authz";
import { aggregateComposition } from "@/lib/composition-aggregate";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { pickOrganisation } from "@/lib/user-organisations";
import type { RenderInput } from "@/lib/doc-render";
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
}

function tableDef(key: DocumentTable, locale: Locale) {
  const def = DOCUMENT_TABLE_DEFS.find((t) => t.key === key);
  return (def?.columns ?? []).map((c) => ({
    key: c.key,
    label: locale === "en" ? c.labelEn : c.labelJa,
  }));
}

/**
 * 差出人と宛先。
 *
 * **差出人の既定は、作った人の会社。**`DOCUMENT_SENDER` を持っている人は
 * 別の組織を選べる（関連会社の名前で出す、代理で出す）。
 * **所属はいつも作った人のもの。**選んだ組織に「その人の部署」は無いため。
 *
 * **宛先は、選ばれたときだけ入る。**「宛先を使う」印の付いた様式でだけ選ばせる。
 *
 * 組織の項目は打たれたものをそのまま流す。持っていない項目は空欄になる
 * （組織ごとに項目が違うので、無いことは誤りではない）。
 */
/**
 * 差出人と宛先。**どちらも組織のID。**
 * 渡されなければ、差出人は作った人の会社、宛先は無し
 */
export interface DocParties {
  senderId?: string | null;
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
  senderId?: string | null,
  recipientId?: string | null,
): Promise<[string, string][]> {
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
  const company = pickOrganisation(mine, "COMPANY");
  const department = pickOrganisation(mine, "DEPARTMENT");
  /*
    差し替えた差出人。**権限を持っていない人が渡してきたら見ない。**
    URL に付ければ誰でも別の会社の名前で出せる、という穴を作らない
  */
  const picked =
    senderId && actor.has("DOCUMENT_SENDER")
      ? await prisma.organisation.findFirst({
          where: { id: senderId, deletedAt: null },
          select: ORG_SELECT,
        })
      : null;
  const org = picked ?? company;

  const to = recipientId
    ? await prisma.organisation.findFirst({
        where: { id: recipientId, deletedAt: null },
        select: ORG_SELECT,
      })
    : null;

  const out: [string, string][] = [
    ["org.name", org ? pickName(locale, org.nameJa, org.nameEn) : ""],
    ["org.group", department ? pickName(locale, department.nameJa, department.nameEn) : ""],
    ["to.name", to ? pickName(locale, to.nameJa, to.nameEn) : ""],
  ];
  for (const it of org?.items ?? []) out.push([`${ORG_ITEM_PREFIX}${it.label}`, it.value]);
  for (const it of to?.items ?? []) out.push([`${RECIPIENT_ITEM_PREFIX}${it.label}`, it.value]);
  return out;
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
    ...(await orgValues(actor, locale, parties?.senderId, parties?.recipientId)),
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
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
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

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { code: true },
  });
  const judgements = await toJudgementDtos(product.id, true);
  const hit = judgements.filter((j) => j.verdict === "APPLICABLE");

  const values = new Map<string, string>([
    ...(await commonValues(actor, version?.code ?? null, locale, parties)),
    ["product.code", product.code],
    ["product.nameJa", product.nameJa],
    ["product.nameEn", product.nameEn ?? ""],
    ["product.modelName", product.modelValue ?? ""],
    // 用途は複数ある。並びは画面と同じ順で、読点でつなぐ
    ["product.useName", product.uses.map((u) => u.value).join("、")],
    ["product.note", product.note ?? ""],
    ["product.judgementCount", String(hit.length)],
  ]);

  const tables: RenderInput["tables"] = new Map();

  // --- 法規制判定 -------------------------------------------------------------
  tables.set("judgement", {
    columns: tableDef("judgement", locale),
    rows: hit.flatMap((j) => {
      const law = pickStatutoryName(locale, j.lawNameOriginal, j.lawNameJa, j.lawNameEn);
      const cat = pickStatutoryName(
        locale,
        j.categoryNameOriginal,
        j.categoryNameJa,
        j.categoryNameEn,
      );
      const base = {
        law,
        category: cat,
        verdict: m.judgements.applicable,
        needsReview: j.needsReview ? m.common.yes : "",
      };
      /*
        当たった法文物質名ごとに1行。**区分の名前だけでは足りない。**
        受け取った相手が確かめるのは「どの号か」なので、番号と名前まで出す
      */
      if (j.hits.length === 0) return [{ ...base, officialNumber: "", statutoryName: "" }];
      return j.hits.map((h) => ({
        ...base,
        officialNumber: h.officialNumber ?? "",
        statutoryName: h.name ?? "",
      }));
    }),
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

  return { code: product.code, values, tables };
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

  return { code: substance.code, values, tables };
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
  tables: RenderInput["tables"],
): boolean {
  return content.blocks.some(
    (b) =>
      b.kind === "table" &&
      (b.table === "composition" || b.table === "compositionAggregate") &&
      tables.has(b.table),
  );
}
