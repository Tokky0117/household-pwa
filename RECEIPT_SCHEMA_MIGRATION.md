# くらしストック｜試作Sheetsのスキーマ切替（v46 → v94）

更新日：2026-11-15

> **未実施の手順です。** GitHub上のv94コードとCIが成功しても、試作Google Sheetsの実データは切り替わりません。利用者が対象を確認して実行するまで、試作GAS・Sheetsには変更を加えません。**本番 `main`・本番GAS・本番Sheetsは変更しません。**

## 1. 対象と前提

- 旧コード：`preview-v46-clean-base`（アプリ表示 v0.93.0）
- 新コード：`preview-v94-schema-names`（アプリ表示 v0.93.0）
- 対象：**v46が接続する試作用**GASとGoogle Sheetsのみ
- 旧Sheetsの前提：すでに11シート化済みで、`stores`・`item_groups`・`product_aliases` が存在すること。12シート・`receipt_rules`・旧レシート列が残っている場合、まず既存の [12→11整理用スクリプト](./scripts/trial-sheet-schema-cutover.gs) の別手順が必要です。直接v94へ移行しません。
- `records.branch_name` に値が残っている場合は**削除せず中止**します。
- 日用品、商品、店舗、OCR読み取り名辞書、購入履歴、同期履歴などのデータ行は移行中に初期化・消去しません。
- 列定義の正本は `gas/Setup.gs` の `KURASHI_NEW_SCHEMA`。特に `record_items` の購入商品 `linked_product_id` と OCR辞書の照合先 `auto_match_product_id` は別の役割です。

## 2. v46 → v94で変わる保存名

| v46 | v94 |
| --- | --- |
| `stores` | `retail_chains` |
| `item_groups` | `household_items` |
| `product_aliases` | `receipt_name_mappings` |
| `item_groups.item_group_id` | `household_items.household_item_id` |
| `products.item_group_id` | `products.household_item_id` |
| `products.item_group_order` | `products.household_item_order` |
| `product_aliases.alias_id` | `receipt_name_mappings.receipt_name_id` |
| `product_aliases.product_id` | `receipt_name_mappings.auto_match_product_id` |
| `product_aliases.normalized_alias` | `receipt_name_mappings.normalized_receipt_name` |
| `record_items.product_id` | `record_items.linked_product_id` |
| `record_items.amount_tax_included` | `record_items.line_total_tax_included` |
| `record_items.alias_id` | `record_items.receipt_name_id` |
| `record_items.confirmed_name` | `record_items.non_ocr_name` |
| `record_items.suggested_product_name` | `record_items.product_name_candidate` |
| `record_items.suggestion_kind` | `record_items.candidate_match_type` |
| `records.branch_name` | 削除（全行空欄の場合だけ） |

**実データ値は変更せず、シート名・ヘッダー名の変更と空の支店名列の削除**だけを行います。11シートを維持します。

## 3. 実行前の確認（利用者が行う）

1. v94の最新CIが成功していることを確認する。
2. 試作を利用する**すべての端末**で未送信操作キューが0件であることを確認し、試作アプリの使用を停止する。本番アプリは対象外。
3. 試作用GASのスクリプトプロパティ `SPREADSHEET_ID` と実際の試作用SheetsのIDを照合する。**名前だけで判断しない。** IDを公開リポジトリやチャットへ貼らない。
4. Sheetsがv46の11シート構成であること、`branch_name` の列に値がないこと、各マスタ・OCR辞書・履歴の行数を確認する。
5. 試作用Sheets全体の**別コピーを作成**する。切替処理も書き込み前にもう一度コピーを自動作成する。
6. 切替中はv46もv94も開いて同期しない。途中で異常終了したら、原因を解消するまで書込を再開しない。

## 4. 試作GASでの事前確認と命名切替

以下の処理は**試作GASのApps Scriptエディタで手動実行するもの**です。公開中のWebアプリへの通常リクエストからは実行されません。

1. 11シートの安全確認が完了したら、試作GASエディタの `Api.gs` と `Setup.gs` をv94ブランチと同じコードに更新する。**この時点では公開デプロイを更新しない**。既存コードを保存・退避しておく。
2. 試作GASのスクリプトプロパティ `KURASHI_TRIAL_NAMING_TARGET_ID` に、確認済みの**試作用Sheets ID**を指定する。設定済み `SPREADSHEET_ID` および `KURASHI_NEW_WORKBOOK_ID` と一致しなければ停止する。
3. `KURASHI_TRIAL_NAMING_APPROVAL` を未設定または `CHECK_ONLY` として、エディタで `kurashiTrialNamingPreflight()` を実行する。これは**読み取り専用**。ログの `READY_AFTER_USER_CHECK` と対象変更6件、または `ALREADY_COMPLETE` を確認する。不明な列・未完了の操作履歴・値のある `branch_name` を検出したら、切替せず中止。
4. 結果を確認した場合に限り `KURASHI_TRIAL_NAMING_APPROVAL` を `APPLY_TRIAL_SCHEMA` とし、`kurashiApplyTrialNamingCutover()` を**1回だけ**実行する。全シートをDriveへ自動バックアップし、スキーマを変更する。正常結果は `SCHEMA_NAMING_UPDATED_11_TABLES`。
5. 直ちに承認プロパティを `CHECK_ONLY` に戻す。再度 `kurashiTrialNamingPreflight()` を実行し、`ALREADY_COMPLETE` を確認する。11シート・新ヘッダー・データ行数・OCR辞書の商品ID参照を照合する。
6. バックアップ、検証結果、切替対象が確定した後にはじめて、GitHub Actions **Deploy only the NEW Kurashi GAS** を **`preview-v94-schema-names` から手動実行**する。ワークフローは新GASの既存デプロイだけを更新し、更新後に11シートを使った読込を検証する。
7. 正常デプロイ後、v94試作アプリを再読み込みし、日用品・商品・店舗・OCR名と価格情報、レシート保存・編集・削除、商品リンク、オフライン再送、2端末同期を実機で確認する。

## 5. 禁止事項と障害時の停止条件

- `main`、本番GAS、または本番Sheetsへこの操作を行わない。
- `setupNewWorkbook()` を既存試作Sheetsの列変更目的で実行しない。
- 旧GASと新スキーマ、または新GASと旧スキーマを組み合わせたまま試作アプリを使用しない。
- v94のGASで使われる `kurashiBook_()` は**シートを自動改名しない**。スキーマが未切替の場合はエラーで停止する。
- スキーマ変更途中で例外が出た場合は**操作・同期を停止**し、保存したバックアップから状態を確認する。手動で列名だけ直して使用再開しない。
- 手順を完了しても本番リリースにはならない。正式リリースには別途ユーザーの指示が必要。

## 6. 検証ファイル

- GASの切替・事前検証・バックアップ：`gas/Api.gs` の `kurashiTrialNamingPreflight` / `kurashiApplyTrialNamingCutover`
- モック移行テスト：`tests/trial-sheet-schema-cutover.mjs`
- アプリ・操作キュー・同期テスト：`tests/no-login-household.mjs`
- UI回帰テスト：`tests/ui-smoke.mjs`
- 以前の12→11切替専用（v46への事前準備であり、**v94命名切替には使わない**）：`scripts/trial-sheet-schema-cutover.gs`
