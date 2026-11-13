"""MemProtMD update, run four times a day: rebuild the site's data from the MemProtMD database at Oxford.

Reads the Oxford API (refs and simulations) and a few shared files, then rewrites, inside
memprotmd/:

  data/index.json, data/entries/<pdb>.json, data/groups/<db>.json, data/status.json, data/stats.json
  thumbs/pdb/<pdb>.jpg and thumbs/<db>/<acc>.jpg   (only new or changed ones are downloaded)
  pdb/<pdb>/index.html, sitemap.xml, data/entries.tsv, data/release.json   (via pages_build)

Entries whose simulation has not changed keep their chain profile; only new or updated
simulations have their profile CSV and thumbnail fetched again. Nothing is written unless an
entry, a group or the pipeline status has actually changed, so most runs publish nothing.

Changes go live as soon as they are found. Releases are weekly: on the first run of each Monday,
if anything changed since the last release, the data is labelled with that Monday's date
(index.json "built", release.json "release") and the workflow attaches a snapshot to a GitHub
release. Between releases, "updated" records the date of the latest change.
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
import urllib.parse
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
RCSB_GQL = 'https://data.rcsb.org/graphql'
ORG_QUERY = ('query($ids:[String!]!){entries(entry_ids:$ids){rcsb_id polymer_entities{'
             'rcsb_polymer_entity_container_identifiers{auth_asym_ids} '
             'rcsb_entity_source_organism{scientific_name ncbi_taxonomy_id taxonomy_lineage{name}} '
             'uniprots{rcsb_id rcsb_uniprot_protein{name{value}}} '
             'rcsb_polymer_entity_annotation{annotation_id type name}}}}')
DOMAINS = ('Bacteria', 'Archaea', 'Eukaryota', 'Viruses')
IN_MEMBRANE = ('membrane spanning', 'membrane embedded', 'single leaflet')
UA = {'User-Agent': 'memprotmd-site-update (+https://stansfeldlab.github.io/memprotmd/)'}
TCDB_PUBLIC = 'https://www.tcdb.org/cgi-bin/projectv/public/'
MDDB_API = 'https://mdposit.mddbr.eu/api/rest/v1/projects'
TCDB_FASTA = 'https://www.tcdb.org/public/tcdb'
MPSTRUC_XML = 'https://blanco.biomol.uci.edu/mpstruc/listAll/mpstrucTblXml'
TCDB_MIN = {'acc': 5000, 'pdb': 200, 'fam': 500}   # fewer rows than this means TCDB sent something else (an error page)
# TCDB's families list has no subclass names; these are the subclasses Oxford's mapping does not already name
TC_SUBCLASS = {'1.D': 'Non-ribosomally Synthesized Channels', '1.E': 'Holins', '1.I': 'Membrane-bounded Channels',
               '2.B': 'Nonribosomally synthesized porters', '3.C': 'Methyltransfer-driven transporters',
               '4.B': 'Nicotinamide ribonucleoside uptake transporters', '4.C': 'Acyl CoA ligase-coupled transporters',
               '4.E': 'Vacuolar Polyphosphate Polymerases'}
TC_ID = re.compile(r'^[1-9]\.[A-Z]\.\d+\.\d+\.\d+$')


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


def membrane_chains(ref):
    return {c.get('chainID') for c in (ref or {}).get('sim_chains_meta') or [] if c.get('tm') in IN_MEMBRANE}


def rcsb_lookup(refs, pids):
    """Source organisms and UniProt protein names for each entry, from the RCSB PDB.

    Returns {pdb: {"o": [[scientific name, NCBI taxonomy id, domain], ...], "u": {accession: name},
    "um": [UniProt accessions of the membrane chains], "pf": {Pfam id: name, for the membrane chains}}}.
    Organisms come only from polymer entities that contain a chain placed in the membrane (so an
    antibody or nanobody bound to a human protein does not add its species); if none qualify, all
    polymer entities are used.
    """
    out = {}
    for i in range(0, len(pids), 100):
        batch = [p.upper() for p in pids[i:i + 100]]
        try:
            r = json.loads(get(RCSB_GQL, json.dumps({'query': ORG_QUERY, 'variables': {'ids': batch}}).encode()))
        except (RuntimeError, ValueError) as e:
            print('RCSB lookup failed for a batch, will retry next run:', e)
            continue
        for e in (r.get('data') or {}).get('entries') or []:
            if not e or not e.get('rcsb_id'):
                continue
            pid = e['rcsb_id'].lower()
            tm = membrane_chains(refs.get(pid))
            ents = e.get('polymer_entities') or []
            chosen = [x for x in ents if tm & set((x.get('rcsb_polymer_entity_container_identifiers') or {}).get('auth_asym_ids') or [])] or ents
            seen, uni, um, pf = {}, {}, [], {}
            for x in chosen:
                for o in x.get('rcsb_entity_source_organism') or []:
                    name = (o.get('scientific_name') or '').strip()
                    if not name or name in seen:
                        continue
                    lineage = {l.get('name') for l in o.get('taxonomy_lineage') or []}
                    seen[name] = [name, o.get('ncbi_taxonomy_id') or 0, next((d for d in DOMAINS if d in lineage), '')]
            for x in ents:
                for u in x.get('uniprots') or []:
                    nm = ((u.get('rcsb_uniprot_protein') or {}).get('name') or {}).get('value')
                    if u.get('rcsb_id') and nm:
                        uni[u['rcsb_id']] = nm
                    if u.get('rcsb_id') and x in chosen and u['rcsb_id'] not in um:
                        um.append(u['rcsb_id'])
            for x in chosen:
                for an in x.get('rcsb_polymer_entity_annotation') or []:
                    if an.get('type') == 'Pfam' and an.get('annotation_id'):
                        pf[an['annotation_id']] = an.get('name') or an['annotation_id']
            out[pid] = {'o': list(seen.values()), 'u': uni, 'um': um, 'pf': pf}
        for pid in batch:
            out.setdefault(pid.lower(), {'o': [], 'u': {}, 'um': [], 'pf': {}})   # obsolete or unreleased in the PDB
    return out


def norm_name(name):
    """Some records give species in capitals: "HOMO SAPIENS" -> "Homo sapiens"."""
    if name.isupper():
        w = name.split()
        return ' '.join([w[0].capitalize()] + [x.lower() for x in w[1:]])
    return name


def species(name, domain):
    """Group strains with their species: "Escherichia coli K-12" -> "Escherichia coli" (not for viruses)."""
    w = name.replace('(', ' ').split()
    return ' '.join(w[:2]) if domain in ('Bacteria', 'Archaea', 'Eukaryota') and len(w) >= 2 and w[0][:1].isupper() and w[1][:1].islower() else name


def topology(sim, ref):
    """Classify an entry by its membrane chains: ("alpha", most TM helices in one chain), ("beta", strands
    in the barrel; 0 if not all were found), ("unclassified", 0) when the chain analysis is missing or did
    not count helices and strands, or ("other", 0) when no chain was placed across the membrane.
    A barrel built from several chains (TolC, α-haemolysin) is counted by its strands in total."""
    ch = sim.get('chains') or []
    if not ch:
        return 'unclassified', 0
    a = max(c.get('tm_alpha') or 0 for c in ch)
    b = max(c.get('tm_beta') or 0 for c in ch)
    tb = sum((c.get('tm_beta') or 0) * (c.get('count') or 1) for c in ch)
    beta_meta = any(m.get('tm_ss') == 'beta' and m.get('tm') in IN_MEMBRANE for m in ref.get('sim_chains_meta') or [])
    if b >= 8:
        return 'beta', b
    if beta_meta:
        return 'beta', tb if tb >= 8 else 0
    if a >= 1:
        return 'alpha', a
    if any(c.get('type') in IN_MEMBRANE for c in ch):
        return 'unclassified', 0   # spans the membrane, but no helices or strands were counted
    return 'other', 0


def method_group(m):
    m = ' '.join(m) if isinstance(m, list) else str(m or '')
    return 'xray' if 'X-RAY' in m else 'em' if 'ELECTRON MICROSCOPY' in m else 'nmr' if 'NMR' in m else 'other'


def growth_stats(ref_by, rcsb, cols):
    """Distinct proteins (UniProt accessions of the membrane chains) and Pfam families per year: each is
    counted in the year its first structure was released, under that structure's experimental method."""
    first = {}
    def see(measure, acc, pid):
        d = str(ref_by[pid].get('first_published') or '')
        if d[:4].isdigit() and ((measure, acc) not in first or (d, pid) < first[(measure, acc)]):
            first[(measure, acc)] = (d, pid)
    for pid, ref in ref_by.items():
        tm = membrane_chains(ref)
        ents = ref.get('entities') or []
        mine = [en for en in ents if tm & set(str(en.get('chains') or '').split(','))] or ents
        accs = [x['accession'] for en in mine for x in en.get('refs') or [] if x.get('db') == 'UniProt' and x.get('accession')]
        for a in set(accs + ((rcsb.get(pid) or {}).get('um') or [])):
            see('uniprot', a, pid)
    for c in cols.get('Pfam') or []:
        for pid in (c[5] or '').split():
            if pid in ref_by:
                see('pfam', c[0], pid)
    years = [int(str(r.get('first_published'))[:4]) for r in ref_by.values() if str(r.get('first_published') or '')[:4].isdigit()]
    y0, y1 = min(years), max(years)
    out = {'years': [y0, y1]}
    for m in ('uniprot', 'pfam'):
        per = {g: [0] * (y1 - y0 + 1) for g in ('all', 'xray', 'em', 'nmr', 'other')}
        for (mm, acc), (d, pid) in first.items():
            if mm == m:
                i = int(d[:4]) - y0
                per['all'][i] += 1
                per[method_group(ref_by[pid].get('experimental_method'))][i] += 1
        out[m] = {'total': sum(per['all']), 'per': per}
    return out


