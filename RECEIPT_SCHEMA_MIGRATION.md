# くらしストック｜試作Sheets・GASのv94移行（GitHub Actions実行）

更新：2026-11-15

> **未実行**。この手順は試作 `preview-v94-schema-names` 専用で、本番 `main`・本番GAS・本番Sheetsに反映しない。作業途中で試作アプリを操作しない。

## 何を変えるか

既存の試作Sheetsが旧12シート構成の場合、まず `receipt_rules` と不要なレシート列を整理し、旧11シート構成に揃える。その後、11シートを維持したまま次の名前を変更する。

| 旧 | 新 |
| --- | --- |
| `stores` | `retail_chains` |
| `item_groups` | `household_items` |
| `product_aliases` | `receipt_name_mappings` |
| `item_group_id` | `household_item_id` |
| `item_group_order` | `household_item_order` |
| OCR辞書の `product_id` | `auto_match_product_id` |
| OCR辞書の `alias_id` | `receipt_name_id` |
| OCR辞書の `normalized_alias` | `normalized_receipt_name` |
| 購入明細の `product_id` | `linked_product_id` |
| 購入明細の `amount_tax_included` | `line_total_tax_included` |
| 購入明細の `alias_id` | `receipt_name_id` |
| 購入明細の `confirmed_name` | `non_ocr_name` |
| 購入明細の `suggested_product_name` | `product_name_candidate` |
| 購入明細の `suggestion_kind` | `candidate_match_type` |
| `records.branch_name` | 空欄であることを確認して削除 |

`receipt_name_mappings` は**将来のOCR自動照合先**、`record_items.linked_product_id` は**過去の購入明細で確定した商品**を保持する。既存の登録商品・日用品・店舗などのデータ行は初期化しない。

## 操作（GitHub Actions）

これまでと同じ `Deploy only the NEW Kurashi GAS` を使用する。コードをApps Scriptエディタに貼り付ける必要はない。

1. **試作アプリのすべての端末で未送信操作が0件**になっていることを確認してから、試作アプリを閉じる。本番アプリは対象外。
2. <https://github.com/Tokky0117/household-pwa/actions/workflows/gas-deploy-new.yml> を開き、**Run workflow** で `preview-v94-schema-names` を選択する。
3. `schema_operation = check` で実行する。これは**読み取り専用のSheets事前検査**であり、スキーマや公開中のGASデプロイを変更しない。ただし、試作GASの未公開HEADコードはv94へ更新する。
4. Actionsログの `Trial workbook preflight` の `stage` と `status` を確認する。
   - `legacy_12_to_11`：12シートの旧構成が残っている。
   - `v94_names`：11シートの命名変更が必要。
   - `complete`：v94スキーマに移行済み。
   - エラー：**変更を行わず停止**。対象・ヘッダー・保存途中の操作を確認する。
5. `READY_AFTER_USER_CHECK` なら、同じワークフローを `schema_operation = migrate_and_deploy` で再実行する。`trial_queues_empty_and_clients_stopped` にチェックを入れる。認証済みのGAS関数が**最初に全シートのバックアップを新しいGoogleスプレッドシートに作成し、行・列・値を検証**した後に必要な移行を実行する。
6. `ALREADY_COMPLETE` なら `schema_operation = deploy_only` を選択する。データ移行は行わない。
7. 検証が正常終了したときのみ、既存の**試作GASデプロイID**を更新する。終了後に試作アプリを再読込して、日用品・商品・店舗・レシートの保存、OCR名、商品紐付け、価格比較、同期を確認する。

**Actionsで選択肢が表示されない場合**、その実行画面から旧手順を開始せず知らせてください。選択肢に対応したv94側ワークフローが使えるか確認します。

## セキュリティ・停止条件

- 試作GASの `SPREADSHEET_ID` と `KURASHI_NEW_WORKBOOK_ID` が一致し、`KURASHI_SCHEMA_VERSION=1` でなければ処理を中止する。
- シート数、すべての既知の見出し・列構成を厳格に確認する。データのある `receipt_rules`、値のある `records.branch_name`、保存途中の操作履歴、未知の列があれば変更しない。
- デプロイ対象のGASプロジェクトと既存WebアプリのデプロイIDを確認してから未公開コードを更新する。
- 一時的な操作APIに移行機能を公開せず、**Google OAuthで認証したApps Script API実行**だけに限定する。
- `migrate_and_deploy` 時にコピーが失敗したら変更しない。途中の移行で失敗したら試作アプリを再開せず、バックアップとActionsログを確認する。
- `check` は公開GASを更新しない。試作Sheetsへの書込みは `migrate_and_deploy` の実行時のみ。
- 以前の `scripts/trial-sheet-schema-cutover.gs` は**旧手動方式の予備手段**。このワークフローでは使用しない。

## Apps Script API実行に関する注意

このワークフローは `@google/clasp@3 run-function` を使用する。既存の試作GASに**API Executableのデプロイ**があり、GoogleのApps Script APIが有効で、既存の `CLASPRC_JSON` 認証がスクリプト実行に対応している必要がある。従来の**Webアプリ公開**とAPI Executableは別物で、既存設定がそのまま利用できるかは実際の `check` 実行で確認する。

「API executableがない」「必要なOAuthスコープがない」などで `check` が失敗した場合は、Sheetsや公開版GASに変更を加えず停止する。アプリのデータを削除したり、別GASに自動切替したりしない。Apps Script APIの条件は[Google公式の実行手順](https://developers.google.com/apps-script/api/how-tos/execute)も参照する。

## `GAS_EXECUTION_API_NOT_FOUND` が出た場合

`check` が返した Google 側の `NOT_FOUND` は **試作Sheetsの不整合が判明したという意味ではありません**。Apps Script API経由の関数実行自体が成立せず、シート構成はまだ不明です。**この時点で `migrate_and_deploy` は実行しない**でください。なお `check` によって試作GASの未公開HEADソースは更新済みですが、公開中のWebアプリのデプロイは更新されません。

次を順に確認します。

1. 試作用Apps Scriptプロジェクトの「デプロイを管理」を開き、**Webアプリとは別の「API実行可能ファイル」**のデプロイがあるか確認する。アクセス権は **「自分のみ」** とし、公開範囲を広げない。
2. API実行可能ファイルがない場合は、既存のGASと呼び出し元に共通の**標準Google Cloudプロジェクト**、Apps Script APIの有効化、OAuth認証スコープを確認する。デフォルトのGoogle CloudプロジェクトだけではApps Script API実行の要件を満たさない。
3. Google側の一時的な障害でも同様のエラーになることがある。設定が正しい場合は、単純なGAS関数の実行でも再現するかを確認する。
4. Google Cloud設定の変更を避ける場合、**試作用GASエディタ上で、すでにGitHubから転送済みの `kurashiTrialNamingPreflight` を直接実行する代替経路**もある。データ変更は行わず、結果の `stage` / `status` だけ確認する。GASコードを貼り付ける必要はない。

API実行可能ファイルの要件は [Google公式](https://developers.google.com/apps-script/api/how-tos/execute) を参照してください。`check` の失敗時には移行処理やWebアプリデプロイへ進まず、安全に停止する。

## テスト

`tests/trial-sheet-schema-cutover.mjs` は旧12シート・旧11シート・新11シート、バックアップ、繰返し実行、未知の列、未完了操作、支店名の残存を検査する。その他のUI・GAS同期・レシート回帰テストは従来のCIで確認する。
