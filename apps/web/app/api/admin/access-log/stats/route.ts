import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { countryOf } from "@/lib/ip-country";
import { SIGNIN_ACTIONS, TAKEOUT_ACTIONS } from "@/lib/access-log-shared";
import type { AccessRiskKind, AccessStatsDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 数える範囲。既定は30日。長くしすぎると読み出しが重くなる */
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

/** 「見慣れない場所」の基準。ここから外れたログイン成功を拾う */
const HOME_PLACES = ["JP", "local"];

/** 「夜」の範囲。22時から翌6時まで */
const NIGHT_FROM = 22;
const NIGHT_TO = 6;

/** これ以上の失敗が同じ相手から続いていたら、試されているとみなす */
const REPEATED_FAILURE = 5;

/** 1日にこれ以上の組成を開いていたら、まとめて持ち出しているとみなす */
const BULK_VIEW = 30;

/** 上位いくつまで出すか。並べすぎると、多いものが埋もれる */
const TOP_N = 5;

/**
 * GET /api/admin/access-log/stats — アクセス記録の分析。
 *
 * 記録は1件ずつ見ても何も分からない。**数えて初めて形が出る。**
 * 「いつ・誰が」の普段の形から外れたものを拾うのが目的。
 *
 * 数えるのはサーバー側で行う。画面へ全件送って数えると、記録が増えたときに
 * 動かなくなるうえ、記録そのものを外へ出すことになる。
 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const raw = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isInteger(raw) && raw > 0 && raw <= MAX_DAYS ? raw : DEFAULT_DAYS;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await prisma.auditLog.findMany({
    where: { at: { gte: from }, action: { in: [...SIGNIN_ACTIONS, ...TAKEOUT_ACTIONS] } },
    select: { at: true, action: true, actorId: true, diff: true },
  });

  const users = await prisma.user.findMany({
    select: { id: true, displayName: true, email: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, login: 0, failed: 0, view: 0 }));
  const totals = { login: 0, failed: 0, view: 0, lockouts: 0 };

  const failedByEmail = new Map<string, number>();
  const failedByIp = new Map<string, number>();
  const viewsByUser = new Map<string, { count: number; lines: number }>();
  /** まとめて持ち出していないかの判定用。利用者ごと・日ごとに数える */
  const viewsByUserDay = new Map<string, number>();

  const unknownAccounts = new Map<string, number>();
  const foreignLogins = new Map<string, number>();
  const nightWho = new Map<string, number>();
  const lockoutWho = new Map<string, number>();
  let nightLogins = 0;

  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);

  for (const l of logs) {
    const d = (l.diff ?? {}) as {
      ip?: string | null;
      email?: string | null;
      reason?: string | null;
      lineCount?: number;
    };
    const hour = l.at.getHours();
    const slot = byHour[hour] as { hour: number; login: number; failed: number; view: number };
    const who = (l.actorId ? nameOf.get(l.actorId) : null) ?? d.email ?? "（不明）";

    if (l.action === "login") {
      totals.login += 1;
      slot.login += 1;
      const place = countryOf(d.ip ?? null);
      if (place !== null && !HOME_PLACES.includes(place)) bump(foreignLogins, place);
      if (hour >= NIGHT_FROM || hour < NIGHT_TO) {
        nightLogins += 1;
        bump(nightWho, who);
      }
    } else if (l.action === "login_failed") {
      totals.failed += 1;
      slot.failed += 1;
      if (d.email) bump(failedByEmail, d.email);
      if (d.ip) bump(failedByIp, d.ip);
      if (d.reason === "unknown_user" && d.email) bump(unknownAccounts, d.email);
      if (d.reason === "locked_now") {
        totals.lockouts += 1;
        bump(lockoutWho, who);
      }
    } else {
      totals.view += 1;
      slot.view += 1;
      const cur = viewsByUser.get(who) ?? { count: 0, lines: 0 };
      viewsByUser.set(who, { count: cur.count + 1, lines: cur.lines + (d.lineCount ?? 0) });
      bump(viewsByUserDay, `${who}\t${l.at.toISOString().slice(0, 10)}`);
    }
  }

  const risks: AccessStatsDto["risks"] = [];

  /**
   * 気になる動きを1つ足す。
   * しきい値に届かないものは足さない。何でも並べると、本当に見るべき行が埋もれる。
   */
  const addRisk = (kind: AccessRiskKind, entries: [string, number][], min = 1) => {
    const hit = entries.filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]);
    if (hit.length === 0) return;
    risks.push({
      kind,
      count: hit.reduce((s, [, c]) => s + c, 0),
      samples: hit.slice(0, 3).map(([k, c]) => `${k}（${c}回）`),
    });
  };

  addRisk(
    "repeatedFailure",
    [...failedByIp.entries()].map(([ip, c]): [string, number] => [`${ip}${place(ip)}`, c]),
    REPEATED_FAILURE,
  );
  addRisk("unknownAccount", [...unknownAccounts.entries()]);
  addRisk("lockout", [...lockoutWho.entries()]);
  addRisk("foreignLogin", [...foreignLogins.entries()]);
  if (nightLogins > 0) {
    risks.push({
      kind: "nightLogin",
      count: nightLogins,
      samples: [...nightWho.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, c]) => `${k}（${c}回）`),
    });
  }
  addRisk(
    "bulkView",
    [...viewsByUserDay.entries()].map(([k, c]): [string, number] => {
      const [name, day] = k.split("\t");
      return [`${name}（${day}）`, c];
    }),
    BULK_VIEW,
  );
  risks.sort((a, b) => b.count - a.count);

  const byCount = <T>(m: Map<string, T>, value: (v: T) => number) =>
    [...m.entries()].sort((a, b) => value(b[1]) - value(a[1])).slice(0, TOP_N);

  const stats: AccessStatsDto = {
    days,
    totals,
    byHour,
    topFailedUsers: byCount(failedByEmail, (v) => v).map(([email, count]) => ({ email, count })),
    topFailedIps: byCount(failedByIp, (v) => v).map(([ip, count]) => ({
      ip,
      country: countryOf(ip),
      count,
    })),
    topViewers: byCount(viewsByUser, (v) => v.count).map(([name, v]) => ({
      name,
      count: v.count,
      lines: v.lines,
    })),
    risks,
  };
  return Response.json(stats);
}

/** 国が分かるときだけ、括弧で添える */
function place(ip: string): string {
  const c = countryOf(ip);
  return c && c !== "local" ? `（${c}）` : "";
}
