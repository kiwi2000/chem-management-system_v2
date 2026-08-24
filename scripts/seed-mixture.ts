/**
 * 混合物原料を組み合わせた製品のサンプルデータを入れる管理用スクリプト。
 *
 * 実行:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-mixture.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-mixture.ts --remove
 *
 * `seed-sample.ts` は電子機器（成形品）を部品から下ろした形だが、こちらは**溶剤系塗料**。
 * シンナー・樹脂ワニス・顔料分散体・硬化剤といった、**それ自体が混合物である原料**を
 * 組み合わせて製品にしている。判定の入口が「物質」ではなく「混合物」になる場合の見えかたを試せる。
 *
 * わざと入れてある特徴:
 *  - 製品の組成行が**すべて原材料**（CP-PU100W は物質を1件も直接持たない）
 *  - 原料の中に原料（分散体 → 樹脂ワニス → 物質）。セット品から数えると5段下りる
 *  - 同じ原料を何度も使う（MX-VAR-AC は5つ、MX-THIN-U は6つの組成から参照される）
 *  - 残部（balance）の行が多い。溶剤で100%に合わせる作り方をそのまま写した
 *  - 微量成分: HDI残存モノマー 0.3% / ホルムアルデヒド 0.02% / ベンゼン 0.005%。
 *    裾切値のすぐ上・すぐ下で該当が分かれることを試すためのもの
 *  - 既存データと同じCASの物質（二酸化チタン・エポキシ樹脂）を別IDで持つ
 *  - クロム酸鉛（劇物・金属換算の対象）を含む黄色分散体
 *
 * 入れるものには SEED_PREFIXES のコードを付ける。--remove はこれを目印に消すので、
 * 手で作ったデータは巻き込まない。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** このスクリプトが作るものの目印。消すときもこれで絞る */
const SEED_PREFIXES = ["CH-", "MX-", "CP-"];

interface SubstanceSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  cas: string | null;
  aliases?: string[];
  note?: string;
}

