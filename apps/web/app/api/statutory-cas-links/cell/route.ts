import { normalizeCas, toScaled } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { MARK_CONDITIONAL_LINK, MARK_UNFILLED } from "@/lib/judge-store";
import { getServerMessages } from "@/lib/i18n";
import type { CellDetailDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * バージョンでは変わらない要確認の理由。
 * 規制区分の測りかたと、その製品の組成で決まるもの
 */
const VERSION_FREE = ["homogeneousMaterial", "unknownComposition", "missingFactor", "truncated"];

/**
 * GET /api/statutory-cas-links/cell?cas=...&categoryId=...&productId=...
 *
 * 1つの CAS × 1つの規制区分について、**バージョンごと・データソースごと**に
 * どの法文物質名に結び付いているかを返す。まとめ表のセルを押したときに開く。
 *
 * **バージョンによってデータソースの並びも顔ぶれも違う。**
 * 前のバージョンには無かったデータソースが増えていることも、逆もある。
 * だからバージョンごとに、そのバージョンの並びで返す。
 *
 * 「採用」は**「規制区分 × CAS」で1つのデータソースだけが勝つ**。
 * 勝ったデータソースが持っていない号は、下位が持っていても採用しない。
 * こうしないと、1つの区分の中でデータソースが混ざる。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  const params = new URL(req.url).searchParams;
  const casRaw = params.get("cas") ?? "";
  const categoryId = params.get("categoryId") ?? "";
  const productId = params.get("productId") ?? "";
  const cas = normalizeCas(casRaw);
  if (!cas || !categoryId) return jsonError(400, "validation_error", m.errors.validation);

  const category = await prisma.regulationCategory.findFirst({
    where: { id: categoryId, deletedAt: null },
    select: {
      nameJa: true,
      nameEn: true,
      nameOriginal: true,
      law: {
        select: {
          nameJa: true,
          nameEn: true,
          nameOriginal: true,
          country: {
            select: {
              nameJa: true,
              nameEn: true,
              region: { select: { nameJa: true, nameEn: true } },
            },
          },
        },
      },
    },
  });
  if (!category) return jsonError(404, "not_found", m.errors.notFound);

  // 物質マスタの見出し。CAS を持つ代表の1件を出す
  const substance = await prisma.substance.findFirst({
    where: { deletedAt: null, casNormalized: cas },
    orderBy: [{ isCasRepresentative: "desc" }, { code: "asc" }],
    select: { code: true, casNumber: true, nameJa: true, nameEn: true },
  });

  /*
    その製品の、その区分の判定。**現バージョンぶんしか無い。**
    前のバージョンの判定は保存していないので、当たり・要確認・含有率不足の別は
    現バージョンにだけ付く
  */
  const judgement = productId
    ? await prisma.productJudgement.findFirst({
        where: { productId, categoryId },
        select: {
          verdict: true,
          needsReview: true,
          reviewReasons: true,
          hits: { select: { statutorySubstanceId: true } },
        },
      })
    : null;
  const hitSubstances = new Set(
    (judgement?.hits ?? []).map((h) => h.statutorySubstanceId).filter((x) => !!x),
  );
  /** 区分そのものでまとめて当たったとき。中の号は全部当たり扱い */
  const wholeCategoryHit =
    judgement?.verdict === "APPLICABLE" &&
    (judgement?.hits ?? []).some((h) => h.statutorySubstanceId === null);

  const versions = await prisma.linkSetVersion.findMany({
    where: { deletedAt: null },
    // 新しい版が左。新旧は通番で決める
    orderBy: [{ sequence: "desc" }, { codeNormalized: "desc" }],
    select: { id: true, code: true, isCurrent: true },
  });

  /*
    **その製品に、このCASがどれだけ入っているか。**
    含有率が足りているかどうかを、**バージョンによらず同じやりかたで**見るために要る。

    保存してある判定は現バージョンぶんしか無い。それだけで「含有率不足」を決めると、
    前のバージョンには印が付かず、**同じデータなのに片方だけ隠れて**しまう
    （2026Q3で消えたように見えて、実際は両方に載っている、という取り違えが起きた）。
  */
  const line = productId
    ? await prisma.productExpansionLine.findFirst({
        where: { productId, casNormalized: cas },
        select: { totalPct: true },
      })
    : null;
  const content = toScaled(line?.totalPct?.toString() ?? "0") ?? 0n;

  /**
   * その号が、この製品でどう扱われるか。
   *
   * **含有率が足りているかは、両方のバージョンで同じように見る**（上の注記）。
   * 「要確認」だけは保存してある判定にしか無いので、現バージョンにだけ付く
   */
  const judgementOf = (
    isCurrent: boolean,
    adopted: boolean,
    substanceId: string,
    lower: string,
    bound: "INCLUSIVE" | "EXCLUSIVE",
    applicableCondition: string | null,
    substanceNote: string | null,
    linkNote: string | null,
  ) => {
    const limit = toScaled(lower) ?? 0n;
    const enough = bound === "INCLUSIVE" ? content >= limit : content > limit;
    /*
      **保存してある判定は、採用されたデータソースのことしか言っていない。**
      上位の「非該当」が勝つと、下位の LOLI・CHRIP の該当は判定に出てこない。
      それを「含有率不足」と読んで隠してしまい、載っているのに消えたように見えた。
      採用されなかったものは、含有率だけで見る（前のバージョンと同じ見かた）
    */
    const hitHere =
      isCurrent && judgement !== null && adopted
        ? wholeCategoryHit || hitSubstances.has(substanceId)
        : enough;
    /*
      **要確認は両方のバージョンに付ける。**
      法文物質名に適用条件が書いてあれば、当たったときは必ず要確認。
      条件は法律の側で決まっているので、**バージョンやデータソースでは変わらない。**

      製品の側の理由（換算係数が無い・中身が分からない・深すぎて展開しきれない）は
      保存してある判定にしか無いので、現バージョンにだけ乗る
    */
    const marked =
      (applicableCondition ?? "").trim() !== "" || (substanceNote ?? "").includes(MARK_UNFILLED);
    const linkMarked = (linkNote ?? "").includes(MARK_CONDITIONAL_LINK);
    /*
      保存してある判定に付いている要確認の理由。**バージョンで変わるものと、変わらないものがある。**

      「均質材料あたりで測る」「中身の分からない原材料が残っている」
      「換算係数が無い」「深すぎて展開しきれない」は、
      **規制区分の測りかたと、その製品の組成で決まる。**どの版で見ても同じなので両方に出す。
      前の版に出さないでいたころは、同じ製品・同じ法文物質名なのに
      現バージョンにだけ「?」が付き、データが変わったように見えていた。

      これ以外（総称から広げた CAS など）は、その版の結び付きしだいなので現バージョンだけ
    */
    const reasons = judgement?.reviewReasons ?? [];
    const sameEveryVersion = reasons.some((r) => VERSION_FREE.includes(r));
    const savedReview =
      judgement !== null &&
      judgement.needsReview &&
      (sameEveryVersion || (isCurrent && reasons.length === 0));
    return {
      hit: hitHere,
      needsReview: hitHere && (marked || linkMarked || savedReview),
      // 載っているのに当たっていない。含有率が足りない
      nearMiss: !hitHere,
    };
  };

  const out: CellDetailDto["versions"] = [];
  for (const v of versions) {
    /*
      そのバージョンのデータソースを、**そのバージョンの優先度の順**に出す。
      バージョンをまたいで並びを揃えると、優先度が変わったことが見えなくなる
    */
    const defs = await prisma.linkVersionSource.findMany({
      where: { versionId: v.id },
      orderBy: { priority: "asc" },
      select: { source: { select: { id: true, code: true, color: true, mark: true } } },
    });

    const links = await prisma.statutoryCasLink.findMany({
      // 非該当も引く。勝ち負けに出して、窓では「非該当」と印を付けて出す
      where: {
        versionId: v.id,
        casNormalized: cas,
        statutorySubstance: { deletedAt: null, regulationClass: { categoryId } },
      },
      select: {
        sourceId: true,
        note: true,
        excluded: true,
        // 出どころの文章。小ウィンドウでは切らずに全部出す
        data: { select: { text: true, textJa: true } },
        statutorySubstance: {
          select: {
            id: true,
            officialNumber: true,
            nameJa: true,
            nameEn: true,
            nameOriginal: true,
            displayOrder: true,
            thresholdLower: true,
            lowerBound: true,
            applicableCondition: true,
            note: true,
            regulationClass: {
              select: { nameJa: true, nameEn: true, nameOriginal: true },
            },
          },
        },
      },
    });

    /*
      **採用は「規制区分 × CAS」で1つだけ決める。**判定と同じ決めかた。

      いちばん優先度の高いデータソースが勝ち、そのデータソースの結び付きだけを使う。
      **勝ったデータソースが持っていない号は、下位が持っていても採用しない。**
      号ごとに決めると、1つの区分の中でデータソースが混ざってしまう
    */
    const rank = new Map(defs.map((d, i) => [d.source.id, i]));
    let best: number | null = null;
    for (const l of links) {
      const at = rank.get(l.sourceId) ?? 99;
      if (best === null || at < best) best = at;
    }

    out.push({
      code: v.code,
      isCurrent: v.isCurrent,
      sources: defs.map((d) => ({
        id: d.source.id,
        code: d.source.code,
        color: d.source.color,
        mark: d.source.mark,
        items: links
          .filter((l) => l.sourceId === d.source.id)
          .sort((a, b) => a.statutorySubstance.displayOrder - b.statutorySubstance.displayOrder)
          .map((l) => ({
            classNameJa: l.statutorySubstance.regulationClass.nameJa,
            classNameEn: l.statutorySubstance.regulationClass.nameEn,
            classNameOriginal: l.statutorySubstance.regulationClass.nameOriginal,
            officialNumber: l.statutorySubstance.officialNumber,
            nameJa: l.statutorySubstance.nameJa,
            nameEn: l.statutorySubstance.nameEn,
            nameOriginal: l.statutorySubstance.nameOriginal,
            adopted: best !== null && (rank.get(d.source.id) ?? 99) === best,
            excluded: l.excluded,
            dataText: l.data?.text ?? null,
            dataTextJa: l.data?.textJa ?? null,
            ...judgementOf(
              v.isCurrent,
              best !== null && (rank.get(d.source.id) ?? 99) === best,
              l.statutorySubstance.id,
              l.statutorySubstance.thresholdLower.toString(),
              l.statutorySubstance.lowerBound,
              l.statutorySubstance.applicableCondition,
              l.statutorySubstance.note,
              l.note,
            ),
            // 非該当の結び付きは、当たりも含有率不足も無い
            ...(l.excluded ? { hit: false, needsReview: false, nearMiss: false } : {}),
          })),
      })),
    });
  }

  const body: CellDetailDto = {
    cas: substance?.casNumber ?? casRaw,
    substanceCode: substance?.code ?? null,
    substanceNameJa: substance?.nameJa ?? null,
    substanceNameEn: substance?.nameEn ?? null,
    regionNameJa: category.law.country.region.nameJa,
    regionNameEn: category.law.country.region.nameEn,
    countryNameJa: category.law.country.nameJa,
    countryNameEn: category.law.country.nameEn,
    lawNameJa: category.law.nameJa,
    lawNameEn: category.law.nameEn,
    lawNameOriginal: category.law.nameOriginal,
    categoryNameJa: category.nameJa,
    categoryNameEn: category.nameEn,
    categoryNameOriginal: category.nameOriginal,
    versions: out,
  };
  return Response.json(body);
}
