import {
  DEFAULT_SETTINGS,
  ipMatchesAny,
  SETTING_DEFS,
  type IpFilterMode,
  type IpRuleEntry,
} from "@chem/shared";
import { prisma } from "@/lib/db";

/**
 * 画面（システム設定）で決める「接続元IPアドレスの制限」（2026-10-02）。
 *
 * 入口（middleware）が要求のたびに見るので、DB は 10 秒に 1 回だけ読む。
 * 保存してから効くまで最大 10 秒かかる（画面にもそう書いてある）。
 *
 * 環境変数 `ALLOWED_IPS` による制限（middleware の checkIp）とは別にある。
 * 両方を通ったものだけが入れる。環境変数のほうはサーバーを置く人の決まり、
 * こちらはシステム管理者が画面から決める決まり。
 *
 * **締め出されたときの戻り道**: 環境変数 `IP_RULES_OFF=1` を入れて起動し直すと、
 * 画面の設定を見なくなる（DB の値は消えない）。入れたら画面で直し、外して起動し直す
 */
export interface IpFilterRules {
  mode: IpFilterMode;
  allow: string[];
  deny: string[];
}

const TTL_MS = 10_000;
const KEYS = ["ipFilterMode", "ipAllowList", "ipDenyList"] as const;

let cached: { at: number; rules: IpFilterRules } | null = null;

/** いまの決まり。読めなければ「使わない」として扱う（DB が止まったとき全員を締め出さないため） */
export async function loadIpFilterRules(): Promise<IpFilterRules> {
  if (process.env.IP_RULES_OFF === "1") return { mode: "off", allow: [], deny: [] };
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rules;
  let rules: IpFilterRules = { mode: "off", allow: [], deny: [] };
  try {
    const defs = SETTING_DEFS.filter((d) => (KEYS as readonly string[]).includes(d.field));
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: defs.map((d) => d.key) } },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const value = <K extends (typeof KEYS)[number]>(field: K) => {
      const def = defs.find((d) => d.field === field)!;
      const raw = byKey.get(def.key);
      const parsed = raw == null ? null : def.parse(raw);
      return (parsed ?? DEFAULT_SETTINGS[field]) as (typeof DEFAULT_SETTINGS)[K];
    };
    const addresses = (list: IpRuleEntry[]) => list.map((e) => e.address);
    rules = {
      mode: value("ipFilterMode"),
      allow: addresses(value("ipAllowList")),
      deny: addresses(value("ipDenyList")),
    };
  } catch {
    // 読めなかったときは前の決まりがあればそれを使い続ける。無ければ「使わない」
    if (cached) return cached.rules;
  }
  cached = { at: Date.now(), rules };
  return rules;
}

/**
 * 通してよいか。
 *
 * - 使わない … 通す
 * - 許可リスト … 載っていれば通す。相手が分からなければ断る。**リストが空なら通す**
 *   （保存の時点で空は断っているが、DB を手で書き換えた等で空になっても全員を締め出さない）
 * - 拒否リスト … 載っていれば断る。相手が分からなければ通す
 */
export function ipRulesAllow(ip: string | null, rules: IpFilterRules): boolean {
  if (rules.mode === "allow") {
    if (rules.allow.length === 0) return true;
    return ip !== null && ipMatchesAny(ip, rules.allow);
  }
  if (rules.mode === "deny") return ip === null || !ipMatchesAny(ip, rules.deny);
  return true;
}
