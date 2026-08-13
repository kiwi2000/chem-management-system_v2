# データモデル設計書（ER・テーブル定義）

| 項目 | 内容 |
|---|---|
| 文書名 | 化学物質管理システム データモデル設計書 |
| バージョン | 0.1（ドラフト） |
| 作成日 | 2026-07-02 |
| 親仕様 | `化学物質管理システム_要件定義書_v0.7.md` 第3章 |
| 実装ガイド | `CLAUDE.md`（特に §3 DB移植性ルール） |

> 本書は要件定義書 第3章を、3DB（PostgreSQL/MySQL/SQL Server）で同一に動くテーブル定義へ落とし込んだもの。矛盾が生じた場合は要件定義書を優先し、実装を止めて確認する（CLAUDE.md §0）。

---

## 1. 設計方針・共通ルール

### 1.1 3DB移植性（CLAUDE.md §3 準拠）
- **キーは2種（詳細は §1.4）**: ①**内部サロゲートキー `id`**（FK・結合に使用、ユーザーには意識させない）②**業務キー `code`**（ユーザーが付与する一意の識別子）。主要マスタは両方を持つ。内部キーは cuid 文字列を既定とする（DB自動採番の bigint でも可）。
- **数値**: 含有率・閾値・係数・割合は必ず **`Decimal`**（Prisma `Decimal` → PG `numeric` / MySQL `decimal` / SQL Server `decimal`）。`Float/Double` 禁止。
  - 既定桁は **`Decimal(9,6)`（仮）**。正式桁は **【要確認 Q-N1】** 確定後に固定。
- **真偽値**: Prisma `Boolean`（MySQL `tinyint(1)` / SQL Server `bit`）。
- **ENUM**: Prisma enum（DBネイティブ enum に依存しない）。
- **JSON**: Prisma `Json`。**表示・スナップショット専用**とし、内部を条件検索・並べ替え・集計に使わない（Q-D3）。
- **文字列照合**: MySQL/SQL Server は既定で大文字小文字非区別。**CAS番号・各種コードは正規化列（`*_normalized`：trim＋大文字化）を別途持ち、突合・一意判定はこの列で行う**（照合順序差の吸収）。
- **命名**: テーブル/カラムは `snake_case`、予約語回避。Prisma モデルは PascalCase、`@@map`/`@map` で物理名に対応。
- 文字コード UTF-8（MySQL `utf8mb4` / SQL Server `nvarchar` またはUTF-8対応照合順序）。

### 1.4 ID戦略（業務キーと内部キー）
主要マスタ（物質・製品/原材料・法律・規制区分 等）は、**ユーザーが付与する業務キー `code`** と **内部サロゲートキー `id`** を分けて持つ。

- **`code`（業務キー）**: ユーザーが登録時に付与。**必須・一意**（一意スコープは各表に記載）。画面表示・TSV取込の突合キー（Q-IO4）に使う。照合順序差を吸収するため `code_normalized`（trim＋大文字）を併設し、一意判定・突合はこの列で行う。
- **`id`（内部キー）**: システムが自動生成（cuid 既定、bigint 自動採番でも可）。**すべての FK/結合は `id` を参照**する。`code` が後から変更されても参照が壊れないようにするため。
- **`code` の変更**: 許容する（FKは `id` 参照のため影響なし）。変更は監査履歴に記録。
- 業務キーを持つ主なテーブル: `Substance`(物質コード), `Product`(製品コード), `Law`(法律コード), `RegulationCategory`(区分コード)。`StatutorySubstance` は `(区分, 管理番号)`、`LinkSetVersion` は `version_code`、`Source` は `name`、`Locale` は `code`、`SubstancePropertyDef` は `key` を業務キーとして持つ（既存定義のとおり）。

### 1.2 共通カラム（全テーブル）
| カラム | 型 | 説明 |
|---|---|---|
| `id` | cuid (PK) | サロゲートキー。 |
| `created_at` | timestamp | 作成日時。 |
| `updated_at` | timestamp | 更新日時。 |
| `created_by` | cuid? (FK users) | 作成者。 |
| `updated_by` | cuid? (FK users) | 更新者。 |
| `deleted_at` | timestamp? | **論理削除**。NULL=有効。参照整合のため物理削除しない（FR-AU-04）。 |

