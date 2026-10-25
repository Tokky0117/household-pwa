# GitHub Pages PWA ↔ GAS 通信方式（接続前設計）
更新: 2026-10-24 / 対象: テスト環境のみ

## 制約の確認
- Google Apps Script ContentService は返答を `script.googleusercontent.com` の一時URLへリダイレクトする。公式資料: https://developers.google.com/apps-script/guides/content
- `text/plain` POST はプリフライトを避けられることがあるが、**CORSを回避してレスポンスを読める保証はない**。ブラウザとiPhone Safari/PWAで実測する必要がある。
- `mode:'no-cors'` は応答がopaqueとなり、bootstrapのデータ・同期結果が読めないため不採用。
- JSONPはトークンと家庭データが漏れる可能性があるため不採用。Google ID token をクエリ文字列・履歴・ログに入れない。
- PWAはGitHub Pagesの静的サイト。GitHub Pages内に秘密鍵やCORS用サーバを置けない。
- GAS Webアプリの実行主体とアクセス権設定はデプロイ時に検証する。誰でも呼べる公開エンドポイントであっても、各POSTをGoogle ID tokenで検証し、users/householdsを認可する。

## 接続の順番（安全な読み取りから）
1. **ローカル検証**: モックでtoken検証、家庭別アクセス、空行位置、エラー契約を確認する。実Google通信ではない。
2. **GAS一括反映**: コードをまとめてテストプロジェクトへ反映。Script Properties維持、Google CloudとGASのスクリプトIDを混同しない。現行コードは先にバックアップ。
3. **GAS読取確認**: エディタ内の `testCategoriesReadOnly` を実行。結果5件が確認できること。
4. **GAS Webアプリをテスト公開**: 実行主体・アクセス権を決め、ブラウザ上で匿名読取が拒否されることを確認。利用者の `auth_subject` はログに出さず管理者が登録。
5. **通信方式選定**: GitHub Pagesから `bootstrap` をトークン付き `text/plain` POSTし、iPhone Safariで結果が読めるかテスト。CORSでブロックされたら**直接fetchを継続しない**。
6. **必要なら同一オリジン中継**: 認証されたリクエストのみGASへ送る別途ホストのHTTPS中継を採用。中継はトークンをURL/ログに残さず、タイムアウト、サイズ制限、CORS許可オリジン制限、認証検証を行う。管理する秘密情報と運用コストの確認前に導入しない。
7. **最終段階**: 書込み有効化前に operation_id 冪等性、重複・部分失敗の復旧、家庭境界、オフライン同期を検証する。

## 採用前に避けるもの
- Googleログイン画面が出たことだけをもって家庭認可成功とみなさない。
- Googleトークンを localStorage, URL, GitHubリポジトリ, GitHub Actionsのログに保存しない。
- 家庭間のデータ漏えいを招く固定ID・共通トークン・tokeninfoスキップを導入しない。
- GAS `ENABLE_EXPERIMENTAL_WRITES` は無効のまま。レシート・商品登録は公開APIへ送らない。
- Google Sheets実データが接続済みであるかのような表示はしない。

## 現在の実装状況
v50で独立した `gas-api.js` をプレビューの読み込み対象へ追加。`KurashiGasApi.configure(url)` で明示的に検証済みのGAS URLだけを設定し、`request('bootstrap'|'sync')` の読み取り操作のみ許可する。初期値は未設定で、アプリ本体からの呼び出しもまだないため**通信は一切発生しない**。テスト `tests/gas-transport.mjs` をCIに追加。GASは未デプロイ・未反映、実機CORSと通信方式は未検証。

