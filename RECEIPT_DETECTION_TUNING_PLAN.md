# PaddleOCR v6 small 検出パラメータ検討（幅連動・評価設計）

2026-10-31。対象は独立OCR検証ラボ、無料PWA/単一スレッドWASM。**評価設計であり、画質・文字認識改善の新たな実測結果ではない。** 本番GAS・Google Sheets・main・通常画面を変更しない。

## 1. 実際にロードしている検出モデルの設定を検証

モデルURL・SHA256は `ocr-lab/model-assets.json`。public `PP-OCRv6_small_det_onnx_infer.tar` をGitHub ActionsでダウンロードしてSHA256一致を確認し、`inference.yml`を抽出。CI実行: 41153463637。

モデルinference.yml:
- `PostProcess.thresh: 0.2`
- `PostProcess.box_thresh: 0.45`
- `PostProcess.unclip_ratio: 1.4`
- `PostProcess.max_candidates: 3000`
- `PreProcess.DetResizeForTest: null`

SDK `@paddleocr/paddleocr-js@0.4.2` のモデル設定解析では `DetResizeForTest` が指定されない場合、`DEFAULT_DET_MODEL_PARSE_FALLBACKS` により `resizeLong=960`, `limitType=max`, `maxSideLimit=4000` と解釈する設計。JS README の一般サンプル `min/64` と混同しない。調整する前に実行時の有効値もログへ記録すること。現行 `receipt-paddle.js` は `engine.predict(image)` で明示オーバーライドなし。

## 2. 主な事実と責任分離

- R03灰色2倍ROI（860×1760）は検出器で概算480×960に縮小、R06 iPhone contrast crop（1435×2509）は概算544×960。元の画像を高解像度にしても、検出器は960px長辺制限を使っていた可能性が高い。
- R03 `エリンギ→I` は位置領域が検出されており、認識モデルの誤読。検出解像度変更で文字枠が改善する可能性はあるが、しきい値変更だけで直るとは限らない。
- R05 商品名の一部濁点誤認識も検出領域が存在する。商品別名によるSTEP3の候補照合を後段に残す。名前をOCRの原文から「正しい商品名」として勝手に補完しない。
- R01コストコの13商品の**画像OCR**は未採点。R01の現行固定ROIは合計欄5行のみ。評価の抜けを最優先で解消すること。

## 3. 幅連動の考え方

Photo幅ではなく **切り抜き後のレシート実効幅 W と高さ H** に基づく。OCRの前処理で既に幅/長辺/総画素数の制限があるので、検出器で二重に過大拡大しない。

**第一段階は固定検出長辺のみを1変数で比較**（共通画像、共通文字化、同じSTEP 2):
- A: 現状 `textDetLimitType:max, textDetLimitSideLen:960`
- B: 1280
- C: 1536
- D: 1920（消費メモリと時間の問題がないものだけ）
- しきい値は据え置き（`textDetThresh:.20`, `textDetBoxThresh:.45`, `textDetUnclipRatio:1.4`）
- `textRecScoreThresh:0`（低信頼度候補でも欠落防止のため残す）

**第二段階で幅連動式を検証**。候補式（未採用）:

```js
function proposedLimit(W,H,targetWidth=800) {
  const aspect=H/W;
  const desired=aspect>=1.2 ? Math.ceil(targetWidth*aspect/32)*32 : Math.max(W,H);
  return Math.min(1920,Math.max(960,Math.ceil(desired/32)*32));
}
```

この式は**長辺の上限を計算するだけで、小さい画像を強制的に拡大しない**。レシート領域の幅が小さいのに写真全体の幅が大きい場合は、先に領域分離が必要。実験時には `targetWidth` を600/800/1000pxで比較し、早い・精度が落ちない条件を選ぶ。文字の大きさが異なる印字、58/80mmレシートでも検証し、チェーンID固定では選ばない。

| 入力 | 現状 max960 | max1280 | max1536 | max1920 |
|---|---:|---:|---:|---:|
| R03 ROI 860×1760 | 約480×960 | 640×1280 | 736×1536 | 864×1760 |
| R06 iPhone crop 1435×2509 | 約544×960 | 736×1280 | 864×1536 | 1088×1920 |
| R01合計欄 ROI 780×266 | 768×256 | 768×256 | 768×256 | 768×256 |

SDKは32px刻みへ丸める。縦横比を無視して `textDetLimitType:min,textDetLimitSideLen:960` に一律変更すると、R01の横長ROIでは画像が約2816×960（約14倍画素）へ膨張するため採用しない。

## 4. 第3段階（検出設定を限定的に調整）

上記のサイズ比較で、実際に失われた文字領域の回復が確認できない場合にのみ:
- `textDetBoxThresh`: 0.45→0.35 として薄い文字の採用を比較（誤検出が増えたら撤回）。
- `textDetThresh`: 0.20→0.15 は別試験として比較。
- `textDetUnclipRatio`: 1.4→1.6 は文字端・濁点の欠落時だけ比較。密集行では隣接文字の混入を監視。
- 一度に複数のパラメータを変えず、効果があったものだけ組み合わせの検証を行う。

## 5. 採用判定指標

優先順位：①商品名と金額がそろう行の再現率 ②金額・数量・SKU ③値引きの正しい商品への関連付け ④商品5項目完全一致（現基準: R02〜R06 22/43） ⑤偽の商品候補数 ⑥検出/認識/合計時間・メモリ。税率や装飾記号の誤りは商品情報に影響するときのみ重要扱い。

検出器のサイズを増やすと計算量・メモリは増える傾向があるが、実時間の倍率は非線形なので実測で決める。高解像度ほど正しいとは限らない。改善しない部分は認識モデルの問題としてSTEP 3の候補照合・ユーザー確認、または必要箇所だけの追加認識へ分離する。

**現在のアプリに採用・切替したことを意味しない。** 検出パラメータのA/B比較は未実行（人手で渡された写真の新規推論値ではない）。
