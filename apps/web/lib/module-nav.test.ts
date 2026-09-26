import { FileBadge } from "lucide-react";
import { describe, expect, it } from "vitest";
import type { ModuleManifest } from "@/modules/types";
import { withModuleNav } from "./module-nav";

interface Item {
  key?: string;
  href?: string;
}

const items: Item[] = [{ key: "home", href: "/" }, { key: "documents" }, { key: "news" }];
const toItem = (n: { href: string }): Item => ({ href: n.href });
const sds: ModuleManifest = {
  id: "sds",
  nav: [{ href: "/sds", label: { ja: "SDS 作成", en: "SDS" }, icon: FileBadge }],
};

describe("withModuleNav", () => {
  it("モジュールが無ければ、元の並びをそのまま返す（SDS なし版）", () => {
    const out = withModuleNav(items, [], (i) => i.key === "documents", toItem);
    expect(out).toBe(items);
  });

  it("目印の直後に差し込む", () => {
    const out = withModuleNav(items, [sds], (i) => i.key === "documents", toItem);
    expect(out.map((i) => i.key ?? i.href)).toEqual(["home", "documents", "/sds", "news"]);
  });

  it("目印が無ければ末尾に付ける", () => {
    const out = withModuleNav(items, [sds], (i) => i.key === "nope", toItem);
    expect(out.map((i) => i.key ?? i.href)).toEqual(["home", "documents", "news", "/sds"]);
  });

  it("複数のモジュールは宣言の順に並ぶ", () => {
    const other: ModuleManifest = {
      id: "other",
      nav: [{ href: "/other", label: { ja: "他", en: "Other" }, icon: FileBadge }],
    };
    const out = withModuleNav(items, [sds, other], (i) => i.key === "documents", toItem);
    expect(out.map((i) => i.key ?? i.href)).toEqual([
      "home",
      "documents",
      "/sds",
      "/other",
      "news",
    ]);
  });
});
