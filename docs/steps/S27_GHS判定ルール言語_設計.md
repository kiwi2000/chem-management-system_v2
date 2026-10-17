# S27 GHS 判定のルール言語 — 設計案（第 1 版）

- 作成: 2026-10-17（設計のレイヤー階。まだ何も作っていない）
- 前提: S25 §2-9（定義方式・独自言語・UN を土台にレイヤーを重ねる）、§2-10（製品ごとの判断の決め方）、
  選択点の一覧（`docs/GHS判定_選択点の一覧_2026-10-17.md`）、日本の選び方（`docs/GHS判定_JISの選び方_2026-10-17.md`）、
  ガイダンスの実務の決まり（`docs/GHS判定_ガイダンスの実務の決まり_2026-10-17.md`）
- 原則（2026-10-17 指示）: **決まっていないことは、利用者が設定で変えられる作りにする。** この言語では「選択点」と「レイヤーの重ね合わせ」がその口
- 置き場所: SDS あり版だけ（決定 0016）。言語の処理系も `apps/web/modules/sds/` の中

この文書は **言語の形を固めるための見本**。§3 の見本を読んで、§6 の決めることに答えてもらってから、文法を確定して処理系を作る。

---

## 1. 言語が表すもの（4 つのレイヤー）

| レイヤー | 何を書くか | 誰が書くか |
| --- | --- | --- |
| **国連のレイヤー** | 国連 GHS のある版の計算の決まり全部と、任されている所（選択点）の宣言 | システム（配布） |
| **国のレイヤー** | 国連のレイヤーからの差分。選択点の選び方、採用する区分、濃度限界、国だけの追加 | システム（配布）。お客さんが写して直してもよい |
| **自社のレイヤー** | 国のレイヤーからの差分。製造者の裁量・専門家の判断を自社の決まりとして書く。製品のプロパティからの判断 | お客さん |
| **製品の上書き** | 製品 × クラスごとの手入力（理由・根拠付き） | お客さん（画面から。言語では書かない） |

判定は「上書き → 自社のレイヤー → 国のレイヤー → 国連のレイヤー」の順に効く（表の下に行くほど優先され、すぐ上のレイヤーとの違いだけを書く。国連のレイヤーが土台で、全部を書く）。言語で書くのは製品の上書き以外の 3 つ。

---

## 2. 言語の形（決めごと）

### 2-1. 見た目

- **予約語は英語、名前と文言は日本語でも英語でもよい。** 「わかりやすくて専用エディタがあれば日本語でなくてよい」（2026-10-17）。
  予約語が英語なら、文法の検査と候補の表示が作りやすく、国をまたいで同じ定義を読める
- **ブロックは `{ }`、1 文は改行で終わる。** 字下げは見た目だけ（意味を持たない）。コメントは `//` と `/* */`
- **数値には単位を付けられる**（`5 %`、`2000 mg/kg`、`20.5 mm2/s`、`23 °C`）。単位の取り違えを検査で見つける
- **文字列は `"…"`**。フレーズのコード（`H314`、`P280`）はそのまま書ける
- 1 ファイル＝1 つのレイヤー（ruleset）。レイヤーは `extends` で土台を名指しし、**版まで固定する**（`"UN-Rev9" version 1`）

### 2-2. 構成要素

```
ruleset <名前> version <番号> [extends <土台の名前> version <番号>] {
  meta { title, revision, valid_from, valid_to, note }
  classes { … }        // 危険有害性クラスと区分の宣言（国連のレイヤーだけ）。国のレイヤーは adopt / exclude で絞る
  options { … }        // 選択点の宣言（国連のレイヤー）と選択（国・自社のレイヤー）
  rules { … }          // クラスごとの計算（型を組み合わせる）
  labels { … }         // ラベルの決まり（絵表示の優先、注意喚起語、H 文の省略、P 文の選び方）
  sds { … }            // SDS に書く決まり（濃度限界未満でも書く成分、未知成分の文の置き場所）
  tests { … }          // 試験（直すたびに全部計算し直す）
}
```

### 2-3. 計算の型（プログラムが持つ部品。S25 §2-9 の表と同じ）

