# Receipt OCR baseline (P0, offline only)

These files are **development-only**, under tests/, and are **not shipped as PWA resources**. The GitHub Pages deployment uses an explicit allowlist of application files; it does not copy tests/.

- receipt-baseline.json: seven anonymized structural/numerical gold references and actual pre-improvement OCR snapshots.
- receipt-baseline.mjs: Node.js-only consistency checks and optional before/after comparison.
- No receipt photos, raw OCR text, product descriptions, business names, purchase dates, account/payment data or customer identifiers are kept here.
- The snapshots are **known imperfect OCR observations**, not the desired behavior of the app. Check them against the independent gold reference.
- No runtime hooks, production code, UI test buttons or test data are added to the PWA.

Run from the repository root:

    node tests/receipt-baseline.mjs

Optional comparison after exporting a **local, uncommitted** candidate file:

    node tests/receipt-baseline.mjs --candidate /path/to/local-candidate.json

Candidate structure: {"cases":[{"id":"R04","amounts":[...],"quantities":[...],"receiptTotal":2920}]}. Other cases may be supplied in the same array. Only previously correct dimensions becoming incorrect cause a failure. Candidate files must remain local and must not contain identifying information.

## What is measured

Six independent checks per case: product row count; sum of purchased units; sum of line amounts; reported receipt total; ordered line amounts; ordered purchased quantities. Item names are intentionally not scored because the private visual references and character-for-character verified labels are not stored in this repository. OCR model accuracy must still be evaluated on the actual iPhone with the same user-held images.

R01–R03 and R06–R07 match the historical numeric row/amount totals. R04 has 14 correct rows and ¥2,920 total but the actual purchased count is **15** versus **14** in OCR; one line was 2 × ¥105 = ¥210. R05 has five real merchandise rows totaling ¥11,550; the historical OCR contains four background-receipt rows, nine apparent rows in all, and an OCR sum of ¥12,392. Its printed total is still ¥11,550. Distinguish reported totals from the independent item sum.

R02, R03 and R06 per-item tax-inclusive values are **allocation-derived**, not amounts printed directly per line. Their gold values represent the currently specified deterministic external-tax allocation. Do not report them as item-level photo evidence.

The next step is to develop and check receipt-region isolation and multi-line product linking in the app code, without changing this historical snapshot. A successful synthetic baseline test is **not** proof that an image OCR run has improved.
