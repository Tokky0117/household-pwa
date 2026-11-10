# くらしストック｜データモデル v1.8（正本契約・旧接続前資料）

## 現行データモデル：v0.70.0（2026-11-04／推測名・税込明細金額の補完）

- 明細名はOCR原文（`product_aliases.ocr_name`／旧`raw_name`）、ChatGPT推測名（`record_items.inferred_name`）、OCR名がない場合のみ使う確定名（`record_items.confirmed_name`）の3種。OCR原文と確定名の一方があればよく、商品IDは任意。
- ChatGPT推測名は正式な商品名ではなく商品登録画面の初期値に用いる。OCR名は変更せず、1対1で対応できる行は既存のOCR辞書へ登録・参照する。
- `kurashi-receipt-assist-1`の従来3キーのJSONも受け取り、追加の`quantity`と`amount`（税込明細**合計**）を任意で取り込む。写真で判別できない金額はnullとし、元OCR値もなければ空欄のまま利用者に入力を求める。印字合計からの推定配賦はしない。
- ユニクロのような全面再解析はOCR原文がないため、推測名と確定名を保存しOCR辞書へ登録しない。ChatGPT修正候補の採用・OCR解除の二つの旧ボタンは廃止する。
- 既存の`record_items`の末尾に`inferred_name`を1列追加し、従来列・レシート・OCR辞書は非破壊で維持する。

## 現行データモデル：v0.69.0（2026-11-04／OCR全面置き換え経路）

- OCRの写真商品行との対応が成立している場合は、`kurashi-receipt-assist-1`の`nameCandidate`だけ取り込み、元のOCR行のID・原文・行数を保持する。
- OCRの構造が崩れた場合は、別形式`kurashi-receipt-rebuild-1`で、写真から再解析した`items[{name,quantity,amount}]`、`receiptDate`、`storeName`、`receiptTotal`、`printedCount`を取り込む。元のOCR行は**下書き内で一括置き換え**し、元の`rowId`を使い回さない。置き換えはユーザー確認ダイアログで明示的に承認する。
- 再解析は**未検証の候補**。確認画面で全行の品名・数量・金額を修正でき、保存前に原写真との照合チェックを要求する。印字合計・印字点数と明細合計の不一致は従来どおり警告表示する。ChatGPTが商品形状や点数を誤る可能性があるため、AIの診断を正本とはしない。
- 再解析の品名はOCRで検出されていないため、虚偽の`ocr_name`を作成しない。確認後に既存の`record_items.confirmed_name`へ記録し、`alias_id`と`raw_name`は空欄とする。商品マスタ`product_id`は利用者が任意で紐付ける。OCR辞書には学習せず、新しいGAS・シート・列も作らない。
- `OCR診断`はJSONと区別し、今回のレシート領域・印字行数と明細抽出誤りを、後日のOCR改善議論で評価する。診断テキスト・画像・OCR全文はSheetsへ記録しない。

## 現行データモデル：v0.68.0（2026-11-04／写真確認名の追加）

### 写真から確認した購入明細とOCR名辞書の分離

- `record_items.confirmed_name` を末尾に1列追加する。OCRの明細構造が正しくない場合、ユーザーが写真で確認した商品名をここに保存する。 `alias_id` と `raw_name` は空にして、商品コード等の誤認識をOCR辞書へ学習させない。
- 写真確認名・数量・税込明細合計・購入日・店舗をレシートとして保存できる。商品マスタへの紐付けは任意。商品マスタを選択すれば価格比較の対象にもなる。
- OCRの行対応が正しい場合は従来の`product_aliases`参照を維持する。ChatGPTの`nameCandidate`は自動保存せず、ユーザーが写真と照合して明示的に採用した場合のみ写真確認済み明細名になる。
- GASの従来5項目の保存契約は維持する。`confirmed_name`を使用する行だけ6項目とし、OCR原表記`raw_name`との同時指定を拒否する。既存レシート・OCR辞書・操作ジャーナル・シートは初期化しない。


> この節が現行の実装契約です。以下のv1.8定義・接続前のステータス・家計簿要件は**旧設計履歴**であり、本節や `OPERATION_QUEUE.md` と矛盾する場合は採用しません。本番環境は未構築です。試作GASと試作Google Sheetsの接続は維持し、v0.65ではスキーマを変更しません。

| テーブル | 現行の責務 |
| --- | --- |
| `products` | 正式商品名・内容量・日用品リストへの任意参照 `item_group_id`。商品自体は削除しない |
| `product_aliases` | `alias_id`、`chain_id`、`normalized_alias`、元のOCR表記 `ocr_name`、任意の `product_id`。OCR表記文字列は登録後不変で、`alias.link` により商品参照を変更・解除可能 |
| `records` | レシート／値札共通ヘッダーとチェーン・日付 |
| `record_items` | `record_id`、`alias_id`、購入時に確定した `product_id`、`quantity`、`amount_tax_included`、従来互換の `raw_name`／`category_id` |
| `processed_operations`・`change_log` | GAS保存ジャーナル、重複防止・復旧・同期順序の管理。現状の家庭ID参照を維持 |

