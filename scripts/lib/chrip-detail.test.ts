import { describe, expect, it } from "vitest";
import { parseDetail } from "./chrip-detail.mjs";

/** 詳細ページの体裁に寄せた、ごく短いHTMLを組み立てる */
function page(body: string) {
  return `<dl><dt>CHRIP_ID</dt><dd>C004-709-00A</dd>
<dt>CAS RN</dt><dd>131-52-2</dd>
<dt>日本語名</dt><dd>ペンタクロロフェノール</dd>
<dt>英語名</dt><dd>Pentachlorophenol</dd></dl>${body}`;
}

describe("parseDetail", () => {
  it("情報源ごとに中身を取り出す", () => {
    const d = parseDetail(
      page(`<h3>毒物及び劇物取締法</h3><dl>
        <dt>法律又は政令番号</dt><dd>法別表第1の10</dd>
        <dt>法律又は政令名称</dt><dd>シアン化水素</dd></dl>`),
    );
    expect(d.cas).toBe("131-52-2");
    expect(d.entries).toHaveLength(1);
    // 呼び方の違う項目名は、政令番号・政令名称に寄せる
    expect(d.entries[0].fields["政令番号"]).toBe("法別表第1の10");
    expect(d.entries[0].fields["政令名称"]).toBe("シアン化水素");
  });

  it("1つの情報源に記載が2つ並んでいたら、2つに分ける", () => {
    const d = parseDetail(
      page(`<h3>大気汚染防止法</h3><dl>
        <dt>分類</dt><dd>有害大気汚染物質に該当する可能性がある物質</dd>
        <dt>政令番号</dt><dd>中環審第9次答申(別表1)の49</dd>
        <dt>政令名称</dt><dd>クロム及びその化合物</dd>
        <dt>分類</dt><dd>有害大気汚染物質に該当する可能性がある物質（優先取組物質）</dd>
        <dt>政令番号</dt><dd>中環審第9次答申(別表2)の5</dd>
        <dt>政令名称</dt><dd>クロム及び三価クロム化合物</dd></dl>`),
    );
    expect(d.entries).toHaveLength(2);
    expect(d.entries.map((e) => e.fields["政令番号"])).toEqual([
      "中環審第9次答申(別表1)の49",
      "中環審第9次答申(別表2)の5",
    ]);
    // 後ろの記載が前を上書きしない
    expect(d.entries[0].fields["政令名称"]).toBe("クロム及びその化合物");
  });

  it("韓国の項目名も拾う", () => {
    const d = parseDetail(
      page(`<h3>韓国：化評法( K-REACH)／化管法：有害化学物質、重点管理物質</h3><dl>
        <dt>NIER番号</dt><dd>06-4-49</dd>
        <dt>カテゴリ</dt><dd>Prohibited Substances</dd>
        <dt>化学物質名称</dt><dd>Pentachlorophenol and its salts</dd>
        <dt>対象となる範囲（％）</dt><dd>&gt;=1</dd>
        <dt>NIER番号</dt><dd>97-1-339</dd>
        <dt>カテゴリ</dt><dd>Toxic Substances</dd>
        <dt>化学物質名称</dt><dd>Pentachlorophenol and its salts</dd>
        <dt>対象となる範囲（％）</dt><dd>Acutely:1%, Environment:25%</dd></dl>`),
    );
    expect(d.entries).toHaveLength(2);
    expect(d.entries[0].fields["カテゴリ"]).toBe("Prohibited Substances");
    expect(d.entries[0].fields["対象となる範囲（％）"]).toBe(">=1");
    expect(d.entries[1].fields["NIER番号"]).toBe("97-1-339");
    expect(d.entries[1].fields["対象となる範囲（％）"]).toBe("Acutely:1%, Environment:25%");
  });

  it("情報源が変われば、同じ項目名でも別の記載になる", () => {
    const d = parseDetail(
      page(`<h3>大気汚染防止法</h3><dl>
        <dt>政令番号</dt><dd>政令第1条第4号</dd></dl>
      <h3>水質汚濁防止法</h3><dl>
        <dt>政令番号</dt><dd>政令第2条第4号</dd></dl>`),
    );
    expect(d.entries.map((e) => e.source)).toEqual(["大気汚染防止法", "水質汚濁防止法"]);
  });

  it("値が空の項目は落とす", () => {
    const d = parseDetail(
      page(`<h3>大気汚染防止法</h3><dl>
        <dt>政令番号</dt><dt>政令名称</dt><dd>鉛及びその化合物</dd></dl>`),
    );
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0].fields["政令番号"]).toBeUndefined();
    expect(d.entries[0].fields["政令名称"]).toBe("鉛及びその化合物");
  });
});