## 反映直前チェック（v50）
1. GitHub Actionsで `tests/ui-smoke.mjs`、`tests/gas-offline-smoke.mjs`、`tests/gas-auth-isolation.mjs`、`tests/gas-transport.mjs` の全成功を確認。構文検査だけで成功と判断しない。
2. **GASへの反映はまだ実行しない**：GitHub Secret `CLASPRC_JSON` 未登録。iPhone Codespacesでの認証は中断済み。誤って `gas/sync-request.txt` を変更してワークフローを起動しない。
3. 現在のApps Scriptにしか存在しない編集があればバックアップし、`gas/Code.gs` との差分を確認してから一括反映する。
4. スクリプトプロパティ `SPREADSHEET_ID`, `GOOGLE_CLIENT_ID` の存在だけ確認し、値をドキュメント・ログへ公開しない。
5. `testCategoriesReadOnly()` で5件読込を実機確認。失敗したらデプロイしない。
6. `users` / `households` の登録方式と二人の本人確認が確定するまでWebアプリへ家計データを入れない。匿名での `bootstrap` は拒否する。
7. Safari/PWAから `bootstrap` の応答が読み取れるかを確認。CORSで読めない場合は中継方式を採るまで接続機能を公開しない。

この工程の目的はユーザーのiPhone操作を最終段階に集約すること。Google側の権限承認・GASのデプロイ操作は、現在のGitHub接続からは代理実行できない。

## iPhone一括コピーの準備（2026-10-25）
作業ブランチのプレビューに `gas-setup.html` を追加。コード全体をボタン1回でコピー可能にする。ただしコピーだけではGASに反映されないため、バックアップ後にGASエディタで一度だけ貼付・保存する必要がある。現時点では反映しない。GitHub Actions `workflow_dispatch` は既定ブランチに定義が必要なため、開発ブランチのみではUIから手動起動できない（GitHub公式仕様）。

## 実機接続確認（2026-10-25、ユーザー申告）
Chromeの接続テスト画面でGoogleログイン、GAS WebアプリへのPOST、家庭所属確認を通過し、「取得成功：カテゴリ 5 件」を確認。複数の接続テストタブを閉じるとGoogleログインが通り、users.auth_subjectを表示文字列で再登録後に読み取り成功した。これにより当該ブラウザ・アカウントにおける読み取り経路の動作が確認できた。通常アプリのデータ反映、書込み、同期、別ブラウザ・端末の動作までは未検証。ENABLE_EXPERIMENTAL_WRITESは引き続き無効。

## v51: 通常アプリの読み取り専用モード（2026-10-25）
- 通常アプリの設定画面に「Google Sheetsから読み取る」を追加。ログイン後に `bootstrap` を実行し、受信した `item_groups` / `products` / `stores` を「日用品」タブに表示する。
- **初期表示とローカル試作データは従来どおり**。実データはメモリだけに保持し、`localStorage` の試作データを上書きしない。切替操作で試作表示へ戻る。
- 読み取り専用モードでの在庫切替・編集・削除などの操作は表示せず、操作イベントも受け付けない。接続失敗時は試作側を維持する。
- GASへの接続URLは作業ブランチv51のみに組み込み、`main` には反映しない。自動書込み・差分同期は依然無効。
- オフライン回帰検証 `tests/live-view.mjs` を追加。実機・GitHub Actions全体の実行結果は別途確認が必要。

## v53: 日用品の保存処理をステージング（2026-10-25）
- 通常アプリの実データ画面に日用品の登録・編集・在庫変更・非表示用UIとバージョンを伴う送信処理を実装。ただしすべての保存操作はリリースゲートにより**画面では無効**。
- `gas-api.js` は `item.create`、`item.update` のoperation_id対応コードを追加したが、`LIVE_WRITE_ENABLED=false` のため通信前に `WRITES_DISABLED` を返す。保存に使うGoogle IDトークンは引き続きメモリのみ。
- `gas/Code.gs` の登録時重複判定（非表示データを含む）と復活時の名称重複判定を強化。GitHubのコード変更は実デプロイGASに自動反映されない。
- GAS本体の `ENABLE_EXPERIMENTAL_WRITES` は **無効のまま維持**。ブラウザとGAS側で二重に書き込み禁止。
- 保存成功後は再bootstrapしてサーバー側の確定値を再表示。失敗時の送信結果不明は自動再送しない。同じoperation_idによる手動再送のUI設計、シート部分書込復旧、複数端末競合の総合試験を経てから有効化を別途承認する。
- テスト：`tests/live-write-gate.mjs` を追加。実際のGoogle Sheetsへの書き込み動作は**未確認**。

