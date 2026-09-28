# S23 SDS 作成 — 段 0: 物質の GHS 分類データの取り込み（データ項目の案）

> **状態: 段 0 の最初の一部を実装（2026-09-28。SDS あり版）。** 表は 8 つ全部作った。読み手は NITE 統合版だけ。
> 物質の詳細に読み取り専用の欄を出す所まで。残り（EU の読み手・濃度限界・上書き・採用規則・混合物計算）は未着手。
> 実装の要点は §9。
> 原典の検証は `docs/GHS分類の原典/検証結果_DB項目.md`。設計の経緯はメモリ `chem-sds-ghs-design`。
> SDS 作成はオプション機能（決定 0016）。表は共通の DB に `sds_ghs_` の名前で作り、画面・API・取り込みは `apps/web/modules/sds/` に置く。

## 0. 利用条件の扱い（2026-09-27 利用者の方針）

- **当方のシステム（開発・検証環境）には全部の出どころを入れる**（LOLI も購入済み）
- **お客さんに渡すときは、そのお客さんが利用する権利のあるデータだけ残し、他は削除して渡す。** 渡したあとにお客さんが選ぶのではない
- したがって表は「**出どころ単位で丸ごと消せる**」作りにする（出どころ → 公表 → 項目 → CAS・分類・限界・要確認 の順に cascade）。
  配布物を組む手順（`package-release.sh` / DB の写し）に「残す出どころの一覧」を渡し、それ以外を消す工程を足す
- 物質ごとの上書き（4-9）は自社のデータなので出どころに依存しない。ただし `evidence_ref` が消した出どころの項目を指していれば、参照だけ切れる（上書き自体は残す）

## 1. 何を持つか（一言で）

「**国の機関が公表した、物質ごとの GHS 分類結果**」を、出どころを混ぜずに、日付で引ける形で持つ。
その上に「**物質コードごとの上書き**」を重ね、混合物の分類計算（段 1）の入力にする。

## 2. 用語

| 語 | 意味 |
| --- | --- |
| 国 | 管轄（Purple Book の competent authority）。日本／EU／英国／韓国／豪州／中国…。EU は 1 つの国として扱う。法規制判定の「国・地域」とは別の軸 |
| 出どころ | 分類を公表している機関とその一覧（NITE、CLP 附属書VI、GB MCL、韓国 分類表示目録、HCIS、中国 分類情報表、自社） |
| 公表 | 出どころが配った 1 回分（NITE 2026-09 更新、ATP23、告示 2026-17号…）。**取り込みの単位**。「選べる版」ではない |
| 項目 | 出どころが 1 単位として載せる行（EU の Index 番号、NITE の物質 ID、韓国の 고유번호…）。CAS は 0〜n 個 |
| 分類 | 項目 × 危険有害性クラスの結果（区分・H コード・状態） |
| 上書き | 物質コードごとに人が決めた分類（項目＝クラス単位） |

## 3. 表の一覧と関係

```
sds_ghs_sources（出どころ）
  └─ sds_ghs_releases（公表・取り込みの記録）
       └─ sds_ghs_entries（項目。適用開始・終了日を持つ）
            ├─ sds_ghs_entry_cas（項目 ↔ CAS の突き合わせ）
            ├─ sds_ghs_classifications（項目 × クラス。行ごとに GHS 改訂版）
            └─ sds_ghs_limits（濃度限界・M 係数・ATE）
sds_ghs_hazard_catalog（クラス・区分のカタログ。共通コード ↔ 各国表記 ↔ H コード）
sds_ghs_term_aliases（表記揺れの辞書。出どころの文字列 → 共通コード）
sds_ghs_overrides（物質コードごとの上書き。substances と結ぶ）
sds_ghs_import_issues（取り込みで解決できなかったもの＝要確認）
```

段 1 で足すもの（ここでは作らない）: 国ごとの採用規則（どの出どころを優先するか）、国ごとのビルディングブロック、H/P 文の各国語カタログ。

## 4. 各表の項目

型は Prisma の書き方。小数は **Decimal**（Float 不可）。文字列の長さは原典の最大値から余裕を持たせた。

### 4-1. 出どころ `sds_ghs_sources`

