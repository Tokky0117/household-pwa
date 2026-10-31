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

## 接続確認結果（2026-10-31：GitHub Secrets登録後）

- GitHub Actionsの読み取り専用監査（`.github/workflows/gas-remote-source-audit.yml`）で試験用Script IDの照合に成功し、`clasp pull` による現行GASソース取得が成功した。GitHubのSecret値や現行GASソース全文はログに出していない。
- 現行GASソースの名前は日本語の **`コード.js`** （`Code.gs` ではない）。既存の反映用ワークフロー `.github/workflows/gas-push-test.yml` はバックアップ検査で `Code.gs` を要求しているため、**現在のままでは上書き処理は安全側に停止する**。変更前にこの相違を解消する必要がある。
- 取得できたスクリプトソースは1ファイル、約15.9 KB。開発ブランチの `gas/Code.gs` と内容は一致しない。
- 既存の `doGet`、`doPost`、`authenticate`、`bootstrap`、`testAllSheetsReadOnly` は確認できた。一方、開発済みの `mutateItemSafely_`、`runIsolatedItemWriteTrialOnce_`、`productCatalog_`、`productAliasCheck_`、`mutateAliasSafely_`、別名登録試験用3関数は**未反映**。
- **実GASのコード更新・デプロイ・実Spreadsheetへの書き込みは一切行っていない**。認証情報が利用できることと、実シートが安全に更新できることは別の段階として判断する。
- 読み取り専用検査の成功：<https://github.com/Tokky0117/household-pwa/actions/runs/41164986405>。

### 次に必要な安全確認

1. 現在の試験用GASプロジェクトの `コード.js` と `appsscript.json` の**バックアップをユーザー管理の安全な場所へ保存**する。公開リポジトリや公開Actionsのアーティファクトへ、内容未検査のGASコードを不用意に保存しない。
2. テスト専用GASの現行機能と開発版GASの差分を確認し、未移植の重要機能がないことを確認する。開発版の `Code.gs` と現行の `コード.js` のファイル名差を反映用の手順で明示的に扱う。
3. その後、試験環境の上書き許可を得てコードを反映し、最初は読み取り専用のスキーマ・家庭分離・事前確認のみ実行する。商品コード登録試験の書き込みは後段に分離する。

## 2026-10-31：ローカルバックアップ確認後の反映準備

- ユーザーがWindows PCのバックアップ用フォルダに `コード.js`、`appsscript.json`、`.clasp.json` の3ファイルがあることを確認した。GitHubの認証用Secretは登録済みで、GitHub Actionsから試験用GASへの読み取り専用 `clasp pull` は成功している。
- 差分検査では、現行GAS側にだけある関数は `append`、`initializeEmptySchema`、`mutate`、`testGoogleConnection`、`write` の5つ。開発版では対応機能の改訂・関数名変更を行っているので、**既存コードがそのまま保持されるわけではない**点に注意する。
- 現行 `appsscript.json` には `dependencies` と `webapp` 設定がある。開発版のマニフェストと同一ではないが、開発版で要求するOAuthスコープは現行設定に含まれる。したがって、**現行マニフェストは変更せず保持**する。
- `.github/workflows/gas-push-test.yml` の反映手順は、試験用GASのScript IDのハッシュ一致、実行ブランチ、2重確認入力（`BACKUP_DONE`、`TEST_GAS_UPDATE`）、現行ファイルが `コード.js` と `appsscript.json` の2件のみ、既知旧関数の一覧、OAuthスコープを検査し、試験用GASソースだけを更新する形に改めた。実GASの再デプロイ・スプレッドシートへの書き込みは行わない。
- 反映ワークフローは **手動実行専用かつ未実行**。GitHubの仕様上、`workflow_dispatch` のUI起動にはワークフローファイルが既定ブランチにも必要だが、現在の `main` にはない。`main` を無断で更新しないため、現段階でユーザーを「Run workflow」ボタンへ誘導しない。実行時は別途、試験ブランチだけの明示承認付き一時トリガー、またはWindowsの `clasp.cmd push` を検討する。
- これまで実行したのは**試験用GASの読み取り専用検査とGitHub開発ブランチの変更だけ**。GASソースの反映・デプロイ・実Google Sheetsへの書き込みは行っていない。書き込み前に試験用GASのソース置換をユーザーに確認する。

## 2026-10-31：ユーザー承認に基づく試験用GASへのソース反映完了

- ユーザーが `試験用GASの更新を許可` と明示し、既存PCバックアップの3ファイル確認済み。**本番環境はまだ作成していない**との申告がある。
- 読み取り専用で採取した現行試験GASのソースとマニフェストのSHA-256を反映用ワークフローに固定し、変更検出・日本語ファイル名 `コード.js` の検査・既存専用関数の確認・既存マニフェスト維持・Script ID照合を通過した場合に限り、GitHubの開発ブランチから **試験用GASのソースコードだけ**を更新した。
- 実行結果：`https://github.com/Tokky0117/household-pwa/actions/runs/41166176277`。`clasp push --force` 成功後、`clasp pull` で必要関数の存在を確認し、実行ジョブ成功。
- 直後に、許可された一回限りのGitHub Actions自動更新経路を無効に戻した。以降の単なる開発ブランチへのプッシュではGASを書き換えない。
- 再度の読み取り専用監査 `https://github.com/Tokky0117/household-pwa/actions/runs/41166238013` が成功。**試験用GASソースとGitHub開発版のバイト列が一致**し、マニフェストのハッシュは更新前から変わっていない。
- **GASのデプロイ、`SPREADSHEET_ID` などのScript Properties、Google Sheetsのデータは未変更**。`product.catalog` / `product.alias.check` / `product.alias.create` の実Google認証・実通信・実Sheetへの書き込みは未試験。

### 次の実機試験

1. `https://script.google.com/home/projects/15pyx5qYzEMEqgGQmbSyRdx5U2DywTxnRYgWpQb9lazE__tGwQ58DJGIU/edit` で試験用GASの関数選択を開く。
2. `testIsolatedAliasWriteTrialPreflightReadOnly_` を実行。最初の試験は**読み取りのみ**。試験専用Sheet設定・全12シート・カテゴリ5件・家庭/ユーザーと既存在庫試験の操作履歴が一致すれば `ALIAS_TRIAL_PREFLIGHT_OK` が記録される。
3. `SPREADSHEET_ID` と `WRITE_TRIAL_SPREADSHEET_ID` が**同じ試験用シート**であること、`ENABLE_EXPERIMENTAL_WRITES` が未設定または `true` 以外であることが前提。**本番環境は現時点で存在せず、新設はしない**。
4. 読み取り専用の合格を確認した後に限り、ユーザーの意図を確認してから `runIsolatedAliasWriteTrialOnce_` に進む。実行すると架空の1商品・1チェーン・1コードがSheetsに書き込まれる。

注意：開発ブランチの `gas-push-test.yml` は現在 `workflow_dispatch` のみに戻されているため、ユーザーによるGASソース更新は明示的な別工程として扱う。
