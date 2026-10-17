# くらしストック — データ定義（実装前の確定基準）
版：1.0 ／ 2026-10-17 ／ 対象：試作用ブランチ
関連：[要件定義・基本設計書](./household_pwa_requirements_basic_design%281%29.md)

## 目的と原則
- **本番シートとAPIは未実装**。今後作る正本は旧版への互換のための不要列を持たない。
- 夫婦共有は家庭（household_id）単位。各可変行は一意のID、version、updated_atを持ち、同期はGAS／change_log／processed_operationsで整合性を守る。
- `memo`／`favorites`／`item_favorites`／商品無効化状態／チェーンお気に入りを作らない。価格の出典は表示で区別しないが、**データ上は必ず区別して保持**する。
- 明細の家計簿カテゴリは日用品の登録先とは別。商品の付け替えで履歴行は書き換えない。

## 13シート：設計列

| シート | 主キー・参照先 | 必須／主要な列（案） | 留意事項 |
|---|---|---|---|
| households | household_id | display_name, version, updated_at | 家庭境界 |
| users | user_id → households | household_id, display_name, auth_subject (後工程) | 最初は仮ユーザー |
| categories | category_id | name, fixed_order | 5カテゴリ固定、未分類は家計簿専用区分 |
| stores | store_id / chain_id | chain_id, chain_name, branch_name(nullable), household_id | チェーンと支店を区別。支店不明を許容。チェーンIDだけを持つ価格記録も可 |
| item_groups | item_group_id → households/categories | household_id, category_id, name, normalized_name, in_stock, list_order, is_hidden, version, updated_at | **memo／compare_quantity／compare_unit無し**。比較値と期間・モードは画面内の一時状態 |
| products | product_id → households/item_groups | household_id, item_group_id(nullable), **item_group_order(nullable)**, name, package_quantity(nullable), package_unit(nullable), version, updated_at | 登録先NULLなら順序NULL。容量の値と単位は両方NULLか両方設定。無効化無し |
| product_aliases | alias_id → products | product_id, normalized_alias, chain_id(nullable) | OCR照合用。曖昧一致を自動確定しない |
| receipts | receipt_id → households/stores | household_id, store_id(nullable), chain_id(nullable), purchased_on, version, updated_at | 家計簿用の購入実績。合計金額は正本保存しない |
| receipt_items | receipt_item_id → receipts/products/categories | receipt_id, product_id(nullable), raw_name, category_id, purchase_quantity, tax_included_total, discount_status, version, updated_at | 税込明細額÷購入数量が商品購入単位価格。未照合も購入明細として保持 |
| change_log | change_id → households | household_id, entity_type, entity_id, action, sequence_no, occurred_at | 差分同期 |
| processed_operations | operation_id → households | household_id, result, processed_at | 重複実行防止 |
| price_observations | observation_id → households/products/stores | household_id, product_id(nullable;確定時必須), store_id(nullable), chain_id(nullable), observed_on, tax_included_unit_price, discount_status, version, updated_at | **値札だけ保存**。家計簿対象外。商品未確定は要確認扱いで最安値不採用 |
| receipt_rules | rule_id | chain_id(nullable), pattern, priority, enabled, version, updated_at | OCR解析条件 |

この表は概念的な列定義であり、データ型・索引相当の検索戦略・GAS入出力の最終スキーマはAPI詳細設計時に確定する。13シートを増やさず最安値の計算用正本を重複保存しない。

## 順序：登録商品と日用品一覧
- 商品の手動順序は `products.item_group_order`。一家庭・一日用品内で **1,2,3,...** の重複なし連番を正本とする。
- 登録：登録先日用品の末尾へ。解除：`item_group_id = null` と `item_group_order = null`、残りを詰める。付け替え：元を詰め、先の末尾へ。長押し並び替え：対象日用品内全商品の順序を一括更新。
- **日用品一覧で最安値を示す商品は常に順序1番**。価格履歴がない商品でも2番目にフォールバックしない。通常・割引が欠けるならその欄は「—」。
- 商品順序の変更は最安値履歴を書き換えない。日用品一覧で表示する対象商品のみ変わる。

## 価格比較・集計
- 価格情報を開くたび：モード商品価格、期間直近3か月。**モードと期間を正本に保存しない**。
- 比較数量は空欄、単位は先頭登録商品の `package_unit` を初期値とし、画面を離れると破棄する。**正本・localStorage・同期対象にはしない**。未設定なら入力を促す。
- 購入単位最安値はレシートの税込明細額 ÷ 購入数量と、値札の税込商品単位価格を統合した候補から通常／割引別に集計する。期間の日付は購入日／値札観測日を使う。
- 単価比較：商品内容量が設定されている場合に限り購入単位最安値を比較数量・単位へ換算。同一単位／mL↔L／g↔kgのみ可。非互換・内容量不明は比較不可。
- 単価比較画面で手入力する値札相当の試算（税込価格・数量・単位）は**一時画面状態**。レシート明細・値札履歴・商品正本には保存しない。
- 履歴の最安値を表示するときは、価格と同一元レコードの店舗・日付を採用する（出典種別は表示しない）。端数・同額タイは詳細設計で確定。

