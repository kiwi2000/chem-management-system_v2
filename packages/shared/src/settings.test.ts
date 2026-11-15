import { describe, expect, it } from "vitest";
import { getMessages } from "./i18n";
import { DEFAULT_SETTINGS, settingsSaveSchema } from "./settings";

/**
 * 設定の保存の検証で、入れた値を織り込んで作る誤りの文。
 * 検証の部品（zod）を 3 系から 4 系へ上げたとき、値を見て文を作る書き方が無くなり、
 * 試験は全部通るのに文だけが英語の「Invalid input」に変わった（2026-11-15）。文面と、付く項目を固定しておく
 */
const m = getMessages("ja");

const errorsOf = (override: Record<string, unknown>) => {
  const r = settingsSaveSchema(m).safeParse({ ...DEFAULT_SETTINGS, ...override });
  return r.success ? null : r.error.flatten().fieldErrors;
};

describe("設定の保存の検証", () => {
  it("既定の値はそのまま通る", () => {
    expect(errorsOf({})).toBeNull();
  });

  it("読めない IP アドレスは、その値を添えて断る（許可・拒否のどちらのリストでも）", () => {
    expect(errorsOf({ ipAllowList: [{ address: "999.1.1.1", note: "" }] })).toEqual({
      ipAllowList: ["「999.1.1.1」はIPアドレスまたは範囲として読めません"],
    });
    expect(errorsOf({ ipDenyList: [{ address: "abc", note: "" }] })).toEqual({
      ipDenyList: ["「abc」はIPアドレスまたは範囲として読めません"],
    });
  });

  it("IP アドレスが空なら、必須の文が先に出る", () => {
    expect(errorsOf({ ipAllowList: [{ address: " ", note: "" }] })).toEqual({
      ipAllowList: [m.validation.required, "「」はIPアドレスまたは範囲として読めません"],
    });
  });

  it("ファイル名の付け方に使えない差込みがあれば、その名前を添えて断る", () => {
    expect(errorsOf({ documentFileNamePattern: "{code}_{nope}" })).toEqual({
      documentFileNamePattern: ["使えない差込みがあります: nope"],
    });
  });

  it("書けない拡張子があれば、その拡張子を添えて断る", () => {
    expect(errorsOf({ attachmentExtensions: ["pdf", "x y", "toolongextension"] })).toEqual({
      attachmentExtensions: ["書けない拡張子があります: x y, toolongextension（英数字 10 字まで）"],
    });
  });
});