> 以降の各テーブル定義では共通カラムを省略し、固有属性のみ記載する。

### 1.3 論理削除・参照整合
- 削除は原則 `deleted_at` セット（論理削除）。他データから参照される物質・製品・法文物質名・CAS等は物理削除しない（FR-AU-04）。
- 一意制約は「有効行のうち一意」を要するものがあるが、3DBで部分インデックス（PGのみ）に依存できないため、**一意はアプリ層でも検証**し、DB制約は `deleted_at` を含めない範囲で最小限に留める（詳細は各表の注記）。

---

## 2. ER 概要（関連）

```
User ──< (created_by/updated_by) 全テーブル
User >── Locale (優先ロケール)

Substance 1──* SubstanceName
Substance 1──* SubstanceProperty *──1 SubstancePropertyDef
Substance 1──1 (extra Json 列)
MetalConversionFactor : CAS基準（Substanceと物理FKなし、cas_normalizedで論理対応）

Product 1──* CompositionLine
CompositionLine ─ (substance_id | child_product_id)  … どちらか一方（CHECK）
Product 1──* ExpandedComposition *──1 Substance
Product 1──* ExpandedPath *──1 Substance

Law 1──* RegulationCategory 1──* StatutorySubstance
LinkSetVersion 1──* StatutoryCasLink
Source 1──* StatutoryCasLink
StatutorySubstance 1──* StatutoryCasLink

Product 1──* DeterminationRun 1──* DeterminationResult 1──* DeterminationContribution
DeterminationRun >── LinkSetVersion

DocumentTemplate 1──* GeneratedDocument
Locale 1──* UiTranslation

SystemSetting / AuditLog / ImportJob : 独立
```

---

## 3. テーブル定義

### 3.1 物質系

#### Substance（物質）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `code` | varchar | NOT NULL | **物質コード（ユーザー付与の業務キー）**。 |
| `code_normalized` | varchar | UNIQUE, NOT NULL | 正規化コード。**グローバル一意**。突合キー。 |
| `cas_number` | varchar | NOT NULL | CAS番号（表示用・原文）。**必須**（Q-D1）。 |
| `cas_normalized` | varchar | NOT NULL, index | 正規化CAS（trim＋大文字）。突合キー。**一意制約なし**（別物質が同一CAS可＝Q-D1）。 |
| `extra` | Json? | | 表示専用の自由プロパティ（Q-D3の SubstanceExtra を1:1列に統合）。**内部検索しない**。 |

- 名称は `SubstanceName`、定型プロパティは `SubstanceProperty` に分離。
- index: `cas_normalized`。

#### SubstanceName（物質名称）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `substance_id` | cuid | FK Substance, NOT NULL | 親物質。 |
| `name_type` | enum SubstanceNameType | NOT NULL | `MAIN` / `SUB`。**MAINは1物質1件**（アプリ層で担保）。 |
| `name_ja` | varchar | NOT NULL | 日本語名称。 |
| `name_en` | varchar? | | 英訳。**任意**（Q-D2）。 |
| `display_order` | int? | | サブ名称の並び。 |

- index: `substance_id`, `name_ja`, `name_en`。将来ロケール拡張時は `locale` 列追加で対応（Q-DOC3）。

#### SubstancePropertyDef（プロパティ定義マスタ）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `key` | varchar | UNIQUE(normalized), NOT NULL | 種別キー。例：`melting_point`, `smiles`, `inchikey`, `molecular_formula`。 |
| `label_ja` / `label_en` | varchar | | 表示名。 |
| `data_type` | enum PropertyDataType | NOT NULL | `NUMBER` / `TEXT`。 |
| `default_unit` | varchar? | | 数値プロパティの既定単位。 |
| `display_order` | int? | | |