## 整合性・制約
- item_groups: 家庭内で表示中（is_hidden=false）の正規化日用品名の重複を禁止する。
- products: 商品は最大1日用品へ登録可。登録先日用品は同じ家庭のみ。順序は登録先ごとに重複を禁止。
- package_quantity/package_unit: 不明なら両方NULLとして価格単位換算から除外。価格自体の履歴は維持する。
- receipts / receipt_items: 購入日、商品ID、家計簿カテゴリは履歴の正本であり、商品登録先変更では上書きしない。
- price_observations: 必須項目が確定するまで最安値に採用しない。家計簿へ流入させない。
- GAS LockServiceとversion／operation_idで商品順序・付け替え・同名再登録を整合的に更新。SheetsにリレーショナルDBの制約がないため、サーバーで整合性検査を行う。

## 既存試作との関係
- 旧 `household_pwa_ui_v1` は `memo` と `favorites`、旧 `household_pwa_catalogue_v1` は順序なし商品を含む。新試作の保存先は `household_pwa_ui_v3`／`household_pwa_catalogue_v4`。商品内容量はアプリ内部でも `packageQuantity`／`packageUnit` として保持し、購入数量とは別フィールドとする。**本番正本として流用しない**。
- 本番データが無い今の段階では、試作リセット／新バージョンの仮データに切り替え、廃止した項目を新スキーマへ持ち込まない方針。
- 試作コードの画面切替・日用品一覧の空価格表示・長押し順序はこの定義に基づき更新済み。実価格履歴の集計、値札OCR／レシート保存は後工程。

## v1.4画面・データ整合性
- 日用品一覧の表示は、先頭登録商品に紐づく割引・通常の最安値を順に「価格／商品名／店舗名」として要約。存在しない情報は捏造しない。
- 日用品の編集・削除は一覧行の左スワイプから行う。価格情報で登録商品の管理を完結させるため別管理画面は将来仕様に残さない。
- 保存列から比較数量・単位を削除し、画面を開くたび先頭商品の内容量・単位から算出する。


## 2026-10-17 v1.5 操作感・表示の修正（現行仕様。旧記述に優先）
- 日用品一覧は**高さを抑えた2行バー**（名称／価格要約）。価格は在庫専用の右側領域に入り込まず、バーの**右端**に6px前後の控えめな帯を置く。右側の「あり／なし」ボタン表示は従来のコンパクトな寸法に戻す。
- **長押し並び替えは指位置に追従する固定座標のドラッグゴースト**で実装する。リストのCSSがドラッグゴーストのpositionを上書きしないこと。日用品はカテゴリ内、登録商品はその日用品内で上下並び替え。
- **左スワイプ中から**背面の編集／削除（商品は編集／登録解除）を表示し、前面バーは指の移動距離に即時追従する。指を離して初めて突然操作が現れる仕様にしない。右スワイプは閉じる。長押しとスワイプの方向判定を分離し、縦スクロールも阻害しない。商品行も日用品行と同じスワイプUIにする。
- 価格情報のタブ名は**「商品価格／店頭商品と比較」**。後者は旧「単位価格」モードの置換であり、**別の「店頭と比較」開閉入力欄は削除**。比較用**数量は空欄が初期値**。単位だけ先頭の登録商品の内容量単位を初期値とする。数量と単位は入力／選択完了時に画面へ**自動適用**し、適用・保存ボタンは置かない。画面を離れると値は破棄する。
- **「最安値」と期間切替は、数量・単位の下**に配置。期間は商品価格と店頭商品と比較の両モードで共通。最安値は購入単位の税込通常／割引および登録商品別の換算結果で、価格ごとの店舗名を示す。
- 「商品を登録」は既存商品検索・選択のみの**共通ハーフモーダル**として価格情報に重ねる。登録先は表示中の日用品。モーダル内の「新しい商品を作成」は廃止（誤った登録先を連想させない）。
- 登録商品一覧も**左スワイプで編集・登録解除**し、長押しで順序を変更する。商品行の旧「⋯」は不要。確認付き解除は商品のデータや履歴自体を消さない。
- iPhone Safariの実機で、固定座標ドラッグ・横スワイプ中の操作露出・小さな在庫ボタン・画面端タッチ・文字省略を検証する。試作の価格・店舗は明示したサンプルであり、実価格／レシート／値札の接続ではない。