| 列 | 型 | 必須 | 説明 | 例 |
| --- | --- | --- | --- | --- |
| id | cuid | ○ | | |
| code | VarChar(40) 一意 | ○ | 機械用の識別子 | `NITE`, `EU_ANNEX_VI_OJ`, `EU_ANNEX_VI_ECHA`, `GB_MCL`, `KR_MOE_LIST`, `AU_HCIS`, `CN_CATALOG`, `OWN` |
| name_ja / name_en | VarChar(200) | ○ | 表示名 | 「NITE 政府 GHS 分類」 |
| country | VarChar(20) | ○ | 国（管轄）のコード | `JP`, `EU`, `GB`, `KR`, `AU`, `CN`, `*`（自社） |
| provider | enum | ○ | `PUBLIC`／`LOLI`／`CHRIP`／`OWN` | 利用条件の切り分け |
| delivery | enum | ○ | `FULL`（丸ごと配布）／`DELTA`（差分配布） | NITE=DELTA、韓国・英国=FULL |
| legal_status | enum | ○ | `BINDING`（従う義務）／`REFERENCE`（参考） | EU・英国・韓国・中国=BINDING |
| identifier_kind | enum | ○ | 項目の主キーの種類: `CAS`／`INDEX_NO`／`OWN_ID` | |
| covers_all_classes | Boolean | ○ | 全クラスに値があるか（NITE=true、EU=false） | 「載っていない」の解釈に使う |
| default_ghs_revision | VarChar(10) | | 行に改訂版が無いときの既定 | `7`（HCIS）、`4`（中国） |
| license_note | Text | | 利用条件の要約と URL | ECHA Excel は「informative, not commercial」 |
| deletable_as_unit | （設計上の性質。列ではない） | | **出どころは丸ごと消せる**こと。お客さんへ渡すとき、そのお客さんに利用する権利の無い出どころを、公表・項目・CAS・分類・限界・要確認ごと削除する（4-2〜4-6・4-10 は出どころに cascade） | |
| sort_order | Int | ○ | | |

### 4-2. 公表（取り込みの記録） `sds_ghs_releases`

| 列 | 型 | 必須 | 説明 | 例 |
| --- | --- | --- | --- | --- |
| id | cuid | ○ | | |
| source_id | FK | ○ | | |
| label | VarChar(120) | ○ | 人が読む名前 | 「NITE 統合版 2026-09 更新」「ATP23（2025/1222）」「告示 2026-17호」「GB MCL 第 8 版」「LOLI 2026Q3」 |
| published_on | Date | ○ | 公表日 | |
| legal_from | Date | | 法的な適用日（あれば）。項目の適用開始日の既定 | ATP23=2027-02-01 |
| ghs_revision | VarChar(10) | | この公表が前提にする改訂版 | |
| file_name / file_sha256 / source_url | VarChar | | 何を取り込んだか（同じ出どころでも経路で差が出るため） | |
| fetched_at / imported_at / imported_by | DateTime / FK | ○ | | |
| status | enum | ○ | `PREVIEW`（差分を見せている）／`APPLIED`／`REVERTED` | 取り込みは 2 段階 |
| added_count / changed_count / unchanged_count / closed_count / issue_count | Int | ○ | 差分の要約 | |
| note | Text | | 正誤表の内容、合成した旨など | |

### 4-3. 項目 `sds_ghs_entries`

出どころが 1 単位として載せる行。**同じ source_key でも版が変わると新しい行**（古い行は effective_to を入れて残す）。

