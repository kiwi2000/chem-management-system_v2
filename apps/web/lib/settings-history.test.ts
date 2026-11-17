import { DEFAULT_SETTINGS, SETTING_DEFS, getMessages } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { settingName } from "@/lib/setting-names";
import { previousOf, settingChanges } from "@/lib/settings-history";

/**
 * システム設定の変更をアクセス記録に出す（2026-11-17 利用者の指示）。
 * 前は、だれがいつ何を変えたかが DB には残るのに、どの画面からも見られなかった
 * （「2要素認証を必須にする」をだれが入にしたかを、画面では確かめられなかった）
 */
describe("システム設定の保存の記録から、変えた項目を出す", () => {
  const base = { ...DEFAULT_SETTINGS } as Record<string, unknown>;

  it("入切の項目は、前と後の値を出す", () => {
    expect(settingChanges(base, { ...base, mfaRequired: true })).toEqual([
      { field: "mfaRequired", kind: "bool", from: false, to: true },
    ]);
  });

  it("数の項目は、前と後の数を出す", () => {
    expect(settingChanges(base, { ...base, sessionIdleMinutes: 45 })).toEqual([
      {
        field: "sessionIdleMinutes",
        kind: "number",
        from: DEFAULT_SETTINGS.sessionIdleMinutes,
        to: 45,
      },
    ]);
  });

  it("文字・一覧の項目は、変えたことだけを出す（値は出さない）", () => {
    expect(settingChanges(base, { ...base, appNameJa: "別の名前" })).toEqual([
      { field: "appNameJa", kind: "other", from: null, to: null },
    ]);
    expect(
      settingChanges(base, { ...base, ipAllowList: [{ address: "192.0.2.1", note: "" }] }),
    ).toEqual([{ field: "ipAllowList", kind: "other", from: null, to: null }]);
  });

  it("何も変えずに保存した記録は、空", () => {
    expect(settingChanges(base, { ...base })).toEqual([]);
  });

  it("最初の保存と、前の記録に無い項目は、最初の値と比べる", () => {
    // 最初の保存（前の記録なし）
    expect(settingChanges(null, { ...base, casRequired: !DEFAULT_SETTINGS.casRequired })).toEqual([
      {
        field: "casRequired",
        kind: "bool",
        from: DEFAULT_SETTINGS.casRequired,
        to: !DEFAULT_SETTINGS.casRequired,
      },
    ]);
    // 前の記録には、まだその設定が無かった
    const old = { ...base };
    delete old.mfaRequired;
    expect(settingChanges(old, { ...base, mfaRequired: true })).toEqual([
      { field: "mfaRequired", kind: "bool", from: false, to: true },
    ]);
    expect(settingChanges(old, { ...base, mfaRequired: false })).toEqual([]);
  });

  it("その保存に入っていない項目は、変えたことにしない（設定でない値は見ない）", () => {
    const partial = { mfaRequired: false, ip: "192.0.2.9", userAgent: "x", endedSessions: 3 };
    expect(settingChanges(base, partial)).toEqual([]);
  });

  it("1 つ前の保存は、古い順の並びで決める", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const prev = previousOf(rows);
    expect(prev.get("a")).toBeNull();
    expect(prev.get("b")).toEqual({ id: "a" });
    expect(prev.get("c")).toEqual({ id: "b" });
  });
});

describe("設定の項目の呼び名", () => {
  it("全部の項目に、日本語と英語の呼び名がある（項目を足したら setting-names.ts にも足す）", () => {
    for (const locale of ["ja", "en"] as const) {
      const m = getMessages(locale);
      for (const def of SETTING_DEFS) {
        const name = settingName(m, def.field);
        expect(name, `${locale} ${def.field}`).not.toBe(def.field);
        expect(name.trim().length, `${locale} ${def.field}`).toBeGreaterThan(0);
        expect(name, `${locale} ${def.field}`).not.toContain("undefined");
      }
    }
  });

  it("何の設定か分かるよう、見出しを前に付ける", () => {
    const m = getMessages("ja");
    expect(settingName(m, "passwordMinLength")).toBe("パスワード規則 › 最小の文字数");
    expect(settingName(m, "mfaRequired")).toBe("2要素認証（認証アプリまたはパスキー）を必須にする");
  });

  it("知らない名前（古い記録にだけ残っているもの）は、そのまま返す", () => {
    expect(settingName(getMessages("ja"), "someRemovedSetting")).toBe("someRemovedSetting");
  });
});
