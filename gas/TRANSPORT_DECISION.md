# くらしストック：通信アーキテクチャ判断メモ（2026-10-26）

対象は `stage-a-ui-handoff-review`。**このメモは本番移行許可ではない。**

## 確認できた事実

- 新しい試験専用Google Sheetsと専用GASを作成し、GASエディタで `item.create` / `item.update` / 同一操作ID再送 / 古いversion拒否を実データ上で確認した。
- 同じ試験GASにHTML Serviceでページを配置し、`google.script.run` でカテゴリ5・日用品1・商品0・店舗0を取得するブラウザ試験も成功。
- GitHub Pagesの静的PWAから、GAS Content Serviceを`fetch`した通信はCORSまたはネットワーク制限エラー。個別のブラウザ通信ログによる原因特定は未実施。
- 上記成功は**試験GAS内からの通信**を示すだけで、GitHub Pages PWAが現状のGAS APIで読み書きできることを証明しない。

## 実装案の比較

| 方式 | メリット | 重要な制約・未解決事項 | 採否 |
|---|---|---|---|
| A: Google Apps Script HTML Service `google.script.run` | 別APIサーバーなし。GAS内画面からの読取実績あり | HTML Serviceはiframeサンドボックス。GitHub Pagesの既存Service Worker/PWAをそのまま移せない。GAS側の公開関数アクセス制御と認証を新設する必要 | **試験・画面設計の検証用として継続** |
| B: GitHub Pages PWA → 信頼できるHTTPS API (Cloud Run / Functions等) → Sheets/GAS相当の業務ロジック | 既存PWA・オフライン・サービスワーカーの維持、同一オリジン/CORSを設計可能 | サーバー設定・認証検証・権限管理・運用費・移植/共通化の作業が必要 | **本番候補として設計比較を継続** |
| C: GitHub Pagesから直接GAS `fetch` | 追加ホスト不要 | 現に読取通信失敗。ContentServiceリダイレクトやレスポンス制御の制約が大きい | **現状のままは不採用** |
| D: JSONP / `no-cors` / URLにIDトークン付与 | 実装が簡単に見える | 応答検証・トークン漏えい・認証の危険がある | **採用しない** |

## 当面の方針

1. **UIを全面移植しない**：今あるiPhone向けPWAの見た目、操作性、Service Worker、未確定操作ジャーナルを温存。
2. 試験GAS内で読取専用の一覧＋名前検索を作り、`google.script.run` の操作感/画面描画/再取得を検証。テスト専用家庭・試験専用シートのマーカーが一致する場合のみデータを返す。返す値は日用品名・カテゴリ・在庫状態だけ。ユーザーID・家庭ID・トークンは返さない。
3. **試験用の「自分のみ」アクセス制限は外さない**。GAS Webアプリを「スクリプトの所有者として実行」にすると呼出元利用者の家庭識別を暗黙に証明できるわけではない。`google.script.run`で呼べるすべての公開サーバー関数について、将来の一般公開前に認証・認可・入力検証・内部関数の非公開化を監査する。
4. 実装方式を決める前に、iPhoneのホーム画面追加、オフライン操作、Google認証、複数家庭/端末、同期・失敗復旧、費用を検証する。機能の一部成功だけで本番移行を決めない。
5. `LIVE_WRITE_ENABLED=false`、`ENABLE_EXPERIMENTAL_WRITES`未設定/falseを維持。運用中GAS・家庭用Google Sheets・`main`には変更を加えない。

## プロトタイプ試験手順

- 開発ブランチの最新 `gas/Code.gs` を**試験GASだけ**に貼り付けて保存、既存の試験専用Webアプリを新バージョンに更新。
- 試験用Webアプリの `/exec?trial_read=1` にアクセス。「試験用データを読み取る」でカテゴリ5・日用品1・商品0・店舗0のほか、在庫なしの試験用・牛乳が一覧に表示されることを確認する。
- 名前検索、再取得を確認。表示専用で、在庫や日用品の行数を変更しない。エラー時は詳細なURLや認証情報を共有せず、エラー名だけ連絡する。
- **現段階のユーザー操作は強制しない**。この試験は新アーキテクチャの妥当性を確認するもので、普段使いのPWA移行とは別。

参考：
- https://developers.google.com/apps-script/guides/html/reference/run
- https://developers.google.com/apps-script/guides/html/restrictions
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/guides/content