## v53 追加検証：日用品保存の模擬シート統合テスト（2026-10-25）
- `tests/gas-item-mutations.mjs` を作成しCIに組み込んだ。**外部サービスや実Google Sheetsを使用しない**モックでGAS `mutate` を呼び出す。
- 確認シナリオ：書き込み禁止、登録、順番、同名重複、危険な式入力、カテゴリの範囲外、在庫変更、古いversionによる競合、名称／カテゴリ編集、非表示と再表示、同一operation_idの再送、変更payloadでの再利用拒否、他家庭への更新禁止、家庭別change_log/処理済み操作の分離。
- **既知の公開禁止事項**：`mutate` は `item_groups` 更新→`change_log` 追記→`processed_operations` 追記を別々に行う。最後の記録に失敗すると日用品だけ保存された状態となり得る。テストはこの状況を故障注入で検出する。復旧・重複再送の仕様が完成するまで `ENABLE_EXPERIMENTAL_WRITES` とクライアントの `LIVE_WRITE_ENABLED` を無効のままにする。
- 安全性の完成条件：失敗状態の再取得・照合と同一operation_idでの確実な再試行／完了確認、操作の永続記録に関する復旧設計、二重クリック・タイムアウト・複数端末の実機試験、テスト専用スプレッドシートを用いた動作確認、段階的な明示承認。現状はすべて未完。
- GitHubのGASコードは利用者のデプロイ済みWebアプリに自動反映されない。未承認の公開反映はしない。

## item.create / item.update 事前ジャーナル方式（開発ブランチのみ、2026-10-25）
- 旧方式の「item_groups書込→change_log→processed_operations」は部分失敗時の再送を安全に判定できなかった。日用品操作に限り、先に `processed_operations` へ `status=prepared`・計画済み確定行・元version・予定sequence_no・要求ハッシュを保存してから実データを書き込む方式へ変更。
- ロック中、同家庭に未完了 `prepared` があれば**異なる操作IDは `RECOVERY_REQUIRED` で拒否**。元の操作IDかつ同一要求のみ、実データ行と操作履歴を照合し、抜けている段階を補完して結果を確定する。
- `change_log.change_id=operation_id` として再送時に同一変更履歴を重複追記しない。異常なバージョンや異なる結果は `RECOVERY_CONFLICT` で停止し、推測して上書きしない。
- 1回のモック実行で、正常登録→同一IDでの再送→更新後の履歴確定失敗→元IDによる復旧を確認。更新バージョンが二重に進まず、履歴も2行のままであることを検証した。さらに `tests/gas-item-mutations.mjs` の故障注入シナリオを新方式に修正してCI対象にしている（GitHub Actions全体の結果は未確認）。
- **未解決の公開禁止事項**：ブラウザ終了後の元操作IDと要求の復元方法、`prepared` 行自体の不整合復旧、デプロイ済みGASとの差分、実Sheets障害・タイムアウト・同時更新の実機検証、製品書き込みの旧経路。これらが解決するまでクライアント `LIVE_WRITE_ENABLED=false` および実GASの `ENABLE_EXPERIMENTAL_WRITES` は無効。商品系の旧書き込みは開発ブランチ内でも `WRITES_DISABLED` で拒否する。

## v54: ブラウザ終了後の未完了操作記録（2026-10-25）
- `live-operation-journal.js` を追加。日用品の保存に限り、サーバーへ送信する**前**に操作ID・action・payload・Google subject・家庭ID・作成日時を端末のlocalStorageへ保存する。IDトークン、メールアドレス、パスワードは保存しない。日用品名・更新内容は端末に残るため、実運用前に端末共有時の扱いを確認する。
- 通信途絶・結果不明なら元の記録を `uncertain` として保持。アプリ再起動後、本人・家庭の一致を確認したうえで、**本人が「同じ操作を確認・再送」を押した場合に限り**元の操作IDと同じpayloadで再送する。自動再送は行わない。
- 未完了が存在する間は新規操作を拒否。アカウント・家庭が違う場合は内容を表示せず送信も拒否。記録破損・localStorage書込不可の場合も送信前に停止する。サーバーが正常受理した応答を返した時点で記録を消し、一覧再取得に失敗しても重複再送しない。
- `tests/live-operation-journal.mjs` をCIへ追加。実行環境を作り直すことでリロードを模擬し、保存の未確定状態・自動再送なし・別アカウント拒否・同一ID再送・保存記録破損による送信停止を確認する。開発用の模擬実行でも、通信エラー後に元操作IDを維持して再送できることを確認した。
- **公開前の保留**：実Sheetsと実GASでの失敗注入、複数タブ同時操作、恒久的な`RECOVERY_CONFLICT`の管理者復旧、未完了操作が永遠に残った場合の運用、GitHub Actions全体の結果。書込ゲートはクライアント・GASとも無効のまま。

