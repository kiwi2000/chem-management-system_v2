import { describe, expect, it } from "vitest";
import { parseTable, quoteCell, writeTable } from "./tsv";

describe("parseTable", () => {
  it("BOM と CRLF を受け付け、タブで区切る", () => {
    const t = parseTable("\uFEFF法律\t規制区分\tCAS\r\n化審法\t第一種\t50-00-0\r\n");
    expect(t.delimiter).toBe("\t");
    expect(t.header).toEqual(["法律", "規制区分", "CAS"]);
    expect(t.rows).toEqual([["化審法", "第一種", "50-00-0"]]);
    expect(t.lineNumbers).toEqual([2]);
  });

  it("1 行目にタブが無くカンマがあれば CSV", () => {
    const t = parseTable("a,b\n1,2\n");
    expect(t.delimiter).toBe(",");
    expect(t.rows).toEqual([["1", "2"]]);
  });

  it('Excel の引用符（中の "" と改行）を戻す', () => {
    const t = parseTable('名称\t備考\n"ベンゼン"\t"1行目\n""引用""あり"\n');
    expect(t.rows).toEqual([["ベンゼン", '1行目\n"引用"あり']]);
  });

  it("空行を飛ばし、足りない列は空にそろえる", () => {
    const t = parseTable("a\tb\tc\n1\n\n2\t3\t4\t5\n");
    expect(t.rows).toEqual([
      ["1", "", ""],
      ["2", "3", "4"],
    ]);
    expect(t.lineNumbers).toEqual([2, 4]);
  });
});

describe("writeTable", () => {
  it("BOM 付き CRLF で書き、必要なセルだけ引用符で囲む", () => {
    const s = writeTable(
      ["a", "b"],
      [
        ["x\ty", 'say "hi"'],
        [null, 1],
      ],
    );
    expect(s.startsWith("\uFEFF")).toBe(true);
    expect(s).toBe('\uFEFFa\tb\r\n"x\ty"\t"say ""hi"""\r\n\t1\r\n');
  });

  it("書いたものを読むと同じになる", () => {
    const rows = [
      ["改行\nあり", "タブ\tあり"],
      ["普通", ""],
    ];
    const t = parseTable(writeTable(["p", "q"], rows));
    expect(t.rows).toEqual(rows);
  });

  it("quoteCell は null を空にする", () => {
    expect(quoteCell(null)).toBe("");
    expect(quoteCell(true)).toBe("true");
  });
});
