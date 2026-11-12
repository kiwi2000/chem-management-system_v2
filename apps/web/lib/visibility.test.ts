import { describe, expect, it, vi } from "vitest";

// DB と設定を読まないよう、関数だけを試す
vi.mock("@/lib/db", () => ({ prisma: {} }));

import type { Actor } from "@/lib/authz";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";
import { NEWS_COLUMNS } from "@/lib/list-columns";
import {
  addressedToWhere,
  canSeeNews,
  checkNewsOrganisations,
  newsChoices,
  publishedNowWhere,
} from "@/lib/news-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

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

  it("無効にした組織は新しく選べない。いま付いているものは残せる（2026-11-12）", () => {
    // 品質保証部（qa）を無効にした。選べるのは全社（co）だけ
    const orgs = [
      { id: "qa", activeFlag: false },
      { id: "co", activeFlag: true },
    ];
    const choices = newsChoices(orgs).map((o) => o.id);
    expect(choices).toEqual(["co"]);
    const v = { fromOrganisationId: "qa", toOrganisationId: "co" };
    expect(checkNewsOrganisations(post(false), choices, v, null, msg)).toBe("org");
    expect(
      checkNewsOrganisations(post(false), choices, { ...v, fromOrganisationId: "co" }, null, msg),
    ).toBeNull();
    // 無効にする前に出したお知らせを直すときは、そのまま残せる
    expect(checkNewsOrganisations(post(false), choices, v, v, msg)).toBeNull();
    // 見える範囲は無効でも変えない（たどった組織を全部使う）
    expect(addressedToWhere(orgs.map((o) => o.id))).toEqual({
      OR: [{ toOrganisationId: null }, { toOrganisationId: { in: ["qa", "co"] } }],
    });
  });

  it("掲載中かどうかは日本の日付で決める（2026-11-12）", () => {
    // 世界標準時では 11/12 の 15:30 ＝ 日本では 11/13 の 0:30
    const day = (now: string) => {
      const w = publishedNowWhere(new Date(now)) as unknown as {
        AND: { OR: { publishFrom?: { lte: Date } | null }[] }[];
      };
      return w.AND[0]!.OR[1]!.publishFrom!.lte.toISOString();
    };
    expect(day("2026-11-12T15:30:00Z")).toBe("2026-11-13T00:00:00.000Z");
    expect(day("2026-11-12T14:59:59Z")).toBe("2026-11-12T00:00:00.000Z");
  });

  it("一覧の差出元・宛先の絞り込み。「空白」は組織の無いもの（宛先なら全員宛て）", () => {
    expect(
      buildWhere(NEWS_COLUMNS, { toOrganisation: { kind: "text", op: "empty", value: "" } }),
    ).toEqual({ AND: [{ toOrganisationId: null }] });
    expect(
      buildWhere(NEWS_COLUMNS, { fromOrganisation: { kind: "text", op: "notEmpty", value: "" } }),
    ).toEqual({ AND: [{ fromOrganisationId: { not: null } }] });
    // 名前は日本語・英語のどちらかに当たればよい。条件は AND の中に入る（見える範囲の OR を上書きしない）
    expect(
      buildWhere(NEWS_COLUMNS, { toOrganisation: { kind: "text", op: "contains", value: "品質" } }),
    ).toEqual({
      AND: [
        {
          toOrganisation: {
            OR: [
              { nameJa: { contains: "品質", mode: "insensitive" } },
              { nameEn: { contains: "品質", mode: "insensitive" } },
            ],
          },
        },
      ],
    });
    expect(
      buildOrderBy(NEWS_COLUMNS, [{ column: "toOrganisation", direction: "asc" }], {
        updatedAt: "desc",
      }),
    ).toEqual([{ toOrganisation: { nameJa: "asc" } }, { updatedAt: "desc" }]);
  });
});
