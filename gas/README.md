# くらしストック — 現行 Google Apps Script 接続仕様

更新：2026-11-01。開発ブランチ：`stage-a-ui-handoff-review`。

## 現在の構成

- 日用品・在庫、商品、チェーン、レシート、家計簿の正本は **既存の１つのGoogle Sheets**。新しいSheetやGASを作らない。
- GitHub Pages PWAはGoogle Identityでサインインし、既存GASの `/exec` に `text/plain` のPOSTでIDトークン、操作名、必要なJSONだけを送る。
- GASはIDトークンの `sub` を既存 `users.auth_subject` に照合し、本人の `household_id` のみ許可。夫婦はそれぞれ別の登録済みGoogleアカウントで同じ家庭を参照する。
- 書き込み対象は `SPREADSHEET_ID` が以前から承認した同一のSheetに一致する場合のみ。固定ハッシュと `WRITE_TRIAL_SPREADSHEET_ID` との一致を確認し、`ENABLE_EXPERIMENTAL_WRITES` は従来どおり `true` にしない。
- 既存試験Sheetにある**レシート3件・明細6件**は保護する。削除・初期化・再登録はしない。

## 通常API

| 種類 | アクション | 保存・表示 |
| --- | --- | --- |
| 読取 | `bootstrap`、`sync`、`product.catalog`、`product.alias.check`、`household.status` | 家庭に属する確定データを返す |
| レシート | `record.preflight`、`record.create`、`record.list` | 原本確認後にレシートと複数明細を保存し、読取で確認 |
| 日用品と在庫 | `item.create`、`item.update` | 日用品登録と在庫あり／なしを保存 |
| 商品 | `product.create` | 商品マスタの新規登録 |
| 店舗 | `store.create` | 未登録の店舗・チェーンの登録 |

旧 `record.trial.*`、試験用GAS GET画面、固定レシート試験、古い非トランザクション型商品更新APIは削除。削除済みAPIを再導入しない。

## 保存・復旧

1. 画面で確認し、利用者が保存する。
2. PWAは内容と紐づいた一意の `operation_id` を端末内の永続ジャーナルに先に記録する。通信が不明でも新規操作IDで自動保存し直さない。
3. GASは家庭認証、保存先照合、ロック取得、`processed_operations` と `change_log` の整合性を確認し、同じ操作ID・同じ内容の重複登録を防ぐ。
4. 完了応答をPWAが検証してから、ジャーナルを完了として消し、必要な最新データを読み直す。
5. 不明時はユーザー操作による**同じ操作IDでの確認・再送**のみ。旧試験時代の未完了操作IDも通常の `record.create` で復旧対象とし、新レシートとして複製しない。

`record_items.amount_tax_included` は **その数量を含めた明細税込合計**。たとえば2点340円は340円であり、数量2を掛けない。価格比較への自動算入や在庫の自動増減はまだ保証しない。

## GASソース反映

`.github/workflows/gas-push-test.yml` は**手動実行専用**。現行の既存GASスクリプトIDを固定ハッシュで照合し、`clasp pull` した現在のGASソース・ファイル一覧・マニフェストを既知の旧版と比較する。差分に未知の関数があれば**何も上書きせず停止**する。更新前のソースとマニフェストをGitHub Actionsのartifactにバックアップできた場合だけ、同じGASにソースを反映し、更新後の一致を検査する。

**現時点の削除・統一はGitHub上の開発コードだけ。既存GASへのソース反映、Webアプリ新バージョン公開、実機の通常商品・在庫保存、夫婦2アカウント受入はいずれも未完了。** 確認前に実家庭の購入データを保存しない。

既存のGAS Webアプリを使い続け、新しいデプロイを追加しない。ソース反映とWebアプリ公開版更新は別工程であり、原則として後者は既存デプロイを１回だけ新バージョンに更新する。

## 今後の検証

- 通常PWAからのGoogleログイン・CORSと既存GAS通信の実機確認
- GAS側の現在ソースの照合・バックアップ・ソース更新と既存Webアプリの新バージョン公開
- 夫婦それぞれの既存Googleアカウントが同一家庭のSheetを読み、他家庭にアクセスできないこと
- 普段の登録操作１回のみの受入確認（固定レシートの再試験はしない）

古い試験の手順やログはGit履歴に保管されており、**現行の運用手順ではない**。
