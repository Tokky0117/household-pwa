# くらしストック GAS API — 現行状態と初期実装履歴

更新：2026-11-01。対象ブランチ：`stage-a-ui-handoff-review`。

> **通信仕様の正本は [TRANSPORT_DESIGN.md](./TRANSPORT_DESIGN.md) 冒頭の「2026-10-28 時点の通信契約」**。実測・採否の記録は [TRANSPORT_DECISION.md](./TRANSPORT_DECISION.md)。以下の「実装済み」「未実装／接続ブロッカー」等は **2026-10-25当時の履歴** であり、その後の実装や試験結果を反映していない。

## 実装9 継続保存の次工程（2026-11-01・開発コード／模擬回帰まで）

- iPhoneで受入済みの固定2件＋追加一般1件の**3件・6明細**を保護し、同一試験家庭に一般レシートを**追加累計20件まで**継続保存できる試験専用`record.trial.main.create`と整合性検査を実装。一般`record.create`の拒否は継続。既知の試験GAS・家庭・ユーザー・店舗・カテゴリのみで動作し、新IDの途中失敗は同じIDで復旧。上限到達後の旧ID再送も許可。
- 試験用の⑥画面は固定レシート2件と追加複数件の読み取りに対応。既存PWAは追加画面なしで連続保存する。検査済み行スナップショットを再利用し、一般レシート20件でも検査中のシート読取回数が増大しないよう調整、オフライン模擬テストで検証。
- **最新版を実GASに同期したという意味ではない。** 既存試験GASへのソース反映、新版デプロイ、実機4件目の受入はまだ未実施。実Sheet初期化・新規GAS作成・本番`main`への反映は行わない。

## 実装9 試験GASソース反映成功（2026-11-01）／既存Webアプリ新バージョン公開待ち

