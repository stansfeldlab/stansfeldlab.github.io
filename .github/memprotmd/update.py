"""Daily MemProtMD update: rebuild the site's data from the MemProtMD database at Oxford.

Reads the Oxford API (refs and simulations) and a few shared files, then rewrites, inside
memprotmd/:

  data/index.json, data/entries/<pdb>.json, data/groups/<db>.json, data/status.json
  thumbs/pdb/<pdb>.jpg and thumbs/<db>/<acc>.jpg   (only new or changed ones are downloaded)
  pdb/<pdb>/index.html, sitemap.xml, data/entries.tsv, data/release.json   (via pages_build)

Entries whose simulation has not changed keep their chain profile; only new or updated
simulations have their profile CSV and thumbnail fetched again. Nothing is written unless an
entry, a group or the pipeline status has actually changed, so most daily runs publish nothing.
The run also stops without writing anything if the database looks incomplete (far fewer entries
than the site already has).

Usage: python3 update.py <site_dir> [--dry-run]
"""
import collections
import csv
import datetime
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request

ORIGIN = os.environ.get('MEMPROTMD_ORIGIN', 'https://memprotmd.bioch.ox.ac.uk')
API = ORIGIN + '/api/search/advanced'
DATA = ORIGIN + '/data/memprotmd/'
DBS = ('mpm', 'TCDB', 'mpstruc', 'Pfam')
MIN_FRACTION = 0.98   # refuse to publish if the database has fewer than 98% of the entries already on the site
REF_FIELDS = ('title', 'subtitle', 'first_published', 'mean_thickness', 'keywords', 'experimental_method', 'primary_authors',
              'resolution', 'sim_chains_meta', 'ligands', 'entities', 'primary_citation')
SIM_FIELDS = ('thinning', 'sim_complete_time', 'leaflet_summary', 'sim_validate', 'chains', 'composition', 'n_chains')
GROUP_DETAIL = ('description', 'description_copyright', 'keywords_string', 'auto_keywords', 'href', 'copyright', 'subtitle')
UA = {'User-Agent': 'memprotmd-site-update (+https://stansfeldlab.github.io/memprotmd/)'}


def get(url, data=None, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=dict(UA, **({'Content-Type': 'application/json'} if data else {})))
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            err = e
        time.sleep(5 * (i + 1))
    raise RuntimeError('could not fetch %s: %s' % (url, err))


def api(collection, query, fields):
    body = json.dumps({'collectionName': collection, 'query': query, 'projection': {f: 1 for f in fields}, 'options': {}}).encode()
    out = json.loads(get(API, body))
    if not isinstance(out, list):
        raise RuntimeError('unexpected API answer for %s: %s' % (collection, str(out)[:200]))
    return out


def r3(v):
    # round half up, as the original export did (JavaScript Math.round), so unchanged values stay identical
    if isinstance(v, float):
        return math.floor(v * 1000 + 0.5) / 1000
    if isinstance(v, dict):
        return {k: r3(x) for k, x in v.items()}
    if isinstance(v, list):
        return [r3(x) for x in v]
    return v


