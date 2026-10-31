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

## 2026-10-31最終：GASエディタ用の読み取り専用入口を反映

- Apps Scriptでは名前が `_` で終わる関数はエディタの実行候補に出ない場合がある。内部実装 `testIsolatedAliasWriteTrialPreflightReadOnly_` はそのまま保持し、エディタから選べる公開ラッパー **`testAliasTrialPreflightReadOnly`** を追加した。このラッパーは内部の読み取り専用関数だけを呼び出し、**Google Sheetsへの書き込み処理を含まない**。
- 開発ブランチのオフライン回帰テストでは、ラッパー実行時の書き込み数が0件であることを確認し成功。
- 試験用GASへ追加のコード更新が成功：<https://github.com/Tokky0117/household-pwa/actions/runs/41166432369>。更新後の読み取り専用再取得で **GitHubの開発版と完全一致**、マニフェストのSHA-256は更新前から不変：<https://github.com/Tokky0117/household-pwa/actions/runs/41166492359>。
- 一度限りのGitHub Actions自動反映トリガーは再度無効化。現状のGASソースを取得・更新しただけで、**Webアプリのデプロイ、Script Properties、Google Sheetsには変更していない**。
- **次のユーザー操作**：試験用GASエディタを再読み込み → 関数選択から `testAliasTrialPreflightReadOnly`（末尾の `_` なし）を選択 → 「実行」。`ALIAS_TRIAL_PREFLIGHT_OK` が出るか、失敗した場合はエラーコードを確認する。書き込み用の公開入口は追加しない。

## 2026-10-31：既存試作用シートのリモート読み取り検査

- ユーザーが既存の試作環境から引き継いだ**試作用GAS・シート**をそのまま再利用していることが判明。隔離された空の書き込み試験用コピーという前提が保証されないので、**households/usersなどの実データを試験ラベルに合わせて編集してはならない**。
- 既存GASの `testAliasTrialPreflightReadOnly` で `assertIsolatedTrialIdentity` が安全停止。条件は家庭1件・ユーザー1件・家庭名 `[KURASHI_WRITE_TRIAL_ONLY]`・同じhousehold_id・numeric auth_subject。どの条件が実シートで違うかは未確認。
- GitHub Actions `gas-test-sheet-readonly-audit.yml` からGoogle Drive APIのファイルメタデータにアクセスし、**ユーザー指定のシートIDが存在することをハッシュで確認**。ただしGoogle Sheets APIは `403 SERVICE_DISABLED`、Driveのxlsxエクスポートは `403 appNotAuthorizedToFile`。**セル内容・行数・列見出しの読み取りには失敗している**。
- GitHub Actionsのログには、実際のシートID、Googleアカウント情報、アクセストークン、セルの値は出していない。Google SheetsおよびGASの変更・デプロイ・データ削除はなし。
- 読み取り専用検査結果：<https://github.com/Tokky0117/household-pwa/actions/runs/41168206588>。
- **現状の制約**：現在のclasp認証はGASのコード管理には有効だが、既存シート全体の内容へのアクセス権がない。実データの過不足を確認するには、ChatGPTのGoogle Drive連携を接続するか、利用者が試用シートのExcel形式エクスポートをこの会話に渡す必要がある。公開リンク化やユーザーの個人データの貼り付けは求めない。
- 連携後はまず**読み取り専用で**12シートのタブ・見出し・行数、`households`と`users`の整合、カテゴリ5件、既存在庫試験の操作履歴、商品・店舗・別名・レシートの既存行を確認し、試作用として許容できるデータと、隔離書き込み試験に適さないデータを区別する。改修案は実態確認後に決める。

## 2026-10-31：既存の試作用シートを壊さない診断を追加

- ユーザーはプラグインを当面使わない方針。GitHub側の既存clasp認証で対象シートの存在は確認できたが、Sheets APIは `403 SERVICE_DISABLED`、Drive Excelエクスポートは `403 appNotAuthorizedToFile`。この2経路では行データの読み取りはできない。
- **GASエディタから手動実行する読み取り専用関数** `testTrialSheetInventoryReadOnly` を追加。既存の試作家庭名、usersの件数、既存データの存在を前提条件にしない。
- 対象スプレッドシートは、ユーザー提供IDのSHA-256フィンガープリントが一致するときだけ `SpreadsheetApp.openById` で開く。シートIDそのものは公開ソースや実行ログへ出さない。
- 12タブの有無、想定外タブ、見出し一致、不足件数、householdsの行数、家庭名が隔離試験ラベルに一致するか、usersの行数、家庭参照とauth_subjectの形式、categories 5件の一致を**値をログに出さず**診断する。1タブあたり1000行まで検査し、超過時も値を公開しない。
- `testTrialSheetInventoryReadOnly` は**書き込みしない**。`testAliasTrialPreflightReadOnly` のような隔離された家庭名と空の既存シートを前提にしないので、先にこちらを使用すること。
- GitHubでオフライン回帰テスト `tests/gas-trial-sheet-inventory.mjs` が成功し、試験用GASへのソース反映・関数検査が成功：<https://github.com/Tokky0117/household-pwa/actions/runs/41168937997>。自動更新トリガーは終了後に無効化した。
- **次のユーザー操作**：既存試験用Apps Scriptエディタの画面をリロードし、上部の関数選択で `testTrialSheetInventoryReadOnly` を選び実行。実行ログの `INVENTORY_START` ～ `INVENTORY_DONE` を共有する。個人IDや実商品データは共有不要。
- この検査結果を確認するまで、家庭名のリネームや `auth_subject` の追加、データ削除、表の初期化、別名登録の書き込み試験は実施しない。

## 2026-10-31：既存の試作用シート専用の別名登録事前検査を修正

- 2026-10-31のユーザー提供GASログにより、12タブ/列見出し正常、householdsとusersがそれぞれ1行で関連付け一致、auth_subjectが数字、categoriesが設計どおり5行、他9タブが0行、書き込みゲート無効、試験用シートID設定一致が確認できた。家庭名だけが従来の `[KURASHI_WRITE_TRIAL_ONLY]` ではなかった。
- `gas/Code.gs` に `approvedPrototypeAliasSheet_` と `assertAliasEditorTrialIdentity_` を追加。指定済みの既存試用Spreadsheet IDのSHA-256と2つの設定値の一致、公開書き込みフラグOFF、households/usersが1件でIDが存在し関連付け一致、auth_subjectが数字であることを厳密に検査。**家庭表示名は変更・要求しない**。
- 例外は、GASエディタから呼び出される `testAliasTrialPreflightReadOnly` と、将来明示許可があった場合のエディタ専用 `runIsolatedAliasWriteTrialOnce_` 内の試験に限定。`doPost` と `mutateItemSafely_` は従来の `[KURASHI_WRITE_TRIAL_ONLY]` 固定ラベル条件を維持。既存の他用途GAS試験シートに通常書き込みを許可するものではない。
- シートの列検査・categories 5件・既存レシートなどの異物混入禁止・過去履歴の復旧整合・同時実行対策は保持。固定の架空商品/店舗/コードだけを扱う既存エディタ試験処理も保持。
- `testAliasTrialPreflightReadOnly` で検査失敗時は `ALIAS_TRIAL_PREFLIGHT_FAILED: エラーコード` をログに記録し、従来の `[object Object]` より原因を把握しやすくした。出力にシートのID・家庭名・ユーザー認証ID・実データは出さない。
- 模擬試験では、既存家庭名のままの指定シートに対する読み取り専用事前検査、正常な架空商品コード登録・再実行、違うシートID/家庭参照/認証ID欠落/レシート混入/公開書き込み許可ONの拒否、通常POSTの拒否、在庫操作の安全ゲート維持を検証した。オフライン回帰テスト成功。
- 反映の初回試行は**古い比較用コードハッシュ**との不一致により安全停止した。読み取り専用の監査で、試験用GASの現行コードは前回GitHubで検証済みの版と完全一致することを確認し、コードハッシュを修正して再実行した。
- 試験用GASソースのみ更新成功：<https://github.com/Tokky0117/household-pwa/actions/runs/41170175281>。更新後の読み取り専用照合でもGitHubの開発版と**完全一致**、マニフェストの指紋は変更前から不変：<https://github.com/Tokky0117/household-pwa/actions/runs/41170244289>。一時的な更新トリガーは再度無効化した。
- **今回の実Google Sheets書き込みは0件**。更新はGASのソースコードだけで、GASデプロイやScript Propertiesも変更していない。

