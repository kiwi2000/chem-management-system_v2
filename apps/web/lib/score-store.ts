import { type RankBand, rankOf } from "@chem/shared";
import { prisma } from "@/lib/db";

/**
 * 物質のスコアとランクを計算して書き込む。
 *
 * **スコア＝当たっている規制区分に付けた点数の合計。**
 * 「当たっている」は、現在のバージョンのCASリンクがあること。
 * 含有率は見ない（製品ではなく物質そのものに付く値だから）。
 *
 * 数え方の決まり
 *   - **同じ区分は1回だけ。**同じ区分に法文物質名が2つあっても2回足さない
 *   - **「判定に使う」印の付いた区分だけ。**印を外した区分は合計に入れない
 *   - **非該当で確定させたリンク（`excluded`）は数えない**
 *   - 区分のスコアの既定は 0。付けていない区分は合計を動かさない
 *
 * **1文のSQLで数える。**物質は6万件、リンクは56万件あるので、
 * 1件ずつ引くと本番のトンネル越しに何十分もかかる（実際にかかった）。
 */

/**
 * 現在のバージョンで当たっている「CAS × 規制区分 × 法文物質名」。
 * 点を足す前の土台。**不純物種別の除外（S21）は物質ごとに効く**ので、ここでは落とさない
 */
const HIT_SQL = `
  SELECT DISTINCT l.cas_normalized, c.id AS category_id, c.score, s.id AS statutory_substance_id
  FROM statutory_cas_links l
  JOIN link_set_versions v ON v.id = l.version_id AND v.is_current = true AND v.deleted_at IS NULL
  JOIN statutory_substances s ON s.id = l.statutory_substance_id AND s.deleted_at IS NULL
  JOIN regulation_classes rc ON rc.id = s.class_id AND rc.deleted_at IS NULL
  JOIN regulation_categories c ON c.id = rc.category_id AND c.deleted_at IS NULL
  WHERE l.excluded = false
    AND c.judged = true
    -- 無効にしたデータソースのリンクは点に入れない
    AND NOT EXISTS (
      SELECT 1 FROM link_version_sources x
      WHERE x.version_id = l.version_id AND x.source_id = l.source_id AND x.enabled = false
    )
`;

/**
 * 物質ごとの合計点。
 *
 * **不純物種別で除外される区分は数えない**（S21）。
 * 判定と同じ順（法文物質名の上書き → 区分の設定 → 除外しない）で決める。
 * 区分の点は区分ごとに 1 回だけ数える（同じ区分の法文物質名に何件当たっても増やさない）
 */
const TOTAL_SQL = `
  WITH hit AS (${HIT_SQL}),
  keep AS (
    SELECT DISTINCT s.id AS substance_id, h.category_id, h.score
    FROM substances s
    JOIN hit h ON h.cas_normalized = s.cas_normalized
    WHERE s.deleted_at IS NULL
      AND NOT COALESCE(
        (SELECT es.excluded FROM impurity_exemption_substances es
          WHERE es.type_id = s.impurity_type_id
            AND es.statutory_substance_id = h.statutory_substance_id),
        (SELECT e.excluded FROM impurity_exemptions e
          WHERE e.type_id = s.impurity_type_id AND e.category_id = h.category_id),
        false)
  )
  SELECT substance_id, SUM(score) AS total
  FROM keep
  GROUP BY substance_id
`;

export async function loadBands(): Promise<RankBand[]> {
  const rows = await prisma.substanceRankBand.findMany({
    where: { deletedAt: null },
    orderBy: { displayOrder: "asc" },
    select: {
      id: true,
      label: true,
      lowerValue: true,
      lowerBound: true,
      upperValue: true,
      upperBound: true,
      displayOrder: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    lowerValue: r.lowerValue?.toString() ?? null,
    lowerBound: r.lowerBound,
    upperValue: r.upperValue?.toString() ?? null,
    upperBound: r.upperBound,
    displayOrder: r.displayOrder,
  }));
}

/**
 * 合計点を物質へ書き戻す。`casNormalized` を絞ると、その物質だけを計算し直す。
 * 絞らなければ全件。返すのは書き換えた件数。
 */