| 列 | 型 | 必須 | 説明 | 各国での中身 |
| --- | --- | --- | --- | --- |
| id | cuid | ○ | | |
| source_id | FK | ○ | | |
| source_key | VarChar(60) | ○ | 出どころの識別子 | EU: Index No `016-020-00-8`／NITE: `m-nite-7664-93-9`／韓国: `97-1-405`／中国: 序号 `1302`／HCIS: GUID |
| sub_key | VarChar(20) | | 枝番・形態 | NITE の `a/b/c`、韓国の 소번호、中国の続き行の連番 |
| name | VarChar(500) | ○ | 出どころの名前（原語） | `sulphuric acid … %`、`硫酸` |
| name_en | VarChar(500) | | 英語名（あれば） | 韓国・中国は英語列がある |
| ec_number | VarChar(20) | | EU の EC 番号（項目に 1 つのとき。複数は 4-4 へ） | |
| condition_text | VarChar(200) | | 原典に書かれた条件の原文 | `… %`、`[含量＞52%]`、`(≤ 91 % solution)` |
| condition_min_pct / condition_max_pct | Decimal(7,3) | | 条件を数値にできたとき | |
| physical_form | VarChar(40) | | 形態（粉末・繊維・溶液…）。原典が書いているときだけ | NITE の形態違い |
| effective_from | Date | ○ | 適用開始日 | EU: 行の適用日／他: 公表の legal_from か published_on |
| effective_to | Date | | 適用終了日（次の版が来た・削除された） | 官報の削除項目 24 件 |
| release_in_id | FK | ○ | この内容を最初に載せた公表 | |
| release_last_seen_id | FK | ○ | 最後に確認した公表（丸ごと配布で「消えた」を検出するため） | |
| amending_act | VarChar(40) | | どの改正で入ったか | EU: `32025R1222`（CELEX）、`ATP23` |
| notes_raw | VarChar(200) | | 注記の原文 | EU: `B`, `K U`, `11`／中国: 备注／HCIS: Note コード |
| notes | VarChar(100) | | 注記を区切って正規化したもの | `B`／`K,U` |
| labelling_raw | Text | | 絵表示・信号語・表示 H の原文（韓国・EU・HCIS にある。段 1 で使う） | |
| raw_row | Text | ○ | 原典の 1 行をそのまま（タブ区切り）。正規化に失敗しても失わない | |
| content_hash | VarChar(64) | ○ | 中身の指紋。変わったかの比較 | |

一意: `(source_id, source_key, sub_key, effective_from)`。

### 4-4. 項目と CAS の突き合わせ `sds_ghs_entry_cas`

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| entry_id | FK | ○ | |
| cas_normalized | VarChar(20) | ○ | `normalizeCas()` を通した値。**物質マスタの `cas_normalized` と突き合わせる** |
| cas_raw | VarChar(30) | ○ | 原典の書き方（空白混入・日付化けの記録） |
| ordinal | Int | ○ | EU の `[1] [2]`、韓国・中国の並び順 |
| ec_number | VarChar(20) | | EU で CAS ごとに EC が付くとき |
| origin | enum | ○ | `SOURCE`（原典が書いた）／`EXPANSION`（展開規則で足した。LOLI・自社）／`MANUAL` |

CAS の無い項目（EU の 580 件、HCIS の 475 件…）は行を持たない。そういう項目は「グループ項目」として、段 1 で展開規則（〜化合物 → 個別 CAS）を別表で持つ。

### 4-5. 分類 `sds_ghs_classifications`

項目 × クラス。**改訂版・年度は行ごと**（NITE 統合版は初版〜6 版が混在するため）。

| 列 | 型 | 必須 | 説明 | 例 |
| --- | --- | --- | --- | --- |
| id | cuid | ○ | | |
| entry_id | FK | ○ | | |
| hazard_class | VarChar(40) | ○ | **共通コード**（4-7 のカタログ） | `ACUTE_TOX_ORAL`, `SKIN_CORR`, `STOT_RE`, `AQUATIC_CHRONIC` |
| category | VarChar(10) | | 区分 | `1A`, `2`, `1.1`（爆発物の項）, `D`（有機過酸化物の型） |
| status | enum | ○ | `CLASSIFIED`／`NOT_CLASSIFIED`（区分に該当しない）／`CANNOT_CLASSIFY`（分類できない）／`NOT_APPLICABLE`（分類対象外）／`NOT_EVALUATED`（載っていない。EU の非調和項目） | NITE の 4 値＋EU の「未評価」 |
| target_organs | VarChar(200) | | 標的臓器（原語） | `呼吸器`、`lung` |
| route | VarChar(20) | | 経路（急性毒性）。クラスのコードに含めるので通常は空 | |
| h_codes | VarChar(60) | | H コード（カンマ区切り） | `H360D`, `H302` |
| h_codes_origin | enum | | `SOURCE`（原典に書いてある）／`CATALOG`（クラス×区分から引いた） | NITE・中国は CATALOG |
| minimum_classification | VarChar(3) | | `*`, `**`, `***`（EU）、`*`（中国） | |
| ghs_revision | VarChar(10) | | この分類が拠った改訂版 | NITE: 根拠一覧の「分類ガイダンス」から |
| classified_in | VarChar(40) | | 分類した年度・公表 | `令和4年度（2022年度）` |
| rationale | Text | | 根拠の文（NITE 根拠一覧）。任意 | |
| raw_class_text | VarChar(200) | ○ | 原典のクラス・区分の文字列そのまま | `Skin. Corr. 1B`, `区分1（呼吸器）`, `급성독성-흡입(3.1)` |
| raw_h_text | VarChar(100) | | 原典の H の文字列そのまま | `H360D***` |

