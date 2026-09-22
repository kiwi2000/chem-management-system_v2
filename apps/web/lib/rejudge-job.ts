import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { expandProduct, saveExpansion } from "@/lib/expansion-store";
import { judgeProduct, loadFactors, loadRules } from "@/lib/judge-store";
import { todayInJapan } from "@/lib/judgement-date";
import { isRejudgeNeeded } from "@/lib/rejudge-needed";
import { getAppSettings } from "@/lib/settings";

/**
 * 全製品の判定のやり直し（管理者が画面から起こす）。
 *
 * **法規制側のデータを変えても、判定は自動でやり直されない**
 * （CASリンクの追加・非該当、閾値の変更、バージョンの切り替え、優先順位の変更）。
 * 変更の種類が多く、影響する製品を正しく絞るのは難しいので、
 * 管理者が「全部やり直す」ボタンで一括して更新する。
 *
 * 判定は法規制バージョンごとに持つ（2026-09-12 決定）。やり直すのは現在の版の行だけで、
 * 別の版の行はそのまま残る。バージョンを切り替えた直後は、その版の判定が無い製品があるので、
 * 「要再計算」を出してここへ誘う。
 *
 * 製品が多いと数十分かかるので、**HTTP の応答を待たせず裏で回す。**
 * 進み具合はこのモジュールの変数で持ち、画面は数秒おきに聞きに来る。
 * サーバーが1台のあいだはこれで足りる（増やすときは DB に持ち替える）。
 */

export interface RejudgeStatus {
  running: boolean;
  /** 対象の製品数。走っていないときは前回のもの */
  total: number;
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** 判定に使った法規制バージョン */
  versionCode: string | null;
  /** 判定対象日（YYYY-MM-DD） */
  asOf: string | null;
  /** 途中で止まったときの理由。正常に終われば null */
  error: string | null;
}

const status: RejudgeStatus = {
  running: false,
  total: 0,
  done: 0,
  startedAt: null,
  finishedAt: null,
  versionCode: null,
  asOf: null,
  error: null,
};

export function rejudgeStatus(): RejudgeStatus {
  return { ...status };
}

/**
 * 開始する。すでに走っていれば false（二重に走らせない）。
 * 実行は裏で続くので、呼ぶ側はすぐ戻る
 */
export function startRejudge(actorId: string, asOf: string): boolean {
  if (status.running) return false;
  status.running = true;
  status.total = 0;
  status.done = 0;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.versionCode = null;
  status.asOf = asOf;
  status.error = null;
  void run(actorId, asOf);
  return true;
}

async function run(actorId: string, asOf: string) {
  const started = Date.now();
  try {
    const version = await prisma.linkSetVersion.findFirst({
      where: { isCurrent: true, deletedAt: null },
      select: { id: true, code: true },
    });
    if (!version) throw new Error("no current version");
    status.versionCode = version.code;

    // 法律側の決めごとは1回だけ読んで使い回す（製品ごとに引くと数十万件のリンクを何度も読む）
    const [rules, factors, settings] = await Promise.all([
      loadRules(version.id, asOf),
      loadFactors(),
      getAppSettings(),
    ]);
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { code: "asc" },
    });
    status.total = products.length;

    for (const p of products) {
      // 展開結果は物質の不純物種別を写し取っているので、ここから作り直す（2026-09-19）
      await saveExpansion(p.id, await expandProduct(p.id));
      await judgeProduct(p.id, rules, factors, {
        asOf,
        trigger: "FULL",
        actorId,
        conditionalLinkMode: settings.conditionalLinkMode,
        versionId: version.id,
      });
      status.done += 1;
    }

    await writeAudit({
      entity: "products",
      action: "determine",
      actorId,
      diff: { rejudged: products.length, version: version.code, asOf, ms: Date.now() - started },
    });
    await recordFullRejudge(version.id, actorId, asOf);
  } catch (e) {
    status.error = e instanceof Error ? e.message : String(e);
    console.error("rejudge failed:", e);
  } finally {
    status.running = false;
    status.finishedAt = new Date().toISOString();
  }
}

/**
 * 最後に全製品を判定し直し終えた時刻の置き場（システム設定の表を借りる）。
 * 画面の設定項目ではないので SETTING_DEFS には載せない
 */
const LAST_FULL_KEY = "judge.last_full_rejudge";

async function recordFullRejudge(versionId: string, actorId: string, asOf: string) {
  const value = JSON.stringify({ at: new Date().toISOString(), versionId, asOf });
  await prisma.systemSetting.upsert({
    where: { key: LAST_FULL_KEY },
    update: { value, updatedBy: actorId },
    create: { key: LAST_FULL_KEY, value, valueType: "JSON", updatedBy: actorId },
  });
}

/**
 * **その版で**最後に全製品を判定し直し終えた時刻。
 * 記録が無い、または記録が別の版のものなら、その版の判定のうちいちばん古い計算日時で代える
 * （判定は版ごとに持つので、別の版の記録は当てにならない）。その版の判定が無ければ null
 */
