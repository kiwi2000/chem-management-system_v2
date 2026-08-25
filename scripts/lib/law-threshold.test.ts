import { describe, expect, it } from "vitest";
import { kanjiToNumber, normalizeName, parseExclusion, sameSubstance } from "./law-threshold";

/**
 * 但し書きから閾値を取り出すところ。
 *
 * ここが狂うと、**該当するものを「該当しない」と答える**。
 * 画面には正しい但し書きが出ているので、間違いに気づけない。
 * 実際の毒物及び劇物指定令の条文から取った文で確かめる。
 */
describe("漢数字", () => {
  it("小数点つきを読む", () => {
    expect(kanjiToNumber("〇・一")).toBe(0.1);
    expect(kanjiToNumber("一・八")).toBe(1.8);
    expect(kanjiToNumber("四七・五")).toBe(47.5);
    expect(kanjiToNumber("〇・〇〇八二")).toBe(0.0082);
    expect(kanjiToNumber("〇・〇〇〇一一")).toBe(0.00011);
  });

  it("桁を並べた書き方を読む（三〇＝30、一二＝12）", () => {
    expect(kanjiToNumber("三〇")).toBe(30);
    expect(kanjiToNumber("一二")).toBe(12);
    expect(kanjiToNumber("二五")).toBe(25);
    expect(kanjiToNumber("四〇")).toBe(40);
    expect(kanjiToNumber("五")).toBe(5);
  });

  it("位取りの書き方は読まない（黙って別の数にしない）", () => {
    // 「十」を1文字1桁で読むと別の数になる。気づける形で止める
    expect(kanjiToNumber("十")).toBeNull();
    expect(kanjiToNumber("三十五")).toBeNull();
    expect(kanjiToNumber("百")).toBeNull();
  });

  it("形の壊れたものは読まない", () => {
    for (const bad of ["", "・", "〇・一・二", "あ", "五％"]) {
      expect(kanjiToNumber(bad)).toBeNull();
    }
  });
});

describe("但し書きの読み解き", () => {
  it("濃度だけのものを読む", () => {
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、アジ化ナトリウム〇・一％以下を含有するものを除く。",
    );
    expect(e.kind).toBe("simple");
    expect(e.pct).toBe(0.1);
    expect(e.subject).toBe("アジ化ナトリウム");
    expect(e.condition).toBeNull();
  });

  it("名前に数字が入っていても、濃度を取り違えない", () => {
    // 「一・一′―」は名前の一部。濃度は最後の 三・五
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、一・一′―イミノジ（オクタメチレン）ジグアニジンとして三・五％以下を含有するものを除く。",
    );
    expect(e.pct).toBe(3.5);
    expect(e.subject).toBe("一・一′―イミノジ（オクタメチレン）ジグアニジン");
  });

  it("マイクロカプセル製剤の別の境目も拾う", () => {
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、ジエチル―三・五・六―トリクロル―二―ピリジルチオホスフエイト一％（マイクロカプセル製剤にあつては、二五％）以下を含有するものを除く。",
    );
    expect(e.kind).toBe("microcapsule");
    // 厳しいほう（1％）を境目に採る。緩いほうを採ると、該当を見落とす
    expect(e.pct).toBe(1);
    expect(e.microPct).toBe(25);
  });

  it("濃度以外の条件が付くものは、条件付きとして分ける", () => {
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、硝酸タリウム〇・三％以下を含有し、黒色に着色され、かつ、トウガラシエキスを用いて著しくからく着味されているものを除く。",
    );
    expect(e.kind).toBe("conditional");
    expect(e.pct).toBe(0.3);
    expect(e.subject).toBe("硝酸タリウム");
    expect(e.condition).toContain("黒色に着色");
  });

  it("徐放性製剤に限る除外も、条件付きとして分ける", () => {
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、Ｏ―エチル＝Ｓ・Ｓ―ジプロピル＝ホスホロジチオアート三％以下を含有する徐放性製剤を除く。",
    );
    expect(e.kind).toBe("conditional");
    expect(e.pct).toBe(3);
    expect(e.condition).toContain("徐放性製剤");
  });

  it("列挙して除くものは、1つの閾値にしない", () => {
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、次に掲げるものを除く。イ アミノ塩化第二水銀及びこれを含有する製剤 ロ 塩化第一水銀及びこれを含有する製剤",
    );
    expect(e.kind).toBe("list");
    expect(e.pct).toBeNull();
  });

  it("名指しの手前に置かれた条件を、名前に混ぜない", () => {
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、容量一リツトル以下の容器に収められたものであつて、亜セレン酸〇・〇〇〇〇八二％以下を含有するものを除く。",
    );
    // 名前として扱うと突き合わせに失敗し、埋められるものが埋まらなくなる
    expect(e.subject).toBe("亜セレン酸");
    expect(e.kind).toBe("conditional");
    expect(e.condition).toContain("容量一リツトル以下の容器");
    expect(e.pct).toBe(0.000082);
  });

  it("前置きと後置きの条件が両方あるときは、両方残す", () => {
    const e = parseExclusion(
      "毒物及び劇物指定令 ただし、容量三〇〇ミリリツトル以下の容器に収められた殺虫剤であつて、クロルメチル五〇％以下を含有するものを除く。",
    );
    expect(e.subject).toBe("クロルメチル");
    expect(e.condition).toContain("殺虫剤");
    expect(e.pct).toBe(50);
  });

  it("但し書きが無ければ何も返さない", () => {
    expect(parseExclusion("毒物及び劇物指定令").kind).toBe("none");
    expect(parseExclusion(null).kind).toBe("none");
  });
});

