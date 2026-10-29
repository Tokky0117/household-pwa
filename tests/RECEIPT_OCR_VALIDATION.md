# Receipt recognition validation (STEP 1)

Keep three evaluations separate: raw OCR recognition, receipt-line extraction,
and registered-product matching. Do not use extracted item count to score OCR.

## Recognition metric

`receipt-ocr-accuracy.py` is a Python 3 standard-library CLI. It reads private
ground truth and raw OCR results, without invoking `parseText` or correcting
amounts, symbols, or names. CER is `(substitutions + deletions + insertions) / N`.
Lower is better; CER can exceed 100%. Report `N` and the three error counts.

The scored text is NFKC-normalized with whitespace removed. NFKC also folds
circled digits and compatibility characters; this is **normalized CER**, not
literal character or layout accuracy. Currency symbols, decimal punctuation,
signs, and spelling remain significant. Deletion rate is an edit-alignment
measure; it is not proof that an entire physical line was missed. Ties prefer
substitution, deletion, then insertion. Aggregate by total reference characters,
not the unweighted mean of receipt percentages.

Every variant/mode must contain every reference sample exactly once. An empty
OCR string counts as deletions; missing samples and duplicate IDs are rejected.
Uncertain or obscured text must be explicitly excluded from both the reference
and recognition input before comparing variants. Do not reconstruct unreadable
text from prices, known products, or expected totals.

```sh
python3 tests/receipt-ocr-accuracy.py --self-test
python3 tests/receipt-ocr-accuracy.py \
  --gold /private/path/gold.json \
  --results /private/path/results.json /private/path/other-results.json \
  --output /private/path/scores.json
```

Gold shape: `{"samples":[{"id":"synthetic-1","truth":"牛乳 ¥198"}]}`.
Results shape: `{"results":[{"id":"synthetic-1","variant":"original","psm":"6","text":"牛乳 ¥198"}]}`.
Extra metadata is allowed. Scores contain counts and IDs, not receipt text.

## Six-photo study started 2026-10-30

Six user photos cover a warehouse receipt, two supermarket receipts from one
chain, a drugstore receipt, an apparel receipt, and another supermarket chain.
The first reference set scores fixed, visually readable regions, not complete
receipts. The warehouse region currently contains totals/tax only. Store/date
recognition, full item coverage, and registered-product matching remain unscored.

Record source commit, engine and traineddata versions/hashes, language order,
page segmentation mode, crop coordinates, exclusions, image dimensions, pixel
processing implementation, and environment with each private experiment.
Tesseract.js 7's OEM 1 default data is `4.0.0_best_int`; do not label older
`4.0.0` model experiments as the current application baseline.

The Node/@napi-rs/canvas experiment executes the current crop/contrast function
in a VM with canvas adapters. It is not Safari and does not validate iPhone
memory, camera handling, latency, or browser canvas resampling. Full-photo OCR
is redacted before recognition; only words whose TSV bounding-box centers lie
in the scored reference region are retained. Such region CER also includes
reading-order and boundary-selection effects. Compare cropped-region variants
separately to isolate recognition settings. Human-chosen crops are not an
automatic crop improvement and must not be represented as one.

Use the same samples for each comparison; record individual regressions as well
as aggregate changes. Do not choose a global setting solely because it wins on
these six development samples. Keep an additional held-out set for validation.

Real photos, cropped photos, membership/payment fields, and user purchase
transcriptions are not committed here. Keep OCR images transient. The study
does not change main, application OCR behavior, Google login suspension, GAS,
Sheets writes, or the existing explicitly confirmed local preview-save flow.

The final handoff must include receipt types/count, recognition results,
extraction/matching results separately (or not yet tested), unresolved issues,
files/commit, regression checks, integration work, communication/login/storage
state, and next development priorities.