一意: `(entry_id, hazard_class, category)`（同じクラスに複数区分が並ぶ EU の `Acute Tox. 2 / Acute Tox. 3` などは経路が違うので、経路込みのクラスコードで分かれる）。

### 4-6. 濃度限界・M 係数・ATE `sds_ghs_limits`

| 列 | 型 | 必須 | 説明 | 例 |
| --- | --- | --- | --- | --- |
| id | cuid | ○ | | |
| entry_id | FK | ○ | | |
| kind | enum | ○ | `SCL`（特定濃度限界）／`M_ACUTE`／`M_CHRONIC`／`ATE` | |
| hazard_class / category / h_code | VarChar | | 対象のクラス・区分・H | `SKIN_IRRIT` / `2` / `H315` |
| min_pct / max_pct | Decimal(9,4) | | 濃度範囲 | `5 % ≤ C < 15 %` → 5 / 15 |
| min_inclusive / max_inclusive | Boolean | | `≥` か `>` か | |
| value | Decimal(14,4) | | ATE の値・M の値 | `1.2`、`10` |
| unit | VarChar(20) | | `mg/kg bw`, `mg/L`, `ppmV` | |
| route | VarChar(20) | | ATE の経路 | `oral`, `inhalation` |
| qualifier | VarChar(60) | | `dusts or mists`, `vapours`, `gases` | |
| raw_text | Text | ○ | 原典の文字列そのまま | `Skin Irrit. 2; H315: 5 % ≤ C < 15 %` |
| parse_status | enum | ○ | `PARSED`／`PARTIAL`／`RAW_ONLY` | 解析できなかったものは RAW_ONLY で残し要確認へ |

### 4-7. クラス・区分のカタログ `sds_ghs_hazard_catalog`

システム共通のコードと、改訂版ごとの有無、各国の表記、既定の H コード。**取り込みの写像先**であり、段 1 の計算・表示でも使う。

| 列 | 型 | 説明 | 例 |
| --- | --- | --- | --- |
| hazard_class | VarChar(40) | 共通コード | `ACUTE_TOX_INHAL_DUST` |
| category | VarChar(10) | | `2` |
| ghs_revision_from / ghs_revision_to | VarChar(10) | この区分が存在する改訂版の範囲 | `FLAM_GAS 1A` は 6 版から |
| h_codes | VarChar(60) | 既定の H コード | `H330` |
| abbrev_en | VarChar(60) | EU 風の略号 | `Acute Tox. 2` |
| name_ja / name_en / name_ko / name_zh | VarChar(120) | 各国の正式名 | `急性毒性（吸入：粉塵、ミスト）` |
| pictogram / signal_word | VarChar | 既定の絵表示・信号語（段 1） | `GHS06` / `Dgr` |
| sort_order | Int | 第 2 項に並べる順 | |

初期データの素材: 豪州 HCIS の区分カタログ（571 行。略号 → H → 英文）、NITE の 35 列名、韓国の 항목 名、中国の 类别 名。

### 4-8. 表記揺れの辞書 `sds_ghs_term_aliases`

| 列 | 型 | 説明 | 例 |
| --- | --- | --- | --- |
| source_id | FK（空＝全出どころ） | | |
| kind | enum | `CLASS`／`CATEGORY`／`STATUS`／`NOTE` | |
| raw | VarChar(200) | 原典の文字列 | `Skin. Corr.`, `Muta 2`, `Carc. 1a`, `Carc. 1Β`（ギリシャ文字）, `Flam. Gas.`, `Self-heat 1`, `Unst. Expl`, `区分外`, `分類対象外`, `※` |
| canonical | VarChar(200) | 写像先（共通コードや区分） | `SKIN_CORR`, `MUTA 2`, `CARC 1A`… |
| note | VarChar(200) | 根拠（ECHA Excel の Comment 列、正誤表など） | |

検証で見つかった揺れはすべてここに入れる。辞書に無い文字列が来たら取り込みを止めず、4-10 の要確認に落として `raw_*` に残す。

