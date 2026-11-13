/**
 * 管理グループの動きを試すためのテスト用データを入れる管理用スクリプト（S31）。
 *
 * 実行（流す先のポートを必ず書く。向き先を間違えて流さないため）:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/seed-group-sample.ts --confirm-port=5433
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/seed-group-sample.ts --confirm-port=5433 --remove
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/seed-group-sample.ts --confirm-port=5433 --recompute
 *     （入れたあとの計算が途中で止まったとき、計算だけを流し直す）
 *
 * 中身は仕様（docs/steps/S31_組織管理_仕様案.md）11 章の例そのまま。
 *   組織: テスト用A社（製造部 > 第1課・開発部・品質保証部・営業部 > 営業1課・総務部）、テスト用B社（開発部）
 *   管理グループ: A社 全体・製造部・開発部・品質保証部、B社 全体・開発部（表の印は 11 章の表のとおり）
 *   ユーザー: 製造・開発・品証・営業・総務（どこにも入っていない人）・B社 開発
 *   物質・原材料・製品: 管理グループごとに少しずつ。組成が「見える・見えない」の違いが出る組み合わせ
 *
 * わざと入れてある特徴（だれに何が見えるかは、流したあとに出る一覧と docs/steps/S31_組織管理.md を参照）:
 *  - 製造部の物質を含む製造部の製品（品証は製品は見えるが、組成は「見られない物質を含む」）
 *  - 開発部だけの物質を含む試作品（製造には製品が見えず、品証には組成が見えない）
 *  - 全体の原材料を含む開発部の試作品（原材料の組成を見られない開発には、この組成も見えない）
 *  - 作成中・承認待ちの製品（作った本人と、承認する人だけに見える）
 *
 * **ユーザーにはパスワードを付けない。**ログインさせるには、管理者がユーザーの画面でパスワードを設定する。
 *
 * 入れるものには必ず TG- のコード（ユーザーは tg- で始まる example.com のアドレス）を付ける。
 * --remove はこれを目印に消す。テスト用の管理グループ・組織・ユーザーを、あとから作られた
 * ほかのデータが使っているときは、消さずに止まって、何が使っているかを出す（無理に消さない）。
 *
 * 直接書き込むので、監査ログには残らない。スコア・展開・判定は、画面から登録したときと同じ処理を最後に流す。
 */
import { PrismaClient, type Permission, type Prisma, type PublishState } from "@prisma/client";
import { GROUP_PERMISSIONS } from "@chem/shared";

/*
 * アプリの処理（スコア・展開・判定）にも同じ接続を使わせるため、アプリの置き場（globalThis.prisma。lib/db.ts）に置く。
 * 本番へはトンネル越しで 1 往復が遅く、製品 1 件の判定が既定の 5 秒に収まらないので、時間切れを延ばしてある
 * （2026-11-13、本番に流したとき、判定の途中で時間切れになった）
 */
const prisma = new PrismaClient({ transactionOptions: { timeout: 120_000, maxWait: 30_000 } });
(globalThis as unknown as { prisma?: PrismaClient }).prisma = prisma;

/** このスクリプトが作るものの目印 */
const PREFIX = "TG-";
const EMAIL_PREFIX = "tg-";
const EMAIL_DOMAIN = "@example.com";

const normalize = (code: string) => code.trim().toUpperCase();

interface OrgSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  kind: "COMPANY" | "DEPARTMENT";
  parent: string | null;
  /** 最初に選ばれる管理グループ（仕様 8 章） */
  defaultGroup?: string;
}

