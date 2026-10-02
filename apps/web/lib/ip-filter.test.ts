import { describe, expect, it } from "vitest";
import { ipRulesAllow, type IpFilterRules } from "./ip-filter";

/** 画面で決める接続元の制限の、通す・断るの判定 */
describe("画面で決める接続元の制限", () => {
  const rules = (mode: IpFilterRules["mode"], allow: string[] = [], deny: string[] = []) => ({
    mode,
    allow,
    deny,
  });

  it("使わないなら、だれでも通す", () => {
    expect(ipRulesAllow("198.51.100.1", rules("off", [], ["198.51.100.1"]))).toBe(true);
    expect(ipRulesAllow(null, rules("off"))).toBe(true);
  });

  it("許可リスト: 載っていれば通し、載っていなければ断る", () => {
    const r = rules("allow", ["203.0.113.0/24"]);
    expect(ipRulesAllow("203.0.113.9", r)).toBe(true);
    expect(ipRulesAllow("198.51.100.1", r)).toBe(false);
  });

  it("許可リスト: 相手が分からなければ断る", () => {
    expect(ipRulesAllow(null, rules("allow", ["203.0.113.0/24"]))).toBe(false);
  });

  it("許可リスト: リストが空なら全員を締め出さず通す", () => {
    expect(ipRulesAllow("198.51.100.1", rules("allow", []))).toBe(true);
  });

  it("許可リスト: 拒否リストの中身は見ない", () => {
    expect(ipRulesAllow("203.0.113.9", rules("allow", ["203.0.113.9"], ["203.0.113.9"]))).toBe(
      true,
    );
  });

  it("拒否リスト: 載っていれば断り、載っていなければ通す", () => {
    const r = rules("deny", [], ["198.51.100.0/24", "2001:db8::/32"]);
    expect(ipRulesAllow("198.51.100.7", r)).toBe(false);
    expect(ipRulesAllow("2001:db8:5::1", r)).toBe(false);
    expect(ipRulesAllow("203.0.113.9", r)).toBe(true);
  });

  it("拒否リスト: 相手が分からなければ通す", () => {
    expect(ipRulesAllow(null, rules("deny", [], ["198.51.100.0/24"]))).toBe(true);
  });
});
