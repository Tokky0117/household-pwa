# 既存試験用GAS・スプレッドシート 実機検証引き継ぎ（2026-10-31）

## 対象と方針

ユーザーから既存の **試験用スプレッドシート** と **試験用Apps Scriptプロジェクト** のURLが提供された。ID・リンク先の実データはこの公開リポジトリに転載しない。アーキテクチャは **PWA → GAS → Google Sheets** のまま。新サーバー・新スプレッドシートは作成しない。本番(main/本番GAS/本番Sheets)の変更は禁止。

## 今回確認できたこと

- 開発ブランチの `gas/Code.gs` には `testIsolatedAliasWriteTrialPreflightReadOnly_`, `runIsolatedAliasWriteTrialOnce_`, `testIsolatedAliasWriteTrialResultReadOnly_` の3関数がある。
- 試験用の書き込みは、試験シート識別・家庭1件/ユーザー1件・書き込み許可OFF・全12シート列・既存の完了済み試験履歴の検証後のみ、架空の試験用店舗・商品・コードを登録する。
- エディタ専用試験はブラウザAPIの書き込みを有効にせず、同一操作IDによる再試行で重複を増やさない。
- オフラインCIは成功した。**実GASと実Sheetでの実行成功を意味しない。**
- `.github/workflows/gas-push-test.yml` は既存の試験用GAS向けに `clasp` で反映する仕組みだが、手動実行・バックアップ確認入力を要求するため、勝手に実行していない。
- 読み取り専用の `gas-remote-source-audit.yml` を実行したが、GitHub側に `CLASPRC_JSON` または `GAS_SCRIPT_ID_TEST` が未設定であり、**GASプロジェクトのコードもSheetsの内容も読めていない**。実接続の成功と誤解しないこと。設定した場合でも、監査はユーザーが示した試験GASと接続先Script IDが一致するかをハッシュで確認し、実コードやシート内容をログに出さず読み取る。

## 実試験の最小安全手順（ユーザーによる編集が必要な場合）

1. 提供された**試験用Apps Scriptプロジェクト**を開く。ソースは既存ブランチ `gas/Code.gs` と比較し、**必ず現行GASコードをバックアップ**してから新コードへ更新する。スプレッドシートIDや認証情報をリポジトリへ記載しない。現行GASをいきなり一括上書きしない。
2. Apps Scriptの **プロジェクトの設定 → スクリプト プロパティ** で `SPREADSHEET_ID` と `WRITE_TRIAL_SPREADSHEET_ID` が**提供された同じ試験用シートID**か確認する。 `ENABLE_EXPERIMENTAL_WRITES` は `true` にしない。試験用スプレッドシートの家庭名は `[KURASHI_WRITE_TRIAL_ONLY]`、ユーザーは1件のみ。
3. Apps Scriptエディタから **`testIsolatedAliasWriteTrialPreflightReadOnly_` だけを実行**する（この関数は読み取り専用）。成功時のログは `ALIAS_TRIAL_PREFLIGHT_OK`。既に別名試験を行った後であれば `TRIAL_NOT_EMPTY` が正常に返る場合がある。
4. その結果を確認してから、テストの書き込みを許可する場合だけエディタから **`runIsolatedAliasWriteTrialOnce_`** を手動実行する。架空データのみ追加され、ログに `ALIAS_TRIAL_ONCE_OK` が出る想定。失敗時は削除や操作ID変更をせず、ログのエラーコードと状態を調べる。
5. **`testIsolatedAliasWriteTrialResultReadOnly_`** で保存結果を再検査する。実シートのコード列の先頭ゼロ、各種履歴の件数と整合性が確認できなければ本番接続を進めない。

## 本番へ進む前の条件

本試験が実Sheets上で成功し、認証済み `product.catalog` と `product.alias.check` が期待通りの家庭内商品・別名だけ返すことを別途確認する必要がある。正式な `product.alias.create` はブラウザの `gas-api.js` ではまだ `UNSUPPORTED` に固定されている。実デプロイ・本番商品コード登録は未実施。

検証でユーザーから受領する情報は**ログの成功／失敗とエラーコードのみ**で十分。トークン、商品データ、スプレッドシートの全内容を貼り付ける必要はない。