const ORGS: OrgSeed[] = [
  {
    code: "TG-A",
    nameJa: "テスト用A社",
    nameEn: "Test company A",
    kind: "COMPANY",
    parent: null,
    defaultGroup: "TG-A-ALL",
  },
  {
    code: "TG-A-MFG",
    nameJa: "製造部",
    nameEn: "Manufacturing",
    kind: "DEPARTMENT",
    parent: "TG-A",
    defaultGroup: "TG-A-MFG",
  },
  {
    code: "TG-A-MFG1",
    nameJa: "第1課",
    nameEn: "Section 1",
    kind: "DEPARTMENT",
    parent: "TG-A-MFG",
  },
  {
    code: "TG-A-DEV",
    nameJa: "開発部",
    nameEn: "Development",
    kind: "DEPARTMENT",
    parent: "TG-A",
    defaultGroup: "TG-A-DEV",
  },
  {
    code: "TG-A-QA",
    nameJa: "品質保証部",
    nameEn: "Quality assurance",
    kind: "DEPARTMENT",
    parent: "TG-A",
    defaultGroup: "TG-A-QA",
  },
  { code: "TG-A-SALES", nameJa: "営業部", nameEn: "Sales", kind: "DEPARTMENT", parent: "TG-A" },
  {
    code: "TG-A-SALES1",
    nameJa: "営業1課",
    nameEn: "Sales section 1",
    kind: "DEPARTMENT",
    parent: "TG-A-SALES",
  },
  {
    code: "TG-A-GA",
    nameJa: "総務部",
    nameEn: "General affairs",
    kind: "DEPARTMENT",
    parent: "TG-A",
  },
  {
    code: "TG-B",
    nameJa: "テスト用B社",
    nameEn: "Test company B",
    kind: "COMPANY",
    parent: null,
    defaultGroup: "TG-B-ALL",
  },
  {
    code: "TG-B-DEV",
    nameJa: "開発部",
    nameEn: "Development",
    kind: "DEPARTMENT",
    parent: "TG-B",
    defaultGroup: "TG-B-DEV",
  },
];

/** 表の印。pv=製品・原材料 参照、pe=同 編集、cv=組成 参照、ce=組成 編集、sv=物質 参照、se=物質 編集 */
type Mark = "pv" | "pe" | "cv" | "ce" | "sv" | "se";

interface GroupSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  /** 対象の管理グループのコード → 付ける印（連動で付く印は下の marksToRow が足す） */
  rows: Record<string, Mark[]>;
  permissions: Permission[];
}

const GROUPS: GroupSeed[] = [
  {
    code: "TG-A-ALL",
    nameJa: "テスト用A社 全体",
    nameEn: "Test company A - everyone",
    rows: { "TG-A-ALL": ["pv", "sv"] },
    permissions: ["REGULATION_VIEW"],
  },
  {
    code: "TG-A-MFG",
    nameJa: "テスト用A社 製造部",
    nameEn: "Test company A - manufacturing",
    rows: { "TG-A-MFG": ["pe", "se"] },
    permissions: ["DATA_EXPORT", "DOCUMENT_CREATE", "DOCUMENT_DOWNLOAD"],
  },
  {
    code: "TG-A-DEV",
    nameJa: "テスト用A社 開発部",
    nameEn: "Test company A - development",
    rows: { "TG-A-DEV": ["pe", "ce", "se"] },
    permissions: ["DATA_EXPORT", "DOCUMENT_CREATE", "DOCUMENT_DOWNLOAD"],
  },
  {
    code: "TG-A-QA",
    nameJa: "テスト用A社 品質保証部",
    nameEn: "Test company A - quality assurance",
    rows: {
      "TG-A-QA": ["pe", "se"],
      "TG-A-ALL": ["pe", "cv", "se"],
      "TG-A-MFG": ["pv", "ce"],
      "TG-A-DEV": ["pv", "cv"],
      "TG-B-ALL": ["pv"],
    },
    permissions: ["APPROVE", "DATA_EXPORT", "DATA_IMPORT", "DOCUMENT_CREATE", "DOCUMENT_DOWNLOAD"],
  },
  {
    code: "TG-B-ALL",
    nameJa: "テスト用B社 全体",
    nameEn: "Test company B - everyone",
    rows: { "TG-B-ALL": ["pv", "sv"] },
    permissions: ["REGULATION_VIEW"],
  },
  {
    code: "TG-B-DEV",
    nameJa: "テスト用B社 開発部",
    nameEn: "Test company B - development",
    rows: { "TG-B-DEV": ["pe", "se"] },
    permissions: ["DATA_EXPORT", "DOCUMENT_CREATE", "DOCUMENT_DOWNLOAD"],
  },
];

/** 印どうしの連動（仕様 6-2）を当てはめて、表の 1 行にする */
function marksToRow(marks: Mark[]) {
  const has = (m: Mark) => marks.includes(m);
  const compositionEdit = has("ce");
  const compositionView = has("cv") || compositionEdit;
  const productEdit = has("pe");
  const substanceEdit = has("se");
  return {
    productView: has("pv") || productEdit || compositionView,
    productEdit,
    compositionView,
    compositionEdit,
    substanceView: has("sv") || substanceEdit,
    substanceEdit,
  };
}