| 型 | 書き方（要点） |
| --- | --- |
| `threshold` | 「ある区分の成分が濃度限界以上なら、その区分」。SCL（物質ごとの特定濃度限界）があればそちらが勝つ |
| `weighted_sum` | 区分ごとの含有率の合計に係数を掛けて足し、条件を満たせばその区分（皮膚・眼、STOT 3、水生の M 係数） |
| `additivity` | 100/ATEmix ＝ Σ(Ci/ATEi)。未知成分の扱い（`unknown`）を持つ |
| `precondition` | 製品の性状で決め打ち（pH、動粘性率）。他の計算より先に当たる |
| `range` | 性状の値の区間で区分（引火点・初留点） |
| `manual` | 計算しない。「判断が要る」を出し、上書きを待つ |
| `pick` | 区分の読み替え・採用しない区分の落とし方（眼 2 → 2A、急性毒性 5 → 区分に該当しない） |

### 2-4. 式で使えるもの

- 成分の集合: `ingredients`（最終組成の成分。含有率は上限で計算 — S25 の決定 8）
- 選び方: `ingredients where <条件>`。条件には `category(skin) == 1A`、`category(skin) in [1A, 1B, 1C]`、`has_value(ate.oral)`、`unknown(acute.oral)`、`conc >= 1 %` などが書ける
- 集計: `sum(conc of <集合>)`、`count(<集合>)`、`any(<集合>)`、`max(...)`
- 成分の値: `ingredient.conc`、`ingredient.ate(oral)`、`ingredient.m_factor(acute)`、`ingredient.scl(skin, 1)`、`ingredient.prop("ld50_oral")`（拡張属性のキー。S26）
- 製品の値: `product.prop("ph")`、`product.prop("flash_point")`、`product.state`（physical_state の選択肢のコード）、`product.unknown_fraction`（中身の分からない割合）
- レイヤーの値: `option(<選択点の名前>)`、`limit(<クラス>, <区分>)`（濃度限界の表引き）
- 結果の作り方: `classify <クラス> as <区分>`、`not_classified`、`unclassifiable`、`needs_judgement "<理由>"`、`note "<文>"`（結果に添える文。`{x}` で値を埋める）
- 比較・演算: `+ - * /`、`== != < <= > >=`、`and or not`、`if … then … else …`
- **式は自前の解釈器で評価する。** JavaScript の eval は使わない。再帰や無限の繰り返しは書けない（式の長さと評価の回数に上限）

### 2-5. レイヤーの重ね方（差分の書き方）

- 国のレイヤーは `extends "UN-Rev9" version 1`。書かなかったものは土台のまま
- **差分の 4 つの動詞**: `adopt`（採用する区分を絞る）、`exclude`（採らない区分）、`choose`（選択点を選ぶ）、`override rule <クラス> { … }`（計算を差し替える）、`add`（国だけのクラス・文を足す）
- 選択点を選ばずに残すと、**検査で止まる**（「選択点 X が未選択」）。「UN GHS 版」をそのまま使うレイヤーだけは `defaults safest` と書いて既定（安全側）を使う
- 自社のレイヤーでは、国が `locked` にした選択点は選び直せない（検査で止まる）。国が `open` にしたものは選べる

### 2-6. 試験

- `tests { test "<名前>" { mixture { "<成分名>" <含有率> [values…] … } product { ph 1.5 … } expect { skin 1, acute.oral 3 } } }`
- ルールセットを保存・取り込むたびに、そのレイヤーと、そのレイヤーを土台にする全部のレイヤーの試験を流す。1 つでも期待と違えば止める
- Gmiccs で判定した例を、日本のレイヤーの試験として入れる（答え合わせ）

---

## 3. 見本（日本 JIS 2025 の急性毒性と皮膚）

見本は **3 つのファイル**。国連のレイヤー → 日本のレイヤー → 自社のレイヤー。読みやすさのため、急性毒性（経口）と皮膚腐食性／刺激性に絞る。

### 3-1. 国連のレイヤー（抜粋）

