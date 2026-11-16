# くらしストック｜本番 v0.88.11 → v0.94.5 スキーマ移行設計（実データ検証前）

> **対象：既存本番GASと既存本番Sheets。未承認・未実行。** この文書は計画のみ。試作GAS/Sheets、`main`、本番GAS、GASプロパティ、Sheetsは変更しない。
>
> 本番ユーザーは2026-11-16に既存の本番Sheetsのコピーを手動作成済み。コピーの実データ・元本との一致は未検証。v0.88.11で不要な端末未反映操作は利用者が取り消し済みと報告。ただし接続端末すべてのキューがゼロかは未確認。

## 絶対条件

1. `setupNewWorkbook()` を本番環境で実行しない。新しいGAS/Sheetsを本番接続先にしない。
2. `main` と既存本番GASを事前に変更しない。試作専用 `gas-deploy-new.yml`、試作向け切替関数（`kurashiTrial*`）を**本番実行しない**。
3. 本番の `SPREADSHEET_ID`、`KURASHI_NEW_WORKBOOK_ID`、`KURASHI_SCHEMA_VERSION`、既存 /exec、GitHub本番接続変数、IndexedDB名を保持。
4. データ内容・件数・参照関係を保持。元列を消す可能性がある場合は、検証済みバックアップで原データを復元できることを確認。値札・レシート・商品・在庫・マスタ・`change_log`・`processed_operations` を無断削除しない。
5. スキーマを **本番旧GASが書けない状態にしてから** データ変更し、新GASと新PWAの起動順を調整する。改変途中で旧PWAによる書込みができる状態を作らない。
6. デバイスの未送信操作ゼロを全端末で確認し、移行期間中はアプリを使用しない。
7. 12シート・見出し・カテゴリ・全件数・外部参照・操作履歴を実データで読取検証するまでは実行禁止。
8. プレビューが成功していても本番GAS API動作・IndexedDBを自動的には保証しない。Webアプリ公開後に read/write とレシート/値札履歴を照合。

## 既知のシート構造

**旧**：`households`, `users`, `categories`, `stores`, `item_groups`, `products`, `product_aliases`, `records`, `record_items`, `change_log`, `processed_operations`, `receipt_rules`。

**新**：`households`, `users`, `categories`, `retail_chains`, `household_items`, `products`, `receipt_name_mappings`, `records`, `record_items`, `change_log`, `processed_operations`。

旧の列並びは `main:gas/Setup.gs`、新の列並びは `preview-v94-schema-names:gas/Setup.gs` を正とする。途中の試作向け18列構造を本番の16列 `record_items` に適用しない。

### 同一性を保つ単純な名前変更

| 旧 | 新 | 維持する内容 |
|---|---|---|
| `stores` | `retail_chains` | `chain_id`、全行、7列 |
| `item_groups` | `household_items` | `item_group_id → household_item_id`、既存12列＋末尾 `sub_name`（新規は空） |
| `products` | `products` | `item_group_id → household_item_id`、`item_group_order → household_item_order`、全ID・数量 |
| `product_aliases` | `receipt_name_mappings` | `alias_id → receipt_name_id`、`product_id → auto_match_product_id`、`normalized_alias → normalized_receipt_name`、`ocr_name`、全ID |
| `records` | `records` | `record_id`、`household_id`、`chain_id`、日時、`version`、`deleted_at` |
| `record_items` | `record_items` | `product_id → linked_product_id`、`amount_tax_included → line_total_tax_included`、`alias_id → receipt_name_id`、`confirmed_name → non_ocr_name`、全IDと行順 |

### 要調査・条件付き変換

- `records.record_type`：旧GASの値札は `shelf`、新GASの値札は `price_tag`。実データの列挙後、**`shelf → price_tag`** が必要。未知の値では停止。
- `records.branch_name`, `records.raw_store_name`：新仕様には存在しない。非空の件数を確認し、移行先では再現できない値を検証済みバックアップで保存。削除を無条件にしない。
- `record_items.raw_name`：旧レシートOCR由来。可能な場合は既存 `alias_id → receipt_name_id` を維持し、`alias_id` が空で `raw_name` が非空なら、`records.chain_id + OCR名の正規化` で既存辞書照合／新規辞書行生成を検討する。**同じチェーン・正規化名の重複がないこと、既存IDと紐付けが矛盾しないこと** を検証。無言で `non_ocr_name` に流し込まない。
- `record_items.confirmed_name`：OCR以外の写真確認名。新 `non_ocr_name` に写す。ただし `receipt_name_id` との二重指定は調査して停止する。
- `record_items.inferred_name`：旧生成AI推定名。新版 `product_name_candidate` の意味と完全に一致するとは限らない。実データ・ユーザー期待を確認するまでは未確定。暫定的に元データをバックアップから復元可能に保つ。`candidate_match_type` を根拠なく `existing` / `new` にしない。
- `record_items.category_id` と `price_eligible`：新データモデルで廃止。価格集計の根拠となる `linked_product_id`、購入数、税込明細合計は維持。欠損・不整合を検査。
- `receipt_rules`：旧12番目のシート。データ行があれば停止。空でもバックアップに保存してからのみ削除。
- `categories`：ID 0～4の保持、ID 0名称 `飲食 → 食品・飲料`、順序変更、新ID 5 `調味料` を追加。日用品既存 `category_id` を勝手に再分類しない。
- `processed_operations`：行数・操作ID・結果JSONを改変しない。`prepared`、JSON不正、操作ID重複は停止。JSON内の旧名は将来再送・復旧時に影響するため、整合性を検証。
- `change_log`：全行・`sequence_no` を保全。連番、参照ID、最大番号を確認。履歴の追加・削除禁止。

## 調査で取得する情報（値を外部に書き出さず集計だけでも可）

- シート名12個、列名と順序、シート別データ件数
- 廃止列 `branch_name`/`raw_store_name`/`raw_name`/`inferred_name`/`category_id`/`price_eligible` の非空件数
- `records.record_type` の区分別件数、値札 `shelf` 件数
- `record_items` の `alias_id` なし・`raw_name` あり、`alias_id` と `confirmed_name` 同時非空件数
- 商品・店舗・レシート・明細・読み取り名の外部キー不整合件数、同チェーンOCR正規化名の重複件数
- `processed_operations` の `prepared`、JSON破損、重複操作ID件数
- `receipt_rules` の非空行数
- 固定カテゴリ値と商品/日用品の不正 `category_id` 件数

## 移行の承認・手順（未実装）

1. バックアップ（利用者作成）と元のシートが一致することを調査し、スキーマ・参照整合性を確認。
2. 旧GAS/PWAによる書込みを安全に止める具体的手段を確定。コピーで全変換を模擬実行し、行数・値・参照を照合。
3. **実データに一致した** 移行処理だけを用意し、対象本番GAS/Sheets ID確認と明示承認の二重ガードを設定する。試作用ワークフローは使わない。
4. 移行後は11シートの見出しと全行・ID・参照関係を検査。本番GASを既存のプロジェクト・既存のWebアプリへ更新し、APIの `bootstrap` を確認。
5. 本番フロントを v0.94.5 に更新。旧ローカルSnapshot移行・未送信操作・レシートと値札履歴・新規登録の挙動を確認。
6. どの段階で不整合が出ても安全に停止し、バックアップ復元手順と失われる可能性がある操作の扱いを決めてから継続。

**未検証**：バックアップの実内容、本番端末すべてのキュー、本番GASデプロイ対象ID・安全な停止経路、実物上でのデータ移行試験。
