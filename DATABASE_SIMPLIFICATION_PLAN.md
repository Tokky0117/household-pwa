# くらしストック｜データベース簡素化 設計検討（2026-11-14）

状態：**調査・設計のみ。GAS / Sheets / PWA のスキーマ変更は未実施。**
対象：試作ブランチ preview-v46-clean-base。本番 main への変更は禁止。
前提：利用者確認により既存のレシート明細データの維持・移行は不要。ただし商品・日用品・店舗等の既存データまで破棄してよいとは解釈しない。端末内の未送信キューとGASの列定義の一致は必要。

## 12テーブルの扱い

| テーブル | 方針 | 根拠・留意点 |
| --- | --- | --- |
| households | 維持 | 単一家庭でも現行の家庭識別・認可・同期に利用 |
| users | 維持（認証再開時に再評価） | Google認証のデータ構造が存在。現在は temporary-household |
| categories | 維持 | 日用品分類で使用 |
| stores | 維持 | 店舗マスタ |
| item_groups | 維持 | 日用品・在庫・表示順 |
| products | 維持 | 商品マスタ、内容量、日用品参照 |
| product_aliases | 維持 | 店舗別OCR原文辞書、商品候補照合 |
| records | 維持、raw_store_name削除候補 | 支店名 branch_name は使用 |
| record_items | 維持、列を簡素化 | 下記 |
| change_log | 維持 | 同期差分取得 |
| processed_operations | 維持 | 操作の冪等性・中断復旧 |
| receipt_rules | **廃止候補** | 調査対象の主要実行コードに参照なし。GAS以外も最終確認 |

## record_items

| 列 | 方針 | 理由 |
| --- | --- | --- |
| record_item_id, record_id, line_order | 維持 | 主キー・親参照・表示順 |
| product_id | 維持 | 購入時点の明細と商品紐付け。product_aliases.product_id と独立 |
| quantity, amount_tax_included | 維持 | 購入個数・明細全体の税込金額 |
| alias_id | 維持 | OCR原文の辞書参照 |
| confirmed_name | 維持 | OCR原文がない手入力・写真再解析名 |
| suggested_product_name | 維持 | 生成AIの商品登録候補 |
| suggestion_kind | 維持・意味を明確化 | existing/new のみ一括登録対象。未判定は空欄のまま |
| inferred_name | **廃止** | 候補名と重複。解析・下書き・商品登録初期値を整理 |
| category_id | **廃止** | 旧家計簿用カテゴリ。日用品カテゴリとは別 |
| price_eligible | **廃止** | 現行は product_id 有無から設定される冗長フラグ |
| raw_name | **廃止候補・要確認** | 新規保存は alias_id + product_aliases.ocr_name に格納。旧レシート互換処理とプレビューの参照を除去してから削除 |
| created_at, updated_at, version, deleted_at | 維持 | 操作履歴・競合・論理削除 |

## 推定名の一本化で守る仕様

- OCR原文は推測で上書きしない。
- 生成AIによる商品名候補は suggested_product_name に格納する。
- suggested_product_name があっても suggestion_kind が空なら一括商品登録の対象外とする。
- 一括商品登録は existing/new と確定した候補のみ。候補名は商品マスタへの登録・紐付けを自動実行しない。
- 写真再解析でOCR行がない場合は confirmed_name を使用する。OCR辞書に架空の原文を登録しない。
- 保存済みレシートの商品登録フォームは suggested_product_name を優先し、なければOCR原文・confirmed_nameを初期値にする。

## 残る調査

1. raw_name と alias_id の依存を完全に洗い出し、原文辞書に統一できるか確定。
2. receipt_rules の実データ・OCRエンジンの参照を確認。
3. records.raw_store_name の表示・入力・同期の参照を確認。
4. ほかの正規化列・household_id・version等は現状維持（重複に見えても実行上の責務あり）。
5. 現行テスト・スキーマ列順・端末未送信キューを揃えるため、GAS、Setup、live-client、app、receipt-review-model、テストを同じ変更単位で更新。
6. GASとSheetsを切り替える前にプレビューCIを成功させる。既存レシートデータ移行不要でも、実際のSheets列削除は接続先と対象範囲を確認してから行う。

## 現在のUI試作CI

2026-11-14の画面改善コミット後、プレビューActionsが失敗している。テストの旧表記期待を一部更新したが、再実行も失敗。原因の特定と修正を先に実施する。CIが成功したと断言しない。

## 追加調査：削除対象の確定（2026-11-14）

- `receipt_rules`: GAS Api / Setup（Setupの定義以外）、アプリ、同期クライアント、レシート解析関連の主要JSで実行時参照なし。**廃止確定**（本番シート削除はまだ実施しない）。
- `records.raw_store_name`: 新規GAS保存では常に空文字、同期・プレビューの初期値にも空値のみ。店舗表示は chain_id と branch_name を使用。**廃止確定**。
- `record_items.raw_name`: GASではOCR名辞書への入力として使うが、永続化する新規明細は空文字。実データ移行不要のため、**Sheetsの保存列は廃止確定**。ただしクライアント→GASの `raw_name` 入力契約はOCR原文辞書作成に必要なので維持する。つまり「保存列の削除」と「API入力項目の削除」は別物。
- `record_items.alias_id` は OCR原文辞書参照として維持。
- `record_items.confirmed_name` は写真再解析・手入力明細の保存名として維持。
- `record_items.inferred_name` は削除確定。解析時の一時 `nameCandidate` と保存用 `suggested_product_name` を整理し、`suggestion_kind` が空の候補は一括商品登録の対象外とする。
- `record_items.category_id`, `price_eligible` は削除確定。価格比較の対象判定は product_id 等の現在の条件で計算する。

### 実装時の変更単位

1. 先行UIのCI失敗を解消する。
2. アプリの下書き・編集・保存・表示、同期キューの正規化とローカル投影を更新する。
3. GASの保存契約、辞書作成、操作ジャーナル、シート定義を同時に更新する。旧 `raw_name` 移行関数は廃止する。
4. テストを更新し、プレビューCIで保存・再送・編集・削除・商品紐付け・一括登録を検証する。
5. **既存レシートデータ移行は不要**だが、GASスクリプトのデプロイとSheetsの列更新は接続先の整合性を保つ順番で行う。mainは変更しない。