/** 物質。コードは CH-（CHemical） */
const SUBSTANCES: SubstanceSeed[] = [
  // --- 溶剤 ---
  {
    code: "CH-TOL",
    nameJa: "トルエン",
    nameEn: "Toluene",
    cas: "108-88-3",
    aliases: ["トルオール"],
  },
  {
    code: "CH-XYL",
    nameJa: "キシレン",
    nameEn: "Xylene",
    cas: "1330-20-7",
    aliases: ["キシロール", "混合キシレン"],
    note: "異性体混合物。エチルベンゼンを数%含むことがある",
  },
  { code: "CH-EB", nameJa: "エチルベンゼン", nameEn: "Ethylbenzene", cas: "100-41-4" },
  { code: "CH-BAC", nameJa: "酢酸ブチル", nameEn: "Butyl acetate", cas: "123-86-4" },
  { code: "CH-EAC", nameJa: "酢酸エチル", nameEn: "Ethyl acetate", cas: "141-78-6" },
  {
    code: "CH-MIBK",
    nameJa: "メチルイソブチルケトン",
    nameEn: "Methyl isobutyl ketone",
    cas: "108-10-1",
    aliases: ["MIBK"],
  },
  {
    code: "CH-MEK",
    nameJa: "メチルエチルケトン",
    nameEn: "Methyl ethyl ketone",
    cas: "78-93-3",
    aliases: ["MEK", "2-ブタノン"],
  },
  {
    code: "CH-PGM",
    nameJa: "プロピレングリコールモノメチルエーテル",
    nameEn: "Propylene glycol monomethyl ether",
    cas: "107-98-2",
    aliases: ["PGM", "PGME"],
  },
  {
    code: "CH-BUOH",
    nameJa: "1-ブタノール",
    nameEn: "1-Butanol",
    cas: "71-36-3",
    aliases: ["ノルマルブタノール"],
  },
  {
    code: "CH-MEOH",
    nameJa: "メタノール",
    nameEn: "Methanol",
    cas: "67-56-1",
    aliases: ["メチルアルコール"],
  },
  {
    code: "CH-BZ",
    nameJa: "ベンゼン",
    nameEn: "Benzene",
    cas: "71-43-2",
    note: "回収溶剤に不純物として微量入る。意図して配合しているものではない",
  },
  { code: "CH-BZOH", nameJa: "ベンジルアルコール", nameEn: "Benzyl alcohol", cas: "100-51-6" },

  // --- 樹脂・硬化剤 ---
  {
    code: "CH-ACPOL",
    nameJa: "アクリルポリオール樹脂",
    nameEn: "Acrylic polyol resin",
    cas: null,
    note: "ポリマーのためCAS番号を持たない",
  },
  {
    code: "CH-EPRES",
    nameJa: "ビスフェノールA型エポキシ樹脂",
    nameEn: "Bisphenol A epoxy resin",
    cas: "25068-38-6",
    note: "seed-sample.ts の SB-EP と同じCAS番号。別IDで持っている",
  },
  {
    code: "CH-PAA",
    nameJa: "変性ポリアミドアミン",
    nameEn: "Modified polyamidoamine",
    cas: null,
    note: "ポリマーのためCAS番号を持たない",
  },
  {
    code: "CH-HDIP",
    nameJa: "ヘキサメチレンジイソシアネート系ポリイソシアネート",
    nameEn: "HDI-based polyisocyanate",
    cas: "4035-89-6",
    aliases: ["HDIビウレット"],
  },
  {
    code: "CH-HDI",
    nameJa: "ヘキサメチレンジイソシアネート",
    nameEn: "Hexamethylene diisocyanate",
    cas: "822-06-0",
    aliases: ["HDI"],
    note: "硬化剤に残る未反応モノマー。配合ではなく残存分",
  },
  {
    code: "CH-HCHO",
    nameJa: "ホルムアルデヒド",
    nameEn: "Formaldehyde",
    cas: "50-00-0",
    note: "アミン系硬化剤に不純物として微量入る",
  },

  // --- 顔料・体質顔料 ---
  {
    code: "CH-TIO2",
    nameJa: "二酸化チタン（ルチル型）",
    nameEn: "Titanium dioxide (rutile)",
    cas: "13463-67-7",
    note: "seed-sample.ts の SB-TIO2 と同じCAS番号。別IDで持っている",
  },
  {
    code: "CH-PBCR",
    nameJa: "クロム酸鉛",
    nameEn: "Lead chromate",
    cas: "7758-97-6",
    aliases: ["黄鉛", "クロムイエロー"],
    note: "鉛とクロムの両方で金属換算が要る",
  },
  {
    code: "CH-FE2O3",
    nameJa: "酸化鉄(III)",
    nameEn: "Iron(III) oxide",
    cas: "1309-37-1",
    aliases: ["べんがら"],
  },
  { code: "CH-CB", nameJa: "カーボンブラック", nameEn: "Carbon black", cas: "1333-86-4" },
  {
    code: "CH-BASO4",
    nameJa: "硫酸バリウム",
    nameEn: "Barium sulfate",
    cas: "7727-43-7",
    aliases: ["沈降性硫酸バリウム"],
  },
  { code: "CH-TALC", nameJa: "タルク", nameEn: "Talc", cas: "14807-96-6" },

  // --- 添加剤 ---
  {
    code: "CH-DBTDL",
    nameJa: "ジブチルスズジラウレート",
    nameEn: "Dibutyltin dilaurate",
    cas: "77-58-7",
    aliases: ["DBTDL"],
    note: "ウレタン化の触媒",
  },
  {
    code: "CH-DISP",
    nameJa: "高分子系顔料分散剤",
    nameEn: "Polymeric pigment dispersant",
    cas: null,
    note: "UVCB のためCAS番号を持たない",
  },
  {
    code: "CH-SIL",
    nameJa: "ポリジメチルシロキサン",
    nameEn: "Polydimethylsiloxane",
    cas: "63148-62-9",
    aliases: ["シリコーン消泡剤"],
  },
  {
    code: "CH-LEV",
    nameJa: "ポリアクリレート系レベリング剤",
    nameEn: "Polyacrylate levelling agent",
    cas: null,
  },
];

