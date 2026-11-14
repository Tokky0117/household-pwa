# くらしストック｜試作環境のレシートDB簡素化反映手順

更新日：2026-11-14

## 状態と対象

- 対象：`preview-v46-clean-base` が接続する **試作Google Sheets / 試作GASのみ**。
- GitHubの試作コードは簡素化スキーマに対応。**試作Sheetsの実列変更・GASの公開版更新は未実施**。完了したと扱わない。
- `main`、本番GAS、本番Google Sheetsは変更禁止。
- 試作GASデプロイは `.github/workflows/gas-deploy-new.yml` の **手動実行（workflow_dispatch）のみ**。変更前には稼働先とスキーマを確認する。
- レシート関連の過去の明細移行は不要。一方、日用品 `item_groups`、`products`、`stores`、`product_aliases`、`categories`、`households`、`users`、`change_log`、`processed_operations` のデータは破棄しない。

## 作業前の安全確認（必須）

1. GitHub試作ブランチの最新プレビューCIが成功していることを確認する。
2. 試作アプリを利用する端末の **未送信操作キューが0件** であることを確認する。未送信の旧レシート操作をこのタイミングで再送しない。
3. **対象のスプレッドシートが試作環境のものであること**、既存の試作GASの接続先と一致することを確認する。名称のみで判別せず、GASの `SPREADSHEET_ID` と一致させる。**本番のシートに触れない。**
4. 念のため対象試作シートをコピーし、日用品・商品・店舗・別名・同期履歴を含む全行を退避してから、列削除を実行する。退避先を本番接続に設定しない。
5. 切替中の書込を止める。試作GASデプロイとSheets列変更の間に保存・同期のリクエストを流さない。

## 試作Sheets変更内容

以下の列は、実際にSheets側で**列ごと削除**する（セルの値だけ消さない）。すべてレシート関連の列である。

| シート | 削除列 | 旧位置 |
| --- | --- | --- |
| `record_items` | `inferred_name` | P（16列目） |
| `record_items` | `price_eligible` | I（9列目） |
| `record_items` | `category_id` | H（8列目） |
| `record_items` | `raw_name` | D（4列目） |
| `records` | `raw_store_name` | F（6列目） |

`record_items` の削除は **P → I → H → D** の順序で行う。列ずれを防ぐため、毎回ヘッダー名を目視で確認する。最後に **`receipt_rules` シートのみ削除**し、残りは11シートとなる。旧レシート行は移行不要なので、必要なら試作の `records` と `record_items` のデータ行だけを先に削除してよい。**日用品・商品・店舗・OCR別名のシートは消さない。**

期待するヘッダー（順番も一致させる）：

`records`:
```text
record_id, household_id, record_type, chain_id, branch_name, record_date, created_at, updated_at, version, deleted_at
```

`record_items`:
```text
record_item_id, record_id, line_order, product_id, quantity, amount_tax_included, created_at, updated_at, version, deleted_at, alias_id, confirmed_name, suggested_product_name, suggestion_kind
```

`product_aliases` は変更しない。OCR原文は `ocr_name`、正規化文字列は `normalized_alias` に置く。OCR名の入力API `raw_name` は残るが、`record_items` の保存列としては存在しない。

## 試作GASデプロイと動作確認

1. Sheetsの11シートとヘッダーを照合する。残すテーブルの既存行数を確認し、マスタの消失がないことを確認する。
2. GitHub Actions の **Deploy only the NEW Kurashi GAS** を `preview-v46-clean-base` から手動実行する。接続先が試作GASであることを再確認する。これはユーザーの承認・操作を要する工程。
3. ActionsでGASデプロイが完了したことを確認する。失敗時はデプロイ完了と扱わない。手動実行を行わずに `setupNewWorkbook()` を試作既存環境で再実行してはいけない。
4. 試作アプリを再読込し、`bootstrap` の11シート取得、日用品・商品・店舗の既存データ、レシート作成・編集・削除、OCR原文→別名辞書、未判定候補の一括登録除外、商品紐付け、オフライン再送、価格比較を確認する。
5. 正常確認後、プレビューCIと実機でそれぞれ結果を記録する。本番移行は別途ユーザーの明示的承認が必要。

## 破損・不一致時の扱い

GASの旧版が新列定義のSheetsにアクセスすると、誤読・保存エラーの恐れがある。**デプロイが失敗したら操作を続けない**。旧版に戻す場合は対応した旧スキーマの試作シートとコードの組合せへ戻す。旧版GASと新スキーマのまま運用再開しない。

既存レシートデータ移行の必要がないことは、日用品・商品・店舗等の登録データを初期化してよいという意味ではない。
