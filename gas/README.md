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
