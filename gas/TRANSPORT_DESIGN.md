# GitHub Pages PWA ↔ GAS 通信方式（接続前設計）
更新: 2026-10-24 / 対象: テスト環境のみ

## 制約の確認
- Google Apps Script ContentService は返答を `script.googleusercontent.com` の一時URLへリダイレクトする。公式資料: https://developers.google.com/apps-script/guides/content
- `text/plain` POST はプリフライトを避けられることがあるが、**CORSを回避してレスポンスを読める保証はない**。ブラウザとiPhone Safari/PWAで実測する必要がある。
- `mode:'no-cors'` は応答がopaqueとなり、bootstrapのデータ・同期結果が読めないため不採用。
- JSONPはトークンと家庭データが漏れる可能性があるため不採用。Google ID token をクエリ文字列・履歴・ログに入れない。
- PWAはGitHub Pagesの静的サイト。GitHub Pages内に秘密鍵やCORS用サーバを置けない。
- GAS Webアプリの実行主体とアクセス権設定はデプロイ時に検証する。誰でも呼べる公開エンドポイントであっても、各POSTをGoogle ID tokenで検証し、users/householdsを認可する。

## 接続の順番（安全な読み取りから）
1. **ローカル検証**: モックでtoken検証、家庭別アクセス、空行位置、エラー契約を確認する。実Google通信ではない。
2. **GAS一括反映**: コードをまとめてテストプロジェクトへ反映。Script Properties維持、Google CloudとGASのスクリプトIDを混同しない。現行コードは先にバックアップ。
3. **GAS読取確認**: エディタ内の `testCategoriesReadOnly` を実行。結果5件が確認できること。
4. **GAS Webアプリをテスト公開**: 実行主体・アクセス権を決め、ブラウザ上で匿名読取が拒否されることを確認。利用者の `auth_subject` はログに出さず管理者が登録。
5. **通信方式選定**: GitHub Pagesから `bootstrap` をトークン付き `text/plain` POSTし、iPhone Safariで結果が読めるかテスト。CORSでブロックされたら**直接fetchを継続しない**。
6. **必要なら同一オリジン中継**: 認証されたリクエストのみGASへ送る別途ホストのHTTPS中継を採用。中継はトークンをURL/ログに残さず、タイムアウト、サイズ制限、CORS許可オリジン制限、認証検証を行う。管理する秘密情報と運用コストの確認前に導入しない。
7. **最終段階**: 書込み有効化前に operation_id 冪等性、重複・部分失敗の復旧、家庭境界、オフライン同期を検証する。

## 採用前に避けるもの
- Googleログイン画面が出たことだけをもって家庭認可成功とみなさない。
- Googleトークンを localStorage, URL, GitHubリポジトリ, GitHub Actionsのログに保存しない。
- 家庭間のデータ漏えいを招く固定ID・共通トークン・tokeninfoスキップを導入しない。
- GAS `ENABLE_EXPERIMENTAL_WRITES` は無効のまま。レシート・商品登録は公開APIへ送らない。
- Google Sheets実データが接続済みであるかのような表示はしない。

## 現在の実装状況
v50で独立した `gas-api.js` をプレビューの読み込み対象へ追加。`KurashiGasApi.configure(url)` で明示的に検証済みのGAS URLだけを設定し、`request('bootstrap'|'sync')` の読み取り操作のみ許可する。初期値は未設定で、アプリ本体からの呼び出しもまだないため**通信は一切発生しない**。テスト `tests/gas-transport.mjs` をCIに追加。GASは未デプロイ・未反映、実機CORSと通信方式は未検証。