/** 組成の1行。物質はコード、原材料もコードで書く */
type LineSeed =
  | { substance: string; pct: string; note?: string }
  | { material: string; pct: string; note?: string }
  | { substance: string; balance: true; note?: string }
  | { material: string; balance: true; note?: string };

interface ProductSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  /** 他の製品の組成に入れられるか */
  material: boolean;
  /** 用途。システム設定 product.use_options にある値だけ使う */
  uses?: string[];
  /** 型式。システム設定 product.model_options にある値だけ使う */
  model?: string;
  aliases?: string[];
  note?: string;
  lines: LineSeed[];
}

/**
 * 混合物原料（MX-）と製品（CP-）。
 * 参照される側を先に並べる（作る順がそのまま依存の順になる）。
 */
const PRODUCTS: ProductSeed[] = [
  // ---------- 混合物原料 ----------
  {
    code: "MX-THIN-U",
    nameJa: "ウレタン塗料用シンナー",
    nameEn: "Thinner for urethane coatings",
    material: true,
    uses: ["塗料"],
    note: "6つの組成から使われている。溶剤だけの混合物",
    lines: [
      { substance: "CH-TOL", pct: "30" },
      { substance: "CH-XYL", pct: "25" },
      { substance: "CH-BAC", pct: "20" },
      { substance: "CH-MIBK", pct: "15" },
      { substance: "CH-PGM", balance: true, note: "残りを高沸点溶剤で埋める" },
    ],
  },
  {
    code: "MX-VAR-AC",
    nameJa: "アクリルポリオールワニス（不揮発分50%）",
    nameEn: "Acrylic polyol varnish (50% NV)",
    material: true,
    uses: ["塗料"],
    note: "主剤・分散体・体質顔料スラリーの土台。5つの組成から参照される",
    lines: [
      { substance: "CH-ACPOL", pct: "50" },
      { substance: "CH-BAC", pct: "30" },
      { substance: "CH-XYL", balance: true },
    ],
  },
  {
    code: "MX-VAR-EP",
    nameJa: "エポキシ樹脂ワニス（不揮発分60%）",
    nameEn: "Epoxy resin varnish (60% NV)",
    material: true,
    uses: ["塗料"],
    lines: [
      { substance: "CH-EPRES", pct: "60" },
      { substance: "CH-XYL", pct: "25" },
      { substance: "CH-BUOH", balance: true },
    ],
  },
  {
    code: "MX-DISP-WH",
    nameJa: "白色顔料分散体",
    nameEn: "White pigment dispersion",
    material: true,
    uses: ["塗料"],
    note: "原料の中に原料が入る例（ワニスを含む）",
    lines: [
      { substance: "CH-TIO2", pct: "60" },
      { material: "MX-VAR-AC", pct: "25" },
      { substance: "CH-DISP", pct: "2" },
      { substance: "CH-BAC", balance: true },
    ],
  },
  {
    code: "MX-DISP-YL",
    nameJa: "黄色顔料分散体（クロム酸鉛系）",
    nameEn: "Yellow pigment dispersion (lead chromate)",
    material: true,
    uses: ["塗料"],
    note: "劇物と金属換算（鉛・クロム）を試すための原料",
    lines: [
      { substance: "CH-PBCR", pct: "45" },
      { material: "MX-VAR-AC", pct: "30" },
      { substance: "CH-DISP", pct: "1.5" },
      { substance: "CH-XYL", balance: true },
    ],
  },
  {
    code: "MX-DISP-RD",
    nameJa: "赤さび色顔料分散体",
    nameEn: "Red oxide pigment dispersion",
    material: true,
    uses: ["塗料"],
    lines: [
      { substance: "CH-FE2O3", pct: "50" },
      { substance: "CH-CB", pct: "1" },
      { material: "MX-VAR-AC", pct: "30" },
      { substance: "CH-DISP", pct: "1.5" },
      { substance: "CH-BAC", balance: true },
    ],
  },
  {
    code: "MX-EXT-01",
    nameJa: "体質顔料スラリー",
    nameEn: "Extender pigment slurry",
    material: true,
    uses: ["塗料"],
    lines: [
      { substance: "CH-BASO4", pct: "40" },
      { substance: "CH-TALC", pct: "20" },
      { material: "MX-VAR-AC", pct: "25" },
      { substance: "CH-BAC", balance: true },
    ],
  },
  {
    code: "MX-HARD-HDI",
    nameJa: "HDI系ポリイソシアネート硬化剤",
    nameEn: "HDI-based polyisocyanate hardener",
    material: true,
    uses: ["塗料"],
    note: "残存モノマーを0.3%明示している。裾切値のすぐ上・下で該当が分かれる例",
    lines: [
      { substance: "CH-HDIP", pct: "75" },
      { substance: "CH-HDI", pct: "0.3", note: "未反応の残存モノマー" },
      { substance: "CH-BAC", balance: true },
    ],
  },
  {
    code: "MX-HARD-AM",
    nameJa: "変性ポリアミドアミン硬化剤",
    nameEn: "Modified polyamidoamine hardener",
    material: true,
    uses: ["塗料"],
    lines: [
      { substance: "CH-PAA", pct: "55" },
      { substance: "CH-BZOH", pct: "20" },
      { substance: "CH-HCHO", pct: "0.02", note: "不純物として微量" },
      { substance: "CH-XYL", balance: true },
    ],
  },
  {
    code: "MX-ADD-01",
    nameJa: "添加剤パッケージ",
    nameEn: "Additive package",
    material: true,
    uses: ["塗料"],
    note: "製品には3%前後しか入らない。薄まった先で該当が消えるかを見るためのもの",
    lines: [
      { substance: "CH-LEV", pct: "10" },
      { substance: "CH-SIL", pct: "5" },
      { substance: "CH-DBTDL", pct: "0.5", note: "ウレタン化触媒" },
      { substance: "CH-XYL", balance: true },
    ],
  },
  {
    code: "MX-SOL-RC",
    nameJa: "回収溶剤（再生シンナー）",
    nameEn: "Reclaimed solvent",
    material: true,
    uses: ["洗浄剤"],
    note: "ベンゼンを0.005%含む。裾切値に届かない微量成分の見えかたを試すためのもの",
    lines: [
      { substance: "CH-TOL", pct: "40" },
      { substance: "CH-XYL", pct: "30" },
      { substance: "CH-MEK", pct: "15" },
      { substance: "CH-EAC", pct: "10" },
      { substance: "CH-MEOH", pct: "4.995" },
      { substance: "CH-BZ", pct: "0.005", note: "回収由来の不純物" },
    ],
  },

  // ---------- 製品 ----------
  {
    code: "CP-PU100W",
    nameJa: "2液ウレタン塗料 白 主剤 PU-100W",
    nameEn: "Two-pack urethane coating, white, base PU-100W",
    material: true,
    uses: ["塗料"],
    model: "工業用グレード",
    aliases: ["PU100-WHITE"],
    note: "組成行がすべて原材料。物質を1件も直接持たない",
    lines: [
      { material: "MX-VAR-AC", pct: "40" },
      { material: "MX-DISP-WH", pct: "30" },
      { material: "MX-EXT-01", pct: "10" },
      { material: "MX-ADD-01", pct: "3" },
      { material: "MX-THIN-U", balance: true, note: "粘度をシンナーで合わせる" },
    ],
  },
  {
    code: "CP-PU100H",
    nameJa: "2液ウレタン塗料 硬化剤 PU-100H",
    nameEn: "Two-pack urethane coating, hardener PU-100H",
    material: true,
    uses: ["塗料"],
    model: "工業用グレード",
    lines: [
      { material: "MX-HARD-HDI", pct: "80" },
      { material: "MX-THIN-U", balance: true },
    ],
  },
  {
    code: "CP-PU100K",
    nameJa: "2液ウレタン塗料 白 セット PU-100 (4:1)",
    nameEn: "Two-pack urethane coating set PU-100 (4:1)",
    material: false,
    uses: ["塗料"],
    model: "MX-2",
    aliases: ["PU-100", "PU100SET"],
    note: "主剤と硬化剤を混ぜた出荷形態。ここから数えると物質まで5段下りる",
    lines: [
      { material: "CP-PU100W", pct: "80" },
      { material: "CP-PU100H", pct: "20" },
    ],
  },
  {
    code: "CP-PU200Y",
    nameJa: "2液ウレタン塗料 黄 主剤 PU-200Y",
    nameEn: "Two-pack urethane coating, yellow, base PU-200Y",
    material: true,
    uses: ["塗料"],
    model: "工業用グレード",
    note: "クロム酸鉛の分散体を25%使う。薄まったあとの含有率を確かめる例",
    lines: [
      { material: "MX-VAR-AC", pct: "42" },
      { material: "MX-DISP-YL", pct: "25" },
      { material: "MX-EXT-01", pct: "10" },
      { material: "MX-ADD-01", pct: "3" },
      { material: "MX-THIN-U", balance: true },
    ],
  },
  {
    code: "CP-EP50R",
    nameJa: "エポキシプライマー 赤さび 主剤 EP-50R",
    nameEn: "Epoxy primer, red oxide, base EP-50R",
    material: true,
    uses: ["塗料"],
    model: "工業用グレード",
    lines: [
      { material: "MX-VAR-EP", pct: "45" },
      { material: "MX-DISP-RD", pct: "20" },
      { material: "MX-EXT-01", pct: "12" },
      { material: "MX-ADD-01", pct: "2" },
      { material: "MX-THIN-U", balance: true },
    ],
  },
  {
    code: "CP-EP50H",
    nameJa: "エポキシプライマー 硬化剤 EP-50H",
    nameEn: "Epoxy primer, hardener EP-50H",
    material: true,
    uses: ["塗料"],
    model: "工業用グレード",
    lines: [
      { material: "MX-HARD-AM", pct: "70" },
      { material: "MX-THIN-U", balance: true },
    ],
  },
  {
    code: "CP-EP50K",
    nameJa: "エポキシプライマー セット EP-50 (3:1)",
    nameEn: "Epoxy primer set EP-50 (3:1)",
    material: false,
    uses: ["塗料"],
    model: "MX-2",
    aliases: ["EP-50"],
    lines: [
      { material: "CP-EP50R", pct: "75" },
      { material: "CP-EP50H", pct: "25" },
    ],
  },
  {
    code: "CP-THIN-U",
    nameJa: "ウレタン塗料用シンナー T-100",
    nameEn: "Urethane thinner T-100",
    material: false,
    uses: ["塗料"],
    model: "工業用グレード",
    note: "原料をそのまま製品として出す例（組成は1行だけ）",
    lines: [{ material: "MX-THIN-U", pct: "100" }],
  },
  {
    code: "CP-CLN-R",
    nameJa: "洗浄用リサイクルシンナー C-90",
    nameEn: "Recycled cleaning thinner C-90",
    material: false,
    uses: ["洗浄剤"],
    model: "工業用グレード",
    lines: [{ material: "MX-SOL-RC", pct: "100" }],
  },
];

