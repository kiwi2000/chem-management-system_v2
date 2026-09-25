import { HEADER_ICON_DATA_KEY, SETTING_DEFS } from "@chem/shared";
import { prisma } from "@/lib/db";

/**
 * 題字の横のアイコン（2026-09-25 指示）。
 *
 * **本体は system_settings の 1 行に持つ。**画像ライブラリに入れると、テンプレートを直す人が
 * 一覧から消せてしまい、題字のアイコンが黙って消える。設定の一部として設定と一緒に持つ。
 * 行の値は `mime;base64,…`。預けた時刻は普通の設定（headerIconVersion）に書き、
 * 画面はそれを URL に付けてブラウザの覚えを切り替える
 */

const VERSION_KEY = SETTING_DEFS.find((d) => d.field === "headerIconVersion")!.key;

export interface HeaderIcon {
  mime: string;
  bytes: Buffer;
}

/** いまのアイコン。預けていなければ null */
export async function getHeaderIcon(): Promise<HeaderIcon | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: HEADER_ICON_DATA_KEY },
    select: { value: true },
  });
  const raw = row?.value;
  if (!raw) return null;
  const sep = raw.indexOf(";base64,");
  if (sep < 0) return null;
  return { mime: raw.slice(0, sep), bytes: Buffer.from(raw.slice(sep + 8), "base64") };
}

/** 預ける。本体と時刻を同時に書く（片方だけ残らないように）。返すのは新しい時刻 */
export async function saveHeaderIcon(icon: HeaderIcon, actorId: string): Promise<string> {
  const version = String(Date.now());
  const value = `${icon.mime};base64,${icon.bytes.toString("base64")}`;
  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: HEADER_ICON_DATA_KEY },
      update: { value, updatedBy: actorId },
      create: { key: HEADER_ICON_DATA_KEY, value, valueType: "STRING", updatedBy: actorId },
    }),
    prisma.systemSetting.upsert({
      where: { key: VERSION_KEY },
      update: { value: version, updatedBy: actorId },
      create: {
        key: VERSION_KEY,
        value: version,
        valueType: "STRING",
        defaultValue: "",
        updatedBy: actorId,
      },
    }),
  ]);
  return version;
}

/** 外す。本体の行は消し、時刻は空に戻す */
export async function clearHeaderIcon(actorId: string): Promise<void> {
  await prisma.$transaction([
    prisma.systemSetting.deleteMany({ where: { key: HEADER_ICON_DATA_KEY } }),
    prisma.systemSetting.upsert({
      where: { key: VERSION_KEY },
      update: { value: "", updatedBy: actorId },
      create: {
        key: VERSION_KEY,
        value: "",
        valueType: "STRING",
        defaultValue: "",
        updatedBy: actorId,
      },
    }),
  ]);
}