- `record.trial.main.create` を含む開発ブランチのGASソースを、[GitHub Actions](https://github.com/Tokky0117/household-pwa/actions/runs/41280515227)で**既存試験GASへ反映成功**。旧ソースを固定照合、[復旧用アーティファクト](https://github.com/Tokky0117/household-pwa/actions/runs/41280515227/artifacts/13072673292)を保存。更新後の再取得に加えて、[独立読取監査](https://github.com/Tokky0117/household-pwa/actions/runs/41280583758)でもGASソース完全一致を確認。既存マニフェスト・プロパティ・実シート・公開版は変更せず、同期トリガーは再度無効化。
- 次の利用者操作は、既存の**試験用**デプロイ管理から「新しいバージョン」をデプロイすること。実行ユーザーとアクセス範囲はそのまま。続いて開発プレビューの `?receipt_trial=1` で試験用GAS URLとGoogleログインを設定し、**架空の確認済み1レシートのみ**本流UIから保存して既存2件と共存するか確認する。
- **GASの新バージョンデプロイ／一般明細1件の実Sheets保存・再読取はまだ未実施**。固定2件の実機成功を繰り返さない。一般の`record.create`は公開不可、`main`・本番GASは変更しない。

## 実装9 追加開発（2026-11-01）：本流PWAの一般明細1件試験・未デプロイ

- 固定2件の実Sheet受入成功を踏まえ、開発ブランチに `record.trial.main.create`（試験GAS・試験家庭・既知店舗に限定して**一般的な確認済みレシート1件だけ**を作る）を実装。 `record.create` の通常書込拒否を維持。保存ジャーナル・同一ID再送・途中失敗復旧のオフライン試験を追加。既存固定2件の保護と、3件目が追加された場合の固定⑥照合にも対応。
- 本流PWAの既存の「読取→確認→保存」から試験専用APIを使うコードを追加。従来の開発プレビューはログイン・GASとも無効。**明示的に `?receipt_trial=1` を付けた開発プレビューだけ**、設定画面から既存試験GAS /exec URLをその都度入力し、Googleログインして利用する。試験URLとトークンはブラウザストレージに保存しない。アプリの既存画面のみを使用し、日常UIに新しい確認画面は追加しない。
- **現段階はGitHubコード・オフラインモックまで。** この新しい `gas/Code.gs` の実試験GASへの反映／Webアプリ再デプロイ／試験用の一般レシート実保存・読取は未実施。これまで成功した固定⑥⑦⑨を繰り返す必要はない。 `main`・本番・既存シート・書込プロパティは無変更。

## 実装9 実機確認（2026-11-01）：既存の2件目受入に成功

- 利用者が既存試験GASの新バージョン公開を実行。iPhoneの⑥「保存済み試験レシートを読み取る」で**レシート2件・明細4件（496円＋458円）**の認証付き照合が成功。測定3.55秒・読み取りでの書込み0件。⑨の応答画面そのものは画像にないが、2件目の固定データを読めたので実試験用Sheetへの2件目保存結果は確認済み。
- 既存GASソース更新・新バージョン公開・固定2件目の認証付き読取を受入済み。以降の工程は**一般レシートの本流PWA保存**、その後に夫婦の実アカウント共有。固定試験ボタンを再実行せず、既存試験GAS・Sheetを継続利用。現行GASは任意レシートの通常書込を**拒否**したまま。

## 実装9 最新（2026-11-01）：既存試験GASのソース反映完了

- 最新の⑧保存前検査／⑨2件目458円固定保存を含む `gas/Code.gs` は、既存の試験用GASへ反映済み。旧ソース・マニフェストと対象を固定照合し、[更新前バックアップ](https://github.com/Tokky0117/household-pwa/actions/runs/41277818914/artifacts/13071194689)を保存。更新後検査スクリプトの構文エラーにより同期Action全体は失敗表示だが、別の[読み取り専用照合Action成功](https://github.com/Tokky0117/household-pwa/actions/runs/41277891744)で、**実GASの現在のソースと開発ブランチの最新版が完全一致**し、マニフェストは不変と確認。自動プッシュは停止済み。
- **既存Webアプリの新バージョンへのデプロイが次の利用者操作。** 「デプロイ → デプロイを管理 → 既存試験デプロイの編集（鉛筆） → バージョン：新しいバージョン → デプロイ」。所有者・アクセス範囲は変更しない。続いて既存の開発ブランチ試験接続画面で⑥（1件2明細496円）→⑨（固定458円2明細の保存）→⑥（2件4明細）を確認。実GASでの⑨書込は**未実施**。
- `main`・試験Sheetの既存データ・本番設定・一般 `record.create` 禁止は維持。⑥⑦は従来のiPhone成功を引き継ぎ、新規保存の受入と混同しない。

## 現況（2026-11-01・実機⑥⑦成功後）

- iPhoneから試験GASの**⑥確定済み1件・2明細・496円の認証付き読み取り成功（3.58秒）**、**⑦固定レシートの同一操作ID再送成功・新規追加なし（11.46秒）**を利用者が確認済み。ここまでの再試験は不要。
- 追加した **⑧任意の架空2明細を確認する保存前検査**と、**⑨固定の架空2件目（458円・2明細）の1回限り保存／同一ID復旧**は開発ブランチの実装・模擬テスト成功まで。⑨は元の496円レシートを変更せず、⑥が1件・2明細／2件・4明細の双方を厳密照合できる。**この追加コードを含むGASソースの反映と既存Webアプリ新バージョンへのデプロイは未実施**。試験シートの追加書き込みも行っていない。
- 本流PWAの一般レシート新規保存と夫婦間の実同期は未解禁。通常の書き込みフラグ、`main`、本番環境は維持。

## 2026-11-01：試験GASのソース反映完了／Webアプリ公開待ち（当時の履歴）

- 開発ブランチの最新 `gas/Code.gs` を既存の試験用GASへ反映済み。更新前ソースを前版コミット `2e38612` と全内容照合してから置換し、更新後に `clasp pull` で同一ソースを再確認した。[GitHub Actions 成功結果](https://github.com/Tokky0117/household-pwa/actions/runs/41275439091)。一時的な自動更新トリガーは無効化済み。
- **Webアプリの既存デプロイは未更新**。GAS編集画面の「デプロイ → デプロイを管理 → 編集（鉛筆） → バージョン：新しいバージョン → デプロイ」から、既存の**試験用**デプロイだけを新バージョンにする。既存の実行ユーザー／アクセス範囲（自分のみ）を変更しない。新規GAS・Sheet・デプロイは作らない。
- 次に[既存の試験用接続確認画面](../gas-trial-connection.html)から、①試験用 `/exec` URL確認と②Googleログイン後、**③認証付き件数取得 → ⑥固定レシートの読み取り → ⑦同じ操作IDでの完了済みレシート再確認**を実行。④商品コード照合と⑤OCR検証は今回不要。⑦が表示する結果は固定の**レシート1件・2明細・税込496円／新規レシートなし**だけ。
- ⑥または⑦が失敗したら、別GASを作る・権限を広げる・ `ENABLE_EXPERIMENTAL_WRITES` をtrueにする等はせず、画面のエラー内容だけ確認する。本流PWAの一般レシート新規保存と夫婦間同期はまだ未有効。実際のデプロイ・iPhone確認の成功をコード更新の成功と混同しない。


## 2026-11-01：既存試験GAS・Sheetでレシート保存を試す最短手順（達成済みの履歴）

開発ブランチの `gas/Code.gs` に、所有者限定の `?trial_receipt=1` を追加。試験用の固定レシート（2明細・税込496円）について、**保存／同じ操作IDでの再送／保存件数の読み取り**を一画面で実施する。追加シート・追加設定・新しいサーバーは不要。対象Sheetは以前から確認済みの同一試験用IDに固定し、既知の架空商品コード試験が完了していなければ書き込まない。

実行するには、開発ブランチのGASコードを**既存の試験用GASへ反映し、所有者のみのまま既存デプロイを更新**する。その後、現在の試験用 `/exec` に `?trial_receipt=1` を付けてアクセスし、保存ボタン→読み取りボタンの順に押す。再実行しても同じレシートIDで確認する。**現時点ではGitHubコードだけの実装で、実GASの更新・実シートへの書き込みはまだしていない。**

通常PWAの `record.create` ゲート、本番シート、`main` は変更しない。詳細：[レシート保存・復旧設計](./RECEIPT_BATCH_WRITE_PLAN.md)。

## 現行状態（2026-10-28）

- **GAS＋Google Sheetsの当初構成を継続**。GitHub Pagesの通常PWAは `gas-api.js` にHTTP `POST` のアダプタを持つが、通常の保存機能は `LIVE_WRITE_ENABLED=false` のまま。試験GASに成功した `google.script.run` は別オリジンのGitHub Pages `fetch` の接続成功を保証しない。
- **既存の所有者限定・試験用GAS** には `/exec?trial_read=1` のHTML Serviceをデプロイ済み。読み取り、5シート従来／必要列方式の実機比較を実施。GitHubリポジトリ内の最新 `gas/Code.gs` は、その後の**保存工程別時間計測・Spreadsheetの単一オープン・重複ID検出**も含むが、ユーザーが再反映するまでは**既存デプロイへ自動反映されない**。
- GASの `item.create` / `item.update` は準備ジャーナル・同一操作ID再送・version検証・ロック・復旧安全停止のオフライン試験を実装。商品書き込み、レシート／値札書き込み、一般家庭の本番同期・公開は未承認。試験環境の所有者限定と、通常PWA／GASの書き込み禁止設定は維持。
- 新しいGAS／Sheets／サーバーを作らない。本番環境へのデプロイや設定変更は、別途明示的な承認が必要。

---

## 以下は2026-10-25時点の実装メモ（履歴）


## 実装済み
`gas/Code.gs` に12シートのヘッダー定義と空シート初期化、Google IDトークン照合、`users.auth_subject` と `households` による家庭認可、`bootstrap`、`sync`、`item.create`、`item.update`、`product.create`、`product.update`、`product.move` を追加。

変更APIはScriptLock、version検査、operation_idと内容ハッシュ照合、change_logを持つ。単一行主体のプロトタイプであり、**Sheet書込み成功後にchange_log / processed_operationsの追記が失敗した場合の復旧・原子的コミットは未実装**。このため運用データでは使用しないこと。

## 接続・動作確認の前提
1. Google Sheetsの専用テスト用スプレッドシートを作成。個人情報や家計情報は投入しない。
2. Apps Scriptに `Code.gs` を追加。スクリプトプロパティ `SPREADSHEET_ID` とGoogle IdentityのWebクライアントID `GOOGLE_CLIENT_ID` を設定。
3. 空シートだけのテスト用ブックで `initializeEmptySchema()` を手動実行。12シートを作る（途中失敗時は状態を確認してやり直す）。
4. `households` に家庭IDを、`users` にGoogle IDトークンの `sub` と同じ `auth_subject` および所属家庭IDを**管理者が手動登録**。ユーザーをAPIから自己登録させない。
5. 認証・家庭境界・競合テストが済むまでは `ENABLE_EXPERIMENTAL_WRITES` を設定しない。書込みは `WRITES_DISABLED` で拒否される。後日、専用テスト環境に限り明示的に `true` を設定して試験する。
6. 実際のデプロイ権限、Google Identityログインの連携、CORS/リダイレクト制限は未解決。**GitHub Pagesのv50からこのGAS Webアプリへ直接fetchできると仮定しない**。クライアント・中継方式は認証とともに別途設計する。

## リクエスト例
`POST /exec` へContent-Type `text/plain` でJSON文字列を送信：
```json
{"id_token":"<Google ID token>","action":"bootstrap"}
```
更新例（書込みは初期状態で無効）：
```json
{"id_token":"<Google ID token>","action":"item.update","operation_id":"<UUID>","payload":{"item_group_id":"<ID>","version":1,"in_stock":false}}
```
結果は `{"ok":true,"data":...}` または `{"ok":false,"error":{"code":"...","message":"..."}}`。GAS ContentServiceによるレスポンスはHTTP 200でもエラーを含むので、必ず `ok` を検査する。Google IDトークンや家庭IDをURL・ログに記録しない。

## 未実装／接続ブロッカー
- クライアントのGoogleログインの実機確認、GASとGitHub Pagesの安全な通信方式、公開設定・認可を含む実機検証
- 親子レシート明細をまとめて書くAPI、更新途中失敗の補償・復旧・照合機構
- 日用品と商品の連続した並び替えの一括更新・順序の連番維持（現行APIの更新は単行単位）
- 店舗の正規化・別名登録・一意制約、OCR、レシート・値札の登録・修正・削除
- full snapshotに対するchange_logの同期整合性、競合時のUI再読込とIndexedDBキュー
- GAS実環境のテスト、夫婦2端末の認証境界テスト、プレビュー接続

**本番データ保存を開始するには上記ブロッカーの解消が必要。** 12シートのデータ契約は `DATA_MODEL.md` を参照。

## iPhoneでの読取テスト
GitHubへの更新はApps Scriptエディタへ自動同期されない。既存GASコードの末尾に以下を追記して保存する（同名関数があれば重複追加しない）。
```javascript
function testCategoriesReadOnly(){
 const records=rows('categories').map(r=>r.obj);
 if(records.length!==5||records.some((r,i)=>String(r.name)!==CATEGORIES[i]||Number(r.fixed_order)!==i+1))throw new Error('categories の内容が設計と一致しません');
 Logger.log('READ_OK: categories = '+records.length+' / '+records.map(r=>r.name).join('、'));
 return true;
}
```
Apps Scriptの関数選択で `testCategoriesReadOnly` を選んで実行。ログに `READ_OK: categories = 5` が出れば、GASからスプレッドシートの読み取りに成功。書込みはしない。


## GitHub → テスト用Apps Scriptのコード反映（準備済み、認証未設定）

- GitHub Actions `.github/workflows/gas-push-test.yml` に **明示的な同期要求時だけ** の `clasp push --force` を追加。
- 実行対象は `stage-a-ui-handoff-review` ブランチ限定。**テスト用のGASスクリプトID** をGitHub Secretsの `GAS_SCRIPT_ID_TEST` に設定する。
- ユーザー認可情報は `CLASPRC_JSON` にGitHub Secretとして登録する。これは `clasp login` で生成される *OAuthリフレッシュトークンを含む非常に重要な認証情報*。チャット、Issue、コミット、スクリーンショットへ貼り付けない。
- `CLASPRC_JSON` を作るには最初の一度だけ、`clasp` が利用できるターミナル（PCまたはiPhoneからアクセス可能な安全な開発環境）でGoogle認証する必要がある。**GitHub Actionsだけでは対話的OAuthログインは完了できない**。
- Apps Script設定の「スクリプトID」と、Cloudの「プロジェクト番号」やWeb OAuthの「クライアントID」は別物。入力対象を混同しない。
- <https://script.google.com/home/usersettings> でApps Script APIを有効にする必要がある。
- `clasp push --force` は対象Apps Scriptプロジェクトのソースを上書きする。**その前に現在のコードを別途保存し、対象が専用テストプロジェクトか確認する**。スクリプトプロパティやGoogle Sheetsのデータを初期化する操作ではない。
- 手動Action成功でも公開済みWebアプリのバージョン更新やPWA連携は自動では行われない。

### iPhoneで先にできる作業
1. Apps Scriptの「プロジェクトの設定」→「ID」→**スクリプトID** を確認する（このID自体は認証秘密ではない）。
2. <https://script.google.com/home/usersettings> で「Google Apps Script API」をオンにする。
3. GitHubのリポジトリ → Settings → Secrets and variables → Actions に `GAS_SCRIPT_ID_TEST` を登録する。OAuth用 `CLASPRC_JSON` は後で安全な端末・環境から登録する。

**現時点ではワークフロー実行不可**（`CLASPRC_JSON` が未設定）。ユーザーのGoogleアカウントへの代理ログインやApps Script更新は実施していない。

### ブランチ専用の起動方式（2026-10-25更新）
- 現行ワークフローは **手動 `workflow_dispatch` のみ**。以前の `gas/sync-request.txt` による push 起動は削除済みで、ファイルを変更してもGASには反映されない。
- このワークフローは `main` に存在しないため、GitHubのUIに「Run workflow」が表示されないことがある。**UIに出ないからといってGitHub上の他のファイルを編集して発火させない**。
- 正しい `CLASPRC_JSON` と `GAS_SCRIPT_ID_TEST` が設定済みであり、専用テストGASとそのバックアップ対象を確認した場合だけ、手動で `BACKUP_DONE` を入力して実行する。
- 実行時はまず現行GASソースを `clasp pull` でバックアップし、GitHub Actions artifactとして保存する。**バックアップ取得・artifactアップロードが成功しなければ上書きしない**。artifactの保持期限は30日。
- `clasp push --force` はGASのソースを上書きする。**スクリプトプロパティを初期化するものではなく、Webアプリの公開バージョンを更新するものでもない**。
- `initializeEmptySchema()` は初期化済みシートでは絶対に実行しない。
- GASへ反映後、エディタから `testAllSheetsReadOnly()` を実行する。12シートの列、カテゴリ5件を読むだけで書込みはしない。ブラウザのCORS/Googleログインも別途確認する。

## 手動反映を最小化する方針（2026-10-24）

- **Codespacesの操作はいったん停止**。今後のGAS修正は作業ブランチで一括準備し、実機反映作業をまとめる。
- 先に `node tests/gas-offline-smoke.mjs` でモックを使った読み取り・ヘッダー整合性を確認できるようにした。これはGoogle Sheets実機へのアクセス成功を意味しない。
- 次に認証済みAPI読取と家庭アクセス制限を含む通信方式を確定し、**一度のGAS反映で確認できる読み取り専用テスト**をそろえる。
- 同期ワークフローは `CLASPRC_JSON` 未設定のまま。**同期要求ファイルを変更して起動しない**。また `clasp push --force` の実行前に現行GASのバックアップが必須。
- 最終的にユーザーが行うGoogle認証／デプロイ操作は、必要事項がそろってから一括案内する。すでに実施したGAS設定とGitHub Secretsは作り直さない。

### 追加した保護と自動テスト（2026-10-24）
- `rows()` が空行を除外した後に行番号を振り直していた不具合を修正。空行を挟んでもSheetsの物理行番号を維持する。
- `tests/gas-offline-smoke.mjs` に、カテゴリ5件の読み取り・列の不一致・空行を挟んだ行番号保持の検査を追加。
- GitHub Pagesプレビューの検証ワークフローにもGASオフライン検査を追加。**Google Sheets実機へのアクセス成功を意味しない**。
- 自動反映は認証未設定のため保留。GAS本体は未変更、テスト用の書込みは引き続き無効。

### 認証・家庭分離のオフライン回帰テスト（2026-10-24）
- `tests/gas-auth-isolation.mjs`: Google tokeninfoレスポンスをモックし、対象利用者A/Bの `bootstrap` / `sync` がそれぞれ自分の家庭だけの品目・商品・店舗・変更履歴を返すことを検査。
- 未登録ユーザー、audience不一致、期限切れ、tokeninfoエラー、トークン未指定で読み出しを拒否するケースも含む。
- GitHub PagesプレビューのCIで `node tests/gas-auth-isolation.mjs` を実行するよう設定。
- **オフラインのモックテストであり、実際のOAuth、GAS APIのデプロイ権限、CORS、Safari動作は未検証。** コードの自動反映と本番データの書込みは行わない。
