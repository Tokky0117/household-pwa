# GAS API 初期実装（実験用・未デプロイ）

更新：2026-10-22。対象ブランチ：`stage-a-ui-handoff-review`。

## 実装済み
`gas/Code.gs` に12シートのヘッダー定義と空シート初期化、Google IDトークン照合、`users.auth_subject` と `households` による家庭認可、`bootstrap`、`sync`、`item.create`、`item.update`、`product.create`、`product.update`、`product.move` を追加。

変更APIはScriptLock、version検査、operation_idと内容ハッシュ照合、change_logを持つ。単一行主体のプロトタイプであり、**Sheet書込み成功後にchange_log / processed_operationsの追記が失敗した場合の復旧・原子的コミットは未実装**。このため運用データでは使用しないこと。

## 接続・動作確認の前提
1. Google Sheetsの専用テスト用スプレッドシートを作成。個人情報や家計情報は投入しない。
2. Apps Scriptに `Code.gs` を追加。スクリプトプロパティ `SPREADSHEET_ID` とGoogle IdentityのWebクライアントID `GOOGLE_CLIENT_ID` を設定。
3. 空シートだけのテスト用ブックで `initializeEmptySchema()` を手動実行。12シートを作る（途中失敗時は状態を確認してやり直す）。
4. `households` に家庭IDを、`users` にGoogle IDトークンの `sub` と同じ `auth_subject` および所属家庭IDを**管理者が手動登録**。ユーザーをAPIから自己登録させない。
5. 認証・家庭境界・競合テストが済むまでは `ENABLE_EXPERIMENTAL_WRITES` を設定しない。書込みは `WRITES_DISABLED` で拒否される。後日、専用テスト環境に限り明示的に `true` を設定して試験する。
6. 実際のデプロイ権限、Google Identityログインの連携、CORS/リダイレクト制限は未解決。**GitHub Pagesのv46からこのGAS Webアプリへ直接fetchできると仮定しない**。クライアント・中継方式は認証とともに別途設計する。

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
- クライアントのGoogleログイン、GASとGitHub Pagesの安全な通信方式、公開設定・認可を含む実機検証
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

**現時点ではワークフロー実行不可**（GitHub Secretsが未設定）。ユーザーのGoogleアカウントへの代理ログインやApps Script更新は実施していない。

### ブランチ専用の起動方式
このワークフローはまだ `main` に存在しないため、GitHubの「Run workflow」ボタンは表示されない場合がある。その場合でも作業ブランチの `gas/sync-request.txt` に変更をコミットすることを**明示的な反映要求**とし、`push` トリガーで起動できる。コードをコミットしただけでは自動反映されず、事前のバックアップ・シークレット設定・対象の確認後に反映する。反映を完全自動化するのはテスト完了後に別途判断する。

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