def tcdb_tables(path, ref_by, rcsb):
    """TCDB's own lists: UniProt accession -> TC numbers (acc2tcid), PDB code -> TC numbers (pdb) and
    TC family names (families). Downloaded every run and cut down to what MemProtMD entries use; if
    TCDB cannot be reached, the copy saved in tcdb.json at the last successful download is used."""
    saved = load(path, {})
    accs = set()
    for p in ref_by:
        r = rcsb.get(p) or {}
        accs.update(r.get('u') or {})
        accs.update(r.get('um') or [])
    out = {}
    for key, name in (('acc', 'acc2tcid.py'), ('pdb', 'pdb.py'), ('fam', 'families.py')):
        try:
            raw = get(TCDB_PUBLIC + name, tries=2) or b''
        except RuntimeError as e:
            print('TCDB: %s could not be downloaded (%s)' % (name, e))
            raw = b''
        rows = collections.defaultdict(set)
        for line in raw.decode('utf-8', 'replace').splitlines():
            f = [x.strip() for x in line.split('\t')]
            if len(f) < 2 or not f[0] or not f[1]:
                continue
            if key == 'fam':
                if re.match(r'^[1-9](\.[A-Z](\.\d+){0,3})?$', f[0]):
                    rows[f[0]].add(f[1])
            elif TC_ID.match(f[1]):
                rows[f[0].upper() if key == 'acc' else f[0].lower()].add(f[1])
        if len(rows) < TCDB_MIN[key]:   # missing or not the expected list: keep the saved copy
            print('TCDB: %s gave %d rows, using the saved copy' % (name, len(rows)))
            out[key] = saved.get(key) or {}
            continue
        keep = accs if key == 'acc' else set(ref_by) if key == 'pdb' else None
        out[key] = {k: (sorted(v)[0] if key == 'fam' else sorted(v)) for k, v in sorted(rows.items()) if keep is None or k in keep}
    return out