interface UserSeed {
  email: string;
  displayName: string;
  org: string;
  groups: string[];
}

const USERS: UserSeed[] = [
  {
    email: "tg-seizo@example.com",
    displayName: "テスト 製造",
    org: "TG-A-MFG1",
    groups: ["TG-A-ALL", "TG-A-MFG"],
  },
  {
    email: "tg-kaihatsu@example.com",
    displayName: "テスト 開発",
    org: "TG-A-DEV",
    groups: ["TG-A-ALL", "TG-A-DEV"],
  },
  {
    email: "tg-hinsho@example.com",
    displayName: "テスト 品証",
    org: "TG-A-QA",
    groups: ["TG-A-ALL", "TG-A-QA"],
  },
  {
    email: "tg-eigyo@example.com",
    displayName: "テスト 営業",
    org: "TG-A-SALES1",
    groups: ["TG-A-ALL"],
  },
  // どの管理グループにも入っていない人（ログインはできるが、何も見られない。仕様 5 章）
  { email: "tg-somu@example.com", displayName: "テスト 総務", org: "TG-A-GA", groups: [] },
  {
    email: "tg-b-kaihatsu@example.com",
    displayName: "テストB 開発",
    org: "TG-B-DEV",
    groups: ["TG-B-ALL", "TG-B-DEV"],
  },
];

interface SubstanceSeed {
  code: string;
  owner: string;
  nameJa: string;
  nameEn: string;
  cas: string | null;
  note?: string;
  state?: PublishState;
  /** 作った人（ユーザーのアドレス）。作成中のものは、この人と承認する人だけに見える */
  by: string;
}

const SUBSTANCES: SubstanceSeed[] = [
  {
    code: "TG-SB-ETOH",
    owner: "TG-A-ALL",
    nameJa: "エタノール（テスト用）",
    nameEn: "Ethanol (test)",
    cas: "64-17-5",
    by: "tg-hinsho@example.com",
  },
  {
    code: "TG-SB-WATER",
    owner: "TG-A-ALL",
    nameJa: "水（テスト用）",
    nameEn: "Water (test)",
    cas: "7732-18-5",
    by: "tg-hinsho@example.com",
  },
  {
    code: "TG-SB-IPA",
    owner: "TG-A-ALL",
    nameJa: "2-プロパノール（テスト用）",
    nameEn: "Propan-2-ol (test)",
    cas: "67-63-0",
    by: "tg-hinsho@example.com",
  },
  {
    code: "TG-SB-TOL",
    owner: "TG-A-MFG",
    nameJa: "トルエン（テスト用）",
    nameEn: "Toluene (test)",
    cas: "108-88-3",
    by: "tg-seizo@example.com",
  },
  {
    code: "TG-SB-XYL",
    owner: "TG-A-MFG",
    nameJa: "キシレン（テスト用）",
    nameEn: "Xylene (test)",
    cas: "1330-20-7",
    by: "tg-seizo@example.com",
  },
  {
    code: "TG-SB-NMP",
    owner: "TG-A-DEV",
    nameJa: "N-メチル-2-ピロリドン（テスト用）",
    nameEn: "N-Methyl-2-pyrrolidone (test)",
    cas: "872-50-4",
    note: "開発部の管理グループだけが参照できる物質。これを含む製品の組成は、開発部の人にしか見えない",
    by: "tg-kaihatsu@example.com",
  },
  {
    code: "TG-SB-DRAFT",
    owner: "TG-A-DEV",
    nameJa: "開発中の物質（テスト用・作成中）",
    nameEn: "Substance under development (test, draft)",
    cas: null,
    note: "作成中。作った本人（テスト 開発）にだけ見える。品証は承認する人だが、開発部の物質を参照する印が無いので見えない",
    state: "DRAFT",
    by: "tg-kaihatsu@example.com",
  },
  {
    code: "TG-SB-PB",
    owner: "TG-A-QA",
    nameJa: "鉛（テスト用）",
    nameEn: "Lead (test)",
    cas: "7439-92-1",
    by: "tg-hinsho@example.com",
  },
  {
    code: "TG-SB-ACE",
    owner: "TG-B-ALL",
    nameJa: "アセトン（テスト用）",
    nameEn: "Acetone (test)",
    cas: "67-64-1",
    by: "tg-b-kaihatsu@example.com",
  },
  {
    code: "TG-SB-MEK",
    owner: "TG-B-DEV",
    nameJa: "メチルエチルケトン（テスト用）",
    nameEn: "Methyl ethyl ketone (test)",
    cas: "78-93-3",
    by: "tg-b-kaihatsu@example.com",
  },
];