### 4-9. 物質コードごとの上書き `sds_ghs_overrides`

| 列 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| id | cuid | ○ | |
| substance_id | FK → substances | ○ | **物質コード単位**（同じ CAS の別物質には効かない） |
| hazard_class | VarChar(40) | ○ | 共通コード。**クラス単位で上書き**（項目ごと） |
| category / status / h_codes / target_organs | 4-5 と同じ | | |
| country | VarChar(20) | | 空＝全部の国に効く。指定すればその国だけ（当面は空で運用） |
| reason | Text | ○ | 理由（必須。第 16 項・監査で要る） |
| evidence_ref | VarChar(300) | | 根拠の参照（試験報告書・仕入先 SDS の添付 ID など） |
| decided_by / decided_at | FK / DateTime | ○ | |
| review_required | Boolean | ○ | 出どころの版が変わって根拠が古くなった可能性（取り込みが立てる。消さない） |
| review_note | Text | | |
| effective_from / effective_to | Date | | 判定対象日で引くため | |

一意: `(substance_id, hazard_class, country, effective_from)`。

### 4-10. 取り込みの要確認 `sds_ghs_import_issues`

| 列 | 型 | 説明 |
| --- | --- | --- |
| release_id | FK | |
| entry_id | FK（空あり） | |
| kind | enum | `UNKNOWN_TERM`（辞書に無い）／`PARSE_FAILED`（濃度限界の解析）／`CONFLICT`（同じ項目が別経路と食い違う）／`DISAPPEARED`（丸ごと配布で消えた）／`DUPLICATE_CAS`（同じ CAS が複数の項目）／`INVALID_CAS` |
| detail | Text | 何がどう違うか |
| resolved_by / resolved_at / resolution | | 人の判断（採用・無視・辞書に足した） |

## 5. 各国の原典 → 表への対応

| 出どころ | 項目の key | CAS | クラス・区分 | H | 状態 | 改訂版 | 適用開始日 | 濃度限界等 | 配布 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NITE 統合版＋根拠 | `GHS分類結果_ID` | `CAS` 列 | 35 列 → 行。`区分1（呼吸器）` を区分＋標的臓器に分解 | カタログから | 4 値をそのまま | 根拠一覧の「分類ガイダンス」 | 公表日（更新一覧の月） | 無し | DELTA（更新一覧＋正誤表） |
| EU 官報 Formex | Index No | `[1][2]` を分割 | 改行区切り。辞書で揺れを吸収 | 原典 | 載っていないクラス＝NOT_EVALUATED | ATP から | 統合版の適用日／`CLG.MDFO` の改正規則 | 1 セルの文字列を解析 | ATP ごと |
| EU ECHA Excel | Index No | 同上 | 同上 | 原典 | 同上 | 同上 | `In application` 列（History で過去も） | `M, SCL, ATE` 列を解析 | FULL（History 付き） |
| GB MCL | Index No | 同上 | 同上 | 原典 | 同上 | | 英国の日付 3 列 | 同上 | FULL |
| 韓国 分類表示目録 | 고유번호（＋소번호） | 改行区切り | 항목(番号)・구분 の対応 | 原典 | 載っていない＝NOT_EVALUATED | 告示 | 告示の施行日 | M계수 列（構造化済み） | FULL |
| 豪州 HCIS | GUID | `swa_cas` | `\|` 区切りの略号 85 通り | 原典 | 同上 | Rev.7 | 公表日（無いので取得日） | 無し | FULL |
| 中国 分類情報表 | 序号（＋続き行） | `;` 区切り | 改行区切りの中国語 131 通り | カタログから | 同上 | GB 30000（改訂版不明） | 通知の施行日 | 無し | 通知ごと（DELTA） |
| 自社 | 物質コード | 物質の CAS | 画面で選ぶ | カタログから | 4 値 | 現行 | 決めた日 | 手入力 | — |

## 5-2. 物質の分類は「最新」だけを使う（2026-09-28 決定）

- 物質の GHS 分類は、出どころが**いま最新としている分類**を使う（NITE 統合版はそれ自体が「物質ごとの最新」。
  トルエンは 2012 年度の再分類が最新で、GHS 3 版の基準のまま。統合版 3,476 物質の 82% は 2018 年度以前の分類）