## 2026-10-26：GAS HTML Service公開関数の安全境界を分離

Google公式仕様により、HTML Serviceの`google.script.run`からはGASのグローバル関数を呼べる。名前末尾が`_`の関数はクライアントから呼べない。一方、試験時に使用していた統合`gas/Code.gs`には、データ行アクセス・初期化・編集・試験データ生成などのグローバル関数が多数含まれており、読み取り画面と同じプロジェクトへ置いたまま一般公開してはいけない。

この問題を防ぐ**専用の読み取り版**として`gas/trial-readonly/Code.gs`を新設した。これは統合`gas/Code.gs`へ追加するファイルではなく、**別個の試験専用GASプロジェクトへ単独配置する想定**。公開関数は`doGet`と`trialReadOnlyItemList`の2つだけ。データアクセス・試験識別確認・HTML組み立てなどの内部ヘルパーはすべて末尾`_`。編集・スキーマ初期化・外部POST関数は同梱しない。

動作と安全条件：`SPREADSHEET_ID===WRITE_TRIAL_SPREADSHEET_ID`、`ENABLE_EXPERIMENTAL_WRITES!==true`、家庭1件の専用マーカーと紐付くユーザー1件を毎回確認。取得対象は該当する試験家庭の日用品（名前・カテゴリ・在庫状態）のみで非表示・削除済みを除外。商品・店舗は件数のみ。DOMへの挿入は`textContent`、トークンや家庭IDを画面に戻さない。固定5カテゴリの整合、500件上限をチェックする。オフラインテスト`tests/gas-trial-readonly-bundle.mjs`をCI登録した。

**重要な留保**：この試験版は「アクセスできるユーザー＝自分のみ」の単独利用を前提とする。Google IDトークンを使った家庭別認可や複数家庭のサービスではない。これをそのまま一般向けにデプロイすることは禁止。現在動いている試験用Webアプリの公開範囲を広げないこと。現行の試験用GASコード・家庭用GAS・`main`はこのコミットで変更していない。

参考：Google Apps Script公式「HTML Service: Communicate with Server Functions」（Private functions章） https://developers.google.com/apps-script/guides/html/communication

## 2026-10-26：認証付きHTTPS試作をコード化（未デプロイ）

既存GitHub Pages PWAをそのまま残せる候補Bのために`backend/`を追加。詳細なデプロイ前提は`backend/README.md`に記載。`readonly-contract.mjs`でOriginの完全一致検査、POST `/v1/bootstrap`のみ許可、Google署名検証済みclaimsと`users.auth_subject`の一意照合、家庭別の行フィルタリング、Sheetsヘッダー検証、家庭別sequence_no計算を行う。HTTPレスポンスはno-store。書込ルートは存在しない。

`server.mjs`はNode.jsでGoogle公式`google-auth-library`によるIDトークン検証、Google Sheets APIは実行環境のADC + 読取スコープを使用。起動には`TRIAL_BACKEND_ENABLED=true`など明示的な試験環境変数が必要で、現時点でGoogle Cloud/試験用シート/稼働中GASには一切接続していない。`pwa-readonly-client.js`は別ファイルのオプトイン案で、現行PWAの`index.html`には読み込ませていない。

`tests/backend-readonly-contract.mjs`と`tests/backend-pwa-client.mjs`をオフラインCIに追加。メインのバックエンド契約を模擬実行して、本人の家庭のみ返す・他家庭を除外・異なるOriginを拒否・登録更新ルートを拒否・家庭別同期番号が保持されることを確認。クライアントも模擬実行して、書込拒否とAuthorizationヘッダーへのトークン送信を確認した。**実Cloud Runでの動作、Google SDK依存関係のインストール、CI全体の成功は未検証**。

次の評価軸：Google Cloudアカウント/費用・サービスアカウント共有・デプロイ作業量、認証付きクロスオリジン通信、PWAオフライン・同期、スマホでの通信品質。これらが満たされるまで普段使いの家庭データに接続しない。

### 試験用バックエンドへの追加フェイルクローズ
- `backend/server.mjs`は実シート読込直後に`assertIsolatedTrialTables()`を実行。試験専用マーカー付き家庭1件・ユーザー1件に該当しなければ応答せず503。誤って通常の家庭シートを環境変数に設定しても、実データを画面へ返さない。
- 多家庭対応の認証分離ロジックは独立した純粋関数でモックテストし、**実際の試験デプロイは1家庭専用**のままとする。Cloud Run実デプロイ・SDK動作は未実施。

