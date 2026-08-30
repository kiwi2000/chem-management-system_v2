/**
 * 実務で使いそうなドキュメントのテンプレートを3つ入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-doc-templates.ts
 *   ... scripts/seed-doc-templates.ts --write
 *   ... scripts/seed-doc-templates.ts --remove --write   入れたものを消す
 *
 * **見本として置くもの。**そのまま出しても形にはなるが、
 * 宣言の文言や宛名は会社ごとに違うので、複写して直して使う想定。
 *
 *   DOC-ROHS   不使用証明書（RoHS指令）      取引先へ出す。該当が無いことを示す
 *   DOC-SURVEY 化学物質含有調査 回答書        取引先の調査票に答える。組成と該当を並べる
 *   DOC-SDS15  法規制情報（SDS 第15項の下書き） 物質1件ぶん。SDSを書くときの材料
 */
import type { DocumentBlock, DocumentContent } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** ブロックの id。作り直しても同じになるよう、手で振る */
const id = (code: string, n: number) => `${code}-${String(n).padStart(2, "0")}`;

/** 文字だけの1行 */
const line = (text: string, align?: "left" | "center" | "right") => ({
  spans: [{ kind: "text" as const, text }],
  ...(align ? { align } : {}),
});

/** 差込項目を混ぜた1行 */
const mixed = (parts: (string | { field: string })[], align?: "left" | "center" | "right") => ({
  spans: parts.map((p) =>
    typeof p === "string"
      ? ({ kind: "text", text: p } as const)
      : ({ kind: "field", field: p.field } as const),
  ),
  ...(align ? { align } : {}),
});

/**
 * 不使用証明書（RoHS指令）。
 *
 * **該当が無いことを示す紙。**判定の表はRoHSの行だけに絞る。
 * 表が空なら「該当なし」と読める。1件でも出れば、出す前に気づける
 */
function rohs(): DocumentContent {
  const c = "rohs";
  const blocks: DocumentBlock[] = [
    {
      id: id(c, 1),
      kind: "heading",
      level: 1,
      lines: [line("不 使 用 証 明 書", "center")],
    },
    {
      id: id(c, 2),
      kind: "text",
      lines: [mixed(["発行日: ", { field: "doc.generatedAt" }], "right")],
    },
    {
      /*
        宛名。**「宛先を使う」印を付けた様式なので、作るときに組織から選ぶ。**
        選ばなければ空欄のまま出る（社内の控えとして使うこともある）
      */
      id: id(c, 3),
      kind: "text",
      lines: [mixed([{ field: "to.name" }, " 御中"]), mixed([{ field: "to.item.担当者" }])],
    },
    { id: id(c, 4), kind: "spacer", size: "md" },
    {
      id: id(c, 5),
      kind: "fields",
      width: 60,
      items: [
        { label: "製品コード", field: "product.code" },
        { label: "製品名", field: "product.nameJa" },
        { label: "型式", field: "product.modelName" },
        { label: "用途", field: "product.useName" },
      ],
    },
    {
      id: id(c, 6),
      kind: "fields",
      width: 40,
      items: [
        { label: "調査に使った法規制バージョン", field: "doc.version" },
        { label: "作成者", field: "doc.generatedBy" },
      ],
    },
    { id: id(c, 7), kind: "spacer", size: "md" },
    {
      id: id(c, 8),
      kind: "text",
      lines: [
        line(
          "上記製品について、EU RoHS指令（2011/65/EU）附属書IIに掲げる制限物質の含有状況を調査した結果を、下表のとおり報告します。",
        ),
      ],
    },
    {
      id: id(c, 9),
      kind: "table",
      table: "judgement",
      caption: "RoHS指令に該当した規制区分（空欄のときは該当なし）",
      columns: ["law", "category", "officialNumber", "statutoryName", "needsReview"],
      filters: [{ column: "law", op: "contains", value: "RoHS" }],
    },
    { id: id(c, 10), kind: "spacer", size: "sm" },
    {
      id: id(c, 11),
      kind: "text",
      lines: [
        line("【この証明について】"),
        line(
          "・判定は、当社が把握している組成（製品全体の重量比）と、上記バージョンの法規制データによります。",
        ),
        line(
          "・RoHS指令の閾値は均質材料あたりで定められています。製品全体では下回っていても、部位によっては超える場合があります。",
        ),
        line(
          "・附属書IIIおよび附属書IVの適用除外に当たるかどうかは、用途によって決まるため判定に含めていません。",
        ),
        line("・「要確認」の付いた行は、条文を確認したうえでご判断ください。"),
      ],
    },
    { id: id(c, 12), kind: "spacer", size: "lg" },
    {
      id: id(c, 13),
      kind: "fields",
      width: 60,
      items: [
        { label: "会社名", field: "org.name" },
        { label: "所属", field: "org.group" },
      ],
    },
    { id: id(c, 14), kind: "signature", width: 40, label: "責任者" },
  ];
  return { orientation: "portrait", blocks };
}

