"""Score raw OCR independently of receipt parsing or product matching (stdlib only)."""
import argparse
import json
import re
import unicodedata
from pathlib import Path


def normalize(text):
    # Equivalent character width and layout spaces only. Keep price/symbol errors.
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


def edits(reference, hypothesis):
    """Return distance, substitutions, deletions, insertions. Ties prefer S, D, I."""
    previous = [(j, 0, 0, j) for j in range(len(hypothesis) + 1)]
    for i, a in enumerate(reference, 1):
        current = [(i, 0, i, 0)]
        for j, b in enumerate(hypothesis, 1):
            if a == b:
                current.append(previous[j - 1])
                continue
            x = previous[j - 1]
            substitution = (x[0] + 1, x[1] + 1, x[2], x[3])
            x = previous[j]
            deletion = (x[0] + 1, x[1], x[2] + 1, x[3])
            x = current[j - 1]
            insertion = (x[0] + 1, x[1], x[2], x[3] + 1)
            current.append(min([substitution, deletion, insertion], key=lambda v: v[0]))
        previous = current
    return previous[-1]


def score(gold, runs):
    references = {}
    for sample in gold['samples']:
        if sample['id'] in references:
            raise ValueError('Duplicate gold sample id')
        reference = normalize(sample['truth'])
        if not reference:
            raise ValueError('Empty reference must be excluded explicitly')
        references[sample['id']] = reference
    if not references or not runs:
        raise ValueError('Gold and OCR results must not be empty')
    rows, seen, groups = [], set(), {}
    for run in runs:
        key = (run['variant'], str(run['psm']))
        identity = (*key, run['id'])
        if identity in seen or run['id'] not in references:
            raise ValueError('Duplicate result or unknown sample id')
        seen.add(identity)
        reference = references[run['id']]
        distance, substitutions, deletions, insertions = edits(reference, normalize(run['text']))
        row = dict(id=run['id'], variant=key[0], psm=key[1], n=len(reference),
                   errors=distance, s=substitutions, d=deletions, i=insertions,
                   cer=distance / len(reference), deletion_rate=deletions / len(reference))
        rows.append(row)
        groups.setdefault(key, []).append(row)
    summaries = []
    for (variant, psm), group in sorted(groups.items()):
        if {row['id'] for row in group} != set(references):
            raise ValueError('Incomplete sample set: do not compare partial aggregates')
        totals = {field: sum(row[field] for row in group) for field in ['n', 'errors', 's', 'd', 'i']}
        summaries.append(dict(variant=variant, psm=psm, samples=len(group), **totals,
                              cer=totals['errors'] / totals['n']))
    return dict(method='NFKC + remove whitespace; CER=(S+D+I)/N; D/N is alignment deletion rate, not unread-line count',
                rows=rows, summaries=summaries)


def self_test():
    assert edits('abc', 'abc') == (0, 0, 0, 0)
    assert edits('abc', 'adc') == (1, 1, 0, 0)
    assert edits('abc', 'ac') == (1, 0, 1, 0)
    assert edits('abc', 'abxc') == (1, 0, 0, 1)
    assert edits('', 'xyz') == (3, 0, 0, 3)
    assert normalize('Ａ １２\nｶﾞ') == 'A12ガ'
    assert normalize('¥1,509') != normalize('\\1.509')
    gold = {'samples': [{'id': 'a', 'truth': '牛乳¥198'}, {'id': 'b', 'truth': '卵¥98'}]}
    runs = [dict(id='a', variant='raw', psm='6', text='牛乳¥198'),
            dict(id='b', variant='raw', psm='6', text='')]
    summary = score(gold, runs)['summaries'][0]
    assert summary['n'] == 10 and summary['d'] == 4 and summary['cer'] == 0.4
    for bad in [runs[:1], runs + runs[:1], [dict(runs[0], id='unknown')]]:
        try:
            score(gold, bad)
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid comparison accepted')
    print('OCR accuracy: edits, normalization, empty OCR, weighted scoring and comparison guards PASS')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--gold', type=Path)
    parser.add_argument('--results', type=Path, nargs='+')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if not args.gold or not args.results or not args.output:
            parser.error('--gold, --results and --output are required')
        gold = json.loads(args.gold.read_text(encoding='utf-8'))
        runs = [row for file in args.results for row in json.loads(file.read_text(encoding='utf-8'))['results']]
        result = score(gold, runs)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'Scored {len(result["rows"])} runs; raw OCR text is not included in scores.')