## 2026-10-26：費用・セキュリティ監査の結論（暫定）

Google公式料金表を確認。Cloud Runリクエストベースの無料枠は月200万リクエスト/180,000 vCPU秒/360,000 GiB秒（us-central1基準）。**無料の保証はなく**、関連サービス/リージョン/インスタンス数の影響がある。Sheets API読取は通常1プロジェクト毎分300回・1ユーザー毎分60回、`batchGet`を含め要監視。

さらに、Cloud RunのIAM Invoker認証とアプリ向けGoogle IDトークンは別。通常のブラウザをサービスに直接アクセスさせるにはCloud Runの公開設定が必要になり得るため、JWTの検証・家庭照合・コスト防止を含めた運用設計が不可欠。`Origin`照合だけで認証したことにはならない。

`backend/readonly-contract.mjs`はOriginをURLとして厳密検証するよう修正。試験専用シートマーカーがあっても異なる家庭の`item_groups`/`products`/`stores`/`change_log`行が混ざっていれば`TRIAL_NOT_ISOLATED`として全応答を拒否。`tests/backend-readonly-contract.mjs`に、混入と不正Originの回帰試験を追加。

**現段階はCloud Runをデプロイしない。** 独立Cloudプロジェクト・試験用シート・サービスアカウントの閲覧権限・課金通知・インスタンス制限・テスト終了時の停止手順を整えてから判断。これらが揃うまでは、検証済みのGAS HTML Serviceを試験用途に限定し、既存iPhone PWAは現状維持する。詳しくは`backend/README.md`。

## 2026-10-26：ユーザー指定の最優先条件を反映

**意思決定基準の優先順位：①追加料金なし（継続利用で無料）、②UI操作への即時反応。** 開発の簡単さや既存GitHub Pages PWAの配布方式維持は、その後に評価する。

- Cloud Run＋Sheets API案は、無料枠を超えたときの従量課金と運用負担があるため、**採用第一候補から外す**。試作ファイル`backend/`は比較・検証資料として残し、デプロイしない。
- 第一候補はGoogle Apps Script＋Google Sheetsで、HTML Service内から`google.script.run`を呼ぶ構成。試験専用GASで読み書きと画面表示が成功済み。ただしHTML Serviceはiframeサンドボックス制約があり、従来PWAのService Worker/オフライン利用をそのまま維持できるかは未確認。
- UIは**optimistic UI（先に画面反映し非同期保存）**を採用候補とする。保存中の小表示、成功時確定、失敗/競合時に未確定表示と明示再送または復元を行う。保存成功前にサーバー確定済みと表示しない。端末を閉じても未確定操作を失わないようジャーナル設計を継続。
- GASにも日次クォータ・実行時間・同時実行制限があるため、無料で無制限に使えるとの保証はしない。個人・家庭利用の想定件数、通信回数削減、行データのまとめ読み・差分更新を検討。
- 優先順位に従い、今後は**GAS HTML Serviceを使った実UI即時反応試験**を先行する。別クラウドに課金設定は行わない。一般家庭向け認証・公開関数アクセス権と既存UI移行は安全性検証後に決定する。

Google公式参考：
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/apps-script/guides/html/restrictions

## 2026-10-26：当初仕様をできる限り維持する方針での実装（無料→即時反応）

ユーザー承認により、通信経路の変更を必要最小限とし、①無料での継続利用、②画面操作への即時反応を最優先とする。

**検証の読み替えに注意**：
- `gas/TRANSPORT_DESIGN.md`には2026-10-25のChromeのGAS接続試験で`カテゴリ5件`を受信した記録がある。その後の**別の試験用GAS（アクセス範囲「自分のみ」）**へのGitHub Pagesからの直接アクセスがCORS/ネットワークエラーだった。
- 異なるデプロイ設定とエンドポイントの結果を同等扱いしない。直接POST経路が「必ず通る」とも「全設定で不可能」とも結論しない。ブラウザのネットワークログ、HTTPリダイレクト先・CORSレスポンス・Googleアカウント制限の影響を調査し、公開範囲を広げる前に認証上の安全性を評価する。
- ただしContentServiceが一時URLへリダイレクトする公式仕様は事実。API応答が読めない経路に業務書込を流さない。`no-cors`・JSONP・トークンのURL配置で迂回しない。