- **構造式**は本マスタの項目として `smiles` / `inchikey` / `molecular_formula` をシード（Q-D3）。画像は添付扱い（Q-G4/D-5）。

#### SubstanceProperty（EAV値）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `substance_id` | cuid | FK Substance, NOT NULL | |
| `property_def_id` | cuid | FK SubstancePropertyDef, NOT NULL | |
| `value_text` | varchar? | | テキスト値（data_type=TEXT）。 |
| `value_num` | Decimal? | | 数値値（data_type=NUMBER）。 |
| `unit` | varchar? | | 未指定時は定義の既定単位。 |

- unique: `(substance_id, property_def_id)`（同一物質×同一項目は1件）。index: `property_def_id, value_num`（数値検索用）。

#### MetalConversionFactor（金属換算係数）※CAS基準の独立マスタ（Q-J5）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `cas_number` | varchar | NOT NULL | 対象CAS（原文）。 |
| `cas_normalized` | varchar | NOT NULL | 正規化CAS。突合キー。 |
| `metal_element` | varchar | NOT NULL | 元素記号（例 `Pb`）。 |
| `ratio_pct` | Decimal | NOT NULL | 当該CAS分子中の当該金属の重量割合(%)。 |

- unique: `(cas_normalized, metal_element)`。同一CASに複数金属可（Q-J5）。バージョン管理対象外（Q-J7）。
- **Substance と物理FKは張らない**（CAS基準のため）。判定時に `cas_normalized` で論理的に対応付け。

### 3.2 製品系

#### Product（製品／原材料）※同一エンティティ（Q-D4）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `code` | varchar | NOT NULL | **製品コード（ユーザー付与の業務キー）**。 |
| `code_normalized` | varchar | UNIQUE, NOT NULL | 正規化コード。**グローバル一意**。突合キー。 |
| `name_ja` | varchar | NOT NULL | 日本語名称。 |
| `name_en` | varchar? | | 英語名称（任意）。 |
| `usable_as_material` | Boolean | NOT NULL, default false | **原材料利用可フラグ**（既定オフ）。オンで他製品/原材料の組成に使用可（Q-D4）。 |
| `private_flag` | Boolean | NOT NULL, default false | **非公開フラグ**（既定オフ＝本体公開）。§2.3。 |
| `composition_public_flag` | Boolean | NOT NULL, default false | **組成公開フラグ**（既定オフ＝非開示）。§2.3。 |
| `extra` | Json? | | 表示専用の任意プロパティ。 |

- index: `name_ja`, `usable_as_material`, `private_flag`。

#### CompositionLine（原組成）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `parent_product_id` | cuid | FK Product, NOT NULL | 親製品。 |
| `substance_id` | cuid? | FK Substance | 構成要素が物質のとき。 |
| `child_product_id` | cuid? | FK Product | 構成要素が製品（原材料）のとき。 |
| `content_pct` | Decimal? | | **重量含有率（単一値のみ）**（Q-G1）。balance行はNULL可。 |
| `is_balance` | Boolean | NOT NULL, default false | balance（残部）行フラグ。**製品内で最大1件**（アプリ層担保・Q-D5）。 |

- **CHECK制約（ポリモーフィック代替）**: `substance_id` と `child_product_id` は**どちらか一方のみ非NULL**（3DBともCHECK対応）。真のFK制約を両方向に張れて移植性が高い。
- **含有率**: `is_balance=false` の行は `content_pct` 必須。`is_balance=true` の行は `100 − 既知合計` を算出時に補完。
- **合計検証**は SystemSetting の検証モード（Q-D5）で実施。**循環参照は登録時に拒否**（FR-P-04・アプリ層でグラフ探索）。
- index: `parent_product_id`, `child_product_id`, `substance_id`。

#### ExpandedComposition（展開・統合組成）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `product_id` | cuid | FK Product, NOT NULL | |
| `substance_id` | cuid | FK Substance, NOT NULL | |
| `content_pct` | Decimal | NOT NULL | 統合後含有率（経路寄与の総和）。 |
| `calculated_at` | timestamp | NOT NULL | 算出基準日時（鮮度判定用）。 |