type LineSeed = { substance: string; pct: string } | { material: string; pct: string };

interface ProductSeed {
  code: string;
  owner: string;
  nameJa: string;
  nameEn: string;
  material?: boolean;
  note: string;
  state?: PublishState;
  by: string;
  lines: LineSeed[];
}

/** 原材料を先に並べる（あとの製品の組成から指すため） */
const PRODUCTS: ProductSeed[] = [
  {
    code: "TG-MT-A-BASE",
    owner: "TG-A-ALL",
    nameJa: "共通ベース液（テスト用）",
    nameEn: "Common base liquid (test)",
    material: true,
    note: "A社 全体の原材料。中身は A社 全体の物質だけ",
    by: "tg-hinsho@example.com",
    lines: [
      { substance: "TG-SB-ETOH", pct: "70" },
      { substance: "TG-SB-WATER", pct: "30" },
    ],
  },
  {
    code: "TG-PR-A-001",
    owner: "TG-A-ALL",
    nameJa: "共通洗浄液 A-1（テスト用）",
    nameEn: "Common cleaner A-1 (test)",
    note: "A社 全体の製品。「テスト用A社 全体」のメンバーは全員見える。組成が見えるのは品証だけ（品証は組成を直せない）",
    by: "tg-hinsho@example.com",
    lines: [
      { material: "TG-MT-A-BASE", pct: "90" },
      { substance: "TG-SB-IPA", pct: "10" },
    ],
  },
  {
    code: "TG-PR-M-001",
    owner: "TG-A-MFG",
    nameJa: "製造部 希釈液 M-1（テスト用）",
    nameEn: "Manufacturing thinner M-1 (test)",
    note: "製造部の製品。中身は A社 全体の物質だけなので、品証は組成を見られ、直せる。製造の人は製品を直せるが、組成は見えない",
    by: "tg-seizo@example.com",
    lines: [
      { substance: "TG-SB-ETOH", pct: "60" },
      { substance: "TG-SB-IPA", pct: "40" },
    ],
  },
  {
    code: "TG-PR-M-002",
    owner: "TG-A-MFG",
    nameJa: "製造部 塗料用溶剤 M-2（テスト用）",
    nameEn: "Manufacturing paint solvent M-2 (test)",
    note: "製造部の製品。製造部の物質を含むので、品証は製品は見えるが、組成は「見られない物質を含む」になる",
    by: "tg-seizo@example.com",
    lines: [
      { substance: "TG-SB-TOL", pct: "55" },
      { substance: "TG-SB-XYL", pct: "35" },
      { substance: "TG-SB-ETOH", pct: "10" },
    ],
  },
  {
    code: "TG-PR-D-001",
    owner: "TG-A-DEV",
    nameJa: "開発部 試作品 D-1（テスト用）",
    nameEn: "Development prototype D-1 (test)",
    note: "仕様 11 章の例。開発部だけの物質を含む。製造には製品が見えず、品証には製品は見えるが組成は見えない。開発は組成も見られ、直せる",
    by: "tg-kaihatsu@example.com",
    lines: [
      { substance: "TG-SB-NMP", pct: "20" },
      { substance: "TG-SB-ETOH", pct: "80" },
    ],
  },
  {
    code: "TG-PR-D-002",
    owner: "TG-A-DEV",
    nameJa: "開発部 試作品 D-2（テスト用・共通ベース液入り）",
    nameEn: "Development prototype D-2 (test, with common base)",
    note: "A社 全体の原材料を含む。原材料の組成を見られない開発の人には、この製品の組成も見えない。品証には見える",
    by: "tg-kaihatsu@example.com",
    lines: [
      { material: "TG-MT-A-BASE", pct: "80" },
      { substance: "TG-SB-ETOH", pct: "20" },
    ],
  },
  {
    code: "TG-PR-D-003",
    owner: "TG-A-DEV",
    nameJa: "開発部 試作品 D-3（テスト用・作成中）",
    nameEn: "Development prototype D-3 (test, draft)",
    note: "作成中。作った本人（テスト 開発）と、承認する人（テスト 品証）だけに見える",
    state: "DRAFT",
    by: "tg-kaihatsu@example.com",
    lines: [
      { substance: "TG-SB-NMP", pct: "5" },
      { substance: "TG-SB-WATER", pct: "95" },
    ],
  },
  {
    code: "TG-PR-D-004",
    owner: "TG-A-DEV",
    nameJa: "開発部 試作品 D-4（テスト用・承認待ち）",
    nameEn: "Development prototype D-4 (test, pending)",
    note: "承認待ち。テスト 品証（承認する人）が承認・差し戻しを試せる。中身は A社 全体の物質だけなので、品証は組成も見える",
    state: "PENDING",
    by: "tg-kaihatsu@example.com",
    lines: [
      { substance: "TG-SB-ETOH", pct: "50" },
      { substance: "TG-SB-WATER", pct: "50" },
    ],
  },
  {
    code: "TG-PR-Q-001",
    owner: "TG-A-QA",
    nameJa: "品質保証部 検査用標準液 Q-1（テスト用）",
    nameEn: "QA reference solution Q-1 (test)",
    note: "品質保証部の製品。A社のほかの部には見えない。品証は組成の印を自分の行に持たないので、組成は見えない",
    by: "tg-hinsho@example.com",
    lines: [
      { substance: "TG-SB-PB", pct: "0.1" },
      { substance: "TG-SB-WATER", pct: "99.9" },
    ],
  },
  {
    code: "TG-PR-B-001",
    owner: "TG-B-ALL",
    nameJa: "B社 共通製品 B-1（テスト用）",
    nameEn: "Company B common product B-1 (test)",
    note: "B社 全体の製品。A社の品証は製品だけ見える（組成は見えない）。A社のほかの人には見えない",
    by: "tg-b-kaihatsu@example.com",
    lines: [{ substance: "TG-SB-ACE", pct: "100" }],
  },
  {
    code: "TG-PR-BD-001",
    owner: "TG-B-DEV",
    nameJa: "B社 開発部 製品 BD-1（テスト用）",
    nameEn: "Company B development product BD-1 (test)",
    note: "B社 開発部の製品。B社 開発の人だけが見られ、直せる。A社の人にはだれにも見えない",
    by: "tg-b-kaihatsu@example.com",
    lines: [
      { substance: "TG-SB-MEK", pct: "60" },
      { substance: "TG-SB-ACE", pct: "40" },
    ],
  },
];

