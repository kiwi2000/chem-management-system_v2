import { Prisma } from "@prisma/client";
import type { Messages } from "@chem/shared";
import { jsonError } from "@/lib/authz";

/**
 * 一意の決まり（同じコードは 1 つだけ等）に当たった書き込みを、分かる文の 409 に変える（2026-11-24 指示）。
 *
 * 作る前・直す前に重なりを調べていても、2 人がほぼ同時に保存すると、調べてから書くまでの間に
 * 先を越されることがある。そのときは DB の一意の決まりが後の人の書き込みを止める（データは重ならない）が、
 * 拾わないと「保存に失敗しました（500）」になる。拾ったら、**前もって調べたのと同じ処理をもう一度通して**、
 * いつもと同じ文（「製品コード「X」は既に使われています」など）を返す。見えないものと重なったときに
 * 理由を言わない決まり（S31 仕様 7 章）も、その処理がそのまま守る。
 *
 * 使いかた:
 *
 *   const clash = async () => { …前もって調べる処理。重なれば 409 の Response、無ければ null… };
 *   const c = await clash();
 *   if (c) return c;
 *   const saved = await guardUnique(m, clash, () => prisma.country.create({ data }));
 *   if (saved instanceof Response) return saved;
 *
 * 対話型のトランザクションは、その外側で包む（中で拾うと、失敗したトランザクションの続きを書こうとして別の誤りになる）。
 * 付け忘れの見つけ方: `jsonError(409, "duplicate` を grep し、同じ処理の書き込みが guardUnique で包まれているか見る
 */

/** Prisma の一意の決まりの誤り（P2002）か */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function guardUnique<T>(
  m: Messages,
  clash: () => Promise<Response | null>,
  write: () => Promise<T>,
): Promise<T | Response> {
  try {
    return await write();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // 先を越したほうはもう保存済みなので、調べ直せば重なりとして見える
    return (await clash()) ?? jsonError(409, "duplicate_value", m.errors.duplicateValue);
  }
}