def tcdb_fill(cols, details, no_g, ref_by, rcsb, tc):
    """Place entries that have no TCDB family from Oxford (its mapping stops in 2020) using TCDB's own
    lists: the entry's PDB code, or the UniProt accession of any of its chains. Groups new to MemProtMD
    are created down from the TC class, named as Oxford named them (subfamilies and systems take
    their family's name). Returns the number of entries placed."""
    rows = {c[0]: c for c in cols.get('TCDB') or []}
    if 'TCDB' not in rows:
        return 0
    placed = set()
    for acc, c in rows.items():
        if acc != 'TCDB':
            placed.update(c[5].split())
    fam = tc.get('fam') or {}
    add, n = collections.defaultdict(set), 0
    for pid in sorted(ref_by):
        if pid in placed:
            continue
        r = rcsb.get(pid) or {}
        found = set((tc.get('pdb') or {}).get(pid) or [])
        for a in set(r.get('u') or {}) | set(r.get('um') or []):
            found.update((tc.get('acc') or {}).get(a) or [])
        if not found:
            continue
        n += 1
        add['TCDB'].add(pid)
        for t in found:
            parts = t.split('.')
            for k in range(1, 6):
                add['.'.join(parts[:k])].add(pid)
    for t in sorted(add, key=lambda x: (x.count('.'), x)):
        if t in rows:
            continue
        parts = t.split('.')
        family = '.'.join(parts[:3])
        title = fam.get(t) or TC_SUBCLASS.get(t) or (len(parts) > 3 and (fam.get(family) or (rows.get(family) or [0, 0])[1])) or 'TC ' + t
        rows[t] = [t, title, 0, 'TCDB|' + ('.'.join(parts[:-1]) if len(parts) > 1 else 'TCDB'), 0, '']
        cols['TCDB'].append(rows[t])
        no_g.append('TCDB|' + t)
        page = 'https://www.tcdb.org/search/result.php?tc=' + t
        details.setdefault('TCDB', {})['TCDB|' + t] = {'href': page, 'copyright': {'owner': 'Saier Lab', 'origin': page, 'terms': 'https://www.tcdb.org/aboutus.php'}}
    for t, pids in add.items():
        c = rows[t]
        m = sorted(set(c[5].split()) | pids)
        c[5], c[2] = ' '.join(m), len(m)
    return n


def protein_name(desc):
    """A TCDB FASTA description as [protein name, species]: 'Chain A, ' prefixes, alternative names in
    brackets and UniProt's [Cleaved into: ...] notes are dropped."""
    d = urllib.parse.unquote(desc).strip()
    d = re.sub(r'^Chain [^,]+,\s*', '', d)
    species = ''
    if ' - ' in d:
        d, species = d.rsplit(' - ', 1)
        species = re.sub(r'\s*\([^()]*\)\s*$', '', species.strip().rstrip('.')).strip()
    d = re.sub(r'\s*\[(Cleaved into|Includes|Contains)[^\]]*\]', '', d)
    name = d.strip()
    while True:   # drop trailing bracketed alternative names, allowing one level of brackets inside
        cut = re.sub(r'\s*\((?:[^()]|\([^()]*\))*\)\s*$', '', name).strip()
        if cut == name or not cut:
            break
        name = cut
    return [name[:150], species[:80]]


def tcdb_names(saved, want, refresh):
    """Protein names for TCDB systems, from TCDB's FASTA file: {TC id: [[accession, name, species], ...]}
    for the systems in want. Downloaded on the daily run; otherwise, or if TCDB cannot be reached, the
    saved names are used."""
    if saved and not refresh:
        return saved
    try:
        raw = get(TCDB_FASTA, tries=2) or b''
    except RuntimeError as e:
        print('TCDB: the FASTA file could not be downloaded (%s)' % e)
        return saved
    out = collections.defaultdict(list)
    for line in raw.decode('utf-8', 'replace').splitlines():
        m = re.match(r'^>gnl\|TC-DB\|([^|]+)\|(\S+)\s+(.*)$', line)
        if m and m.group(2) in want and len(out[m.group(2)]) < 12:
            out[m.group(2)].append([m.group(1)] + protein_name(m.group(3)))
    if len(out) < 0.5 * len(want):
        print('TCDB: the FASTA file named only %d of %d systems, using the saved names' % (len(out), len(want)))
        return saved
    return dict(sorted(out.items()))