/**
 * 化学物質含有調査の回答書。
 *
 * **取引先の調査票に答えるための紙。**
 * 組成（CAS合算）と、該当した規制を並べて出す。列が多いので横向き
 */
function survey(): DocumentContent {
  const c = "survey";
  const blocks: DocumentBlock[] = [
    {
      id: id(c, 1),
      kind: "heading",
      level: 1,
      lines: [line("化学物質含有調査 回答書", "center")],
    },
    {
      id: id(c, 2),
      kind: "text",
      lines: [mixed([{ field: "to.name" }, " 御中"])],
    },
    {
      id: id(c, 3),
      kind: "fields",
      width: 50,
      items: [
        { label: "製品コード", field: "product.code" },
        { label: "製品名", field: "product.nameJa" },
        { label: "英語名", field: "product.nameEn" },
        { label: "型式", field: "product.modelName" },
      ],
    },
    {
      id: id(c, 4),
      kind: "fields",
      width: 50,
      items: [
        { label: "用途", field: "product.useName" },
        { label: "法規制バージョン", field: "doc.version" },
        { label: "回答日", field: "doc.generatedAt" },
        { label: "回答者", field: "doc.generatedBy" },
      ],
    },
    { id: id(c, 5), kind: "divider" },
    {
      id: id(c, 6),
      kind: "heading",
      level: 2,
      lines: [line("1. 含有成分（CAS番号でまとめたもの）")],
    },
    {
      id: id(c, 7),
      kind: "table",
      table: "compositionAggregate",
      columns: ["casNumber", "name", "totalPct", "note"],
    },
    { id: id(c, 8), kind: "spacer", size: "md" },
    {
      id: id(c, 9),
      kind: "heading",
      level: 2,
      lines: [line("2. 該当した法規制")],
    },
    {
      id: id(c, 10),
      kind: "table",
      table: "judgement",
      caption: "該当した規制区分と、当たった法文物質名",
      columns: ["law", "category", "officialNumber", "statutoryName", "needsReview"],
    },
    { id: id(c, 11), kind: "spacer", size: "sm" },
    {
      id: id(c, 12),
      kind: "text",
      lines: [
        line("【回答の前提】"),
        line("・含有率は製品全体に対する重量比です。均質材料あたりではありません。"),
        line("・組成の分からない原材料が含まれる場合、その分は含有率に数えていません。"),
        line(
          "・「要確認」の付いた行は、濃度以外の条件（用途・剤型など）があるか、判定の材料が足りないものです。",
        ),
      ],
    },
    { id: id(c, 13), kind: "spacer", size: "md" },
    {
      id: id(c, 14),
      kind: "fields",
      width: 60,
      items: [
        { label: "会社名", field: "org.name" },
        { label: "所属", field: "org.group" },
      ],
    },
    { id: id(c, 15), kind: "signature", width: 40, label: "回答責任者" },
  ];
  return { orientation: "landscape", blocks };
}

/**
 * 法規制情報（SDS 第15項の下書き）。
 *
 * **物質1件ぶん。**SDSを書くときの材料として出す。
 * そのままSDSに貼る紙ではないので、注意書きを最後に置く
 */