### ユーザーに依頼する次の操作

試験用Apps Scriptエディタを再読み込みし、上部の関数選択から `testAliasTrialPreflightReadOnly`（末尾アンダースコアなし）を選択して「実行」。成功ログ `ALIAS_TRIAL_PREFLIGHT_OK` を確認する。実行してもシートデータは変更しない。失敗時は `ALIAS_TRIAL_PREFLIGHT_FAILED: <code>` のエラーコードだけ共有すればよく、セルの値を公開する必要はない。

**注意**：`runIsolatedAliasWriteTrialOnce_` はシートに架空の行を実際に追加するため、現段階では実行しない。さらにエディタでの関数選択に末尾 `_` の関数は表示されない場合があるため、将来書き込みテストを行う際は別途安全な明示許可・入口が必要。

## 2026-10-31：ユーザー許可後の書き込み試験関数を反映

- ユーザーから**既存試験用スプレッドシートに限り架空データ5シートを書き込む許可**を受領。既存の家庭/ユーザー/カテゴリの変更は許可対象外。
- `gas/Code.gs` に**エディタから選べる公開関数 `runAliasTrialWriteOnce`** を追加した。呼び出しは内部の `runIsolatedAliasWriteTrialOnce_` のみで、12シート/認証家庭・ユーザー/対象Spreadsheet SHA-256/公開書き込み禁止/異物混入/固定ID/リカバリジャーナル/競合/再送防止を再検査する。`doGet`・`doPost`・通常アプリからは公開しない。
- `product_aliases.normalized_alias` の書き込み時は対象セルを**プレーンテキスト書式 `@`** に設定してから `setValues` し、商品コード `00012345` の先頭ゼロを保持。書き戻し後も文字列一致を読み取って検査する。書式が不正・数字へ変換された場合は成功を返さない。
- エディタ試験成功時のログは `ALIAS_TRIAL_RESULT_OK`, `ALIAS_TRIAL_ONCE_OK`, `ALIAS_TRIAL_EDITOR_WRITE_OK`。途中エラーは `ALIAS_TRIAL_EDITOR_WRITE_FAILED: <code>` と表示し、IDや商品データをログに出さない。
- オフライン回帰テストで、初回1件・同一操作ID再送が書き込みゼロ・`@` 書式設定・家庭ID不一致・数字へ変換された商品コードの拒否を含む全テストが成功。
- **試験用GASのソース反映だけ成功**：<https://github.com/Tokky0117/household-pwa/actions/runs/41170859225>。反映後の読み取り専用照合でも**GitHub開発版と一致、元のマニフェストは不変**：<https://github.com/Tokky0117/household-pwa/actions/runs/41170946564>。一時的な自動反映トリガーは削除した。今回のGitHub ActionsによるGoogle Sheets書き込みは0件。

### 実Google Sheetsへの書き込みを行うための唯一のユーザー操作

