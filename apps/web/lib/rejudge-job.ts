import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { judgeProduct, loadFactors, loadRules } from "@/lib/judge-store";
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
  error: null,
};

export function rejudgeStatus(): RejudgeStatus {
  return { ...status };
}

/**
 * 開始する。すでに走っていれば false（二重に走らせない）。
 * 実行は裏で続くので、呼ぶ側はすぐ戻る
 */
export function startRejudge(actorId: string): boolean {
  if (status.running) return false;
  status.running = true;
  status.total = 0;
  status.done = 0;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.versionCode = null;
  status.error = null;
  void run(actorId);
  return true;
}

async function run(actorId: string) {
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
      loadRules(version.id),
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
      await judgeProduct(p.id, rules, factors, settings.conditionalLinkMode, version.id);
      status.done += 1;
    }

    await writeAudit({
      entity: "products",
      action: "determine",
      actorId,
      diff: { rejudged: products.length, version: version.code, ms: Date.now() - started },
    });
    await recordFullRejudge(version.id, actorId);
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

async function recordFullRejudge(versionId: string, actorId: string) {
  const value = JSON.stringify({ at: new Date().toISOString(), versionId });
  await prisma.systemSetting.upsert({
    where: { key: LAST_FULL_KEY },
    update: { value, updatedBy: actorId },
    create: { key: LAST_FULL_KEY, value, valueType: "JSON", updatedBy: actorId },
  });
}

/**
 * 最後に全製品を判定し直し終えた時刻。
 * 記録が無い（この仕組みより前に判定した環境）ときは、
 * 現在のバージョンの判定のうちいちばん古い計算日時で代える
 */
async function lastFullRejudge(
  versionId: string,
): Promise<{ at: Date; versionId: string | null } | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: LAST_FULL_KEY },
    select: { value: true },
  });
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value) as { at?: string; versionId?: string };
      const at = parsed.at ? new Date(parsed.at) : null;
      if (at && !Number.isNaN(at.getTime())) {
        return { at, versionId: parsed.versionId ?? null };
      }
    } catch {
      // 読めない値は無いものとして下へ
    }
  }
  const oldest = await prisma.productJudgement.aggregate({
    where: { versionId },
    _min: { computedAt: true },
  });
  return oldest._min.computedAt ? { at: oldest._min.computedAt, versionId } : null;
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
  const [changedAt, lastFull] = await Promise.all([
    premisesChangedAt(version.id),
    lastFullRejudge(version.id),
  ]);
  return isRejudgeNeeded({ currentVersionId: version.id, changedAt, lastFull });
}

/**
 * 判定の前提（法規制側のデータ）が最後に変わった時刻。
 *
 * 判定の計算日時がこれより前なら、その判定は古い前提で出したもの。
 * 見るのは、現在のバージョンのCASリンク・データソースの並び、法文物質名、規制区分。
 * どれも `updatedAt` を持つので、いちばん新しいものを取る
 */
export async function premisesChangedAt(versionId: string): Promise<Date | null> {
  const [link, order, sub, cat] = await Promise.all([
    prisma.statutoryCasLink.aggregate({ where: { versionId }, _max: { updatedAt: true } }),
    prisma.linkVersionSource.aggregate({ where: { versionId }, _max: { updatedAt: true } }),
    prisma.statutorySubstance.aggregate({ _max: { updatedAt: true } }),
    prisma.regulationCategory.aggregate({ _max: { updatedAt: true } }),
  ]);
  const times = [link, order, sub, cat]
    .map((r) => r._max.updatedAt)
    .filter((d): d is Date => d !== null);
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((d) => d.getTime())));
}
