import { describe, expect, it } from "vitest";
import { einecsValue, encsValue, inventoryValues, keciValue } from "./chrip-import-inventories";

/** 詳細ページの節を 1 つ作る（CHRIP の書き方を写した最小の形） */
const sec = (code: string, body: string) =>
  `<img src="./img/minus.png" class="ac-button" alt=""
 onClick="JavaScript:logging(this, 'C004-659-34A', 'cSi', '1', '001', '0', '${code}')"/>
 ${body}`;

describe("番号の書き方を LOLI にそろえる", () => {
  it("化審法公示整理番号", () => {
    expect(encsValue("6-1849")).toBe("(6)-1849");
    expect(encsValue("1 - 286")).toBe("(1)-286");
    expect(encsValue("-")).toBeNull();
  });
  it("KE番号は 5 桁", () => {
    expect(keciValue("KE-21895")).toBe("KE-21895");
    expect(keciValue("KE-123")).toBe("KE-00123");
  });
  it("EC番号は EINECS の範囲（2・3 始まり）だけ", () => {
    expect(einecsValue("231-846-0")).toBe("231-846-0");
    expect(einecsValue("405-210-6")).toBeNull();
    expect(einecsValue("612-345-6")).toBeNull();
  });
});

describe("inventoryValues", () => {
  it("節ごとに読み、インベントリの値にする", () => {
    const html = [
      sec("RO_02_001", "<dt>EC番号</dt><dd>231-846-0</dd>"),
      sec("RO_13_001", "<dt>英語名称</dt><dd>lead(II) chromate</dd>"),
      sec("RO_03_001", "<dt>ACTIVITY</dt><dd>ACTIVE</dd>"),
      sec("RJ_01_040", "<dt>化審法公示整理番号</dt><dd>1-286</dd>"),
      sec("RO_12_010", "<dt>KE番号</dt><dd>KE-21895</dd>"),
      sec("RJ_04_002", "<dt>安衛法（官報）整理番号</dt><dd>12-790</dd>"),
    ].join("\n");
    const v = inventoryValues(html);
    expect(Object.fromEntries(v)).toEqual({
      EINECS: ["231-846-0"],
      TCSI: ["該当"],
      TSCA: ["ACTIVE"],
      ENCS: ["(1)-286"],
      KECI: ["KE-21895"],
      ISHL: ["12-790"],
    });
  });

  it("同じ項目が並んでいれば全部、「-」は落とす", () => {
    const v = inventoryValues(
      sec(
        "RJ_01_040",
        "<dt>化審法公示整理番号</dt><dd>2-1</dd><dt>化審法公示整理番号</dt><dd>2-2</dd>",
      ) + sec("RO_02_001", "<dt>EC番号</dt><dd>-</dd>"),
    );
    expect(v.get("ENCS")).toEqual(["(2)-1", "(2)-2"]);
    expect(v.has("EINECS")).toBe(false);
  });
});
