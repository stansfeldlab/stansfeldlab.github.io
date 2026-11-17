#!/usr/bin/env python3
"""Per-residue data across every MemProtMD simulation.

Reads each simulation's files/contacts/by_resid_postprocess.csv from file storage and writes:

  memprotmd/data/residues/all.json             the Statistics page's tables and depth profiles, for all entries
  memprotmd/data/residues/<db>/<group>.json   the same for every group with at least MIN_GROUP entries
  <out>/memprotmd-residues.parquet             one row per residue of every entry, for analysis elsewhere
  .github/memprotmd/residues_state.json       which simulations went in, so a rebuild only runs when needed

The JSON files have the shape of data/stats.json (overview, detail, bins, groups), so the site draws them with
the same code. Contacts are scaled as there: glycine 0, the amino acid with most contact in each row 100.

Each entry read is kept in OUT/cache (restored between runs by the workflow), so a run stopped by --minutes
carries on where it left off: it then writes OUT/partial instead of the outputs, and the workflow starts itself again.

  python residues.py SITE OUT [--force] [--limit=N] [--minutes=M]
"""
import collections
import csv
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update as U  # noqa: E402  (shares the download helper, base address and file naming)

MIN_GROUP = 5
AAS = ['ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL']
ALIAS = {'HSD': 'HIS', 'HSE': 'HIS', 'HSP': 'HIS', 'HID': 'HIS', 'HIE': 'HIS', 'HIP': 'HIS', 'CYX': 'CYS', 'MSE': 'MET'}
AAI = {a: i for i, a in enumerate(AAS)}
# the measures summed per amino acid: the overview rows, then the detail rows
OVER = ['Solvent', 'Head', 'Tail']
DETAIL = ['Chloride', 'Sodium', 'Water', 'Choline', 'Phosphate', 'Glycerol', 'Tail 1', 'Tail 2', 'Tail 3', 'Tail 4']
MEAS = OVER + DETAIL
BINS = [(-50.0 + 4 * i, -46.0 + 4 * i) for i in range(25)]
# the Statistics page's amino acid groups for the depth profiles
HGROUPS = [('Negatively charged amino acids', ['ASP', 'GLU']), ('Positively charged amino acids', ['ARG', 'LYS']),
           ('Hydrophylic polar amino acids', ['ASN', 'GLN', 'HIS']), ('Not sure why these group together', ['GLY', 'PRO', 'SER', 'THR']),
           ('Aromatic amino acids', ['TRP', 'TYR']), ('Mildly hydrophobic amino acids', ['ALA', 'MET']),
           ('Hydrophobic amino acids with low molecular weights', ['CYS', 'VAL']), ('Hydrophobic amino acids', ['ILE', 'LEU', 'PHE'])]
NUM = ['z', 'rel_z_annular', 'head', 'tail', 'solvent', 'leaflet_a', 'leaflet_b', 'flip', 'water', 'ions',
       'choline', 'phosphate', 'glycerol', 'tail_1', 'tail_2', 'tail_3', 'tail_4']


def columns(head):
    """Which CSV columns feed each measure (lipid columns matched by bead, whatever the lipid)."""
    def bead(b):
        return [h for h in head if h.startswith('leaflet=') and h.endswith(';bead=' + b) and not h.startswith('leaflet=sol')]
    c = {'Solvent': ['group=Solvent'], 'Head': ['group=Head'], 'Tail': ['group=Tail'],
         'Chloride': [h for h in head if h.endswith('bead=Chloride')], 'Sodium': [h for h in head if h.endswith('bead=Sodium')],
         'Water': [h for h in head if h.endswith('bead=Water')]}
    for b in ('Choline', 'Phosphate', 'Glycerol', 'Tail_1', 'Tail_2', 'Tail_3', 'Tail_4'):
        c[b.replace('_', ' ')] = bead(b)
    return {k: [h for h in v if h in head] for k, v in c.items()}


def f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else 0.0
    except (TypeError, ValueError):
        return 0.0


def fetch(url, tries=3):
    """Like update.get, but with a short timeout, so one slow file cannot hold up the run."""
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=U.UA), timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    return None


