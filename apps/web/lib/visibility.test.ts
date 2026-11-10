import { describe, expect, it, vi } from "vitest";

// DB と設定を読まないよう、関数だけを試す
vi.mock("@/lib/db", () => ({ prisma: {} }));

import type { Actor } from "@/lib/authz";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";

function actor(approve: boolean): Actor {
  const marks = {
    productView: new Set(["g1"]),
    productEdit: new Set<string>(),
    compositionView: new Set<string>(),
    compositionEdit: new Set<string>(),
    substanceView: new Set(["g1"]),
    substanceEdit: new Set<string>(),
  };
  return {
    user: { id: "u1" } as Actor["user"],
    permissions: approve ? ["APPROVE"] : [],
    has: (p) => approve && p === "APPROVE",
    isSystemAdmin: false,
    scope: marks,
  };
}

describe("見える範囲の条件（S31）", () => {
  it("最上位に AND を使わない（一覧の絞り込みと混ぜたとき消えないように）", () => {
    for (const a of [actor(false), actor(true)]) {
      expect(Object.keys(productVisibility(a))).not.toContain("AND");
      expect(Object.keys(substanceVisibility(a))).not.toContain("AND");
    }
  });

  it("所属先で絞り、承認しない人は公開済みか自分が作ったものだけ", () => {
    expect(productVisibility(actor(false))).toEqual({
      ownerGroupId: { in: ["g1"] },
      OR: [{ publishState: "PUBLISHED" }, { createdBy: "u1" }],
    });
    expect(productVisibility(actor(true))).toEqual({ ownerGroupId: { in: ["g1"] } });
  });

  it("印が 1 つも無い人には何も当たらない（空の条件にしない）", () => {
    const none = actor(false);
    (none.scope as Record<string, Set<string>>).productView = new Set();
    expect(productVisibility(none)).toMatchObject({ ownerGroupId: { in: [] } });
  });
});
