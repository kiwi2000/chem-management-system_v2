import { getMessages } from "@chem/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// トランザクションは、渡された処理をそのまま呼ぶだけにする（取り消しは DB の仕事なので、ここでは返事だけを見る）
vi.mock("@/lib/db", () => ({
  prisma: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/edit-stamp", () => ({ nameOf: async (id: string) => `名前-${id}` }));

import { runStampedDelete, type DeleteRow, type DeleteSpec } from "@/lib/stamped-delete";

const m = getMessages("ja");
const T1 = new Date("2026-11-24T01:00:00.000Z");
const T2 = new Date("2026-11-24T02:00:00.000Z");

interface Row extends DeleteRow {
  usedBy?: string;
}

/** 表の代わり。remove が呼ばれた行を覚える */
function table(
  rows: Row[],
  opts: { missingMeansDeleted?: boolean; changeOnWrite?: string; deleteOnWrite?: string } = {},
) {
  const removed: string[] = [];
  let current = rows.map((r) => ({ ...r }));
  const spec: DeleteSpec<Row> = {
    async load(ids) {
      return current.filter((r) => ids.includes(r.id));
    },
    missingMeansDeleted: opts.missingMeansDeleted ?? false,
    async refuse(row, batch) {
      if (row.usedBy && !batch.has(row.usedBy)) return `${row.usedBy} で使われています`;
      return null;
    },
    async remove(_tx, row, guard) {
      // 確かめたあとで、ほかの人が変えた
      if (opts.changeOnWrite === row.id) {
        current = current.map((r) => (r.id === row.id ? { ...r, updatedAt: T2 } : r));
        return 0;
      }
      // 確かめたあとで、ほかの人が消した（論理削除は更新時刻も進む）
      if (opts.deleteOnWrite === row.id) {
        opts.deleteOnWrite = undefined;
        current = current.map((r) =>
          r.id === row.id ? { ...r, deleted: true, updatedAt: T2 } : r,
        );
        return 0;
      }
      if (current.find((r) => r.id === row.id)?.updatedAt.getTime() !== guard.updatedAt.getTime()) {
        return 0;
      }
      removed.push(row.id);
      return 1;
    },
    audit: { entity: "test", actorId: "u1", diff: (r) => ({ code: r.label }) },
  };
  return { spec, removed };
}

async function call(spec: DeleteSpec<Row>, body: unknown) {
  const res = await runStampedDelete(
    new Request("http://localhost/api/x", { method: "DELETE", body: JSON.stringify(body) }),
    m,
    spec,
  );
  return {
    status: res.status,
    body: (await res.json()) as {
      deleted?: string[];
      alreadyDeleted?: string[];
      error?: { code: string; message: string; details?: { stale?: { id: string }[] } };
    },
  };
}

const stamp = (d: Date) => String(d.getTime());
let rows: Row[];
beforeEach(() => {
  rows = [
    { id: "a", label: "A-1", updatedAt: T1, updatedBy: "u2" },
    { id: "b", label: "B-1", updatedAt: T1, updatedBy: "u2" },
  ];
});

describe("まとめて消す（削除の楽観的ロック）", () => {
  it("印が合っていれば全部消す", async () => {
    const { spec, removed } = table(rows);
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(200);
    expect(removed).toEqual(["a", "b"]);
    expect(r.body.alreadyDeleted).toEqual([]);
  });

  it("1 件でもほかの人が変えていたら、何も消さずに誰がいつ変えたかを返す", async () => {
    rows[1] = { ...rows[1]!, updatedAt: T2 };
    const { spec, removed } = table(rows);
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe("stale_delete");
    expect(r.body.error?.details?.stale).toEqual([
      { id: "b", byName: "名前-u2", at: T2.toISOString() },
    ]);
    expect(removed).toEqual([]);
  });

  it("「このまま削除する」（force）なら、変えられていても消す", async () => {
    rows[1] = { ...rows[1]!, updatedAt: T2 };
    const { spec, removed } = table(rows);
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
      force: true,
    });
    expect(r.status).toBe(200);
    expect(removed).toEqual(["a", "b"]);
  });

  it("消してあるものは「すでに削除」として返し、ほかは消す", async () => {
    rows[1] = { ...rows[1]!, deleted: true, updatedAt: T2 };
    const { spec, removed } = table(rows);
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    // 論理削除は更新時刻も進めるが、「変更された」ではなく「すでに削除」と言う
    expect(r.status).toBe(200);
    expect(removed).toEqual(["a"]);
    expect(r.body.alreadyDeleted).toEqual(["b"]);
  });

  it("行ごと消える表では、読めない行を「すでに削除」とみなす", async () => {
    const { spec, removed } = table([rows[0]!], { missingMeansDeleted: true });
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(200);
    expect(removed).toEqual(["a"]);
    expect(r.body.alreadyDeleted).toEqual(["b"]);
  });

  it("見える範囲のある表では、読めない行があれば「見つかりません」で何も消さない", async () => {
    const { spec, removed } = table([rows[0]!]);
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(404);
    expect(r.body.error?.message).toBe(m.errors.notFound);
    expect(removed).toEqual([]);
  });

  it("見えないものが混ざっていたら、変更されていても「見つかりません」で何も消さない", async () => {
    rows[1] = { ...rows[1]!, hidden: true, updatedAt: T2 };
    const { spec, removed } = table(rows, { missingMeansDeleted: true });
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    // 誰がいつ変えたか（stale_delete）を言わない
    expect(r.status).toBe(404);
    expect(r.body.error?.message).toBe(m.errors.notFound);
    expect(removed).toEqual([]);
  });

  it("消せないものが 1 つでもあれば、何も消さずに理由を並べる", async () => {
    rows[1] = { ...rows[1]!, usedBy: "z" };
    const { spec, removed } = table(rows);
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(409);
    expect(r.body.error?.message).toBe(m.errors.deleteRefused("・B-1: z で使われています"));
    expect(removed).toEqual([]);
  });

  it("1 件だけのときは、理由の文をそのまま返す", async () => {
    rows[1] = { ...rows[1]!, usedBy: "z" };
    const { spec } = table(rows);
    const r = await call(spec, { items: [{ id: "b", stamp: stamp(T1) }] });
    expect(r.body.error?.message).toBe("z で使われています");
  });

  it("いっしょに消すもの同士の参照は数えない（親と子を同時に選んだとき）", async () => {
    rows[1] = { ...rows[1]!, usedBy: "a" };
    const { spec, removed } = table(rows);
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(200);
    expect(removed).toEqual(["a", "b"]);
  });

  it("確かめたあと書くまでに変わったら、食い違いとして返す", async () => {
    const { spec } = table(rows, { changeOnWrite: "b" });
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe("stale_delete");
    expect(r.body.error?.details?.stale?.map((s) => s.id)).toEqual(["b"]);
  });

  it("確かめたあと書くまでにほかの人が消したら、やり直して「すでに削除」とし、ほかは消す", async () => {
    const { spec, removed } = table(rows, { deleteOnWrite: "a" });
    const r = await call(spec, {
      items: [
        { id: "a", stamp: stamp(T1) },
        { id: "b", stamp: stamp(T1) },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.alreadyDeleted).toEqual(["a"]);
    // 1 回目は何も確定していない（トランザクションごと取り消し）。2 回目で b だけ消える
    expect(removed.filter((id) => id === "b")).toHaveLength(r.body.deleted?.length ?? 0);
    expect(r.body.deleted).toEqual(["b"]);
  });

  it("印の無い古い画面は断る", async () => {
    const { spec, removed } = table(rows);
    const r = await call(spec, { items: [{ id: "a" }] });
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("stamp_required");
    expect(removed).toEqual([]);
  });
});