```ghsrule
ruleset "UN-Rev9" version 1 {
  meta {
    title "国連 GHS 改訂 9 版（2021）"
    revision "GHS Rev.9"
    note "任されている所は options に選択点として置く。国のレイヤーで choose する"
  }

  classes {
    class acute.oral  "急性毒性（経口）"  categories [1, 2, 3, 4, 5]  unit mg/kg
    class acute.dermal "急性毒性（経皮）" categories [1, 2, 3, 4, 5]  unit mg/kg
    class acute.inhal.gas    "急性毒性（吸入：気体）"       categories [1, 2, 3, 4, 5] unit ppmV
    class acute.inhal.vapour "急性毒性（吸入：蒸気）"       categories [1, 2, 3, 4, 5] unit mg/L
    class acute.inhal.dust   "急性毒性（吸入：粉じん・ミスト）" categories [1, 2, 3, 4, 5] unit mg/L
    class skin "皮膚腐食性／刺激性" categories [1, 1A, 1B, 1C, 2, 3]
      // 1A/1B/1C は 1 の細区分。細区分を採らない国は adopt で 1 だけにする
      subcategories 1 -> [1A, 1B, 1C]
  }

  options {
    // ① 国が選ぶ所。name / 選べる値 / 既定（safest）/ 原文の箇所
    option acute.category5        "急性毒性 区分 5 を採るか"        values [adopt, exclude]   safest adopt    source "1.1.3.1.5.4, 3.1.2.5"
    option skin.category3         "皮膚刺激性 区分 3 を採るか"      values [adopt, exclude]   safest adopt    source "3.2.2 (c)"
    option skin.subcategories     "皮膚腐食性 1A/1B/1C を分けるか"  values [split, merge]     safest split    source "3.2.2 (a)"
    option acute.unknown_statement "未知成分の文をどこに書くか"     values [label, sds, both, manufacturer] safest both source "3.1.3.6.2.2"
    option acute.unknown_policy   "未知成分が多いときの扱い"        values [correction, unclassifiable_over(0.1 %)] safest correction
      source "3.1.3.6.2.3（補正の式）。unclassifiable_over は Gmiccs の作り（原文に無い）"
  }

  rules {
    // 急性毒性（経口）: 混合物の ATE を加算式で求め、区分に当てる
    rule acute.oral {
      relevant ingredients where conc >= 1 % or flagged(relevant)   // 1 % 未満でも関係すると分かる成分は flagged で含める
      bands { 1: ate <= 5, 2: ate <= 50, 3: ate <= 300, 4: ate <= 2000, 5: ate <= 5000 }   // mg/kg
      convert category -> ate { 1: 0.5, 2: 5, 3: 100, 4: 500, 5: 2500 }   // 表 3.1.2 の変換値（区分 5 は国のレイヤーで消える）
      ignore ingredients where no_acute_toxicity        // 水・砂糖など（成分の印）
      additivity {
        ate_of ingredient = coalesce(ingredient.ate(oral), convert(category(acute.oral)))
        unknown = ingredients where unknown(acute.oral)
        if sum(conc of unknown) > 10 % then
          atemix = (100 % - sum(conc of unknown)) / sum(conc / ate_of over known)   // 3.1.3.6.2.3 の補正
        else
          atemix = 100 % / sum(conc / ate_of over known)
      }
      if sum(conc of unknown) >= 1 % then
        note "混合物の {sum(conc of unknown)} は急性毒性（経口）が未知の成分からなる"  place option(acute.unknown_statement)
      classify by bands(atemix)
    }

    // 皮膚腐食性／刺激性: 加成方式。pH の決め打ちが先。加成方式が使えない成分があれば別の表
    rule skin {
      relevant ingredients where conc >= 1 % or flagged(relevant)
      precondition {
        if product.prop("ph") <= 2 or product.prop("ph") >= 11.5 then
          classify skin as 1 because "pH が 2 以下または 11.5 以上（3.2.3.1.3）。酸・アルカリの予備量で違うなら in vitro で確かめる"
          needs_judgement "pH による決め打ち。予備量のデータがあれば見直す"
      }
      non_additive ingredients where flagged(non_additive)   // 強酸・強塩基・無機塩・アルデヒド・フェノール・界面活性剤など（成分の印）
      if any(non_additive) then {
        if sum(conc of non_additive where category(skin) in [1, 1A, 1B, 1C]) >= 1 % then classify skin as 1
        else if sum(conc of non_additive where category(skin) == 2) >= 3 % then classify skin as 2
        else not_classified
      } else weighted_sum {
        c1  = sum(conc of ingredients where category(skin) in [1, 1A, 1B, 1C])
        c1a = sum(conc of ingredients where category(skin) == 1A)
        c1b = sum(conc of ingredients where category(skin) == 1B)
        c2  = sum(conc of ingredients where category(skin) == 2)
        c3  = sum(conc of ingredients where category(skin) == 3)
        if c1 >= 5 % then
          classify skin as (if option(skin.subcategories) == split then
                              (if c1a >= 5 % then 1A else if c1a + c1b >= 5 % then 1B else 1C)
                            else 1)
        else if c1 >= 1 % or 10 * c1 + c2 >= 10 % then classify skin as 2
        else if 10 * c1 + c2 + c3 >= 10 % or c3 >= 10 % then classify skin as 3   // 区分 3 を採らない国では pick で落ちる
        else not_classified
      }
    }
  }

  labels {
    // 1.4.10.5.3 の優先順位（健康は固定）
    pictogram_precedence { skull_crossbones suppresses exclamation; corrosion suppresses exclamation for [skin.2, eye.2]; health_hazard(resp_sens) suppresses exclamation for [skin_sens, skin.2, eye.2] }
    signal_word_precedence { danger over warning }
    option label.h_precedence "H 文の省略の規則を義務にするか" values [required, manufacturer] safest required source "1.4.10.5.3.3"
    h_precedence { H410 suppresses H400; H411 suppresses H401; H412 suppresses H402; H314 suppresses H318 }
  }

  tests {
    test "皮膚 区分 1 の成分 6 %" { mixture { "A" 6 % skin 1 } expect { skin 1 } }
    test "皮膚 加成方式 10×1 + 2" { mixture { "A" 0.5 % skin 1; "B" 6 % skin 2 } expect { skin 2 } }
    test "急性経口 全成分区分 3 の変換値" { mixture { "A" 50 % acute.oral 3; "B" 50 % acute.oral 3 } expect { acute.oral 3 } }
  }
}
```