/** 流す先を出して、引数のポートと合っているかを確かめる。URL そのものは出さない（パスワードを含む） */
function checkTarget(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL がありません");
  const url = new URL(raw);
  const port = url.port || "5432";
  console.warn(`流す先: ${url.hostname}:${port} / ${url.pathname.replace(/^\//, "")}`);
  const arg = process.argv.find((a) => a.startsWith("--confirm-port="));
  if (!arg) throw new Error("流す先のポートを --confirm-port=<ポート> で書いてください");
  if (arg.slice("--confirm-port=".length) !== port) {
    throw new Error(`--confirm-port が流す先のポート（${port}）と合いません。止めます`);
  }
}

const testUserWhere: Prisma.UserWhereInput = {
  email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN },
};
const codeWhere = { codeNormalized: { startsWith: PREFIX } };

/** テスト用のものを、ほかのデータが使っていないかを調べる。使っていれば、その説明を返す */
async function blockers(): Promise<string[]> {
  const out: string[] = [];
  const groups = await prisma.permissionGroup.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const orgs = await prisma.organisation.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const groupIds = groups.map((g) => g.id);
  const orgIds = orgs.map((o) => o.id);

  const products = await prisma.product.findMany({
    where: { ownerGroupId: { in: groupIds }, NOT: codeWhere },
    select: { code: true },
  });
  if (products.length)
    out.push(
      `テスト用の管理グループに、あとから作られた製品・原材料があります: ${products.map((p) => p.code).join(", ")}`,
    );

  const substances = await prisma.substance.findMany({
    where: { ownerGroupId: { in: groupIds }, NOT: codeWhere },
    select: { code: true },
  });
  if (substances.length)
    out.push(
      `テスト用の管理グループに、あとから作られた物質があります: ${substances.map((s) => s.code).join(", ")}`,
    );

  const usedIn = await prisma.compositionLine.findMany({
    where: {
      parentProduct: { NOT: codeWhere },
      OR: [{ childProduct: codeWhere }, { substance: codeWhere }],
    },
    select: { parentProduct: { select: { code: true } } },
  });
  if (usedIn.length)
    out.push(
      `テスト用の原材料・物質を、ほかの製品の組成が使っています: ${[...new Set(usedIn.map((l) => l.parentProduct.code))].join(", ")}`,
    );

  const members = await prisma.userPermissionGroup.findMany({
    where: { groupId: { in: groupIds }, user: { NOT: testUserWhere } },
    select: { user: { select: { displayName: true } }, group: { select: { code: true } } },
  });
  if (members.length)
    out.push(
      `テスト用の管理グループに、テスト用でないメンバーがいます: ${members.map((r) => `${r.group.code} に ${r.user.displayName ?? "（名前なし）"}`).join(", ")}`,
    );

  const rows = await prisma.permissionGroupRow.findMany({
    where: { targetGroupId: { in: groupIds }, group: { NOT: { code: { startsWith: PREFIX } } } },
    select: { group: { select: { code: true } }, target: { select: { code: true } } },
  });
  if (rows.length)
    out.push(
      `ほかの管理グループの表に、テスト用の管理グループの行があります: ${rows.map((r) => `${r.group.code} の表の ${r.target.code}`).join(", ")}`,
    );

  const people = await prisma.user.findMany({
    where: { organisationId: { in: orgIds }, NOT: testUserWhere },
    select: { displayName: true },
  });
  if (people.length)
    out.push(
      `テスト用の組織に、テスト用でない人が所属しています: ${people.map((u) => u.displayName ?? "（名前なし）").join(", ")}`,
    );

  const childOrgs = await prisma.organisation.findMany({
    where: { parentId: { in: orgIds }, NOT: { code: { startsWith: PREFIX } } },
    select: { code: true },
  });
  if (childOrgs.length)
    out.push(
      `テスト用の組織の下に、あとから作られた組織があります: ${childOrgs.map((o) => o.code).join(", ")}`,
    );

  const defaults = await prisma.organisationDefaultGroup.findMany({
    where: { groupId: { in: groupIds }, organisation: { NOT: { code: { startsWith: PREFIX } } } },
    select: { organisation: { select: { code: true } }, group: { select: { code: true } } },
  });
  if (defaults.length)
    out.push(
      `ほかの組織の「最初に選ばれる管理グループ」に、テスト用の管理グループがあります: ${defaults.map((d) => `${d.organisation.code} に ${d.group.code}`).join(", ")}`,
    );

  return out;
}

