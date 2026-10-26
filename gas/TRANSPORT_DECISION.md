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
