# くらしストック｜データモデル v1.8（実装用契約・接続前）

更新：2026-10-18 ／ 対象：`stage-a-ui-handoff-review`

> **状態：本番Google Sheets・GAS API・家庭認証は未実装。** 現行UIのレシート／値札は端末内の試作記録と明示したサンプル。実家庭データには使わない。本書のうち未確定部分は勝手に自動確定しない。

## 1. 原則
- Google Sheetsを唯一の正本とし、更新は認証・家庭境界検証後のGAS APIのみ。画像を永続保存しない。
- 12シートとし、レシート・値札を `records` / `record_items` に共通化。値札専用シートや集計結果の正本列は作らない。
- `quantity` は**購入／販売個数**、`products.package_quantity` は**商品内容量**。混同しない。量り売りは実物OCR試験まで自動変換・集計対象にしない。
- 商品・チェーンの正式名称とOCR原表記を区別。商品マスタ・チェーンマスタを勝手に追加せず、利用者による確定を要する。
- `record_items.category_id=null` は **receiptでは家計簿未分類**、shelfでは家計簿対象外。カテゴリマスタは固定5つのまま。
- 値引き区分（discount_status）の列・通常／割引別集計は廃止。保存するのは値引き後の**確定税込明細額**。
- 商品未照合receiptは保存・家計簿算入可能。shelfは最安値目的のため価格対象にする前に商品特定を要する。税込額が不確実な明細は正式保存せず下書きに留める。

## 2. 12シート定義
| シート | 主キー | 主な列／参照／制約 |
| --- | --- | --- |
| households | household_id | display_name、管理情報、version、updated_at |
| users | user_id | household_id→households、display_name、auth_subject等の認証連携情報 |
| categories | category_id | name、fixed_order。固定5カテゴリのみ |
| stores | chain_id | household_idの扱いは認可設計で確定、canonical_name、normalized_name、aliases（確定済み別表記）。チェーン正本、支店行は置かない |
| item_groups | item_group_id | household_id、category_id、name、normalized_name、in_stock、sort_order、is_hidden、version、updated_at |
| products | product_id | household_id、item_group_id(nullable)、name、normalized_name、package_quantity(nullable)、package_unit(nullable)、item_group_order(nullable)、version、updated_at |
| product_aliases | alias_id | product_id→products、chain_id(nullable)→stores、normalized_alias、version、updated_at |
| records | record_id | household_id、record_type、chain_id、branch_name、raw_store_name、record_date、created_at、updated_at、version、deleted_at |
| record_items | record_item_id | record_id→records、line_order、raw_name、product_id(nullable)、quantity、amount_tax_included、category_id(nullable)、price_eligible、created_at、updated_at、version、deleted_at |
| change_log | change_id／sequence_no | household_id、entity_type、entity_id、action、sequence_no、occurred_at |
| processed_operations | household_id＋operation_id | result、processed_at、要求の整合性を検証する識別情報（詳細はAPI設計） |
| receipt_rules | rule_id | chain_id(nullable)、pattern、priority、enabled、version、updated_at。OCR試験後に残すか判断 |

- `item_favorites`／`price_observations`／`receipts`／`receipt_items`／`shelf_prices` はv1.8正本として作らない。
- `memo`／favorites／商品の無効化状態／永続比較数量／割引区分は追加しない。
- `products.item_group_id=null` なら `item_group_order=null`。登録中は家庭と日用品の組み合わせ単位で順序1,2,3,…、重複無し。先頭登録商品だけが日用品一覧の代表となる。
- `package_quantity` と `package_unit` は両方nullか両方設定。内容量不明でも販売単位価格の集計は可能だが、容量換算は不可。
- 表示中の日用品名の正規化重複を家庭内で防止。同名の非表示日用品は既存のものを「リストに戻す」。同名の新規作成分岐は設けない。商品は非表示日用品を復活させずに別の日用品へ紐づけ変更できる。
- 可変シートに必要なversion、created_at、updated_at、deleted_atの統一範囲、チェーンマスタの家庭別／共有スコープは、実GAS APIの権限設計で確定する。

## 3. records：共通ヘッダー
| 列 | 必須 | 制約 |
| --- | --- | --- |
| record_id | 必須 | 一意な不変ID（UUID等）。画像識別子ではない |
| household_id | 必須 | 認証された家庭との一致をサーバーで検証 |
| record_type | 必須 | `receipt` または `shelf`。保存後の変更は原則不可 |
| chain_id | 必須 | 確定済み `stores.chain_id` を参照 |
| branch_name | 任意 | 読み取った支店名。不明ならnull、別支店マスタ不要 |
| raw_store_name | 任意 | OCR記載の店舗原表記 |
| record_date | 必須 | `YYYY-MM-DD` の日本現地日付。receiptは購入日、shelfは値札確認日 |
| created_at / updated_at | 必須 | サーバー側日時。record_dateとは異なる |
| version | 必須 | 古いversionの書込拒否 |
| deleted_at | 任意 | 親の論理削除で配下全明細が集計対象外 |

`receipt_total` を正本保存しない。検算のための下書き情報は別に一時保持可能。

