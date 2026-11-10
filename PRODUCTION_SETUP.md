# くらしストック｜本番環境セットアップと受入（2026-11-10）

## 0. 現在の状態

- 開発環境：`preview-v46-clean-base`、既存の試験用GAS/Sheetを変更せず継続。
- 本番用ソース：`production-v1`（`main` は変更しない）。
- 固定公開予定先：`https://tokky0117.github.io/household-pwa/production/`。
- GitHub Pagesのビルドは `production-v1` のソースを `/production/` に配信する。
- 本番生成物は試験用GAS URLを許可せず、専用の `kurashi-stock-operations-production-v1` IndexedDBを使用する。旧試作localStorage操作・snapshotの自動取込は無効。
- **専用GAS/Sheetがまだ作成・接続されていない場合、保存先は空で起動し、試験用GASに接続しない（fail closed）。**
- 現段階の「本番URL配備」と「本番データの利用開始」は別の工程。データ受入前に実機検証する。

## 1. 本番の初期構築（試験用環境に影響させない）

1. **新しい独立したGASプロジェクト**を作成。既存の試験用GASは使用しない。
2. `production-v1` の `gas/Setup.gs` と `gas/Api.gs` をその新プロジェクトへ配置。旧試験用GASと取り違えない。
3. 新プロジェクトで `setupNewWorkbook()` を**初回だけ**実行。新しいGoogle Sheet（12シート）が生成されたことを確認する。
4. プロジェクトのScript Propertiesに `SPREADSHEET_ID`、`KURASHI_NEW_WORKBOOK_ID`、`KURASHI_SCHEMA_VERSION=1` が**同じ新ブック**を指すことを確認。旧試験ブックのIDは不可。
5. `KURASHI_AUTH_MODE='temporary-household'` を採用。Webアプリは「自分として実行」「アクセスできるユーザー：全員」。Googleログインを要求しない。URLの秘密性による認可はないことを理解する。
6. 新GASのWebアプリ `/exec` URLとGAS **スクリプトID（別物）** を控える。URLをGitHub公開ファイルやレシートに貼り付ける必要はない。

> 旧試験用の `gas-deploy-new.yml` は `preview-v46-clean-base` の旧試験用GAS専用。**本番用のスクリプトID／デプロイIDをこの設定に上書きしない**。

## 2. 本番フロントエンドの接続

1. GitHub リポジトリの Actions/Variables に **`KURASHI_PRODUCTION_GAS_EXEC`** を設定し、新GASの `https://script.google.com/macros/s/＜本番デプロイID＞/exec` を指定する。
2. 試験用URLと完全一致する値はビルドで拒否する。形式が不正なURLも拒否する。
3. `production-v1` のPagesワークフローを再実行する。ビルド時に本番URLが組み込まれる。
4. `/production/` を開き、試験用レシートや日用品が表示されていないこと、新Sheetsへ接続することを確認する。
5. 試験URL `/previews/preview-v46-clean-base/` との両方を開いても、端末内の未同期操作キューが相互移行されないことを確認する。

※ 本番用URL変数を設定しただけでは既存のGitHub Pages配信物は更新されない。Pagesワークフローの成功を必ず確認する。

## 3. 本番利用開始の受入条件

- 日用品の追加・在庫切替・2回連続操作が即時反映され、本番Sheetへ保存される。
- オフラインで操作し、アプリ再起動後に同じ操作IDで本番Sheetへ反映される。
- 異なる2端末で本番用日用品・商品・レシートの作成と読み込みが一致する。
- 同じ日用品を両端末が更新してもデータが二重作成されない。
- レシート写真→OCR→確認→保存、ChatGPT JSON取込、手入力、値札、下書き、編集を確認する。
- 購入数量全体の税込金額が二重計算されず、元OCR名と確定名が混同されない。
- **保存済みレシートの同時編集で、他端末が追加した明細を失わない**。現在の自動再調整方式はここが未受入のため、問題が解消するまでは同一レシートを同時編集しない。
- 認証省略の公開アクセスリスクを了承し、個人識別情報・決済情報・原写真を外部公開やGitHubへ置かない。

## 4. バックアップと復旧

- 本番Sheetは試験Sheetと別に管理する。新規構築で既存Sheetを初期化しない。
- 定期的に本番Sheetをコピー／エクスポートして保管し、復旧時には更新の差分を確認する。
- 保存失敗時にキューを端末から消さない。ブラウザーのサイトデータ消去、PWA再インストール、データ移行を行う前に未反映操作数を確認する。
- `processed_operations` と `change_log` の操作ID冪等性を保持し、安易な手作業での行削除・行番号変更をしない。

## 5. 作業停止条件

- 専用GASとSheetの実体・設定が確認できない。
- `KURASHI_PRODUCTION_GAS_EXEC` が試験用URLと一致する。
- 2端末で実データの上書き・消失が再現する。
- Pages/GASワークフローが失敗し、実際の配信版とソースの一致を検証できない。

いずれの場合も、試験用GAS/Sheetに自動切替したり、`main` を書き換えて回避しない。
