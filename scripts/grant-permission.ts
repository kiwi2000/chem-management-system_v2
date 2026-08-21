/**
 * ユーザーに権限を足す管理用スクリプト。
 * 主な用途:
 *  - 権限の enum を入れ替えた直後に、必要な権限を配り直す
 *  - 画面にログインできる管理者がいないときの復旧
 *
 * 実行:
 *   npx tsx scripts/grant-permission.ts --list                                  一覧
 *   npx tsx scripts/grant-permission.ts <メール> <権限> [<権限> ...]              指定の人に足す
 *   npx tsx scripts/grant-permission.ts --admins <権限> [<権限> ...]              ADMIN を持つ人全員に足す
 *
 * 足すだけで、既にある権限は外さない（画面の保存とは違い、置き換えではない）。
 * 含意（INACTIVE_EDIT なら INACTIVE_VIEW など）は画面と同じように自動で補う。
 */
import { expandPermissions, isPermission, PERMISSIONS, type Permission } from "@chem/shared";
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
      permissions: { select: { permission: true } },
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
      権限: u.permissions.map((p) => p.permission).join(" "),
    })),
  );
}

/** 足りない分だけ書く。戻り値は実際に足した権限 */
async function grant(userId: string, wanted: Permission[]): Promise<Permission[]> {
  const current = (
    await prisma.userPermission.findMany({ where: { userId }, select: { permission: true } })
  ).map((r) => r.permission);
  // 含意を展開してから、まだ持っていないものだけ足す
  const toAdd = expandPermissions([...current, ...wanted]).filter((p) => !current.includes(p));
  if (toAdd.length > 0) {
    await prisma.userPermission.createMany({
      data: toAdd.map((permission) => ({ userId, permission })),
      skipDuplicates: true,
    });
  }
  return toAdd;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--list") {
    await list();
    if (args.length === 0) {
      console.log("\n使い方: npx tsx scripts/grant-permission.ts <メールアドレス> <権限> ...");
      console.log(`権限: ${PERMISSIONS.join(" ")}`);
    }
    return;
  }

  // 先頭は宛先（メールアドレスか --admins）、残りが足す権限
  const toAdmins = args[0] === "--admins";
  const wanted = args.slice(1).map((v) => v.trim().toUpperCase());

  const bad = wanted.filter((v) => !isPermission(v));
  if (wanted.length === 0 || bad.length > 0) {
    console.error(
      bad.length > 0 ? `知らない権限: ${bad.join(", ")}` : "権限を1つ以上指定してください",
    );
    console.error(`指定できる権限: ${PERMISSIONS.join(" ")}`);
    process.exitCode = 1;
    return;
  }
  const perms = wanted as Permission[];

  const targets = toAdmins
    ? await prisma.user.findMany({
        where: {
          deletedAt: null,
          activeFlag: true,
          permissions: { some: { permission: "ADMIN" } },
        },
        select: { id: true, email: true },
      })
    : await prisma.user.findMany({
        where: { deletedAt: null, email: args[0].trim().toLowerCase() },
        select: { id: true, email: true },
      });

  if (targets.length === 0) {
    console.error(
      toAdmins ? "ADMIN を持つ有効なユーザーがいません" : `ユーザーが見つかりません: ${args[0]}`,
    );
    await list();
    process.exitCode = 1;
    return;
  }

  for (const t of targets) {
    const added = await grant(t.id, perms);
    console.log(
      added.length > 0
        ? `${t.email}: ${added.join(" ")} を追加`
        : `${t.email}: 追加なし（既に持っている）`,
    );
  }
  console.log("");
  await list();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