- **製品（混合物）の分類の計算結果は、計算したときの入力ごと保存し、過去の結果も残す。**
- **過去の状態に戻って計算し直すことは、画面の有無にかかわらず、できない。** 物質の古い行（適用終了日を付けて残したもの）は、
  保存済みの結果が何を根拠にしたかを示す控えであって、計算の入力には使わない。過去の版（NITE 政府版の全年度の一覧）も入れない

## 5-3. 出どころの優先順位と、矛盾を埋める仕組み（段 1 の骨。2026-09-28 決定）

法規制判定と同じ「データソースの優先順位」を持つが、単位は**物質 × 危険有害性クラス（項目）**。
出どころによって扱う項目の範囲が違う（NITE は全項目、EU 附属書VI は調和された項目だけ）ため。

**利用者の指示: 「できるだけ矛盾を埋める仕組みを作る」。** 穴（未評価のまま）と矛盾（混ぜたことによる不整合）は二択で、
「起きにくくして、残りは必ず埋めるか人の目に触れさせる」を選ぶ。黙って推測しない・黙って捨てない。

決め方の順序（対象の国ごと）:

1. 物質ごとの上書き（自社判定）があれば、その項目はそれで確定
2. 国の採用規則: 出どころの優先順位。**主の出どころの評価（該当・該当しない・分類できない・対象外）は下位で上書きしない。**
   下位で埋めるのは主が「未評価」の項目だけ（既定）。国の規則で「分類できないも埋める」に切り替え可
3. 読み替え: 出どころの版・ビルディングブロック → 国の版・ブロック（同じ／読み替え／採用外／要確認）
4. 整合性の規則: GHS が形式的に決めている関係は**導出**して記録（皮膚腐食 1 ⇒ 眼の重篤な損傷 1 など）。
   珍しい・疑わしい組み合わせ（皮膚刺激 2 で眼が該当なし、STOT 反復 1 で急性毒性が全て該当なし、など）は**直さず検出して要確認**。
   検出・導出の規則は表（データ）として持ち、JIS の分類の手引きから起こして運用で足す
5. その版の混合物の規則で製品を計算。結果の各項目に「主の出どころ／埋めた出どころ／導出／要確認」の印を残す
6. 従う義務のある出どころ（EU 向けの附属書VI）は最低ライン。緩める方向の上書きは不可（厳しくするのは可）
7. 補助データ（濃度限界・M 係数）は、同じ項目・同じ区分のときだけ別の出どころから借りてよい

## 5-4. 物質の詳細の「GHS 分類（出典別）」の表（複数の出典を並べて比べる。2026-09-28 決定・未実装）

出典が 2 つ以上になったら、いまの「出典ごとに表を積む」形をやめ、**クラスを行・出典を列**にした 1 つの表にする
（既存の「各種番号・法規制をバージョンを横に並べた表」と同じ作り。左端の列は固定、横スクロール）。

- **セル**: 該当は区分（太字）。「H コード表示」のチェックボックス（表の上）が付いていれば、区分の下に小さめの字で H コード。
  該当しない「－」、分類できない「?」、分類対象外「×」、未評価は空欄（薄い灰色）。凡例を表の下に。
  吹き出しに原典の文字列・GHS 改訂版・分類年度・根拠・その出典の項目名
- **列の見出し**: 出典名、識別子、GHS 改訂版、**最終確認**（公表と取り込み日）。同じ出典に複数の項目（形態違い・濃度条件）が
  あれば、その出典の列を項目の数だけ分ける
- **行の絞り込み**（ボタン）: 「該当だけ」（**既定**）／「出典が食い違う行だけ」／「全部」。
  出典が 1 つの物質では「食い違う行だけ」は空になるので「該当だけ」に戻す
- **食い違い**: 区分や状態が出典間で一致しないセルは薄い黄色。読み替えれば同じになるもの（EU の眼 2 ＝ 日本の 2A）は
  食い違いに数えず、吹き出しに「読み替えると同じ」。改訂版の違いだけなら色を付けない
- **段 1 で足す**: 左端に「採用」列（対象の国の採用規則で選ばれた区分と、どの列から来たかの印）と国の切り替え。
  上書き（自社判定）ができたら右端の「自社」列のセルを押すのが上書きの入口

## 6. 判定対象日での引き方（段 1 で使う規則）