## 4. record_items：共通明細
| 列 | 必須 | 制約 |
| --- | --- | --- |
| record_item_id | 必須 | 一意な不変ID（UUID等） |
| record_id | 必須 | 既存の同家庭のrecords行を参照 |
| line_order | 必須 | 同record内で重複しない正整数 |
| raw_name | 任意 | OCR／手入力の原表記。履歴スナップショット |
| product_id | 任意 | 同家庭の商品ID。receipt未照合ならnull、shelfの価格集計前に確定 |
| quantity | 必須 | 正数の購入／販売個数。量り売りや重量の場合は対応確定まで自動価格集計に用いない |
| amount_tax_included | 正式保存では必須 | 明細全体の**値引き後税込金額**。不確実な場合は下書きへ |
| category_id | receiptはnull可 | 固定5カテゴリIDかnull（未分類）。shelfは必ずnull |
| price_eligible | 必須 | 価格に使える確定税込額・数量・商品・販売条件を満たす場合true |
| created_at / updated_at | 必須 | 変更日時 |
| version | 必須 | 明細の競合検知 |
| deleted_at | 任意 | 明細個別の論理削除 |

- `price_eligible=false` のreceiptも税込金額が確定していれば**家計簿の対象**となる。
- `product_id` 未確定receiptは価格比較対象外だが家計簿には含める。
- 値札の「2個300円」は条件が明確ならquantity=2、amount=300。複雑な条件・クーポン・曖昧な税込額は推測しない。
- 商品ごとの値引き後税込額を確定できないレシート全体クーポン等を勝手に商品へ配賦しない。

## 5. 価格集計・家計簿
- 有効な親と明細を `record_id` で結合し、両方の `deleted_at` がnullであることを確認。
- **価格候補**：record_typeはreceipt/shelf両方、product_id確定、chain_id確定、price_eligible=true、quantity>0、amount_tax_included確定、対象期間内のrecord_date。
- **税込1販売単位価格** = amount_tax_included / quantity。最安判定の途中で丸めない。最安元行の店舗・日付を同じ行から取る。
- **集計キー**：商品×チェーン×期間。期間は3か月／1年、初期値1年。過去記録は削除せず、期間外への無断フォールバックもしない。
- 日用品一覧は先頭登録商品の**直近1年の全チェーン中の最安値＋チェーン名**を表示。比較画面の期間とは独立。
- **換算**：商品内容量に基づき入力した数量・単位あたりへ換算。mL↔L、g↔kgと同一単位のみ。個数や容量を自動推測しない。
- **家計簿**：record_type=receiptのみ、月＋record_items.category_idで集計。shelfは絶対に含めず、商品紐付け先変更によって過去カテゴリは変更しない。
- 金額の小数精度・端数表示・同額の元行選択・同日優先は本番用計算モジュールとAPI設計で確定する。UI試作では元金額と数量を保持し、最小選択前に単価を丸めない。

## 6. API・同期（本番未実装）
- 認証済みユーザー→家庭の参照をサーバーで解決し、リクエストの家庭IDを信用しない。
- GASでLockService、親子整合の全件事前検証、version競合判定、operation_id冪等処理、change_logの家庭別単調増加同期番号を実装。
- 親recordsと全明細の保存／更新／削除は**論理的に一操作**。Google Sheetsの複数行は自動ロールバックされないため、部分書込の検出・復旧・再送規則を設計する。
- 新しいチェーン・商品別名の重複はロック下で再照合。未知／曖昧なOCR照合は候補だけであり、勝手にチェーンを作らない。
- IndexedDBは将来の表示キャッシュ・送信待ち操作・OCR下書きに使用。PWAを閉じた後のバックグラウンド同期は保証しない。

## 7. 試作コードとの契約・未接続範囲
- `app.js` には `demoRecords`、`demoRecordItems` の**架空のレシート／値札サンプル**を置き、`recordJoin()`、`priceCandidates()`、`chainMinima()`、`budgetTotals()` を使用。
- 手入力は `household_pwa_records_preview_v1` にのみ端末保存。現時点では**1回1明細、販売個数は正整数、税込金額は整数円**の試作制限。OCR・画像・複数明細編集・変更／削除・GAS・Sheets・家庭認証・夫婦間同期は未実装。
- 実際のデータ移行は原則不要（リポジトリには本番Sheetsがない）。リポジトリ外に旧Sheets／GASがある場合は事前バックアップ・件数／金額の検算・移行マッピングを必要とする。
- 値札とレシートは表示・保存対象を区別するが、価格比較は両方を使用。画面の「サンプル／この端末」表示を実データと誤認させない。

## 8. 保留事項
- 重量可変・量り売り、2個条件、複雑なクーポン、税別OCRの金額確定規則（実レシート試験後）。
- チェーンマスタの家庭別スコープ、確定済み別名の一意性／競合解消、API外形・認証手段、同額タイ・小数表示・バックエンドの部分失敗からの復旧方式。
- `receipt_rules` の存続はOCR試験後に判断。`store_aliases` 専用シートは現時点では作らない。