def tcdb_titles(cols, names, rcsb):
    """Give TCDB systems their protein's name (and species as subtitle), and subfamilies the name of
    their largest system, instead of the family name both carry from Oxford. The protein chosen for
    a system is one of its member entries' own proteins where TCDB lists one."""
    rows = cols.get('TCDB') or []
    systems = [c for c in rows if c[0].count('.') == 4]
    for c in systems:
        cand = names.get(c[0]) or []
        if not cand:
            continue
        mem = c[5].split()
        accs = set()
        for p in mem:
            accs.update((rcsb.get(p) or {}).get('u') or {})
        pick = next((x for x in cand if x[0] in accs or x[0].split('_')[0].lower() in mem), cand[0])
        c[1], c[4] = pick[1], pick[2] or 0
    for c in rows:
        if c[0].count('.') == 3:
            kids = [k for k in systems if k[3] == 'TCDB|' + c[0]]
            named = sorted((k for k in kids if names.get(k[0])), key=lambda k: (-k[2], k[0]))
            if named:
                c[1] = named[0][1] + (' and related proteins' if len(kids) > 1 else '')


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def mpstruc_tables(path, ref_by, refresh):
    """mpstruc's own list (its XML download), cut down to MemProtMD entries: {"nodes": {key: [title,
    parent key]}, "pdb": {pdb: key of the protein it is listed under}}. Keys follow Oxford's: a slug of
    the group or subgroup name, protein-<pdb> for a protein and protein-<pdb>-<pdb> for a member
    protein. Downloaded on the daily run; otherwise, or if mpstruc cannot be reached, the copy saved
    in mpstruc.json is used."""
    import xml.etree.ElementTree as ET
    saved = load(path, {})
    if saved.get('pdb') and not refresh:
        return saved
    try:
        root = ET.fromstring(get(MPSTRUC_XML, tries=2) or b'')
    except (RuntimeError, ET.ParseError) as e:
        print('mpstruc: the list could not be read (%s), using the saved copy' % e)
        return saved
    nodes, where = {}, {}

    def text(e, tag):
        return re.sub(r'\s+', ' ', e.findtext(tag) or '').strip()

    def related(e):
        return [c.text.strip().lower() for c in e.findall('relatedPdbEntries/pdbCode') if c.text and c.text.strip()]
    for g in root.iter('group'):
        gk = slug(text(g, 'name'))
        nodes[gk] = [text(g, 'name'), 'mpstruc']
        holders = [(gk, g)]
        for sg in g.findall('subgroups/subgroup'):
            sk = slug(text(sg, 'name'))
            nodes[sk] = [text(sg, 'name'), gk]
            holders.append((sk, sg))
        for hk, h in holders:
            for pr in h.findall('proteins/protein'):
                pc = text(pr, 'pdbCode').lower()
                if not pc:
                    continue
                pk = 'protein-' + pc
                nodes[pk] = [text(pr, 'name') or pc.upper(), hk]
                for c in [pc] + related(pr):
                    where.setdefault(c, pk)
                for mp in pr.findall('memberProteins/memberProtein'):
                    mc = text(mp, 'pdbCode').lower()
                    if not mc:
                        continue
                    mk = pk + '-' + mc
                    nodes[mk] = [text(mp, 'name') or mc.upper(), pk]
                    for c in [mc] + related(mp):
                        where[c] = mk
    if len(where) < 3000:
        print('mpstruc: the list has only %d PDB codes, using the saved copy' % len(where))
        return saved
    pdb = {p: k for p, k in sorted(where.items()) if p in ref_by}
    keep = set()
    for k in pdb.values():
        while k in nodes and k not in keep:
            keep.add(k)
            k = nodes[k][1]
    print('mpstruc: %d PDB codes listed (newest protein %s), %d of them MemProtMD entries' % (len(where), root.get('lastNewProteinDate'), len(pdb)))
    return {'nodes': {k: nodes[k] for k in sorted(keep)}, 'pdb': pdb}


# Oxford's mpstruc tree is fixed (its mapping stopped in 2020); since then mpstruc has renamed four of its
# subgroups and split G protein-coupled receptors by class. Renamed subgroups keep Oxford's key, so old
# links still work, and the GPCR classes sit under Oxford's GPCR subgroup.
MPSTRUC_RENAMED = {'bacterial-algal-viral-and-unusual-rhodopsins': 'bacterial-algal-and-viral-rhodopsins',
                   'sec-translocase-and-insertase-proteins': 'sec-and-translocase-proteins',
                   'mitochondrial-outer-membrane-beta-barrel-proteins': 'beta-barrel-membrane-proteins-mitochondrial-outer-membrane',
                   'phospholipid-transferases': 'phosphoethanolamine-pea-transferases'}
MPSTRUC_GPCR = 'g-protein-coupled-receptors-gpcrs'