- unique: `(product_id, substance_id)`（統合後は製品内一意）。

#### ExpandedPath（展開明細）※保持する（Q-D6）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `product_id` | cuid | FK Product, NOT NULL | 展開の起点製品。 |
| `substance_id` | cuid | FK Substance, NOT NULL | 到達物質。 |
| `contribution_pct` | Decimal | NOT NULL | この経路の寄与含有率（親×子×…）。 |
| `path` | Json | NOT NULL | 経路トレース（`[{productId, pct}, ...]`）。**表示専用**。 |

- index: `(product_id, substance_id)`。

### 3.3 法規制系

#### Law（法律）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `code` | varchar | NOT NULL | **法律コード（ユーザー付与の業務キー）**。 |
| `code_normalized` | varchar | UNIQUE, NOT NULL | 正規化コード。**グローバル一意**。 |
| `name_ja` | varchar | NOT NULL | 例：化審法。 |
| `name_en` | varchar? | | |
| `abbrev` | varchar? | | 略称。 |
| `note` | varchar? | | 備考。バージョン管理対象外（Q-R1）。 |

#### RegulationCategory（規制区分）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `code` | varchar | NOT NULL | **区分コード（ユーザー付与の業務キー）**。法律内で一意（`code_normalized`）。 |
| `code_normalized` | varchar | NOT NULL | 正規化コード。unique `(law_id, code_normalized)`。 |
| `law_id` | cuid | FK Law, NOT NULL | |
| `name_ja` / `name_en` | varchar | NOT NULL/? | 例：第一種特定化学物質。 |
| `rank` | int? | | 兼ね合い時の強弱（小さいほど厳しい）。兼ね合い対象で必須（Q-J3）。 |
| `interaction_flag` | Boolean | NOT NULL, default false | 兼ね合いフラグ（既定オフ＝独立判定）。 |
| `interaction_group` | varchar? | | 兼ね合いグループ識別。 |
| `summation_method` | enum SummationMethod | NOT NULL | `CATEGORY_TOTAL` / `STATUTORY_NAME` / `NONE`（Q-J2）。 |
| `threshold_lower` | Decimal? | | 区分閾値 下限。 |
| `threshold_upper` | Decimal? | | 区分閾値 上限（任意。上限超は当該区分で非該当）。 |
| `suppress_result_flag` | Boolean | NOT NULL, default true | 結果抑制（既定オン・Q-J4）。 |

- index: `law_id`, `(interaction_group, rank)`。

#### StatutorySubstance（法文物質名エントリ）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `category_id` | cuid | FK RegulationCategory, NOT NULL | |
| `control_number` | varchar | NOT NULL | 管理番号（区分内通番）。 |
| `name_ja` / `name_en` | varchar | NOT NULL/? | 法文物質名（単一物質名 or 総称）。 |
| `threshold_lower` | Decimal? | | 該当含有率範囲 下限（任意）。あれば区分閾値より優先（Q-J1）。 |
| `threshold_upper` | Decimal? | | 上限（任意。超過は非該当・Q-J6）。 |
| `judgment_method` | enum JudgmentMethod | NOT NULL | `CONTENT_RATIO` / `METAL_CONVERSION`（Q-J5）。 |
| `metal_element` | varchar? | | 判定金属元素。NULLなら含有率方式（Q-J5）。 |

- unique: `(category_id, control_number)`。index: `category_id`。
- 整合性: `judgment_method=METAL_CONVERSION` なら `metal_element` 必須（アプリ層＋FR-AU-03）。

### 3.4 リンク・情報源・バージョン系

#### LinkSetVersion（リンクデータセットバージョン）※CASリンクのみ版管理（Q-R1）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `version_code` | varchar | UNIQUE(normalized), NOT NULL | 例 `2026Q2`。 |
| `name` | varchar? | | 版の説明。 |
| `loaded_at` | timestamp? | | 投入日時。 |
| `status` | enum VersionStatus? | | `DRAFT`/`ACTIVE`/`RETIRED`。要否は **【要確認 Q-V3】**。 |

