"""Build the published, machine-readable layer of the site from data/index.json and data/entries/:

  pdb/<id>/index.html   one indexable page per entry
  sitemap.xml           home page plus every entry page
  data/entries.tsv      one row per entry, for spreadsheets and scripts
  data/release.json     the release label (date of data/index.json) and counts

Each page is the normal app shell with a <base> pointing at the site root, a
specific title, description, canonical link and schema.org Dataset record, and
a short static summary that search engines and no-JS readers see. app.js
replaces the summary with the full entry page (window.MPM_ROUTE).

Usage: python3 -I pages_build.py <site_dir>
"""
import datetime
import html
import json
import os
import re
import sys

SITE = 'https://stansfeldlab.github.io/memprotmd/'
STORE = 'https://memprotmd.bioch.ox.ac.uk/data/memprotmd/simulations/'
NAR = 'https://doi.org/10.1093/nar/gky1047'
BIOSCHEMAS_DATASET = 'https://bioschemas.org/profiles/Dataset/1.0-RELEASE'
TSV_COLS = ['pdb_id', 'title', 'method', 'resolution_A', 'released', 'uniprot', 'organism', 'ncbi_taxid', 'domain', 'n_chains', 'n_lipids', 'n_protein_residues',
            'bulk_thickness_A', 'annular_thickness_A', 'thickness_change_A', 'memprotmd_groups', 'mpstruc', 'tcdb', 'pfam',
            'entry_url', 'record_url', 'files_url']
STATIC = ['']  # fragment routes are not indexable, so only the home page and entry pages are listed


def esc(s):
    return html.escape(str(s or ''), quote=True)


def plain(s):
    return re.sub(r'<[^>]+>', '', str(s or ''))


def sentence(s):
    s = str(s or '')
    return s[0] + s[1:].lower() if s == s.upper() and len(s) > 4 else s


def method(m):
    m = ' / '.join(m) if isinstance(m, list) else str(m or '')
    return '' if m in ('0', '') else sentence(m)


def memberships(idx):
    """For each PDB code and collection, the most specific groups it belongs to."""
    out = {}
    for db, cols in idx['cols'].items():
        parent = {c[0]: (c[3] or '').split('|', 1)[-1] for c in cols}
        by_pdb = {}
        for c in cols:
            if db == 'mpm' and c[0] == 'membrane_proteins' or c[0] == db:
                continue
            for pid in (c[5] or '').split():
                by_pdb.setdefault(pid, set()).add(c[0])
        for pid, g in by_pdb.items():
            parents = {parent[x] for x in g}
            out.setdefault(pid, {})[db] = sorted(x for x in g if x not in parents)
    return out


def tsv_cell(v):
    return re.sub(r'[\t\r\n]+', ' ', str(v if v is not None else ''))