**UI即時反応の実装**：
- `gas/trial-readonly/Code.gs`の試験専用HTMLで、日用品の在庫表示をクリック直後に切り替える「端末内だけの操作感試験」を追加。通信を待たずに表示変更し、クリックハンドラから`google.script.run`や`fetch`は呼ばない。
- **シートには書き込まれない**ことを画面で明示し、再読み取り時にはサーバー確定値に戻る。今後の本物の保存では別途「未確定」「保存中」「確定」「競合／失敗」の区別、操作IDの永続化、手動での同一操作再送を必要とする。無条件に成功扱いしたり通信エラー時に勝手に再送しない。
- 既存の試験GASにこのコードを上書きせず、専用読み取りGASプロジェクトのみで使う想定。現在の試験用GAS・通常PWAは更新しない。純粋な操作感試験は実データ変更不要。
- HTML Serviceのiframe制約、PWAのService Worker/ホーム画面機能、Googleログイン・複数家庭認証の要件は残るため、**GAS内HTMLへの全面移行は未決定**。
- Cloud Runは追加費用と運用負担のリスクから当面の採用候補から下げ、`backend/`コードは未デプロイの比較資料として保留。外部課金・本番書込の有効化は行わない。

参考：
- https://developers.google.com/apps-script/guides/content
- https://developers.google.com/apps-script/guides/html/best-practices
- https://developers.google.com/apps-script/guides/html/communication

## 2026-10-26：追加費用なしの直接通信を切り分ける実機診断

`gas-trial-connection.html`へ **GET診断（トークン送信なし）**を追加。利用者が入力した試験GAS `/exec`へ、`mode:'cors'`、`credentials:'omit'`でGETを一度だけ送り、応答HTTPステータスがブラウザで読めるか調べる。通信先URLをlocalStorage/URLパラメータへ保存しない。従来のGoogleログイン付きPOSTの`bootstrap`は別ボタンとして維持。通常GASエンドポイントは引き続き入力禁止、書込機能も無効。

### テスト結果の解釈（誤った断定を避ける）

| GET（トークンなし） | POST（Google IDトークンあり） | 判定 |
|---|---|---|
| 応答を読めた | 読み取り成功 | この組合せでは直接読取の実績あり。ただし他端末や将来も保証するものではない |
| 応答を読めた | ネットワーク/CORSエラー | POST固有の通信・認証・リダイレクト経路の問題を調査。CORS原因と断定しない |
| 読めない | 読み取り成功 | GETだけが利用できない設定の可能性。POSTの成功を優先 |
| 読めない | ネットワーク/CORSエラー | Webアプリのログイン制限、ContentServiceリダイレクト、CORS、ネットワークのどれか、あるいは複合要因。**ブラウザUIだけでは特定不可** |
| どちらかタイムアウト | 不問 | 通信または実行遅延。権限変更による安易な回避をしない |

GAS Webアプリのアクセス設定は`MYSELF`（デプロイ者のみ）、`ANYONE`（ログイン済みユーザー）、`ANYONE_ANONYMOUS`（誰でも）などに分かれ、**ブラウザのGoogleログイン状態とApps Scriptのアクセス設定は別**。実機差はこの条件を先に比べる。<https://developers.google.com/apps-script/manifest/web-app-api-executable>

ContentServiceが`script.googleusercontent.com`へリダイレクトされることは公式仕様。ブラウザが応答の中身を読めない場合は、読み取りであっても本番PWAでの保存に直接利用しない。外部サーバー、課金契約、`no-cors`、JSONP、公開範囲拡大はこの検証ではしない。既存の試験用GAS・現行PWA・家庭用シートを変更せず、ページだけを開発ブランチへ追加する。

ユーザー操作の最小手順：開発ブランチの`gas-trial-connection.html`を表示、既存の試験用`/exec`を入力、**GET診断**→Googleログイン→**件数読み取り**。返答はGETの結果文とPOSTの結果文のみ（URLやトークンを共有しない）。

これによって直接通信の技術的成立性を調べる。**方式の最終採用はまだ決めず**、iPhoneホーム画面からの挙動・無料での継続利用・UI即時反応・安全な同期を合わせて評価する。
