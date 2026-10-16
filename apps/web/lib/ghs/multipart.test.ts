import { describe, expect, it } from "vitest";
import { fieldOf, fileOf, parseMultipart } from "./multipart";

/** ブラウザの FormData と同じ形を組んで読めることを確かめる（大きなファイルは undici が読めないので自前） */
describe("parseMultipart", () => {
  it("文字の欄とファイルを読み分ける。大きな部分でも境界で正しく切れる", async () => {
    const form = new FormData();
    form.append("label", "NITE 2026-09");
    form.append("publishedOn", "2026-09-19");
    const big = Buffer.alloc(3 * 1024 * 1024, 0x41);
    big.write("--not-a-boundary\r\n", 1000); // 中身に区切りに似た文字があっても切らない
    form.append("file", new Blob([big], { type: "application/octet-stream" }), "big.bin");
    form.append("rationale", new Blob([]), ""); // 選ばなかったファイル欄
    const req = new Request("http://x/", { method: "POST", body: form });
    const parts = parseMultipart(
      Buffer.from(await req.arrayBuffer()),
      req.headers.get("content-type"),
    );
    expect(parts).not.toBeNull();
    expect(fieldOf(parts!, "label")).toBe("NITE 2026-09");
    expect(fieldOf(parts!, "publishedOn")).toBe("2026-09-19");
    const f = fileOf(parts!, "file");
    expect(f?.filename).toBe("big.bin");
    expect(f?.data.length).toBe(big.length);
    expect(f?.data.equals(big)).toBe(true);
    expect(fileOf(parts!, "rationale")).toBeNull();
    expect(fieldOf(parts!, "missing")).toBeNull();
  });

  it("境界が無い・壊れている本文は null", () => {
    expect(parseMultipart(Buffer.from("abc"), "text/plain")).toBeNull();
    expect(parseMultipart(Buffer.from("abc"), "multipart/form-data; boundary=zz")).toBeNull();
    expect(
      parseMultipart(
        Buffer.from('--zz\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n'),
        "multipart/form-data; boundary=zz",
      ),
    ).toBeNull();
  });
});