async function lastFullRejudge(versionId: string): Promise<Date | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: LAST_FULL_KEY },
    select: { value: true },
  });
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as { at?: string; versionId?: string };
      const at = parsed.at ? new Date(parsed.at) : null;
      if (at && !Number.isNaN(at.getTime()) && parsed.versionId === versionId) return at;
    } catch {
      // 読めない値は無いものとして下へ
    }
  }
  const oldest = await prisma.productJudgement.aggregate({
    where: { versionId },
    _min: { computedAt: true },
  });
  return oldest._min.computedAt;
}

/**
 * いま「全製品を判定し直す」を押すべきか。左メニューの下の「要再計算」に使う。
 * 30 秒おきに全管理者から呼ばれるので、集計 5 本の軽い問い合わせに留める
 */
export async function rejudgeNeeded(): Promise<boolean> {
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true },
  });
  if (!version) return false;
  // 走っている最中は、終われば消えるので出さない
  if (status.running) return false;
  const [changedAt, lastFull, crossed, missing] = await Promise.all([
    premisesChangedAt(version.id),
    lastFullRejudge(version.id),
    // 施行日・適用終了日を跨いだ判定（今日で見ると「効いている」印が変わる）が 1 つでもあるか
    boundaryCrossed(version.id, todayInJapan()),
    /*
      組成があるのに、この版で判定していない製品。切り替えたまま判定し直していないもののほか、
      判定の持ちかたを変える移行で判定を捨てたあと（2026-09-15）もここに当たる。
      判定の行は 0 件のこともあるので、展開結果に残した「最後に判定した版」で見る
    */
    prisma.productExpansion.count({
      where: {
        product: { deletedAt: null },
        OR: [{ judgedVersionId: null }, { judgedVersionId: { not: version.id } }],
      },
    }),
  ]);
  return isRejudgeNeeded({
    currentVersionId: version.id,
    changedAt,
    lastFull,
    missing: missing > 0,
    boundaryCrossed: crossed,
  });
}

/**
 * 判定に付けた「効いている」印が、今日で見ると変わる判定があるか（2026-09-22 決定）。
 * 判定対象日から今日までのあいだに、その法文物質名か区分の施行日・適用終了日を跨いだもの。
 * データは変わっていないので `premisesChangedAt` では拾えない。
 * `productId` を渡せばその製品だけ（製品の画面の「要再計算」）、省けば全体（左メニューの印）。
 * 判定の行は法文物質名と外部キーを張っていないので、生の SQL で突き合わせる
 */
export async function boundaryCrossed(
  versionId: string,
  today: string,
  productId?: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM product_judgements pj
    JOIN regulation_categories c ON c.id = pj.category_id
    LEFT JOIN statutory_substances s ON s.id = pj.statutory_substance_id
    WHERE pj.version_id = ${versionId}
      AND (${productId ?? null}::text IS NULL OR pj.product_id = ${productId ?? null})
      AND pj.effective::text <> (CASE
        WHEN c.effective_from IS NOT NULL AND c.effective_from > ${today}::date THEN 'NOT_YET'
        WHEN c.effective_to IS NOT NULL AND c.effective_to < ${today}::date THEN 'EXPIRED'
        WHEN s.effective_from IS NOT NULL AND s.effective_from > ${today}::date THEN 'NOT_YET'
        WHEN s.effective_to IS NOT NULL AND s.effective_to < ${today}::date THEN 'EXPIRED'
        ELSE 'IN_FORCE' END)`;
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * 判定の前提（法規制側のデータ）が最後に変わった時刻。
 *
 * 判定の計算日時がこれより前なら、その判定は古い前提で出したもの。
 * 見るのは、現在のバージョンのCASリンク・データソースの並び、法文物質名、規制区分。
 * どれも `updatedAt` を持つので、いちばん新しいものを取る
 */
export async function premisesChangedAt(versionId: string): Promise<Date | null> {
  const [link, order, sub, cat, pat, ex, exSub] = await Promise.all([
    prisma.statutoryCasLink.aggregate({ where: { versionId }, _max: { updatedAt: true } }),
    prisma.linkVersionSource.aggregate({ where: { versionId }, _max: { updatedAt: true } }),
    prisma.statutorySubstance.aggregate({ _max: { updatedAt: true } }),
    prisma.regulationCategory.aggregate({ _max: { updatedAt: true } }),
    // 不純物種別と除外の設定（S21）。変えると判定の前提が変わる
    prisma.impurityType.aggregate({ _max: { updatedAt: true } }),
    prisma.impurityExemption.aggregate({ _max: { updatedAt: true } }),
    prisma.impurityExemptionSubstance.aggregate({ _max: { updatedAt: true } }),
  ]);
  const times = [link, order, sub, cat, pat, ex, exSub]
    .map((r) => r._max.updatedAt)
    .filter((d): d is Date => d !== null);
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((d) => d.getTime())));
}
