/**
 * 区分の名前を付け替える。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/rename-jp-categories.ts           下見
 *   ... scripts/rename-jp-categories.ts --write                                                  付け替える
 *
 * **入れ直しはしない。**区分には CASリンクと判定がぶら下がっているので、
 * 作り直すとそれらが消える。名前の欄だけを書き換える。
 *
 * **探すのは区分コード。**名前で探すと、付け替えた次の回に見つからなくなる。
 * 何度流しても結果は同じ（すでに直っていれば触らない）。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * 安衛法の区分に、どの規則のものかを入れる（2026-09-01・法律の専門家の指摘）。
 *
 * **区分名だけでは、どの規則のものか読み分けられない。**
 * 「第1類」は消防法にも毒劇法にもあり、安衛法の中でも有機則に「第1種有機溶剤」がある。
 * 判定結果や帳票に区分名だけが出る場面で取り違える。
 *
 * **「物質」は残す。**特化則第2条が定める言葉は「第一類物質」で、そこが法令の名称にあたる。
 */
const RENAMES: { law: string; code: string; name: string }[] = [
  { law: "JP-ISHA", code: "SPEC1", name: "特化則 第1類物質" },
  { law: "JP-ISHA", code: "SPEC2", name: "特化則 第2類物質" },
  { law: "JP-ISHA", code: "SPEC3", name: "特化則 第3類物質" },
  { law: "JP-ISHA", code: "SPEC_MGMT", name: "特化則 特別管理物質" },
  { law: "JP-ISHA", code: "ORG", name: "有機則 有機溶剤" },
];

async function main() {
  const write = process.argv.includes("--write");
  let changed = 0;
  let same = 0;
  let missing = 0;

  for (const r of RENAMES) {
    const cat = await prisma.regulationCategory.findFirst({
      where: { code: r.code, law: { codeNormalized: r.law }, deletedAt: null },
      select: { id: true, nameOriginal: true, nameJa: true },
    });
    if (!cat) {
      console.log(`  ✗ ${r.law} ${r.code} が見つかりません`);
      missing += 1;
      continue;
    }
    if (cat.nameOriginal === r.name && (cat.nameJa === null || cat.nameJa === r.name)) {
      same += 1;
      continue;
    }
    console.log(`  ${r.law} ${r.code}: 「${cat.nameOriginal}」→「${r.name}」`);
    changed += 1;
    if (!write) continue;
    await prisma.regulationCategory.update({
      where: { id: cat.id },
      data: {
        nameOriginal: r.name,
        // 日本語名を別に持っているものだけ、そちらも合わせる
        ...(cat.nameJa === null ? {} : { nameJa: r.name }),
      },
    });
  }

  console.log(
    write
      ? `\n付け替えました: ${changed}件（変更なし ${same} / 見つからず ${missing}）`
      : `\n下見だけ。付け替えるなら --write を付ける（対象 ${changed}件 / 変更なし ${same} / 見つからず ${missing}）`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
