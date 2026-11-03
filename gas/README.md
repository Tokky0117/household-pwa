# くらしストック｜新規GAS・Google Sheets（クリーン構築）

## v0.64.0 現行の試作GAS状態と更新手順（2026-11-03）

**本節を現行の接続仕様とする。下の古いv0.52〜v0.57実装段階・未接続記述は履歴です。**

- 現在の試作PWAは3タブ（日用品／レシート／設定）。`item.*`、`product.*`、`store.*`、`record.*`、`alias.upsert` と `alias.link` を試作GASのAPIとして実装。日用品・商品・レシート・値札データの正本は新Google Sheetsの12シートです。家計簿UI／月次集計は廃止しました。
- v0.64.0 では `product_aliases.ocr_name` と `record_items.alias_id` をそれぞれ**末尾に追加**。旧列や既存行を消したり、商品ID・数量・金額を変更したりしません。`bootstrap` が列追加と旧明細の辞書参照移行を実行し、中断しても再実行します。旧レシートの印字名は `raw_name` として残します。
- `gas/Setup.gs` は新規シート初期化用のままですが、既存ブックのスキーマ検証時も、この2列だけは追加できます。旧ブックの作り直しはしません。
- 試作GASの更新は既存のGitHub Actionsデプロイワークフローで自動反映済み。新たなGAS／Sheetsを作成したり、手動で毎回デプロイしたりしません。保存先スプレッドシートのIDとプロパティは変更しません。
- **既存データの更新原則**：GASコード変更時は既存ワークフローで同じ試作GASデプロイを更新し、試作PWAの自動取得・新列・過去行・重複行なし・税込明細合計を確認する。**自動Googleシートバックアップおよび追加のシートID設定は不要**。初期化関数 `setupNewWorkbook()` によるブック再作成は行わない。
- 過去の `record_items.raw_name` は歴史的な印字記録として維持し、新規行の `raw_name` は空欄で `alias_id` 参照を利用します。商品マスタと日用品の紐付けは任意。OCR文字列の辞書リンクを直しても過去の確定 `record_items.product_id` は書き換えません。
- 現在のAPI認証モードは `temporary-household`。**WebアプリURLを知る第三者に読み書き可能**な状態なので、個人情報を含む実レシートの使用を始める前に認可方式を別途見直す必要があります。家庭IDは認可・同期・操作履歴に依存するためv0.64では削除しません。
- 試作GAS以外、既存別試験ブック、`main` の変更は禁止。実機の受け入れは自動デプロイの完了とは別に実施します。

---

## 過去の導入段階（履歴）

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

## 2026-11-01：一時ログイン省略（新Sheetsを直接使用）

- ユーザーの指示で、認証を後で復帰できるよう保持しながら、現段階では **Googleログインなしの共有家庭** として扱う。画面はPreview v46のまま。
- `gas/Api.gs` の `KURASHI_AUTH_MODE = 'temporary-household'` が唯一のサーバー側切替。初期化済みの家庭が1件だけ存在することを検証して家庭IDを決める。Googleログイン用の `users` 行は偽造・追加しない。
- PWAは起動時に新GASの `bootstrap` を自動実行。登録・在庫変更・編集・非表示は新GASへ正式保存する。端末内の旧試作データと混同しない。
- 後で認証を有効にするときは `KURASHI_AUTH_MODE = 'google'` へ変更する。PWAは `UNAUTHORIZED` を受けるとGoogleログインを求める既存経路へ切り替える。**元のGoogleログイン失敗原因の修正・実機受入は別途必要。**
- サーバー側の書込みロック、操作ID、冪等性、versionチェック、再送復旧、変更履歴は維持。
- 注意：一時モードの間、公開WebアプリURLを知る第三者も家庭の保存データを読み書き可能。レシート等の個人情報はこの間入力しないこと。
- 商品・レシート・店舗の書込みAPIはまだ接続しない。画面の試作機能を正式保存と誤表示しない。
- テスト `tests/no-login-household.mjs` をページ公開・GAS更新前の検証に追加。テストはメモリ上のSheetsモックを使い、実データへ書き込まない。

## 2026-11-02：試作 v0.52.0 同期処理の再構築

