# くらしストック｜データモデル（命名整理・試作作業ブランチ）

> **開発中の仕様**。この文書は `preview-v94-schema-names` の設計を説明する。従来の試作Sheets/GASへの反映は未完了であり、既存の試作PWAや本番に適用済みと判断しないこと。
> スキーマと列順の正本は `gas/Setup.gs` の `KURASHI_NEW_SCHEMA`。旧仕様はGit履歴で参照し、この文書に併記しない。

## 用語と役割

| 概念 | テーブル・列 | 意味 |
|---|---|---|
| 日用品 | `household_items`, `household_item_id` | 在庫・サブ情報・分類・表示順を持つ日用品。UIの「グループ」とは別 |
| 登録商品 | `products.product_id` | 商品マスタ。日用品への紐付けは `products.household_item_id`（任意） |
| 店舗チェーン | `retail_chains.chain_id` | コノミヤ、コーナン等。**支店名は保持しない** |
| OCR読み取り名辞書 | `receipt_name_mappings` | 店舗とOCR読み取り名の組。OCR原文は `ocr_name` |
| 自動照合先 | `receipt_name_mappings.auto_match_product_id` | 同じ店舗・読み取り名で次回購入した際の候補。履歴を書き換えない |
| 確定した購入商品 | `record_items.linked_product_id` | **その明細に紐付けた商品**。自動照合先とは独立 |
| OCR辞書への参照 | `record_items.receipt_name_id` | 元のレシート読み取り名を辞書から参照 |
| OCR以外の明細名 | `record_items.non_ocr_name` | 手入力や写真再構築時の印字明細名。OCR原文ではない |
| 生成AI候補 | `product_name_candidate`, `candidate_match_type` | 未確定の登録候補と `existing/new/空` の区分 |
| 明細小計 | `record_items.line_total_tax_included` | **購入数量分の税込合計**。1個単価ではない |
| 記録種別 | `records.record_type` | `receipt`（レシート）／`price_tag`（値札） |

## 11テーブル

`households`, `users`, `categories`, `retail_chains`,
`household_items`, `products`, `receipt_name_mappings`,
`records`, `record_items`, `change_log`, `processed_operations`。

## 重要な独立性

1. `record_items.linked_product_id` と `receipt_name_mappings.auto_match_product_id` は役割が異なる。前者は購入履歴の確定先、後者は将来の読み取り時の照合先。
2. `receipt_name_mappings.ocr_name` は印字／OCR原文であり、生成AI候補で上書きしない。正規化した `normalized_receipt_name` は重複検知・検索用。
3. `record_items.non_ocr_name` はOCR原文のない手入力または写真再構築用。`receipt_name_id` と排他的に使用する。
4. `product_name_candidate` は登録商品の確定情報ではない。`candidate_match_type` が `existing` / `new` でない候補は一括登録しない。
5. 価格比較は保存済みの `linked_product_id`、購入数量、税込明細合計、店舗、記録日から計算する。辞書の照合先が変わっても過去の価格を再分類しない。

## API・永続化境界

- 記録作成／更新の明細入力は `raw_name`、`linked_product_id`、`quantity`、`line_total_tax_included`。必要に応じて `non_ocr_name`、`product_name_candidate`、`candidate_match_type` を送る。
- `raw_name` は**API入力と端末の未送信キューにのみ存在**。Sheetsの `record_items` には保持せず、`receipt_name_mappings.ocr_name` と `receipt_name_id` へ整理する。
- 1明細の紐付けAPI `record.item.link` は `linked_product_id` を変更し、読み取り名の学習API `alias.link` は `auto_match_product_id` を変更する。
- `version`、`deleted_at`、`change_log`、`processed_operations` は端末間同期・競合回避・中断復旧に必要。
- `records.branch_name` は使用しないため削除。支店を店舗マスタに自動追加しない。

## 反映前の検証必須

同じ店舗・OCR名の紐付け変更と履歴の独立性、レシート保存・編集・削除・再送・未送信キュー復旧・価格比較・2端末間同期をテストする。**CI成功と、試作Sheets/GASの同期切替を両方確認するまで本番反映禁止。**
