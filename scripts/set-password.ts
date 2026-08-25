/**
 * ユーザーのパスワードを設定する管理用スクリプト。
 * 主な用途:
 *  - 初期セットアップ（最初の管理者を作ってパスワードを発行する）
 *  - 管理者自身がログインできなくなったときの復旧
 *
 * 実行:
 *   npx tsx scripts/set-password.ts --list                             ユーザー一覧
 *   npx tsx scripts/set-password.ts <メール> <パスワード>                既存ユーザーに設定
 *   npx tsx scripts/set-password.ts <メール> <パスワード> --create      いなければ作る（全権限を付与）
 *
 * 注意: 引数に渡したパスワードはシェル履歴に残る。共用端末では実行後に履歴を消すこと。
 */
import { hash } from "@node-rs/argon2";
import { Permission, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

async function list() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      email: true,
      activeFlag: true,
      passwordHash: true,
      mfaMethod: true,
      lastLoginAt: true,
      permissions: { select: { permission: true } },
    },
  });
  if (users.length === 0) {
    console.log("ユーザーが1件もありません。--create を付けて最初の管理者を作成してください。");
    return;
  }
  console.table(
    users.map((u) => ({
      email: u.email,
      権限数: u.permissions.length,
      有効: u.activeFlag,
      パスワード: u.passwordHash ? "設定済み" : "未設定",
      MFA: u.mfaMethod === "totp" ? "認証アプリ" : "なし",
      最終ログイン: u.lastLoginAt?.toLocaleString("ja-JP") ?? "-",
    })),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const [a, b] = args;
  if (!a || a === "--list") {
    await list();
    if (!a) {
      console.log("\n使い方: npx tsx scripts/set-password.ts <メールアドレス> <パスワード>");
    }
    return;
  }

  const email = a.trim().toLowerCase();
  const password = b;
  if (!password || password.length < 12) {
    console.error("パスワードは12文字以上で指定してください");
    process.exitCode = 1;
    return;
  }

  const wantCreate = args.includes("--create");

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    if (!wantCreate) {
      console.error(`ユーザーが見つかりません: ${email}（新規作成するなら --create を付ける）`);
      await list();
      process.exitCode = 1;
      return;
    }
    user = await prisma.user.create({ data: { email, displayName: null } });
    // 初期セットアップ用なので全権限を付与する。過剰な分は画面から外せばよい
    await prisma.userPermission.createMany({
      data: Object.values(Permission).map((permission) => ({ userId: user!.id, permission })),
      skipDuplicates: true,
    });
    console.log(`ユーザーを作成しました: ${email}（全権限を付与）`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hash(password, ARGON_OPTS),
      // CLI で設定したパスワードは本人が決めた値である前提のため変更を強制しない
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  // 既存セッションを全て失効（安全側）
  await prisma.session.deleteMany({ where: { userId: user.id } });
  console.log(`パスワードを設定しました: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
