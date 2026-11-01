# くらしストック｜新規GAS・Google Sheets（クリーン構築）

## 現在の段階

- UI基準は **2026-10-22 Preview v46**、復元コミット `4297b09ccb01`。
- 作業ブランチは `preview-v46-clean-base`。v46の画面構成・CSSを維持。`app.js` の保存イベントと `index.html`／`sw.js` の読み込み部分のみ新GAS接続に合わせて更新。
- `gas/Setup.gs` は新しいGoogle Sheetsの初期作成だけを実行するコード。利用者から新GAS・12シートの作成成功が報告済み。
- **旧試験GAS、旧試験Sheet、main、実装11ブランチに変更を加えない**。旧レシートはコピーも削除もしない。

## 新Google Sheetsの構成（12シート）

既存の `DATA_MODEL.md` v1.8 と、実装済みGASの列契約を照合した。シート数を減らすことは目的にしない。画面表示だけでなく、正しい保存、夫婦間共有、再送の重複防止に必要な構成を維持する。

| 名前 | 用途 | 初期データ |
| --- | --- | --- |
| `households` | 家庭（共有単位） | 1家庭 |
| `users` | Googleアカウントと家庭の紐付け | 空。本人確認後に登録 |
| `categories` | 固定5カテゴリ | 5件（ID 0〜4） |
| `stores` | スーパーなどのチェーン | 空 |
| `item_groups` | 日用品と在庫状態、表示順 | 空 |
| `products` | 商品と日用品への紐付け | 空 |
| `product_aliases` | OCR文字列・商品コードと商品の対応 | 空 |
| `records` | レシート／値札の共通ヘッダー | 空 |
| `record_items` | レシート／値札の明細 | 空 |
| `change_log` | 家庭単位の変更順序と他端末同期 | 空 |
| `processed_operations` | 同じ保存操作の二重実行防止と失敗復旧 | 空 |
| `receipt_rules` | 将来の読取規則用（正本v1.8に存在） | 空。現段階で機能追加しない |

**新規登録するデータは家庭1件と固定カテゴリ5件のみ**。架空の日用品、商品、レシート、値札、価格は作らない。レシート画像も保存しない。

- `record_items.quantity` は購入個数、`amount_tax_included` は**その個数すべての税込明細合計**。2個で340円とあれば340円であり再乗算しない。
- カテゴリIDは従来の0〜4を維持し、Preview v46のカテゴリ順と一致させる。
- `users.auth_subject` は長い数値文字列になるためテキスト形式で保持する。メールアドレスや認証トークンはシートに保存しない。
- 商品・店舗・履歴・操作記録について、旧環境からの移行は実施しない。

## 新規作成手順（新しいGASプロジェクトのみ）

既存のGASエディタには貼り付けない。新規の独立したGASプロジェクトを1つ作り、次を実行する。

1. <https://script.google.com/home/projects/create> から**新しい**Apps Scriptプロジェクトを開く。
2. GitHubの `gas/Setup.gs` の全文を新規プロジェクトのコードに貼り付け、保存する。
3. 関数 `setupNewWorkbook` を選び、初回のGoogleアクセス許可を確認して実行する。
4. 実行ログに表示される `spreadsheetUrl` を開いて12シート、固定5カテゴリ、家庭1件を確認する。

- この処理は**そのGASプロジェクトの設定に作成先を保存**する。途中で中断して再実行しても同じ新しいSheetの初期化を再開し、別のSheetを繰り返し作らない。
- すでに別の `SPREADSHEET_ID` を持つGASプロジェクトでは**中止**する。
- 完了するまでは新PWAからアクセスできない。Webアプリ公開・API実装・夫婦2アカウントの紐付けは後続工程。
- スクリプトID、シートID、個人の認証情報をGitHubのソースコードへ書かない。

## 次に実装する範囲

新GASに、固定GoogleクライアントIDによる認証、家庭別の自動読込と `item.create`／`item.update` を接続する。UIはv46の一覧とフォームを使い、手動の「シートから読み込み」ボタンや独立の試験画面を作らない。商品管理、レシート保存、家計簿と価格情報は既存の仕様に従い次段階で接続する。

**既存の実装11 GASコードはコピーしない。** 冪等処理、家庭隔離、競合検知などの要件は残すが、試験専用診断や古い履歴互換処理は持ち込まない。


## 日用品の読み取り・保存API（実装済み、公開済み旧版との差分反映待ち）

`gas/Api.gs` は **新GASのみ** に追加するAPIである。旧試験GASのコードや設定をコピーしない。

- `bootstrap`: ログインした家庭の確定カテゴリ・日用品・商品・店舗と変更番号を返す
- `item.create`: 日用品を作る。初期在庫は「なし」
- `item.update`: 在庫状態、非表示状態、名前とカテゴリの変更を保存する
- 認証: Google IDトークンをGoogleへ確認し、発行先クライアントID・発行者・有効期限を検査。承認済みGoogleアドレスは1件または2件を許可し、本人のみ登録。後から2件目を追加可能。
- 保存: `LockService`、`version`、操作ID、`processed_operations` と `change_log`。通信結果が不明なときは**同じ操作IDでのみ**確認・復旧し、別IDで自動再送しない
- **未実装**: 商品・店舗・レシートの書込みAPI、並び替え、価格・家計簿の実データ反映。未実装APIは `UNSUPPORTED` として拒否する