def enc(p):
    return re.sub(r'[^A-Za-z0-9]', lambda m: '-%02x' % ord(m.group(0)), p)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def profile(text):
    """Residue density along the bilayer normal per chain, from relative_z_histogram.csv."""
    def ok(r):
        try:
            float(r['min_val']); float(r['max_val']); return True
        except (TypeError, ValueError, KeyError):
            return False
    rows = [r for r in csv.DictReader(io.StringIO(text)) if ok(r)]
    if not rows:
        return None
    lo = min(float(r['min_val']) for r in rows)
    w = float(rows[0]['max_val']) - float(rows[0]['min_val'])
    if w <= 0:
        return None
    ch = collections.defaultdict(dict)
    for r in rows:
        ch[r['chainID'] or '_all'][int(round((float(r['min_val']) - lo) / w))] = tuple(num(r.get(k)) for k in ('z', 'alpha', 'beta'))
    nb = max(max(v) for v in ch.values()) + 1
    out = {}
    for c, bins in ch.items():
        if c != '_all':
            arr = [bins.get(i, (0, 0, 0)) for i in range(nb)]
            out[c] = [[round(x[k], 4) for x in arr] for k in range(3)]
    return {'lo': round(lo, 2), 'w': round(w, 3), 'c': out} if out else None


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def dump(path, obj, pretty=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    s = json.dumps(obj, indent=2 if pretty else None, separators=None if pretty else (',', ':'), ensure_ascii=False)
    try:
        with open(path) as f:
            same = json.load(f) == json.loads(s)   # ignore key order and formatting
    except (OSError, ValueError):
        same = False
    if not same:
        with open(path, 'w') as f:
            f.write(s)
        return True
    return False


def main(site, dry):
    t0 = time.time()
    old = load(os.path.join(site, 'data', 'index.json'), {'pdb': [], 'cols': {}})
    state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'state.json')
    state = load(state_path, {})
    old_state = dict(state)

    refs = api('refs', {'db': 'PDB'}, REF_FIELDS + ('accession', 'in_collections', 'db_version'))
    sims = api('simulations', {}, SIM_FIELDS + ('accession', 'last_update_time'))
    groups = api('refs', {'db': {'$in': list(DBS)}}, ('db', 'accession', 'title', 'subtitle', 'parent', 'n_simulations', 'collection_members.accession') + GROUP_DETAIL)
    version = max((r.get('db_version') or '' for r in refs), default='')
    release = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')   # the date this release is published

    sim_by = {s['accession']: s for s in sims if s.get('accession') and s.get('sim_complete_time')}
    ref_by = {r['accession']: r for r in refs if r.get('accession') in sim_by}
    n_old = len(old.get('pdb') or [])
    print('database %s: %d PDB records, %d finished simulations, %d published; site has %d' % (version, len(refs), len(sim_by), len(ref_by), n_old))
    if n_old and len(ref_by) < MIN_FRACTION * n_old:
        raise SystemExit('Stopping: the database lists %d entries but the site already has %d. Nothing was changed.' % (len(ref_by), n_old))

    old_ids = {r[0] for r in old.get('pdb') or []}
    new_ids, changed_ids, removed = sorted(set(ref_by) - old_ids), [], sorted(old_ids - set(ref_by))
    entries_dir = os.path.join(site, 'data', 'entries')
    written, pending = 0, {}
    for pid in sorted(ref_by):
        ref, sim = ref_by[pid], sim_by[pid]
        stamp = sim.get('last_update_time') or sim.get('sim_complete_time')
        path = os.path.join(entries_dir, pid + '.json')
        prev = load(path, None)
        # fetch the profile and thumbnail again only for new entries and simulations that changed since the last run
        fresh = pid in new_ids or prev is None or (pid in state and state[pid] != stamp)
        rec = {'ref': r3({k: ref[k] for k in REF_FIELDS if k in ref}), 'sim': r3({k: sim[k] for k in SIM_FIELDS if k in sim})}
        if fresh:
            if pid not in new_ids:
                changed_ids.append(pid)
            csvt = get(DATA + 'simulations/%s_default_dppc/files/contacts/relative_z_histogram.csv' % pid)
            p = profile(csvt.decode('utf-8', 'replace')) if csvt else None
            if not dry:
                img = get(DATA + 'databases/PDB/thumbs/%s_250.jpg' % pid)
                if img:
                    os.makedirs(os.path.join(site, 'thumbs', 'pdb'), exist_ok=True)
                    with open(os.path.join(site, 'thumbs', 'pdb', pid + '.jpg'), 'wb') as f:
                        f.write(img)
        else:
            p = (prev or {}).get('prof')
        if p:
            rec['prof'] = p
        state[pid] = stamp
        if prev != json.loads(json.dumps(rec, ensure_ascii=False)):
            pending[path] = rec
    written = len(pending)
    for pid in removed:
        state.pop(pid, None)

    # groups: keep the existing order, add new ones at the end
    by_db = collections.defaultdict(dict)
    for g in groups:
        if g.get('db') in DBS and g.get('accession'):
            by_db[g['db']][g['accession']] = g
    cols, details = {}, {}
    for db in DBS:
        order = [c[0] for c in (old.get('cols') or {}).get(db, []) if c[0] in by_db[db]]
        order += sorted(set(by_db[db]) - set(order))
        rows = []
        for acc in order:
            g = by_db[db][acc]
            mem = sorted({m.get('accession') for m in g.get('collection_members') or [] if m.get('accession') in ref_by})
            n = g.get('n_simulations') or len(mem)
            rows.append([acc, g.get('title') or acc, n, g.get('parent') or 0, g.get('subtitle') or 0, ' '.join(mem)])
            d = {k: g[k] for k in GROUP_DETAIL if g.get(k)}
            if isinstance(d.get('copyright'), dict):
                d['copyright'] = {k: d['copyright'][k] for k in ('owner', 'origin', 'terms') if k in d['copyright']}
            if d:
                details.setdefault(db, {})[db + '|' + acc] = d
        cols[db] = rows

    # thumbnails: new entries and groups without one yet
    no_t = sorted(pid for pid in ref_by if not os.path.exists(os.path.join(site, 'thumbs', 'pdb', pid + '.jpg')))
    no_g = []
    for db, rows in cols.items():
        for c in rows:
            f = os.path.join(site, 'thumbs', db, enc(c[0]) + '.jpg')
            if os.path.exists(f):
                continue
            img = None if dry else get(DATA + 'databases/%s/thumbs/%s_100.jpg' % (db, c[0]))
            if img:
                os.makedirs(os.path.dirname(f), exist_ok=True)
                with open(f, 'wb') as fh:
                    fh.write(img)
            else:
                no_g.append(db + '|' + c[0])

    # thickness histograms per MemProtMD group
    thick = old.get('thick') or {}
    st = get(DATA + 'databases/mpm/stats.csv')
    if st:
        t = collections.defaultdict(dict)
        for r in csv.DictReader(io.StringIO(st.decode('utf-8', 'replace'))):
            if r.get('metric') == 'thickness':
                t[r['accession']][r['bin']] = num(r['density'])
        if t:
            thick = dict(t)

    def row(pid, r):
        sub = r.get('subtitle') if r.get('subtitle') and r.get('subtitle') != r.get('title') else 0
        return [pid, r.get('title') or 0, sub, r.get('experimental_method') or 0, r.get('resolution') or 0, r.get('first_published') or 0]
    index = {'pdb': [row(p, r3(ref_by[p])) for p in sorted(ref_by)], 'cols': cols, 'thick': thick, 'snap': old.get('snap') or {},
             'noThumb': no_t, 'noGroupThumb': sorted(no_g), 'built': release}

    # pipeline status, from the pipeline's own status file
    status = load(os.path.join(site, 'data', 'status.json'), {'written': release, 'jobs': []})
    raw = get(DATA + 'databases/cgdb/status.latest.yml')
    counts = collections.Counter()
    if raw:
        import yaml
        y = yaml.safe_load(raw) or {}
        jobs, stalled = [], []
        for pid, j in (y.get('pdb_ids') or {}).items():
            if not isinstance(j, dict):
                continue
            st, when, errs = str(j.get('status') or ''), str(j.get('time') or '')[:10], j.get('errors') or []
            counts[st + (' (stalled)' if errs else '')] += 1
            if st not in ('identified', 'simulating', 'converting', 'analysing'):
                continue
            item = {'id': str(pid), 'status': st, 'time': when}
            if not errs:
                jobs.append(item)
            elif str(pid) not in ref_by:   # published entries can carry stale flags; only unpublished ones are held up
                item['error'] = '; '.join(str(e.get('error', e)) if isinstance(e, dict) else str(e) for e in errs)
                stalled.append(item)
        wr = y.get('mpm_job_written')
        status = {'written': datetime.datetime.fromtimestamp(wr, datetime.timezone.utc).strftime('%Y-%m-%d') if isinstance(wr, (int, float)) else release,
                  'jobs': sorted(jobs, key=lambda j: j['time'], reverse=True), 'stalled': sorted(stalled, key=lambda j: j['time'], reverse=True)}

    # publish only when something real has changed, not just the database's date stamp
    def strip(d, *keys):
        return {k: v for k, v in (d or {}).items() if k not in keys}
    old_status = load(os.path.join(site, 'data', 'status.json'), {})
    groups_changed = any(load(os.path.join(site, 'data', 'groups', db + '.json'), None) != json.loads(json.dumps(d, ensure_ascii=False)) for db, d in details.items())
    reasons = [x for x, c in (('entries', pending or new_ids or removed), ('index', strip(index, 'built') != strip(old, 'built')),
                               ('groups', groups_changed), ('pipeline status', strip(status, 'written') != strip(old_status, 'written')),
                               ('change tracking', state != old_state)) if c]
    if not reasons:
        index['built'] = release = old.get('built') or release

    summary = ['MemProtMD update, database version %s' % version,
               ('Changed: %s, so this run publishes release %s' % (', '.join(reasons), release)) if reasons else 'Nothing has changed since release %s, so nothing is published' % release,
               '%d entries (%+d): %d new, %d updated, %d removed; %d entry records changed' % (len(ref_by), len(ref_by) - n_old, len(new_ids), len(changed_ids), len(removed), written),
               'New: ' + (', '.join(new_ids[:40]) + (' …' if len(new_ids) > 40 else '') if new_ids else 'none'),
               'Pipeline status (%s): %d in progress, %d stalled; %s' % (status.get('written'), len(status.get('jobs') or []), len(status.get('stalled') or []), dict(counts.most_common()))]
    if dry:
        idx_diff = json.dumps(index, sort_keys=True) != json.dumps(old, sort_keys=True)
        cdiff = {db: sum(1 for a, b in zip(cols[db], (old.get('cols') or {}).get(db, [])) if a != b) + abs(len(cols[db]) - len((old.get('cols') or {}).get(db, []))) for db in DBS}
        summary.append('Dry run: index differs=%s; group rows differing per collection %s; thick same=%s' % (idx_diff, cdiff, thick == old.get('thick')))
    elif reasons:
        for path, rec in pending.items():
            dump(path, rec)
        for pid in removed:
            if os.path.exists(os.path.join(entries_dir, pid + '.json')):
                os.remove(os.path.join(entries_dir, pid + '.json'))
        dump(os.path.join(site, 'data', 'index.json'), index)
        for db, d in details.items():
            dump(os.path.join(site, 'data', 'groups', db + '.json'), d)
        dump(os.path.join(site, 'data', 'status.json'), status)
        with open(state_path, 'w') as f:
            json.dump(state, f, sort_keys=True, separators=(',', ':'))
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import pages_build
        pages_build.main(site)
    summary.append('Took %.0f s' % (time.time() - t0))
    print('\n'.join(summary))
    out = os.environ.get('GITHUB_STEP_SUMMARY')
    if out:
        with open(out, 'a') as f:
            f.write('\n\n'.join(summary) + '\n')
    gh = os.environ.get('GITHUB_OUTPUT')
    if gh:
        with open(gh, 'a') as f:
            f.write('release=%s\nnew=%d\nchanged=%d\npublish=%s\n' % (release, len(new_ids), len(changed_ids), 'true' if reasons else 'false'))


if __name__ == '__main__':
    main(sys.argv[1], '--dry-run' in sys.argv[2:])
