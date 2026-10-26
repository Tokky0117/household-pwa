# くらしストック：在庫の実保存テスト用GAS（独立プロジェクト限定）

2026-10-26 / 開発ブランチ `stage-a-ui-handoff-review`

## 目的と前提

無料のGAS HTML Service通信とUI即時反応を活かしながら、Google Sheetsへの**本物の在庫保存**を試す。これは別の試験用GASに**単独配置**するコードで、既存の稼働中GASや従来の一度限りの試験GASには混ぜない。

### 安全条件

- `gas/trial-stock/Code.gs`だけを、**新規作成の独立GASプロジェクト**へ配置する。統合版`gas/Code.gs`や家庭用GASへの追加・上書きは禁止。
- Webアプリの「次のユーザーとして実行：自分」「アクセスできるユーザー：自分のみ」を維持。一般公開はしない。
- スクリプトプロパティ`SPREADSHEET_ID`と`WRITE_TRIAL_SPREADSHEET_ID`を**以前の隔離試験専用スプレッドシートのID**へ同じ値で設定。既存家庭用シートは指定禁止。シートを消去したり一回限りの試験を再実行しない。
- `ENABLE_EXPERIMENTAL_WRITES`は未設定/falseを維持。**別の新しい試験専用スイッチ** `STOCK_UI_TRIAL_ENABLED=true` を設定するまで、今回のGASは読み取りも保存も拒否する。
- 実保存を開始してよいのは、専用家庭1件（名前`[KURASHI_WRITE_TRIAL_ONLY]`）・ユーザー1件・固定カテゴリ5件・名前`試験用・牛乳`の日用品1件・他家庭の行ゼロであるとサーバーが検証したときのみ。
- `google.script.run`から呼べるグローバル関数は `doGet`、`trialStockRead`、`trialStockUpdate` の3つのみ。初期化・追加・削除・商品の更新・他家庭の処理・一般`doPost`は含めない。内部関数は名前末尾`_`で非公開。
- 書込み処理は既存の `mutateItemSafely` の「先に操作意図を記録→本体→履歴→確定」のロジックを専用版へ移し、操作ID、version照合、LockService、同一操作再送を保持。

## 操作感

- 「試験用の在庫を読み取る」後に、現在の在庫表示・シートのversionを表示。
- 「在庫を切り替える」を押すと**即座に画面を変更**し、操作ID/元version/新しい在庫値を端末の`localStorage`へ記録後にGASへ送信。
- GASが保存成功を返した場合のみ「Google Sheetsへの保存完了」と表示し、未完了記録を消す。
- ネットワーク失敗/サーバー不明時は**保存結果未確定**として記録を維持し、自動的な再送・ロールバックは行わない。「同じ操作IDで保存結果を確認・再送」でのみ明示再送する。
- localStorageや安全な操作ID生成が使用できない環境では**送信自体をしない**。iframeでのlocalStorageが使えるかは実機未確認。
- 画面の「在庫あり/なし」は楽観的な表示。サーバー確認前はUIに「保存中」と明示する。
- タブ間競合や他端末の操作はGAS LockService/version照合を使用。現在は単一試験画面の範囲で確認し、実端末での同時操作は未検証。

## 開発側の確認

- モックのGoogle Sheetsで在庫false→true、version2→3、同一operation_idの再送でもversion3保持、古いversionは`VERSION_CONFLICT`、履歴と処理済み操作は各1件追加を確認。
- `tests/gas-trial-stock-write.mjs`で書込みゲート、家庭のマーカー、不正な更新対象・余分なpayload・他家庭の行混入を拒否する回帰試験を追加。Actions実行結果の確認は別途必要。
- **実GAS Webアプリからの保存操作はまだ行っていない**。一般公開可否、複数ユーザー/家庭認可、iPhoneホーム画面・オフライン動作を本実験の成功と混同しない。

## 検証終了後

1. 追加した`STOCK_UI_TRIAL_ENABLED`を`false`に戻す。
2. 試験専用Webアプリの公開範囲は広げない。必要がなくなればデプロイをアーカイブする。
3. 既存シートの操作記録は無理に消さず、結果を設計書に記録する。
4. 家庭用GAS、家庭用Google Sheets、GitHubの`main`、既存PWA、`LIVE_WRITE_ENABLED=false`に変更を加えない。