## v55: 複数タブ同時保存防止（2026-10-25）
- `app.js` の日用品登録・更新・未完了操作の明示再送に、同一オリジンの `navigator.locks.request('kurashi-live-items-write-v1', {mode:'exclusive',ifAvailable:true}, ...)` を適用。ジャーナル記録からGAS応答・後処理までロックを保持し、同時に別タブが保存開始できないようにした。
- ロックが別タブで保持中なら送信を開始せず「別のタブで保存処理中です」と表示する。Web Locks非対応・ロックAPI失敗時は**fail closed**とし、送信しない。ローカルストレージのチェックを原子的排他制御の代わりにしない。
- 未完了操作がある場合は登録・編集・在庫変更・非表示ボタンを無効化し、同一IDの復旧だけを候補として表示。write gateは引き続き `false`。
- `tests/live-operation-journal.mjs` を更新し、共有ロックを持つ2タブからの並列送信とロック非対応ブラウザの拒否を検証する。追加の模擬実行でも「先行1件送信、後続タブ拒否、ジャーナル確定後削除」を確認。
- **別端末間**の排他はWeb Locksでは対応できない。GASのLockService + version照合と、実Google Sheetsでの同時更新試験が必要。
- テスト専用スプレッドシートへの書き込み試験は**まだ未実施**。利用者の現行GASへのコピー・デプロイ、スクリプトプロパティ変更、GitHubの`main`更新は行っていない。GitHub Actions一式の成功も未確認。

## v56：別端末競合・故障マトリクスと隔離試験のゲート（2026-10-25）
- `tests/gas-recovery-fault-matrix.mjs` を追加。GASの「操作意図記録／本体書込／変更履歴／操作確定」の各段階で書込前・書込直後の障害を模擬し、登録8件＋更新8件＝**16経路**を検査する。別ユーザーが同じversionで競合し、後続を `VERSION_CONFLICT` で拒否するケースと他家庭の更新拒否も含めた。
- 保存処理に試験用の追加ゲート `WRITE_TRIAL_SPREADSHEET_ID` を設けた。`SPREADSHEET_ID` と完全一致し、さらに `ENABLE_EXPERIMENTAL_WRITES=true` のときに限りGAS側の日用品書込が可能。不一致・欠落のときは `WRITES_DISABLED`。模擬動作で一致時1件保存／不一致・欠落時0件を確認。
- `testIsolatedWriteTrialPreflightReadOnly()` を追加。12シートのヘッダー・固定5カテゴリ・試験用家庭1件とユーザー1件・9データシート空を読み取り検証する。プロパティを書き換えたりデータを追加したりしない。
- 実Google Sheetsでの試験時の段取りを `gas/WRITE_TRIAL_PLAN.md` に整理。稼働中GASや家庭用シートを流用せず、専用シート＋別GASプロジェクトを使い、試験後は公開・書込許可を閉じる。
- **試験環境への実書込はまだしていない**。通常アプリのクライアント書込ゲート `LIVE_WRITE_ENABLED=false` も維持。本番の書込機能は別審査・別承認であり、この段階では有効化しない。

