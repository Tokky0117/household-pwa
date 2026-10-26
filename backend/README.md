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
4. `POST /v1/bootstrap`をブラウザから`Authorization: Bearer <IDトークン>`で呼ぶ。署名・issuer・audience・expiry・`users.auth_subject`・家庭の存在と一意性をサーバーで確認。GitHub Pages以外のOriginを拒否。CORSは認証の代替ではない。
5. レスポンスはアプリの`bootstrap`形状のみ。Google Sheetsの全行をフロントへ返さない。保存系のルートは実装していない。

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