- **端末内の複数操作キューはIndexedDB**（`kurashi-stock-operations-v1`）。以前の端末内 `kurashi-new-write-v1-temporary-household` の操作1件ジャーナルを起動時に取り込む。取り込みが端末に確定するまで元ジャーナルを消さない。
- 画面操作に対するレスポンスはIndexedDBのキュー記録完了時点。GAS保存が終わるまでボタンの再操作を止めない。
- サーバーへ送った要求本文と操作IDは送信前に端末へ保存し、再起動時に同じ本文・IDを再送する。成功確認後のみキューから削除。
- 順次保存後に1回だけSheetsとの全件同期を行う。表示は確定済みSnapshotに未送信キューを投影する。
- 連続タップ、端末再起動、応答喪失、キュー対象の正式IDマッピング、version競合のモックテストあり。実iPhoneでの操作確認は別途行う。
- **現行の設計と機能境界は [OPERATION_QUEUE.md](../OPERATION_QUEUE.md)** を参照。旧来の「保存待ち操作1件」「手動再送必須」などの記述はv0.51.0以前の仕様であり、v0.52.0には適用しない。

## 2026-11-02：試作 v0.53.0 日用品並び替え

- `item.reorder` を実装。`category_id`、`item_group_ids`、`versions` で、同カテゴリ内の表示中の日用品全件の順序を一操作として送信する。
- `processed_operations` にbefore/afterを記録してから行を更新。途中で処理が停止しても同じ操作IDで再開可能。
- 商品の並び替えとレシート保存は未接続。

## 2026-11-02：試作 v0.54.0 商品管理の正式保存

- 新GASに `product.create` / `product.update` を追加。商品名・内容量・単位・登録先の検証、家庭境界、重複、version競合、操作ID冪等性、prepared journal復旧、change_logを実装。
- 既存の「商品を登録」「新しい商品を作成」「編集」「解除」「登録先変更」をIndexedDBキューから非同期送信。UI構造はPreview v46のまま。
- 商品を解除してもproductsから削除しない。画面で表示するのは正本＋キューの投影。仮商品ID／仮日用品IDは確定後に置換。
- 未実装：商品の長押し並び替え、別名、レシート／値札、価格集計。古い手順や「商品管理は未接続」の説明は当時の履歴。

## 2026-11-02：試作 v0.55.0 商品並び替え

- `product.reorder` の `item_group_id`／`product_ids`／`versions` を1操作として検証。関連する商品の `item_group_order` と変更された行の `version` を更新する。
- `processed_operations` に全行のbefore/afterを先行記録し、GASの複数行書込み途中で停止しても同じ操作IDで復旧可能とする。
- Preview v46の長押しUIと共通IndexedDBキューを使用。通信応答喪失、再起動、未確定商品IDの置換、他端末競合の自動試験を追加。
- 商品新規作成のフォーム操作ボタンと内容量欄の間隔を調整。他のUIと同期設計は維持。

## 2026-11-02：試作 v0.56.0 手入力の記録・チェーンを接続

- `store.create`：チェーン名をユーザーが明示して確定、家庭別に正規化重複を拒否。操作IDの応答喪失・再送をジャーナルから復旧。
- `record.create`：`record_type`、`chain_id`、`record_date` と1～100件の明細。日付・数量・税込明細合計・商品参照・カテゴリを厳格に検証。レシートは商品未照合・未分類可、値札は商品選択必須。
- `processed_operations` に親recordsと全record_itemsの確定前画像を保存。GASの部分停止では再送時に既存行との完全一致を確認し、不足行のみ挿入して`change_log`を1回確定する。
- UIのレシート・家計簿・商品別価格は新Sheetで共有する記録へ切替。旧サンプル・旧端末localStorageの記録は新Sheetへ自動移行しない。
- 現状認証 `temporary-household` のため機密データの投入は禁止。Googleログインを再有効化してから個人用レシート運用へ進む。

## 2026-11-02：v0.57.0 レシート本流OCRと家計簿画面簡素化

- 検証済み旧ラボのPaddleOCR PP-OCRv6_smallをGitHub Pages配信の本流レシート画面へ接続。OCRの写真／全文はSheetsへ送信せず、ユーザー確認済み商品行のみ `record.create` へ渡す。
- 家計簿タブUIは「今後実装予定」の案内に変更。既存のrecord_itemsや集計関数を削除・移行しない。
- Googleログイン復旧はユーザーの指示により実施しない。 `temporary-household` 公開アクセス上のリスクは残る。
