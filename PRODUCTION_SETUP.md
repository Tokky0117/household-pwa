# くらしストック｜本番環境の運用・初回構築記録

2026-11-11 更新。2026-11-10の本番構築は完了済み。以下の初回構築手順は再構築時の参照用であり、既存本番Sheetにそのまま再実行しない。要件の正本は [CURRENT_REQUIREMENTS.md](CURRENT_REQUIREMENTS.md)。

## 1. 確定した運用構成

| 項目 | 開発・試験 | 本番 |
| --- | --- | --- |
| Gitブランチ | `preview-v46-clean-base` | **`main`** |
| PWA URL | `/household-pwa/previews/preview-v46-clean-base/` | **`/household-pwa/`** |
| Google Apps Script | 既存の試験用GAS | **新規・独立したGAS** |
| Google Sheets | 既存の試験用12シート | **新規・独立した12シート** |
| IndexedDB | `kurashi-stock-operations-v1` | `kurashi-stock-operations-production-v1` |
| SWキャッシュ | プレビューのパスにスコープ固定 | ルートパスにスコープ固定 |
| 認証 | `temporary-household` | **同じく `temporary-household`**（ユーザー指定） |

- **`production-v1` は使わない**。旧コミットがGitHub上に残っていても公開・移行経路に含めない。
- コードの機能・UIは検証済みの開発版を `main` に移す。本番専用に作り直さない。
- **現在の`main`は本番v0.88.10として稼働中**。試作v0.89.0の変更は実機確認と承認まで`main`へ反映しない。
- 新しい本番構成への切替は、既存の試験GAS/Sheetsに一切書き込まずに行う。

## 2. 本番用GAS・Sheetを最初の1回だけ作成

この工程は2026-11-10に完了。既存本番用GAS・Sheetsを再作成しないこと。

1. `https://script.google.com/home/projects/create` で、**既存の試験用とは別の**Apps Scriptプロジェクトを新規作成する。
2. 開発版GitHubの `gas/Setup.gs` と `gas/Api.gs` の現行コードをその新プロジェクトに配置する。試験GASには貼り付けない。
3. 新プロジェクトで `setupNewWorkbook()` を実行する。専用のGoogle Sheetsを作り、**家庭1件、12シート**を確認する。初回構築当時は固定カテゴリ5件、現在の試作スキーマで新規作成すると6件となる。サンプル商品・レシートは入れない。
4. 新GASプロジェクトのスクリプトプロパティで `SPREADSHEET_ID` と `KURASHI_NEW_WORKBOOK_ID` が**同じ新Sheets**を指すことを確認する。既存試験ブックIDなら中止。再実行時も同じブックを再利用する設計。
5. `gas/Api.gs` の認証モードを `temporary-household` のままにする。GASをWebアプリとして「自分として実行」「アクセスできるユーザー：全員」で新規デプロイする。
6. **新GASの /exec URL** を控える。これは公開用アプリに組み込む接続先であり、GASのスクリプトIDやGoogle Sheets IDとは別物。

**アクセス上の制約**：認証省略方式ではGAS URLを知る者に読み書き権限がある。URLの秘密性は認証ではない。実個人情報の取り扱いに注意する。

**重要**：`.github/workflows/gas-deploy-new.yml` は既存試験用GAS専用。本番GASのスクリプトIDを試験用のGitHub変数・Secretsへ上書きしない。

## 3. 本番の接続設定

1. GitHubリポジトリの `Settings → Secrets and variables → Actions → Variables` で `KURASHI_PRODUCTION_GAS_EXEC` に**新GASの /exec URL**を登録する。
2. `scripts/build-production.mjs` は、本番のGASが未指定・不正な形式・既知の試験用GAS URLと一致する場合に試験GASへの接続を許可しない。
3. 同ビルドは `live-client.js` を本番専用のGAS URL／IndexedDB名／旧試験端末の移行禁止設定へ変換する。開発版のソースは変更しない。
4. 端末内データはURLのパスだけでは分離されないため、**本番用DB名の分離**が必須。既存プレビューの未送信キューを本番へ移さない。

## 4. 初回のmain移行・公開（実施済み）

1. 開発版の全自動テスト・Pages公開が成功し、同じレシートに対する2端末の競合編集・削除が勝手に上書きされないことを確認する。
2. 既存 `main` には開発版と独立したコミットがある。既存mainの履歴を無理に強制上書きせず、差分を確認して検証済みの開発版を `main` へ統合する。
3. `.github/workflows/pages-previews.yml` は `main` のファイルを配信ルートへコピーし、独立した本番GAS接続を組み込む。**`/production/` は作成しない**。
4. 本番GAS URLの登録が確認できないときは新 `main` の公開を失敗として停止し、既存試験GASへの自動接続はしない。
5. GitHub Actionsの成功と `https://tokky0117.github.io/household-pwa/` の配信を確認する。

## 5. 最小の実機受入

- 本番と試験プレビューで、元の試験用日用品・履歴が本番に表示されない。
- 日用品を本番で1件作り、在庫を連続切替。端末内に保存後、専用Sheetsへ反映される。
- 電波を切って操作 → 再起動 → 復帰で操作キューを再送できる。
- 別の端末で初回登録した日用品・商品・レシートが参照できる。OCRの自動取込、手入力、レシート編集を1回ずつ確認する。
- 同時レシート編集の競合は新しい正本を消さずに保留し、保留内容をコピー・取り消して同期を再開できる。
- 本番Sheetはバックアップ用にコピー／エクスポートを継続する。元の `processed_operations` や `change_log` の行を手作業で削除しない。

## 6. 現在の完了／未完了

**実施済み（2026-11-10）**：独立した本番GAS・Sheets作成と接続設定、`KURASHI_PRODUCTION_GAS_EXEC` 登録、本番`main` v0.88.10公開、端末での登録・在庫操作と通信復帰後の同期確認。試験用との保存先分離を維持する。

**未実機受入**：オフライン操作後にPWAを完全終了してから再起動・再接続するKS-001、および異なる2端末が同一レシートを競合編集／削除するKS-002。模擬自動テストの合格を本番実機合格とはみなさない。

**次回リリース**：開発`preview-v46-clean-base`のv0.89.0は確認中。試作スキーマの6カテゴリと`sub_name`列は、承認後に本番へ非破壊で導入する。既存本番Sheetの初期化や試作データの流入を行わない。