### 3-2. 日本のレイヤー（JIS Z 7252:2025・JIS ルール。差分だけ）

```ghsrule
ruleset "JP-JIS2025" version 1 extends "UN-Rev9" version 1 {
  meta {
    title "日本 JIS Z 7252:2025 / Z 7253:2025（JIS ルール）"
    valid_from 2025-12-25
    note "旧 JIS 2019 は 2030-12-24 まで使える（別のレイヤー JP-JIS2019）"
  }

  // 採らない区分（Z 7252 表 1。結果は「区分に該当しない」）
  exclude acute.*.5  as not_classified
  exclude skin.3     as not_classified
  exclude asp_tox.2  as not_classified

  choose acute.category5 = exclude  locked
  choose skin.category3  = exclude  locked
  choose skin.subcategories = split locked
  choose acute.unknown_statement = sds     open   // JIS は「分類結果に追記」とだけ（B.1.3.6 b) 2)）。置き場所は自社で変えてよい
  choose acute.unknown_policy = correction open   // Gmiccs 式（0.1 % で分類できない）は自社のレイヤーで選べる
  choose label.h_precedence = manufacturer locked // Z 7253 6.3 c)「適用することが可能」＝任意

  // 濃度限界は JIS の「高い方」（表 B.17・B.21・B.24・B.27・B.31。見本では省略）

  // 区分 5 の変換値は JIS に無い（表 B.2）。土台の表から落とす
  override rule acute.oral { convert category -> ate { 1: 0.5, 2: 5, 3: 100, 4: 500 } }

  sds {
    // 濃度限界未満でも SDS に書く（Z 7252 B.4.3.4・B.6.3.2・B.7.3.2・B.8.4.4.1・B.9.3.4.1、Z 7253 D.4）
    list_ingredients_below_limit { carc.2 from 0.1 %; repr.* from 0.1 %; resp_sens.* from 0.1 %; skin_sens.* from 0.1 %; stot_se.2 from 1.0 %; stot_re.2 from 1.0 % }
    // 国内法令の記載（Z 7253 D.16）: 法規制の判定結果を差し込む（安衛法・化管法・毒劇法）
    section 15 from regulations [ISHA, PRTR, PDSCL]
  }

  tests {
    // Gmiccs（JIS ルール）での答え合わせの例をここに足す
    test "区分 5 相当は区分に該当しない" { mixture { "A" 100 % ate.oral 3000 mg/kg } expect { acute.oral not_classified } }
  }
}
```