def mpstruc_build(cols, details, ref_by, ms):
    """mpstruc groups from mpstruc's current list (ms, from mpstruc_tables), so recent entries are
    placed and older ones follow mpstruc's current classification; entries mpstruc no longer lists
    keep Oxford's placement. Keys stay Oxford's wherever the group still exists. Returns the number of
    entries placed that Oxford had not placed."""
    old = {c[0]: c for c in cols.get('mpstruc') or []}
    if 'mpstruc' not in old or not ms.get('pdb'):
        return 0
    nodes = {}
    for k, (title, parent) in (ms.get('nodes') or {}).items():
        nodes[MPSTRUC_RENAMED.get(k, k)] = [title, MPSTRUC_RENAMED.get(parent, parent)]
    if MPSTRUC_GPCR in old:
        for k, v in nodes.items():
            if k != MPSTRUC_GPCR and v[1] == 'transmembrane-proteins-alpha-helical' and re.match(r'g[ -]protein[ -]coupled receptors', v[0], re.I):
                v[1] = MPSTRUC_GPCR
        nodes.setdefault(MPSTRUC_GPCR, [old[MPSTRUC_GPCR][1], 'transmembrane-proteins-alpha-helical'])

    def parent(k):
        if k in nodes:
            return nodes[k][1]
        return old[k][3][len('mpstruc|'):] if k in old and old[k][3] else None
    oxford = collections.defaultdict(set)
    for k, c in old.items():
        if k != 'mpstruc':
            for pid in c[5].split():
                oxford[pid].add(k)
    members, n = collections.defaultdict(set), 0
    for pid in sorted(ref_by):
        if pid in (ms.get('pdb') or {}):
            leaves = [ms['pdb'][pid]]
            leaves = [MPSTRUC_RENAMED.get(k, k) for k in leaves]
            n += pid not in oxford
        else:
            leaves = sorted(oxford.get(pid) or [])
        for k in leaves:
            seen = 0
            while k and k != 'mpstruc' and seen < 9:
                members[k].add(pid)
                k, seen = parent(k), seen + 1
            if k == 'mpstruc':
                members['mpstruc'].add(pid)
    note = next((v['copyright'] for v in (details.get('mpstruc') or {}).values() if v.get('copyright')), None)

    def depth(k):
        d = 0
        while k and k != 'mpstruc' and d < 9:
            k, d = parent(k), d + 1
        return d
    order = [k for k in old if k in members] + sorted((k for k in members if k not in old), key=lambda k: (depth(k), k))
    rows = []
    for k in order:
        title = nodes[k][0] if k in nodes else old[k][1]
        par = 0 if k == 'mpstruc' else 'mpstruc|' + parent(k)
        m = sorted(members[k])
        rows.append([k, title, len(m), par, old[k][4] if k in old else 0, ' '.join(m)])
        if k not in old and note:
            details.setdefault('mpstruc', {})['mpstruc|' + k] = {'copyright': note}
    cols['mpstruc'] = rows
    keep = {'mpstruc|' + k for k in members}
    details['mpstruc'] = {k: v for k, v in (details.get('mpstruc') or {}).items() if k in keep}
    return n


