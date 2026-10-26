# 認証付きHTTPS読み取りAPIの試作（未デプロイ）

対象：`stage-a-ui-handoff-review`。これは**通信方式の比較・検証用**であり、家庭用データへの接続や本番利用は禁止。

## なぜ作ったか
- GitHub PagesからApps ScriptのContent Serviceを直接`fetch`した際にCORS/ネットワークエラーが発生した。
- 一方、GASのHTML Service内`google.script.run`なら実Google Sheetsの読み取りに成功したが、既存PWAとService Workerをそのまま動かす構成とは限らない。
- 既存PWAを維持する別案として、独立したHTTPSサーバーを経由する形をコードレベルで検証する。

## ファイル
- `readonly-contract.mjs`：純粋なHTTP契約。Googleログインの検証結果を前提として、家庭のユーザー登録を照合し`bootstrap`のみ返す。異なる家庭の行は返さない。列ヘッダーを検査。
- `server.mjs`：Cloud Run等を想定したNode 22サーバー。Google公式ライブラリでIDトークンの署名・audience・期限を検証。Sheets APIはADC/実行サービスアカウントと読み取り専用スコープだけを使用。
- `pwa-readonly-client.js`：開発用、既存PWAへ未接続。HTTPSの`/v1/bootstrap`のみ許可し、トークンをURLではなく`Authorization: Bearer`に送る。保存アクションは必ず拒否。
- `package.json`：試験サーバーの依存関係。`npm install`やデプロイは未実施。

## 事前に満たす必要があること（実行はまだしない）

1. **完全に独立した**Google Cloudの試験環境と、空またはダミーデータのみの試験用スプレッドシートを用意。既存の家庭用シートは絶対に共有しない。
2. 試験用Cloud Runの実行サービスアカウントに、**試験用スプレッドシートの閲覧権限のみ**を付与。サービスアカウント鍵JSONをGitHubへ入れない。ADCを使用する。
3. Cloud Runの環境変数を設定（すべて必須）。`TRIAL_BACKEND_ENABLED=true`、`GOOGLE_CLIENT_ID`（GitHub Pagesで利用するGoogleログインのaudience）、`ALLOWED_ORIGIN=https://tokky0117.github.io`、`READONLY_SPREADSHEET_ID`（独立試験シート）。
4. バックエンド自身も、読込先が **家庭1件（名前 `[KURASHI_WRITE_TRIAL_ONLY]`）・ユーザー1件**の試験専用シートであることを毎回検証する。通常家庭や複数家庭のシートは `TRIAL_NOT_ISOLATED` として拒否。複数家庭の分離ロジック自体はオフラインの模擬データで検証する。
5. `POST /v1/bootstrap`をブラウザから`Authorization: Bearer <IDトークン>`で呼ぶ。署名・issuer・audience・expiry・`users.auth_subject`・家庭の存在と一意性をサーバーで確認。GitHub Pages以外のOriginを拒否。CORSは認証の代替ではない。
6. レスポンスはアプリの`bootstrap`形状のみ。Google Sheetsの全行をフロントへ返さない。保存系のルートは実装していない。

## セキュリティ上の残課題

- 本番に進める場合：リクエスト量制限・APIコスト制御・サービス運用監視、家庭/ユーザー規模に応じたDB構造、バックエンド権限、シート読み取り遅延、ヘッダーの完全検査、エラーログの匿名化、セキュリティレビューが必要。
- ヘッダーが読めなくなった、利用者が未登録、JWTに不備があるなどのケースは**fail closed**。ユーザー向けの応答に生の個人情報やSheets内容を入れない。
- `sync` APIとすべての書込機能は未実装。**これを既存PWAへそのまま接続しても完全なオンライン動作や同期はできない**。
- ユーザーが自分のGoogleアカウントで同じ試験用シートにアクセスできることと、Cloud Runのサービスアカウントにアクセス権があることは別問題。
- `LIVE_WRITE_ENABLED=false`（従来PWA）、`ENABLE_EXPERIMENTAL_WRITES`未設定/false（GAS）を維持し、`main`と稼働中GASに変更を入れない。

## 参考
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- https://cloud.google.com/run/docs/authenticating/service-to-service
- https://developers.google.com/workspace/sheets/api/scopes

## 2026-10-26：Cloud Run費用・権限・運用の検証（公開・課金開始はしない）

- **費用**：Cloud Runリクエストベース課金の無料枠は月200万リクエスト、180,000 vCPU秒、360,000 GiB秒（us-central1料金を基準にした無料枠）。リージョン別料金、CPU/メモリ、Cloud Build/Artifact Registry/ログ/ネットワーク等が別途発生し得る。**「必ず無料」と判断しない**。試験実行前に料金計算と課金アラートを確認する。
- **Sheets API**：読み取りは1プロジェクト毎分300回、1ユーザー毎分60回が基本枠。`values.batchGet`は複数範囲でも1リクエストとしてカウントされるが、レスポンスデータ量・レイテンシは行数に比例し、各リクエストで全表を読む現在の設計はスケールしない。読み取り回数の制御・キャッシュ方針を検討する。ユーザー別データをキャッシュする場合は家庭間混在を防ぐこと。
- **Cloud Run認証の重要点**：Cloud RunのInvoker IAM認証とアプリのGoogleログイン用IDトークン検証は**別物**。ブラウザからログインIDトークンを送るだけでは、デフォルトで非公開のCloud Runサービスを呼べるとは限らない。外部から呼べるCloud Runサービスとして設定する場合、エンドポイント自体はインターネット上に公開され、アプリのJWT確認でデータアクセスを拒否する構造になる。**公開設定の承認、レート制限、Bot対策、費用抑制を導入するまでデプロイしない**。
- **安全枠**：将来テストするなら専用Cloudプロジェクト、請求先アラート、サービス単位の最大インスタンス制限（最初は少数）、最小インスタンス0、試験日後に削除する停止手順、専用サービスアカウント・試験シートだけ閲覧権限。最大インスタンス制限は瞬間的に超過し得るため**厳密な料金上限ではない**。
- **実装監査**：HTTPの`Origin`は通信元制御の一助であり、クライアント認証ではない。Bearerトークンをサーバーで署名検証した後に家庭照合する。本体は試験専用家庭名マーカーに加え、他家庭の行が混入していないか全対象テーブルをチェックし、混入時は応答停止。CORSは通信が可能になる必要条件であってアプリ認可の代替ではない。

参考：
- https://cloud.google.com/run/pricing
- https://docs.cloud.google.com/run/docs/authenticating/overview
- https://docs.cloud.google.com/run/docs/configuring/max-instances
- https://developers.google.com/workspace/sheets/api/limits

## 暫定判断

**現時点でCloud Runのデプロイは見送る。** 認証付きAPIの安全性検証を継続しつつ、個人・家庭で継続運用する場合の管理負担がGAS内画面案に見合うかを比較する。iPhoneの既存PWAを維持できるメリットと、別サーバーの費用/運用負担はトレードオフ。
