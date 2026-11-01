# くらしストック｜実装10 → 次チャット引き継ぎ（2026-11-01）

## 利用者方針（最優先）

- **実装を進める。** 既存の試験用GAS/Google Sheetsが開発環境であり、新しい試験環境・試験専用API・固定金額レシート・件数制限・診断画面は追加しない。
- 実レシートの保存・読取はすでに架空3件で成功（496円＋458円＋550円、計3件・6明細・税込1,504円）。**4件目を何度も試す指示は不要**。利用者が「何回この操作やるん」と強く指摘済み。可能な限り自動テストで検証し、実機確認の要求は最小限。
- 本来の通常機能の開発と家族2アカウント共有を優先。無料のGAS＋Sheets＋GitHub Pages PWA構成を維持。ユーザーの操作は必要時だけ。
- チャット容量が近づいたらコピペ可能な引き継ぎ文を作ること。新しいチャットそのものは利用者が開く。
- 実装担当側がGitHubを確認・編集して進める。「進めて」は作業実行の意味。新しい環境・仮の機能・過度な確認質問は避ける。

## GitHub・公開環境

- Repository: `Tokky0117/household-pwa`
- 正しい作業ブランチ: **`stage-a-ui-handoff-review`**。**`main` を編集しない**。
- 開発PWA: `https://tokky0117.github.io/household-pwa/previews/stage-a-ui-handoff-review/?receipt_trial=1`
- プレビュー通常URLは試作（Googleログイン停止）。明示パラメータのステージングだけ、設定画面で既存の試験GAS `/exec` URLを入力・Googleログインして通信する。URLやGoogleトークンは保存しない。
- 既存の試験GAS/Sheetは1セットのみ、現在本番環境は未作成。
- PWAのシェルキャッシュは **v69** に更新済み。
- GitHub Actions: `Offline regression tests (no GAS access)`、`Preview all branches on GitHub Pages`。Push GASのトリガーは**手動のみ**に戻した。

## 実装済みの通常Sheet連携

1. **レシート保存・履歴・家計簿：** ChatGPT画像抽出JSONの貼付→編集→確認→通常 `record.preflight` / `record.create` / `record.list`。GASでID重複防止・家庭認証・親子整合性・書込前操作ジャーナル・同一操作IDでの障害復旧。明細の `amount_tax_included` は**数量を含む行合計**であり、数量を二度掛けしない。家計簿には確定レシートのみ集計、試作サンプルは接続中に表示しない。
2. **チェーンマスタ：** レシート確認画面の「チェーンが一覧にない場合は登録」から通常 `store.create`。重複検査、同一操作ID復旧、家庭照合、登録後の最新店舗一覧反映がある。
3. **日用品・在庫管理：** 既存「日用品」画面の通常 `item.create`、`item.update` を既存試験GASの `mutateItemSafely_` に接続。名称とカテゴリの登録・変更、在庫あり／なし、非表示。商品一覧は `bootstrap` により同じ家庭のSheetから読み取り。Google Sheets接続中は試作の在庫と混ぜない。
4. **商品マスタ：** 通常 `product.create` を既存 `products` シートへ追加。日用品に紐付く商品登録・未分類の商品登録、内容量と単位の入力。GAS内ロック＋prepared/finishedジャーナル＋変更ログで故障復旧・同一ID再送を可能にした。登録後に `bootstrap` で確定商品を再読取し、同じ商品がレシート確認の選択肢に反映される。
5. **共通保護：** Google subject → 登録済みユーザー → 家庭照合。既存の試験Spreadsheet IDは固定SHA-256照合、`SPREADSHEET_ID===WRITE_TRIAL_SPREADSHEET_ID` と `ENABLE_EXPERIMENTAL_WRITES=false` に限定。登録済みの同一家庭2ユーザーを想定し、別家庭を拒否。ブラウザは Web Locks と localStorage 操作ジャーナル、ログアウト時のデータ破棄、未確定操作の自動再送禁止。未完了保存は同じIDの明示再送のみ。
6. **テスト：** サーバーのGAS/Sheetsモック、2アカウント、在庫競合・復旧、商品・店舗とレシートの関係、ブラウザの確認UI、PWAオフラインキャッシュ、金額計算など多数の自動テスト成功。**実Google Sheetsへの今回のitem/product通常書込は未検証**。

