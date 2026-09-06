import { pickName, pickStatutoryName, type Locale } from "@chem/shared";
import { prisma } from "@/lib/db";
import { compareLawOrder, lawOrderKey } from "@/lib/law-order";

/**
 * 物質1件を、**バージョンを横に並べて**見るための組み立て。
 *
 * インベントリの番号と、当たっている法規制を同じ形の表で出す。
 * 見たいのは「前のバージョンから変わったかどうか」なので、
 * **現在のバージョンと、その1つ前**の2つだけを並べる。
 *
 * 列は `地域 › 種類 › バージョン` の3段。地域でまとめて畳めるようにするため、
 * 種類には必ず地域と国を持たせる。
 *
 * セルには値が複数入ることがある（1つのCASに番号が2つ付くインベントリ、
 * 同じ区分の別々の法文物質名）。**行に割って**出すので、
 * ここでは配列のまま返し、並べ方は画面側が決める。
 *
 * 値には**どのデータソースから来たか**を持たせる。
 * 画面で選んだデータソースのぶんを目立たせるために使う。
 */

/** 表の1つの列。地域と国は、列をまとめて畳むための手がかり */
export interface MatrixColumn {
  key: string;
  /** 見出し（番号としての呼び名、または規制区分の名前） */
  label: string;
  /** 1つ上のまとまり（法律、またはインベントリ）。段を畳むための鍵 */
  parentKey: string;
  /** そのまとまりの名前 */
  parentLabel: string;
  countryId: string;
  countryName: string;
  regionId: string;
  regionName: string;
  /** 物質の画面に番号として出している種類か。トグルで絞るのに使う */
  shown: boolean;
}

/** セルの中身1つぶん */
export interface MatrixValue {
  /** 画面に出す文字（番号、または法律上の番号） */
  text: string;
  /** 補足（法文物質名など）。無ければ null */
  note: string | null;
  sourceId: string;
  /**
   * 出どころがそのCASについて書いている文章（CASリンクの「データ」）。
   * 画面の言語で選んである（日本語訳があれば日本語、無ければ原文）。無ければ null
   */
  data: string | null;
  /** 非該当で確定させた結び付き。取り消し線で出し、下位の該当を打ち消す */
  excluded: boolean;
  /** 上位のデータソースの非該当に打ち消されて、採用されていない該当 */
  overridden: boolean;
}

export interface SubstanceMatrix {
  /** 左から新しい順。現在のバージョンが先頭 */
  versions: { id: string; code: string; isCurrent: boolean }[];
  /** 並べたバージョンに載っているデータソース。優先度の高い順、重複なし */
  sources: { id: string; code: string; color: string | null }[];
  inventory: { columns: MatrixColumn[]; cells: Record<string, MatrixValue[]> };
  regulation: { columns: MatrixColumn[]; cells: Record<string, MatrixValue[]> };
}

/** セルの鍵。列 × バージョン で1つ */
const cellKey = (columnKey: string, versionId: string) => `${columnKey}/${versionId}`;

/**
 * 現在のバージョンと、その1つ前を返す。
 * 「1つ前」は基準日の並びで決める（現在のバージョンの決め方と同じ規則）。
 */
async function twoVersions() {
  const all = await prisma.linkSetVersion.findMany({
    where: { deletedAt: null },
    orderBy: [{ asOf: "desc" }, { createdAt: "desc" }],
    select: { id: true, code: true, isCurrent: true },
  });
  if (all.length === 0) return [];
  const at = all.findIndex((v) => v.isCurrent);
  const i = at < 0 ? 0 : at;
  // 現在のものと、その次に古いもの。現在が最後なら1つだけ
  return all.slice(i, i + 2);
}

/**
 * @param locale 名前をどちらの言語で出すか。
 *   **画面は見ている人の言語、帳票はテンプレートの言語**で呼ぶ。
 *   英語の様式を日本語の利用者が出しても、英語で出るのでなければ相手に送れない
 */