/** このスクリプトが作ったものだけを消す。ほかから使われていれば、消さずに止まる */
async function remove(): Promise<boolean> {
  const found = await blockers();
  if (found.length) {
    console.error("消せません。テスト用のデータを、ほかのデータが使っています。");
    for (const line of found) console.error(` - ${line}`);
    return false;
  }
  try {
    const counts = await prisma.$transaction(
      async (tx) => {
        const products = await tx.product.findMany({ where: codeWhere, select: { id: true } });
        const substances = await tx.substance.findMany({ where: codeWhere, select: { id: true } });
        await tx.approvalEvent.deleteMany({
          where: {
            OR: [
              { entity: "product", entityId: { in: products.map((p) => p.id) } },
              { entity: "substance", entityId: { in: substances.map((s) => s.id) } },
            ],
          },
        });
        await tx.compositionLine.deleteMany({ where: { parentProduct: codeWhere } });
        const p = await tx.product.deleteMany({ where: codeWhere });
        const s = await tx.substance.deleteMany({ where: codeWhere });
        const u = await tx.user.deleteMany({ where: testUserWhere });
        // 組織は下から順に消す（上位組織を先に消せない）
        let o = 0;
        for (const org of [...ORGS].reverse()) {
          o += (await tx.organisation.deleteMany({ where: { code: org.code } })).count;
        }
        const rest = await tx.organisation.count({ where: { code: { startsWith: PREFIX } } });
        if (rest > 0)
          throw new Error(
            `${PREFIX} で始まる、このスクリプトが作っていない組織が ${rest} 件あります`,
          );
        const g = await tx.permissionGroup.deleteMany({ where: { code: { startsWith: PREFIX } } });
        return { p: p.count, s: s.count, u: u.count, o, g: g.count };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    console.warn(
      `消しました — 製品・原材料 ${counts.p} / 物質 ${counts.s} / ユーザー ${counts.u} / 組織 ${counts.o} / 管理グループ ${counts.g}`,
    );
    return true;
  } catch (e) {
    console.error(
      "消せませんでした（何も消していません）。ほかのデータが使っている可能性があります。",
    );
    console.error(e instanceof Error ? e.message.split("\n").slice(-3).join("\n") : e);
    return false;
  }
}

/**
 * 入れたものの計算（スコア・展開・判定）。途中で止まったときは --recompute でここだけ流し直せる。
 * 何度流しても同じ結果になる（済んだ製品は飛ばす）
 */
async function recompute(): Promise<void> {
  const { recomputeScoreForSubstance } = await import("../apps/web/lib/score-store");
  for (const cas of new Set(SUBSTANCES.map((s) => s.cas).filter((c): c is string => c !== null))) {
    await recomputeScoreForSubstance(normalize(cas));
  }
  const { recomputeFrom } = await import("../apps/web/lib/expansion-store");
  // まだ今の法規制バージョンで判定していないものだけ（途中で止まったあとの流し直しで、済んだ分をやり直さない）
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true },
  });
  const products = await prisma.product.findMany({
    where: {
      ...codeWhere,
      OR: [
        { expansion: null },
        { expansion: { judgedVersionId: null } },
        { expansion: { judgedVersionId: { not: version?.id ?? "" } } },
      ],
    },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });
  for (const p of products) {
    await recomputeFrom(p.id);
    console.warn(`  計算しました: ${p.code}`);
  }
}