## 2026-10-25：試験専用環境の誤設定対策（追加）
- `SPREADSHEET_ID===WRITE_TRIAL_SPREADSHEET_ID` のみでは、両者を同じ家庭用シートIDに誤設定した場合に不十分と判明。GASの `requireIsolatedWriteTrial()` と事前検査に `assertIsolatedTrialIdentity()` を追加した。
- 試験用家庭は **1件のみ**、家庭名は `[KURASHI_WRITE_TRIAL_ONLY]` と完全一致、試験用ユーザーも **1件のみ**で家庭IDが一致、`auth_subject` は数字文字列。この条件が満たされない書き込みは `TRIAL_NOT_ISOLATED` で停止する。一般家庭の本名や既存家庭用シートを試験環境へ転用しない。
- `tests/gas-isolated-trial-gate.mjs` にシートID不一致／未設定、家庭名マーカー不一致、ユーザー識別不整合、データ入力済みの事前検査拒否、正しい試験環境でのみモック書込許可を検証する回帰テストを追加しCIへ登録。
- 本番データへ書き込む許可ではなく、**試験用スプレッドシートへ限定するための二重認証**。実Google Sheetsの書込試験は未実施。現行デプロイ先、通常PWAの書込ゲート、`main` は変更していない。

## v56：試験専用の空シート生成とプレビュー配布修正（2026-10-25）
- `gas/Code.gs` に `createFreshIsolatedWriteTrialSpreadsheet()` を追加。手動実行で新しい12シート＋固定5カテゴリ＋試験専用家庭1件＋Google subject未入力のユーザー1件を作る。家庭用シートのコピー・既存スクリプトプロパティの変更・書込ゲートの有効化は行わない。モック実行で既存シート参照0回、プロパティ書込0回、必要シートと初期行数を確認。
- iPhoneでも操作しやすい `gas-trial-setup.html` を作成し、独立したApps Scriptプロジェクトへのコードコピー・関数実行まで案内。試験GASの新規デプロイや認証登録はこの段階では行わない。
- GitHub Pagesのプレビュービルドが依存ファイル `live-operation-journal.js` をコピーしていなかった問題を修正。新しい試験準備ページも配布対象へ追加した。
- 新回帰テスト `tests/gas-trial-setup.mjs` をActionsに登録。ただしGitHub Actionsの成功状態はまだ確認できていない。
- 現在のユーザー側の次工程：新しいGASプロジェクトで試験専用シートを作成し、完了のみ連絡する。Googleの識別子・シートURL・トークンはチャットに貼らない。

## CORS障害を確認した時点の方針（2026-10-26）
- 試験用GASのWebアプリをGitHub Pages内の `gas-trial-connection.html` から `fetch(POST)` すると「通信エラー：CORSまたはネットワーク制限」となった。**個別の原因はブラウザネットワークログで未確定**だが、GAS ContentServiceのレスポンスはGoogle公式仕様により `script.googleusercontent.com` へリダイレクトされる。CORSヘッダーのないリダイレクト先を静的GitHub PagesのJSから読めない状況は構造的にあり得る。
- この問題をGoogle CloudのOAuthクライアント設定緩和、Webアプリの「全員」への公開拡大、JSONPでのトークン運搬、`mode:'no-cors'` による不透明レスポンス、ブラウザのCORS無効化では解決しない。
- 次の実装案を先に検証して選定する：**(A)** Apps Script HTML Serviceに試験UIを配置し `google.script.run` を使用（最初に試す。機能は試験専用・読み取りに限定）、**(B)** 信頼できる独立したHTTPSバックエンドを用意し同一オリジン／CORS／認証を適切に構成。通常PWAで実保存を有効にするには通信方式の再設計とセキュリティ評価が必須。
- 切り分け用に `testIsolatedTrialResultReadOnly()` を試験GAS用コードへ追加。エディタから実行すればGoogle Sheetsの試験後件数・在庫・履歴・受領記録を**読み取りのみ**で検証できる。期待ログ `ISOLATED_TRIAL_READ_ONLY_OK`。この関数はデプロイもGoogle IDトークンも不要、書込み設定も変更しない。
- 現行のGitHub Pagesの読み取り/保存アダプタは、試験GASとのブラウザ通信が通るまで実データ運用に使用しない。書込みゲート `LIVE_WRITE_ENABLED=false` を維持。稼働中の家庭用GAS・`main` は変更しない。
参考: https://developers.google.com/apps-script/guides/content （ContentService redirects） / https://developers.google.com/apps-script/guides/html/communication （HTMLService google.script.run）
