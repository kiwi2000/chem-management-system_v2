-- 混合物の GHS 判定で成分に付ける印（国連 3.1.3.3 ほか）を、物質の拡張属性の既定項目として足す（2026-10-18）。
-- 「1 % 未満でも考慮する」「加成方式が使えない（酸・塩基・無機塩・アルデヒド・フェノール・界面活性剤など）」「急性毒性なしとみなす（水・糖など）」。
-- 既にある環境では手を付けない（ON CONFLICT DO NOTHING）
INSERT INTO "property_defs" ("id", "target", "key", "label_ja", "label_en", "data_type", "default_unit", "display_order", "active_flag", "group", "system_flag", "created_at", "updated_at") VALUES
  ('sys_substance_ghs_relevant_below_cutoff', 'SUBSTANCE', 'ghs_relevant_below_cutoff', '混合物の分類で 1 % 未満でも考慮する', 'Relevant for mixture classification below the cut-off', 'CHOICE', NULL, 1200, true, 'HEALTH', true, now(), now()),
  ('sys_substance_ghs_non_additive', 'SUBSTANCE', 'ghs_non_additive', '皮膚・眼で加成方式が使えない成分', 'Additivity does not apply (skin/eye)', 'CHOICE', NULL, 1210, true, 'HEALTH', true, now(), now()),
  ('sys_substance_ghs_no_acute_toxicity', 'SUBSTANCE', 'ghs_no_acute_toxicity', '急性毒性なしとみなす（水・糖など）', 'Assumed to have no acute toxicity (water, sugar, etc.)', 'CHOICE', NULL, 1220, true, 'HEALTH', true, now(), now())
ON CONFLICT ("target", "key") DO NOTHING;

INSERT INTO "property_options" ("id", "property_def_id", "kind", "code", "label_ja", "label_en", "display_order")
SELECT v."id", v."property_def_id", v."kind"::"PropertyOptionKind", v."code", v."label_ja", v."label_en", v."display_order" FROM (VALUES
  ('sys_substance_ghs_relevant_below_cutoff_value_yes', 'sys_substance_ghs_relevant_below_cutoff', 'VALUE', 'yes', 'はい', 'Yes', 10),
  ('sys_substance_ghs_relevant_below_cutoff_value_no', 'sys_substance_ghs_relevant_below_cutoff', 'VALUE', 'no', 'いいえ', 'No', 20),
  ('sys_substance_ghs_non_additive_value_yes', 'sys_substance_ghs_non_additive', 'VALUE', 'yes', 'はい', 'Yes', 10),
  ('sys_substance_ghs_non_additive_value_no', 'sys_substance_ghs_non_additive', 'VALUE', 'no', 'いいえ', 'No', 20),
  ('sys_substance_ghs_no_acute_toxicity_value_yes', 'sys_substance_ghs_no_acute_toxicity', 'VALUE', 'yes', 'はい', 'Yes', 10),
  ('sys_substance_ghs_no_acute_toxicity_value_no', 'sys_substance_ghs_no_acute_toxicity', 'VALUE', 'no', 'いいえ', 'No', 20)
) AS v("id", "property_def_id", "kind", "code", "label_ja", "label_en", "display_order")
WHERE EXISTS (SELECT 1 FROM "property_defs" d WHERE d."id" = v."property_def_id")
ON CONFLICT ("property_def_id", "kind", "code") DO NOTHING;