async function seed(): Promise<void> {
  // 作り直せるよう、前に入れたものは先に消す。消せないときは何もしない
  if (!(await remove())) {
    process.exitCode = 1;
    return;
  }
  for (const g of GROUPS) {
    for (const p of g.permissions) {
      if (!GROUP_PERMISSIONS.includes(p)) throw new Error(`管理グループに付けられない権限: ${p}`);
    }
  }

  const made = await prisma.$transaction(
    async (tx) => {
      const groupIds = new Map<string, string>();
      for (const g of GROUPS) {
        const row = await tx.permissionGroup.create({
          data: { code: g.code, nameJa: g.nameJa, nameEn: g.nameEn },
          select: { id: true },
        });
        groupIds.set(g.code, row.id);
      }
      const gid = (code: string) => {
        const id = groupIds.get(code);
        if (!id) throw new Error(`管理グループがありません: ${code}`);
        return id;
      };
      for (const g of GROUPS) {
        await tx.permissionGroupRow.createMany({
          data: Object.entries(g.rows).map(([target, marks]) => ({
            groupId: gid(g.code),
            targetGroupId: gid(target),
            ...marksToRow(marks),
          })),
        });
        await tx.permissionGroupPermission.createMany({
          data: g.permissions.map((permission) => ({ groupId: gid(g.code), permission })),
        });
      }

      const orgIds = new Map<string, string>();
      for (const [i, o] of ORGS.entries()) {
        const row = await tx.organisation.create({
          data: {
            code: o.code,
            kind: o.kind,
            nameJa: o.nameJa,
            nameEn: o.nameEn,
            displayOrder: i + 1,
            parentId: o.parent ? (orgIds.get(o.parent) ?? null) : null,
            ...(o.defaultGroup
              ? { defaultGroups: { create: { groupId: gid(o.defaultGroup) } } }
              : {}),
          },
          select: { id: true },
        });
        orgIds.set(o.code, row.id);
      }

      /** その組織と上位組織の「最初に選ばれる管理グループ」（入った理由を画面と同じに付けるため） */
      const defaultsOf = (orgCode: string): Set<string> => {
        const out = new Set<string>();
        let cur = ORGS.find((o) => o.code === orgCode);
        while (cur) {
          if (cur.defaultGroup) out.add(cur.defaultGroup);
          const parent = cur.parent;
          cur = parent ? ORGS.find((o) => o.code === parent) : undefined;
        }
        return out;
      };

      const userIds = new Map<string, string>();
      for (const u of USERS) {
        const defaults = defaultsOf(u.org);
        const row = await tx.user.create({
          data: {
            email: u.email,
            displayName: u.displayName,
            // パスワードは付けない（管理者がユーザーの画面で設定するまでログインできない）
            passwordHash: null,
            organisationId: orgIds.get(u.org) ?? null,
            permissionGroups: {
              create: u.groups.map((code) => ({
                groupId: gid(code),
                reason: defaults.has(code) ? ("DEFAULT" as const) : ("MANUAL" as const),
              })),
            },
          },
          select: { id: true },
        });
        userIds.set(u.email, row.id);
      }
      const uid = (email: string) => userIds.get(email) ?? null;

      const substanceIds = new Map<string, string>();
      for (const s of SUBSTANCES) {
        const row = await tx.substance.create({
          data: {
            ownerGroupId: gid(s.owner),
            code: s.code,
            codeNormalized: normalize(s.code),
            nameJa: s.nameJa,
            nameEn: s.nameEn,
            casNumber: s.cas,
            casNormalized: s.cas ? normalize(s.cas) : null,
            note: s.note ?? null,
            status: "ACTIVE",
            publishState: s.state ?? "PUBLISHED",
            createdBy: uid(s.by),
            updatedBy: uid(s.by),
          },
          select: { id: true },
        });
        substanceIds.set(s.code, row.id);
      }

      /*
       * CAS ごとの代表物質。画面から登録すればアプリが立てるが、ここは直接書き込むので自分で立てる。
       * 決め方はアプリ（ensureCasRepresentative）と同じ。すでに代表がいる CAS は触らず、いなければ、
       * 同じ CAS の有効な物質のうちいちばん古いものを立てる（もとからある物質があれば、そちらが代表になる）
       */
      let representatives = 0;
      for (const cas of new Set(SUBSTANCES.flatMap((s) => (s.cas ? [normalize(s.cas)] : [])))) {
        const alive = await tx.substance.findMany({
          where: { casNormalized: cas, impurityTypeId: "ip-none", deletedAt: null },
          select: { id: true, status: true, isCasRepresentative: true },
          orderBy: { createdAt: "asc" },
        });
        if (alive.length === 0 || alive.some((s) => s.isCasRepresentative)) continue;
        const next = alive.find((s) => s.status === "ACTIVE") ?? alive[0];
        if (!next) continue;
        await tx.substance.update({ where: { id: next.id }, data: { isCasRepresentative: true } });
        representatives += 1;
      }

      const productIds = new Map<string, string>();
      for (const p of PRODUCTS) {
        const row = await tx.product.create({
          data: {
            ownerGroupId: gid(p.owner),
            code: p.code,
            codeNormalized: normalize(p.code),
            nameJa: p.nameJa,
            nameEn: p.nameEn,
            note: p.note,
            status: "ACTIVE",
            publishState: p.state ?? "PUBLISHED",
            usableAsMaterial: p.material ?? false,
            createdBy: uid(p.by),
            updatedBy: uid(p.by),
          },
          select: { id: true },
        });
        productIds.set(p.code, row.id);
        await tx.compositionLine.createMany({
          data: p.lines.map((line, i) => {
            const substanceId = "substance" in line ? substanceIds.get(line.substance) : undefined;
            const childProductId = "material" in line ? productIds.get(line.material) : undefined;
            if (!substanceId && !childProductId)
              throw new Error(`${p.code} の組成の指す先がありません`);
            return {
              parentProductId: row.id,
              substanceId: substanceId ?? null,
              childProductId: childProductId ?? null,
              contentPct: line.pct,
              displayOrder: i + 1,
            };
          }),
        });
        // 承認待ちは、画面で申請したときと同じ記録を残す
        if (p.state === "PENDING") {
          await tx.approvalEvent.create({
            data: { entity: "product", entityId: row.id, action: "SUBMIT", actorId: uid(p.by) },
          });
        }
      }
      return { representatives };
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  /*
   * ここからは、画面から登録・保存したときにアプリが流す計算。作ったものだけが対象
   * （scripts/rejudge.ts は全部の製品を判定し直すので、ここでは使わない）
   */
  await recompute();

  console.warn(
    `入れました — 組織 ${ORGS.length} / 管理グループ ${GROUPS.length} / ユーザー ${USERS.length} / ` +
      `物質 ${SUBSTANCES.length} / 製品・原材料 ${PRODUCTS.length} / CAS の代表 ${made.representatives}`,
  );
  console.warn(
    "ユーザーにはパスワードがありません。管理者がユーザーの画面でパスワードを設定してください。",
  );
  for (const u of USERS)
    console.warn(`  ${u.email} … ${u.displayName}（${u.groups.join("・") || "管理グループなし"}）`);
}

async function main(): Promise<void> {
  checkTarget();
  if (process.argv.includes("--remove")) {
    if (!(await remove())) process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--recompute")) return recompute();
  await seed();
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