#### Source（情報源）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `name` | varchar | NOT NULL | 例 LOLI/CHRIP/JAMP/USER。 |
| `priority` | int | NOT NULL | 優先度（フォールバック用）。**グローバルか版別かは【要確認 Q-V2】**（当面グローバル列として保持）。 |
| `active_flag` | Boolean | NOT NULL, default true | |

#### StatutoryCasLink（法文物質名↔CASリンク）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `version_id` | cuid | FK LinkSetVersion, NOT NULL | |
| `statutory_substance_id` | cuid | FK StatutorySubstance, NOT NULL | |
| `cas_number` | varchar | NOT NULL | 原文CAS。 |
| `cas_normalized` | varchar | NOT NULL | 正規化CAS。突合キー。 |
| `source_id` | cuid | FK Source, NOT NULL | |

- index: `(version_id, statutory_substance_id)`, `(version_id, cas_normalized, source_id)`。
- 判定は**特定1バージョン基準**。CAS→物質解決の多重一致/未一致は **【要確認 Q-L1】**、フォールバック単位は **【要確認 Q-L2】**。

### 3.5 判定系

#### DeterminationRun（判定実行）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `product_id` | cuid | FK Product, NOT NULL | 対象製品。 |
| `version_id` | cuid | FK LinkSetVersion, NOT NULL | 使用リンクバージョン。 |
| `executed_by` | cuid | FK User | 実行者。 |
| `executed_at` | timestamp | NOT NULL | |
| `source_priority_snapshot` | Json | NOT NULL | 適用情報源優先度のスナップショット（再現用・表示専用）。 |

- index: `(product_id, executed_at)`。

#### DeterminationResult（判定結果）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `run_id` | cuid | FK DeterminationRun, NOT NULL | |
| `law_id` / `category_id` / `statutory_substance_id` | cuid/? | FK | 対象階層。 |
| `is_applicable` | Boolean | NOT NULL | 該当/非該当。 |
| `calculated_value` | Decimal? | | 算定値（合算量/金属換算量）。 |
| `adopted_source_id` | cuid? | FK Source | 採用情報源。 |
| `is_final_category` | Boolean | NOT NULL, default false | 最終該当区分か。 |
| `suppressed` | Boolean | NOT NULL, default false | 結果抑制で下位表記を抑えたか。 |

- index: `run_id`, `(category_id, is_applicable)`（規制該当フィルタ FR-SR-03 用）。

#### DeterminationContribution（寄与物質明細）※判定根拠
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `result_id` | cuid | FK DeterminationResult, NOT NULL | |
| `substance_id` | cuid | FK Substance, NOT NULL | 寄与物質。 |
| `contribution_value` | Decimal | NOT NULL | 寄与量（含有率 or 金属換算後）。 |
| `adopted_source_id` | cuid? | FK Source | 採用情報源。 |
| `link_id` | cuid? | FK StatutoryCasLink | 使用リンク。 |

### 3.6 ドキュメント生成系（§3.6）

#### DocumentTemplate
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `name` | varchar | NOT NULL | |
| `base_file_ref` | varchar | NOT NULL | ベースWord/Excelの保存参照（保存先は D-5）。 |
| `base_format` | enum TemplateBaseFormat | NOT NULL | `WORD` / `EXCEL`。 |
| `output_format` | enum TemplateOutputFormat | NOT NULL | `SAME` / `PDF` / `BOTH`。PDFは LibreOffice 変換（Q-DOC4）。 |
| `target_types` | Json | NOT NULL | 対象データ種別の集合（製品・組成/判定結果/物質/法規制）。表示専用。 |
| `locale_id` | cuid? | FK Locale | テンプレートの言語（言語別テンプレートで多言語対応）。 |
| `active_flag` | Boolean | NOT NULL, default true | |

- 権限: 登録/編集/削除はシステム管理者・特権ユーザー（FR-DOC-01）。