describe("物質名の突き合わせ", () => {
  it("製剤の言い回しを落として比べる", () => {
    expect(sameSubstance("アジ化ナトリウム及びこれを含有する製剤", "アジ化ナトリウム")).toBe(true);
  });

  it("別名の括弧を落として比べる", () => {
    expect(
      sameSubstance(
        "Ｏ―エチル＝Ｓ・Ｓ―ジプロピル＝ホスホロジチオアート（別名エトプロホス）及びこれを含有する製剤",
        "Ｏ―エチル＝Ｓ・Ｓ―ジプロピル＝ホスホロジチオアート",
      ),
    ).toBe(true);
  });

  it("別の物質は、別のものとして返す", () => {
    // 水銀化合物の但し書きが名指しするのは、水銀化合物そのものではない
    expect(sameSubstance("水銀化合物及びこれを含有する製剤", "アミノ塩化第二水銀")).toBe(false);
    expect(sameSubstance("硫酸タリウム及びこれを含有する製剤", "硝酸タリウム")).toBe(false);
  });

  it("名指しが無ければ、突き合わせない", () => {
    expect(sameSubstance("アジ化ナトリウム及びこれを含有する製剤", null)).toBe(false);
  });

  it("角括弧の字が違うだけのものを、同じと見なす", () => {
    // 法文の見出しは〔〕、但し書きは［］で書かれていることがある
    expect(
      sameSubstance(
        "メチル―Ｎ′・Ｎ′―ジメチル―Ｎ―〔（メチルカルバモイル）オキシ〕―一―チオオキサムイミデート",
        "メチル―Ｎ′・Ｎ′―ジメチル―Ｎ―［（メチルカルバモイル）オキシ］―一―チオオキサムイミデート",
      ),
    ).toBe(true);
  });

  it("「及び」と「又は」の違いだけのものを、同じと見なす", () => {
    expect(
      sameSubstance(
        "水酸化トリアリール錫、その塩類及びこれらの無水物並びにこれらのいずれかを含有する製剤",
        "水酸化トリアリール錫、その塩類又はこれらの無水物",
      ),
    ).toBe(true);
  });

  it("塩の種類が違えば、別のものとして返す", () => {
    // クロム酸塩類の但し書きが名指しするのは、クロム酸鉛という特定の塩だけ
    expect(sameSubstance("クロム酸塩類及びこれを含有する製剤", "クロム酸鉛")).toBe(false);
  });

  it("正規化で落とすのは言い回しだけ", () => {
    expect(normalizeName("アジ化ナトリウム及びこれを含有する製剤")).toBe("アジ化ナトリウム");
    // 名前そのものは削らない
    expect(normalizeName("酸化アンチモン（Ⅲ）")).toBe("酸化アンチモン（Ⅲ）");
  });
});