def mddb_lookup(ref_by):
    """How many MDDB simulations list each entry's PDB code (MDDB's PDBIDS field), as {pdb: count} for
    MemProtMD entries; None if MDDB's project list could not be read in full."""
    from concurrent.futures import ThreadPoolExecutor

    def page(n):
        return json.loads(get('%s?limit=100&page=%d' % (MDDB_API, n), tries=3) or b'{}')
    try:
        first = page(1)
        total = int(first.get('filteredCount') or 0)
        with ThreadPoolExecutor(6) as ex:
            pages = [first] + list(ex.map(page, range(2, (total + 99) // 100 + 1)))
    except (RuntimeError, ValueError, TypeError) as e:
        print('MDDB: could not read the project list, keeping the last counts:', e)
        return None
    projects = [x for pg in pages for x in pg.get('projects') or []]
    if total < 1000 or len(projects) < 0.95 * total:
        print('MDDB: got %d of %d projects, keeping the last counts' % (len(projects), total))
        return None
    out = collections.Counter()
    for x in projects:
        for pid in {str(i).lower() for i in (x.get('metadata') or {}).get('PDBIDS') or []}:
            if pid in ref_by:
                out[pid] += 1
    print('MDDB: %d projects, %d of them list %d MemProtMD entries' % (len(projects), sum(out.values()), len(out)))
    return dict(sorted(out.items()))


def contact_stats():
    """The residue contact tables and depth histograms on the Statistics page, from the pipeline's
    statistics over all simulations. Contacts are scaled as the original site scaled them: glycine 0,
    the highest amino acid 100, with columns ordered by tail contact. None if the files are missing."""
    import yaml
    try:
        sc = (yaml.safe_load(get(DATA + 'ensembles/statistics/contact_scales.latest.yml') or b'') or {})['scales']
        h = (yaml.safe_load(get(DATA + 'ensembles/statistics/resname_hists.latest.yml') or b'') or {})['hists']

        def table(which, labels, order):
            R = sc[which]['resNames']
            cols = sorted(R, key=lambda c: R[c][order])
            rows = []
            for label in labels:
                k = label.lower().replace(' ', '_')
                g, top = R['GLY'][k], max(R[c][k] for c in R)
                rows.append({'label': label, 'v': [math.floor(100 * (R[c][k] - g) / (top - g) + 0.5) for c in cols]})
            return {'cols': cols, 'rows': rows}
        keep = [i for i, b in enumerate(h['bins']) if b['minVal'] >= -50 and b['maxVal'] <= 50]
        return {'overview': table('byGroup', ('Solvent', 'Head', 'Tail'), 'tail'),
                'detail': table('byBead', ('Chloride', 'Sodium', 'Water', 'Choline', 'Phosphate', 'Glycerol', 'Tail 1', 'Tail 2', 'Tail 3', 'Tail 4'), 'tail_2'),
                'bins': [[h['bins'][i]['minVal'], h['bins'][i]['maxVal']] for i in keep],
                'groups': [{'desc': g['desc'], 'counts': g['counts'], 'h': {aa: [round(v[i], 6) for i in keep] for aa, v in g['hists'].items()}} for g in h['groups']]}
    except (RuntimeError, KeyError, TypeError, ValueError, ZeroDivisionError, yaml.YAMLError) as e:
        print('Statistics: could not rebuild from the pipeline files, keeping the last ones:', e)
        return None


def derived_groups(ref_by, sim_by, rcsb, old_cols):
    """Groupings worked out from the records themselves: protein (UniProt), organism, membrane topology
    and bound ligand. Returns ({db: rows}, {db: details}) in the same shape as the curated groups."""
    def add(groups, db, acc, title, parent, pid=None, sub=0):
        g = groups.setdefault(acc, {'title': title, 'parent': parent, 'sub': sub, 'm': set()})
        if pid:
            g['m'].add(pid)
        return g
    cols, details = {}, {}

    # proteins: UniProt accessions of the membrane chains, for proteins with at least two structures
    G = {}
    names = {}
    for pid in ref_by:
        for acc, nm in ((rcsb.get(pid) or {}).get('u') or {}).items():
            names.setdefault(acc, nm)
    for pid, ref in ref_by.items():
        tm = membrane_chains(ref)
        ents = ref.get('entities') or []
        mine = [en for en in ents if tm & set(str(en.get('chains') or '').split(','))] or ents
        accs = [x['accession'] for en in mine for x in en.get('refs') or [] if x.get('db') == 'UniProt' and x.get('accession')]
        accs += (rcsb.get(pid) or {}).get('um') or []   # the RCSB maps fusion and engineered chains more fully
        for acc in dict.fromkeys(accs):
            add(G, 'UniProt', acc, names.get(acc) or acc, 'UniProt|UniProt', pid)
    G = {k: v for k, v in G.items() if len(v['m']) >= 2}
    root = set().union(*[v['m'] for v in G.values()]) if G else set()
    G['UniProt'] = {'title': 'Proteins', 'parent': 0, 'sub': 'Structures of the same protein, by UniProt accession', 'm': root}
    cols['UniProt'] = G
    details['UniProt'] = {'UniProt|' + k: {'href': 'https://www.uniprot.org/uniprotkb/%s/entry' % k, 'copyright': {'owner': 'UniProt'}} for k in G if k != 'UniProt'}

    # organisms: domain of life, then species with at least two structures
    G = {'organism': {'title': 'Organisms', 'parent': 0, 'sub': 'Source species of the membrane chains', 'm': set()}}
    DT = {'Eukaryota': 'Eukaryotes', 'Bacteria': 'Bacteria', 'Archaea': 'Archaea', 'Viruses': 'Viruses', 'other': 'Synthetic and unclassified'}
    # some records lack the lineage, so take each name's domain from the records that have it
    votes = collections.defaultdict(collections.Counter)
    for pid in ref_by:
        for name, taxid, dom in (rcsb.get(pid) or {}).get('o') or []:
            if dom:
                votes[name][dom] += 1
    sp = {}
    for pid in ref_by:
        for name, taxid, dom in (rcsb.get(pid) or {}).get('o') or []:
            dom = dom or (votes[name].most_common(1)[0][0] if votes[name] else '')
            d = dom or 'other'
            add(G, 'organism', d, DT[d], 'organism|organism', pid)
            G['organism']['m'].add(pid)
            e = sp.setdefault(species(name, dom), {'m': set(), 'tax': {}, 'dom': collections.Counter()})
            e['m'].add(pid)
            e['tax'][name] = taxid
            e['dom'][d] += 1
    taxdet = {}
    for nm, e in sp.items():
        if len(e['m']) < 2:
            continue
        ids = [t for t in e['tax'].values() if t]
        taxid = e['tax'].get(nm) or (min(ids) if ids else 0)
        acc = str(taxid) if taxid else re.sub(r'[^A-Za-z0-9]+', '_', nm)
        if acc in G:   # same taxonomy id reached from two spellings: merge
            G[acc]['m'] |= e['m']
            continue
        G[acc] = {'title': nm, 'parent': 'organism|' + e['dom'].most_common(1)[0][0], 'sub': 0, 'm': e['m']}
        if taxid:
            taxdet['organism|' + acc] = {'href': 'https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id=%s' % taxid, 'copyright': {'owner': 'NCBI Taxonomy'}}
    cols['organism'] = G
    details['organism'] = taxdet

    # membrane topology; entries the analysis could not classify get their own group so they can be checked
    G = {'topology': {'title': 'Membrane topology', 'parent': 0, 'sub': 'By transmembrane helices or β-strands per chain', 'm': set()},
         'alpha': {'title': 'α-helical', 'parent': 'topology|topology', 'sub': 0, 'm': set()},
         'beta': {'title': 'β-barrels', 'parent': 'topology|topology', 'sub': 0, 'm': set()},
         'unclassified': {'title': 'Not yet classified', 'parent': 'topology|topology',
                          'sub': 'The chain analysis is missing, or did not count helices and strands, for these entries', 'm': set()},
         'other': {'title': 'Not placed in the membrane', 'parent': 'topology|topology',
                   'sub': 'No chain crosses the bilayer in the simulation, so these entries may need checking', 'm': set()}}
    for pid, sim in sim_by.items():
        if pid not in ref_by:
            continue
        kind, n = topology(sim, ref_by[pid])
        G['topology']['m'].add(pid)
        G[kind]['m'].add(pid)
        if kind == 'beta' and n:
            add(G, 'topology', 'beta-%d' % n, '%d-stranded β-barrels' % n, 'topology|beta', pid)
        elif kind == 'alpha':
            k = min(n, 25)
            add(G, 'topology', 'alpha-%d' % k, ('%d transmembrane helix' % k if k == 1 else '%d transmembrane helices' % k) if k <= 24 else '25 or more transmembrane helices', 'topology|alpha', pid)
    cols['topology'] = G

    # bound ligands seen in at least five structures
    G, lig = {}, {}
    for pid, ref in ref_by.items():
        for l in ref.get('ligands') or []:
            if l.get('ligand_id'):
                d = l.get('description') or l['ligand_id']
                e = lig.setdefault(l['ligand_id'], {'d': d[:1] + d[1:].lower() if d.isupper() else d, 'm': set()})
                e['m'].add(pid)
    for k, e in lig.items():
        if len(e['m']) >= 5:
            G[k] = {'title': e['d'], 'parent': 'ligand|ligand', 'sub': 0, 'm': e['m']}
    root = set().union(*[v['m'] for v in G.values()]) if G else set()
    G['ligand'] = {'title': 'Bound ligands', 'parent': 0, 'sub': 'Structures sharing a ligand, lipid, detergent or ion', 'm': root}
    cols['ligand'] = G
    details['ligand'] = {'ligand|' + k: {'href': 'https://www.rcsb.org/ligand/%s' % k, 'copyright': {'owner': 'RCSB PDB'}} for k in G if k != 'ligand'}

    rows = {}
    for db, G in cols.items():
        order = [c[0] for c in (old_cols or {}).get(db, []) if c[0] in G]
        rest = sorted(set(G) - set(order), key=lambda k: (G[k]['parent'] != 0, -len(G[k]['m']), str(G[k]['title'])))
        rows[db] = [[k, G[k]['title'], len(G[k]['m']), G[k]['parent'], G[k]['sub'], ' '.join(sorted(G[k]['m']))] for k in order + rest]
    return rows, details


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
    now = datetime.datetime.now(datetime.timezone.utc)
    today = os.environ.get('MEMPROTMD_TODAY') or now.strftime('%Y-%m-%d')   # override only for testing
    last_release = str(old.get('built') or '')[:10]
    release = last_release or today

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
        if db not in DBS:
            continue   # worked-out groupings have no montage of their own; the site shows a member's image
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

    # organisms and UniProt names from the RCSB PDB: looked up once per entry and kept in rcsb.json
    org_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rcsb.json')
    rcsb = load(org_path, {})
    missing = sorted(p for p in ref_by if 'pf' not in (rcsb.get(p) or {}))
    if missing:
        found = rcsb_lookup(ref_by, missing)
        rcsb.update(found)
        print('RCSB: looked up %d entries, found %d' % (len(missing), len(found)))
    for p in list(rcsb):
        if p not in ref_by:
            del rcsb[p]
        else:
            merged = {}
            for n, t, d in rcsb[p].get('o') or []:
                merged.setdefault(norm_name(n), [norm_name(n), t, d])
            rcsb[p]['o'] = list(merged.values())
    orgs = {p: v.get('o') or [] for p, v in rcsb.items()}
    count = collections.Counter(o[0] for p in ref_by for o in orgs.get(p) or [])
    dom = {o[0]: o[2] for p in ref_by for o in orgs.get(p) or []}
    tax = {o[0]: o[1] for p in ref_by for o in orgs.get(p) or []}

    # Pfam: add the RCSB PDB's Pfam assignments for the membrane chains, which also cover entries the
    # Oxford mapping has not reached (it stops in 2024); families new to MemProtMD get their own group
    pfam = {c[0]: c for c in cols.get('Pfam') or []}
    extra = collections.defaultdict(set)
    for pid in ref_by:
        for acc, nm in ((rcsb.get(pid) or {}).get('pf') or {}).items():
            extra[acc].add(pid)
            if acc not in pfam:
                pfam[acc] = [acc, nm, 0, 0, 0, '']
                cols['Pfam'].append(pfam[acc])
                no_g.append('Pfam|' + acc)
                details.setdefault('Pfam', {})['Pfam|' + acc] = {'href': 'https://www.ebi.ac.uk/interpro/entry/pfam/%s/' % acc, 'copyright': {'owner': 'InterPro'}}
    for acc, c in pfam.items():
        if acc in extra:
            m = sorted(set(c[5].split()) | extra[acc])
            c[5], c[2] = ' '.join(m), len(m)

    # the bigger outside lists (MDDB, mpstruc, TCDB's protein names) are read on the first run of the day
    # or a run started by hand; other runs reuse what was saved
    daily = not old.get('mddb') or now.hour < 6 or os.environ.get('GITHUB_EVENT_NAME') in ('workflow_dispatch', 'push')

    # TCDB: Oxford's TCDB families stop in 2020; place the entries without one from TCDB's own lists,
    # then name systems and subfamilies after their proteins
    here = os.path.dirname(os.path.abspath(__file__))
    tc_path = os.path.join(here, 'tcdb.json')
    tc = tcdb_tables(tc_path, ref_by, rcsb)
    print('TCDB: %d entries without an Oxford TCDB family placed from TCDB\'s own lists' % tcdb_fill(cols, details, no_g, ref_by, rcsb, tc))
    tc['names'] = tcdb_names(load(tc_path, {}).get('names') or {}, {c[0] for c in cols.get('TCDB') or [] if c[0].count('.') == 4}, daily)
    tcdb_titles(cols, tc['names'], rcsb)

    # mpstruc: Oxford's mpstruc groups stop in 2020; place the entries without one from mpstruc's own list
    ms_path = os.path.join(here, 'mpstruc.json')
    ms = mpstruc_tables(ms_path, ref_by, daily)
    print('mpstruc: %d entries without an Oxford mpstruc group placed from mpstruc\'s own list' % mpstruc_build(cols, details, ref_by, ms))
    have = {db + '|' + c[0] for db, rows in cols.items() for c in rows}
    old_thumbs = set(no_g)
    no_g = [k for k in old_thumbs if k in have] + sorted(db + '|' + c[0] for db in ('mpstruc',) for c in cols.get(db) or []
                                                     if not os.path.exists(os.path.join(site, 'thumbs', db, enc(c[0]) + '.jpg')) and db + '|' + c[0] not in old_thumbs)

    # groupings worked out from the records: proteins, organisms, topology, ligands
    dcols, ddetails = derived_groups(ref_by, sim_by, rcsb, old.get('cols'))
    cols.update(dcols)
    for db, d in ddetails.items():
        details[db] = d
    names = sorted(count, key=lambda n: (-count[n], n))
    at = {n: i for i, n in enumerate(names)}

    # MDDB: simulations elsewhere of the same structures; looked up on the first run of the day (or a run by hand)
    mddb = {p: n for p, n in (old.get('mddb') or {}).items() if p in ref_by}
    if daily:
        found = mddb_lookup(ref_by)
        if found is not None:
            mddb = found

    # residue contact tables and depth histograms for the Statistics page
    stats_path = os.path.join(site, 'data', 'stats.json')
    old_stats = load(stats_path, None)
    stats = contact_stats() or old_stats

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
        sim = sim_by.get(pid) or {}
        th, ch = sim.get('thinning') or {}, sim.get('chains') or []
        def f1(v):
            return math.floor(v * 10 + 0.5) / 10 if isinstance(v, (int, float)) else None
        kind, n = topology(sim, r)
        stats = [f1(th.get('annular_thickness')), f1(th.get('thickness_diff')),
                 None if kind == 'unclassified' else n if kind == 'alpha' else 0,   # None: helices and strands not counted
                 None if kind == 'unclassified' else (n or 1) if kind == 'beta' else 0,
                 len(membrane_chains(r)) or len(ch)]
        return [pid, r.get('title') or 0, sub, r.get('experimental_method') or 0, r.get('resolution') or 0, r.get('first_published') or 0,
                [at[o[0]] for o in orgs.get(pid) or []], stats]
    index = {'pdb': [row(p, r3(ref_by[p])) for p in sorted(ref_by)], 'cols': cols, 'thick': thick, 'snap': old.get('snap') or {},
             'noThumb': no_t, 'noGroupThumb': sorted(no_g), 'built': release, 'updated': old.get('updated') or release,
             'orgs': [[n, dom[n], tax[n]] for n in names],   # [scientific name, domain, NCBI taxonomy id]; pdb rows list indexes into this
             'mddb': mddb}   # {pdb: number of MDDB simulations}, entries in MDDB only

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
                               ('statistics', stats != old_stats), ('change tracking', state != old_state)) if c]
    def strip2(d):
        return strip(d, 'built', 'updated')
    reasons = [r for r in reasons if r != 'index'] + (['index'] if strip2(index) != strip2(old) else [])
    if reasons:
        index['updated'] = today
    # weekly release: first run on a Monday, if anything changed since the last release
    cut = (not dry and datetime.date.fromisoformat(today).weekday() == 0 and (last_release or '') < today
           and str(index['updated']) > (last_release or ''))
    if cut:
        index['built'] = release = today
        reasons.append('weekly release')

    summary = ['MemProtMD update, database version %s' % version,
               ('Changed: %s. Publishing; release %s, updated %s' % (', '.join(reasons), release, index['updated'])) if reasons else 'Nothing has changed since %s (release %s), so nothing is published' % (index['updated'], release),
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
        if stats:
            dump(stats_path, stats)
        dump(os.path.join(site, 'data', 'growth.json'), growth_stats(ref_by, rcsb, cols))
        dump(org_path, rcsb)
        dump(tc_path, tc)
        if ms:
            dump(ms_path, ms)
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
            f.write('release=%s\nnew=%d\nchanged=%d\npublish=%s\ncut_release=%s\n' % (release, len(new_ids), len(changed_ids), 'true' if reasons else 'false', 'true' if cut else 'false'))


if __name__ == '__main__':
    main(sys.argv[1], '--dry-run' in sys.argv[2:])
