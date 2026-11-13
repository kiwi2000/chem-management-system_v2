/**
 * 人を管理グループに入れる管理用スクリプト（S31 から。人に直接付ける権限は無くなった）。
 * 主な用途:
 *  - 画面にログインできる管理者がいないときの復旧（システム管理グループに入れる）
 *  - 入れたい管理グループに、画面を使わずに入れる
 *
 * 実行:
 *   npx tsx scripts/grant-permission.ts --list                       人と入っている管理グループの一覧
 *   npx tsx scripts/grant-permission.ts <メール>                      システム管理グループに入れる
 *   npx tsx scripts/grant-permission.ts <メール> <コード> [<コード> ...] 指定の管理グループに入れる
 *
 * 入れるだけで、既に入っている管理グループからは外さない（画面の保存とは違い、置き換えではない）。
 * 入れたら、その人のセッションを切るため、ログインし直してもらう。
 */
import { normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function list() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      email: true,
      displayName: true,
      activeFlag: true,
      permissionGroups: { select: { group: { select: { code: true } } } },
    },
  });
  if (users.length === 0) {
    console.log("ユーザーが1件もありません。");
    return;
  }
  console.table(
    users.map((u) => ({
      email: u.email,
      名前: u.displayName ?? "-",
      有効: u.activeFlag,
      管理グループ: u.permissionGroups.map((p) => p.group.code).join(" "),
    })),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--list") {
    await list();
    if (args.length === 0) {
      console.log(
        "\n使い方: npx tsx scripts/grant-permission.ts <メールアドレス> [<管理グループのコード> ...]",
      );
      console.log("コードを省くと、システム管理グループに入れます");
    }
    return;
  }

  const email = (args[0] ?? "").trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { deletedAt: null, email },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`ユーザーが見つかりません: ${args[0]}`);
    await list();
    process.exitCode = 1;
    return;
  }

  const codes = args.slice(1).map((v) => normalizeCode(v));
  const groups =
    codes.length === 0
      ? await prisma.permissionGroup.findMany({
          where: { isSystemAdmin: true },
          select: { id: true, code: true },
        })
      : await prisma.permissionGroup.findMany({
          where: { code: { in: codes } },
          select: { id: true, code: true },
        });
  const missing = codes.filter((c) => !groups.some((g) => g.code === c));
  if (groups.length === 0 || missing.length > 0) {
    console.error(
      missing.length > 0
        ? `知らない管理グループ: ${missing.join(", ")}`
        : "システム管理グループがありません（移行が済んでいるか確かめてください）",
    );
    process.exitCode = 1;
    return;
  }

  const r = await prisma.userPermissionGroup.createMany({
    data: groups.map((g) => ({ userId: user.id, groupId: g.id, reason: "MANUAL" as const })),
    skipDuplicates: true,
  });
  // 入った管理グループをその場で効かせるため、ログインし直してもらう
  await prisma.session.updateMany({
    where: { userId: user.id, endedAt: null },
    data: { endedAt: new Date(), endedReason: "revoked" },
  });
  console.log(
    r.count > 0
      ? `${user.email}: ${groups.map((g) => g.code).join(" ")} に入れました`
      : `${user.email}: 追加なし（既に入っている）`,
  );
  console.log("");
  await list();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
