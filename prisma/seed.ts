/**
 * 初期データ投入（何度実行しても同じ結果になるように書く）。
 *   npx prisma db seed
 *
 * 現時点で入れるのはロケールのみ。ユーザーは scripts/set-password.ts で作る。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LOCALES = [
  { code: "ja", displayName: "日本語", isDefault: true },
  { code: "en", displayName: "English", isDefault: false },
];

async function main() {
  for (const l of LOCALES) {
    await prisma.locale.upsert({
      where: { code: l.code },
      update: { displayName: l.displayName, isDefault: l.isDefault },
      create: l,
    });
  }
  console.log(`ロケールを投入しました: ${LOCALES.map((l) => l.code).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