#### GeneratedDocument（生成履歴）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `template_id` | cuid | FK DocumentTemplate, NOT NULL | |
| `target_ref` | varchar | NOT NULL | 製品ID/判定実行ID 等。 |
| `output_format` | enum TemplateOutputFormat | NOT NULL | |
| `generated_by` | cuid | FK User | |
| `generated_at` | timestamp | NOT NULL | |
| `params` | Json? | | 使用バージョン等（再現用）。 |
| `file_ref` | varchar? | | 実体保存する場合の参照。**既定は履歴メタのみ・NULL**（Q-DOC2）。 |

- **マスキング**: 生成・ダウンロードは呼出ユーザー権限で §2.3/§5 を適用（FR-DOC-04）。実体保存時もDL時に権限再チェック。

### 3.7 多言語系（§3.7）

#### Locale
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `code` | varchar | UNIQUE, NOT NULL | 例 `ja`, `en`, `zh-CN`。 |
| `display_name` | varchar | NOT NULL | |
| `is_default` | Boolean | NOT NULL, default false | フォールバック先。**1件のみ**（アプリ層担保）。 |
| `active_flag` | Boolean | NOT NULL, default true | 有効化でUI選択可能に。 |

#### UiTranslation
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `key` | varchar | NOT NULL | UI文字列の翻訳キー。 |
| `locale_id` | cuid | FK Locale, NOT NULL | |
| `value` | varchar | NOT NULL | 訳文。 |

- unique: `(locale_id, key)`。未翻訳キーは既定ロケールへフォールバック（アプリ層）。

### 3.8 ユーザー・設定・監査

#### User（users）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `supabase_user_id` | varchar | UNIQUE, NOT NULL | Supabase Auth の sub。 |
| `display_name` | varchar? | | |
| `role` | enum Role | NOT NULL | `SYSTEM_ADMIN` / `PRIVILEGED` / `NON_PRIVILEGED`。 |
| `can_edit` | Boolean | NOT NULL, default false | 編集権限（Q-A1）。管理者/特権は常に可（アプリ層で強制）。 |
| `preferred_locale_id` | cuid? | FK Locale | 優先言語（未設定は既定ロケール）。 |
| `active_flag` | Boolean | NOT NULL, default true | |

#### SystemSetting（FR-U-05）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `key` | varchar | UNIQUE, NOT NULL | 設定項目キー。例 `composition.validation_mode`。 |
| `value` | varchar? | | 値（型は value_type に従う。JSON値は文字列格納）。 |
| `value_type` | enum SettingValueType | NOT NULL | `STRING`/`NUMBER`/`BOOLEAN`/`JSON`。 |
| `default_value` | varchar? | | 既定値。 |

- 代表シード: `composition.validation_mode=STANDARD`, `composition.epsilon=0.01`, `composition.balance_allowed=true`（Q-D5）。
- **値はハードコードせず本テーブル参照**（CLAUDE.md §8）。

#### AuditLog（FR-AU-01/02）
| 属性 | 型 | 制約 | 説明 |
|---|---|---|---|
| `entity` | varchar | NOT NULL | 対象テーブル名。 |
| `entity_id` | varchar? | | 対象行ID。 |
| `action` | varchar | NOT NULL | create/update/delete/login/determine/import/export 等。 |
| `actor_id` | cuid? | FK User | 実行者。 |
| `at` | timestamp | NOT NULL | |
| `diff` | Json? | | 変更差分（表示専用）。 |

- index: `(entity, entity_id)`, `(actor_id, at)`。

#### ImportJob（FR-IO-04）※任意
| 属性 | 型 | 説明 |
|---|---|---|
| `entity` | varchar | 取込対象種別。 |
| `status` | varchar | 実行中/完了/失敗。 |
| `total` / `succeeded` / `failed` | int | 件数。 |
| `error_log` | Json? | 行単位エラー（表示専用）。 |

---

