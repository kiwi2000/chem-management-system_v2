import { DEFAULT_SETTINGS, SETTING_DEFS, type AppSettings } from "@chem/shared";
import { cache } from "react";
import { prisma } from "@/lib/db";

/**
 * システム設定の読み書き。
 * 未設定のキーは既定値にフォールバックするので、初期状態でも動く（初回投入は不要）。
 *
 * 同じリクエストの中では何度呼んでも1回しか引かない（cache）。
 * 自動ログアウトの判定でセッション確認のたびに読むので、素のままだと同じ問い合わせが並ぶ。
 */
export const getAppSettings = cache(async function getAppSettings(): Promise<AppSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: SETTING_DEFS.map((d) => d.key) } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const settings = { ...DEFAULT_SETTINGS };
  for (const def of SETTING_DEFS) {
    const raw = byKey.get(def.key);
    if (raw === undefined || raw === null) continue;
    // 読めない値（手でDBを書き換えた等）は既定のままにする
    const parsed = def.parse(raw);
    if (parsed !== null) Object.assign(settings, { [def.field]: parsed });
  }
  return settings;
});

export async function saveAppSettings(next: AppSettings, actorId: string): Promise<void> {
  await prisma.$transaction(
    SETTING_DEFS.map((def) => {
      const value = def.format ? def.format(next[def.field]) : String(next[def.field]);
      return prisma.systemSetting.upsert({
        where: { key: def.key },
        update: { value, updatedBy: actorId },
        create: {
          key: def.key,
          value,
          valueType: def.valueType,
          defaultValue: def.format
            ? def.format(DEFAULT_SETTINGS[def.field])
            : String(DEFAULT_SETTINGS[def.field]),
          updatedBy: actorId,
        },
      });
    }),
  );
}
