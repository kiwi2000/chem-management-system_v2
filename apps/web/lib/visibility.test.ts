import { describe, expect, it, vi } from "vitest";

// DB と設定を読まないよう、関数だけを試す
vi.mock("@/lib/db", () => ({ prisma: {} }));

import type { Actor } from "@/lib/authz";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";
import { addressedToWhere, canSeeNews, checkNewsOrganisations } from "@/lib/news-service";

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

describe("お知らせの宛先と差出元（2026-11-11）", () => {
  const post = (manage: boolean): Actor => ({
    user: { id: "u1" } as Actor["user"],
    permissions: manage ? ["NEWS_POST", "NEWS_MANAGE"] : ["NEWS_POST"],
    has: (p) => p === "NEWS_POST" || (manage && p === "NEWS_MANAGE"),
    isSystemAdmin: false,
    scope: "all",
  });
  const msg = { orgNotAllowed: "org", allNotAllowed: "all" };
  // 品質保証部（qa）の上が全社（co）
  const chain = ["qa", "co"];

  it("見える条件は最上位に AND を使わず、全員宛てと自分の組織から上の宛先", () => {
    expect(addressedToWhere(chain)).toEqual({
      OR: [{ toOrganisationId: null }, { toOrganisationId: { in: chain } }],
    });
  });

  it("宛先の外と下書きは、編集できない人には見えない", () => {
    const reader: Actor = { ...post(false), has: () => false, permissions: [] };
    const base = { authorId: "u2", status: "PUBLISHED" as const };
    expect(canSeeNews(reader, chain, { ...base, toOrganisationId: null })).toBe(true);
    expect(canSeeNews(reader, chain, { ...base, toOrganisationId: "co" })).toBe(true);
    expect(canSeeNews(reader, chain, { ...base, toOrganisationId: "sales" })).toBe(false);
    expect(canSeeNews(reader, chain, { ...base, status: "DRAFT", toOrganisationId: null })).toBe(
      false,
    );
  });

  it("選べるのは自分の組織とその上だけ。「全員」は管理する人だけ", () => {
    const ok = { fromOrganisationId: "qa", toOrganisationId: "co" };
    expect(checkNewsOrganisations(post(false), chain, ok, null, msg)).toBeNull();
    expect(
      checkNewsOrganisations(post(false), chain, { ...ok, toOrganisationId: "sales" }, null, msg),
    ).toBe("org");
    expect(
      checkNewsOrganisations(post(false), chain, { ...ok, fromOrganisationId: "sales" }, null, msg),
    ).toBe("org");
    expect(
      checkNewsOrganisations(post(false), chain, { ...ok, toOrganisationId: null }, null, msg),
    ).toBe("all");
    expect(
      checkNewsOrganisations(post(true), chain, { ...ok, toOrganisationId: null }, null, msg),
    ).toBeNull();
  });

  it("直すときは、いま付いている値はそのまま残せる（異動したあとなど）", () => {
    const current = { fromOrganisationId: "old", toOrganisationId: null };
    const v = { fromOrganisationId: "old", toOrganisationId: null };
    expect(checkNewsOrganisations(post(false), chain, v, current, msg)).toBeNull();
    // 新しく付けるなら、自分の組織とその上だけ
    expect(
      checkNewsOrganisations(post(false), chain, { ...v, toOrganisationId: "sales" }, current, msg),
    ).toBe("org");
  });
});
