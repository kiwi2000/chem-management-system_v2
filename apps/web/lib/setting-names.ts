import type { AppSettings, Messages } from "@chem/shared";

/**
 * システム設定の項目の、画面での呼び名（アクセス記録に「何を変えたか」を出すのに使う。2026-11-17）。
 *
 * 設定の画面は、項目名だけでは何の設定か分からないものがある（「最小の文字数」「形式」など）。
 * 見出し（どのまとまりか）を前に付けて、「パスワード規則 › 最小の文字数」の形で返す。
 *
 * **設定の項目を足したら、ここにも足す。**足し忘れは `setting-names.test.ts` が検出する
 */
type Name = (m: Messages) => { section?: string; item?: string };

const NAMES: Record<keyof AppSettings, Name> = {
  maintenanceMode: (m) => ({ item: m.settings.maintenanceMode }),
  casRequired: (m) => ({ item: m.settings.casRequired }),
  casFormatEnforced: (m) => ({ item: m.settings.casFormatEnforced }),
  compositionValidationMode: (m) => ({
    section: m.settings.compositionSection,
    item: m.settings.validationMode,
  }),
  compositionEpsilonPct: (m) => ({
    section: m.settings.compositionSection,
    item: m.settings.epsilonPct,
  }),
  conditionalLinkMode: (m) => ({ item: m.settings.conditionalLinkMode }),
  categoryScoreMin: (m) => ({ section: m.score.range, item: m.score.rangeMin }),
  categoryScoreMax: (m) => ({ section: m.score.range, item: m.score.rangeMax }),
  substanceApprovalRequired: (m) => ({ item: m.settings.substanceApprovalRequired }),
  productApprovalRequired: (m) => ({ item: m.settings.productApprovalRequired }),
  passwordMinLength: (m) => ({
    section: m.settings.passwordSection,
    item: m.settings.passwordMinLength,
  }),
  passwordRequireLetter: (m) => ({
    section: m.settings.passwordSection,
    item: m.settings.passwordRequireLetter,
  }),
  passwordRequireDigit: (m) => ({
    section: m.settings.passwordSection,
    item: m.settings.passwordRequireDigit,
  }),
  passwordRequireSymbol: (m) => ({
    section: m.settings.passwordSection,
    item: m.settings.passwordRequireSymbol,
  }),
  passwordRequireMixedCase: (m) => ({
    section: m.settings.passwordSection,
    item: m.settings.passwordRequireMixedCase,
  }),
  passwordSymbolChars: (m) => ({
    section: m.settings.passwordSection,
    item: m.settings.passwordSymbolChars,
  }),
  passwordExpiryDays: (m) => ({
    section: m.settings.passwordExpirySection,
    item: m.settings.passwordExpiryDays,
  }),
  passwordExpiryWarnDays: (m) => ({
    section: m.settings.passwordExpirySection,
    item: m.settings.passwordExpiryWarnDays,
  }),
  sessionIdleMinutes: (m) => ({ item: m.settings.sessionIdleMinutes }),
  accessLogRetentionDays: (m) => ({ item: m.settings.accessLogRetentionDays }),
  accessLogRetentionMode: (m) => ({
    section: m.settings.accessLogRetentionSection,
    item: m.settings.accessLogRetentionMode,
  }),
  accessLogArchiveDir: (m) => ({
    section: m.settings.accessLogRetentionSection,
    item: m.settings.accessLogArchiveDir,
  }),
  // 「制限しない／許可リスト／拒否リスト」の切り替え。項目に名前が無いので、見出しで呼ぶ
  ipFilterMode: (m) => ({ section: m.settings.ipFilterSection }),
  ipAllowList: (m) => ({ section: m.settings.ipFilterSection, item: m.settings.ipAllowList }),
  ipDenyList: (m) => ({ section: m.settings.ipFilterSection, item: m.settings.ipDenyList }),
  mfaRequired: (m) => ({ item: m.settings.mfaRequired }),
  productModelOptions: (m) => ({
    section: m.settings.productSection,
    item: m.settings.modelOptions,
  }),
  productUseOptions: (m) => ({ section: m.settings.productSection, item: m.settings.useOptions }),
  documentOutputDir: (m) => ({ item: m.settings.outputDir }),
  documentFileNamePattern: (m) => ({ item: m.settings.fileNamePattern }),
  imageMaxEdgePx: (m) => ({ section: m.settings.imageSection, item: m.settings.imageMaxEdge }),
  imageFormat: (m) => ({ section: m.settings.imageSection, item: m.settings.imageFormat }),
  imageJpegQuality: (m) => ({
    section: m.settings.imageSection,
    item: m.settings.imageJpegQuality,
  }),
  attachmentMaxMb: (m) => ({
    section: m.settings.attachmentSection,
    item: m.settings.attachmentMaxMb,
  }),
  attachmentAllowMacros: (m) => ({ item: m.settings.attachmentAllowMacros }),
  attachmentKinds: (m) => ({
    section: m.settings.attachmentSection,
    item: m.settings.attachmentKinds,
  }),
  attachmentExtensions: (m) => ({
    section: m.settings.attachmentSection,
    item: m.settings.attachmentExtensions,
  }),
  appNameJa: (m) => ({ item: m.settings.appNameJa }),
  appNameEn: (m) => ({ item: m.settings.appNameEn }),
  headerIconVersion: (m) => ({ item: m.settings.headerIcon }),
  headerIconPosition: (m) => ({ item: m.settings.headerIconPosition }),
  headerHideName: (m) => ({ item: m.settings.headerHideName }),
};

/** 設定の項目の呼び名。知らない項目（古い記録にだけ残っている名前）は、名前をそのまま返す */
export function settingName(m: Messages, field: string): string {
  const name = (NAMES as Record<string, Name | undefined>)[field];
  if (!name) return field;
  const { section, item } = name(m);
  return section && item ? `${section} › ${item}` : (item ?? section ?? field);
}
