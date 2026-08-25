import { describe, expect, it } from "vitest";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";

/**
 * 2要素認証の6桁。
 *
 * ここが狂うと、正しい人が入れなくなるか、間違った数字で入れてしまう。
 * 外部の仕様（RFC 6238）に沿っているかを、既知の値で確かめる。
 */
describe("TOTP", () => {
  it("RFC 6238 の例と同じ数字を出す", () => {
    // RFC 6238 の付録B。鍵は "12345678901234567890"（ASCII 20バイト）を Base32 にしたもの。
    // 付録の答えは8桁なので、6桁のここでは下6桁を見る
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const cases: [number, string][] = [
      [59, "287082"], // 付録の 94287082
      [1111111109, "081804"], // 付録の 07081804
      [1111111111, "050471"], // 付録の 14050471
      [1234567890, "005924"], // 付録の 89005924
      [2000000000, "279037"], // 付録の 69279037
    ];
    const real = Date.now;
    try {
      for (const [seconds, code] of cases) {
        Date.now = () => seconds * 1000;
        expect(verifyTotp(secret, code)).toBe(true);
      }
    } finally {
      Date.now = real;
    }
  });

  it("作った鍵で、いまの数字が通る", () => {
    const secret = generateTotpSecret();
    // 実装と同じ手順で「いまの数字」を作り、それが通ることを見る
    const now = Math.floor(Date.now() / 1000 / 30);
    const code = codeFor(secret, now);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("時計が30秒ずれていても通す", () => {
    const secret = generateTotpSecret();
    const now = Math.floor(Date.now() / 1000 / 30);
    expect(verifyTotp(secret, codeFor(secret, now - 1))).toBe(true);
    expect(verifyTotp(secret, codeFor(secret, now + 1))).toBe(true);
  });

  it("2つ以上ずれた数字は通さない", () => {
    const secret = generateTotpSecret();
    const now = Math.floor(Date.now() / 1000 / 30);
    expect(verifyTotp(secret, codeFor(secret, now - 3))).toBe(false);
    expect(verifyTotp(secret, codeFor(secret, now + 3))).toBe(false);
  });

  it("形が違うものは通さない", () => {
    const secret = generateTotpSecret();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", "０１２３４５"]) {
      expect(verifyTotp(secret, bad)).toBe(false);
    }
  });

  it("別の鍵の数字は通さない", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    const now = Math.floor(Date.now() / 1000 / 30);
    expect(verifyTotp(a, codeFor(b, now))).toBe(false);
  });

  it("認証アプリに渡すURIに、鍵と桁数と周期が入っている", () => {
    const secret = generateTotpSecret();
    const uri = totpUri(secret, "taro@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    // メールアドレスの @ はそのまま置かない（URIとして壊れるため）
    expect(uri).toContain("taro%40example.com");
  });
});

/** 検証と同じ計算で、指定の時間帯の数字を作る（試験用） */
function codeFor(secret: string, counter: number): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const bin =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}