async function writeScores(casList: string[] | null): Promise<number> {
  const bands = await loadBands();

  /*
    **合計はSQLで、ランクは TypeScript で決める。**
    段の当てはめ方（並び順に見て最初に合ったものを採る、不等号の扱い）は
    `@chem/shared` の `rankOf` が持っており、画面と同じ判断にしたいため。
  */
  /*
    **CAS番号を持たない物質も対象にする。**リンクが1本も無いので合計は0だが、
    0点として段に当てないと、ランクだけ空欄になって「未計算」と見分けが付かない
  */
  const filter = casList ? `WHERE s.cas_normalized = ANY($1::text[])` : `WHERE true`;

  const sql = `SELECT s.id, s.cas_normalized AS cas, t.total
       FROM substances s
       LEFT JOIN (${TOTAL_SQL}) t ON t.substance_id = s.id
       ${filter} AND s.deleted_at IS NULL`;
  const rows = casList
    ? await prisma.$queryRawUnsafe<{ id: string; cas: string; total: unknown }[]>(sql, casList)
    : await prisma.$queryRawUnsafe<{ id: string; cas: string; total: unknown }[]>(sql);

  const now = new Date();
  let changed = 0;

  /*
    **ランクごとにまとめて書く。**1件ずつ更新すると6万回の往復になる。
    同じスコア・同じランクの物質は1つの `updateMany` にまとめられる
  */
  interface Group {
    score: string;
    rank: string | null;
    ids: string[];
  }
  const groups = new Map<string, Group>();
  for (const r of rows) {
    // 合計は DECIMAL なので、Prisma からは Decimal で返る。段に当てる前に文字列へ直す
    const score = r.total === null || r.total === undefined ? "0" : String(r.total);
    const rank = bands.length === 0 ? null : rankOf(score, bands);
    // 段の名前には空白が入りうるので、鍵は組み立てず値そのものを持たせる
    const key = `${score} ${rank ?? ""}`;
    const got = groups.get(key);
    if (got) got.ids.push(r.id);
    else groups.set(key, { score, rank, ids: [r.id] });
  }

  for (const g of groups.values()) {
    for (let i = 0; i < g.ids.length; i += 1000) {
      const res = await prisma.substance.updateMany({
        where: { id: { in: g.ids.slice(i, i + 1000) } },
        data: { score: g.score, scoreRank: g.rank, scoreAt: now },
      });
      changed += res.count;
    }
  }
  return changed;
}

/** 全物質を計算し直す。設定の対応表を変えたときと、管理画面のボタンから */
export async function recomputeAllScores(): Promise<number> {
  return writeScores(null);
}

/**
 * 1つの規制区分に当たっている物質だけを計算し直す。
 * 区分のスコアを保存したときに呼ぶ。
 */
export async function recomputeScoresForCategory(categoryId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ cas_normalized: string }[]>`
    SELECT DISTINCT l.cas_normalized
    FROM statutory_cas_links l
    JOIN link_set_versions v ON v.id = l.version_id AND v.is_current = true AND v.deleted_at IS NULL
    JOIN statutory_substances s ON s.id = l.statutory_substance_id AND s.deleted_at IS NULL
    JOIN regulation_classes rc ON rc.id = s.class_id AND rc.category_id = ${categoryId}::text
    WHERE l.excluded = false
      AND NOT EXISTS (
        SELECT 1 FROM link_version_sources x
        WHERE x.version_id = l.version_id AND x.source_id = l.source_id AND x.enabled = false
      )
  `;
  const cas = rows.map((r) => r.cas_normalized).filter(Boolean);
  if (cas.length === 0) return 0;
  return writeScores(cas);
}

/**
 * ある不純物種別の物質を、まとめて計算し直す（S21）。
 * 除外の設定を変えると、その種別の物質の点が変わるので、除外の付け外しのときに呼ぶ
 */
export async function recomputeScoresForType(typeId: string): Promise<number> {
  const rows = await prisma.substance.findMany({
    where: { impurityTypeId: typeId, deletedAt: null, casNormalized: { not: null } },
    select: { casNormalized: true },
  });
  const cas = [...new Set(rows.map((r) => r.casNormalized as string))];
  if (cas.length === 0) return 0;
  return writeScores(cas);
}

/** 物質1件を計算し直す。登録・CAS番号の変更のときに呼ぶ */
export async function recomputeScoreForSubstance(casNormalized: string | null): Promise<number> {
  if (!casNormalized) return 0;
  return writeScores([casNormalized]);
}