## 4. Enum 一覧
| Enum | 値 |
|---|---|
| `Role` | SYSTEM_ADMIN, PRIVILEGED, NON_PRIVILEGED |
| `SubstanceNameType` | MAIN, SUB |
| `PropertyDataType` | NUMBER, TEXT |
| `SummationMethod` | CATEGORY_TOTAL, STATUTORY_NAME, NONE |
| `JudgmentMethod` | CONTENT_RATIO, METAL_CONVERSION |
| `VersionStatus` | DRAFT, ACTIVE, RETIRED（採否は Q-V3） |
| `TemplateBaseFormat` | WORD, EXCEL |
| `TemplateOutputFormat` | SAME, PDF, BOTH |
| `SettingValueType` | STRING, NUMBER, BOOLEAN, JSON |
| `CompositionValidationMode`（SystemSetting値） | STRICT, STANDARD, LENIENT |

---

## 5. インデックス方針（主なもの）
- 突合: `Substance.cas_normalized`, `MetalConversionFactor(cas_normalized, metal_element)`, `StatutoryCasLink(version_id, cas_normalized, source_id)`。
- 業務キー一意: `Substance.code_normalized`, `Product.code_normalized`, `Law.code_normalized`, `RegulationCategory(law_id, code_normalized)`。
- その他一意: `LinkSetVersion.version_code`, `Locale.code`, `UiTranslation(locale_id, key)`, `SystemSetting.key`, `User.supabase_user_id`, `ExpandedComposition(product_id, substance_id)`, `StatutorySubstance(category_id, control_number)`, `SubstanceProperty(substance_id, property_def_id)`, `MetalConversionFactor(cas_normalized, metal_element)`。
- 検索/フィルタ: `SubstanceName.name_ja/name_en`, `Product.name_ja/private_flag/usable_as_material`, `DeterminationResult(category_id, is_applicable)`（FR-SR-03）。

---

## 6. 認可・マスキングの適用点（§5 と整合）
- 業務データの認可は**アプリ層で集中**（RLS不使用）。以下の読み出し経路すべてで一貫適用:
  - 一覧/検索、判定結果明細、逆引き検索、TSVエクスポート、**ドキュメント生成**（§3.6）。
- 非特権ユーザー: `Product.private_flag=true` は結果集合から除外、`composition_public_flag=false` は組成・展開・`ExpandedPath`・組成由来明細をマスキング。サーバ側で除外/マスキング後に返す。
- 組成公開の伝播（公開製品が非開示原材料を含む場合）は **【要確認 Q-G10】**。

---

## 7. 未確定事項が影響する箇所（実装時に確定）
| Q | 影響 |
|---|---|
| **Q-N1** | Decimal桁の確定（含有率/閾値/係数/割合）。現状 `Decimal(9,6)` 仮。 |
| **Q-N2** | 閾値比較の境界（以上/超過）。判定エンジン側ロジック。 |
| **Q-V2** | `Source.priority` をグローバル列のままか版別テーブル化するか。 |
| **Q-V3** | `LinkSetVersion.status` の採否。 |
| **Q-L1/L2** | CAS→物質解決の多重一致/未一致・フォールバック単位。判定エンジン仕様。 |
| **Q-G10** | 組成公開の伝播（展開時のマスキング）。 |
| **Q-IO3/4** | TSV upsert の突合キー。**業務キー `code`（`code_normalized`）を基本**とする想定（物質/製品/法律/区分）。リンクは `version_code`＋情報源＋法文物質名＋CAS。確定は Q-IO4。 |
| **Q-DOC1** | 差込タグ辞書の具体項目（`docs/document-template-tags.md`）。 |

> 上記は**テーブル骨格を変えない**範囲。確定後に桁・一部制約・補助テーブルを追記する。

---

## 改訂履歴
| Ver | 日付 | 変更内容 |
|---|---|---|
| 0.1 | 2026-07-02 | 初版。要件定義書 v0.7 第3章に基づく全エンティティ定義（3DB移植制約込み）。 |
| 0.2 | 2026-07-02 | ID戦略を追加（§1.4）。主要マスタにユーザー付与の業務キー `code`（＋内部サロゲート `id`）を導入。物質/製品/法律/規制区分に `code`/`code_normalized` を追加。 |
