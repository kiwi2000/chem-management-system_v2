# S23 SDS 作成 — 段 0: 物質の GHS 分類データの取り込み（データ項目の案）

> **状態: 段 0 を実装中（2026-09-28。SDS あり版）。** 表は 10 個（分類データ 8 つ＋上書き・採用順）。読み手は NITE 統合版と EU 附属書VI（ECHA の Excel）。
> 物質の詳細の比較表（出典別）と、「GHS データ」の画面（物質 × 採用した分類、自社判定、国ごとの採用順）まで。
> 残り（濃度限界の解析・読み替え・導出／検出・混合物計算）は未着手。実装の要点は §9。
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

いまの「出典ごとに表を積む」形をやめ、**左にクラス、右に出典の項目ごとの列**を並べた 1 つの表にする
（既存の「各種番号・法規制をバージョンを横に並べた表」と同じ作り。左端の列は固定、横スクロール。出典が 1 つでも同じ表）。

```
                        日本 NITE          EU CLP            EU CLP
                        m-nite-108-88-3    601-021-00-3      601-021-00-3
                        取得 2026/9/28     ATP22（現行）      ATP23（2027-02-01〜）
クラス                                     取得 2026/9/28     取得 2026/9/28
引火性液体              区分2              区分2             区分2
急性毒性（吸入：蒸気）  区分4              データなし         データなし
急性毒性（吸入）※       データなし          データなし         データなし
眼刺激性                区分2B      ≠      データなし         データなし
特定標的臓器（単回）    区分1 中枢神経系    区分3 麻酔作用     区分3 麻酔作用
                        区分3 気道刺激性、麻酔作用
```

**列 = 出典の項目（1 行）ごと。** 見出しは 3 段（出典／項目の識別子と版／データ取得日）。

- 列になるのは**いま効いている項目と、これから効く項目**（将来の ATP は既定で出す。2026-09-28 決定）。
  古い版（適用終了日が過去）は控えとして残るだけで列にしない（§5-2）。同じ適用日の訂正は書き換わるので列は増えない
- 同じ出典の形態違い（NITE の a/b/c）、濃度条件つき（EU の `… %`）は列を分け、見出しに書く
- データ取得日は出典・項目ごとに違い得るので、列の見出しの 3 段目に小さく。公表の名前は吹き出し

**行 = カタログのクラス（いちばん細かい粒度）。** 粗い粒度の値は専用の行に出し、勝手に細かい行へ振り分けない。

- EU の「急性毒性（吸入）」（経路の記載なし）は、3 つの経路の行の下に別の行（※）
- 区分の細かさの違い（EU の眼 2 と日本の 2A）はそのまま別の文字で出す。「読み替えれば同じ」の扱いは段 1 の読み替え表ができてから
  （できたら ≠ を付けず、吹き出しに「EU の 2 は日本の 2A に当たる」）
- 区分の記載が無い該当（`Press. Gas`、`Expl.`）は「該当（記載なし）」

**セル = 1 行目が区分、2 行目以降が補足。** 出す・出さないは補足の種類ごと。

| 情報 | 出し方 |
| --- | --- |
| 区分 | 太字。該当しない項目は出典の言葉（「該当しない」「分類できない」「対象外」）を薄い字、記載の無い項目は斜体の「データなし」 |
| 標的臓器 | **常に**区分の右に小さめの字（STOT の行にしか無い。まず出してみる。2026-09-28 決定） |
| 複数区分（STOT の 1 と 3） | セル内で行を分け、区分ごとに臓器を添える |
| H コード | チェックボックス「H コード表示」が付いていれば区分の下に小さめの字（2026-09-28 決定） |
| GHS 改訂版・分類年度 | チェックボックス「改訂版・年度表示」（H コードとは**別**。2026-09-28 決定）で区分の下に「3 版・2012 年度」 |
| 最小分類の印（EU の * ** ***） | 区分の右肩に小さく。吹き出しで意味 |
| 原典の文字列・根拠・公表 | 吹き出し |

**行の絞り込み**（チェックボックス。既定はどれも外れていて、どれかの列で該当している行だけ）

- 「非該当」: 出典に記載はあるが区分の付かない項目の行を足す
- 「データなし」: どの出典も何も書いていない行も足す
- 「出典で異なる行だけ」: 該当どうしで区分の文字が違う行（≠ の行）だけに絞る
- 行が出ていれば、セルは常にその列の状態を出す（列ごとに隠さない）

**段 1 で足す**: 左端に「採用」列（対象の国の採用規則で選ばれた値と、どの列から来たかの印）と国の切り替え。
上書き（自社判定）ができたら右端に「自社」列。セルを押すのが上書きの入口。

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

### 9-2. EU 附属書VI の読み手（2026-09-28）

- 原典は ECHA の Excel（`annex_vi_clp_table_atpNN_en.xlsx`）の **History シート**（Index ごとの全版と適用日）。
  官報の Formex XML の読み手は作っていない（同じ内容で、こちらは適用日を行で持つため）。ExcelJS は「History」というシート名を
  開けないので、xlsx の中の workbook.xml で名前を変えてから読む（`renameReservedSheets`）