### 3-3. 自社のレイヤー（お客さんが書く。製造者の裁量・専門家の判断・プロパティからの判断）

```ghsrule
ruleset "ACME-JP" version 3 extends "JP-JIS2025" version 1 {
  meta { title "○○化学 日本向け（社内規定 2026-04）" }

  choose acute.unknown_policy = unclassifiable_over(0.1 %)   // Gmiccs と同じにしたい
  choose acute.unknown_statement = both

  // 加成方式が使えない成分の自社リスト（JIS は例示だけ。H-20）
  flag non_additive for ingredients where cas in ["7664-93-9", "1310-73-2", "7647-01-0"] or group == "界面活性剤"

  // 製品のプロパティから自動で決める（S25 §2-10 の 3）
  rule skin add {
    if product.prop("ph") between 2 and 11.5 and product.prop("acid_alkali_reserve") == "low" then
      note "pH は中性域。予備量が小さいので pH による決め打ちはしない"
  }

  // 専門家の判断の既定（ガイダンスの目安を自社の決まりにする。§2-10 の 2）
  rule stot_se.3 override {
    weighted_sum { r = sum(conc of ingredients where category(stot_se.3) == respiratory); n = sum(conc of ingredients where category(stot_se.3) == narcotic) }
    if r >= 20 % or n >= 20 % then classify stot_se as 3
      note "専門家の判断を実施せずに 20 % 基準を適用した（Z 7252 B.8.4.4.3）"   // JIS が求める記載
  }

  labels {
    // P 文の選び方の既定（製造者の裁量。L-21〜L-24）
    p_statement P280 choose ["保護手袋", "保護眼鏡"] when product.state == "liquid"
    p_statement P280 choose ["保護手袋", "保護眼鏡", "保護マスク"] when product.prop("form") == "powder"
    omit P241 when note "国内規制でより詳細な規定がある（Z 7253 附属書 C）"
  }

  tests {
    test "未知 0.5 % で分類できない（自社の決まり）" { mixture { "A" 99.5 % acute.oral 4; "X" 0.5 % unknown } expect { acute.oral unclassifiable } }
  }
}
```

### 3-4. 判定の結果（言語の外。画面に出るもの）

- クラスごとに: 区分、決めたレイヤー（UN／国／自社／上書き）、効いた成分と含有率、使った式と数値、添える文（note）、「判断が要る」「データ不足（どのプロパティか）」の印
- 使ったルールセットの名前と版を結果に保存する（S25 §2-9）

---

## 4. 検査（エディタと保存時）

| 種類 | 例 |
| --- | --- |
| 文法 | 閉じ忘れ、知らない予約語 |
| 名前 | 知らないクラス・区分・選択点・プロパティのキー（S26 のキーと突き合わせる）・フレーズのコード（辞書と突き合わせる） |
| 単位 | `mg/kg` の所に `mg/L`、`%` の無い含有率 |
| レイヤー | 未選択の選択点、`locked` の選び直し、土台の版が無い |
| GHS としての整合 | 区分の順と濃度限界の順が逆、採らない区分への classify、H 文の省略の規則と矛盾する出力、細区分を merge なのに 1A を使う |
| 試験 | 期待と違う結果（そのレイヤーと、それを土台にするレイヤーの全部） |

---

## 5. 作る順（S25 §4 のレイヤー 1・2 の中身）

1. **文法を確定**（この文書の §6 に答えてもらう）
2. **処理系の最小版**: 解析（Langium）→ 中身の木 → レイヤーの重ね合わせ → 式の解釈器 → 計算の型 7 つ → 結果。見本の 3 ファイルと試験が通ることを確かめる
3. UN Rev.9 の全クラスと日本 JIS 2025 の全差分を書く（選択点の一覧と日本の選び方から）
4. 製品の画面に「GHS 判定（日本）」を出す。結果の保存
5. エディタ（Monaco ＋ Langium の補助）、取り込み・書き出し、版の違いの表示
6. GUI エディタ（E2）

