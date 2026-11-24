import { getMessages } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { guardUnique, isUniqueViolation } from "@/lib/unique-violation";

const m = getMessages("ja");

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6",
    meta: { target: ["code_normalized"] },
  });
}

describe("同時に作ったときの一意の決まり", () => {
  it("一意の決まりの誤りを見分ける", () => {
    expect(isUniqueViolation(p2002())).toBe(true);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });

  it("書けたら、その結果を返す", async () => {
    const r = await guardUnique(
      m,
      async () => null,
      async () => "ok",
    );
    expect(r).toBe("ok");
  });

  it("先を越されたら、前もって調べるのと同じ処理の文で返す", async () => {
    const clash = async () =>
      Response.json(
        { error: { message: "製品コード「P-1」は既に使われています" } },
        { status: 409 },
      );
    const r = await guardUnique(m, clash, async () => {
      throw p2002();
    });
    expect(r).toBeInstanceOf(Response);
    const res = r as Response;
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      "製品コード「P-1」は既に使われています",
    );
  });

  it("調べ直しても重なりが見えないときは、一般の文で 409", async () => {
    const r = (await guardUnique(
      m,
      async () => null,
      async () => {
        throw p2002();
      },
    )) as Response;
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { message: string } }).error.message).toBe(
      m.errors.duplicateValue,
    );
  });

  it("ほかの誤りは、そのまま投げる", async () => {
    await expect(
      guardUnique(
        m,
        async () => null,
        async () => {
          throw new Error("別の誤り");
        },
      ),
    ).rejects.toThrow("別の誤り");
  });
});