def main(site):
    idx = json.load(open(os.path.join(site, 'data', 'index.json')))
    release = str(idx.get('built') or '')[:10]
    member = memberships(idx)
    rows = []
    shell = open(os.path.join(site, 'index.html')).read()
    # Unversioned assets: entry pages are rebuilt with the data, not with every code change.
    shell = re.sub(r'(styles\.css|app\.js)\?v=\w+', r'\1', shell)
    shell = shell.replace('<head>\n', '<head>\n<base href="../../">\n', 1)
    # the home page's catalogue record and JSON link describe the whole database, not one entry
    shell = re.sub(r'<script type="application/ld\+json" id="mpm-catalog">.*?</script>\n', '', shell, flags=re.S)
    shell = re.sub(r'<link rel="alternate" type="application/json"[^>]*>\n', '', shell)
    shell = re.sub(r'<link rel="canonical"[^>]*>\n', '', shell)
    out_dir = os.path.join(site, 'pdb')
    os.makedirs(out_dir, exist_ok=True)
    urls = []
    for row in idx['pdb']:
        pid, title, sub, meth, res, date = (row + [None] * 6)[:6]
        org = [idx['orgs'][i] for i in (row[6] if len(row) > 6 and isinstance(row[6], list) else []) if i < len(idx.get('orgs') or [])]
        P = pid.upper()
        try:
            e = json.load(open(os.path.join(site, 'data', 'entries', pid + '.json')))
        except (OSError, ValueError):
            e = {}
        ref, sim = e.get('ref') or {}, e.get('sim') or {}
        t = sentence(plain(ref.get('title') or title)) or 'PDB ' + P
        m = method(meth)
        r = '%.2f' % res if res else ''
        r = r.rstrip('0') if r.endswith('0') else r
        facts = [x for x in [m, (r + ' Å') if r else '', ('released ' + str(date)[:4]) if date else ''] if x]
        thick = (sim.get('thinning') or {})
        desc = '%s (PDB %s%s) simulated in a DPPC lipid bilayer by MemProtMD: lipid contacts, bilayer thickness, membrane placement of each chain, and simulation files to download.' % (
            t, P, ', ' + ', '.join(facts) if facts else '')
        url = SITE + 'pdb/' + pid + '/'
        cit = ref.get('primary_citation') or {}
        accs = []
        for en in ref.get('entities') or []:
            for x in en.get('refs') or []:
                if x.get('db') == 'UniProt' and x.get('accession') and x['accession'] not in accs:
                    accs.append(x['accession'])
        ld = {
            '@context': 'https://schema.org', '@type': 'Dataset',
            'http://purl.org/dc/terms/conformsTo': {'@id': BIOSCHEMAS_DATASET, '@type': 'CreativeWork'},
            'name': 'MemProtMD simulation of %s (PDB %s)' % (t, P),
            'description': desc, 'url': url, 'identifier': url, 'alternateName': 'MemProtMD ' + P,
            'isBasedOn': 'https://doi.org/10.2210/pdb%s/pdb' % pid,
            'keywords': ['membrane protein', 'molecular dynamics', 'lipid bilayer', 'DPPC', 'lipid interactions'] + [k for k in (ref.get('keywords') or [])][:6],
            'license': 'https://creativecommons.org/licenses/by/4.0/', 'isAccessibleForFree': True,
            'creator': [{'@type': 'Person', 'name': n} for n in ('Thomas D. Newport', 'Mark S. P. Sansom', 'Phillip J. Stansfeld')],
            'includedInDataCatalog': {'@type': 'DataCatalog', 'name': 'MemProtMD', 'url': SITE},
            'citation': [NAR] + (['https://doi.org/' + cit['DOI']] if cit.get('DOI') else []),
            'measurementTechnique': 'Molecular dynamics simulation',
            'distribution': [{'@type': 'DataDownload', 'encodingFormat': 'chemical/x-pdb', 'name': 'Atomistic snapshot',
                              'contentUrl': STORE + pid + '_default_dppc/files/structures/at.pdb'}],
        }
        # per-entry dates, so entry pages only change when the entry does (not with every weekly release)
        if isinstance(sim.get('sim_complete_time'), (int, float)) and sim['sim_complete_time'] > 0:
            ld['dateModified'] = datetime.datetime.fromtimestamp(sim['sim_complete_time'], datetime.timezone.utc).strftime('%Y-%m-%d')
        ldj = json.dumps(ld, ensure_ascii=False).replace('</', '<\\/')
        dl = [('Method', m), ('Resolution', (r + ' Å') if r else ''), ('Released', str(date)[:10] if date else ''),
              ('Bilayer thickness', '%.1f Å next to the protein, %.1f Å in bulk' % (thick['annular_thickness'], thick['bulk_thickness'])
               if thick.get('annular_thickness') and thick.get('bulk_thickness') else ''),
              ('Organism', '; '.join(o[0] for o in org)), ('UniProt', ', '.join(accs[:6]))]
        body = ('<main class="wrap" style="padding-block:2rem"><p><a href="#/home">MemProtMD</a></p><h1>%s</h1><p>PDB %s%s</p><p>%s</p><dl class="facts">%s</dl>'
                '<p><a href="#/ref/PDB/%s">Open the full MemProtMD entry for %s</a></p></main>') % (
            esc(t), P, (' · ' + esc(sentence(plain(sub)))) if sub else '', esc(desc),
            ''.join('<dt>%s</dt><dd>%s</dd>' % (k, esc(v)) for k, v in dl if v), pid, P)
        page = shell.replace('<title>MemProtMD</title>', '<title>%s (%s) · MemProtMD</title>' % (esc(t), P), 1)
        rec = SITE + 'data/entries/' + pid + '.json'
        page = re.sub(r'<meta name="description" content="[^"]*">',
                      lambda _: '<meta name="description" content="%s">\n<link rel="canonical" href="%s">\n<link rel="alternate" type="application/json" href="%s">\n<script type="application/ld+json">%s</script>' % (esc(desc), url, rec, ldj), page, count=1)
        page = page.replace('<div id="mpm-app"></div>', '<div id="mpm-app">%s</div>' % body, 1)
        page = page.replace('<script src="app.js">', '<script>window.MPM_ROUTE = "ref/PDB/%s";</script>\n<script src="app.js">' % pid, 1)
        d = os.path.join(out_dir, pid)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, 'index.html'), 'w') as f:
            f.write(page)
        urls.append((url, str(date)[:10] if date else ''))
        sv, mg = sim.get('sim_validate') or {}, member.get(pid, {})
        th = lambda k: ('%.2f' % thick[k]) if isinstance(thick.get(k), (int, float)) else ''
        rows.append([pid, plain(ref.get('title') or title), '; '.join(meth) if isinstance(meth, list) else ('' if str(meth) in ('0', '') else meth),
                     ('%g' % res) if res else '', str(date)[:10] if date else '', '; '.join(accs),
                     '; '.join(o[0] for o in org), '; '.join(str(o[2]) for o in org if o[2]), '; '.join(sorted({o[1] for o in org if o[1]})), sim.get('n_chains', ''),
                     sv.get('n_lipid_molecules', ''), sv.get('n_protein_residues', ''), th('bulk_thickness'), th('annular_thickness'), th('thickness_diff'),
                     '; '.join(mg.get('mpm', [])), '; '.join(mg.get('mpstruc', [])), '; '.join(mg.get('TCDB', [])), '; '.join(mg.get('Pfam', [])),
                     url, rec, STORE + pid + '_default_dppc/'])
    built = str(idx.get('built') or '')[:10]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for s in STATIC:
        sm.append('  <url><loc>%s</loc>%s</url>' % (esc(SITE + s), '<lastmod>%s</lastmod>' % built if built and not s else ''))
    for u, d in urls:
        sm.append('  <url><loc>%s</loc>%s</url>' % (u, '<lastmod>%s</lastmod>' % d if re.match(r'\d{4}-\d\d-\d\d$', d) else ''))
    sm.append('</urlset>')
    with open(os.path.join(site, 'sitemap.xml'), 'w') as f:
        f.write('\n'.join(sm) + '\n')
    with open(os.path.join(site, 'data', 'entries.tsv'), 'w') as f:
        f.write('\t'.join(TSV_COLS) + '\n')
        for r in rows:
            f.write('\t'.join(tsv_cell(v) for v in r) + '\n')
    rel = {'release': release, 'updated': str(idx.get('updated') or release)[:10], 'entries': len(idx['pdb']), 'groups': {db: len(c) for db, c in idx['cols'].items()},
           'site': SITE, 'files': STORE.rsplit('simulations/', 1)[0], 'license': 'https://creativecommons.org/licenses/by/4.0/',
           'citation': NAR, 'documentation': SITE + '#/api',
           'paths': {'index': 'data/index.json', 'table': 'data/entries.tsv', 'record': 'data/entries/{pdb}.json',
                     'groups': 'data/groups/{collection}.json', 'page': 'pdb/{pdb}/', 'simulation_files': '{files}simulations/{pdb}_default_dppc/'}}
    with open(os.path.join(site, 'data', 'release.json'), 'w') as f:
        json.dump(rel, f, indent=2)
        f.write('\n')
    print(len(urls), 'entry pages, release', release)


if __name__ == '__main__':
    main(sys.argv[1])