1. [試験用Apps Scriptエディタ](https://script.google.com/home/projects/15pyx5qYzEMEqgGQmbSyRdx5U2DywTxnRYgWpQb9lazE__tGwQ58DJGIU/edit)をリロード。
2. 関数選択メニューから **`runAliasTrialWriteOnce`（末尾 `_` なし）** を選ぶ。
3. **実行**を押す。試験用店舗/商品/別名/変更履歴/操作履歴だけを追加し、コード先頭ゼロと同じIDによる再実行を内部で確認する。
4. 実行ログの `ALIAS_TRIAL_EDITOR_WRITE_OK` と `ALIAS_TRIAL_RESULT_OK` を確認。出なければ**シートの内容やScript Propertiesを自分で修正せず**、ログの失敗コードだけを共有すること。操作IDは変更しない。

**現段階の限界**：GASエディタ実行はまだ行われていないため、実Google Sheets上での書き込み成功は未確認。試験データを追加したことをユーザーが報告するまでは、「実データ登録完了」とは扱わない。

## 2026-10-31：実Google Sheetsでの商品コード登録試験に成功（ユーザー提供GAS実行ログ）

- ユーザーが試験用Apps Scriptエディタから `runAliasTrialWriteOnce` を実行し、ログのスクリーンショットを提供。
- `SCHEMA_READ_OK: 12 sheets`、`READ_OK: categories = 5` を確認。
- `ALIAS_TRIAL_RESULT_OK: store=1, product=1, aliases=1, change_log=1, journal=1, replay=verified, code_as_text=verified` を確認。
- `ALIAS_TRIAL_ONCE_OK: 1 stored alias, 1 completed operation, 1 change log, no duplicate replay` を確認。
- `ALIAS_TRIAL_EDITOR_WRITE_OK: fixture verified; identical replay produced no duplicates`、`実行完了` を確認。
- したがって、**ユーザー提供の実GAS実行ログが示す範囲で**試験用Google Sheetsに店舗・商品・別名の各1行と変更履歴・操作履歴各1行が正常登録され、同一操作ID再送で重複せず、コード `00012345` の先頭ゼロ保持も検証された。
- **実行ログに基づく検証であり、ChatGPTがシートのセルを直接読み取った結果ではない。** 同時実行・ネットワーク遮断・実ユーザーでの認証API経由の書き込みは依然未検証。
- 既存のhouseholds/users/categoriesは変更対象外。今回追加された架空テスト行は、引き続き試験用データとして保持する。安易に手動削除・操作ID変更はしない。

### 次工程

1. `product.catalog` と `product.alias.check` の認証済み読み取りを、試験用GASで確認する。既に登録した架空店舗・商品・別名を利用し、シートデータを追加しない。
2. OCR確認画面への取得・候補マッチング接続を、認証と家庭分離が確認できた範囲に限って試験する。
3. フロントエンドからの `product.alias.create` は現在も `UNSUPPORTED` のまま。本番運用・他家庭・未確認商品についての書き込み解禁は行わない。

## 2026-10-31：実Sheets登録済みコードの読み取り専用照合（次ステップ）

- 前段の実Apps Scriptログに基づく試験用コードの登録は成功済み。ここでは**シートへの追加/変更/削除をせず**、既存登録を `productCatalog_` と `productAliasCheck_` で読み出すエディタ用関数 `testAliasCatalogReadOnly` を追加した。
- 指定試験シートの識別、家庭とユーザーの対応、他シートへの混入なし、1件ずつの店舗/商品/コードの整合、変更履歴・操作履歴が完了していることを検証し、合格後に `product.catalog` と同じ内部実装で家庭限定マスタ取得を検証する。
- 商品コード `00012345` を登録済み `already_registered` と判定し、別商品への競合や異チェーンでの混同が起きていないことを確認する。未登録コード `00099999` は `available`（＝未登録、ただし書き込み許可ではない）として確認。どちらも `write_permitted:false` を要求する。
- 実データの家庭ID・ユーザーID・商品ID・アクセストークン・シート内容はGASログへ出さない。成功ログは `ALIAS_CATALOG_READ_OK`、`ALIAS_CODE_MATCH_OK`、`ALIAS_UNKNOWN_CODE_OK`、`ALIAS_CATALOG_TEST_DONE`。失敗時は `ALIAS_CATALOG_TEST_FAILED: <code>`。
- OCRエンジンによる新しいレシート画像処理とは分け、既存 `receipt-structure.js` と `receipt-product-matching.js`、`receipt-alias-preflight.js` の**合成レシート**検証も追加した。同じ架空8桁コードのパース→登録済み1商品のコード候補→人手確認必須→他チェーン除外→書き込み禁止を固定テストで確認。
- GASの試験用ソース反映成功：<https://github.com/Tokky0117/household-pwa/actions/runs/41172385314>。GitHub開発版と試験用GASソースの再照合も成功し、マニフェスト・権限・Webアプリ設定は不変：<https://github.com/Tokky0117/household-pwa/actions/runs/41172459132>。一時的なGitHub Actions自動反映トリガーは再び無効化。
- オフライン回帰テスト成功。ただし、**この新しい読み取り検証の実Google Sheetsエディタ実行はまだ未完了**。認証されたWeb APIから `product.catalog` を実際に取得したわけでもなく、OCRプレビューから直接GASへ接続する状態でもない。

### 次のユーザー操作（読み取り専用）

1. [試験用GASエディタ](https://script.google.com/home/projects/15pyx5qYzEMEqgGQmbSyRdx5U2DywTxnRYgWpQb9lazE__tGwQ58DJGIU/edit) を再読み込みする。
2. 関数選択から **`testAliasCatalogReadOnly`** を選んで「実行」。既存の登録行を読むだけで、新しいデータは書かない。
3. `ALIAS_CATALOG_READ_OK`、`ALIAS_CODE_MATCH_OK`、`ALIAS_UNKNOWN_CODE_OK`、`ALIAS_CATALOG_TEST_DONE` が順に表示されたら合格。失敗した場合はコードだけを共有する。家庭名や実データを貼る必要はない。

### 以後

実シートの読み取り照合が合格したら、認証済み `product.catalog` とOCR明細候補表示の統合を進める。OCR実行中は写真を送信しない、登録候補は確認必須、通常ブラウザからの書き込みは引き続き禁止。

## 2026-10-31：ユーザーの実機画面でカタログ読み取り検証が成功

- ユーザーから、既存試験用GASの `testAliasCatalogReadOnly` 実行ログを撮影したスクリーンショット2枚を受領し、下記を確認した。
  - `READ_OK: categories = 5`、`SCHEMA_READ_OK: 12 sheets`
  - `ALIAS_CATALOG_READ_OK: 1 product, 1 store, 1 alias, household-scoped`
  - `ALIAS_CODE_MATCH_OK: leading zeros retained, exactly one product, already_registered`
  - `ALIAS_UNKNOWN_CODE_OK: unknown code unresolved, no writes`
  - `ALIAS_CATALOG_TEST_DONE: read-only, actual sheet fixture verified`、`実行完了`
- **実際の試験用GASから既存Google Sheetsの商品・チェーン・別名を読み取り、登録済みコードと未登録コードの判定が整合したことを確認。** 新しいシート行の追加、デプロイ、GASコード変更は行っていない。これはユーザー提供ログの確認であり、ChatGPTがSheetの行を直接読んだものではない。
- 続いて開発ブランチのOCR確認画面に、認証済みカタログを**明示的に**受け取るための画面境界とログアウト時破棄を実装。合成データによる回帰テストが成功した。
- **次の未検証項目**：ブラウザから認証付き `product.catalog` / `product.alias.check` を実GAS Webアプリへ送る通信と、CORS・Googleログイン・家庭分離の実機検査。現在の公開OCRラボにこの通信は接続していない。
- **維持する安全条件**：ブラウザの `product.alias.create` は `UNSUPPORTED`、`ENABLE_EXPERIMENTAL_WRITES` は無効、試験用データは保持、画像のアップロード・レシート本登録・本番環境の作成・既存デプロイ更新は実施しない。

## 2026-10-31：ブラウザからの認証付き商品照合の診断UIを準備（未実機）

- 既存 `gas-trial-connection.html` へ、Googleログインと認証済み `bootstrap` 成功後だけ選べる **④ 登録済み・未登録コードを照合（読み取りのみ）** を追加。`product.catalog` で対象家庭の既知架空商品・店舗・別名各1件を確認した後、`product.alias.check` で登録済み `00012345` → `already_registered` と未登録 `00099999` → `available`、いずれも `write_permitted:false` を検証する。追加行・本番データ・コード変更・再デプロイなし。
- 家庭IDや商品ID、トークン、商品マスタ行は診断画面へ出さない。ブートストラップ失敗、接続先変更、ログアウト／アカウント変更、通信遅延時には照合ボタンを無効化し、旧応答を破棄。意図しない `product.alias.create` 等の送信を一切行わない。
- `tests/gas-trial-connection-page.mjs` を拡充。既知/未知の架空コード、誤家庭の商品マスタ、照合応答矛盾、公開API未更新、古い通信応答・ログアウト、トークンを使わないGET、書き込みゼロの合成テストが成功。GitHub Actions: https://github.com/Tokky0117/household-pwa/actions/runs/41174828501
- **実機判定待ち**：ユーザーが既存の試験 `/exec` URLを開発ブランチの診断画面へ入力し、Googleログインして、③の認証付き読み取り→④の商品照合を順に実行する。所有者限定デプロイを勝手に一般公開しない。古いデプロイによる `UNSUPPORTED` とCORSエラーを区別し、成功するまで商品マスタの本体接続を進めない。スクリプトIDはデプロイURLではなく、`/exec` URLは別途確認する。

## 2026-10-31：既存デプロイURLの誤判定を修正

- ユーザーがiPhoneから診断ページに貼り付けたURLは、当該**試験用GASプロジェクトの「デプロイを管理」**で確認したWebアプリURLであると明言。試験用スクリプトIDと部署用デプロイIDは別物のため、GitHubの過去の `MAIN_GAS` 固定文字列だけで「家庭用GAS」と断定した前バリデーションは誤判定だった。**本番環境は未作成**。
- `gas-trial-connection.html` から `candidate.href===MAIN_GAS` の一律拒否を削除。代わりに「そのURLが既存の試験用GASのデプロイを管理で確認したものである」という明示チェックを必須にし、URLを変更したらチェックを解除し、前の試験結果は無効化する。HTTPS `script.google.com/macros/s/<deployment>/exec` の厳密な形式検証は共通 `gas-api.js` で維持。
- 既存のURLでの確認にPC操作、新規GAS、別デプロイ、公開範囲の緩和は不要。読み取り専用GETと認証済み `bootstrap` → `product.catalog` → `product.alias.check` のみ、通常の書き込みゲートは無効。
- テストは旧 `MAIN_GAS` と一致するURLでもチェックした場合だけ読み取り可能になること、URL変更でチェックが外れること、未確認ではGET/POSTボタンが無効となることを確認。GitHub Actionsのオフライン回帰試験 https://github.com/Tokky0117/household-pwa/actions/runs/41178003387 は成功。
- **実機では次に**診断ページを再読込し、①既存の試験用デプロイURLを入力、チェック欄を選択、②ログイン、③GETと認証付き読み取り、③が成功した場合だけ④照合。通信結果は未確定であり、CORS/アクセス制限や公開済み旧GASの可能性も残る。

## 2026-10-31：iPhone実機で認証付きWeb API POSTの読み取り成功（次は④）

- ユーザーが、**既存試験用GASの「デプロイを管理」で確認した `/exec` URL** を開発ブランチの `gas-trial-connection.html` に設定し、Googleログイン後の③ `bootstrap` を実行。本人提供のiPhone画面で「**POST：GAS認証付き読み取り成功（カテゴリ5件）。計測4.99秒**」「**日用品0件／商品1件／店舗1件**」を確認した。
- **iPhoneの当該ブラウザ・セッション・デプロイURLに限って、GitHub Pagesから試験GASへ認証付きHTTP POSTを送信し、応答JSONを読み出す経路が実際に成立した。** これまでのCORS障害と混同しない。GET診断は未実行で、追加実行はこの目的には必須ではない。4.99秒はこの1回のクライアント計測で、継続的な通信性能や書き込みの応答時間を保証しない。
- `bootstrap` のカテゴリ5件と商品・店舗各1件は、前回の `testAliasCatalogReadOnly` 実シート実行ログと整合している。今回のPOST成功はAPI・認証経路の実機証拠だが、③だけでは `product.catalog` の別名データや `product.alias.check` の照合まで成功したわけではない。
- 続く④を実行する前に、診断画面の既知フィクスチャの**名前・店舗名・別名コード・照合応答形**が、開発ブランチ `gas/Code.gs` の `testAliasCatalogReadOnly`、`productCatalog_`、`productAliasCheck_` と一致することをコード照合で確認した。④はボタンから既存商品コード `00012345` と未登録コード `00099999` を順に認証付き・読み取り専用照合する。
- **次のユーザー操作は④「登録済み・未登録コードを照合（読み取りのみ）」を押し、結果画面の成功／エラー文を共有すること。** この段階で再ログイン、デプロイ更新、GET診断、商品・レシートの書き込みは不要。
- `ENABLE_EXPERIMENTAL_WRITES=false`、`LIVE_WRITE_ENABLED=false`、通常アプリへの認証付きOCRマスタ接続は未公開のまま。試験GAS、試験Sheets、Webアプリデプロイ設定、main、本番環境の変更は行っていない。

## 2026-10-31：iPhone ④商品コード照合は `UNSUPPORTED`（GASのデプロイ旧版と判定）

- ユーザーが、③ `bootstrap` 実機成功（カテゴリ5・日用品0・商品1・店舗1、4.99秒）に続いて④を実行し、**「POST：現在の公開済みGASに読み取りAPIが含まれていない可能性があります。デプロイ版を確認してください。」** および **「コード照合は完了していません。書き込みは行っていません。」** を撮影したスクリーンショットを提供した。
- ④の診断UIは `product.catalog` → `product.alias.check` 2回を呼ぶ。まず最初の `product.catalog` で旧版が `UNSUPPORTED` と返した可能性が高いが、フロント画面だけからサーバー版番号を直接確定したわけではない。
- 開発ブランチ `gas/Code.gs` の `doPost` は `product.catalog` と `product.alias.check` の両アクションに対応。実GASソースの読み取り専用監査 <https://github.com/Tokky0117/household-pwa/actions/runs/41172459132> は「remote and branch source identical: true」「両関数あり」を確認。**ソース自体を再度pushしない。**
- 原因の最有力は、GASの**現在のエディタ/HEADソース**と **既存 `/exec` のバージョン付きデプロイ**に差があること。Google公式手順に従い、ユーザーが既存の試験用GASを開き「デプロイ → デプロイを管理 → 現行ウェブアプリ → 編集 → バージョン：新しいバージョン → デプロイ」を行うと、**既存のデプロイIDと `/exec` URLを維持**して更新できる。参照：<https://developers.google.com/apps-script/concepts/deployments>、<https://developers.google.com/apps-script/guides/versions>。
- 変更前に**試験用スクリプトIDと既存の管理画面で選んだウェブアプリ**を確認。実行ユーザー・アクセスできるユーザー・スクリプトプロパティは絶対に拡張・変更しない。特に `ENABLE_EXPERIMENTAL_WRITES=false` を維持。本番環境を作らず、シートへ書き込まず、新規デプロイも作らない。
- 更新後は開発ブランチの診断画面を再読込、既存の同じ `/exec` URLと試験用である旨を再確認し、必要ならログイン→③ `bootstrap` →④照合。成功文言だけ共有し、機密ID・トークン・Googleアカウント詳細を公開しない。④が引き続き失敗する場合は**再デプロイを繰り返さず**、表示されたエラー文を基に検証する。

## 2026-10-31：iPhone ④商品マスタ・商品コード照合の実機成功

- ユーザーが既存試験用GASのウェブアプリ公開版を更新後、既存のGitHub Pages `gas-trial-connection.html` で③に続き④を再実行。ユーザーが提供したiPhone Safari画面に **「POST：商品マスタ・登録済みコード・未登録コードの照合に成功しました。」** および **「家庭を限定した読み取り3回。既存の架空データと一致・書き込み0件。計測8.39秒」** が表示された。
- したがって、この試験用端末・Googleログイン・デプロイの条件では `product.catalog` と `product.alias.check`（登録済み `00012345`／未登録 `00099999`）の認証済みブラウザPOST・応答検証が成功。リクエストは計3回、**書き込み0件**。前段の `bootstrap` 成功は4.99秒（別の1回の計測）。8.39秒は3回の一連の計測であり、1件当たりの処理時間や将来の保証ではない。
- これで試験用 **GitHub Pages → Google Identity → GAS Webアプリ → 対象家庭のGoogle Sheets → ブラウザ** の読み取りが、商品候補統合に必要なAPIレベルまで実機確認済み。別家庭・別端末・一般公開・更新API・端末間同期・本番保存には拡張していない。
- GitHub開発ブランチの認証付き商品マスタ・OCR候補確認ブリッジは合成テスト済み。次工程は、試験用の独立した明細確認UIと認証付きカタログ読取を**明示ボタン操作のときだけ**結ぶこと。写真とOCR全文のサーバー送信、プレビューの自動保存、一般向け公開の書き込みは行わない。

## 2026-10-31：⑤OCR明細テキスト→認証済み商品候補（開発プレビュー）

- ④のiPhone実機照合成功を受け、既存 `gas-trial-connection.html` に **⑤「OCR明細と登録商品を照合（読み取りのみ）」** を追加。写真OCRラボの公開画面は従来どおり**ログインも外部への写真送信も行わない**。
- ⑤には、iPhoneでOCRした文字列を貼り付ける欄と、「架空の試験明細をセット」「明細候補を抽出（通信なし）」「認証済み商品マスタを読み取って候補を表示」「破棄」を追加。架空の試験明細は `試験用・商品コード\n00012345 1 198 198 E\n合計 ¥198`。商品名・先頭ゼロ付きSKUは実証済みの試験シートと一致し、**コードからの商品候補表示にも、ユーザーによる商品・店舗選択にも明示確認を要求**する。
- `receipt-catalog-integration.js` は既存 `receipt-structure.js`・`receipt-product-matching.js`・`receipt-alias-preflight.js`・`ocr-lab/confirmation-preview.js` を再利用。**③bootstrapと④別名照合の両方が現在のGoogleセッション・試験用URLで成功した場合のみ**明示 `product.catalog` を認める。明細とOCR原文・画像・候補選択をAPIへ送らず、商品マスタ読取1回後はメモリ中の候補で表示を更新する。正式保存なし。
- ログアウト、URL変更、セッション切替、別タブからの復帰時のトークン失効では認証済みマスタを破棄し、後着の旧通信応答が候補を復元することを拒否。入力・家庭データはlocalStorage/URLに保存しない。元の試験用URLとGASデプロイを変更せず、`ENABLE_EXPERIMENTAL_WRITES=false` 維持。
- 配信は開発ブランチ限定：`.github/workflows/pages-previews.yml` の生成済み `ocr-lab/` に、認証付き確認画面が読む少数のESモジュールをビルド後コピー。高容量Paddle OCRモデルの新規配信や、本番/mainの変更はない。再利用した写真OCR画面の通信禁止は従来どおり。
- オフラインテスト `tests/receipt-catalog-integration.mjs` に、合成明細の解析、外部通信0回のOCR前処理、明示商品マスタ取得、商品候補描画、同家庭の確認、ログアウト/期限切れ/URL切替、遅延応答の破棄、異家庭データ拒否、明細破棄、書き込み操作0回を固定。**iPhoneの⑤操作と実際の候補表示はまだ未確認**。ここで合格しても写真OCRの認識精度向上を意味しない。

## 2026-10-31：⑤iPhone実機のOCR明細→登録商品候補表示に成功

- ユーザーからiPhone Safariの⑤の結果画面を受領。**「認証済みの商品マスタ 1商品・1別名を読み込みました。正式保存はしません。」**、**「明細 1件・要確認 0件・商品候補 1件・商品選択 0件・数量確認 0件。保存は行いません。」** が表示された。
- 試験用架空明細 **「試験用・商品コード」**、**数量1・金額198円・値引き0円・差引198円**、**商品コード `00012345`** が保持され、登録商品候補の選択欄と **「商品名が一致」** が出ている。**認証済み商品マスタの読取と、OCR明細候補のローカル商品名照合・表示がiPhoneで成功**した。
- **未完了の確認**：画面ではチェーンが「未選択（共通の別名のみ）」、商品候補が「未確定」のため、選択されたチェーンと登録済み商品コードの **`already_registered` 予備判定を画面に表示する検証はまだ未実施**。ユーザーは試験チェーンを選択し、登録商品候補の「試験用・商品コード」を手動選択すると、コード予備判定が表示される想定。
- ⑤は `product.catalog` による認証済み読取1回のみで、OCR文字列／写真／商品選択を送信しない。iPhoneでのマスタ読取・候補表示成功は確認したが、**⑤の実機読み取り時間の計測はスクリーンショットに含まれない**。書き込みは0件。
- ③・④の実機成功、⑤候補の表示により、既存GAS+Google Sheetsの読み取りをレシートの候補照合に利用できる技術的成立性を確認。写真OCRの文字認識精度、複数商品の正確さ、実レシートの確認、正式保存は別工程。

## 2026-10-31：⑤チェーン・登録商品選択後の既存商品コード判定も実機合格（架空データ結合試験完了）

- ユーザーが⑤の試験画面で、チェーン `[KURASHI_ALIAS_TRIAL_ONLY]` と登録商品 `試験用・商品コード` を手動選択し、期待どおり **「この商品コードは、この商品にすでに登録されています。」** の表示が出たと報告。
- これにより、iPhoneでの架空明細テキスト抽出→認証付き `product.catalog` 読取→商品候補の表示→試験チェーン・商品選択→先頭ゼロ付きコード `00012345` の `already_registered` 予備判定まで、一連の**読み取り専用結合試験が完了**した。
- 先行試験の③ `bootstrap`、④ `product.catalog`＋`product.alias.check` はスクリーンショット確認済み。⑤の最終 `already_registered` 表示については**ユーザーの実機報告**に基づく。ローカル候補確認の選択操作は追加POST・Sheet書き込みなしの設計。正式な商品・レシート保存は未実施。
- 次工程では**実レシートのOCR文字列・複数商品による候補照合の精度検証**へ移る。現時点の成功は「架空の既知1商品」に限定され、一般のレシート認識精度や本番同期の成立性を証明するものではない。
- 維持：既存の試験用GAS／12シート、`ENABLE_EXPERIMENTAL_WRITES=false`、本番未作成、通常アプリの書き込み禁止。新たなデプロイ・データ変更は不要。

## 2026-10-31：複数明細の判定可視化と実OCR→認証商品照合への手動導線

- iPhoneの⑤が「試験用・商品コード」1件を読み込み、「チェーンと商品を選択後、既に登録済み」の表示まで成功したことは前節で実機確認済み。その後、次段階の**未照合・数量不確実・複数明細の扱い**を開発ブランチで改善した。
- `ocr-lab/confirmation-preview.js` の候補サマリーで、「OCR要確認」「候補がある明細」「未照合」「コードと商品名の競合」「候補複数」「類似名候補」「抽出警告」「合計不一致／合計未検証」を分けて表示。「OCR要確認0件」は未照合商品がないという意味ではない。コードのみで自動登録・自動確定せず、チェーンと商品は手動選択を維持。
- 既存の `gas-trial-connection.html` の⑤に **「複数明細の架空サンプル（3商品）」** を追加。合成の登録済み1商品 `00012345`、商品マスタにない2商品、数量印字が曖昧な1明細を端末内で抽出し、検証件数を表示。実マスタは既存の1商品だけを使用し、架空の未登録商品2件をGoogle Sheetsに新規作成しない。OCRテキストもマスタ要求へ含めない。
- 独立した写真OCRラボ `ocr-lab/` に「文字起こしだけコピー（商品照合用）」と⑤へのリンクを追加。利用者が写真をOCR→テキストだけコピー→⑤に貼る手動経路。既存の詳細診断コピーと分離し、写真・OCR原文・認証トークンは自動で別画面やGASへ送信しない。ラボ自体は引き続きログイン・GAS接続なし。
- テストは `tests/receipt-catalog-integration.mjs` に複数商品の候補1・未照合2・数量警告1、POST追加0を追加し、`tests/receipt-ocr-lab.mjs` および `ocr-lab/test-browser.mjs` にコピーした内容がOCRテキストのみであることを追加。実レシートのOCR認識精度・複数商品の実登録マスタ照合・料金/性能・iPhoneの手動コピー操作は別の実機検証が必要。
- 安全境界は不変：既存試験GASと12シートのデータを変更せず、`ENABLE_EXPERIMENTAL_WRITES=false`、`LIVE_WRITE_ENABLED=false`、main・本番環境・正式保存は未変更。

## 2026-10-31：既知R06実レシートのiPhone OCR再現成功・商品欄外警告とコピー経路の改善

- ユーザーから、関西スーパーの既知レシートR06について **iPhone Safari上の `PP-OCRv6_small`（WASM）読み取り結果**と抽出画面を受領。既存の正解ファイル `tests/fixtures/receipt-reviewed-60.json` のR06商品欄と照合し、**3商品すべての商品名・数量・値引前・値引・値引後が一致**。商品数3、数量計7、商品差引623円＋8%税額49円＝支払672円と原本一致。
- 実機計測：`firstRun:false`、全体 **8.607秒**（準備269ms、OCR読取7.650秒、検出2.080秒、認識5.555秒）、検出91箇所・認識91箇所・52行。日本語字体補正3箇所。OCR段階の抽出明細3件、個別明細要確認0件。**この既知サンプルでの再現に限る**。未知の写真による精度一般化やウォームアップ初回速度は未確認。
- OCR全文には写真左端の別伝票の一部と購入後のカード売上票が混在し、候補画面で **「抽出警告6件」** と表示された。警告内訳の実機ログ自体は未受領のため、警告6件のそれぞれの厳密な原因は断定しない。商品の金額が一致しても、商品欄外の認識文字や未抽出明細に関する警告を無視しない。
- 開発ブランチの `receipt-structure.js` に `warningScopes`（明細欄内・欄外・全体の位置別集計）と、商品に紐づく原文の行＋数値集計のみを抽出する `merchandiseExcerpt` を追加。後者は不審な支払関連文字列・カード番号形式が明細として現れた場合は**コピーを中止**。原文全文や診断情報の従来ボタンには個人情報注意の文言を追加し、`ocr-lab/main.js` の商品照合用ボタンでは**安全側に失敗して全文をコピーしない**。
- `ocr-lab/confirmation-preview.js` の候補サマリーに、抽出警告の位置、購入点数と合計金額の一致・不一致を別々に追加。OCR要確認0件と抽出警告6件が同じ意味ではないことを見分けやすくした。処理は端末内で行い、Google Sheets・GASのデータは変更しない。
- 合成の3商品と架空のカード情報による `tests/receipt-structure.mjs` で明細3件・点数7点・合計672円の維持、警告の欄外区別、個人情報の除外、商品明細コピーから再解析する往復を検証。別の `tests/receipt-catalog-integration.mjs` で新表示と追加POST0を検証。生のOCR全文・写真・実カード番号・実トークン・決済識別情報は**GitHubに保存しない**。
- 次の確認は新たな実レシートまたは別の店舗レイアウトで、写真OCRの抽出精度と、試験商品マスタ（架空1商品）の候補照合率を分けて計測。正式保存、GAS書き込み、本番運用、シート追加は未実施。`ENABLE_EXPERIMENTAL_WRITES=false` を維持。

## 2026-10-31：新規コーナン形式レシートで抽出過多を検出・3行JANレイアウトに対応

- ユーザーが前回のR06とは別のコーナン系レシート写真、iPhoneの抽出画面とPP-OCRv6_smallの読み取り診断を提出。原本の購入明細は**3商品、各1点、437円・800円・748円、税込1,985円（内税10% 180円）**。商品名はOCRで一部切れ／誤読の可能性があるため原本との人手照合が必要。
- 既存のOCR文字認識自体は、JAN行3つ・商品名行3つ・税区分付きの価格行 `437内` / `800内` / `748内` を検出している。しかし以前のパーサーは **5商品を誤抽出**（小計・合計OCR崩れ・決済 `楽天ペイ` 等）、抽出警告21件、明細OCR要確認0件と表示。この `0` は抽出精度を保証しない。初回読み取り約12.97秒、検出55・認識55、41行という**当該実機1回のみの計測**。
- 修正した `receipt-structure.js` は `#nnn JAN<13桁>` → 商品名 → `価格 内/込` の3行レイアウトを3行1商品として認識する。JANコードは文字列で保持し、数量は1（商品名の「3個」はパッケージ内容量扱いで購入数にしない）。孤立／不完全なJANグループは警告にして、価格や商品を勝手に補完しない。
- `小計金額` を集計境界にし、OCR崩れ `合 33 ¥1,985` を小計の後でのみ合計として扱い、`(10%対象消費税 ¥180)` を内税額として読む。決済・ポイント・支払欄の値段が商品候補にならないように修正。明細からの安全なコピーでは内税・外税の区別を維持し、個人情報に相当する決済識別行を絶対に商品欄としてコピーしない。
- **元画像・OCR全文・取引番号・店頭連絡先・ユーザーの決済IDはGitHubに追加していない**。新規 `tests/receipt-homecenter.mjs` は架空JANと購入明細形式だけから作成し、3商品・合計一致・内税・不完全JAN・決済欄除外・プライバシー保護・商品明細のみのコピーから再抽出を検査。⑤の認証済み候補画面で3明細・未照合3明細・合計一致・追加POST0も追加テスト済み。既存のレシート60商品と他のオフライン試験も継続合格。
- **次の実機判定待ち**：新しいOCRラボ公開後、同じ写真を再読込して商品明細が3件（437/800/748）、合計1,985円、内税180円になり、集計・決済行が商品候補にならないか確認する。実機画面で確認するまで「解決済みの実機OCR」とは扱わない。
- 試験GAS・シートの書き込み、OCR画像の外部送信、本番環境作成は行わず、`ENABLE_EXPERIMENTAL_WRITES=false` の方針を維持。

## 2026-10-31：コーナン3行JANレシートの修正後iPhone再テスト成功

- ユーザーがコーナン形式レシートの**同一写真**をiPhone Safariから再読み取り。修正済み開発プレビューで**明細3件・OCR明細要確認0件・商品マスタ候補0件・数量確認0件・抽出警告8件（明細欄内0・欄外8・全体0）・合計金額一致**を確認。前回の**誤抽出5件・警告21件**から改善。
- 実機の3商品（OCR認識表記のまま）：**437円、800円、748円**、すべて数量1・値引き0・合計1,985円。JANコード3行と商品行・税込価格の対応が成立。商品名にはOCRの途中で切れた文字があり、正式な商品マスタ名として自動登録・確定しない。
- 今回の認識エンジンは `PP-OCRv6_small`・WASM・`firstRun:true`。所要時間**21.622秒**、準備234ms、セットアップ＋読取20.326秒（うちセットアップ推定14.189秒）、検出2.248秒、文字認識3.868秒、推論6.137秒、検出・認識55領域、41行。前回の初回12.966秒より長いが、**セットアップ変動が支配的**であり、商品抽出精度の劣化や端末固有の恒常的速度を示さない。
- 購入数は購入明細の1+1+1で3。原本の「3個」は包装表記のため購入数量に転用していない。JAN3件は提示されたOCRコードの形式・末尾検査数字とも一致（チェックサムはコード上の追加検証課題）。
- 今回送られたOCR全文には決済・識別情報が含まれるため、**GitHubには画像・全文・生の取引番号・決済識別情報を保存せず**、件数、金額、時間、修正結果のみに限定した。検証用に残すJANは合成番号とする。
- **達成**：3行JAN形式での商品の抽出過多の解消を実機で確認。**残課題**：別店舗・別写真への汎化、商品名誤読の人手確認、抽出警告の内訳、実商品マスタへの照合。読み取り専用、`ENABLE_EXPERIMENTAL_WRITES=false`、本番未作成を維持。

## 2026-10-31：JAN検査数字によるOCR誤照合防止（開発ブランチ）

- コーナンの再テストで得られたJAN3件の**13桁形式と検査数字が有効**であることを確認した。ユーザーの実JANコード自体は公開レポートに再記載しない。
- `receipt-structure.js` はJAN/EAN-13のチェックサムを検証し、不一致の場合も商品の購入明細を失わず、`invalid_jan_checksum` を商品の要確認・明細欄内警告として残す。
- `receipt-product-matching.js` はこの問題が付いたOCRコードを正確な登録コード候補としては使用せず、商品名による候補提示と手動選択は継続する。`ocr-lab/confirmation-preview.js` は原本確認の警告を表示し、問題が付いたコードの登録済み／未登録予備判定を表示しない。
- 新しい合成JAN3件の回帰テストでは、有効な番号はすべて明細に対応し、末尾1桁を誤読した番号は明細を維持しつつ警告を出す。**今回のiPhone3件は正常コードなので画面挙動は変わらない見込み**。GitHubオフラインCIは成功。未検証の写真に対する誤認識検出率までは主張しない。
- 前提：試験GASとGoogle Sheetsの変更0件、`ENABLE_EXPERIMENTAL_WRITES=false`、アプリからの書き込み禁止、本番環境未作成。

## 2026-10-31：OCR初回時間のフェーズ計測・個人情報を含まない結果共有・未知形式の決済行安全策

- 前回までにiPhoneでコーナンの3行JANレシートを **3商品・437/800/748円・計1,985円** と正しく再現した。初回の全体時間21.622秒に対し推論6.137秒、`setupEstimateMs` 14.189秒（推定）が大きく、さらなる精度検証と区別して**起動時間の切り分け**に着手。
- `ocr-lab/main.js` に従来の全体・画像前処理・セットアップ推定値に加えて `phases.sdkModuleLoadMs`、`phases.readerCallMs`、`phases.modelRuntimeEstimateMs` を追加。モデル推定は読取呼出－SDK推論時間に基づく**概算**で、確定的なネットワーク・モデル展開・WASM初期化の分離ではない。結果画面に**初回／モデル再利用**と各所要時間を表示する。今回の改修だけで高速化したとは扱わない。
- 新しい「**検証サマリーをコピー（個人情報なし）**」は、処理後サイズ・モデル名・初回フラグ・所要時間と検出／認識／明細／警告件数・合計一致の真偽のみを固定項目で共有する。**OCR全文・原本の写真・JAN・商品名・支払情報・店舗住所／電話・端末User-Agent**を含めない。従来の全文ログ共有は個人情報を含み得るため、今後は匿名サマリーと結果画面を優先。
- 同一タブで「次の写真を選択」すればモデルを再利用できる。明示の「写真と結果を破棄」は従来の完全破棄（モデル解放）を維持する。事前に画像やモデルを外部へ送信する先読みは行わない。
- `receipt-structure.js` に既存の決済行を除外する規則を補強。小計がOCRで欠けた場合でも、`お支払`・`電子マネー決済`・`QUICPay`・`交通系IC決済`・`QRコード決済`・`ポイント利用`などの行が**商品として抽出されない**合成テストを追加。取引情報はテストデータに保存せず、購入点数・金額一致判定は従来の60件を維持。
- `tests/receipt-ocr-lab.mjs` と `ocr-lab/test-browser.mjs` に匿名コピーの内容・初回／再実行フェーズの検査を追加。**オフライン回帰テストおよびOCR Chromium実ブラウザテスト成功**。iPhoneでの新サマリーの操作と初回フェーズ内訳は未測定。
- 開発プレビュー専用のUIとローカル明細処理だけの変更であり、試験GAS・試験用Sheet、`main`、公開認証設定、書き込み無効設定 `ENABLE_EXPERIMENTAL_WRITES=false`、本番未作成は不変。

## 2026-10-31：同一写真のOCR初回・2回目の比較表（端末内・計測値のみ）

- 前回は試験用OCR画面で、初回／再読込の各回の `totalMs` 等をユーザーが別々に記録して比較していた。今回、`ocr-lab/scan-comparison.js` に**写真1枚の計測2回目以降を1回目の基準値と比較する、メモリ限定のタイミング比較機能**を追加した。
- 2回読み取ると、`ocr-lab/index.html` の**OCRの時間指標の直下**に、全体・画像前処理・SDK読み込み・モデル／実行環境準備（推定）・検出認識推論・文字検出・文字認識の7指標の**1回目・今回・差**が表示される。より短い値は「−」、長い値は「＋」。値が測れない場合は「—」として明示。3回目以降は1回目と最新回を比較する。
- 比較用の内部状態には数値と非個人の設定区分のみ保持し、写真・OCR文字列・商品名・JAN・氏名・店舗・端末情報・決済情報は保存しない。写真の再選択・「写真と結果を破棄」・モデルの再作成が必要な読取エラー時は比較を破棄。写真変更だけならエンジンは再利用できるため、基準の最初が**初回モデル起動ではない場合はそれを明示**する。
- 切り抜き範囲・処理モード・出力サイズ・日本語正規化・バックエンドが変わった比較は**参考値**の注意書きを表示する。差から実際のネットワークダウンロード量、モデル展開時間、将来の高速化を断定しない。
- `tests/ocr-scan-comparison.mjs` の純粋な差分・プライバシー・リセットテスト、`tests/receipt-ocr-lab.mjs` の模擬DOMテスト、`ocr-lab/test-browser.mjs` の実Chromiumテストを追加・更新。**iPhone Safariでの今回の比較画面の実行はまだ未確認**。テスト用レシートは公開合成画像のみを使用。
- 既存の `stage-a-ui-handoff-review` プレビューのみを更新。本番環境は未作成のまま。試験GAS、12シート、Google認証設定、`main` は変更せず、`ENABLE_EXPERIMENTAL_WRITES=false` を維持。

## 2026-10-31：R1（コストコ）を受けた商品識別付きOCR検証レポート・手動コピー

- ユーザーがR1（既存レビューR01相当）のコストコ写真、iPhone同一写真1回目22.43秒／2回目11.18秒の比較画面と、2回目 `PP-OCRv6_small` の詳細OCRを提出。2回目は `firstRun:false`、全体11.181秒、推論10.930秒（検出2.221秒・認識8.694秒）、検出・認識142、行55、明細13、数量等の**要確認13**。モデル読込と実行環境準備の推定は2回目ゼロ。この測定は写真1枚・端末1回の値で、一般的な処理時間は未確定。
- R01の検証済み商品データ上では、13商品で値引前商品合計17,248円・クーポン合計2,490円・値引後14,758円。iPhoneのOCRでは `1●` 等の数量記号が `10` と認識されるため、商品13件は抽出できても**数量の印字確認が必要**。商品名の文字誤認識も一部残る。GitHubには生の写真・OCR全文・会員番号・決済情報を**新たに追加しない**。
- 既存の「匿名検証サマリー」と「商品明細だけコピー」とは別に、**「商品検証レポートをコピー（名前・コード・金額含む）」**を `ocr-lab/` に追加。出力は、商品ごとの番号・OCR商品名・SKU/JAN（OCR認識値）・数量・数量根拠・単価・値引前・値引き・差引・要確認理由・商品候補一致種別と手動選択した商品名、商品数と警告の位置別件数、照合金額と主要な時間指標を含むJSON。
- **同様の「商品照合結果をコピー」**を既存 `gas-trial-connection.html` の⑤にも追加。認証済みマスタは従来の読み取りのみで、ユーザーが選択した候補名と一致種別を含めて端末内でレポートを生成。⑤には写真OCR計測がないため時間は空欄（`null`）。コピー後も**GASへの明細送信、登録・保存、更新は0回**。
- `ocr-lab/product-test-report.js` は**出力項目を固定した許可リスト方式**。OCR全文・原文行・観測座標・店舗住所・会員番号・取引番号・決済識別情報・端末User-Agent・家庭IDや内部商品IDを含めず、商品名に決済・会員識別らしい文字が含まれれば非表示とする。商品名・コード・購入履歴自体はプライベートなので、「匿名レポート」とは呼ばず、**ユーザーが共有先を確認した場合にのみ**コピーする。クリップボードの許可失敗時に全文選択へフォールバックしない。
- `tests/ocr-product-test-report.mjs` で既存R01文字列から合成的な数量誤読を作り、13商品の要確認・値引計算・個人識別番号除外・登録候補名表示を確認。`tests/receipt-ocr-lab.mjs` と `ocr-lab/test-browser.mjs` にユーザー操作のコピー検証を追加。`tests/receipt-catalog-integration.mjs` は**認証済み候補の手動選択→コピーと、ログアウト後に候補が残らないこと**をテスト。
- 開発プレビューだけの更新。既存試験GAS、試験シート、本番環境、`main`、Google権限・URL、`ENABLE_EXPERIMENTAL_WRITES=false` を維持。ユーザーの次回操作は最新版OCR試験画面でR1を再OCRする必要なし。現在のレポートを取得したい場合だけ再度写真を読み取り「商品検証レポートをコピー」を使用する。

## 2026-10-31：コストコR1の詳細コピー実測・購入点数と内税額の読みこぼし修正

- ユーザーが新しい `product-test-1` 検証レポートを共有。実機iPhone初回 `firstRun:true`、全体22,135ms、SDK読込2,724ms、モデル／実行環境（推定）8,282ms、推論10,563ms（文字検出2,254ms・文字認識8,289ms）。**モデル初期化を含まない2回目の比較対象は別回で報告された11,181ms**であり、今回の22,135msとは**初回／2回目の一般化できる対比較ではない**。
- 商品別のOCR認識13件、数量はすべて `inferred_candidate` で`quantity_ocr_ambiguous`付き。コード、値引前の金額、値引金額、値引後の金額は既存R01正解データと13/13一致。合計：17,248円－2,490円＝14,758円、合計印字一致。商品名は**完全一致5件、空白差のみ1件、文字誤読を含む7件**（既存のR01正解商品名を基準とする厳密照合）。商品を13件抽出できても、商品名・数量まで確定したという意味ではない。商品マスタ未読み込み `catalogSource:none` なので候補0件・照合精度は未評価。
- 個別商品に紐づかない警告が3件（`invalid_item` 1、`unpriced_name` 2）、全件が明細範囲外。これらは金額・商品明細を壊していないが、別レシートの可能性も含めて警告は保持。**商品ごとの13件の数量要確認はこの警告3件と別集計**。
- 販売点数は実際のOCRの **「御買上げ点数 13 (3D)」** 表記のため、以前の「お買上点数13点」専用パターンでは読み取れず `printedCount:null`。税額は実際のOCRの **「8%対象 12,120（消費税 898)」** と **「10%対象 2,638（消費税 240)」** で、丸括弧前の空白がないため、`taxTotal:null`。
- `receipt-structure.js` の**印字購入点数**パターンに「御買上げ点数」と任意の末尾レジ・端末記号を追加し、括弧前空白の有無にかかわらず**税率別税額**を読み取れるよう修正。既存のR01レビュー正解データから数量OCR誤読と税表記を再現したテスト `tests/ocr-product-test-report.mjs` を追加。修正後は **`printedCount=13`、`printedCountMatches=true`、`taxTotal=1,138`（8%=898、10%=240）** を再現。
- **重要：購入点数の集計が一致しても、13商品の各数量のOCR誤読は証明・解消されない。** `needsReview=13` と、個々の `quantity_ocr_ambiguous` を維持し、自動確定はしない。
- 本変更は開発プレビューのOCR後処理のみ。試験用GAS・試験シート・`main`・本番環境には触れず、`ENABLE_EXPERIMENTAL_WRITES=false` の方針を維持。