- `record_items.amount_tax_included` は**購入数量すべての税込明細合計**。価格比較は `amount_tax_included / quantity` を端数丸め前に比較し、内容量換算とは区別します。
- 新規明細は `record_items.alias_id` を指し、`raw_name` は空欄。既存明細の `raw_name` は変更せず、追加列 `alias_id` のみ補完。旧レシート表示は各行の元の `raw_name` を優先し、履歴上の金額・数量・商品IDは不変とします。
- `product_aliases.product_id` が空欄でもOCR名を登録可能です。過去の `record_items.product_id` は辞書の新しい紐付けに連動させません。
- ChatGPTの `nameCandidate` は**端末のレシート下書きに限る任意フィールド**。Sheetsには新たな列を設けません。類似表記は候補のみ、店舗内の正確な確定名は競合なしに限り自動選択します。
- `record_items.category_id` と固定5カテゴリは旧データ互換目的で残し、家計簿の入力・集計・タブは廃止します。日用品分類の5カテゴリは引き続き現行です。
- 既存Sheetsは **`product_aliases.ocr_name` と `record_items.alias_id` を末尾に1列ずつ追加**します。旧レシートの移行は非破壊・途中失敗の再実行を想定します。
- 家庭は1件ですが、`household_id` は認可・操作ID履歴・同期に依存するため、今回削除しません。将来、依存箇所をまとめて移行する宿題です。


## レシートv0.65.0データ契約（実装済み・実機未確認／2026-11-04）

- **保存対象の名称は二層のみ**：(1) 読み取り原表記 `product_aliases.ocr_name`（既存行は `record_items.raw_name`）、(2) ユーザーが確定した正式商品名 `products.name`。新たな「補正済み明細名」マスタ／シート／保存列は追加しない。OCR原表記は登録後不変で、商品IDへのリンクだけ `alias.link` で変更できる。
- レシート明細 `record_items.alias_id` はOCR名辞書を指し、`record_items.product_id` は購入確定時の商品IDを固定する。商品未照合なら `product_id` は空欄可。OCR原表記に誤認識があっても、その文字列を直接修正しない。利用者が新規追加した手入力行は元OCRがないものとして現行の明細保存契約を使用する。
- ChatGPTの `nameCandidate` は**正式商品名の提案に限る一時値**。OCR結果の行ID／原表記との照合を経てから下書き（IndexedDB）に保持できるが、`products`、`product_aliases`、`records`、`record_items` に保存しない。商品ID自動照合は**OCR原表記と確定済み辞書・商品マスタに対して先行**し、AI候補のみを根拠に自動紐付けしない。
- 数量が不明・不確定な行の `quantity=1` は**画面下書きの仮値**であり、黄色の注意状態は一時的なUIメタデータ。ユーザーが値を入力し直せば注意状態を解除し、変更しない場合はレシート保存操作をもって1個と確認したものとする。確定した数値だけ既存 `record_items.quantity` に保存し、黄色・確信度用のSheets列は追加しない。 `amount_tax_included` は数量全体の税込明細合計で、単価は `amount_tax_included / quantity`。
- 既存12シートの構成、レシート・値札の共通データ構造、非破壊移行、IndexedDB操作キューとGASの操作ID冪等性を維持する。OCRモデルやChatGPT補助の改善で保存スキーマを増やさない。

---

## 旧v1.8データモデル（以下は履歴）

> **実装状況更新（2026-11-02）**：旧「接続前」表記は履歴です。新GAS・新Sheetsへの日用品登録・更新は接続済み。試作 v0.52.0 ではIndexedDBに複数操作を永続保存するキュー方式へ変更しました。最新の実装契約は [操作キュー・同期設計](./OPERATION_QUEUE.md) を参照してください。商品作成・編集・日用品紐付けと日用品並び替えはv0.54.0までに接続済み。商品の並び替えもv0.55.0で接続済み。手入力のレシート・値札はv0.56.0で正式保存に接続済み。旧ラボで検証したPaddleOCRはv0.57.0で本流レシート確認画面へ移植。保存済み記録の編集・削除は未接続。家計簿タブの画面は現在「実装予定」の案内のみ（計算関数と保存データは保持）。

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
- 表示中の日用品名の正規化重複を家庭内で防止。同名の非表示日用品からの再表示／新規作成は別途既存仕様どおり確認する。
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

## v0.84.0 任意の明細名（既存列のみ）
- レシートの手入力明細は **`confirmed_name`（画面の「明細名（任意）」）を空欄にできる**。新しいメモ列や名称マスタは設けない。空欄時は `raw_name=''`、`confirmed_name` 未指定、`product_id=null` でも、数量が正の整数で税込小計が0以上の整数ならレシート行として保存可能。
- 登録商品を選んだ場合、名称が空欄でも `product_id` と金額で価格比較の対象になり得る。未照合かつ名称空欄の場合は `price_eligible=false` で購入記録に残し、商品マスタ・`product_aliases` には自動登録しない。
- 写真からの読み取り行（`ocr_name`/旧`raw_name`）と、写真再解析の確認前提名称は引き続き別の出所として扱う。OCR原文の上書きや読み取り名辞書への空文字登録は行わない。
- `record_items` シートの追加・変更、既存レシートの移行は不要。既存GASとオフラインキューの保存契約で空欄のレシート明細を受け付けることを回帰テストで保証する。
