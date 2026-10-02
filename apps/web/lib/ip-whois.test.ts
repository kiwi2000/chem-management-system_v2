import { describe, expect, it } from "vitest";
import { hexKey, parseJpnic } from "./ip-whois";

/** JPNIC の返事の読み取り（実物の形をそのまま使う。2026-10-02 に問い合わせて確かめた形） */
describe("JPNIC の WHOIS の読み取り", () => {
  it("IPv4 は行頭に記号が付く形", () => {
    const text = [
      "[ JPNIC database provides information regarding IP address and ASN. Its use   ]",
      "Network Information:            [ネットワーク情報]",
      "a. [IPネットワークアドレス]     1.0.16.0/24",
      "b. [ネットワーク名]             I2TS-MTK-NET",
      "f. [組織名]                     株式会社イーツ",
      "g. [Organization]               i2ts,inc.",
      "m. [管理者連絡窓口]             JP00078611",
      "[割当年月日]                    2018/01/22",
      "上位情報",
      "----------",
      "株式会社イーツ (i2ts,inc.)",
      "  [割り振り]   1.0.16.0/20",
    ].join("\n");
    expect(parseJpnic(text)).toEqual({
      network: "1.0.16.0/24",
      networkName: "I2TS-MTK-NET",
      orgJa: "株式会社イーツ",
      orgEn: "i2ts,inc.",
    });
  });

  it("IPv6 は行頭の記号が無い形。上位情報の範囲は読まない", () => {
    const text = [
      "Network Information: [ネットワーク情報]",
      "[IPネットワークアドレス]        240b::/26",
      "[ネットワーク名]                JPNE-IP6-003",
      "[組織名]                        株式会社JPIX",
      "[Organization]                  Japan Internet Xing Co., Ltd.",
      "上位情報",
      "----------",
      "                     [割り振り]                                      240b::/24",
    ].join("\r\n");
    expect(parseJpnic(text)).toEqual({
      network: "240b::/26",
      networkName: "JPNE-IP6-003",
      orgJa: "株式会社JPIX",
      orgEn: "Japan Internet Xing Co., Ltd.",
    });
  });

  it("データが無いときは null", () => {
    expect(parseJpnic("該当するデータがありません。\n  参考：RIRのWHOISサーバ")).toBeNull();
  });
});

describe("範囲の端の文字列", () => {
  it("桁をそろえるので、文字列の大小がアドレスの大小になる", () => {
    expect(hexKey(4, 0x01001000n)).toBe("01001000");
    expect(hexKey(4, 0x09ffffffn) < hexKey(4, 0x0a000000n)).toBe(true);
    expect(hexKey(6, 1n)).toHaveLength(32);
  });
});