1. 物質の `cas_normalized` で `sds_ghs_entry_cas` を引き、`effective_from ≤ 日 < effective_to` の項目を出どころごとに集める
2. 条件付きの項目（濃度範囲・形態）は、組成の含有率・製品の形態で絞る。絞れなければ「条件付き」の印を付けて候補に残す
3. 国の採用規則（段 1）で出どころを 1 つに絞る。`covers_all_classes=false` の出どころの NOT_EVALUATED は、次の出どころで補う
4. 物質の上書き（4-9）が `effective_from ≤ 日` で有効なら、そのクラスだけ上書きで置き換える
5. 結果に「どの出どころ・公表・項目から来たか」「上書きか」を必ず添える（第 16 項と監査のため）

## 7. 取り込みの流れ

1. ファイルを選ぶ → 出どころと公表のラベル・公表日・適用日を入力（`PREVIEW`）
2. 読み手が原典の形式から 4-3〜4-6 の形に起こす。辞書に無い語・解析できない文字列は 4-10 へ
3. いま有効な項目と突き合わせ、**追加・変更・変わらず・消えた** を表で見せる（丸ごと配布の「消えた」は人が確定）
4. 「適用」で: 変更は古い項目に `effective_to` を入れて新しい項目を足す、変わらずは `release_last_seen_id` だけ更新
5. 変わった CAS を含む物質 → 上書きがあれば `review_required` を立てる → その物質を含む製品に「SDS 要再計算」（段 1）
6. 取り消しは `REVERTED`: その公表で足した項目を消し、閉じた項目を開き直す

## 8. 決めていただきたいこと

1. **上書きはクラス単位**（4-9）でよいか
2. **最初に取り込みの読み手を作る出どころ**: NITE と EU 官報の 2 つから始める案。ECHA Excel は官報とほぼ同じ形なので読み手を共用できる
3. **カタログ（4-7）の初期データをどう作るか**: 豪州の区分カタログを土台に、日本語名は NITE の列名、韓国語・中国語は原典から写す案。JIS Z 7253 の正式名との突き合わせは人が見る
4. **中国の分類情報表の GHS 改訂版**をどう扱うか（原典に記載が無い。GB 30000-2013 は改訂 4 版相当として `default_ghs_revision=4` にする案）
5. **お客さんへ渡すときに出どころを消す工程**を、配布スクリプト（`package-release.sh` / `build-install-set.ps1`）の引数にするか、DB を写した後に流す別スクリプトにするか

## 9. 実装したもの（2026-09-28、SDS あり版）

| 何を | どこに | 備考 |
| --- | --- | --- |
| 表 8 つ（4-1〜4-5、4-7、4-8、4-10） | `prisma/schema.prisma` 末尾、移行 `20260928100000_sds_ghs_classification_data` | 4-6（濃度限界等）と 4-9（上書き）は要るときに足す。`category` は null でなく空文字（一意制約のため） |
| 差込口 | `apps/web/modules/types.ts`（`api`・`substanceSections`）、`app/api/modules/[module]/[[...path]]/route.ts`、`app/substances/[id]/page.tsx` | 本体側の共通の変更。モジュールが無ければ何も出ない |
| カタログの初期データ | `modules/sds/ghs/catalog-data.ts` | 豪州 HCIS の区分カタログ＋NITE の列名から手で起こした。取り込みのたびに upsert |
| NITE の読み手 | `modules/sds/ghs/nite.ts`（`nite.test.ts` に 1 セルの読み方 10 件） | 統合版は**丸ごと配布**として扱う（差分は取り込み側で出す）。根拠一覧は流し読み |
| 取り込み | `modules/sds/ghs/import-service.ts`、`/sds/ghs`、`POST /api/modules/sds/ghs/import` | 下見 → 取り込む の 2 段。ファイルは毎回送る。管理者だけ |
| 物質の詳細の欄 | `modules/sds/substance-section.tsx` | 今日の日付で有効な項目を CAS で引く。既定は該当だけ表示 |

**勝手に決めた点**: 取り込みの権限は `ADMIN`（権限にモジュールの印を持たせる仕組みが無いため、権限を足していない）。
統合版を FULL 扱いにしたので、NITE の「更新一覧」「正誤表」は読まない（統合版を取り込み直せば差分が出る）。
STOT 単回 区分 3 の H は標的臓器の文（気道刺激性→H335、麻酔作用→H336）から引く。
