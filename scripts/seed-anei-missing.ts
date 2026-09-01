/**
 * 安衛則別表第2 のうち、こちらに抜けていた4件を足す。
 *
 * e-Gov の別表第2（2,276行）とこちらの番号を突き合わせたところ、
 * **番号ごと持っていないものが4件**あった（ほかに「削除」の2行）。
 * どれも爆発性の物で、厚労省の一覧を読むときに落ちていた。
 *
 *   1100 硝酸アンモニウム / 1474 ニトログリセリン
 *   1477 ニトロセルローズ / 1566 ピクリン酸
 *
 * 名称と番号は e-Gov の別表第2、裾切値は CHRIP が載せる厚労省の一覧
 * （表示・通知とも「すべて」＝裾切値なし）による。**表示対象・通知対象の両方に入る。**
 *
 * **入れ直しはしない。**ほかの法文物質名には CASリンクと判定がぶら下がっている。
 * 何度流しても増えない。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-anei-missing.ts [--write]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Missing {
  /** 安衛則別表第2 の項番号 */
  number: string;
  name: string;
  nameEn: string;
  cas: string;
}

const MISSING: Missing[] = [
  { number: "1100", name: "硝酸アンモニウム", nameEn: "Ammonium nitrate", cas: "6484-52-2" },
  { number: "1474", name: "ニトログリセリン", nameEn: "Nitroglycerin", cas: "55-63-0" },
  { number: "1477", name: "ニトロセルローズ", nameEn: "Nitrocellulose", cas: "9004-70-0" },
  { number: "1566", name: "ピクリン酸", nameEn: "Picric acid", cas: "88-89-1" },
];

const NOTE =
  "出典: 安衛則別表第2（e-Gov）/ 裾切値は表示・通知とも「すべて」（厚労省の対象物質一覧）";

async function main() {
  const write = process.argv.includes("--write");

  let added = 0;
  let already = 0;
  for (const cat of ["LABEL", "SDS"] as const) {
    const cls = await prisma.regulationClass.findFirst({
      where: { category: { law: { code: "JP-ISHA" }, code: cat } },
      select: { id: true },
    });
    if (!cls) throw new Error(`区分が見つかりません: ${cat}`);

    for (const m of MISSING) {
      const officialNumber = `則別表第2の${m.number}`;
      const found = await prisma.statutorySubstance.findFirst({
        where: { classId: cls.id, officialNumber },
        select: { id: true },
      });
      if (found) {
        already += 1;
        continue;
      }

      // 並び順は番号の近いものに合わせる（一覧が番号順に出るため）
      const before = await prisma.statutorySubstance.findFirst({
        where: { classId: cls.id, officialNumber: `則別表第2の${Number(m.number) - 1}` },
        select: { displayOrder: true },
      });

      const code = `JP-ISHA-${cat}-則別表第2の${m.number}`;
      console.log(`  ${cat}: ${officialNumber}「${m.name}」CAS ${m.cas}`);
      if (write) {
        await prisma.statutorySubstance.create({
          data: {
            code,
            codeNormalized: code,
            classId: cls.id,
            officialNumber,
            nameOriginal: m.name,
            nameLang: "JA",
            nameEn: m.nameEn,
            displayOrder: (before?.displayOrder ?? 0) + 1,
            note: NOTE,
            // 裾切値なし。**0を超えれば該当**
            thresholdLower: "0",
            lowerBound: "EXCLUSIVE",
            thresholdUpper: "100",
            upperBound: "INCLUSIVE",
          },
        });
      }
      added += 1;
    }
  }

  console.log(
    write
      ? `\n足しました: ${added}件（すでにある ${already}件）`
      : `\n下見だけ。足すなら --write（対象 ${added}件 / すでにある ${already}件）`,
  );
  console.log("CAS番号は scripts/chrip-import.ts を流し直すと付きます");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
