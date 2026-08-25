import { describe, expect, it } from "vitest";
import { clientIp, ipVerdict, parseAllowList } from "./ip-allow";

/**
 * 決まった場所からだけ入れるようにする判定。
 *
 * ここが狂うと、全員が締め出されるか、誰でも入れてしまう。
 * どちらも取り返しがつかないので、境目を細かく確かめる。
 */
describe("接続元の判定", () => {
  describe("相手のアドレスを取り出す", () => {
    it("並んでいるときは先頭を見る（Railway の入口が「相手, 中継」の順で渡すため）", () => {
      expect(clientIp("116.82.36.27, 152.233.33.164")).toBe("116.82.36.27");
    });

    it("1つだけのときはそのまま", () => {
      expect(clientIp("203.0.113.9")).toBe("203.0.113.9");
    });

    it("接続口の番号が付いていても落とす", () => {
      expect(clientIp("203.0.113.9:51234")).toBe("203.0.113.9");
      expect(clientIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    });

    it("無いときは null", () => {
      expect(clientIp(null)).toBeNull();
      expect(clientIp("")).toBeNull();
      expect(clientIp("  ,  ")).toBeNull();
    });
  });

  describe("許可リストの読み取り", () => {
    it("カンマでも空白でも改行でも区切れる", () => {
      expect(parseAllowList("203.0.113.9, 198.51.100.0/24\n192.0.2.1")).toEqual([
        "203.0.113.9",
        "198.51.100.0/24",
        "192.0.2.1",
      ]);
    });

    it("未設定・空・空白だけなら空になる", () => {
      expect(parseAllowList(undefined)).toEqual([]);
      expect(parseAllowList("")).toEqual([]);
      expect(parseAllowList("  , , ")).toEqual([]);
    });
  });

  describe("通してよいかの判定", () => {
    it("許可リストが空なら制限しない（設定を誤ったときの戻り道）", () => {
      expect(ipVerdict("203.0.113.9", [])).toBe("off");
      expect(ipVerdict(null, [])).toBe("off");
    });

    it("載っているアドレスは通す", () => {
      expect(ipVerdict("203.0.113.9", ["203.0.113.9"])).toBe("allow");
      expect(ipVerdict("192.0.2.1", ["203.0.113.9", "192.0.2.1"])).toBe("allow");
    });

    it("載っていないアドレスは断る", () => {
      expect(ipVerdict("203.0.113.10", ["203.0.113.9"])).toBe("deny");
    });

    it("相手が分からないときは断る", () => {
      expect(ipVerdict(null, ["203.0.113.9"])).toBe("deny");
    });

    it("範囲の書き方に対応する", () => {
      const list = ["198.51.100.0/24"];
      expect(ipVerdict("198.51.100.1", list)).toBe("allow");
      expect(ipVerdict("198.51.100.255", list)).toBe("allow");
      expect(ipVerdict("198.51.101.1", list)).toBe("deny");
    });

    it("範囲の境目を間違えない", () => {
      // /29 は 8個ぶん。198.51.100.8〜15 だけが入る
      const list = ["198.51.100.8/29"];
      expect(ipVerdict("198.51.100.7", list)).toBe("deny");
      expect(ipVerdict("198.51.100.8", list)).toBe("allow");
      expect(ipVerdict("198.51.100.15", list)).toBe("allow");
      expect(ipVerdict("198.51.100.16", list)).toBe("deny");
    });

    it("/32 は1つだけ、/0 はすべて", () => {
      expect(ipVerdict("203.0.113.9", ["203.0.113.9/32"])).toBe("allow");
      expect(ipVerdict("203.0.113.10", ["203.0.113.9/32"])).toBe("deny");
      expect(ipVerdict("203.0.113.10", ["0.0.0.0/0"])).toBe("allow");
    });

    it("IPv6 はそのまま照らし合わせる", () => {
      expect(ipVerdict("2001:db8::1", ["2001:DB8::1"])).toBe("deny");
      expect(ipVerdict("2001:db8::1", parseAllowList("2001:DB8::1"))).toBe("allow");
    });

    it("形の壊れた決まりで、うっかり通さない", () => {
      for (const bad of ["198.51.100.0/33", "198.51.100.0/x", "abc/24", "198.51.100/24"]) {
        expect(ipVerdict("198.51.100.1", [bad])).toBe("deny");
      }
    });

    it("IPv4 の書かれかたが違うだけのものを通さない（8進数などのごまかし）", () => {
      expect(ipVerdict("0203.0.113.9", ["203.0.113.9"])).toBe("deny");
      expect(ipVerdict("203.0.113.009", ["203.0.113.9"])).toBe("deny");
    });
  });
});
