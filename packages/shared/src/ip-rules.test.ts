import { describe, expect, it } from "vitest";
import { ipMatchesAny, ipMatchesRule, isValidIpRule, parseIp, parseIpRule } from "./ip-rules";

/**
 * 画面で決める接続元の制限の、アドレスと決まりの読み取り。
 * ここが狂うと全員を締め出すか、断るはずの相手を通すので、境目を細かく確かめる
 */
describe("IP アドレスの読み取り", () => {
  it("IPv4 を読む", () => {
    expect(parseIp("203.0.113.5")).toEqual({ family: 4, value: 0xcb007105n });
  });
  it("8 進数に見える書き方や 1 つの数は断る", () => {
    expect(parseIp("010.0.0.1")).toBeNull();
    expect(parseIp("3232235777")).toBeNull();
    expect(parseIp("256.0.0.1")).toBeNull();
  });
  it("IPv6 の省略を読む", () => {
    expect(parseIp("2001:db8::1")?.value).toBe(0x20010db8000000000000000000000001n);
    expect(parseIp("::1")?.value).toBe(1n);
    expect(parseIp("2001:db8:0:0:0:0:0:1")?.value).toBe(parseIp("2001:db8::1")?.value);
  });
  it("IPv4 を包んだ IPv6 は IPv4 として扱う", () => {
    expect(parseIp("::ffff:203.0.113.5")).toEqual(parseIp("203.0.113.5"));
  });
  it("壊れた IPv6 は断る", () => {
    expect(parseIp("2001:db8::1::2")).toBeNull();
    expect(parseIp("2001:db8:1:2:3:4:5:6:7")).toBeNull();
    expect(parseIp("2001:zz8::1")).toBeNull();
  });
});

describe("決まりの読み取り", () => {
  it("アドレス・範囲（IPv4・IPv6）を読む", () => {
    expect(isValidIpRule("203.0.113.5")).toBe(true);
    expect(isValidIpRule("203.0.113.0/24")).toBe(true);
    expect(isValidIpRule("2001:db8:1234::/48")).toBe(true);
  });
  it("幅を超える範囲や壊れた書き方は断る", () => {
    expect(isValidIpRule("203.0.113.0/33")).toBe(false);
    expect(isValidIpRule("2001:db8::/129")).toBe(false);
    expect(isValidIpRule("203.0.113.0/")).toBe(false);
    expect(isValidIpRule("example.com")).toBe(false);
    expect(isValidIpRule("")).toBe(false);
  });
  it("1 つのアドレスは幅いっぱいの範囲として読む", () => {
    expect(parseIpRule("203.0.113.5")?.bits).toBe(32);
    expect(parseIpRule("2001:db8::1")?.bits).toBe(128);
  });
});

describe("当てはまるか", () => {
  it("IPv4 の範囲の境目", () => {
    expect(ipMatchesRule("203.0.113.0", "203.0.113.0/24")).toBe(true);
    expect(ipMatchesRule("203.0.113.255", "203.0.113.0/24")).toBe(true);
    expect(ipMatchesRule("203.0.114.0", "203.0.113.0/24")).toBe(false);
    expect(ipMatchesRule("203.0.112.255", "203.0.113.0/24")).toBe(false);
  });
  it("範囲の書き出しが途中のアドレスでも、範囲として扱う", () => {
    expect(ipMatchesRule("203.0.113.9", "203.0.113.77/24")).toBe(true);
  });
  it("IPv6 の範囲（回線ごとに配られる /48・/64）", () => {
    expect(ipMatchesRule("2001:db8:1234:5::abcd", "2001:db8:1234::/48")).toBe(true);
    expect(ipMatchesRule("2001:db8:1235::1", "2001:db8:1234::/48")).toBe(false);
  });
  it("IPv4 と IPv6 は混ぜない", () => {
    expect(ipMatchesRule("203.0.113.5", "::/0")).toBe(false);
    expect(ipMatchesRule("2001:db8::1", "0.0.0.0/0")).toBe(false);
  });
  it("/0 はすべて、1 つのアドレスはそれだけ", () => {
    expect(ipMatchesRule("198.51.100.1", "0.0.0.0/0")).toBe(true);
    expect(ipMatchesRule("203.0.113.5", "203.0.113.5")).toBe(true);
    expect(ipMatchesRule("203.0.113.6", "203.0.113.5")).toBe(false);
  });
  it("読めない決まり・アドレスは当てはまらない", () => {
    expect(ipMatchesAny("203.0.113.5", ["nonsense", "203.0.113.0/40"])).toBe(false);
    expect(ipMatchesAny("not-an-ip", ["0.0.0.0/0"])).toBe(false);
  });
});
