/**
 * 備考に書いてある「適用条件」を、適用条件の欄へ移す。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/move-applicable-conditions.ts
 *   ... scripts/move-applicable-conditions.ts --write
 *
 * **移すのは「含有率以外で判定が変わるもの」だけ。**
 * 用途・剤型・形状・容器・製品の種類など、こちらの持っている組成だけでは
 * 当たり外れを決められないもの。適用条件に何か入っていれば、
 * 判定は当たったときに必ず要確認を出す。
 *
 * **含有率だけで書かれた但し書きは移さない。**
 * 「○％以下を含有するものを除く。」は閾値として入れてあり、判定で扱えている。
 * これを移すと、閾値で片が付いている号まで全部要確認になり、印の意味が薄まる。
 *
 * 備考には出どころ（「毒物及び劇物指定令」など）が残る。
 * 但し書きの部分だけを切り出して移す。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 但し書きの始まり。ここから後ろが条件 */
const PROVISO = "ただし、";

/**
 * 含有率だけの但し書きかどうかを見る形。
 *
 * **物質名に括弧が入るものが多い**（ジメチル―（イソプロピルチオエチル）―… など）ので、
 * 括弧の有無では分けられない。末尾の言い回しで見て、
 * そこに剤型・形状・容器などの言葉が混じっていなければ「含有率だけ」と見なす
 */
const PCT_TAIL = /[0-9０-９〇一二三四五六七八九十百千・．]+％以下を含有するものを除く。?$/;

/**
 * 含有率以外で判定が変わることを示す言い回し。
 * 但し書きでない行は、これが入っているときだけ移す。
 * 但し書きのほうは、これが混じっていれば「含有率だけではない」と見なす
 */
const HINTS = [
  "製剤",
  "徐放性",
  "マイクロカプセル",
  "粉状",
  "粉粒状",
  "焼結",
  "ガラス状態",
  "容器",
  "爆発薬",
  "用途",
  "使用",
  "剤型",
  "形状",
  "特化則",
  // 「〜のみが対象」「六価のものだけが対象」など、対象を絞る言い回し
  "が対象",
  "に限る",
  "適用除外",
  "次に掲げる",
  "に該当するものを除く",
  // 製品の種類で扱いが変わるもの（RoHS の医療機器・監視制御機器など）
  "機器",
  "医薬品",
  "化粧品",
  "食品",
  "農薬",
  "業務",
  "工業用",
  "包装",
  "塗料",
];

/**
 * **こちらが取り込みのときに付けた覚え書き。**
 *
 * 適用条件に書くのは**法文の言葉だけ**。
 * 要約や、こちらの都合（判定では見ていない、など）を書くと、
 * 「法律がそう決めている」と読めてしまう。覚え書きは備考に残す
 */
const OWN_MEMO = [
  "判定では見ていない",
  "附属書IIIに用途ごとの適用除外がある",
  "他の9物質と違い",
  "CASからは酸化数を判別できない",
  "医療機器と監視制御機器（産業用を含む）は",
  "名前は外部データベースの物質名",
];

/**
 * こちらが付けた見出し。
 * この行に法文の言葉が混じっているときは、**括弧の中だけ**を取り出す
 * （「まとめ名称: ダイオキシン類（令別表第３第１号３に掲げる物に該当するものを除く。）」など）
 */
const OWN_LABEL = /^(CAS[:：]|出典[:：]|まとめ名称[:：])/;

/** 括弧の中の、法文の但し書き */
const IN_PARENS = /（([^（）]*(?:除く|に限る)[^（）]*)）/;

/**
 * 覚え書きに付けていた強調の印（**）を落とす。
 * 備考は開発の覚え書きとして書いていたが、適用条件は画面にそのまま出る欄なので、
 * 印がそのまま文字として見えてしまう
 */
function clean(text: string) {
  return text.replace(/\*\*/g, "").trim();
}

/**
 * 1行を「備考に残すもの」と「適用条件へ移すもの」に分ける。
 * 但し書きがあれば、その手前（出どころ）は備考に残す
 */
export function splitLine(line: string): { keep: string; move: string | null } {
  // こちらの覚え書きは動かさない
  if (OWN_MEMO.some((w) => line.includes(w))) return { keep: line, move: null };
  /*
    こちらが付けた見出しの行。**法文の言葉は括弧の中だけ**なので、そこだけ取り出す。
    見出しごと動かすと、出どころの記録まで適用条件に混ざる
  */
  if (OWN_LABEL.test(line)) {
    const found = IN_PARENS.exec(line);
    return { keep: line, move: found ? clean(found[1] ?? "") : null };
  }
  const at = line.indexOf(PROVISO);
  if (at >= 0) {
    const body = line.slice(at + PROVISO.length).trim();
    // 含有率だけの但し書きは閾値で表せている。動かさない
    if (PCT_TAIL.test(body) && !HINTS.some((h) => body.includes(h))) {
      return { keep: line, move: null };
    }
    return { keep: line.slice(0, at).trim(), move: clean(line.slice(at)) };
  }
  if (HINTS.some((h) => line.includes(h))) return { keep: "", move: clean(line) };
  return { keep: line, move: null };
}

/** 備考ぜんたいを分ける。行（改行）と、行の中の区切り（／）の両方で見る */
export function splitNote(note: string): { keep: string | null; move: string | null } {
  const keptLines: string[] = [];
  const moved: string[] = [];
  for (const line of note.split("\n")) {
    const keptParts: string[] = [];
    for (const part of line.split("／")) {
      const t = part.trim();
      if (!t) continue;
      const { keep, move } = splitLine(t);
      if (keep) keptParts.push(keep);
      if (move) moved.push(move);
    }
    if (keptParts.length > 0) keptLines.push(keptParts.join("／"));
  }
  return {
    keep: keptLines.length > 0 ? keptLines.join("\n") : null,
    move: moved.length > 0 ? moved.join("\n") : null,
  };
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const rows = await prisma.statutorySubstance.findMany({
    where: { deletedAt: null, NOT: { note: null }, note: { not: "" } },
    select: {
      id: true,
      officialNumber: true,
      nameOriginal: true,
      note: true,
      applicableCondition: true,
    },
  });
  console.log(`備考のある法文物質名: ${rows.length} 件`);

  let moved = 0;
  let skipped = 0;
  const samples: string[] = [];
  for (const r of rows) {
    const { keep, move } = splitNote(r.note ?? "");
    if (move === null) continue;
    // 既に適用条件が入っているものは触らない（手で書いたものを上書きしない）
    if ((r.applicableCondition ?? "").trim() !== "") {
      skipped += 1;
      continue;
    }
    moved += 1;
    if (samples.length < 20) {
      samples.push(
        `  ${String(r.officialNumber ?? "").padEnd(10)} ${(r.nameOriginal ?? "").slice(0, 20)}\n` +
          `      → 適用条件: ${move.replace(/\n/g, " ").slice(0, 90)}\n` +
          `      → 備考残り: ${(keep ?? "（空）").replace(/\n/g, " ").slice(0, 60)}`,
      );
    }
    if (write) {
      await prisma.statutorySubstance.update({
        where: { id: r.id },
        data: { applicableCondition: move, note: keep },
      });
    }
  }

  console.log(`\n移す: ${moved} 件`);
  if (skipped > 0) console.log(`既に適用条件が入っていて触らない: ${skipped} 件`);
  console.log("\n例:");
  for (const s of samples) console.log(s);
  console.log(write ? "\n書き込みました" : "\n下見だけ。書き込むなら --write");
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("move-applicable-conditions")) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