function sds15(): DocumentContent {
  const c = "sds15";
  const blocks: DocumentBlock[] = [
    {
      id: id(c, 1),
      kind: "heading",
      level: 1,
      lines: [line("法規制情報（SDS 第15項 下書き）")],
    },
    {
      id: id(c, 2),
      kind: "fields",
      width: 50,
      items: [
        { label: "物質コード", field: "substance.code" },
        { label: "CAS番号", field: "substance.casNumber" },
      ],
    },
    {
      id: id(c, 3),
      kind: "fields",
      width: 50,
      items: [
        { label: "日本語名", field: "substance.nameJa" },
        { label: "英語名", field: "substance.nameEn" },
      ],
    },
    { id: id(c, 4), kind: "divider" },
    {
      id: id(c, 5),
      kind: "heading",
      level: 2,
      lines: [line("該当する法規制")],
    },
    {
      id: id(c, 6),
      kind: "table",
      table: "substanceRegulation",
      columns: ["law", "category", "officialNumber", "statutoryName"],
    },
    { id: id(c, 7), kind: "spacer", size: "md" },
    {
      id: id(c, 8),
      kind: "heading",
      level: 2,
      lines: [line("各国のインベントリ番号")],
    },
    {
      id: id(c, 9),
      kind: "table",
      table: "substanceInventory",
      columns: ["inventory", "country", "value"],
    },
    { id: id(c, 10), kind: "spacer", size: "sm" },
    {
      id: id(c, 11),
      kind: "text",
      lines: [
        line("【この下書きについて】"),
        line(
          "・登録済みの法規制データから機械的に作ったものです。SDSに載せる前に、条文と最新の改正を確認してください。",
        ),
        mixed(["・使った法規制バージョン: ", { field: "doc.version" }]),
        mixed([
          "・作成: ",
          { field: "doc.generatedAt" },
          "　",
          { field: "doc.generatedBy" },
          "（",
          { field: "org.name" },
          "）",
        ]),
      ],
    },
  ];
  return { orientation: "portrait", blocks };
}

const TEMPLATES = [
  {
    code: "DOC-ROHS",
    nameJa: "不使用証明書（RoHS指令）",
    nameEn: "Declaration of non-inclusion (EU RoHS)",
    target: "PRODUCT" as const,
    usesRecipient: true,
    note: "見本。取引先へ出す証明書。宣言の文言は会社ごとに直して使ってください",
    content: rohs(),
  },
  {
    code: "DOC-SURVEY",
    nameJa: "化学物質含有調査 回答書",
    nameEn: "Chemical content survey reply",
    target: "PRODUCT" as const,
    usesRecipient: true,
    note: "見本。組成と該当法規を並べた回答書。列が多いので横向き",
    content: survey(),
  },
  {
    code: "DOC-SDS15",
    nameJa: "法規制情報（SDS 第15項 下書き）",
    nameEn: "Regulatory information (SDS section 15 draft)",
    target: "SUBSTANCE" as const,
    // 社内で使う下書きなので宛名は置かない
    usesRecipient: false,
    note: "見本。物質1件ぶん。SDSを書くときの材料",
    content: sds15(),
  },
];

async function main() {
  const write = process.argv.includes("--write");
  const remove = process.argv.includes("--remove");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const codes = TEMPLATES.map((t) => t.code.toUpperCase());
  if (remove) {
    const n = await prisma.documentTemplate.count({ where: { codeNormalized: { in: codes } } });
    console.log(`消すもの: ${n} 件`);
    if (write) {
      await prisma.documentTemplate.deleteMany({ where: { codeNormalized: { in: codes } } });
      console.log("消しました");
    }
    await prisma.$disconnect();
    return;
  }

  for (const t of TEMPLATES) {
    const blocks = t.content.blocks.length;
    console.log(`  ${t.code.padEnd(11)} ${t.nameJa} / ${t.target} / ブロック${blocks}`);
    if (!write) continue;
    await prisma.documentTemplate.upsert({
      where: { codeNormalized: t.code.toUpperCase() },
      create: {
        code: t.code,
        codeNormalized: t.code.toUpperCase(),
        nameJa: t.nameJa,
        nameEn: t.nameEn,
        target: t.target,
        locale: "JA",
        usesRecipient: t.usesRecipient,
        note: t.note,
        content: t.content as unknown as object,
      },
      update: {
        nameJa: t.nameJa,
        nameEn: t.nameEn,
        target: t.target,
        usesRecipient: t.usesRecipient,
        note: t.note,
        content: t.content as unknown as object,
      },
    });
  }
  console.log(write ? "\n入れました" : "\n下見だけ。入れるなら --write");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
