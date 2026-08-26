import { describe, expect, it } from "vitest";
import { parseChinaRow } from "./china-list";

describe("parseChinaRow", () => {
  it("As の後ろが法文物質名になる（行のCASはぶら下がる側）", () => {
    expect(parseChinaRow("101324-32-7", '"Present ([0486])" As Brucine [357-57-3]')).toEqual({
      cas: "101324-32-7",
      entryKey: "357-57-3",
      entryName: "Brucine",
      officialNumber: "0486",
      className: null,
    });
  });

  it("As が無ければ、その行のCAS自身が1項目", () => {
    expect(parseChinaRow("107-12-0", "Present ([0121])")).toEqual({
      cas: "107-12-0",
      entryKey: "107-12-0",
      entryName: null,
      officialNumber: "0121",
      className: null,
    });
  });

  it("番号の前に注記が入っていても番号を拾う", () => {
    const r = parseChinaRow(
      "100-80-1",
      '"Present (stabilized, [2668])" As Vinyltoluenes [25013-15-4]',
    );
    expect(r?.officialNumber).toBe("2668");
    expect(r?.entryKey).toBe("25013-15-4");
  });

  it("易制毒化学品は第I類〜第III類を拾う", () => {
    const r = parseChinaRow("1053657-77-4", '"Category III precursor" As Toluene [108-88-3]');
    expect(r?.className).toBe("Category III");
    expect(r?.officialNumber).toBeNull();
  });

  it("监控化学品は第1表〜第4表を拾う", () => {
    const r = parseChinaRow(
      "10025-67-9",
      "Schedule 3: Chemicals which can be used as main materials of manufacturing chemical weapons",
    );
    expect(r?.className).toBe("Schedule 3");
    expect(r?.entryKey).toBe("10025-67-9");
  });

  it("番号も区分けも無い一覧（易制爆）も読める", () => {
    expect(
      parseChinaRow(
        "10213-15-7",
        '"oxidising solid, category 3" As Magnesium nitrate [10377-60-3]',
      ),
    ).toEqual({
      cas: "10213-15-7",
      entryKey: "10377-60-3",
      entryName: "Magnesium nitrate",
      officialNumber: null,
      className: null,
    });
  });

  it("代表の鍵がCASでないもの（LOLIのまとめ番号）も鍵として使える", () => {
    const r = parseChinaRow("100-56-1", '"Present ([PC008])" As Mercury compounds [RR-00138-7]');
    expect(r?.entryKey).toBe("RR-00138-7");
    expect(r?.entryName).toBe("Mercury compounds");
    expect(r?.officialNumber).toBe("PC008");
  });

  it("末尾のセミコロンは名前に含めない", () => {
    const r = parseChinaRow("14392-03-1", '"Present" As Manganese [7439-96-5];');
    expect(r?.entryName).toBe("Manganese");
    expect(r?.entryKey).toBe("7439-96-5");
  });

  it("空の行は読まない", () => {
    expect(parseChinaRow("", "Present")).toBeNull();
    expect(parseChinaRow("100-00-0", "  ")).toBeNull();
  });
});
