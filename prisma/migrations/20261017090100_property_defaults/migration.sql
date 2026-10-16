-- GHS 判定・SDS に使う拡張属性を、最初から入れておく（2026-10-17 指示）
-- システムの項目（system_flag）として入れる。消せず、種類も変えられない（GHS 判定・SDS がキーで読むため）。
-- 名前・単位・表示順・まとまり・選択肢・「使わない」は管理者が変えてよい。
-- 同じキーの項目が既にある環境では、その項目には手を付けない（ON CONFLICT DO NOTHING。選択肢も足さない）

-- 製品の項目
INSERT INTO "property_defs" ("id", "target", "key", "label_ja", "label_en", "data_type", "default_unit", "display_order", "active_flag", "group", "system_flag", "created_at", "updated_at") VALUES
  ('sys_product_physical_state', 'PRODUCT', 'physical_state', '物理状態', 'Physical state', 'CHOICE', NULL, 1000, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_form', 'PRODUCT', 'form', '形状', 'Form', 'CHOICE', NULL, 1010, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_color', 'PRODUCT', 'color', '色', 'Colour', 'TEXT', NULL, 1020, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_odor', 'PRODUCT', 'odor', '臭い', 'Odour', 'TEXT', NULL, 1030, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_ph', 'PRODUCT', 'ph', 'pH', 'pH', 'NUMBER', NULL, 1040, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_melting_point', 'PRODUCT', 'melting_point', '融点・凝固点', 'Melting point / freezing point', 'NUMBER', '℃', 1050, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_initial_boiling_point', 'PRODUCT', 'initial_boiling_point', '初留点・沸点', 'Initial boiling point / boiling point', 'NUMBER', '℃', 1060, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_flash_point', 'PRODUCT', 'flash_point', '引火点', 'Flash point', 'NUMBER', '℃', 1070, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_autoignition_temperature', 'PRODUCT', 'autoignition_temperature', '自然発火温度', 'Auto-ignition temperature', 'NUMBER', '℃', 1080, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_decomposition_temperature', 'PRODUCT', 'decomposition_temperature', '分解温度', 'Decomposition temperature', 'NUMBER', '℃', 1090, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_lower_explosion_limit', 'PRODUCT', 'lower_explosion_limit', '爆発下限界', 'Lower explosion limit', 'NUMBER', 'vol%', 1100, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_upper_explosion_limit', 'PRODUCT', 'upper_explosion_limit', '爆発上限界', 'Upper explosion limit', 'NUMBER', 'vol%', 1110, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_vapour_pressure', 'PRODUCT', 'vapour_pressure', '蒸気圧', 'Vapour pressure', 'NUMBER', 'Pa', 1120, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_relative_vapour_density', 'PRODUCT', 'relative_vapour_density', '蒸気密度（空気＝1）', 'Relative vapour density (air = 1)', 'NUMBER', NULL, 1130, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_density', 'PRODUCT', 'density', '密度', 'Density', 'NUMBER', 'g/cm³', 1140, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_water_solubility', 'PRODUCT', 'water_solubility', '水溶解度', 'Solubility in water', 'NUMBER', 'g/L', 1150, true, 'PHYSICAL', true, now(), now()),
  ('sys_product_kinematic_viscosity_40c', 'PRODUCT', 'kinematic_viscosity_40c', '動粘性率（40℃）', 'Kinematic viscosity (40 °C)', 'NUMBER', 'mm²/s', 1160, true, 'PHYSICAL', true, now(), now())
ON CONFLICT ("target", "key") DO NOTHING;

INSERT INTO "property_options" ("id", "property_def_id", "kind", "code", "label_ja", "label_en", "display_order")
SELECT v."id", v."property_def_id", v."kind"::"PropertyOptionKind", v."code", v."label_ja", v."label_en", v."display_order" FROM (VALUES
  ('sys_product_physical_state_value_solid', 'sys_product_physical_state', 'VALUE', 'solid', '固体', 'Solid', 10),
  ('sys_product_physical_state_value_liquid', 'sys_product_physical_state', 'VALUE', 'liquid', '液体', 'Liquid', 20),
  ('sys_product_physical_state_value_gas', 'sys_product_physical_state', 'VALUE', 'gas', '気体', 'Gas', 30),
  ('sys_product_physical_state_condition_c20', 'sys_product_physical_state', 'CONDITION', 'c20', '20℃・101.3 kPa', '20 °C, 101.3 kPa', 10),
  ('sys_product_form_value_powder', 'sys_product_form', 'VALUE', 'powder', '粉末', 'Powder', 10),
  ('sys_product_form_value_granule', 'sys_product_form', 'VALUE', 'granule', '粒状', 'Granules', 20),
  ('sys_product_form_value_lump', 'sys_product_form', 'VALUE', 'lump', '塊状', 'Lumps', 30),
  ('sys_product_form_value_paste', 'sys_product_form', 'VALUE', 'paste', 'ペースト状', 'Paste', 40),
  ('sys_product_form_value_liquid', 'sys_product_form', 'VALUE', 'liquid', '液状', 'Liquid', 50),
  ('sys_product_form_value_gas', 'sys_product_form', 'VALUE', 'gas', '気体', 'Gas', 60),
  ('sys_product_form_value_aerosol', 'sys_product_form', 'VALUE', 'aerosol', 'エアゾール', 'Aerosol', 70),
  ('sys_product_ph_condition_neat', 'sys_product_ph', 'CONDITION', 'neat', '原液', 'Undiluted', 10),
  ('sys_product_ph_condition_aq1', 'sys_product_ph', 'CONDITION', 'aq1', '1% 水溶液', '1% aqueous solution', 20),
  ('sys_product_ph_condition_aq10', 'sys_product_ph', 'CONDITION', 'aq10', '10% 水溶液', '10% aqueous solution', 30),
  ('sys_product_initial_boiling_point_condition_p101', 'sys_product_initial_boiling_point', 'CONDITION', 'p101', '101.3 kPa', '101.3 kPa', 10),
  ('sys_product_flash_point_condition_closed_cup', 'sys_product_flash_point', 'CONDITION', 'closed_cup', '密閉式', 'Closed cup', 10),
  ('sys_product_flash_point_condition_open_cup', 'sys_product_flash_point', 'CONDITION', 'open_cup', '開放式', 'Open cup', 20),
  ('sys_product_vapour_pressure_condition_t20', 'sys_product_vapour_pressure', 'CONDITION', 't20', '20℃', '20 °C', 10),
  ('sys_product_vapour_pressure_condition_t25', 'sys_product_vapour_pressure', 'CONDITION', 't25', '25℃', '25 °C', 20),
  ('sys_product_vapour_pressure_condition_t50', 'sys_product_vapour_pressure', 'CONDITION', 't50', '50℃', '50 °C', 30),
  ('sys_product_density_condition_t20', 'sys_product_density', 'CONDITION', 't20', '20℃', '20 °C', 10),
  ('sys_product_density_condition_t25', 'sys_product_density', 'CONDITION', 't25', '25℃', '25 °C', 20),
  ('sys_product_water_solubility_condition_t20', 'sys_product_water_solubility', 'CONDITION', 't20', '20℃', '20 °C', 10),
  ('sys_product_water_solubility_condition_t25', 'sys_product_water_solubility', 'CONDITION', 't25', '25℃', '25 °C', 20)
) AS v("id", "property_def_id", "kind", "code", "label_ja", "label_en", "display_order")
JOIN "property_defs" d ON d."id" = v."property_def_id"
ON CONFLICT DO NOTHING;

-- 物質の項目
INSERT INTO "property_defs" ("id", "target", "key", "label_ja", "label_en", "data_type", "default_unit", "display_order", "active_flag", "group", "system_flag", "created_at", "updated_at") VALUES
  ('sys_substance_molecular_weight', 'SUBSTANCE', 'molecular_weight', '分子量', 'Molecular weight', 'NUMBER', 'g/mol', 1000, true, 'PHYSICAL', true, now(), now()),
  ('sys_substance_physical_state', 'SUBSTANCE', 'physical_state', '物理状態', 'Physical state', 'CHOICE', NULL, 1010, true, 'PHYSICAL', true, now(), now()),
  ('sys_substance_boiling_point', 'SUBSTANCE', 'boiling_point', '沸点', 'Boiling point', 'NUMBER', '℃', 1020, true, 'PHYSICAL', true, now(), now()),
  ('sys_substance_vapour_pressure', 'SUBSTANCE', 'vapour_pressure', '蒸気圧', 'Vapour pressure', 'NUMBER', 'Pa', 1030, true, 'PHYSICAL', true, now(), now()),
  ('sys_substance_water_solubility', 'SUBSTANCE', 'water_solubility', '水溶解度', 'Solubility in water', 'NUMBER', 'g/L', 1040, true, 'PHYSICAL', true, now(), now()),
  ('sys_substance_ld50_oral', 'SUBSTANCE', 'ld50_oral', '急性毒性 経口 LD50', 'Acute oral LD50', 'NUMBER', 'mg/kg', 1050, true, 'HEALTH', true, now(), now()),
  ('sys_substance_ld50_dermal', 'SUBSTANCE', 'ld50_dermal', '急性毒性 経皮 LD50', 'Acute dermal LD50', 'NUMBER', 'mg/kg', 1060, true, 'HEALTH', true, now(), now()),
  ('sys_substance_lc50_inhalation_gas', 'SUBSTANCE', 'lc50_inhalation_gas', '急性毒性 吸入 LC50（気体）', 'Acute inhalation LC50 (gas)', 'NUMBER', 'ppmV', 1070, true, 'HEALTH', true, now(), now()),
  ('sys_substance_lc50_inhalation_vapour', 'SUBSTANCE', 'lc50_inhalation_vapour', '急性毒性 吸入 LC50（蒸気）', 'Acute inhalation LC50 (vapour)', 'NUMBER', 'mg/L', 1080, true, 'HEALTH', true, now(), now()),
  ('sys_substance_lc50_inhalation_dust', 'SUBSTANCE', 'lc50_inhalation_dust', '急性毒性 吸入 LC50（粉じん・ミスト）', 'Acute inhalation LC50 (dust / mist)', 'NUMBER', 'mg/L', 1090, true, 'HEALTH', true, now(), now()),
  ('sys_substance_lc50_fish', 'SUBSTANCE', 'lc50_fish', '魚類 LC50（96 時間）', 'Fish LC50 (96 h)', 'NUMBER', 'mg/L', 1100, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_ec50_crustacea', 'SUBSTANCE', 'ec50_crustacea', '甲殻類 EC50（48 時間）', 'Crustacea EC50 (48 h)', 'NUMBER', 'mg/L', 1110, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_erc50_algae', 'SUBSTANCE', 'erc50_algae', '藻類 ErC50（72 時間）', 'Algae ErC50 (72 h)', 'NUMBER', 'mg/L', 1120, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_noec_chronic', 'SUBSTANCE', 'noec_chronic', '慢性毒性 NOEC', 'Chronic NOEC', 'NUMBER', 'mg/L', 1130, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_m_factor_acute', 'SUBSTANCE', 'm_factor_acute', 'M 係数（急性）', 'M-factor (acute)', 'NUMBER', NULL, 1140, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_m_factor_chronic', 'SUBSTANCE', 'm_factor_chronic', 'M 係数（慢性）', 'M-factor (chronic)', 'NUMBER', NULL, 1150, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_rapid_degradability', 'SUBSTANCE', 'rapid_degradability', '急速分解性', 'Rapid degradability', 'CHOICE', NULL, 1160, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_log_kow', 'SUBSTANCE', 'log_kow', 'log Kow（オクタノール／水分配係数）', 'log Kow (octanol/water partition coefficient)', 'NUMBER', NULL, 1170, true, 'ENVIRONMENT', true, now(), now()),
  ('sys_substance_bcf', 'SUBSTANCE', 'bcf', '生物濃縮係数（BCF）', 'Bioconcentration factor (BCF)', 'NUMBER', NULL, 1180, true, 'ENVIRONMENT', true, now(), now())
ON CONFLICT ("target", "key") DO NOTHING;

INSERT INTO "property_options" ("id", "property_def_id", "kind", "code", "label_ja", "label_en", "display_order")
SELECT v."id", v."property_def_id", v."kind"::"PropertyOptionKind", v."code", v."label_ja", v."label_en", v."display_order" FROM (VALUES
  ('sys_substance_physical_state_value_solid', 'sys_substance_physical_state', 'VALUE', 'solid', '固体', 'Solid', 10),
  ('sys_substance_physical_state_value_liquid', 'sys_substance_physical_state', 'VALUE', 'liquid', '液体', 'Liquid', 20),
  ('sys_substance_physical_state_value_gas', 'sys_substance_physical_state', 'VALUE', 'gas', '気体', 'Gas', 30),
  ('sys_substance_physical_state_condition_c20', 'sys_substance_physical_state', 'CONDITION', 'c20', '20℃・101.3 kPa', '20 °C, 101.3 kPa', 10),
  ('sys_substance_boiling_point_condition_p101', 'sys_substance_boiling_point', 'CONDITION', 'p101', '101.3 kPa', '101.3 kPa', 10),
  ('sys_substance_vapour_pressure_condition_t20', 'sys_substance_vapour_pressure', 'CONDITION', 't20', '20℃', '20 °C', 10),
  ('sys_substance_vapour_pressure_condition_t25', 'sys_substance_vapour_pressure', 'CONDITION', 't25', '25℃', '25 °C', 20),
  ('sys_substance_vapour_pressure_condition_t50', 'sys_substance_vapour_pressure', 'CONDITION', 't50', '50℃', '50 °C', 30),
  ('sys_substance_water_solubility_condition_t20', 'sys_substance_water_solubility', 'CONDITION', 't20', '20℃', '20 °C', 10),
  ('sys_substance_water_solubility_condition_t25', 'sys_substance_water_solubility', 'CONDITION', 't25', '25℃', '25 °C', 20),
  ('sys_substance_ld50_oral_condition_rat', 'sys_substance_ld50_oral', 'CONDITION', 'rat', 'ラット', 'Rat', 10),
  ('sys_substance_ld50_oral_condition_mouse', 'sys_substance_ld50_oral', 'CONDITION', 'mouse', 'マウス', 'Mouse', 20),
  ('sys_substance_ld50_oral_condition_rabbit', 'sys_substance_ld50_oral', 'CONDITION', 'rabbit', 'ウサギ', 'Rabbit', 30),
  ('sys_substance_ld50_dermal_condition_rat', 'sys_substance_ld50_dermal', 'CONDITION', 'rat', 'ラット', 'Rat', 10),
  ('sys_substance_ld50_dermal_condition_rabbit', 'sys_substance_ld50_dermal', 'CONDITION', 'rabbit', 'ウサギ', 'Rabbit', 20),
  ('sys_substance_lc50_inhalation_gas_condition_rat_4h', 'sys_substance_lc50_inhalation_gas', 'CONDITION', 'rat_4h', 'ラット・4 時間', 'Rat, 4 h', 10),
  ('sys_substance_lc50_inhalation_gas_condition_rat_1h', 'sys_substance_lc50_inhalation_gas', 'CONDITION', 'rat_1h', 'ラット・1 時間', 'Rat, 1 h', 20),
  ('sys_substance_lc50_inhalation_vapour_condition_rat_4h', 'sys_substance_lc50_inhalation_vapour', 'CONDITION', 'rat_4h', 'ラット・4 時間', 'Rat, 4 h', 10),
  ('sys_substance_lc50_inhalation_vapour_condition_rat_1h', 'sys_substance_lc50_inhalation_vapour', 'CONDITION', 'rat_1h', 'ラット・1 時間', 'Rat, 1 h', 20),
  ('sys_substance_lc50_inhalation_dust_condition_rat_4h', 'sys_substance_lc50_inhalation_dust', 'CONDITION', 'rat_4h', 'ラット・4 時間', 'Rat, 4 h', 10),
  ('sys_substance_lc50_inhalation_dust_condition_rat_1h', 'sys_substance_lc50_inhalation_dust', 'CONDITION', 'rat_1h', 'ラット・1 時間', 'Rat, 1 h', 20),
  ('sys_substance_noec_chronic_condition_fish', 'sys_substance_noec_chronic', 'CONDITION', 'fish', '魚類', 'Fish', 10),
  ('sys_substance_noec_chronic_condition_crustacea', 'sys_substance_noec_chronic', 'CONDITION', 'crustacea', '甲殻類', 'Crustacea', 20),
  ('sys_substance_noec_chronic_condition_algae', 'sys_substance_noec_chronic', 'CONDITION', 'algae', '藻類', 'Algae', 30),
  ('sys_substance_rapid_degradability_value_yes', 'sys_substance_rapid_degradability', 'VALUE', 'yes', 'あり', 'Yes', 10),
  ('sys_substance_rapid_degradability_value_no', 'sys_substance_rapid_degradability', 'VALUE', 'no', 'なし', 'No', 20)
) AS v("id", "property_def_id", "kind", "code", "label_ja", "label_en", "display_order")
JOIN "property_defs" d ON d."id" = v."property_def_id"
ON CONFLICT DO NOTHING;
