# くらしストック｜Google Sheets 実書込試験の安全な実施手順（未実施）

更新：2026-10-25。対象：`stage-a-ui-handoff-review` のみ。

**現状：実際のGoogle Sheetsへの書き込みは無効。現在の家庭用シートや稼働中GASの設定を変更してはいけない。** この文書は今後、ユーザーと一緒に安全な試験を開始する際のチェックリストであり、自動で作業・公開するものではない。

## 試験前の安全な準備（開始時にまとめて案内する）

1. 現在の家庭用Google Sheetsは変更せず、**新しい試験専用スプレッドシート**を別に用意。12シートのヘッダー・カテゴリ5件だけを用意する。一般的な「ファイルのコピー」は家庭情報も複製する可能性があるため、コピー後は全件確認し、試験用の家庭1件・本人ユーザー1件以外を必ず削除する。元のデータを試験に転用しない。
2. 日用品、商品、別名、店舗、記録、明細、変更履歴、処理済み操作、レシートルールの**9シートはヘッダー以外すべて空**。家庭とユーザーは試験専用各1件。Google subject列は書式なしテキスト。
3. 本番GASプロジェクトは変更せず、試験用に**別のApps Scriptプロジェクト**を用意。そのスクリプトに開発ブランチの `gas/Code.gs` と必要なマニフェスト権限を反映し、認証・試験用スプレッドシートへのアクセスを許可する。現行の公開GAS WebアプリURLは再利用しない。
4. 試験プロジェクトのスクリプトプロパティに `SPREADSHEET_ID`（試験シートID）、`GOOGLE_CLIENT_ID`（試験で使用するOAuthクライアントID）を設定。さらに `WRITE_TRIAL_SPREADSHEET_ID` に **同じ試験シートID** を設定。ここまでは `ENABLE_EXPERIMENTAL_WRITES` を設定しない。
5. エディタから **`testIsolatedWriteTrialPreflightReadOnly`** を実行。「`ISOLATED_WRITE_TRIAL_PREFLIGHT_OK`」を確認する。これはシートを読み取るだけ。失敗した場合は進めない。
6. 試験プロジェクトだけで `ENABLE_EXPERIMENTAL_WRITES=true` を設定し、別URLとしてデプロイする。**既存家庭用GASにこのプロパティを設定しない**。テストクライアントにも専用GAS URLと独立した書き込み許可を使い、通常プレビューの `LIVE_WRITE_ENABLED=false` は維持する。

## 試験マトリクス（テストシートのみ）

| ケース | 合格条件 |
|---|---|
| 日用品登録 | 1件だけ作成、version=1、household_idは認証本人の家庭 |
| 再送 | 同じoperation_id＋同じpayloadでは新規行やchange_logが増えない |
| 不正な再送 | 同じoperation_id＋異なるpayloadならOPERATION_REUSED |
| 在庫変更 | 最新versionで成功。変更履歴1件、versionが+1 |
| 別端末同時変更 | 古いversionはVERSION_CONFLICT。先に保存された内容を上書きしない |
| 同名登録・別家庭操作 | DUPLICATEやNOT_FOUNDで拒否。無関係家庭のデータは不変 |
| 意図記録中・本体保存中・履歴作成中の中断 | 元操作IDでのみ復旧。重複行・重複履歴ができない |
| 複数ブラウザタブ | 同一オリジンでは排他制御。別端末ではGASロック・versionで保護 |
| 未ログイン・トークン失効 | UNAUTHORIZED。操作データを書かない |
| リリースゲート不一致 | WRITE_TRIAL_SPREADSHEET_IDの欠落／不一致ならWRITES_DISABLED |

## 停止・片付け

- 部分障害の修復方法が判断できない場合は、書き込み許可を無効化して停止。実データへは反映しない。
- 試験後は試験GASの `ENABLE_EXPERIMENTAL_WRITES` を削除またはfalseにし、試験デプロイの公開範囲を閉じる。テストシートとテストGASは混同しない名前で保管または廃止する。
- 試験結果・不具合の件数と操作名だけを記録し、IDトークン・Google subject・スプレッドシートIDはチャットやGitHubのログに貼らない。
- **本番書き込みを有効化する工程は別途設計・承認すること。** 試験成功だけで、本番GASの設定や `main` を変更しない。

## 現時点の検証済み範囲と未確認事項

- 模擬GAS実行で、item.create/updateの故障注入16パターンがすべて元IDから復旧したことを確認済み。
- 試験専用IDが設定されていない／一致しない場合、サーバーが書き込みを拒否することを模擬確認済み。
- `tests/gas-recovery-fault-matrix.mjs` と `tests/gas-item-mutations.mjs` をGitHub Actionsに登録したが、Actions実行完了の成否はまだ確認できていない。
- 実Google Sheetsの部分書込、Webアプリ公開後の認証と権限、通信タイムアウト、複数実端末、Google Sheets APIの実挙動はまだ未試験。
