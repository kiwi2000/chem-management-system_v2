/**
 * フィードバックの見本を入れる管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/seed-feedback-sample.ts            入れる（入れ直し）
 *   npx tsx scripts/seed-feedback-sample.ts --remove   入れたものを消す
 *
 * 未読の印と未完了の件数を確かめるためのもの。次の3つを混ぜてある。
 *
 *  - **他の人が書いたもの** … 未読になる
 *  - **自分が書いたもの**   … 未読にならない（自分の書き込みで自分に知らせても意味が無い）
 *  - **自分の書き込みに、他の人が返事を付けたもの** … 返事も未読になる
 *
 * 状態も散らしてある。**「完了」は未完了の数に入らない。**
 *
 * 入れるものは題名の先頭に MARK を付ける。--remove はこれを目印に消すので、
 * 手で書いたものは巻き込まない。
 */
import {
  PrismaClient,
  type FeedbackKind,
  type FeedbackPriority,
  type FeedbackStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

/** このスクリプトが作るものの目印 */
const MARK = "【見本】";

/** 見本を見る人。この人から見て何件が未読になるかを、最後に出す */
const VIEWER = "morisawa@espace-japan.com";

interface Seed {
  title: string;
  body: string;
  kind: FeedbackKind;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  /** 書いた人。メールアドレスで指す */
  author: string;
  /** 返事。付けた人が「最後に触った人」になる */
  reply?: { by: string; text: string };
}

const SEEDS: Seed[] = [
  {
    title: "物質の一覧で、CAS番号の並べ替えが数字の順にならない",
    body: "CAS番号の列で並べ替えると、100-42-5 が 71-43-2 より前に来てしまいます。文字として並べているように見えます。",
    kind: "BUG",
    priority: "HIGH",
    status: "OPEN",
    author: "editor@example.com",
  },
  {
    title: "製品の検索に、社内の管理番号でも当たるようにしてほしい",
    body: "普段は製品名ではなく管理番号で呼んでいるので、そちらでも探せると助かります。",
    kind: "REQUEST",
    priority: "MEDIUM",
    status: "IN_PROGRESS",
    author: "viewer@example.com",
  },
  {
    title: "法規制の画面で、区分を選んだあとに戻る場所が分かりにくい",
    body: "区分を開いたあと、元の一覧へどう戻ればよいのか迷いました。左上の矢印に気づくまで時間がかかりました。",
    kind: "OTHER",
    priority: "LOW",
    status: "ON_HOLD",
    author: "admin@example.com",
  },
  {
    title: "組成の合計が 100% にならない製品があるのは、どういう扱いですか",
    body: "残部（balance）を使っている製品で、合計が 99.8% と出ます。これは不具合でしょうか、それとも仕様でしょうか。",
    kind: "QUESTION",
    priority: "MEDIUM",
    status: "DONE",
    author: "editor@example.com",
    reply: {
      by: "admin@example.com",
      text: "仕様です。残部の行は、他の行を引いた残りとして計算しているため、端数の分だけ差が出ます。",
    },
  },
  {
    title: "印刷したときに表の右端が切れる",
    body: "物質の一覧をそのまま印刷すると、右の数列が用紙からはみ出します。",
    kind: "BUG",
    priority: "MEDIUM",
    status: "DONE",
    author: "viewer@example.com",
  },
  {
    title: "取込みファイルの見本がほしい",
    body: "外部データの取込みを試したいのですが、どんな形の表を用意すればよいのか分かりません。見本があると助かります。",
    kind: "REQUEST",
    priority: "HIGH",
    status: "OPEN",
    // 自分で書いて、まだ返事が無いもの。**これだけが未読にならない**
    author: VIEWER,
  },
  {
    title: "混合物の画面で、原材料の並び順を自分で決めたい",
    body: "配合の順に並べたいのですが、いまは登録した順に出ているようです。",
    kind: "REQUEST",
    priority: "LOW",
    status: "IN_PROGRESS",
    // 自分で書いたが、他の人が返事を付けた。**返事のぶんが未読になる**
    author: VIEWER,
    reply: {
      by: "admin@example.com",
      text: "並べ替えの手を付けられるようにする方向で考えています。",
    },
  },
];

async function main() {
  const remove = process.argv.includes("--remove");

  const deleted = await prisma.feedback.deleteMany({ where: { title: { startsWith: MARK } } });
  if (remove) {
    console.log(`消しました: ${deleted.count}件`);
    return;
  }
  if (deleted.count > 0) console.log(`前回のぶんを消しました: ${deleted.count}件`);

  // 出てくる人をまとめて引く。1人でも欠けていたら、途中まで入れずに止める
  const emails = [...new Set(SEEDS.flatMap((s) => [s.author, ...(s.reply ? [s.reply.by] : [])]))];
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const idOf = new Map(users.map((u) => [u.email, u.id]));
  const missing = emails.filter((e) => !idOf.has(e));
  if (missing.length > 0) {
    throw new Error(`この利用者が見つかりません: ${missing.join(", ")}`);
  }

  for (const s of SEEDS) {
    const author = idOf.get(s.author) as string;
    const replier = s.reply ? (idOf.get(s.reply.by) as string) : null;
    await prisma.feedback.create({
      data: {
        title: MARK + s.title,
        body: s.body,
        kind: s.kind,
        priority: s.priority,
        status: s.status,
        createdBy: author,
        // 最後に触った人。未読かどうかはこれで決まる
        updatedBy: replier ?? author,
        ...(s.reply ? { reply: s.reply.text, repliedBy: replier, repliedAt: new Date() } : {}),
      },
    });
  }

  const open = SEEDS.filter((s) => s.status !== "DONE").length;
  // 最後に触った人が自分なら未読にならない
  const unread = SEEDS.filter((s) => (s.reply?.by ?? s.author) !== VIEWER).length;
  console.log(`入れました: ${SEEDS.length}件（うち未完了 ${open}件）`);
  console.log(
    `${VIEWER} から見た未読: ${unread}件（自分で書いて返事も無いものだけが未読になりません）`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