---

## 6. 決めていただきたいこと（文法を確定するため）

> **2026-10-17 決定: 1〜8 すべて「おすすめ」のとおり。**（予約語は英語・名前と文言は自由、ブロックは `{ }`、差分の動詞はこのまま、
> 安全側の既定を国連のレイヤーに書く、国のレイヤーの `locked`/`open` で自社の選び直しの範囲を決める、成分の印は物質マスタの拡張属性、
> 結果に添える文の置き場所は選択点から引く、急性毒性と皮膚で処理系の最小版を先に動かす）

1. **予約語は英語、名前・文言は自由**（§2-1）でよいか。別案: 予約語も日本語（`ルールセット`、`選択`）
2. **ブロックは `{ }`** でよいか。別案: 字下げで構造を表す（Python 風。見やすいが、エディタ無しでは崩れやすい）
3. **差分の動詞**（adopt / exclude / choose / override / add / flag）の名前でよいか
4. 選択点の「安全側の既定」を 国連のレイヤーに書く（`safest`）でよいか。別案: 既定を持たず、UN GHS 版も必ず選ばせる
5. 自社のレイヤーで選び直せる範囲を、国のレイヤーが `locked` / `open` で決める形でよいか（JIS が任意にしている所だけ open）
6. 成分の印（`flagged(relevant)`、`flagged(non_additive)`、`no_acute_toxicity`）は、**物質マスタの拡張属性**（S26 の選択肢の項目）として持つ案でよいか。別案: 自社のレイヤーの `flag … where …` だけで持つ
7. 結果に添える文（`note`）は、ラベル・SDS のどちらに出すかを `place` で選択点から引く形でよいか
8. 見本に無い物理化学的危険性（引火性液体の `range` 型、ほかは `manual`）とラベルの決まりは、この形の延長で書く。先に全クラスの見本を書いてから処理系に入るか、急性毒性と皮膚だけで処理系の最小版を先に動かすか（おすすめ: 後者）

---

## 7. この文書に書いていないこと（次の文書で）

- フレーズの辞書の表の設計（H 文・P 文の「選ぶ語句・書き足す値・角かっこ・省略」。対訳表がそろった）
- SDS の雛形（ドキュメント生成への組み込み。SDS 版だけの部品）
- 言語の版（文法を変えたとき、古いルールセットを読む決まり）

---

## 8. できたもの（2026-10-17。§5 の 1・2）

場所は `apps/web/modules/sds/rules/`（SDS 版のモジュールの中。標準の画面には出ない）。