## GASソース同期の状態（重要）

- 2026-11-01、既存試験GASに通常日用品・商品マスタの最新版ソースだけを上書き反映済み。
- [既存試験GASソース同期・バックアップ・更新後照合に成功](https://github.com/Tokky0117/household-pwa/actions/runs/41296926044)
- 旧GASソースの完全一致、固定GAS ID、manifest保持、更新前バックアップ、更新後の再取得ハッシュ照合に成功。**Sheetデータ・スクリプトプロパティ・マニフェスト・デプロイは変更していない**。
- 一時的なpush更新トリガーは[コミット `8cee3a33`](https://github.com/Tokky0117/household-pwa/commit/8cee3a33c214f09b6d689f6ca628203cb31b6023)で無効化済み。
- **GASの実行可能なWebアプリ公開バージョンはまだ旧版**。通常item/product APIを実行するには、利用者による**既存試験GASの「デプロイを管理 → 既存デプロイ編集 → 新しいバージョン → デプロイ」**が一度必要。新しいGAS・Sheet・新規デプロイは不要。**追加の架空レシート保存試験は求めない**。
- 開発PWAの最新版はGitHub Pagesのプレビューワークフローにより公開される。ソース更新とWebアプリ版更新は別概念。

## 変更の主なファイル

- `gas/Code.gs`: 通常 `record.create`、`store.create`、`item.create/update`、`product.create`、安全な家庭・保存先認可、各保存ジャーナルと同期読取。
- `gas-api.js`: 明示ステージングだけに通常の保存APIを許す。旧本番write gateは開かない。
- `app.js`: レシート/家計簿の確定履歴、チェーン登録、日用品登録・在庫更新・商品登録画面、認証に応じたSheet表示、再読取・応答整合性の検証。
- `live-operation-journal.js`、`receipt-operation-journal.js`、`receipt-save-session.js`: 同じIDの未完了操作の管理。
- `tests/gas-receipt-batch-mock.mjs`、`tests/live-product-create.mjs`、`tests/live-operation-journal.mjs` 等が回帰テスト。
- `RECEIPT_DAILY_USE_PLAN.md`: 実装の段階別履歴と現在の設計。

## 次工程（優先順）

1. GitHub最新の開発ブランチを読み、直近CI/Pages成功を確認。変更済みの実装を不用意に差し戻さない。
2. 商品マスタ **更新・所属変更** `product.update/move` の通常安全な保存APIと既存画面への接続。旧 `mutate_` 内の一括更新は非原子的なため本番用途に流用しない。
3. 在庫リスト、商品一覧、価格比較、確定済みレシート明細のデータを共通のGoogle Sheetsデータに接続。特に現在の価格比較は試作ローカル由来の部分がある。データの二重管理を減らす。
4. 認証・家庭共有の2端末実機は未完了。実試験Sheetに2人目のGoogle subjectが登録されているかは未確認。セルの会員情報等を画面/ログに出さない。
5. 確定履歴200件超の読み取り分割・スクロール、レシート編集削除の扱い、旧試験専用アクション/診断画面の安全な廃止を設計順に進める（既存操作の復旧ができなくなる削除を先行しない）。
6. 実機受入が必要な段階でのみ最小限の確認を依頼。既存の架空3件・6明細を消去/再登録しない。テスト用機能を増やさない。

**注意：** この引き継ぎは現時点の実装と未完了状態の整理であり、本番運用開始・夫婦実機同期成功・最新Webアプリデプロイ成功を示すものではない。