const normalize = (code: string) => code.trim().toUpperCase();

/** このスクリプトが作ったものだけを消す */
async function remove() {
  const where = { OR: SEED_PREFIXES.map((p) => ({ codeNormalized: { startsWith: p } })) };
  const lines = await prisma.compositionLine.deleteMany({ where: { parentProduct: where } });
  const products = await prisma.product.deleteMany({ where });
  const substances = await prisma.substance.deleteMany({ where });
  console.warn(
    `消しました — 組成行 ${lines.count} / 製品・原材料 ${products.count} / 物質 ${substances.count}`,
  );
}

async function seed() {
  // 作り直せるよう、同じコードのものは先に消す
  await remove();

  const admin = await prisma.user.findFirst({
    where: { deletedAt: null, permissions: { some: { permission: "ADMIN" } } },
    select: { id: true },
  });
  const createdBy = admin?.id ?? null;

  const substanceIds = new Map<string, string>();
  for (const s of SUBSTANCES) {
    const row = await prisma.substance.create({
      data: {
        code: s.code,
        codeNormalized: normalize(s.code),
        nameJa: s.nameJa,
        nameEn: s.nameEn,
        casNumber: s.cas,
        casNormalized: s.cas ? normalize(s.cas) : null,
        note: s.note ?? null,
        status: "ACTIVE",
        publishState: "PUBLISHED",
        createdBy,
        aliases: {
          create: (s.aliases ?? []).map((nameJa, i) => ({ nameJa, displayOrder: i + 1 })),
        },
      },
      select: { id: true },
    });
    substanceIds.set(s.code, row.id);
  }

  /*
   * CASごとの代表物質。画面から登録すればアプリ側が立ててくれるが、
   * ここは直接書き込むので自分で立てる（決め方は ensureCasRepresentative と揃える）。
   * 二酸化チタン・エポキシ樹脂は seed-sample.ts 側が既に代表を持っているので、そちらは奪わない。
   */
  const candidateOf = new Map<string, string>();
  for (const sub of SUBSTANCES) {
    if (!sub.cas) continue;
    const cas = normalize(sub.cas);
    if (candidateOf.has(cas)) continue;
    const id = substanceIds.get(sub.code);
    if (id) candidateOf.set(cas, id);
  }

  let assigned = 0;
  for (const [cas, id] of candidateOf) {
    const taken = await prisma.substance.findFirst({
      where: { casNormalized: cas, deletedAt: null, isCasRepresentative: true },
      select: { id: true },
    });
    if (taken) continue;
    await prisma.substance.update({ where: { id }, data: { isCasRepresentative: true } });
    assigned += 1;
  }

  const productIds = new Map<string, string>();
  for (const p of PRODUCTS) {
    const row = await prisma.product.create({
      data: {
        code: p.code,
        codeNormalized: normalize(p.code),
        nameJa: p.nameJa,
        nameEn: p.nameEn,
        note: p.note ?? null,
        status: "ACTIVE",
        publishState: "PUBLISHED",
        usableAsMaterial: p.material,
        modelValue: p.model ?? null,
        createdBy,
        uses: { create: (p.uses ?? []).map((value, i) => ({ value, displayOrder: i + 1 })) },
        aliases: {
          create: (p.aliases ?? []).map((nameJa, i) => ({ nameJa, displayOrder: i + 1 })),
        },
      },
      select: { id: true },
    });
    productIds.set(p.code, row.id);

    await prisma.compositionLine.createMany({
      data: p.lines.map((line, i) => {
        const balance = "balance" in line;
        return {
          parentProductId: row.id,
          substanceId: "substance" in line ? (substanceIds.get(line.substance) ?? null) : null,
          childProductId: "material" in line ? (productIds.get(line.material) ?? null) : null,
          contentPct: balance ? null : line.pct,
          isBalance: balance,
          note: line.note ?? null,
          displayOrder: i + 1,
        };
      }),
    });
  }

  const materials = PRODUCTS.filter((p) => p.code.startsWith("MX-")).length;
  console.warn(
    `入れました — 物質 ${SUBSTANCES.length} / 混合物原料 ${materials} / ` +
      `製品 ${PRODUCTS.length - materials} / ` +
      `組成行 ${PRODUCTS.reduce((n, p) => n + p.lines.length, 0)} / CASの代表 ${assigned}`,
  );
  console.warn("組成を見るなら CP-PU100K（2液ウレタン塗料 白 セット）から。物質まで5段下ります。");
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