| ファイル                          | 役割                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ghs-rules.langium`               | 文法の第 1 版（Langium）。変えたら `npm run gen:rules -w apps/web` で `generated/` を作り直す          |
| `generated/`                      | 文法から作った解析の部品（手で直さない。lint・整形の対象外）                                            |
| `services.ts`                     | `parseRuleset(text)`: 文字列 → 中身の木。誤りは行・列つきで返す                                        |
| `engine.ts`                       | `merge`（レイヤーの重ね合わせ）、`classifyClass` / `classifyAll`（判定）、`runTests`（試験の実行）     |
| `samples/*.ghsrule`               | §3 の見本 3 つ（国連 Rev.9 抜粋・日本 JIS 2025・自社 ACME）。文法に合わせて少し直した                   |
| `parse.test.ts` / `engine.test.ts` | 見本 3 つが読めること、見本の中の試験 11 件が全部通ること、重ね合わせ・判定の中身                       |

### 8-1. 作りながら決めたこと（「勝手に決めた点」。変えたければ言ってください）

1. **各レイヤーの試験は、そのレイヤーを使う形で流す。** 国連のレイヤーの試験は国連だけで、日本のレイヤーの試験は国連＋日本で、
   自社のレイヤーの試験は 3 つを重ねて流す。（最初は「いちばん上まで重ねたもの」で全部流していたが、国連の試験「ATE 3000 は区分 5」が
   日本の「区分 5 を採らない」で落ちた。試験は書いた人が見ていた形に当てるのが筋）
2. **成分の集合は 2 種類。** `ingredients` は「考慮する成分」（`consider` / `ignore` を当てたあと。急性毒性なら 1 % 以上か `relevant` の印）、
   `all_ingredients` は全成分。Gmiccs 式の「未知成分が 0.1 % 以上なら分類できない」は 1 % 未満の成分も数えるので `all_ingredients` で書く
3. **選択点が未選択のとき**、国連のレイヤーだけで使うなら安全側の既定（`safest`）を採る。国・自社のレイヤーを重ねているのに未選択なら「問題」として返す
   （保存時の検査で止める想定）
4. **`override` は、書いた種類の文だけ差し替える。** `conversion` だけ書けば変換値の表だけ変わり、加算式などの本文は土台のまま。
   本文（if・代入・classify など）を 1 つでも書けば本文は丸ごと差し替え。`add` は本文の末尾に足す
5. **先に決まった結果が勝つ。** `precondition`（pH の決め打ち）で区分が出たあとの `classify` は無視する。
   `needs_judgement` と `note` は結果に関係なく積む
6. **採らない区分（`exclude`）の読み替えは判定の後。** 国連の式で区分 5 が出てから「区分に該当しない」に読み替え、
   読み替えたことと元の区分を結果に残す（画面で「国連なら区分 5」と出せる）
7. **皮膚の細区分は、全成分に細区分のデータがあるときだけ付ける**（国連 3.2.3.3.4.1）。区分 1 としか分かっていない成分が 5 % 以上なら 1C でなく 1。
   見本の国連のレイヤーをそう直した
8. **1 % 未満でも `relevant` の印があれば数える。** 見本の試験「10×区分 1 ＋区分 2」は 0.5 % の成分に `flag relevant` を付けた
   （印が無ければ 1 % 未満は考慮しないのが国連の決まり）
9. 式の中で知らない名前（`split`、`1A`、`unclassifiable_over` など）は**記号**として扱う（文字列と同じ比較）。数値と区分の比較は文字列にそろえて行う（`1 == "1"`）
10. 文法: 数値 `10` は名前より先に読む（`10 * c1` が名前 `10` と読まれて計算できなかった）
11. **処理系が足す文は文言でなく種類（`code`）で返す**（`missing_value`＝計算に必要な値が無い、`excluded_category`＝採らない区分を読み替えた）。
    文言は画面側がモジュールの `messages.ts` で付ける。本体の辞書（`packages/shared/src/i18n`）に SDS 版だけの言葉を入れないため。
    ルールセットに書いた `note "…"` はそのまま `text` で返す

### 8-3. 原則: 成分のデータは国連の区分のまま読む。国の採用区分は製品の結果にだけ当てる（2026-10-17 決定）

成分（物質）に付いている区分は、その国が採用していない区分（急性毒性 区分 5、皮膚 区分 3 など）でも、国連 GHS の区分として
そのまま信じて計算に入れる（区分 5 なら変換値 2500 mg/kg）。国の採用区分（ビルディングブロック）は、製品の最終結果を出すときに
`exclude … as not_classified` で読み替えるだけ。国のレイヤーは変換値の表や成分の読み方を差し替えない。
見本の日本のレイヤーにあった「変換値の表から区分 5 を消す」上書きは消した。試験「区分 5 40 % ＋ 区分 4 60 % → 区分 4」を足した。

### 8-2. まだ無いもの（次にやる）

- **計算に JavaScript の数値を使っている。** 本番に載せる前に decimal.js に替える（CLAUDE.md の決まり。処理系の最小版なので後回しにした）
- `labels`・`sds` のまとまりは読むだけで、ラベル要素（H 文の優先・P 文の選び方・省略）はまだ計算しない
- `range`・`threshold`・`manual` の型は枠として読めるが、見本に無いので動かしていない（§5 の 3 で全クラスを書くときに）
- `note` の `{…}` に書けるのは名前と `sum(conc of 名前)` だけ
- `adopt`・`defaults safest` は読み飛ばし
- 結果の保存・画面（§5 の 4）、エディタ（§5 の 5・6）
- ~~決めてもらうこと: 成分の区分 5 の扱い~~ → 2026-10-17 決定。§8-3
