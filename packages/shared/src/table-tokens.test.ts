import { describe, expect, it } from "vitest";
import { splitNumericTokens, splitTextTokens } from "./table";

describe("splitNumericTokens（CAS 番号などの複数入力）", () => {
  it("改行・カンマ・空白で分け、空と重複を落とす", () => {
    expect(splitNumericTokens("7439-92-1\n1317-36-8, 7439-92-1  50-00-0")).toEqual([
      "7439-92-1",
      "1317-36-8",
      "50-00-0",
    ]);
  });

  it("文章からコピーしたハイフンの仲間（改行しないハイフン・全角・長音）は普通のハイフンにして 1 つの値に保つ", () => {
    expect(splitNumericTokens("1317‑36‑8")).toEqual(["1317-36-8"]);
    expect(splitNumericTokens("1317－36－8")).toEqual(["1317-36-8"]);
    expect(splitNumericTokens("1317−36−8 7439–92–1")).toEqual(["1317-36-8", "7439-92-1"]);
  });

  it("前後のハイフンは落とす", () => {
    expect(splitNumericTokens("-1317-36-8-")).toEqual(["1317-36-8"]);
  });
});

describe("splitTextTokens（名前などの複数入力）", () => {
  it("改行・カンマ・読点・セミコロンで分け、ハイフンやスペースは値の一部のまま", () => {
    expect(splitTextTokens("トルエン、2-プロパノール\nn-ヘキサン; toluene")).toEqual([
      "トルエン",
      "2-プロパノール",
      "n-ヘキサン",
      "toluene",
    ]);
  });
});
