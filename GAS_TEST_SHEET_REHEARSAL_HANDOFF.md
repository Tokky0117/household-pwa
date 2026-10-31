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