- 出すのは「いま効いている版」と「これから効く版」だけ（§5-2）。将来の版があれば、いまの版に終了日（前日）を付ける。
  「Index # deleted」は削除で、前の版を閉じる。実データ: 4,451 項目、将来の版 32、CAS 無し 586
- 項目の鍵は Index 番号＋適用開始日（`versionedRows`）。同じ鍵で中身が変わったら訂正として書き換える（版は増やさない）。
  新しい適用日の行が来たら、同じ Index のそれより前の開いている行を前日で閉じる
- 急性毒性の経路は H コードで決める（`ACUTE_TOX_INHAL`＝経路の区別なし、を足した）。H はクラスごとの候補で拾い、
  拾えなければカタログの既定（`h_codes_origin=CATALOG`、198 行）。最小分類の印は `*` `**` `***`
- 「Press. Gas」「Expl.」のように区分の無い書き方は `UNSPEC`。「Ozone」は区分 1、「Lact.」は REPR/LACT
- 濃度限界・M 係数・ATE は `limits_raw` に原文のまま（移行 `20260928140000_sds_ghs_entry_limits_raw`）。解析は段 1
- GHS 改訂版は行に付けていない（ATP ごとに決めるのは段 1）。`classified_in` に ATP コード

### 9-3. GHS データの画面・自社判定・国ごとの採用順（2026-09-28）

| 何を | どこに | 備考 |
| --- | --- | --- |
| 表 2 つ（4-9 の上書き、採用順） | `SdsGhsOverride`・`SdsGhsAdoptionRule`、移行 `20260928160000_sds_ghs_overrides_and_adoption_rules` | 4-9 のうち `effective_from/to` は持たせていない（§5-2 で物質は最新だけと決めたため）。一意は `(substance, hazard_class, category, country)` |
| 採用の計算 | `modules/sds/ghs/adopt.ts` | §5-3 の 1・2 段目。上書き（国指定 → 全ての国の順）→ 採用順に出典を見て、そのクラスを評価している最初の出典。`fill_cannot_classify` なら「分類できない」も次で埋める。3 段目以降（読み替え・導出・検出）は未実装 |
| 国の一覧 | `modules/sds/ghs/countries.ts` | JP / EU / GB / KR / CN / TW / US / AU / その他。既定の採用順は「その国の出典が先頭、あとは出典の並び順」 |
| 画面 | `/sds/ghs-data`（`pages/ghs-data.tsx`、`components/ghs-data-table.tsx`・`ghs-override-editor.tsx`・`ghs-adoption-rules.tsx`） | 共通の表。物質コード・名称・CAS で絞り込み・並べ替え。クラス 39 列は短い見出しで横に流す（共通の表に列ごとの `minWidth` を足した） |
| API | `GET/PUT /api/modules/sds/ghs-data`, `…/rules`, `…/overrides`（`ghs-data-api.ts`） | 見るのは `SUBSTANCE_VIEW`（物質の公開状態の絞りも同じ）、自社判定は `SUBSTANCE_EDIT`、採用順は `ADMIN` |
| メニュー | `manifest.ts`（親「SDS 作成」＋子「GHS データ」「GHS 取り込み」） | 本体側に `ModuleNavItem.children` を足した |
| 出典ごとのタブ | `components/ghs-data-tabs.tsx`・`ghs-source-table.tsx`、`GET /api/modules/sds/ghs-data/source?sourceCode=` | 行＝出典の項目（識別子・版）。閉じた項目も出す（適用終了で絞る）。メニューは 2 段までなので 3 段目はタブ（下に続ける／セレクトより、出典が一目で分かるため。2026-09-28 決定）。物質との結び付きは CAS だけ |

**勝手に決めた点**: 自社判定の保存は「その物質 × 効く国」の上書きを丸ごと置き換え、理由は 1 つ（クラスごとに分けていない）。
上書きの H コードはカタログの既定から引く。1 クラスに複数区分の上書き（例: 生殖毒性 1A ＋ 授乳）はまだ画面から入れられない。
`evidence_ref`・`review_required` は表にあるが画面には出していない（取り込みが立てる仕組みは段 1）。

### 9-4. 結び付きの層（LOLI の展開）と、使う層の切り替え（2026-09-28）

前提の決定: **LOLI は正しい前提で使う**（候補扱い・要確認にしない）。ただし「原典に載っている結び付き」か
「LOLI 独自の結び付き」かは必ず区別して持ち、間違っていれば利用者が自社判定で上書きできること（メモリ `chem-loli-trusted`）。

