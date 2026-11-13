import type { PublishState } from "@chem/shared";
import { describe, expect, it, vi } from "vitest";

// DB を読まないよう、印（管理グループの表）は「全部ある」ことにして、公開の状態の決まりだけを試す
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/composition-access", () => ({ compositionAccess: async () => "edit" }));

import type { Actor } from "@/lib/authz";
import { canEditComposition } from "@/lib/composition-service";
import { stateRefusal } from "@/lib/import/types";
import { canEditProduct } from "@/lib/product-service";

const all = new Set(["g1"]);
function actor(id: string, opts: { approve?: boolean; systemAdmin?: boolean } = {}): Actor {
  return {
    user: { id } as Actor["user"],
    permissions: opts.approve ? ["APPROVE"] : [],
    has: (p) => Boolean(opts.systemAdmin) || (Boolean(opts.approve) && p === "APPROVE"),
    isSystemAdmin: Boolean(opts.systemAdmin),
    scope: opts.systemAdmin
      ? "all"
      : {
          productView: all,
          productEdit: all,
          compositionView: all,
          compositionEdit: all,
          substanceView: all,
          substanceEdit: all,
        },
  };
}

const product = (publishState: PublishState) => ({
  id: "p1",
  status: "ACTIVE",
  publishState,
  createdBy: "creator",
  ownerGroupId: "g1",
});

const creator = actor("creator");
const approver = actor("approver", { approve: true });
const systemAdmin = actor("admin", { systemAdmin: true });

/**
 * 製品そのものと組成は、公開の状態について同じ決まり（2026-11-13 利用者が確認）。
 * 以前は組成だけ状態を見ておらず、承認する人がほかの人の公開前の組成を直せ、承認待の組成も直せた
 */
describe("公開の状態と書き換え", () => {
  it("承認待は、作った本人もシステム管理グループの人も直せない（製品も組成も）", async () => {
    for (const a of [creator, approver, systemAdmin]) {
      expect(canEditProduct(a, product("PENDING"))).toBe(false);
      expect(await canEditComposition(a, product("PENDING"))).toBe(false);
    }
  });

  it("作成中・却下は、作った本人とシステム管理グループの人だけ（承認する人は直せない）", async () => {
    for (const state of ["DRAFT", "REJECTED"] as const) {
      for (const [a, ok] of [
        [creator, true],
        [systemAdmin, true],
        [approver, false],
      ] as const) {
        expect(canEditProduct(a, product(state))).toBe(ok);
        expect(await canEditComposition(a, product(state))).toBe(ok);
      }
    }
  });

  it("公開済は、印があればだれでも直せる", async () => {
    for (const a of [creator, approver, systemAdmin]) {
      expect(canEditProduct(a, product("PUBLISHED"))).toBe(true);
      expect(await canEditComposition(a, product("PUBLISHED"))).toBe(true);
    }
  });
});

/**
 * 取り込みも画面と同じ決まり（製品の項目・組成・物質）。以前は印しか見ておらず、
 * 承認待のものや、ほかの人の公開前のものを取り込みで書き換えられた（2026-11-14 に直した）
 */
describe("取り込みで断る文", () => {
  it("承認待は、だれにも「取り下げてから」と出す", () => {
    for (const a of [creator, approver, systemAdmin]) {
      expect(stateRefusal(a, product("PENDING"))).toBe(
        "承認待のものは直せません（申請を取り下げてから直します）",
      );
    }
    expect(stateRefusal(creator, product("PENDING"), "の組成")).toBe(
      "承認待のものの組成は直せません（申請を取り下げてから直します）",
    );
  });

  it("作成中・却下は、作った本人とシステム管理グループの人は通り、ほかの人は断る", () => {
    for (const state of ["DRAFT", "REJECTED"] as const) {
      expect(stateRefusal(creator, product(state))).toBeNull();
      expect(stateRefusal(systemAdmin, product(state))).toBeNull();
      expect(stateRefusal(approver, product(state))).toBe(
        "公開前のものは、作った本人しか直せません",
      );
    }
  });

  it("公開済は断らない。状態が分からないものは断る", () => {
    for (const a of [creator, approver, systemAdmin]) {
      expect(stateRefusal(a, product("PUBLISHED"))).toBeNull();
    }
    expect(stateRefusal(systemAdmin, undefined)).not.toBeNull();
  });
});