export async function buildSubstanceMatrix(
  casNormalized: string | null,
  locale: Locale = "ja",
): Promise<SubstanceMatrix> {
  const empty: SubstanceMatrix = {
    versions: [],
    sources: [],
    inventory: { columns: [], cells: {} },
    regulation: { columns: [], cells: {} },
  };
  if (!casNormalized) return empty;

  const versions = await twoVersions();
  if (versions.length === 0) return empty;
  const versionIds = versions.map((v) => v.id);

  /*
    データソースは**並べたバージョンに載っているものだけ**。

    並び（＝画面の既定）は**先頭のバージョン、つまり現在のバージョンの優先度**で決める。
    バージョンをまたいで若い番号を拾うと、過去のバージョンでだけ1位だったものが
    先頭に来てしまい、いま効いているものと食い違う。
    先頭のバージョンに載っていないものは、その後ろに並べる。
  */
  const vs = await prisma.linkVersionSource.findMany({
    where: { versionId: { in: versionIds } },
    orderBy: { priority: "asc" },
    select: {
      versionId: true,
      sourceId: true,
      priority: true,
      // 色は選んだデータソースを見分けるために使う（決めていなければ空）
      source: { select: { code: true, color: true } },
    },
  });
  const head = versions[0]!.id;
  /** 先頭のバージョンでの優先度。載っていなければ後ろへ回す */
  const rank = new Map<string, number>();
  const codeOf = new Map<string, string>();
  const colorOf = new Map<string, string | null>();
  for (const r of vs) {
    codeOf.set(r.sourceId, r.source.code);
    colorOf.set(r.sourceId, r.source.color);
    if (r.versionId !== head) continue;
    rank.set(r.sourceId, r.priority);
  }
  const rankOf = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const sources = [...codeOf.entries()]
    .map(([id, code]) => ({ id, code, color: colorOf.get(id) ?? null }))
    .sort((a, b) => rankOf(a.id) - rankOf(b.id) || a.code.localeCompare(b.code));

  // --- インベントリ ---------------------------------------------------------
  const inventories = await prisma.inventory.findMany({
    where: { deletedAt: null },
    orderBy: { numberOrder: "asc" },
    select: {
      id: true,
      nameJa: true,
      nameOriginal: true,
      numberLabel: true,
      numberShown: true,
      nameEn: true,
      country: {
        select: {
          id: true,
          nameJa: true,
          nameEn: true,
          regionId: true,
          region: { select: { nameJa: true, nameEn: true } },
        },
      },
    },
  });

  const invColumns: MatrixColumn[] = inventories.map((i) => ({
    key: `inv:${i.id}`,
    // 呼び名を付けていないインベントリは、名前をそのまま見出しにする
    label: i.numberLabel ?? pickName(locale, i.nameJa, i.nameEn) ?? i.nameOriginal,
    parentKey: `inv:${i.id}`,
    parentLabel: pickName(locale, i.nameJa, i.nameEn) || i.nameOriginal,
    countryId: i.country.id,
    countryName: pickName(locale, i.country.nameJa, i.country.nameEn),
    regionId: i.country.regionId,
    regionName: pickName(locale, i.country.region.nameJa, i.country.region.nameEn),
    shown: i.numberShown && i.numberLabel !== null,
  }));

  /*
    **地域でまとめる。**画面は地域で列を畳むので、同じ地域が離れて並ぶと1つに畳めない。
    地域どうしの順は、その地域が初めて出てくる並び順（`numberOrder`）に従う
  */
  const invRegionFirst = new Map<string, number>();
  for (const c of invColumns) {
    if (!invRegionFirst.has(c.regionId)) invRegionFirst.set(c.regionId, invRegionFirst.size);
  }
  invColumns.sort(
    (a, b) => (invRegionFirst.get(a.regionId) ?? 0) - (invRegionFirst.get(b.regionId) ?? 0),
  );

  const invRows = await prisma.inventoryRow.findMany({
    where: { casNormalized, versionId: { in: versionIds } },
    select: { inventoryId: true, versionId: true, sourceId: true, value: true },
  });
  const invCells: Record<string, MatrixValue[]> = {};
  for (const r of invRows) {
    const k = cellKey(`inv:${r.inventoryId}`, r.versionId);
    (invCells[k] ??= []).push({
      text: r.value,
      note: null,
      sourceId: r.sourceId,
      data: null,
      excluded: false,
      overridden: false,
    });
  }

  // --- 法規制 ---------------------------------------------------------------
  /*
    **結び付きのある区分だけを列にする。**登録されている区分をすべて並べると、
    ほとんどがハイフンの表になって、変わったところが埋もれる。
    非該当で確定させたリンク（`excluded`）も出す（取り消し線）。
    **上位のデータソースが非該当を持つ区分では、下位の該当は打ち消されている**ので、
    採用されていない印を付けて出す。隠すと「LOLI に載っていない」ように読めてしまった
  */
  const links = await prisma.statutoryCasLink.findMany({
    where: { casNormalized, versionId: { in: versionIds } },
    select: {
      versionId: true,
      sourceId: true,
      excluded: true,
      // 出どころの文章。「ソースデータ」を押したときにセルへ添える
      data: { select: { text: true, textJa: true } },
      statutorySubstance: {
        select: {
          officialNumber: true,
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          deletedAt: true,
          regulationClass: {
            select: {
              // 分類は名前を持たないことがある（区分を分けないときの受け皿）
              nameJa: true,
              nameEn: true,
              nameOriginal: true,
              category: {
                select: {
                  id: true,
                  nameJa: true,
                  nameEn: true,
                  nameOriginal: true,
                  displayOrder: true,
                  deletedAt: true,
                  law: {
                    select: {
                      id: true,
                      nameJa: true,
                      nameEn: true,
                      nameOriginal: true,
                      code: true,
                      displayOrder: true,
                      country: {
                        select: {
                          id: true,
                          nameJa: true,
                          nameEn: true,
                          regionId: true,
                          displayOrder: true,
                          region: { select: { nameJa: true, nameEn: true, displayOrder: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  /*
    バージョン×区分ごとに、非該当を持つデータソースのうちいちばん優先度の高いもの。
    それより優先度の低いデータソースの該当は、打ち消されている（採用されていない）。
    同じデータソースの別の号は生きている（そのデータソース自身が該当と言っている）
  */
  const excludedRank = new Map<string, number>();
  for (const l of links) {
    if (!l.excluded) continue;
    const key = `${l.versionId}/${l.statutorySubstance.regulationClass.category.id}`;
    const r = rankOf(l.sourceId);
    const now = excludedRank.get(key);
    if (now === undefined || r < now) excludedRank.set(key, r);
  }

  const regColumns = new Map<string, MatrixColumn & { order: ReturnType<typeof lawOrderKey> }>();
  const regCells: Record<string, MatrixValue[]> = {};
  for (const l of links) {
    const s = l.statutorySubstance;
    if (s.deletedAt) continue;
    const c = s.regulationClass.category;
    if (c.deletedAt) continue;
    const cut = excludedRank.get(`${l.versionId}/${c.id}`);
    const overridden = !l.excluded && cut !== undefined && rankOf(l.sourceId) > cut;
    const key = `cat:${c.id}`;
    if (!regColumns.has(key)) {
      regColumns.set(key, {
        key,
        label: pickName(locale, c.nameJa, c.nameEn) || c.nameOriginal,
        parentKey: `law:${c.law.id}`,
        parentLabel: pickName(locale, c.law.nameJa, c.law.nameEn) || c.law.nameOriginal,
        countryId: c.law.country.id,
        countryName: pickName(locale, c.law.country.nameJa, c.law.country.nameEn),
        regionId: c.law.country.regionId,
        regionName: pickName(locale, c.law.country.region.nameJa, c.law.country.region.nameEn),
        // 法規制はトグルの対象外。常に出す
        shown: true,
        // 並びは地域 → 国 → 法律 → 区分。法律の番号は国ごとに1から振ってある
        order: lawOrderKey(c.law, c.displayOrder),
      });
    }
    /*
      出すのは **分類 → 番号 → 法文物質名**。
      分類は名前を持たないことがある（区分を分けないときの受け皿）ので、
      名前が入っているときだけ添える。番号を持たない法文物質名もあるので、
      無いものは飛ばして詰める
    */
    const cls = s.regulationClass;
    const parts = [
      cls.nameOriginal === null
        ? null
        : pickStatutoryName(locale, cls.nameOriginal, cls.nameJa, cls.nameEn),
      s.officialNumber,
      pickStatutoryName(locale, s.nameOriginal, s.nameJa, s.nameEn),
    ].filter((v): v is string => v !== null && v !== "");

    const k = cellKey(key, l.versionId);
    (regCells[k] ??= []).push({
      text: parts.join(" "),
      note: null,
      sourceId: l.sourceId,
      data: l.data ? (locale === "ja" ? (l.data.textJa ?? l.data.text) : l.data.text) : null,
      excluded: l.excluded,
      overridden,
    });
  }

  /** 優先度の高いデータソースから並べる。同じなら文字の順で落ち着かせる */
  const sortValues = (cells: Record<string, MatrixValue[]>) => {
    for (const list of Object.values(cells)) {
      list.sort((a, b) => rankOf(a.sourceId) - rankOf(b.sourceId) || a.text.localeCompare(b.text));
    }
  };
  sortValues(invCells);
  sortValues(regCells);

  /*
    **地域でまとめてから、法律・区分の順に並べる。**
    画面は地域で列を畳むので、同じ地域が離れて並ぶと1つに畳めない。
    地域どうしの順は地域そのものの並び順。**法律の番号からは決めない。**
    法律の番号は国ごとに1から振ってあるので、そこから地域の順を作ると
    国が1つ増えるたびに地域の並びが変わってしまう
  */

  return {
    versions,
    sources,
    inventory: { columns: invColumns, cells: invCells },
    regulation: {
      columns: [...regColumns.values()]
        .sort((a, b) => compareLawOrder(a.order, b.order))
        .map(({ order: _o, ...rest }) => rest),
      cells: regCells,
    },
  };
}