| 何を | どこに | 備考 |
| --- | --- | --- |
| 結び付きの表 `sds_ghs_key_links` | `SdsGhsKeyLink`、移行 `20260928190000_sds_ghs_key_links` | **識別子（source × source_key）に結ぶ**。項目の行（版ごと）に結ぶと取り込み直しで消えるため。`origin`（EXPANSION／MANUAL）・`linked_by`（"LOLI"／"USER"）・`release_id`（LOLI の公表。消せば結び付きも消える）・`note`（「As 鉛化合物 [RR-…]」） |
| LOLI のデータ種 | `import-service.ts` の `SOURCES`（code `LOLI`、kind `links`） | 項目は持たず結び付きだけ。採用順には並べない。`SdsGhsIssueKind.UNKNOWN_KEY` を足した |
| 取り出し | `scripts/loli-dump-ghs-links.sh`（`scripts/sql/loli-ghs-links.sql`） | ListData 4204（EU）・4171（日本）の CAS × refno × remark。refno が親の識別子（Index No／m-nite-…）。remark の `[RR-…]` は LOLI の擬似 CAS で鍵ではない |
| 取り込み | `/sds/ghs` で出典「LOLI（CAS の結び付き）」＋ TSV。`ghs/links.ts` | 丸ごと配布。原典に既に載っている CAS は取り込まない（7,337 組）。RR-／UN／NA／PMN と形の合わない CAS は読み飛ばし（3,206）。親が原典に無い行は要確認 UNKNOWN_KEY（146。EU 2 件＋NITE 統合版に無い ID）。実データ: 20,213 組 |
| 採用の計算 | `ghs/adopt.ts`（`sourceRowsForCas`・`pickWithinSource`） | 同じ出典で複数の項目が当たるとき **原典の結び付き → LOLI の展開** の順（総称の「別掲のものを除く」の実装）。それでも複数なら**クラスごとに厳しいほうの区分**（カタログの並び順）。使う層は呼び出し側が渡す（`AdoptOptions`。原典は常に） |
| 画面 | `GET ghs-data?layers=LOLI,OVERRIDE`。物質タブの「使うデータ」（原典＝固定・LOLI・自社判定）。セルの印「EU·LOLI」（乗せると親の項目）。物質の詳細の比較表は LOLI 経由の項目を別の列にし、見出しに「LOLI 経由」、チェックで付け外し。出典タブの物質コード列にも LOLI で結ばれた物質（印付き） | 層の選択は端末に覚える。既定は全部使う |

**勝手に決めた点**: NITE の枝番（a/b/c）は LOLI の refno に無いので、識別子だけで結ぶ（枝番違いの項目すべてに当たる）。
LOLI の一覧が同じ CAS を複数の親に結ぶときは全部当てて厳しいほうを採る。UN 番号などを CAS 欄に入れた行は黙って読み飛ばす（件数だけ出す）。
使う層の既定は「全部」（LOLI は正しい前提のため）。SDS を作るときにどの層を使うかは、段 1 で国ごとの設定に置く（いまは画面の切り替えだけ）。

### 9-5. 採用の列と「判定修正」、適用条件の要確認（2026-09-28）

法規制判定と同じ形に寄せた（2026-09-28 指示: 法規制と統一感のある UI）。

| 何を | どこに | 備考 |
| --- | --- | --- |
| 物質の詳細の比較表 | `components/substance-ghs-section.tsx` | 左から クラス／**採用**（選んだ国の採用結果。出典の印・LOLI 経由・自社・要確認）／出典の項目ごとの列／**判定修正**。採用の結果は `GET ghs-data` から引き、画面で別の計算をしない。採用した項目のセルは通常、採用しなかった該当の値は薄い字（乗せると「採用していない値」） |
| 判定修正 | 同上 `OverrideRowEditor` | 行の中に開く。自社判定（該当＋区分・標的臓器／該当しない／分類できない／対象外）・効く国（全ての国／この国だけ）・理由。「上書きを消す」。保存は既存の `PUT ghs-data/overrides`（物質 × 効く国の丸ごと置き換え）で、同じ効く国のほかのクラスは保って送る。効く国を切り替えても打ちかけの入力は消さない |
| 適用条件（濃度・形態） | `ghs/adopt.ts`（`pickWithinSource`）、`AdoptedCell.review` | 同じ出典で無条件の項目があればそれを採り、条件付き（`condition_text`／`physical_form`）は**要確認**として並べる。条件付きしか無ければ厳しいほうを採って全部を要確認に。一覧のセルと詳細の採用の列に赤い「? 要確認」（乗せると項目と条件） |
| 一覧の印 | `components/ghs-data-table.tsx` | セルに要確認の印。列が狭いので印だけ（文言は乗せたとき） |

**勝手に決めた点**: 条件が評価できない項目は「決めない」のではなく、無条件の項目を既定にし（無ければ厳しいほう）、要確認の印で人に見せる
（矛盾はできるだけ埋める方針。空にすると SDS が作れない）。人が別の項目を選ぶ手段は当面「判定修正」（自社判定）で、
「この物質にはこの項目を当てる」の手動リンク（`origin=MANUAL`）は表だけ用意して画面は未作成。
GHS データの一覧側の自社判定は従来の別カードのまま（行＝物質なので、行内の判定修正はクラス単位の詳細に置いた）。

