/**
 * PRTR（S22）を画面で確かめるための見本データを入れる管理用スクリプト。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/seed-prtr-sample.ts
 *   ... scripts/seed-prtr-sample.ts --remove   入れたものを消す
 *
 * 入れるもの（同じコード・メールがあれば作り直す）:
 *  - グループ 2 つ（千葉県・大阪府）と工場 3 つ（津田沼・船橋は千葉県、大阪は大阪府）
 *  - 利用者 3 人（工場担当＝津田沼工場、グループ担当＝千葉県、PRTR 管理者）。
 *    **パスワードは付けない。**`scripts/set-password.ts <メール> <パスワード>` で発行する
 *  - 組織マスタの会社（HQ）に届出者の項目、システム設定の既定の事業者を HQ に
 *
 * コードは PG-（グループ）/ PS-（工場）、メールは prtr-*@example.com。--remove はこれを目印に消すので、
 * 手で作ったデータは巻き込まない。S22-1 の実測で残った *-T のグループ・工場も一緒に片づける
 */
import { expandPermissions, normalizeCode, type Permission } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GROUPS = [
  {
    code: "PG-CHIBA",
    nameJa: "千葉県",
    nameKana: "ちばけん",
    nameEn: "Chiba",
    zip: "2750016",
    prefecture: "千葉県",
    city: "習志野市",
    town: "津田沼５丁目",
    prefectureKana: "ちばけん",
    cityKana: "ならしのし",
    townKana: "つだぬま５ちょうめ",
    employeeNum: 123,
    displayOrder: 1,
    note: "津田沼工場と船橋工場をまとめて 1 通で届け出る",
  },
  {
    code: "PG-OSAKA",
    nameJa: "大阪府",
    nameKana: "おおさかふ",
    nameEn: "Osaka",
    zip: "5300001",
    prefecture: "大阪府",
    city: "大阪市北区",
    town: "梅田１丁目",
    prefectureKana: "おおさかふ",
    cityKana: "おおさかしきたく",
    townKana: "うめだ１ちょうめ",
    employeeNum: 45,
    displayOrder: 2,
    note: "工場 1 つだけのグループ",
  },
];

const SITES = [
  {
    code: "PS-TSUDANUMA",
    nameJa: "津田沼工場",
    nameEn: "Tsudanuma Plant",
    group: "PG-CHIBA",
    displayOrder: 1,
  },
  {
    code: "PS-FUNABASHI",
    nameJa: "船橋工場",
    nameEn: "Funabashi Plant",
    group: "PG-CHIBA",
    displayOrder: 2,
  },
  {
    code: "PS-OSAKA",
    nameJa: "大阪工場",
    nameEn: "Osaka Plant",
    group: "PG-OSAKA",
    displayOrder: 3,
  },
];

/** 製品と物質を見られる権限は共通に付ける（数量を入れるときに製品を探すため） */
const COMMON: Permission[] = [
  "PRODUCT_VIEW",
  "COMPOSITION_VIEW",
  "SUBSTANCE_VIEW",
  "REGULATION_VIEW",
];

const USERS: {
  email: string;
  displayName: string;
  permissions: Permission[];
  site?: string;
  group?: string;
}[] = [
  {
    email: "prtr-site@example.com",
    displayName: "工場担当　津田沼",
    permissions: [...COMMON, "PRTR_SITE"],
    site: "PS-TSUDANUMA",
  },
  {
    email: "prtr-group@example.com",
    displayName: "グループ担当　千葉",
    permissions: [...COMMON, "PRTR_GROUP"],
    group: "PG-CHIBA",
  },
  {
    email: "prtr-admin@example.com",
    displayName: "PRTR 管理者",
    permissions: [...COMMON, "PRTR_ADMIN"],
  },
];

const REGISTRANT = {
  nameKana: "かぶしきがいしゃけみかるそうけん",
  representName: "代表取締役　森澤　克己",
  representNameKana: "だいひょうとりしまりやく　もりさわ　かつみ",
  agentName: null,
  agentNameKana: null,
  corporateNumber: "3040003028643",
  lastYearCompanyName: null,
  zip: "2750016",
  prefecture: "千葉県",
  city: "習志野市",
  town: "津田沼５丁目",
  prefectureKana: "ちばけん",
  cityKana: "ならしのし",
  townKana: "つだぬま５ちょうめ",
};

const SETTING_KEY = "prtr.default_registrant_organisation_id";