## 2026-10-31：OCR日本語漢字変換を標準ON・コストコ数量トークンを見える化

- ユーザーの要望により、日本語向け漢字変換（中国語字体の日本語漢字への正規化）は**OCR試験画面の初期値ON**に変更。`index.html` のチェックボックスの `checked` を使い、毎回手動でONにする操作を不要にした。任意にOFFにしてA/B比較でき、`normalize-japanese.js` と認識原文を維持。過去のR1結果は元々ONで取得済みなので、**今回の設定変更を精度向上と扱わない**。
- 前回R1で13件すべてが `quantity_ocr_ambiguous`（OCR値 `10`、価格計算の数量候補 `1`）だったため、SKU明細に限定して `ocrQuantityToken` を保持。OCR商品一覧に「OCR数量表記『10』→数量候補1（単価と金額から推定）」と表示し、商品検証コピーにも数値／限定記号だけを含む短いOCR印字トークンを追加。レシート本文は追加コピーしない。
- **要確認13件は維持**。単価×候補数量が金額と一致しても、個々の数量を確認したことにはならない。手動確認チェックの状態と、候補・印字の違いを明確化するだけであり、商品名の7件の文字誤読はまだ未改善。
- 試験GAS・Sheets・`main`・本番環境を変更しない。 `ENABLE_EXPERIMENTAL_WRITES=false` の運用方針を維持。
