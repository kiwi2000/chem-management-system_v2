import { passwordSchema, type Messages } from "@chem/shared";

/**
 * 打っている最中のパスワードを、その場で見る。
 *
 * サーバーと同じ決まり（packages/shared の passwordSchema）を使うので、
 * 送ってから断られるのと、打っている最中に出るのとで、言うことが食い違わない。
 * まだ何も打っていないときは何も言わない（打ち始める前に赤くしても仕方がない）。
 *
 * 返すのは最初の1つだけ。全部並べても、直せるのは結局1つずつのため。
 */
export function passwordProblem(value: string, m: Messages): string | null {
  if (value === "") return null;
  const result = passwordSchema(m).safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? null;
}