async function removeLeftovers() {
  // S22-1 の実測で残ったもの
  for (const email of [
    "prtr-site-test@example.com",
    "prtr-group-test@example.com",
    "admin-only-test@example.com",
  ]) {
    const u = await prisma.user.findFirst({ where: { email } });
    if (u) await prisma.user.delete({ where: { id: u.id } });
  }
  const oldGroups = await prisma.prtrGroup.findMany({ where: { code: { endsWith: "-T" } } });
  for (const g of oldGroups) {
    await prisma.prtrUserScope.deleteMany({
      where: { OR: [{ groupId: g.id }, { site: { groupId: g.id } }] },
    });
    await prisma.prtrSite.deleteMany({ where: { groupId: g.id } });
    await prisma.prtrGroup.delete({ where: { id: g.id } });
  }
}

async function remove() {
  await removeLeftovers();
  for (const u of USERS) {
    const found = await prisma.user.findFirst({ where: { email: u.email } });
    if (found) await prisma.user.delete({ where: { id: found.id } });
  }
  const groups = await prisma.prtrGroup.findMany({ where: { code: { startsWith: "PG-" } } });
  for (const g of groups) {
    await prisma.prtrUserScope.deleteMany({
      where: { OR: [{ groupId: g.id }, { site: { groupId: g.id } }] },
    });
    await prisma.prtrSite.deleteMany({ where: { groupId: g.id } });
    await prisma.prtrGroup.delete({ where: { id: g.id } });
  }
  const hq = await prisma.organisation.findFirst({ where: { code: "HQ" } });
  if (hq) await prisma.prtrRegistrant.deleteMany({ where: { organisationId: hq.id } });
  await prisma.systemSetting.updateMany({ where: { key: SETTING_KEY }, data: { value: "" } });
  console.log("消しました");
}

async function seed() {
  await removeLeftovers();

  const groupIds = new Map<string, string>();
  for (const g of GROUPS) {
    const codeNormalized = normalizeCode(g.code);
    const row = await prisma.prtrGroup.upsert({
      where: { codeNormalized },
      create: { ...g, codeNormalized },
      update: { ...g, deletedAt: null },
    });
    groupIds.set(g.code, row.id);
  }
  const siteIds = new Map<string, string>();
  for (const s of SITES) {
    const codeNormalized = normalizeCode(s.code);
    const { group, ...rest } = s;
    const data = { ...rest, groupId: groupIds.get(group)! };
    const row = await prisma.prtrSite.upsert({
      where: { codeNormalized },
      create: { ...data, codeNormalized },
      update: { ...data, deletedAt: null },
    });
    siteIds.set(s.code, row.id);
  }

  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, displayName: u.displayName, activeFlag: true },
      update: { displayName: u.displayName, activeFlag: true, deletedAt: null },
    });
    const granted = expandPermissions(u.permissions);
    await prisma.userPermission.deleteMany({ where: { userId: user.id } });
    await prisma.userPermission.createMany({
      data: granted.map((permission) => ({ userId: user.id, permission })),
    });
    await prisma.prtrUserScope.deleteMany({ where: { userId: user.id } });
    if (u.site || u.group) {
      await prisma.prtrUserScope.create({
        data: {
          userId: user.id,
          siteId: u.site ? siteIds.get(u.site)! : null,
          groupId: u.group ? groupIds.get(u.group)! : null,
        },
      });
    }
  }

  const hq = await prisma.organisation.findFirst({ where: { code: "HQ", deletedAt: null } });
  if (!hq) throw new Error("組織マスタに会社 HQ が無い（先に scripts/seed-sample.ts を流す）");
  await prisma.prtrRegistrant.upsert({
    where: { organisationId: hq.id },
    create: { organisationId: hq.id, ...REGISTRANT },
    update: REGISTRANT,
  });
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: hq.id, valueType: "STRING", defaultValue: "" },
    update: { value: hq.id },
  });

  console.log(
    `グループ ${GROUPS.length} / 工場 ${SITES.length} / 利用者 ${USERS.length} / 届出者 HQ / 既定の事業者 HQ`,
  );
  console.log("利用者のパスワードは未設定。次で発行する:");
  for (const u of USERS) console.log(`  npx tsx scripts/set-password.ts ${u.email} <パスワード>`);
}

async function main() {
  if (process.argv.includes("--remove")) return remove();
  return seed();
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
