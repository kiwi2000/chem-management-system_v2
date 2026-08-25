import { describe, expect, it } from "vitest";
import { countryOf } from "./ip-country";

/**
 * 接続元のおよその国。
 *
 * 表が壊れていたり読み違えていたりすると、静かに間違った国を出す。
 * それは「見慣れない国から入られていないか」を見る目的をそのまま損なうので、
 * 分かっている代表的なアドレスで確かめる。
 */
describe("接続元の国", () => {
  it("よく知られたアドレスの国が出る", () => {
    // Google の公開DNS（アメリカ）
    expect(countryOf("8.8.8.8")).toBe("US");
    // 日本の回線から出たもの（このPCの外向きアドレス）
    expect(countryOf("116.82.36.27")).toBe("JP");
  });

  it("並んでいるときは先頭を見る", () => {
    expect(countryOf("116.82.36.27, 10.0.0.1")).toBe("JP");
  });

  it("自分自身は local", () => {
    expect(countryOf("::1")).toBe("local");
    expect(countryOf("127.0.0.1")).toBe("local");
  });

  it("IPv6 でも国が出る", () => {
    // Google の公開DNS（IPv6・アメリカ）
    expect(countryOf("2001:4860:4860::8888")).toBe("US");
  });

  it("IPv4 を IPv6 の書き方で渡しても、中身で判定する", () => {
    expect(countryOf("::ffff:8.8.8.8")).toBe("US");
  });

  it("社内で使う私設アドレスは、分からないとして返す", () => {
    // 割り当て表に載らない範囲。ここで適当な国を返すと嘘になる
    for (const ip of ["192.168.1.1", "10.0.0.5", "172.16.0.1"]) {
      expect(countryOf(ip)).toBeNull();
    }
  });

  it("形の壊れたものは、分からないとして返す", () => {
    for (const bad of ["", "abc", "999.1.1.1", "1.2.3", "1.2.3.4.5", ":::", "1.2.3.4:80x"]) {
      expect(countryOf(bad)).toBeNull();
    }
    expect(countryOf(null)).toBeNull();
  });

  it("同じ数に見せる細工を通さない", () => {
    // 08 は8進数の書き方。素直に数えると別のアドレスになる
    expect(countryOf("008.8.8.8")).toBeNull();
  });
});