def read_entry(pid):
    """One simulation's residues: (per-amino-acid sums, rows for the parquet file), or None if it has no file."""
    raw = fetch(U.DATA + 'simulations/%s_default_dppc/files/contacts/by_resid_postprocess.csv' % pid)
    if not raw:
        return None
    rd = csv.DictReader(io.StringIO(raw.decode('utf-8', 'replace')))
    head = rd.fieldnames or []
    if 'resName' not in head or 'z' not in head:
        return None
    cols = columns(head)
    sums = [[0.0] * (len(MEAS) + 1) for _ in AAS]   # per amino acid: the measures, then the residue count
    hist = [[0] * len(BINS) for _ in AAS]
    rows = []
    for r in rd:
        aa = ALIAS.get(r.get('resName'), r.get('resName'))
        v = {m: sum(f(r.get(h)) for h in cols[m]) for m in MEAS}
        z = f(r.get('z'))
        if aa in AAI:
            k = AAI[aa]
            for j, m in enumerate(MEAS):
                sums[k][j] += v[m]
            sums[k][-1] += 1
            b = int((z + 50) // 4)
            if 0 <= b < len(BINS):
                hist[k][b] += 1
        rows.append({'pdb': pid, 'chain': r.get('chainID') or '', 'instance': int(f(r.get('chainInstance')) or 1),
                     'resSeq': int(f(r.get('resSeq'))), 'iCode': r.get('iCode') or '', 'resName': r.get('resName') or '',
                     'dssp': r.get('DSSP') or '', 'z': z, 'rel_z_annular': f(r.get('rel_z_annular')),
                     'head': v['Head'], 'tail': v['Tail'], 'solvent': v['Solvent'], 'leaflet_a': f(r.get('leaflet=a')),
                     'leaflet_b': f(r.get('leaflet=b')), 'flip': f(r.get('leaflet=flip')), 'water': v['Water'],
                     'ions': v['Chloride'] + v['Sodium'], 'choline': v['Choline'], 'phosphate': v['Phosphate'],
                     'glycerol': v['Glycerol'], 'tail_1': v['Tail 1'], 'tail_2': v['Tail 2'], 'tail_3': v['Tail 3'], 'tail_4': v['Tail 4']})
    return sums, hist, rows


def summary(sums, hist):
    """Tables and depth profiles in the shape of data/stats.json, from summed per-amino-acid data."""
    n = [s[-1] for s in sums]
    have = [a for a in AAS if n[AAI[a]] > 0]
    if 'GLY' not in have or len(have) < 5:
        return None

    def table(labels, order):
        mean = {a: [sums[AAI[a]][MEAS.index(m)] / n[AAI[a]] for m in labels] for a in have}
        cols = sorted(have, key=lambda a: mean[a][labels.index(order)])
        rows = []
        for j, lab in enumerate(labels):
            g, top = mean['GLY'][j], max(mean[a][j] for a in have)
            rows.append({'label': lab, 'v': [0 if top == g else math.floor(100 * (mean[a][j] - g) / (top - g) + 0.5) for a in cols]})
        return {'cols': cols, 'rows': rows}
    groups = []
    for desc, aas in HGROUPS:
        aas = [a for a in aas if a in have]
        if aas:
            groups.append({'desc': desc, 'counts': {a: int(n[AAI[a]]) for a in aas},
                           'h': {a: [round(c / n[AAI[a]], 6) for c in hist[AAI[a]]] for a in aas}})
    return {'overview': table(OVER, 'Tail'), 'detail': table(DETAIL, 'Tail 2'), 'bins': [list(b) for b in BINS], 'groups': groups,
            'residues': int(sum(n))}


def main(site, out, force=False, limit=None, minutes=None):
    idx = json.load(open(os.path.join(site, 'data', 'index.json')))
    pids = sorted(r[0] for r in idx['pdb'])[:limit] if limit else sorted(r[0] for r in idx['pdb'])
    here = os.path.dirname(os.path.abspath(__file__))
    state_path = os.path.join(here, 'residues_state.json')
    state = U.load(state_path, {})
    stamp = {}
    for p in pids:
        e = U.load(os.path.join(site, 'data', 'entries', p + '.json'), {}) or {}
        stamp[p] = str(((e.get('sim') or {}).get('sim_complete_time')) or '')
    if not force and state.get('sims') == stamp:
        print('Residues: no simulation has changed since the last build; nothing to do')
        return False
    import pyarrow as pa
    import pyarrow.parquet as pq
    schema = pa.schema([('pdb', pa.string()), ('chain', pa.string()), ('instance', pa.int16()), ('resSeq', pa.int32()), ('iCode', pa.string()),
                        ('resName', pa.string()), ('dssp', pa.string())] + [(c, pa.float32()) for c in NUM])
    cache = os.path.join(out, 'cache')
    os.makedirs(cache, exist_ok=True)
    for fn in ('partial', 'changed'):
        if os.path.exists(os.path.join(out, fn)):
            os.remove(os.path.join(out, fn))

    def cached(p):
        c = U.load(os.path.join(cache, p + '.json'), None)
        return c if c and c.get('stamp') == stamp[p] else None
    todo = [p for p in pids if not cached(p)]
    print('Residues: %d of %d entries to read (the rest are cached)' % (len(todo), len(pids)), flush=True)
    deadline = time.time() + minutes * 60 if minutes else None

    def work(p):
        if deadline and time.time() > deadline:
            return p, 'late'
        return p, read_entry(p)
    late = 0
    with ThreadPoolExecutor(8) as ex:
        for i, (p, res) in enumerate(ex.map(work, todo)):
            if res == 'late':
                late += 1
                continue
            if res is not None and res[2]:
                pq.write_table(pa.Table.from_pylist(res[2], schema=schema), os.path.join(cache, p + '.parquet'))
            U.dump(os.path.join(cache, p + '.json'), {'stamp': stamp[p], 'sums': res and res[0], 'hist': res and res[1]})
            if i % 500 == 0:
                print('Residues: %d of %d read' % (i, len(todo)), flush=True)
    if late:
        open(os.path.join(out, 'partial'), 'w').write(str(late))
        print('Residues: stopped at the time limit with %d entries still to read; the next run carries on' % late)
        return False
    per = {}
    missing = []
    pq_path = os.path.join(out, 'memprotmd-residues.parquet')
    writer = pq.ParquetWriter(pq_path, schema, compression='zstd')
    for p in pids:
        c = cached(p)
        if not c or not c.get('sums'):
            missing.append(p)
            continue
        per[p] = (c['sums'], c['hist'])
        if os.path.exists(os.path.join(cache, p + '.parquet')):
            writer.write_table(pq.read_table(os.path.join(cache, p + '.parquet')))
    writer.close()
    print('Residues: %d entries read, %d without a contacts file; parquet %.0f MB' % (len(per), len(missing), os.path.getsize(pq_path) / 1e6))

    def add(members):
        S = [[0.0] * (len(MEAS) + 1) for _ in AAS]
        Hh = [[0] * len(BINS) for _ in AAS]
        k = 0
        for p in members:
            if p not in per:
                continue
            k += 1
            s, h = per[p]
            for a in range(len(AAS)):
                for j in range(len(MEAS) + 1):
                    S[a][j] += s[a][j]
                for b in range(len(BINS)):
                    Hh[a][b] += h[a][b]
        return S, Hh, k
    base = os.path.join(site, 'data', 'residues')
    keep = set()
    S, Hh, k = add(per)
    top = summary(S, Hh)
    top['entries'] = k
    U.dump(os.path.join(base, 'all.json'), top)
    keep.add(os.path.join(base, 'all.json'))
    written = 0
    for db, rows in idx['cols'].items():
        for c in rows:
            members = c[5].split()
            if len(members) < MIN_GROUP:
                continue
            S, Hh, k = add(members)
            if k < MIN_GROUP:
                continue
            sm = summary(S, Hh)
            if not sm:
                continue
            sm['entries'] = k
            path = os.path.join(base, db, U.enc(c[0]) + '.json')
            U.dump(path, sm)
            keep.add(path)
            written += 1
    for root, _, files in os.walk(base):   # groups that dropped below the threshold or were removed
        for fn in files:
            if os.path.join(root, fn) not in keep:
                os.remove(os.path.join(root, fn))
    U.dump(state_path, {'sims': stamp, 'entries': len(per), 'groups': written, 'missing': missing})
    open(os.path.join(out, 'changed'), 'w').write('yes')
    print('Residues: summaries for all entries and %d groups' % written)
    return True


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    lim = next((int(x.split('=')[1]) for x in sys.argv[1:] if x.startswith('--limit=')), None)
    mins = next((float(x.split('=')[1]) for x in sys.argv[1:] if x.startswith('--minutes=')), None)
    main(a[0], a[1], force='--force' in sys.argv, limit=lim, minutes=mins)
