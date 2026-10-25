# くらしストック｜Google Sheets 実書込試験の安全な実施手順（未実施）

更新：2026-10-25。対象：`stage-a-ui-handoff-review` のみ。

**現状：実際のGoogle Sheetsへの書き込みは無効。現在の家庭用シートや稼働中GASの設定を変更してはいけない。** この文書は今後、ユーザーと一緒に安全な試験を開始する際のチェックリストであり、自動で作業・公開するものではない。

## 試験専用シートを新規作成する簡易手順（v56）
- 開発プレビューの `gas-trial-setup.html` からGAS全コードを1回でコピーできる。
- **既存プロジェクトではなく新しいApps Scriptプロジェクト**の`Code.gs`へ貼り付け、`createFreshIsolatedWriteTrialSpreadsheet()` を手動実行すると、元の家庭用シートをコピーせずに新しい空の12シート構成ができる。
- 固定5カテゴリ、家庭名 `[KURASHI_WRITE_TRIAL_ONLY]` の家庭1件、`users.auth_subject` が空の試験ユーザー1件を作成する。IDやシートURLは実行ログに表示されるが、GitHubやチャットには貼り付けない。
- 生成関数は`SPREADSHEET_ID`を読まず、既存の家庭用シートを開かず、GASのスクリプトプロパティを変更せず、書き込みゲートも有効化しない。
- 新シート作成後に一旦操作を止め、試験用のGoogle subject登録・スクリプトプロパティと読み取り確認を別工程に分ける。古い家庭用シートのバックアップ・コピー操作は不要。

## 試験前の安全な準備（開始時にまとめて案内する）

1. 現在の家庭用Google Sheetsは変更せず、**新しい試験専用スプレッドシート**を別に用意。12シートのヘッダー・カテゴリ5件だけを用意する。一般的な「ファイルのコピー」は家庭情報も複製する可能性があるため、コピー後は全件確認し、試験用の家庭1件・本人ユーザー1件以外を必ず削除する。元のデータを試験に転用しない。
2. 日用品、商品、別名、店舗、記録、明細、変更履歴、処理済み操作、レシートルールの**9シートはヘッダー以外すべて空**。家庭とユーザーは試験専用各1件。**試験専用の家庭名（households.display_name）は `[KURASHI_WRITE_TRIAL_ONLY]` と完全一致**させる。users.household_idはその家庭IDと一致させ、Google subject列は書式なしテキストの数字文字列とする。
3. 本番GASプロジェクトは変更せず、試験用に**別のApps Scriptプロジェクト**を用意。そのスクリプトに開発ブランチの `gas/Code.gs` と必要なマニフェスト権限を反映し、認証・試験用スプレッドシートへのアクセスを許可する。現行の公開GAS WebアプリURLは再利用しない。
4. 試験プロジェクトのスクリプトプロパティに `SPREADSHEET_ID`（試験シートID）、`GOOGLE_CLIENT_ID`（試験で使用するOAuthクライアントID）を設定。さらに `WRITE_TRIAL_SPREADSHEET_ID` に **同じ試験シートID** を設定。書込時には家庭名の試験専用マーカー、家庭1件・ユーザー1件と所属整合性も毎回検証される。実家庭データの名前を試験用マーカーに変更してはならない。ここまでは `ENABLE_EXPERIMENTAL_WRITES` を設定しない。
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
| リリースゲート不一致 | WRITE_TRIAL_SPREADSHEET_IDの欠落／不一致ならWRITES_DISABLED、専用家庭名やユーザー構成が違えばTRIAL_NOT_ISOLATED |

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

## 試験用Webアプリとブラウザの読み取り接続（v58）

前提：エディタ内の試験で「ISOLATED_ITEM_WRITE_TRIAL_OK」を確認済み。以下の作業は**試験専用GASプロジェクト**だけで行う。

1. 試験用GASのスクリプトプロパティにある `ENABLE_EXPERIMENTAL_WRITES` が未設定か `false` であること、`SPREADSHEET_ID` と `WRITE_TRIAL_SPREADSHEET_ID` が試験用IDを指すことを再確認。
2. 試験用GASの「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」を選択。説明「試験用・読み取り接続」を付け、実行ユーザーは「自分」。アクセス可能ユーザーはまず**自分のみ**を試す。外部GitHub Pages画面から呼べない場合は、アクセス権とCORSの切り分けが必要であり、無断で公開範囲を広げない。
3. 新規発行された **試験用** `https://script.google.com/macros/s/.../exec` をコピー。既存の家庭用GASのデプロイを編集・更新・置換しない。
4. 開発プレビューの `gas-trial-connection.html` を開き、試験用URLをその場だけ入力。同一Googleアカウントでログインし、「試験用シートの件数を読み取る」を1回実行する。
5. 成功条件：カテゴリ5件、日用品1件、商品0件、店舗0件。読み取り試験は `bootstrap` だけで、書込アクションは呼び出さない。URLや認証トークンをブラウザ保存しない。
6. 失敗時：エラー名を記録し、公開範囲・スクリプトプロパティをむやみに変更しない。GASのWebアプリはリダイレクトやCORSでGitHub Pagesから読み取れない可能性がある。
7. **本番GASのURL、`main`、通常PWAの設定や書込ゲートは変更しない。**

試験用のWebアプリは外部アクセスできる設定にする場合、手動で公開範囲を判断する必要がある。`doPost` はGoogle IDトークンを検証するが、その確認自体も試験対象である。公開範囲を緩めることが接続試験の必須条件とは限らない。

## CORS回避の読み取り診断（2026-10-26）

GitHub Pagesから試験用GASの`bootstrap`を直接`fetch`するとCORS/ネットワークエラーとなったため、GASが提供する**同一GAS内のHTMLページ**を試験する。

1. 独立した試験GASプロジェクトだけの `Code.gs` を最新の開発ブランチ版に差し替えて保存する。家庭用GASや`main`は変更しない。
2. `ENABLE_EXPERIMENTAL_WRITES` が未設定か`false`であることを確認する。書き込み機能は有効化しない。
3. 試験用GASの「デプロイ」→「デプロイを管理」→試験用ウェブアプリの編集→「バージョン：新バージョン」で更新する。**アクセスできるユーザーは「自分のみ」のまま**とし、無断で公開範囲を広げない。
4. **試験用**Webアプリの`/exec` URLに `?trial_read=1` を追加し、そのURLを直接ブラウザで開く（チャットにはURLを貼らない）。入力画面が現れたら「試験用データを読み取る」を押す。
5. `google.script.run` でGAS内の `trialReadOnlyCounts()` を呼び、カテゴリ5件／日用品1件／商品0件／店舗0件を期待する。この方式はGitHub Pagesからのクロスオリジン`fetch`を使用しない。
6. このページは`SPREADSHEET_ID === WRITE_TRIAL_SPREADSHEET_ID`と試験専用の家庭マーカー、および`ENABLE_EXPERIMENTAL_WRITES !== true`を毎回確認する。返すのは4種類の件数だけ。書込アクションは呼び出さない。

`?trial_read=1` が認証や権限で拒否された場合は「アクセス不可」と伝えてもらい、公開範囲を広げずに原因を調査する。この試験結果は通常PWAの通信手段が確立したことを意味しない。通常PWAの書込ゲートは無効のまま。