### 新GASへの追加と公開（GASコードを初めて使うときに1回）

1. Sheetsを作成した**同じ新GASプロジェクト**を開く。左側の「ファイル」→「＋」→「スクリプト」で `Api` を作成する。
2. [Api.gs](./Api.gs) のコード全文をコピーして `Api.gs` に貼り付け、保存する。元の `Setup.gs`（コード.gs）は削除しない。
3. 「プロジェクトの設定」→「スクリプト プロパティ」に以下を**自分で**登録する。
   - `GOOGLE_CLIENT_ID`: Web用 Google Identity Services のクライアントID。従来のGitHub Pages originで使用していた既存のGoogleログイン用クライアントを再利用可能（**旧GASや旧Sheetへの接続ではない**）。
   - `HOUSEHOLD_MEMBER_EMAILS`: はじめは本人のGoogleメールアドレス **1件でよい**。後で夫婦2人のGoogleメールアドレスを半角カンマ区切りで2件に変更できる。ソースコードやチャットにアドレスを書かない。
   - `SPREADSHEET_ID` と `KURASHI_NEW_WORKBOOK_ID`、`KURASHI_SCHEMA_VERSION` はSetupが登録済み。手動で上書きしない。
4. 「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」、**実行ユーザー：自分**、アクセスできるユーザー：**全員**（GAS内部で毎回GoogleのIDトークンを検証するため）。アクセス許可して公開する。
5. 発行された **`https://script.google.com/macros/s/.../exec` のURLだけ** を次のPWA接続に使う。秘密のトークン、クライアントシークレット、メールアドレス、スプレッドシートIDはチャットへ送らない。

`GOOGLE_CLIENT_ID` は以前のWebログイン設定で使用した公開クライアントID（`290567395833-cdemend3itmapsgsounu8pf72hgvm315.apps.googleusercontent.com`）が利用できる可能性がある。Google Cloud側でGitHub Pages originが許可されていることを確認する。旧GASの `/exec` URLは**絶対に再利用しない**。

### 接続前の注意

- 作成したSheetは、最初のGoogleログインまで `users` が空。初回ログインでScript Propertiesの承認済み1～2メールアドレスとGoogleの確認済みメールが一致した場合にのみ `users` に不変のGoogle `sub` を記録する。最大2名。ログイン用メールはSheetに保存しない。
- 新ブランチPWAは指定された新GASの /exec に接続するコードを配置済み。旧端末内のサンプル日用品・架空価格を通常表示に混ぜない。**実機でのログイン・読み書きは未受入**。
- 初回の新GAS Webアプリは利用者がデプロイ済み。現在の /exec: `AKfycbwn-SfXqRBIjJWVUUIKEsJuaUR6DLAEWbMVR-_rEB3iVZy2zi0ZNSA7JjNmyykvKjvdoQ`。**1件登録を許可する最新 `Api.gs` の再公開とPWA受入は未完了**。

## 2026-11-01 — 以後のGASソース／公開版更新はGitHub Actions経由

- ワークフロー: [gas-deploy-new.yml](../.github/workflows/gas-deploy-new.yml)
- **正しいブランチ**: `preview-v46-clean-base`。旧試験用 `stage-a-ui-handoff-review` のワークフロー、`GAS_SCRIPT_ID_TEST` は一切使用しない。
- GASコード `gas/Setup.gs` または `gas/Api.gs` をGitHubで更新した場合、**新GASの既存WebアプリURLをそのまま**自動更新する。新デプロイは作らない。
- 新GASの既存デプロイIDはユーザーが提供した `/exec` の `AKfycbwn-SfXqRBIjJWVUUIKEsJuaUR6DLAEWbMVR-_rEB3iVZy2zi0ZNSA7JjNmyykvKjvdoQ` に固定。
- スクリプトIDはデプロイIDと異なり、`/exec` URLから推測しない。GitHubのRepository Variables `GAS_SCRIPT_ID_NEW` に新GASプロジェクトのスクリプトIDを設定する（初回のみ）。未設定ならワークフローは安全にスキップ。
- 認証は既にGitHub Actionsへ登録済みの `CLASPRC_JSON` Secretを利用する。認可期限切れなどで失敗した場合は**再設定が必要**で、更新成功を偽らない。Secretの値をログに出さない。
- 更新前には新GASの既存デプロイID、ソースファイル構成、既知のGitHub履歴との一致を確認。想定外の手動変更があれば**書き込み停止**。更新前ソースを30日バックアップし、`clasp push` 後に内容を確認してから既存デプロイを更新。
- **まだ初回の自動配信は未実行**。変数登録とワークフローの実行成功まではGAS公開版の更新を断言しない。
- 日常のコード更新ではGASへの貼付、手動保存、手動の「デプロイ管理」操作は不要。Script Propertiesの家庭メンバー設定など、コードではないプライベート設定はGitHubから上書きしない。
