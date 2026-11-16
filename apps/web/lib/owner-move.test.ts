import { getMessages, type PublishState } from "@chem/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// DB は読まず、返す行だけを差し替える。書き換えが呼ばれたかどうかで、通った・断ったを見る
const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  productUpdate: vi.fn(async () => ({})),
  substanceUpdate: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findFirst: async () => db.row, update: db.productUpdate },
    substance: { findFirst: async () => db.row, update: db.substanceUpdate },
    permissionGroup: { findFirst: async () => ({ id: "g2" }) },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/i18n", () => ({ getServerMessages: async () => getMessages("ja") }));
vi.mock("@/lib/composition-service", () => ({ productsUsing: async () => [] }));

import type { Actor } from "@/lib/authz";
import { moveOwner, type OwnerTarget } from "@/lib/owner-move";

const marks = new Set(["g1", "g2"]);
function actor(id: string, systemAdmin = false): Actor {
  return {
    user: { id } as Actor["user"],
    permissions: [],
    has: () => systemAdmin,
    isSystemAdmin: systemAdmin,
    scope: systemAdmin
      ? "all"
      : {
          productView: marks,
          productEdit: marks,
          compositionView: marks,
          compositionEdit: marks,
          substanceView: marks,
          substanceEdit: marks,
        },
  };
}

const creator = actor("creator");
const other = actor("other");
const systemAdmin = actor("admin", true);

async function move(a: Actor, target: OwnerTarget, publishState: PublishState, to = "g2") {
  db.row = { id: "x1", code: "X-1", ownerGroupId: "g1", publishState, createdBy: "creator" };
  const res = await moveOwner(
    a,
    target,
    "x1",
    new Request("http://localhost/owner", {
      method: "POST",
      body: JSON.stringify({ ownerGroupId: to }),
    }),
  );
  const body = (await res.json()) as { error?: { message: string } };
  const update = target === "product" ? db.productUpdate : db.substanceUpdate;
  return { status: res.status, message: body.error?.message, moved: update.mock.calls.length > 0 };
}

/**
 * 管理グループの変更も、項目の編集・組成と同じ公開の状態の決まり（2026-11-17 利用者が確認）。
 * 以前は印しか見ておらず、開いたままの古い画面から、承認待のものや、ほかの人の作成中のものを移せた
 */
describe("管理グループの変更と公開の状態", () => {
  beforeEach(() => {
    db.productUpdate.mockClear();
    db.substanceUpdate.mockClear();
  });

  for (const target of ["product", "substance"] as const) {
    it(`${target}: 承認待は、作った本人もシステム管理グループの人も移せない`, async () => {
      for (const a of [creator, other, systemAdmin]) {
        expect(await move(a, target, "PENDING")).toEqual({
          status: 403,
          message: "承認待のものは、この操作の対象になりません",
          moved: false,
        });
      }
    });

    it(`${target}: 作成中・却下は、作った本人とシステム管理グループの人だけ`, async () => {
      for (const state of ["DRAFT", "REJECTED"] as const) {
        expect((await move(creator, target, state)).status).toBe(200);
        expect((await move(systemAdmin, target, state)).status).toBe(200);
        db.productUpdate.mockClear();
        db.substanceUpdate.mockClear();
        expect(await move(other, target, state)).toEqual({
          status: 403,
          message: "この操作を行う権限がありません",
          moved: false,
        });
      }
    });

    it(`${target}: 公開済は、印があればだれでも移せる`, async () => {
      for (const a of [creator, other, systemAdmin]) {
        db.productUpdate.mockClear();
        db.substanceUpdate.mockClear();
        expect(await move(a, target, "PUBLISHED")).toMatchObject({ status: 200, moved: true });
      }
    });
  }
});
