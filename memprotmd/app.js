/* MemProtMD static site (modernised draft). Data comes from static JSON; bulky files stay on file storage. */
(function () {
  'use strict';
  var CFG = window.MPM_CFG || {};
  var STORE = CFG.storage || 'https://memprotmd.bioch.ox.ac.uk/data/memprotmd/';
  var DB = null, byId = {}, colById = {}, kids = {}, memberOf = null, searchRecs = null, ALL = null, NOT = {}, NOG = {}, GROUPS = {}, ORGS = [];
  var app = document.getElementById('mpm-app');
  var DBNAMES = { mpm: 'MemProtMD groups', TCDB: 'TCDB', mpstruc: 'mpstruc', Pfam: 'Pfam', PDB: 'PDB', UniProt: 'Protein', organism: 'Organism', topology: 'Membrane topology', ligand: 'Bound ligand' };
  /* Groupings worked out from the records (by the update job) rather than curated; they have no montage images of their own. */
  var DERIVED = { UniProt: 1, organism: 1, topology: 1, ligand: 1 };
  var DOMAINS = [['Eukaryota', 'Eukaryotes'], ['Bacteria', 'Bacteria'], ['Archaea', 'Archaea'], ['Viruses', 'Viruses']];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ttl(s) { return esc(s).replace(/&lt;(\/?)(sub|sup|i|em|b)&gt;/g, '<$1$2>').replace(/&amp;([a-z]+|#\d+);/gi, '&$1;'); }
  function plain(s) { return String(s || '').replace(/<[^>]+>/g, ''); }
  function sentence(s) { s = String(s || ''); return s === s.toUpperCase() && s.length > 4 ? s.charAt(0) + s.slice(1).toLowerCase() : s; }
  function enc(p) { return p.replace(/[^A-Za-z0-9]/g, function (c) { return '-' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }); }
  function dec(h) { return h.replace(/-([0-9a-f]{2})/g, function (m, x) { return String.fromCharCode(parseInt(x, 16)); }); }
  function href(path) { return CFG.prettyHash ? '#/' + path : '#' + enc(path); }
  function refHref(db, acc) { return href('ref/' + db + '/' + acc); }
  function num(n) { return Number(n).toLocaleString('en-GB'); }
  var PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><rect y="38" width="100" height="24" fill="#eaf0fb"/><g fill="#1f499e" opacity=".45"><rect x="33" y="24" width="8" height="52" rx="4"/><rect x="46" y="20" width="8" height="60" rx="4"/><rect x="59" y="24" width="8" height="52" rx="4"/></g></svg>');
  window.mpmPh = function (el) { el.onerror = null; el.src = PH; };
  /* Thumbnails are hosted with the site. Full-size renders stay on file storage and fall back to the thumbnail. */
  function pdbThumb(id) { return NOT[id] ? null : 'thumbs/pdb/' + id + '.jpg'; }
  function colThumb(db, acc) { if (DERIVED[db] || NOG[db + '|' + acc]) { var m = sample(db, acc); return m ? pdbThumb(m) : null; } return 'thumbs/' + db + '/' + enc(acc) + '.jpg'; }
  function sample(db, acc) { var c = colById[db + '|' + acc]; if (!c) return null; var m = members(c); for (var i = 0; i < m.length; i++) if (!NOT[m[i]] && byId[m[i]]) return m[i]; return null; }
  function remote(path) { return CFG.remoteImages === false ? null : STORE + path; }
  function imgUrl(kind, a) {
    var p = a.split('/');
    if (kind === 'pdb100') return pdbThumb(a);
    if (kind === 'pdbhero' || kind === 'pdbtile') return remote('databases/PDB/thumbs/' + a + '.jpg') || pdbThumb(a);
    if (kind === 'col100') return colThumb(p[0], p.slice(1).join('/'));
    if (kind === 'colhero') { if (DERIVED[p[0]]) { var sm = sample(p[0], p.slice(1).join('/')); return sm ? remote('databases/PDB/thumbs/' + sm + '.jpg') || pdbThumb(sm) : null; } return remote('databases/' + p[0] + '/thumbs/' + encodeURIComponent(p.slice(1).join('/')) + '.jpg'); }
    if (kind === 'sim') return remote('simulations/' + p[0] + '_default_dppc/images/' + p[1] + '.jpg');
    return null;
  }
  function fallback(kind, a) { return kind === 'pdbhero' || kind === 'pdbtile' ? pdbThumb(a) : null; }
  window.mpmFb = function (el) { var f = el.getAttribute('data-fb'); el.removeAttribute('data-fb'); if (f === 'hide') { el.closest('.well').hidden = true; return; } if (f) { el.src = f; return; } el.onerror = null; el.src = PH; };
  function fbAttr(kind, a) { var f = fallback(kind, a); return f ? ' data-fb="' + esc(f) + '"' : ''; }
  function imgTag(kind, a, cls, alt) { return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + (imgUrl(kind, a) || PH) + '"' + fbAttr(kind, a) + ' alt="' + esc(alt || '') + '" loading="lazy" onerror="mpmFb(this)">'; }
  function ago(d) {
    if (!d) return '';
    var days = (Date.now() - new Date(d).getTime()) / 864e5;
    if (days < 1) return 'today';
    if (days < 45) return Math.round(days) + ' days ago';
    if (days < 345) return Math.round(days / 30.4) + ' months ago';
    var y = Math.round(days / 365.25); return y + (y === 1 ? ' year ago' : ' years ago');
  }
  function fmtDate(d) { if (!d) return ''; var t = new Date(d); return isNaN(t) ? esc(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  function getText(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.text(); }); }
  function extA(url, text, cls) { return '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(url) + '" target="_blank" rel="noopener">' + text + '</a>'; }
  function each(sel, fn) { Array.prototype.forEach.call(app.querySelectorAll(sel), fn); }

  /* ---------- data ---------- */
  function load() {
    return getJSON('data/index.json').then(function (d) {
      DB = d; ORGS = d.orgs || []; (d.noThumb || []).forEach(function (k) { NOT[k] = 1; }); (d.noGroupThumb || []).forEach(function (k) { NOG[k] = 1; });
      d.pdb.forEach(function (r) { byId[r[0]] = r; });
      Object.keys(d.cols).forEach(function (db) {
        d.cols[db].forEach(function (c) { colById[db + '|' + c[0]] = { db: db, acc: c[0], title: c[1], n: c[2], parent: c[3] || null, sub: c[4] || '', mem: c[5] }; });
      });
      Object.keys(colById).forEach(function (id) { var p = colById[id].parent; if (p) (kids[p] = kids[p] || []).push(id); });
    });
  }
  function groupInfo(db) { if (!GROUPS[db]) GROUPS[db] = getJSON('data/groups/' + db + '.json').catch(function () { return {}; }); return GROUPS[db]; }
  /* PDB citation titles lose their superscripts: "Mg 2+ transport" should read "Mg2+ transport" */
  function ionFix(t) { return String(t || '').replace(/\b(Mg|Ca|Zn|Na|K|Cu|Fe|Mn|Ni|Co|Cl|H|Li|Cd|Ba|Sr|Cs|Rb) (\d[+\-\u2212]|[+\-\u2212](?=[,.;:)\/]| [a-z]|$))/g, '$1$2'); }
  function pdbTitle(t, acc) { return t ? sentence(t) : 'PDB ' + String(acc).toUpperCase(); }
  function members(c) { return c.mem ? c.mem.split(' ') : []; }
  function lineage(id) { var out = [], g = 0; while (id && colById[id] && g++ < 20) { out.unshift(id); id = colById[id].parent; } return out; }
  function collectionsOf(pdb) {
    if (!memberOf) { memberOf = {}; Object.keys(colById).forEach(function (id) { members(colById[id]).forEach(function (m) { (memberOf[m] = memberOf[m] || []).push(id); }); }); }
    return memberOf[pdb] || [];
  }

  /* ---------- search ---------- */
  function recs() {
    if (searchRecs) return searchRecs;
    searchRecs = [];
    Object.keys(colById).forEach(function (id) { var c = colById[id]; searchRecs.push({ db: c.db, acc: c.acc, title: c.title, size: c.n, text: (c.acc + ' ' + plain(c.title) + ' ' + c.sub).toLowerCase() }); });
    DB.pdb.forEach(function (r) { searchRecs.push({ db: 'PDB', acc: r[0], title: r[1], size: 1, date: r[5], text: (r[0] + ' ' + plain(r[1]) + ' ' + (r[2] || '') + ' ' + orgNames(r).join(' ')).toLowerCase() }); });
    return searchRecs;
  }
  function orgsOf(r) { return ((r && r[6]) || []).map(function (i) { return ORGS[i]; }).filter(Boolean); }
  function orgNames(r) { return orgsOf(r).map(function (o) { return o[0]; }); }
  function search(q, n, dbs, test) {
    var pos = [], neg = [], m, re = /(-?)"([^"]+)"|(-?)(\S+)/g;
    while ((m = re.exec(q.toLowerCase()))) { var t = (m[2] || m[4]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (t) ((m[1] || m[3]) ? neg : pos).push(new RegExp('(^|[^a-z0-9])' + t + '($|[^a-z0-9])')); }
    var out = []; out.total = 0;
    if (!pos.length && !test) return out;
    recs().forEach(function (r) {
      if (test) { if (r.db !== 'PDB' || !test(byId[r.acc])) return; }
      else if (dbs && !dbs[r.db]) return;
      for (var i = 0; i < pos.length; i++) if (!pos[i].test(r.text)) return;
      for (var j = 0; j < neg.length; j++) if (neg[j].test(r.text)) return;
      out.push(r);
    });
    out.sort(function (a, b) { return (b.size - a.size) || String(b.date || '').localeCompare(String(a.date || '')); });
    var top = out.slice(0, n); top.total = out.length; return top;
  }
  function rowLink(r) {
    var isP = r.db === 'PDB';
    return '<a class="rowlink" href="' + refHref(r.db, r.acc) + '">' + imgTag(isP ? 'pdb100' : 'col100', isP ? r.acc : r.db + '/' + r.acc) +
      '<span><span class="t">' + ttl(isP ? pdbTitle(r.title, r.acc) : sentence(r.title)) + '</span><span class="k">' + esc(isP ? 'PDB ' + r.acc : (DBNAMES[r.db] || r.db) + ' · ' + r.acc) + '</span></span>' +
      '<span class="m">' + (isP ? esc(ago(r.date)) : num(r.size) + ' structures') + '</span></a>';
  }

  /* ---------- chrome ---------- */
  var NAV = [['search/text', 'Search'], ['about', 'About'], ['stats', 'Statistics'], ['status', 'Status'], ['data', 'Data'], ['api', 'API']];
  function chrome(active, main) {
    return '<header class="bar"><div class="wrap"><a class="logo" href="' + href('home') + '" aria-label="MemProtMD home"><img src="logo.svg" alt="MemProtMD"></a>' +
      '<nav class="nav" aria-label="Main">' + NAV.map(function (n) { return '<a href="' + href(n[0]) + '"' + (active === n[0] ? ' aria-current="page"' : '') + '>' + n[1] + '</a>'; }).join('') + '</nav>' +
      (active === 'home' || active === 'search/text' ? '' : '<div class="bar-search" id="qs"><input id="qs-input" type="search" placeholder="Search ' + num(DB.pdb.length) + ' structures" aria-label="Quick search" autocomplete="off"><div class="pop" id="qs-pop" hidden></div></div>') +
      '</div></header>' + (CFG.banner ? '<div class="draft"><div class="wrap">' + CFG.banner + '</div></div>' : '') +
      '<main class="wrap">' + main + '</main>' +
      '<footer class="foot"><div class="wrap"><div><h3>Reuse this work</h3><p>Except where indicated otherwise, data on this site is part of the MemProtMD database, by Thomas D. Newport, Mark S.P. Sansom and Phillip J. Stansfeld, licensed under ' + extA('https://creativecommons.org/licenses/by/4.0/', 'Creative Commons Attribution 4.0') + '.</p>' +
        '<p style="margin-top:.5rem">Data release <span class="mono">' + esc(String(DB.built || '').slice(0, 10)) + '</span>' + (DB.updated && DB.updated > DB.built ? ', updated <span class="mono">' + esc(String(DB.updated).slice(0, 10)) + '</span>' : '') + ' · ' + num(DB.pdb.length) + ' entries · <a href="' + href('api') + '">API</a> · <a href="' + href('data') + '">Data files</a></p></div>' +
      '<div><h3>Cite</h3><p>Newport TD, Sansom MSP, Stansfeld PJ. The MemProtMD database. <i>Nucleic Acids Research</i> (2019). ' + extA('https://doi.org/10.1093/nar/gky1047', 'doi:10.1093/nar/gky1047') + '</p></div>' +
      '<div><h3>Get in touch</h3><p>' + extA('https://stansfeldlab.github.io/', 'Stansfeld Research Group') + '<br>' + extA('https://bsky.app/profile/pstansfeld.bsky.social', 'Bluesky: @pstansfeld.bsky.social') + '</p><p style="margin-top:.5rem">Supported by BBSRC, Wellcome and EPSRC.</p></div></div></footer>';
  }
  function show(active, main, title) {
    app.innerHTML = chrome(active, main); document.title = title ? title + ' · MemProtMD' : 'MemProtMD';
    var inp = document.getElementById('qs-input'), pop = document.getElementById('qs-pop');
    if (!inp) return;
    inp.addEventListener('input', function () {
      var q = inp.value.trim(), r = q ? search(q, 7) : [];
      pop.hidden = !q;
      pop.innerHTML = r.length ? r.map(rowLink).join('') + '<a class="more" href="' + href('search/text') + '" data-q="' + esc(q) + '">All ' + num(r.total) + ' results</a>' : '<p class="small muted" style="padding:.75rem">No matches. Search uses whole words.</p>';
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') { pop.hidden = true; } if (e.key === 'Enter' && inp.value.trim()) { pending = inp.value.trim(); location.hash = href('search/text'); } });
    pop.addEventListener('click', function (e) { var a = e.target.closest('a[data-q]'); if (a) pending = a.getAttribute('data-q'); pop.hidden = true; });
  }
  var pending = '';

  /* ---------- home ---------- */
  function pageHome() {
    var latest = DB.pdb.slice().sort(function (a, b) { return String(b[5] || '').localeCompare(String(a[5] || '')); }).slice(0, 8);
    var tiles = [['gpcrs', '5t1a', 'G protein-coupled receptors'], ['ion_channels', '1k4c', 'Ion channels'], ['outer_membrane_proteins', '4kr4', 'Outer membrane proteins'], ['aquaporins', '5i32', 'Aquaporins'], ['abc_transporter', '4q4h', 'ABC transporters'], ['ligand_gated_ion_channels', '5tio', 'Ligand-gated ion channels']];
    var roots = [['UniProt', 'UniProt', 'Proteins', 'Every structure of the same protein, by UniProt accession'], ['organism', 'organism', 'Organisms', 'By the source species of the membrane chains'],
      ['topology', 'topology', 'Membrane topology', 'By the number of transmembrane helices or β-strands'], ['ligand', 'ligand', 'Bound ligands', 'Structures sharing a ligand, lipid, detergent or ion'],
      ['mpm', 'membrane_proteins', 'MemProtMD groups', 'Fold and family groups assigned from the simulations'], ['TCDB', 'TCDB', 'Transporter Classification Database', 'Channels, carriers and pumps by transport mechanism'], ['mpstruc', 'mpstruc', 'mpstruc', 'Membrane proteins of known structure, curated by family']];
    /* a random entry with an image, beside the introduction on wide screens; it can open in 3D in place */
    var pool = DB.pdb.filter(function (r) { return !NOT[r[0]]; }), nw = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    var card = nw ? '<aside class="hero-new" aria-label="Random entry"><span class="eyebrow">Random entry</span><div class="well herowell" id="mol-host" data-compact="1"><a class="hero-img" href="' + refHref('PDB', nw[0]) + '">' + imgTag('pdbhero', nw[0], '', 'PDB ' + nw[0] + ' in its simulated bilayer') + '</a>' +
      '<button type="button" class="btn mol-open" id="mol-open"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 17 6v8l-7 4-7-4V6z M10 2v8m0 0 7-4m-7 4-7-4m7 4v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>3D view</button></div><a class="t" href="' + refHref('PDB', nw[0]) + '">' + ttl(pdbTitle(nw[1], nw[0])) + '</a><span class="k">PDB ' + esc(nw[0]) + (nw[5] ? ' · released ' + esc(fmtDate(nw[5])) : '') + '</span><div id="mol-ctrl"></div></aside>' : '';
    var h = '<div class="stack-lg"><section class="hero"><div class="hero-main stack"><p class="eyebrow">MemProtMD</p><h1>Membrane proteins, simulated in their lipid bilayer</h1>' +
      '<p class="lede">Every intrinsic membrane protein structure in the Protein Data Bank, inserted into a lipid bilayer by coarse-grained self-assembly molecular dynamics. Browse the analysis, or download the files to run your own coarse-grained and atomistic simulations.</p>' +
      '<div class="find"><input class="field big" id="home-q" type="search" placeholder="Search by protein, family or PDB code, for example LeuT or 1a0s" aria-label="Search MemProtMD" autocomplete="off"><div class="rowlist" id="home-res" style="margin-top:.5rem"></div></div>' +
      '<div class="figures"><div><b>' + num(DB.pdb.length) + '</b><span>simulated structures</span></div><div id="home-prot" hidden><b></b><span>distinct proteins</span></div><div><b>' + esc(fmtDate(latest[0][5])) + '</b><span>most recent structure</span></div></div>' +
      '<p class="small muted">The original MemProtMD site, at the University of Oxford: ' + extA('https://memprotmd.bioch.ox.ac.uk/', 'memprotmd.bioch.ox.ac.uk<span class="xa" aria-hidden="true">↗</span>') + '</p></div>' + card + '</section>' +
      '<section><div class="head-row"><h2>Browse by family</h2><a href="' + refHref('mpm', 'membrane_proteins') + '">All MemProtMD groups</a></div><div class="tiles">' + tiles.map(function (t) {
        var c = colById['mpm|' + t[0]];
        return '<a class="tile" href="' + refHref('mpm', t[0]) + '"><div class="well">' + imgTag('pdbtile', t[1], '', 'PDB ' + t[1]) + '</div><span class="t">' + t[2] + '</span><span class="k">' + (c ? num(c.n) + ' structures' : '') + '</span></a>';
      }).join('') + '</div></section>' +
      '<section><div class="head-row"><h2>Latest simulations</h2></div><div class="panel"><div class="grid2">' + [latest.slice(0, 4), latest.slice(4)].map(function (g) { return '<div class="rowlist">' + g.map(function (r) { return rowLink({ db: 'PDB', acc: r[0], title: r[1], date: r[5] }); }).join('') + '</div>'; }).join('') + '</div></div></section>' +
      '<section><div class="head-row"><h2>Browse by classification</h2></div><div class="grid2" style="gap:1rem">' + roots.map(function (r) {
        var c = colById[r[0] + '|' + r[1]];
        return c ? '<a class="panel" style="text-decoration:none;color:inherit" href="' + refHref(r[0], r[1]) + '"><h3>' + r[2] + '</h3><p class="small muted">' + r[3] + '</p><p class="small" style="margin-top:.5rem"><span class="tag">' + num(c.n) + ' structures</span></p></a>' : '';
      }).join('') + '</div></section></div>';
    show('home', h);
    if (nw) {
      if (molMount.pdb !== nw[0]) { molMount.pdb = nw[0]; molMount.lipids = molMount.chains = null; }
      molMount(nw[0], STORE + 'simulations/' + nw[0] + '_default_dppc/');
    }
    var q = document.getElementById('home-q');
    getJSON('data/growth.json').then(function (g) { var el = document.getElementById('home-prot'); if (el && g.uniprot && g.uniprot.total) { el.firstChild.textContent = num(g.uniprot.total); el.hidden = false; } }).catch(function () {});
    q.addEventListener('input', function () {
      var v = q.value.trim(), r = v ? search(v, 8) : [];
      document.getElementById('home-res').innerHTML = !v ? '' : r.length ? r.map(rowLink).join('') + (r.total > r.length ? '<p class="small" style="padding-top:.6rem"><a href="' + href('search/text') + '" id="home-all">All ' + num(r.total) + ' results</a></p>' : '') : '<p class="small muted">No matches. Search uses whole words, so <code>lipo</code> will not match lipoprotein.</p>';
      var a = document.getElementById('home-all'); if (a) a.addEventListener('click', function () { pending = v; });
    });
  }

  /* ---------- search ---------- */
  var SOURCES = [['PDB', 'PDB structures'], ['mpm', 'MemProtMD groups'], ['TCDB', 'TCDB'], ['mpstruc', 'mpstruc'], ['Pfam', 'Pfam'], ['UniProt', 'Proteins'], ['organism', 'Organisms'], ['topology', 'Topology'], ['ligand', 'Ligands']];
  var METHODS = [['xray', 'X-ray'], ['em', 'Cryo-EM'], ['nmr', 'NMR'], ['other', 'Other']];
  var RES = [2, 2.5, 3, 3.5, 4];
  function mgroup(m) { m = String(m || ''); return /X-RAY/.test(m) ? 'xray' : /ELECTRON MICROSCOPY/.test(m) ? 'em' : /NMR/.test(m) ? 'nmr' : 'other'; }
  function qsParse(t) { var o = {}; String(t || '').split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); try { o[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {} }); return o; }
  function qsBuild(o) { return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]).replace(/%2C/g, ',').replace(/%7C/g, '|'); }).join('&'); }
  function filterTest(F) {
    if (!(F.m.length || F.r || F.y0 || F.y1 || F.f || F.o || F.d.length || F.x)) return null;
    var md = DB.mddb || {};
    var oq = (F.o || '').trim().toLowerCase();
    var fam = null; if (F.f && colById[F.f]) { fam = {}; members(colById[F.f]).forEach(function (x) { fam[x] = 1; }); }
    return function (row) {
      if (!row) return false;
      if (F.m.length && F.m.indexOf(mgroup(row[3])) < 0) return false;
      if (F.x && !md[row[0]]) return false;
      if (F.r && !(row[4] > 0 && row[4] <= F.r)) return false;
      var y = +String(row[5] || '').slice(0, 4);
      if (F.y0 && !(y >= F.y0)) return false;
      if (F.y1 && !(y <= F.y1)) return false;
      if (oq || F.d.length) {
        var os = orgsOf(row);
        if (oq && !os.some(function (o) { return o[0].toLowerCase().indexOf(oq) >= 0; })) return false;
        if (F.d.length && !os.some(function (o) { return F.d.indexOf(o[1]) >= 0; })) return false;
      }
      return !fam || !!fam[row[0]];
    };
  }
  function famOptions(sel) {
    var all = Object.keys(colById).map(function (k) { return colById[k]; });
    function opt(c, label) { var v = c.db + '|' + c.acc; return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(label) + ' (' + num(c.n) + ')</option>'; }
    var mpm = all.filter(function (c) { return c.db === 'mpm' && c.acc !== 'membrane_proteins'; }).sort(function (a, b) { return b.n - a.n; });
    var mps = all.filter(function (c) { var pa = c.parent && colById[c.parent]; return c.db === 'mpstruc' && pa && pa.parent === 'mpstruc|mpstruc'; }).sort(function (a, b) { return plain(a.title).localeCompare(plain(b.title)); });
    var tc = all.filter(function (c) { return c.db === 'TCDB' && /^\d\.[A-Z]$/.test(c.acc); }).sort(function (a, b) { return a.acc.localeCompare(b.acc); });
    return '<option value="">Any family</option>' +
      '<optgroup label="MemProtMD">' + mpm.map(function (c) { return opt(c, plain(c.title)); }).join('') + '</optgroup>' +
      '<optgroup label="mpstruc">' + mps.map(function (c) { return opt(c, sentence(plain(c.title))); }).join('') + '</optgroup>' +
      '<optgroup label="TCDB">' + tc.map(function (c) { return opt(c, c.acc + ' ' + plain(c.title)); }).join('') + '</optgroup>';
  }
  function pageSearch() {
    var on = {}, shown = 30; SOURCES.forEach(function (s) { on[s[0]] = true; });
    var Q = qsParse(route.query), years = [];
    DB.pdb.forEach(function (r) { var y = +String(r[5] || '').slice(0, 4); if (y && years.indexOf(y) < 0) years.push(y); }); years.sort();
    var F = { m: (Q.m || '').split(',').filter(function (x) { return METHODS.some(function (m) { return m[0] === x; }); }), r: +Q.r || 0, y0: +Q.y0 || 0, y1: +Q.y1 || 0, f: Q.f && colById[Q.f] ? Q.f : '',
      o: Q.o || '', d: (Q.d || '').split(',').filter(function (x) { return DOMAINS.some(function (d) { return d[0] === x; }); }), x: Q.x === '1' ? 1 : 0 };
    var nMd = Object.keys(DB.mddb || {}).length;
    if (pending) { Q.q = pending; pending = ''; }
    function yopts(sel, blank) { return '<option value="">' + blank + '</option>' + years.map(function (y) { return '<option' + (y === sel ? ' selected' : '') + '>' + y + '</option>'; }).join(''); }
    var active = F.m.length || F.r || F.y0 || F.y1 || F.f || F.o || F.d.length || F.x;
    show('search/text', '<div class="stack"><div class="pagehead"><h1>Search</h1><p class="muted" style="max-width:44rem">Search works on whole words. Put a phrase <code>"in quotes"</code> to match it exactly, or add a minus sign to leave words out, for example <code>lipoprotein -mlaa</code>.</p></div>' +
      '<input class="field big" id="ts-q" type="search" placeholder="Protein, family, process or PDB code" aria-label="Search term" autocomplete="off">' +
      '<div class="chips" id="ts-src" role="group" aria-label="Sources">' + SOURCES.map(function (s) { return '<button class="chip" type="button" aria-pressed="true" data-db="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<details class="filters"' + (active ? ' open' : '') + '><summary>Filter structures <span class="muted" id="f-sum"></span></summary><div class="fbody">' +
        '<div class="frow"><span class="eyebrow">Method</span><div class="chips" role="group" aria-label="Experimental method">' + METHODS.map(function (m) { return '<button class="chip" type="button" data-m="' + m[0] + '" aria-pressed="' + (F.m.indexOf(m[0]) >= 0) + '">' + m[1] + '</button>'; }).join('') + '</div></div>' +
        '<div class="frow"><label class="eyebrow" for="f-res">Resolution</label><select class="field sel" id="f-res"><option value="">Any</option>' + RES.map(function (v) { return '<option value="' + v + '"' + (F.r === v ? ' selected' : '') + '>' + v.toFixed(1) + ' Å or better</option>'; }).join('') + '</select></div>' +
        '<div class="frow"><span class="eyebrow" id="f-ylab">Released</span><div class="yr"><select class="field sel" id="f-y0" aria-labelledby="f-ylab">' + yopts(F.y0, 'From') + '</select><span class="muted">to</span><select class="field sel" id="f-y1" aria-label="Released up to">' + yopts(F.y1, 'To') + '</select></div></div>' +
        '<div class="frow"><label class="eyebrow" for="f-fam">Family</label><select class="field sel" id="f-fam">' + famOptions(F.f) + '</select></div>' +
        '<div class="frow"><label class="eyebrow" for="f-org">Organism</label><div class="yr"><input class="field sel" id="f-org" type="search" list="f-orgs" placeholder="For example Homo sapiens" autocomplete="off" value="' + esc(F.o) + '"><datalist id="f-orgs">' + ORGS.slice(0, 300).map(function (o) { return '<option value="' + esc(o[0]) + '">'; }).join('') + '</datalist></div></div>' +
        '<div class="frow"><span class="eyebrow">Domain</span><div class="chips" role="group" aria-label="Domain of life">' + DOMAINS.map(function (d) { return '<button class="chip" type="button" data-dom="' + d[0] + '" aria-pressed="' + (F.d.indexOf(d[0]) >= 0) + '">' + d[1] + '</button>'; }).join('') + '</div></div>' +
        (nMd ? '<div class="frow"><span class="eyebrow">Simulations</span><div class="chips" role="group" aria-label="Simulations elsewhere"><button class="chip" type="button" id="f-mddb" aria-pressed="' + !!F.x + '">Also in MDDB · ' + num(nMd) + '</button></div></div>' : '') +
        '<p class="small muted">Filters apply to PDB structures only. Most cryo-EM entries have no resolution recorded, so they drop out when you filter by resolution.</p>' +
        '<div class="btns"><button class="btn ghost" type="button" id="f-clear">Clear filters</button><button class="btn ghost" type="button" id="f-copy">Copy link to this search</button><span class="small muted" id="f-msg" role="status"></span></div>' +
      '</div></details>' +
      '<p class="small muted" id="ts-msg">Try <a href="#" data-try="GPCR">GPCR</a>, <a href="#" data-try="porin">porin</a>, <a href="#" data-try="&quot;ion channel&quot; -sodium">"ion channel" -sodium</a> or <a href="#" data-try="1a0s">1a0s</a>.</p><div class="panel" id="ts-panel" hidden><div class="rowlist" id="ts-res"></div><p style="margin-top:1rem"><button class="btn ghost" id="ts-more" type="button" hidden>Show more</button></p></div></div>', 'Search');
    var q = document.getElementById('ts-q'), msg = document.getElementById('ts-msg'), tip = msg.innerHTML;
    q.value = Q.q || '';
    function state() { return qsBuild({ q: q.value.trim(), m: F.m.join(','), r: F.r || '', y0: F.y0 || '', y1: F.y1 || '', f: F.f, o: F.o.trim(), d: F.d.join(','), x: F.x ? 1 : '' }); }
    function sync() { var t = state(); try { history.replaceState(null, '', location.pathname + location.search + '#/search/text' + (t ? '?' + t : '')); } catch (e) {} }
    function run() {
      var v = q.value.trim(), test = filterTest(F), r = v || test ? search(v, shown, on, test) : [];
      document.getElementById('ts-src').hidden = !!test;
      var sum = [F.m.length ? F.m.map(function (k) { return METHODS.filter(function (m) { return m[0] === k; })[0][1]; }).join(', ') : '', F.r ? '≤ ' + F.r.toFixed(1) + ' Å' : '', F.y0 || F.y1 ? (F.y0 || '…') + '–' + (F.y1 || '…') : '', F.f ? plain(colById[F.f].title) : '', F.o.trim() ? F.o.trim() : '', F.d.length ? F.d.map(function (k) { return DOMAINS.filter(function (d) { return d[0] === k; })[0][1]; }).join(', ') : '', F.x ? 'Also in MDDB' : ''].filter(Boolean);
      document.getElementById('f-sum').textContent = sum.length ? '· ' + sum.join(' · ') : '';
      document.getElementById('ts-panel').hidden = !r.length;
      document.getElementById('ts-res').innerHTML = r.map(rowLink).join('');
      document.getElementById('ts-more').hidden = r.total <= r.length;
      if (v || test) msg.textContent = r.length ? 'Showing ' + num(r.length) + ' of ' + num(r.total) + (test ? ' structures' : ' results') + '.' : 'No results. Try another spelling, a related term or fewer filters.';
      else msg.innerHTML = tip;
      wireTry();
      sync();
    }
    function wireTry() { each('[data-try]', function (a) { if (a.dataset.w) return; a.dataset.w = 1; a.addEventListener('click', function (e) { e.preventDefault(); q.value = a.getAttribute('data-try'); shown = 30; run(); }); }); }
    q.addEventListener('input', function () { shown = 30; run(); });
    each('[data-db]', function (b) { b.addEventListener('click', function () { var d = b.getAttribute('data-db'); on[d] = !on[d]; b.setAttribute('aria-pressed', on[d]); run(); }); });
    each('[data-m]', function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-m'), i = F.m.indexOf(k); if (i < 0) F.m.push(k); else F.m.splice(i, 1); b.setAttribute('aria-pressed', i < 0); shown = 30; run(); }); });
    each('[data-dom]', function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-dom'), i = F.d.indexOf(k); if (i < 0) F.d.push(k); else F.d.splice(i, 1); b.setAttribute('aria-pressed', i < 0); shown = 30; run(); }); });
    var fx = document.getElementById('f-mddb');
    if (fx) fx.addEventListener('click', function () { F.x = F.x ? 0 : 1; fx.setAttribute('aria-pressed', !!F.x); shown = 30; run(); });
    var fo = document.getElementById('f-org'), fot = null;
    fo.addEventListener('input', function () { clearTimeout(fot); fot = setTimeout(function () { F.o = fo.value; shown = 30; run(); }, 200); });
    [['f-res', 'r'], ['f-y0', 'y0'], ['f-y1', 'y1'], ['f-fam', 'f']].forEach(function (x) {
      document.getElementById(x[0]).addEventListener('change', function (e) { F[x[1]] = x[1] === 'f' ? e.target.value : +e.target.value || 0; shown = 30; run(); });
    });
    document.getElementById('f-clear').addEventListener('click', function () {
      F = { m: [], r: 0, y0: 0, y1: 0, f: '', o: '', d: [], x: 0 };
      each('[data-m], [data-dom], #f-mddb', function (b) { b.setAttribute('aria-pressed', 'false'); });
      ['f-res', 'f-y0', 'f-y1', 'f-fam', 'f-org'].forEach(function (id) { document.getElementById(id).value = ''; });
      shown = 30; run();
    });
    document.getElementById('f-copy').addEventListener('click', function () {
      var t = state(), u = SITE + '#/search/text' + (t ? '?' + t : ''), m = document.getElementById('f-msg');
      function done(ok) { m.textContent = ok ? 'Link copied.' : u; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(function () { done(true); }, function () { done(false); }); else done(false);
    });
    document.getElementById('ts-more').addEventListener('click', function () { shown += 30; run(); });
    wireTry();
    if (q.value || active) run();
    q.focus();
  }

  /* ---------- static pages ---------- */
  function pageStatic(name, active, title) {
    show(active, '<p class="muted">Loading…</p>', title);
    getText('pages/' + name + '.html').then(function (t) { if (route.current === active) show(active, t, title); });
  }
  var STAGES = ['identified', 'simulating', 'converting', 'analysing', 'done'];
  function pageStatus() {
    show('status', '<p class="muted">Loading…</p>', 'Pipeline status');
    getJSON('data/status.json').then(function (s) {
      if (route.current !== 'status') return;
      /* the waiting and stopped jobs are for the team: shown only at #/status?all */
      var stalled = /(^|&)all(&|=|$)/.test(route.query) ? (s.stalled || []) : [], age = s.written ? Math.floor((Date.now() - new Date(s.written).getTime()) / 864e5) : 0, old = age > 14;
      var nSt = {}; stalled.forEach(function (j) { nSt[j.status] = (nSt[j.status] || 0) + 1; });
      var parts = [['identified', 'identified and waiting to be simulated'], ['simulating', 'stopped during simulation'], ['converting', 'stopped during conversion'], ['analysing', 'stopped during analysis']].filter(function (x) { return nSt[x[0]]; }).map(function (x) { return num(nSt[x[0]]) + ' ' + x[1]; });
      /* once the status file is old, a job whose entry is already on the site has finished since */
      var jobs = (s.jobs || []).filter(function (j) { return !(old && byId[j.id]); });
      show('status', '<div class="stack"><div class="pagehead"><h1>Pipeline status</h1><p class="muted" style="max-width:44rem">New membrane protein structures in the PDB are picked up by the MemProtMD pipeline, simulated and analysed. Proteins shown here are in the pipeline, so may not be on the site yet.</p>' +
        (old ? '<p class="panel" role="status" style="max-width:44rem"><strong>The pipeline last reported on ' + esc(fmtDate(s.written)) + '.</strong> It has not reported since, so this page shows where each job stood on that date.</p>' : '') + '</div>' +
        '<input class="field" id="st-q" type="search" placeholder="Filter by PDB code" aria-label="Filter by PDB code" style="max-width:20rem"><h2>' + (old ? 'In progress at the last report' : 'In progress') + '</h2><div class="jobs">' + jobs.map(function (j) {
          var at = STAGES.indexOf(j.status);
          return '<div class="panel" data-job="' + esc(j.id) + '"><div class="job-top">' + imgTag('pdb100', j.id) + '<div>' + (byId[j.id] ? '<a class="mono" style="font-size:1.25rem;font-weight:500;text-decoration:none" href="' + refHref('PDB', j.id) + '">' + esc(j.id) + '</a>' : '<span class="mono" style="font-size:1.25rem;font-weight:500">' + esc(j.id) + '</span>') + '<p class="small muted">' + esc(j.status.charAt(0).toUpperCase() + j.status.slice(1)) + ' since ' + esc(fmtDate(j.time)) + '</p></div></div>' +
            '<div class="steps">' + STAGES.map(function (st, i) { return '<span class="' + (i < at ? 'done' : i === at ? 'now' : '') + '">' + st.charAt(0).toUpperCase() + st.slice(1) + '</span>'; }).join('') + '</div></div>';
        }).join('') + '</div>' + (jobs.length ? '' : '<p class="muted">' + (old ? 'Nothing was part-way through the pipeline at the last report.' : 'Nothing is running through the pipeline at the moment.') + '</p>') +
        (stalled.length ? '<details class="stalled" id="st-stalled"><summary>Waiting or stopped <span class="muted">· ' + num(stalled.length) + '</span></summary><p class="small muted">Structures the pipeline has found but not finished, so they are not in the database yet: ' + parts.join(', ') + '. Stopped jobs need restarting by hand.</p><ul>' + stalled.map(function (j) {
          return '<li data-job="' + esc(j.id) + '">' + (byId[j.id] ? '<a class="mono" href="' + refHref('PDB', j.id) + '">' + esc(j.id) + '</a>' : '<span class="mono">' + esc(j.id) + '</span>') + '<span>' + esc(j.status.charAt(0).toUpperCase() + j.status.slice(1)) + ' since ' + esc(fmtDate(j.time)) + '</span><span class="muted">' + esc(j.error || '') + '</span></li>';
        }).join('') + '</ul></details>' : '') +
        '<p class="small muted" id="st-none" hidden>No pipeline job matches that code.</p><p class="small muted">Pipeline last reported ' + esc(fmtDate(s.written)) + '.</p></div>', 'Pipeline status');
      var f = document.getElementById('st-q');
      f.addEventListener('input', function () { var n = 0, d = document.getElementById('st-stalled'); if (d && f.value.trim()) d.open = true; each('[data-job]', function (c) { c.hidden = c.getAttribute('data-job').indexOf(f.value.trim().toLowerCase()) === -1; if (!c.hidden) n++; }); document.getElementById('st-none').hidden = n > 0; });
    });
  }

  /* ---------- histograms ---------- */
  function hist(title, all, sel) {
    var keys = Object.keys(all).sort(function (a, b) { return parseFloat(a) - parseFloat(b) || String(a).localeCompare(String(b)); });
    function tot(o) { var s = 0; keys.forEach(function (k) { s += o[k] || 0; }); return s || 1; }
    var sa = tot(all), ss = tot(sel), mx = 0;
    keys.forEach(function (k) { mx = Math.max(mx, (all[k] || 0) / sa, (sel[k] || 0) / ss); });
    var bh = Math.max(5, Math.min(18, Math.floor(260 / keys.length))), W = 260, L = 84, H = keys.length * bh + 8, step = Math.ceil(keys.length / 14);
    var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + ': this group against all entries">';
    keys.forEach(function (k, i) {
      var y = 4 + i * bh, wa = (all[k] || 0) / sa / mx * (W - L - 4), ws = (sel[k] || 0) / ss / mx * (W - L - 4), lab = sentence(k);
      if (i % step === 0) s += '<text x="' + (L - 6) + '" y="' + (y + bh / 2 + 3.5) + '" text-anchor="end">' + esc(lab.length > 15 ? lab.slice(0, 14) + '…' : lab) + '</text>';
      s += '<rect class="all" x="' + L + '" y="' + y + '" width="' + wa.toFixed(1) + '" height="' + (bh - 1) + '"><title>' + esc(k) + ': ' + (all[k] || 0) + ' of all entries</title></rect>';
      s += '<rect class="sel" x="' + L + '" y="' + (y + bh * 0.28).toFixed(1) + '" width="' + ws.toFixed(1) + '" height="' + Math.max(2, bh * 0.44).toFixed(1) + '" rx="1"><title>' + esc(k) + ': ' + (sel[k] || 0) + ' in this group</title></rect>';
    });
    return '<div class="hist"><h3>' + title + '</h3>' + s + '</svg></div>';
  }
  function tally(ids) {
    var y = {}, m = {}, r = {}, th = {}, dt = {}, tm = {}, dom = {}, tv = [];
    ids.forEach(function (id) {
      var e = byId[id]; if (!e) return;
      if (e[5]) { var yr = String(e[5]).slice(0, 4); y[yr] = (y[yr] || 0) + 1; }
      if (e[3]) m[e[3]] = (m[e[3]] || 0) + 1;
      if (e[4]) { var b = Math.min(12, Math.floor(e[4] * 2) / 2).toFixed(1); r[b] = (r[b] || 0) + 1; }
      var s = e[7];
      if (s) {
        if (s[0] != null) { var t = Math.max(28, Math.min(44, Math.round(s[0]))); th[t] = (th[t] || 0) + 1; tv.push(s[0]); }
        if (s[1] != null) { var c = Math.max(-10, Math.min(6, Math.round(s[1]))); dt[c] = (dt[c] || 0) + 1; }
        if (s[2] != null) {   // null: the chains were not analysed
          var k = s[3] ? 'β-barrel' : s[2] ? (s[2] > 14 ? '15+' : String(s[2])) : 'none';
          tm[k] = (tm[k] || 0) + 1;
        }
      }
      var seen = {}; orgsOf(e).forEach(function (o) { var d = o[1] || 'Other'; if (!seen[d]) { seen[d] = 1; dom[d] = (dom[d] || 0) + 1; } });
    });
    tv.sort(function (a, b) { return a - b; });
    return { year: y, method: m, res: r, thick: th, thin: dt, tm: tm, dom: dom, median: tv.length ? tv[Math.floor(tv.length / 2)] : null };
  }

  /* ---------- collection ---------- */
  function crumbs(parts) { return '<nav class="crumbs" aria-label="Breadcrumb">' + parts.map(function (p, i) { return (i ? '<span class="sep">/</span>' : '') + (p[1] ? '<a href="' + p[1] + '">' + p[0] + '</a>' : '<span>' + p[0] + '</span>'); }).join('') + '</nav>'; }
  function pageCollection(db, acc) {
    var id = db + '|' + acc, c = colById[id];
    if (!c) return notFound(id);
    var line = lineage(id), mem = members(c).filter(function (m) { return byId[m]; });
    var children = (kids[id] || []).slice().sort(function (a, b) { return colById[b].n - colById[a].n; });
    var st = { n: 25, kidsAll: false, sort: 'date', dir: -1, full: null };
    if (!ALL) ALL = tally(DB.pdb.map(function (r) { return r[0]; }));
    var mine = tally(mem);
    function sorted() {
      var k = st.sort, d = st.dir;
      return mem.slice().sort(function (a, b) {
        var x = byId[a], y = byId[b];
        if (k === 'id') return d * a.localeCompare(b);
        if (k === 'res') return d * ((x[4] || 99) - (y[4] || 99));
        return d * String(x[5] || '').localeCompare(String(y[5] || ''));
      });
    }
    function th(k, label, cls) { return '<th class="' + (cls || '') + '"><button type="button" data-sort="' + k + '"' + (st.sort === k ? ' aria-sort="' + (st.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + label + (st.sort === k ? (st.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>'; }
    function render() {
      var f = st.full || {}, hero = imgUrl('colhero', db + '/' + acc), list = sorted();
      var kshow = st.kidsAll ? children : children.slice(0, 10);
      var h = '<div class="stack-lg"><div class="pagehead">' + crumbs([['Home', href('home')]].concat(line.slice(0, -1).map(function (l) { return [ttl(colById[l].title), refHref(colById[l].db, colById[l].acc)]; })).concat([[ttl(c.title), null]])) +
        '<h1>' + ttl(c.title) + '</h1><div class="idline"><span class="tag">' + esc((DBNAMES[db] || db) + ' · ' + acc) + '</span><span>' + num(c.n) + ' simulated structures</span>' + (c.sub ? '<span>' + esc(c.sub) + '</span>' : '') + '</div>' +
        (f.description ? '<p style="max-width:46rem">' + esc(f.description) + (f.description_copyright ? ' <span class="small muted">Text by ' + esc(f.description_copyright.owner) + ', ' + extA(f.description_copyright.origin, 'original') + ', ' + extA(f.description_copyright.terms, 'terms') + '.</span>' : '') + '</p>' : '') +
        (f.keywords_string || f.auto_keywords ? '<p class="small muted">Keywords: ' + esc(f.keywords_string || f.auto_keywords) + '</p>' : '') +
        (f.href ? '<p class="small">' + extA(f.href, 'View this group at ' + esc((f.copyright && f.copyright.owner) || 'its source') + ' ↗') + '</p>' : '') + '</div>' +
        '<div class="cols"><div class="stack">' +
        (children.length ? '<section class="panel"><h2>Subgroups</h2><div class="rowlist">' + kshow.map(function (k) { var kc = colById[k]; return rowLink({ db: kc.db, acc: kc.acc, title: kc.title, size: kc.n }); }).join('') + '</div>' + (children.length > 10 ? '<p style="margin-top:.9rem"><button class="btn ghost" type="button" data-act="kids">' + (st.kidsAll ? 'Show fewer' : 'Show all ' + children.length + ' subgroups') + '</button></p>' : '') + '</section>' : '') +
        (mem.length ? '<section class="panel"><h2>Structures in this group</h2><div class="scroll"><table class="tbl"><thead><tr>' + th('id', 'PDB') + '<th>Title</th>' + th('date', 'Released', 'opt') + '<th class="opt">Method</th>' + th('res', 'Å', 'num') + '</tr></thead><tbody>' +
          list.slice(0, st.n).map(function (m) { var e = byId[m]; return '<tr><td class="id"><a href="' + refHref('PDB', m) + '">' + m + '</a></td><td>' + ttl(pdbTitle(e[1], m)) + '</td><td class="nw opt">' + esc(e[5] || '') + '</td><td class="opt small muted method">' + esc(sentence(e[3] || '')) + '</td><td class="num">' + (e[4] ? Number(e[4]).toFixed(1) : '') + '</td></tr>'; }).join('') +
          '</tbody></table></div>' + (mem.length > st.n ? '<p style="margin-top:1rem"><button class="btn ghost" type="button" data-act="more">Show 25 more of ' + num(mem.length) + '</button></p>' : '') + '</section>' : '') +
        '</div><aside class="stack">' + (hero ? '<div class="well"><img class="heroimg" src="' + hero + '" data-fb="hide" alt="Example structures from this group in their bilayers" onerror="mpmFb(this)"></div>' : '') +
        '<section class="panel stack"><h2>How this group compares</h2><div class="legend"><span><i class="s"></i>This group</span><span><i></i>All entries</span></div><div class="hists">' +
        (mine.median != null && ALL.median != null ? '<p class="small">Median bilayer thickness next to the protein: <b>' + mine.median.toFixed(1) + ' Å</b> <span class="muted">(all entries ' + ALL.median.toFixed(1) + ' Å)</span></p>' : '') +
        hist('Bilayer thickness next to the protein (Å)', ALL.thick, mine.thick) + hist('Thickness change from bulk (Å)', ALL.thin, mine.thin) + hist('Most TM helices in one chain', ALL.tm, mine.tm) +
        hist('Domain of life', ALL.dom, mine.dom) + hist('Publication year', ALL.year, mine.year) + hist('Experimental method', ALL.method, mine.method) + hist('Resolution (Å)', ALL.res, mine.res) +
        '</div><p class="small muted">Each set is normalised separately. Thickness is measured from the simulations; values beyond the ends of each scale are counted in the end bars.</p></section></aside></div></div>';
      show(null, h, plain(c.title));
      each('[data-act]', function (b) { b.addEventListener('click', function () { var a = b.getAttribute('data-act'); if (a === 'more') st.n += 25; else st.kidsAll = !st.kidsAll; keep(); }); });
      each('[data-sort]', function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-sort'); if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'date' ? -1 : 1; } keep(); }); });
    }
    function keep() { var y = window.scrollY; render(); window.scrollTo(0, y); }
    render();
    groupInfo(db).then(function (g) { if (g[id]) { st.full = g[id]; if (route.current === 'ref/' + db + '/' + acc) keep(); } });
  }

  /* ---------- entry ---------- */
  var VIEWS = [
    ['Membrane distortion', [['Top', 'top-distortions'], ['Front', 'front-distortions'], ['Bottom', 'bottom-distortions']], 1, 'Average surface of the lipid phosphates over the final 800 ns. Red is thinner than the bulk bilayer, blue is thicker.'],
    ['Lipids', [['Coarse-grained', 'front-cg_lipids'], ['Atomistic', 'front-at_lipids'], ['Protein only', 'front-cartoon']], 0, 'Coarse-grained lipids show glycerol in yellow, phosphate in red and choline in blue. Atomistic lipids use CPK colours.']
  ];
  var CONTACTS = [['Head groups', 'head'], ['Acyl tails', 'tail'], ['Solvent', 'solvent']], REPS = [['Cartoon', 'cartoon'], ['Surface', 'surface']];
  var FILES = [
    ['Snapshots', [['ready.pdb', 'files/structures/ready.pdb', 'Starting structure used for the simulation'], ['atomistic.pdb', 'files/structures/at.pdb', 'Atomistic snapshot made with CG2AT'], ['coarsegrained.pdb', 'files/structures/cg.pdb', 'Coarse-grained snapshot (MARTINI)'], ['distortions.pdb', 'files/structures/distortions.pdb', 'Membrane surface as PDB']]],
    ['Structures with contacts', [['head-contacts.pdb', 'files/structures/group_head.contacts.pdb', 'Head-group contacts as temperature factors'], ['tail-contacts.pdb', 'files/structures/group_tail.contacts.pdb', 'Acyl-tail contacts as temperature factors'], ['solvent-contacts.pdb', 'files/structures/group_solvent.contacts.pdb', 'Solvent contacts as temperature factors']]],
    ['Run files and data', [['atomistic-simulation.zip', 'files/run/at.zip', 'Ready-to-run atomistic simulation'], ['coarsegrained-simulation.zip', 'files/run/cg.zip', 'Ready-to-run coarse-grained simulation'], ['by-resid.csv', 'files/contacts/by_resid_postprocess.csv', 'Per-residue analysis'], ['thinning.latest.yml', 'thinning.latest.yml', 'Membrane thinning data']]]
  ];
  function gauge(t) {
    var sc = 2.2, bulk = t.bulk_thickness, ann = t.annular_thickness, H = Math.max(bulk, ann) * sc + 30;
    function slab(x, v, label) { var h = v * sc, y = (H - 18 - h) / 2 + 2; return '<rect class="lip" x="' + x + '" y="' + y + '" width="84" height="' + h + '" rx="3"/><rect class="hd" x="' + x + '" y="' + y + '" width="84" height="4" rx="2"/><rect class="hd" x="' + x + '" y="' + (y + h - 4) + '" width="84" height="4" rx="2"/><text x="' + (x + 42) + '" y="' + (H - 2) + '" text-anchor="middle">' + label + '</text>'; }
    return '<div class="gauge"><svg width="196" height="' + H + '" viewBox="0 0 196 ' + H + '" role="img" aria-label="Bilayer thickness in bulk and next to the protein, drawn to scale">' + slab(0, bulk, 'Bulk') + slab(112, ann, 'At protein') + '</svg>' +
      '<dl class="facts"><dt>Bulk bilayer</dt><dd>' + bulk.toFixed(1) + ' Å</dd><dt>Next to the protein</dt><dd>' + ann.toFixed(1) + ' Å</dd><dt>Change</dt><dd>' + (t.thickness_diff > 0 ? '+' : '−') + Math.abs(t.thickness_diff).toFixed(1) + ' Å</dd></dl></div>';
  }
  /* Residue density along the bilayer normal for one chain: all residues, helices and strands. */
  function violin(prof, chain, t) {
    var d = prof && prof.c[chain]; if (!d) return '';
    var n = d[0].length, mx = Math.max.apply(null, d[0].concat([1e-9])), Z = Math.max(Math.abs(prof.lo), Math.abs(prof.lo + n * prof.w), 25) * 1.04;
    function y(z) { return (50 - z / Z * 50).toFixed(1); }
    function shape(v, cls) {
      var L = [], R = [];
      for (var i = 0; i < n; i++) { var z = prof.lo + (i + 0.5) * prof.w, h = v[i] / mx * 44; L.push((50 - h).toFixed(1) + ',' + y(z)); R.unshift((50 + h).toFixed(1) + ',' + y(z)); }
      return '<polygon class="' + cls + '" points="' + L.concat(R).join(' ') + '"/>';
    }
    var half = (t && t.bulk_thickness ? t.bulk_thickness : 40) / 2;
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="-5" width="110" y="' + y(half) + '" height="' + (half / Z * 100).toFixed(1) + '"/>' + shape(d[0], 'all-density') + shape(d[1], 'alpha-density') + shape(d[2], 'beta-density') + '</svg>';
  }
  /* ---------- links out and citation ---------- */
  var SITE = CFG.siteUrl || 'https://stansfeldlab.github.io/memprotmd/';
  var MDDB = 'https://mdposit.mddbr.eu/';
  function uniAccs(r) {
    var seen = {}, out = [];
    (r.entities || []).forEach(function (en) { (en.refs || []).forEach(function (x) { if (x.db === 'UniProt' && x.accession && !seen[x.accession]) { seen[x.accession] = 1; out.push(x.accession); } }); });
    return out;
  }
  function xlinks(pdb, r) {
    function a(u, t) { return extA(u, t + '<span class="xa" aria-hidden="true">↗</span>'); }
    var acc = uniAccs(r), more = acc.length > 6 ? ' <span class="muted small">and ' + (acc.length - 6) + ' more</span>' : '';
    acc = acc.slice(0, 6);
    var rows = [['Structure', [a('https://www.rcsb.org/structure/' + pdb, 'RCSB PDB'), a('https://www.ebi.ac.uk/pdbe/entry/pdb/' + pdb, 'PDBe'), a('https://pdbj.org/mine/summary/' + pdb, 'PDBj')]],
      ['Membrane', [a('https://opm.phar.umich.edu/proteins?search=' + pdb, 'OPM'), a('https://pdbtm.unitmp.org/entry/' + pdb, 'PDBTM')]],
      ['Simulations', ['<span id="xl-mddb">' + a(MDDB + '#/browse?search=' + pdb, 'MDDB') + '</span>']]];
    if (acc.length) {
      rows.push(['UniProt', acc.map(function (x) { return a('https://www.uniprot.org/uniprotkb/' + x + '/entry', x); })]);
      rows.push(['AlphaFold', acc.map(function (x) { return a('https://alphafold.ebi.ac.uk/entry/' + x, x); })]);
    }
    return '<dl class="xlinks">' + rows.map(function (rw, i) { return '<dt>' + rw[0] + '</dt><dd>' + rw[1].join('') + (i >= 3 && more ? more : '') + '</dd>'; }).join('') + '</dl>';
  }
  /* MDDB lists simulations by PDB code; say how many there are, or that there are none yet. */
  function mddbCount(pdb) {
    var c = mddbCount.c || (mddbCount.c = {});
    if (!(pdb in c)) c[pdb] = fetch(MDDB + 'api/rest/v1/projects?search=' + pdb).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { return (j.projects || []).filter(function (x) { return ((x.metadata || {}).PDBIDS || []).some(function (id) { return String(id).toLowerCase() === pdb; }); }).length; })
      .catch(function () { return null; });
    c[pdb].then(function (n) {
      var el = document.getElementById('xl-mddb'); if (!el || n === null) return;
      el.innerHTML = n ? extA(MDDB + '#/browse?search=' + pdb, 'MDDB · ' + n + (n > 1 ? ' simulations' : ' simulation') + '<span class="xa" aria-hidden="true">↗</span>') : '<span class="muted">None in MDDB yet</span>';
    });
  }
  var CITE = 'Newport TD, Sansom MSP, Stansfeld PJ (2019). The MemProtMD database: a resource for membrane-embedded protein structures and their lipid interactions. Nucleic Acids Research 47(D1):D390–D397. doi:10.1093/nar/gky1047';
  var CITE_BIB = '@article{newport2019memprotmd,\n  author = {Newport, Thomas D. and Sansom, Mark S. P. and Stansfeld, Phillip J.},\n  title = {The {MemProtMD} database: a resource for membrane-embedded protein structures and their lipid interactions},\n  journal = {Nucleic Acids Research},\n  volume = {47},\n  number = {D1},\n  pages = {D390--D397},\n  year = {2019},\n  doi = {10.1093/nar/gky1047}\n}';
  function today() { return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function citeBox(pdb, cit) {
    var u = SITE + 'pdb/' + pdb + '/', P = pdb.toUpperCase();
    return '<section class="panel stack"><h2>Cite this entry</h2><p class="cite">' + esc(CITE).replace('doi:10.1093/nar/gky1047', extA('https://doi.org/10.1093/nar/gky1047', 'doi:10.1093/nar/gky1047')) + '</p>' +
      '<p class="small muted">Entry: MemProtMD PDB ' + P + ', <a href="' + esc(u) + '">' + esc(u) + '</a> (accessed ' + today() + '). Please also cite the original structure' + (cit && cit.DOI ? ', ' + extA('https://doi.org/' + cit.DOI, 'doi:' + esc(cit.DOI)) : '') + '.</p>' +
      '<div class="btns"><button class="btn ghost" type="button" data-copy="txt">Copy citation</button><button class="btn ghost" type="button" data-copy="bib">Copy BibTeX</button><span class="small muted" id="cite-msg" role="status"></span></div></section>';
  }
  function wireCite(pdb, cit) {
    var u = SITE + 'pdb/' + pdb + '/', P = pdb.toUpperCase();
    var txt = CITE + '\nMemProtMD entry PDB ' + P + ', ' + u + ' (accessed ' + today() + ').' + (cit && cit.DOI ? '\nOriginal structure: doi:' + cit.DOI : '');
    var bib = CITE_BIB + '\n@misc{memprotmd_' + pdb + ',\n  title = {{MemProtMD} entry {PDB} ' + P + '},\n  howpublished = {\\url{' + u + '}},\n  note = {Accessed ' + today() + '}\n}';
    each('[data-copy]', function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-copy') === 'bib' ? bib : txt, msg = document.getElementById('cite-msg');
        function done(ok) { if (msg) msg.textContent = ok ? 'Copied.' : 'Copy failed. Select the text above instead.'; }
        function legacy() { var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); done(ok); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { done(true); }, legacy); else legacy();
      });
    });
  }

  /* ---------- 3D viewer (Mol*, loaded on demand) ---------- */
  var MOLSTAR = CFG.molstar || 'https://cdn.jsdelivr.net/npm/molstar@5.13.1/build/viewer/';
  var CHAIN_COLS = ['#1f499e', '#c8003f', '#0f8b7a', '#d48a00', '#6b4fbb', '#2f86c9', '#b5476b', '#5a7d1a'];
  var MOL_COLOR = [['Structure', null], ['Head groups', 'head'], ['Tails', 'tail'], ['Solvent', 'solvent']];
  var MOL_STYLE = ['Cartoon', 'Surface'];
  var MOL_MEM = ['Phosphates', 'Lipids', 'Hidden'];
  var CON_PAL = { head: ['#eef1f6', '#f2b552', '#c8003f'], tail: ['#eef1f6', '#7fcfc0', '#0b6e60'], solvent: ['#eef1f6', '#8fb0f2', '#17397b'] };
  var AA = ' ALA ARG ASN ASP CYS GLN GLU GLY HIS HSD HSE HSP ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL ';
  function molFresh() { return { pdb: null, open: false, viewer: null, el: null, src: null, con: {}, color: 0, style: 0, mem: 0, busy: false, again: false, first: true, note: '', sel: null }; }
  var MOL = molFresh();
  function molReset() {
    var m = MOL; MOL = molFresh();
    if (m.viewer) { try { m.viewer.dispose(); } catch (e) {} }
    Object.keys(m.con).forEach(function (k) { if (m.con[k]) URL.revokeObjectURL(m.con[k]); });
    if (m.src && m.src.blob) URL.revokeObjectURL(m.src.url);
  }
  var molLib = null;
  function loadMolstar() {
    if (window.molstar && window.molstar.Viewer) return Promise.resolve(window.molstar);
    if (molLib) return molLib;
    molLib = new Promise(function (ok, no) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = MOLSTAR + 'theme/light.css'; document.head.appendChild(l);
      var s = document.createElement('script'); s.src = MOLSTAR + 'molstar.js'; s.async = true;
      s.onload = function () { window.molstar && window.molstar.Viewer ? ok(window.molstar) : no(new Error('Mol* did not start')); };
      s.onerror = function () { molLib = null; s.remove(); no(new Error('Mol* could not be downloaded')); };
      document.head.appendChild(s);
    });
    return molLib;
  }
  function fetchText(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }); }
  function pdbLines(t, f) { t.split('\n').forEach(function (l) { var k = l.slice(0, 6); if (k === 'ATOM  ' || k === 'HETATM') f(l); }); }
  function molSource(pdb, base) {
    return fetchText(base + 'files/structures/web_vis.pdb').then(function (t) {
      if (!/\n(ATOM|HETATM)/.test('\n' + t)) throw new Error('empty');
      var ss = { h: [], s: [] };
      t.split('\n').forEach(function (l) {
        var k = l.slice(0, 5), b, e;
        if (k === 'HELIX') { b = parseInt(l.substr(21, 4), 10); e = parseInt(l.substr(33, 4), 10); if (b <= e) ss.h.push({ beg_auth_seq_id: b, end_auth_seq_id: e }); }
        else if (k === 'SHEET') { b = parseInt(l.substr(22, 4), 10); e = parseInt(l.substr(33, 4), 10); if (b <= e) ss.s.push({ beg_auth_seq_id: b, end_auth_seq_id: e }); }
      });
      return { url: URL.createObjectURL(new Blob([t], { type: 'text/plain' })), format: 'pdb', blob: true, ss: ss };
    }).catch(function () { return { url: 'https://models.rcsb.org/' + pdb + '.bcif', format: 'bcif', rcsb: true, chains: null }; });
  }
  function molContacts(base, g) {
    if (g in MOL.con) return Promise.resolve(MOL.con[g]);
    var m = MOL;
    return fetchText(base + 'files/structures/group_' + g + '.contacts.pdb').then(function (t) {
      var rows = [], at = {};
      pdbLines(t, function (l) {
        var r = parseInt(l.substr(22, 4), 10), b = parseFloat(l.substr(60, 6)), k = 'r' + r;
        if (isNaN(r) || isNaN(b)) return;
        if (k in at) { if (b > rows[at[k]].value) rows[at[k]].value = b; return; }
        at[k] = rows.length; rows.push({ auth_seq_id: r, value: b });
      });
      if (!rows.length) throw new Error('empty');
      return URL.createObjectURL(new Blob([JSON.stringify(rows)], { type: 'application/json' }));
    }).catch(function () { return null; }).then(function (u) { if (m === MOL) m.con[g] = u; else if (u) URL.revokeObjectURL(u); return u; });
  }
  function molTree() {
    var s = MOL.src, g = MOL_COLOR[MOL.color][1], cu = g && MOL.con[g], kids = [];
    var rep = { kind: 'representation', params: MOL.style ? { type: 'surface', surface_type: 'gaussian' } : { type: 'cartoon' }, children: [] };
    if (cu) rep.children.push({ kind: 'color', params: { color: '#eef1f6' } }, { kind: 'color_from_uri', params: { uri: cu, format: 'json', schema: 'auth_residue', field_name: 'value', palette: { kind: 'continuous', colors: CON_PAL[g] } } });
    else if (s.ss && (s.ss.h.length || s.ss.s.length)) {
      rep.children.push({ kind: 'color', params: { color: '#dfe4ec' } });
      if (s.ss.h.length) rep.children.push({ kind: 'color', params: { selector: s.ss.h, color: '#2f6fd0' } });
      if (s.ss.s.length) rep.children.push({ kind: 'color', params: { selector: s.ss.s, color: '#17946b' } });
    } else {
      var ch = s.chains && s.chains.length ? s.chains : null;
      rep.children.push({ kind: 'color', params: { color: CHAIN_COLS[0] } });
      if (ch && ch.length > 1) ch.forEach(function (id, i) { rep.children.push({ kind: 'color', params: { selector: { auth_asym_id: id }, color: CHAIN_COLS[i % CHAIN_COLS.length] } }); });
    }
    if (MOL.sel && MOL.sel.chain) rep.children.push({ kind: 'color', params: { selector: { auth_asym_id: MOL.sel.chain, beg_auth_seq_id: MOL.sel.a, end_auth_seq_id: MOL.sel.b }, color: '#f08c00' } });
    var prot = { kind: 'component', params: { selector: 'protein' }, children: [rep] };
    if (!s.rcsb) prot.children.push({ kind: 'focus', params: { direction: [0, 1, 0], up: [0, 0, 1], radius_factor: 1.15 } });
    kids.push(prot);
    if (s.rcsb) kids.push({ kind: 'component', params: { selector: 'ligand' }, children: [{ kind: 'representation', params: { type: 'ball_and_stick' }, children: [{ kind: 'color', params: { color: '#8a94a8' } }] }] });
    else if (MOL.mem < 2) {
      var L = molMount.lipids || ['DPPC'], names = [];
      L.forEach(function (n) { n = String(n).toUpperCase(); [n, n.slice(0, 3)].forEach(function (x) { if (names.indexOf(x) < 0) names.push(x); }); });
      if (MOL.mem === 1) kids.push({ kind: 'component', params: { selector: names.map(function (n) { return { label_comp_id: n }; }) }, children: [{ kind: 'representation', params: { type: 'line' }, children: [{ kind: 'color', params: { color: '#a7afbf' } }] }] });
      kids.push({ kind: 'component', params: { selector: names.map(function (n) { return { label_comp_id: n, type_symbol: 'P' }; }) }, children: [{ kind: 'representation', params: { type: 'spacefill', size_factor: 0.85 }, children: [{ kind: 'color', params: { color: '#e0a526' } }] }] });
    }
    return { metadata: { version: '1' }, root: { kind: 'root', children: [{ kind: 'canvas', params: { background_color: '#ffffff' } },
      { kind: 'download', params: { url: s.url }, children: [{ kind: 'parse', params: { format: s.format }, children: [{ kind: 'structure', params: { type: 'model' }, children: kids }] }] }] } };
  }
  function molXr(ms) { try { return [[ms.lib.plugin.PluginConfig.Viewport.ShowXR, 'auto']]; } catch (e) { return []; } }
  function molStatus(t) { var e = MOL.el && MOL.el.querySelector('.mol-status'); if (e) { e.textContent = t || ''; e.hidden = !t; } }
  function molNote() {
    var n = document.getElementById('mol-note'); if (!n) return;
    var g = MOL_COLOR[MOL.color][1], t = [];
    if (MOL.src && MOL.src.rcsb) t.push('The simulation snapshot could not be loaded, so this is the deposited PDB structure without the bilayer.');
    if (g && MOL.src && MOL.con[g] === null) t.push('Contact data for this entry could not be loaded.');
    else if (g) t.push('Coloured by average occupancy within 6 Å over the final 800 ns, pale to strong.');
    else if (MOL.src && !MOL.src.rcsb) t.push('Final atomistic snapshot: helices in blue, strands in green, and lipid phosphorus atoms in gold.');
    n.textContent = t.join(' ');
  }
  function molPaint(base) {
    var m = MOL;
    if (m.busy) { m.again = true; return; }
    m.busy = true; m.again = false;
    var g = MOL_COLOR[m.color][1];
    (g ? molContacts(base, g) : Promise.resolve()).then(function () {
      if (m !== MOL) return;
      return m.viewer.loadMvsData(JSON.stringify(molTree()), 'mvsj', { keepCamera: !m.first, doNotReportErrors: true });
    }).then(function () { m.first = false; }).catch(function () { molStatus('The structure could not be displayed.'); })
      .then(function () { if (m !== MOL) return; m.busy = false; molStatus(''); molNote(); if (m.again) molPaint(base); });
  }
  function molControls(base) {
    var c = document.getElementById('mol-ctrl'); if (!c) return;
    function seg3(k, labels, aria) { return '<div class="seg" role="group" aria-label="' + aria + '">' + labels.map(function (l, i) { return '<button type="button" data-mol="' + k + '" data-i="' + i + '" aria-pressed="' + (MOL[k] === i) + '">' + l + '</button>'; }).join('') + '</div>'; }
    var rc = MOL.src && MOL.src.rcsb, host = document.getElementById('mol-host');
    if (host && host.hasAttribute('data-compact')) {
      c.innerHTML = '<div class="molbar"><p class="small muted" id="mol-note"></p><div class="btns"><button type="button" class="btn ghost" id="mol-close">Back to image</button><a class="btn ghost" href="' + refHref('PDB', MOL.pdb) + '">Open entry</a></div></div>';
      molNote();
      document.getElementById('mol-close').addEventListener('click', function () { molClose(MOL.pdb, base); });
      return;
    }
    if (rc) MOL.color = 0;
    c.innerHTML = '<div class="molbar">' + (rc ? '' : '<div class="molrow"><span class="eyebrow">Colour by</span>' + seg3('color', MOL_COLOR.map(function (x) { return x[0]; }), 'Colour by') + '</div>') +
      '<div class="molrow"><span class="eyebrow">Protein</span>' + seg3('style', MOL_STYLE, 'Protein style') + '</div>' +
      (rc ? '' : '<div class="molrow"><span class="eyebrow">Bilayer</span>' + seg3('mem', MOL_MEM, 'Bilayer') + '</div>') +
      '<p class="small muted" id="mol-note"></p><div class="btns"><button type="button" class="btn ghost" id="mol-close">Back to image</button></div></div>';
    molNote();
    Array.prototype.forEach.call(c.querySelectorAll('[data-mol]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-mol'), i = +b.getAttribute('data-i'); if (MOL[k] === i) return;
        MOL[k] = i;
        Array.prototype.forEach.call(c.querySelectorAll('[data-mol="' + k + '"]'), function (x) { x.setAttribute('aria-pressed', String(+x.getAttribute('data-i') === i)); });
        if (MOL.viewer) molPaint(base);
      });
    });
    document.getElementById('mol-close').addEventListener('click', function () { molClose(MOL.pdb, base); });
  }
  /* Mounts the viewer into #mol-host; called after every render of the entry page. */
  function molMount(pdb, base, lipids, chains) {
    var host = document.getElementById('mol-host'); if (!host) return;
    if (lipids && lipids.length) molMount.lipids = lipids;
    if (chains && chains.length) molMount.chains = chains;
    if (!host.classList.contains('is-3d')) molMount.html = host.innerHTML;
    if (!(MOL.open && MOL.pdb === pdb)) {
      var b = document.getElementById('mol-open');
      if (b) b.addEventListener('click', function () { molOpen(pdb, base); });
      return;
    }
    host.classList.add('is-3d'); host.innerHTML = ''; host.appendChild(MOL.el);
    molControls(base);
    if (MOL.viewer) MOL.viewer.handleResize();
  }
  function molClose(pdb, base) {
    molReset();
    var host = document.getElementById('mol-host'), c = document.getElementById('mol-ctrl');
    if (c) c.innerHTML = '';
    if (host) { host.classList.remove('is-3d'); host.innerHTML = molMount.html || ''; molMount(pdb, base); var b = document.getElementById('mol-open'); if (b) b.focus(); }
  }
  function molOpen(pdb, base) {
    if (MOL.pdb !== pdb) molReset();
    var m = MOL, chains = molMount.chains; m.pdb = pdb; m.open = true;
    m.el = document.createElement('div'); m.el.className = 'molview';
    m.el.innerHTML = '<div class="mol-canvas" role="img" aria-label="Interactive 3D view of ' + esc(pdb.toUpperCase()) + ' in its simulated bilayer"></div><div class="mol-status">Loading the 3D viewer…</div>';
    molMount(pdb, base);
    Promise.all([loadMolstar(), molSource(pdb, base)]).then(function (r) {
      if (m !== MOL) { if (r[1].blob) URL.revokeObjectURL(r[1].url); return; }
      m.src = r[1]; if (m.src.rcsb && chains && chains.length) m.src.chains = chains;
      molStatus(m.src.rcsb ? 'Loading the PDB structure…' : 'Loading the simulation snapshot…');
      molControls(base);
      return r[0].Viewer.create(m.el.querySelector('.mol-canvas'), {
        layoutIsExpanded: false, layoutShowControls: false, layoutShowRemoteState: false, layoutShowSequence: false, layoutShowLog: false, layoutShowLeftPanel: false,
        viewportShowExpand: true, viewportShowSelectionMode: false, viewportShowAnimation: false, viewportShowTrajectoryControls: false, viewportShowSettings: false,
        viewportShowControls: false, viewportBackgroundColor: '#ffffff', pdbProvider: 'rcsb', collapseLeftPanel: true, config: molXr(r[0])
      }).then(function (v) { if (m !== MOL) { v.dispose(); return; } m.viewer = v; molPaint(base); });
    }).catch(function (err) { if (m === MOL) molStatus('The 3D viewer could not be loaded. ' + (err && err.message ? err.message + '.' : '')); });
  }

  function pageEntry(pdb, chainSel) {
    var e = byId[pdb];
    if (!e) return notFound('PDB ' + pdb);
    var sim = pdb + '_default_dppc', base = STORE + 'simulations/' + sim + '/';
    var st = { rec: null, tried: false, v: [1, 0], contact: 0, rep: 0, violins: null, cv: null };
    function seg(g, labels, sel, aria) { return '<div class="seg" role="group" aria-label="' + esc(aria) + '">' + labels.map(function (l, i) { return '<button type="button" data-g="' + g + '" data-i="' + i + '" aria-pressed="' + (i === sel) + '">' + l + '</button>'; }).join('') + '</div>'; }
    function view(title, opts, sel, stage, mode, controls, note) {
      return '<div class="view"><h3>' + title + '</h3><div class="well stage stage-' + mode + '" data-stage="' + stage + '">' + opts.map(function (o, i) {
        var u = imgUrl('sim', pdb + '/' + o[1]) || PH;
        var cls = mode === 'rotate' ? (i === sel ? 'is-front' : i < sel ? 'is-up' : 'is-down') : (i === sel ? 'is-on' : 'is-off');
        return '<img class="face ' + cls + '" data-i="' + i + '" ' + (i === sel ? 'src' : 'data-src') + '="' + u + '" alt="' + esc(title + ': ' + o[0]) + '"' + (i === sel ? '' : ' aria-hidden="true"') + ' onerror="mpmPh(this)">';
      }).join('') + '</div>' + controls + '<p>' + note + '</p></div>';
    }
    function faces(stage, sel, mode) {
      each('[data-stage="' + stage + '"] .face', function (f) {
        var i = +f.getAttribute('data-i'), on = i === sel;
        if (on && f.getAttribute('data-src')) { f.src = f.getAttribute('data-src'); f.removeAttribute('data-src'); }
        f.classList.remove('is-front', 'is-up', 'is-down', 'is-on', 'is-off');
        f.classList.add(mode === 'rotate' ? (on ? 'is-front' : i < sel ? 'is-up' : 'is-down') : (on ? 'is-on' : 'is-off'));
        if (on) f.removeAttribute('aria-hidden'); else f.setAttribute('aria-hidden', 'true');
      });
    }
    function applyViews() {
      faces('dist', st.v[0], 'rotate'); faces('lip', st.v[1], 'fade'); faces('con', st.contact * 2 + st.rep, 'fade');
      var cur = { v0: st.v[0], v1: st.v[1], contact: st.contact, rep: st.rep };
      each('[data-g]', function (b) { b.setAttribute('aria-pressed', String(cur[b.getAttribute('data-g')] === +b.getAttribute('data-i'))); });
    }
    function render() {
      var r = (st.rec && st.rec.ref) || {}, s = (st.rec && st.rec.sim) || {}, cit = r.primary_citation || {}, sv = s.sim_validate || {};
      var hasImgs = CFG.remoteImages !== false;
      var byDb = {}; collectionsOf(pdb).forEach(function (g) { var c = colById[g]; (byDb[c.db] = byDb[c.db] || []).push(c); });
      var groups = ['mpm', 'TCDB', 'mpstruc', 'Pfam', 'UniProt', 'organism', 'topology', 'ligand'].map(function (d) {
        var l = (byDb[d] || []).filter(function (c) { return !(DERIVED[d] && c.acc === d); }).sort(function (a, b) { return b.n - a.n; }); if (!l.length) return '';
        if (d === 'TCDB' || d === 'mpstruc') l = l.slice(-2);
        l = l.filter(function (c, i) { return !(l[i + 1] && l[i + 1].title === c.title); });   /* a system named after its only family shows once */
        return '<span class="eyebrow">' + esc(DBNAMES[d]) + '</span><div class="chips">' + l.map(function (c) { return '<a class="chip" href="' + refHref(c.db, c.acc) + '"><span>' + ttl(c.title) + '</span><b>' + num(c.n) + '</b></a>'; }).join('') + '</div>';
      }).join('');
      var ch = s.chains || [], selc = ch.filter(function (c) { return c.chainID === chainSel; })[0];
      var contactImgs = []; CONTACTS.forEach(function (cn) { REPS.forEach(function (rp) { contactImgs.push([cn[0] + ', ' + rp[0].toLowerCase(), 'front-contacts-' + cn[1] + '-' + rp[1]]); }); });
      var h = '<div class="stack-lg"><div class="cols entry"><div class="herocol"><div class="well herowell" id="mol-host"><img class="heroimg" src="' + (imgUrl('pdbhero', pdb) || PH) + '"' + fbAttr('pdbhero', pdb) + ' alt="' + esc(pdb.toUpperCase()) + ' in its simulated bilayer" onerror="mpmFb(this)">' +
          '<button type="button" class="btn mol-open" id="mol-open"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 17 6v8l-7 4-7-4V6z M10 2v8m0 0 7-4m-7 4-7-4m7 4v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>3D view</button></div><div id="mol-ctrl"></div></div>' +
        '<div class="stack"><div class="pagehead">' + crumbs([['Home', href('home')], ['Structures', refHref('mpm', 'membrane_proteins')], [pdb.toUpperCase(), null]]) +
        '<h1>' + ttl(pdbTitle(r.title || e[1], pdb)) + '</h1><div class="idline"><span class="tag">PDB ' + pdb + '</span>' + ((r.subtitle || e[2]) ? '<span>' + esc(sentence(r.subtitle || e[2])) + '</span>' : '') + '</div></div>' +
        '<dl class="facts">' + [['Released', fmtDate(e[5])], ['Method', esc(sentence(e[3] || ''))], ['Resolution', e[4] ? Number(e[4]).toFixed(2).replace(/0$/, '') + ' Å' : ''], ['Organism', orgNames(e).map(function (n) { return '<a href="' + href('search/text') + '?o=' + encodeURIComponent(n) + '"><i>' + esc(n) + '</i></a>'; }).join(', ')],
          ['Ligands', esc((r.ligands || []).map(function (l) { return sentence(l.description); }).join(', '))], ['Keywords', esc((r.keywords || []).join(', '))]].filter(function (p) { return p[1]; }).map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>' +
        (cit.title ? '<p class="cite">' + esc(ionFix(cit.title)) + ' <span class="muted">' + esc(((r.primary_authors || []).slice(0, 4).join(', ') + ((r.primary_authors || []).length > 4 ? ' et al' : '')).replace(/\.$/, '')) + '. ' + esc([cit.journal, cit.year].filter(Boolean).join(' ')) + '.</span> ' + (cit.DOI ? extA('https://doi.org/' + cit.DOI, 'doi:' + esc(cit.DOI)) : '') + '</p>' : '') +
        '<div class="btns">' + extA(base + 'files/structures/at.pdb', 'Atomistic PDB ↓', 'btn') + extA('https://molstar.org/viewer/?structure-url=' + encodeURIComponent(base + 'files/structures/at.pdb') + '&structure-url-format=pdb', 'Open in Mol* ↗', 'btn ghost') + '</div>' + xlinks(pdb, r) + '</div></div>' +
        (groups ? '<section class="panel"><h2>Member of</h2><div class="groups">' + groups + '</div></section>' : '') +
        '<section class="stack"><div class="head-row" style="margin:0"><h2>Simulation</h2><span class="mono muted">' + sim + '</span></div>' +
        (s.thinning ? '<div class="panel stack"><h3>Bilayer thickness</h3>' + gauge(s.thinning) + (sv.n_lipid_molecules ? '<p class="small muted">' + num(sv.n_lipid_molecules) + ' ' + esc(Object.keys(s.composition || { lipid: 1 }).join('/')) + ' lipids around ' + num(sv.n_protein_residues) + ' protein residues.</p>' : '') + '</div>' : '') +
        (hasImgs ? '<div class="panel"><div class="views">' +
          view(VIEWS[0][0], VIEWS[0][1], st.v[0], 'dist', 'rotate', seg('v0', VIEWS[0][1].map(function (o) { return o[0]; }), st.v[0], 'Membrane distortion view'), VIEWS[0][3]) +
          view(VIEWS[1][0], VIEWS[1][1], st.v[1], 'lip', 'fade', seg('v1', VIEWS[1][1].map(function (o) { return o[0]; }), st.v[1], 'Lipid view'), VIEWS[1][3]) +
          view('Lipid contacts', contactImgs, st.contact * 2 + st.rep, 'con', 'fade', '<div class="btns">' + seg('contact', CONTACTS.map(function (c) { return c[0]; }), st.contact, 'Contact group') + seg('rep', REPS.map(function (c) { return c[0]; }), st.rep, 'Representation') + '</div>', 'Average occupancy of the chosen group within 6 Å of the protein over the final 800 ns.') + '</div></div>'
          : '<p class="small muted">Rendered images load from file storage, which this preview cannot reach.</p>') + '</section>' +
        '<section class="panel stack"><h2>Polypeptide chains</h2>' + (!st.tried ? '<p class="muted">Loading…</p>' : !ch.length ? '<p class="muted">No chain analysis is recorded for this entry.</p>' :
          '<div class="chainpick">' + ch.map(function (c) {
            var tm = c.tm_alpha ? c.tm_alpha + ' TM helices' : c.tm_beta ? c.tm_beta + ' TM strands' : c.type;
            return '<a href="' + href('ref/PDB/' + pdb + '/chain/' + c.chainID) + '"' + (c.chainID === chainSel ? ' aria-current="true"' : '') + '>' + (st.rec && st.rec.prof && st.rec.prof.c[c.chainID] ? '<span class="chainsvg">' + violin(st.rec.prof, c.chainID, s.thinning) + '</span>' : '') + '<span>Chain ' + esc(c.chainID) + '<small>' + esc(tm) + '</small></span></a>';
          }).join('') + '</div>' + (st.rec && st.rec.prof ? '<p class="small muted">Each icon shows where the chain\'s residues sit along the bilayer normal: all residues in white, helices in blue, strands in green. The shaded band is the bulk bilayer.</p>' : '') +
          (selc ? '<dl class="facts"><dt>Placement</dt><dd>' + esc(sentence(selc.type.toUpperCase())) + '</dd><dt>Membrane-spanning helices</dt><dd>' + selc.tm_alpha + '</dd><dt>Membrane-spanning strands</dt><dd>' + selc.tm_beta + '</dd><dt>Lipid-facing elements</dt><dd>' + (selc.tm_alpha_lipid + selc.tm_beta_lipid) + '</dd></dl>' +
            '<div id="chain-view" class="stack"><p class="muted">Loading the chain analysis…</p></div>' : '<p class="small muted">Choose a chain for its membrane placement, topology and contacts along its sequence.</p>')) + '</section>' +
        '<section class="panel stack"><h2>Downloads</h2><p class="small muted">Files are served from file storage. Licensed under Creative Commons Attribution 4.0.</p><div class="files">' + FILES.map(function (g) {
          return '<div><h3>' + g[0] + '</h3><ul>' + g[1].map(function (f) { return '<li>' + extA(base + f[1], sim + '-' + f[0]) + '<span>' + f[2] + '</span></li>'; }).join('') + '</ul></div>';
        }).join('') + '</div></section>' + citeBox(pdb, cit) + '</div>';
      show(null, h, plain(pdbTitle(r.title || e[1], pdb)) + ' (' + pdb.toUpperCase() + ')');
      if (molMount.pdb !== pdb) { molMount.pdb = pdb; molMount.lipids = molMount.chains = null; }
      molMount(pdb, base, Object.keys(s.composition || {}), ch.map(function (c) { return c.chainID; }));
      mddbCount(pdb); wireCite(pdb, cit);
      if (selc) chainView(pdb, base, chainSel, s.thinning, st);
      each('[data-g]', function (b) { b.addEventListener('click', function () {
        var g = b.getAttribute('data-g'), i = +b.getAttribute('data-i');
        if (g === 'v0') st.v[0] = i; else if (g === 'v1') st.v[1] = i; else st[g] = i;
        applyViews();
      }); });
      applyViews();
      clearTimeout(st.pre); st.pre = setTimeout(function () { each('.stage img[data-src]', function (f) { f.src = f.getAttribute('data-src'); f.removeAttribute('data-src'); }); }, 1500);
    }
    function keep() { var y = window.scrollY; render(); window.scrollTo(0, y); }
    render();
    var jobs = [];
    jobs.push(getJSON('data/entries/' + pdb + '.json').then(function (j) { st.rec = j; }).catch(function () {}));
    Promise.all(jobs).then(function () { st.tried = true; if (route.current.indexOf('ref/PDB/' + pdb) === 0) keep(); });
  }

  /* ---------- chain analysis: topology and sequence views, drawn from each simulation's own files ---------- */
  var YAML_LIB = CFG.yaml || 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js', yamlLib = null, CHAIN_DATA = {};
  var AA1 = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', HSD: 'H', HSE: 'H', HSP: 'H', HIE: 'H', HID: 'H', CYX: 'C', MSE: 'M' };
  var OVERLAYS = [['Secondary structure', null], ['Tails', 'group=Tail'], ['Heads', 'group=Head'], ['Solvent', 'group=Solvent'], ['Upper leaflet', 'leaflet=a'], ['Lower leaflet', 'leaflet=b']];
  var BEADS = ['Choline', 'Phosphate', 'Glycerol', 'Tail_1', 'Tail_2', 'Tail_3', 'Tail_4'];
  function loadYaml() {
    if (window.jsyaml) return Promise.resolve(window.jsyaml);
    if (yamlLib) return yamlLib;
    yamlLib = new Promise(function (ok, no) {
      var sc = document.createElement('script'); sc.src = YAML_LIB; sc.async = true;
      sc.onload = function () { window.jsyaml ? ok(window.jsyaml) : no(new Error('yaml')); };
      sc.onerror = function () { yamlLib = null; sc.remove(); no(new Error('yaml')); };
      document.head.appendChild(sc);
    });
    return yamlLib;
  }
  function parseCsv(t) {
    var lines = t.split(/\r?\n/).filter(Boolean), head = lines[0].split(',');
    return { head: head, rows: lines.slice(1).map(function (l) { var f = l.split(','), o = {}; head.forEach(function (h, i) { o[h] = f[i]; }); return o; }) };
  }
  function chainData(base) {
    if (!CHAIN_DATA[base]) CHAIN_DATA[base] = Promise.all([
      Promise.all([loadYaml(), fetchText(base + 'build_ss_topology.latest.yml')]).then(function (r) { return r[0].load(r[1]); }).catch(function () { return null; }),
      fetchText(base + 'files/contacts/by_resid_postprocess.csv').then(parseCsv).catch(function () { return null; })
    ]).then(function (r) { return { topo: r[0], csv: r[1] }; });
    return CHAIN_DATA[base];
  }
  /* sequence tracks: [label, matching columns] — lipid columns are matched by leaflet and bead, whatever the lipid */
  function seqTracks(head) {
    function cols(re) { return head.filter(function (h) { return re.test(h); }); }
    var t = [['Flip-flops', cols(/^leaflet=flip$/)], ['Water', cols(/^resname=W$/)], ['Ions', cols(/^resname=ION$/)]];
    ['a', 'b'].forEach(function (l) { BEADS.forEach(function (b) { t.push([(l === 'a' ? 'Upper' : 'Lower') + ' ' + b.replace('_', ' ').toLowerCase(), cols(new RegExp('^leaflet=' + l + ';resname=[^;]+;bead=' + b + '$'))]); }); });
    return t.filter(function (x) { return x[1].length; });
  }
  function trackVal(row, cols) { var v = 0; cols.forEach(function (c) { v += parseFloat(row[c]) || 0; }); return Math.min(1, v); }
  function isHelix(d) { return d === 'H' || d === 'G' || d === 'I'; }
  function isStrand(d) { return d === 'E' || d === 'B'; }

  /* ---------- topology worked out in the browser ----------
     Where a simulation has no build_ss_topology file, the same diagram is built here from the per-residue
     table (DSSP code and average position of each residue). It follows the pipeline's build_ss_topology job,
     as ported to Python in MemPrO (mempro/topology.py): positions are smoothed over about one turn, each run
     of one DSSP class becomes an element whose x is the distance travelled in the membrane plane and whose
     y is z, the ends of helices and strands are straightened, and a Bezier curve is fitted. */
  var TOPO_WIN = { E: 4, B: 4, H: 3.6, G: 3, I: 4.1 }, TOPO_EDGE = { ssNone: [0, 1], ssAlpha: [5, 4], ssBeta: [1, 2] }, TOPO_MIN = { ssAlpha: 5, ssBeta: 4 };
  function topoClass(d) { return isHelix(d) ? 'ssAlpha' : isStrand(d) ? 'ssBeta' : 'ssNone'; }
  function topoBezier(n, vals) {
    var deg = n - 1, bin = [1], k;
    for (k = 1; k < n; k++) bin.push(bin[k - 1] * (deg - k + 1) / k);
    return vals.map(function (v) { var row = []; for (var i = 0; i < n; i++) row.push(bin[i] * Math.pow(v, i) * Math.pow(1 - v, deg - i)); return row; });
  }
  function topoSpace(n) { var o = []; for (var i = 0; i < n; i++) o.push(n > 1 ? i / (n - 1) : 0); return o; }
  /* least squares for the inner control points, the first and last fixed at the ends of the element */
  function topoFit(P, n) {
    var m = P.length, M = topoBezier(n, topoSpace(m)), a = P[0], b = P[m - 1], u = n - 2, i, j, k, r, c;
    var nodes = topoSpace(n).map(function (x) { return [a[0] * (1 - x) + b[0] * x, a[1] * (1 - x) + b[1] * x]; });
    if (u > 0 && m > 2) {
      var A = [], B = [];
      for (i = 0; i < u; i++) { A.push([]); B.push([0, 0]); for (j = 0; j < u; j++) A[i].push(i === j ? 1e-9 : 0); }
      for (k = 0; k < m; k++) {
        var tx = P[k][0] - M[k][0] * a[0] - M[k][n - 1] * b[0], ty = P[k][1] - M[k][0] * a[1] - M[k][n - 1] * b[1];
        for (i = 0; i < u; i++) { B[i][0] += M[k][i + 1] * tx; B[i][1] += M[k][i + 1] * ty; for (j = 0; j < u; j++) A[i][j] += M[k][i + 1] * M[k][j + 1]; }
      }
      for (c = 0; c < u; c++) {
        var p = c; for (r = c + 1; r < u; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        var t = A[c]; A[c] = A[p]; A[p] = t; t = B[c]; B[c] = B[p]; B[p] = t;
        if (Math.abs(A[c][c]) < 1e-14) continue;
        for (r = 0; r < u; r++) if (r !== c) { var f = A[r][c] / A[c][c]; if (f) { for (j = c; j < u; j++) A[r][j] -= f * A[c][j]; B[r][0] -= f * B[c][0]; B[r][1] -= f * B[c][1]; } }
      }
      for (i = 0; i < u; i++) if (Math.abs(A[i][i]) >= 1e-14 && isFinite(B[i][0] / A[i][i]) && isFinite(B[i][1] / A[i][i])) nodes[i + 1] = [B[i][0] / A[i][i], B[i][1] / A[i][i]];
    }
    var err = 0;
    for (k = 0; k < m; k++) { var x = 0, y = 0; for (i = 0; i < n; i++) { x += M[k][i] * nodes[i][0]; y += M[k][i] * nodes[i][1]; } err += Math.sqrt((x - P[k][0]) * (x - P[k][0]) + (y - P[k][1]) * (y - P[k][1])); }
    return { err: err / m, nodes: nodes };
  }
  function topoElement(S, cls) {
    var n = S.length, ec = TOPO_EDGE[cls][0], es = TOPO_EDGE[cls][1], ex = [0], ey = S.map(function (q) { return q[2]; }), i;
    if (n < ec * 2 + es) { ec = Math.floor(n / 3); es = Math.floor(n / 3) + 1; }
    for (i = 1; i < n; i++) ex.push(ex[i - 1] + Math.sqrt(Math.pow(S[i][0] - S[i - 1][0], 2) + Math.pow(S[i][1] - S[i - 1][1], 2)));
    if (es > 1) {
      var s0 = [ex[ec], ey[ec]], s1 = [ex[ec + es - 1], ey[ec + es - 1]], e1 = [ex[n - ec - es], ey[n - ec - es]], e0 = [ex[n - ec - 1], ey[n - ec - 1]];
      var sv = [(s1[0] - s0[0]) / (es - 1), (s1[1] - s0[1]) / (es - 1)], ev = [(e1[0] - e0[0]) / (es - 1), (e1[1] - e0[1]) / (es - 1)];
      for (i = 0; i < ec; i++) {
        ex[ec - (i + 1)] = s0[0] - (i + 1) * sv[0]; ey[ec - (i + 1)] = s0[1] - (i + 1) * sv[1];
        ex[n - ec + i] = e0[0] - (i + 1) * ev[0]; ey[n - ec + i] = e0[1] - (i + 1) * ev[1];
      }
    }
    var lo = Math.min.apply(null, ex), P = ex.map(function (x, j) { return [x - lo, ey[j]]; }), best = null;
    for (var np = 2; np <= Math.min(n + 1, 16); np++) { var f = topoFit(P, np); if (!best || f.err < best.err) best = f; if (f.err < 1) break; }
    var M = topoBezier(best.nodes.length, topoSpace(n));
    return M.map(function (row) { var x = 0, y = 0; row.forEach(function (w, k) { x += w * best.nodes[k][0]; y += w * best.nodes[k][1]; }); return { x: x, y: y }; });
  }
  function topoBuild(rows, mid) {
    var pos = rows.map(function (r) { var p = [parseFloat(r.x), parseFloat(r.y), parseFloat(r.z) + mid]; return isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2]) ? p : null; });
    var segs = [], cur = null, last = null;
    pos.forEach(function (p, i) {
      if (!p) { cur = null; return; }
      if (!cur || Math.sqrt(Math.pow(p[0] - last[0], 2) + Math.pow(p[1] - last[1], 2) + Math.pow(p[2] - last[2], 2)) > 6) segs.push(cur = []);
      cur.push(i); last = p;
    });
    return { computed: true, segments: segs.map(function (idxs) {
      var n = idxs.length, raw = idxs.map(function (i) { return pos[i]; });
      var sm = raw.map(function (_, i) {
        var w = Math.min(Math.min(i, n - i - 1) + 1, TOPO_WIN[rows[idxs[i]].DSSP] || 3), nm = 1 / w, fl = (w - 1) / 2, o = 0, v = raw[i].map(function (c) { return c * nm; });
        while (fl > 1e-9) { o++; var cv = Math.min(1, fl); for (var k = 0; k < 3; k++) v[k] += cv * nm * (raw[i + o][k] + raw[i - o][k]); fl -= cv; }
        return v;
      });
      var els = [], prev = null;
      idxs.forEach(function (ri, i) {
        var d = rows[ri].DSSP, cls = topoClass(d), code = cls === 'ssNone' ? '' : d === 'B' ? 'E' : d;
        if (code !== prev) { els.push({ DSSP: code, DSSPClass: cls, idxs: i ? [i - 1] : [], resIdxs: [] }); prev = code; }
        els[els.length - 1].resIdxs.push(ri); els[els.length - 1].idxs.push(i);
      });
      els.forEach(function (el) {
        el.plot = { basisFitted: topoElement(el.idxs.map(function (i) { return sm[i]; }), el.DSSPClass) }; delete el.idxs;
        if (el.resIdxs.length < (TOPO_MIN[el.DSSPClass] || 0)) el.DSSPClass = 'ssNone';   /* too short to draw as a helix or strand */
      });
      return { elements: els };
    }) };
  }

  function topoSvg(ct, rows, th, ov, sel) {
    var S = 3, mid = th && th.bulk_mid != null ? +th.bulk_mid : 0, pts = [], shapes = [], xo = 0;
    (ct.segments || []).forEach(function (sg, si) {
      if (si) xo += 12;
      var sx = xo;
      (sg.elements || []).forEach(function (el) {
        var P = ((el.plot || {}).basisFitted || []).map(function (q) { return [sx + q.x, q.y - mid]; });
        if (!P.length) return;
        shapes.push({ cls: el.DSSPClass, P: P, res: el.resIdxs || [] });
        (el.resIdxs || []).forEach(function (ri, j) { var a = P[Math.min(j, P.length - 1)], b = P[Math.min(j + 1, P.length - 1)]; pts[ri] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; });
        sx = P[P.length - 1][0];
      });
      xo = sx;
    });
    if (!shapes.length) return '';
    var am = th && th.annular_mid != null ? th.annular_mid - mid : 0, half = th && th.annular_thickness ? th.annular_thickness / 2 : 20;
    var zs = [am + half + 10, am - half - 10]; shapes.forEach(function (sh) { sh.P.forEach(function (q) { zs.push(q[1]); }); });
    var zmax = Math.max.apply(null, zs) + 4, zmin = Math.min.apply(null, zs) - 4, L = 70, R = 24, T = 10;
    function X(x) { return (L + x * S).toFixed(1); }
    function Y(z) { return (T + (zmax - z) * S).toFixed(1); }
    function line(P) { return P.map(function (q, i) { return (i ? 'L' : 'M') + X(q[0]) + ',' + Y(q[1]); }).join(''); }
    var W = L + xo * S + R, H = T + (zmax - zmin) * S + 10, up = am + half, lo = am - half;
    var h = '<svg class="topo" viewBox="0 0 ' + W.toFixed(0) + ' ' + H.toFixed(0) + '" width="' + W.toFixed(0) + '" height="' + H.toFixed(0) + '" role="img" aria-label="Topology of the chain relative to the bilayer">' +
      '<defs><marker id="topo-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0L10 5L0 10z" style="fill:var(--ss-strand)"/></marker></defs>' +
      '<rect class="topo-band" x="' + L + '" y="' + Y(up) + '" width="' + (xo * S).toFixed(1) + '" height="' + (half * 2 * S).toFixed(1) + '"/>' +
      '<line class="topo-plane" x1="' + L + '" x2="' + X(xo) + '" y1="' + Y(up) + '" y2="' + Y(up) + '"/><line class="topo-plane" x1="' + L + '" x2="' + X(xo) + '" y1="' + Y(lo) + '" y2="' + Y(lo) + '"/>' +
      '<line class="topo-measure" x1="40" x2="40" y1="' + Y(up) + '" y2="' + Y(lo) + '"/><line class="topo-measure" x1="34" x2="46" y1="' + Y(up) + '" y2="' + Y(up) + '"/><line class="topo-measure" x1="34" x2="46" y1="' + Y(lo) + '" y2="' + Y(lo) + '"/>' +
      '<text class="topo-lbl" x="32" y="' + ((+Y(up) + +Y(lo)) / 2 + 4).toFixed(1) + '" text-anchor="end">' + (half * 2 / 10).toFixed(1) + '</text><text class="topo-lbl" x="32" y="' + ((+Y(up) + +Y(lo)) / 2 + 16).toFixed(1) + '" text-anchor="end">nm</text>';
    if (ov) pts.forEach(function (q, i) { var v = rows[i] ? parseFloat(rows[i][ov]) || 0 : 0; if (q && v > 0.02) h += '<circle class="topo-ov" cx="' + X(q[0]) + '" cy="' + Y(q[1]) + '" r="' + (1.5 + Math.sqrt(v) * 9).toFixed(1) + '"/>'; });
    shapes.forEach(function (sh) {
      var a = Math.min.apply(null, sh.res), b = Math.max.apply(null, sh.res), on = sel && sh.res.some(function (i) { return i >= sel[0] && i <= sel[1]; });
      var k = sh.res.length < (TOPO_MIN[sh.cls] || 0) ? 'coil' : sh.cls === 'ssAlpha' ? 'helix' : sh.cls === 'ssBeta' ? 'strand' : 'coil';
      h += '<path class="topo-el topo-' + k + (on ? ' on' : '') + '" d="' + line(sh.P) + '"' + (k === 'strand' ? ' marker-end="url(#topo-arrow)"' : '') + (k !== 'coil' ? ' data-res="' + a + '-' + b + '" tabindex="0" role="button" aria-label="Select residues ' + esc((rows[a] || {}).resSeq || '') + ' to ' + esc((rows[b] || {}).resSeq || '') + '"' : '') + '><title>' + (k === 'coil' ? 'Loop' : k === 'helix' ? 'Helix' : 'Strand') + ' ' + esc((rows[a] || {}).resSeq || '') + '–' + esc((rows[b] || {}).resSeq || '') + '</title></path>';
    });
    if (sel) pts.forEach(function (q, i) { if (q && i >= sel[0] && i <= sel[1]) h += '<circle class="topo-sel" cx="' + X(q[0]) + '" cy="' + Y(q[1]) + '" r="3"/>'; });
    return h + '</svg>';
  }

  function seqSvgs(rows, tracks, sel) {
    var N = 80, CW = 11, LW = 112, out = [];
    for (var b0 = 0; b0 < rows.length; b0 += N) {
      var blk = rows.slice(b0, b0 + N), y = 0, h = '';
      h += blk.map(function (r, j) { var i = b0 + j; return (+r.resSeq % 10 === 0 ? '<text class="seq-num" x="' + (LW + j * CW + CW / 2) + '" y="10" text-anchor="middle">' + esc(r.resSeq) + '</text>' : ''); }).join('');
      y = 14;
      h += '<text class="seq-lab" x="' + (LW - 8) + '" y="' + (y + 12) + '" text-anchor="end">Sequence</text>' + blk.map(function (r, j) {
        var d = r.DSSP, k = isHelix(d) ? 'helix' : isStrand(d) ? 'strand' : 'coil';
        return '<rect class="seq-ss seq-' + k + '" x="' + (LW + j * CW) + '" y="' + y + '" width="' + (CW - 1) + '" height="16" rx="2"/><text class="seq-aa seq-aa-' + k + '" x="' + (LW + j * CW + CW / 2 - 0.5) + '" y="' + (y + 12) + '" text-anchor="middle">' + (AA1[r.resName] || 'X') + '</text>';
      }).join('');
      y += 22;
      tracks.forEach(function (t) {
        h += '<text class="seq-lab" x="' + (LW - 8) + '" y="' + (y + 8) + '" text-anchor="end">' + t[0] + '</text>' + blk.map(function (r, j) {
          var v = trackVal(r, t[1]);
          return '<rect class="seq-bg" x="' + (LW + j * CW) + '" y="' + y + '" width="' + (CW - 1) + '" height="9"/>' + (v > 0.005 ? '<rect class="seq-v" x="' + (LW + j * CW) + '" y="' + y + '" width="' + (CW - 1) + '" height="9" fill-opacity="' + Math.sqrt(v).toFixed(2) + '"/>' : '');
        }).join('');
        y += 10;
      });
      if (sel) blk.forEach(function (r, j) { var i = b0 + j; if (i >= sel[0] && i <= sel[1]) h += '<rect class="seq-selbox" x="' + (LW + j * CW - 0.5) + '" y="13" width="' + CW + '" height="' + (y - 12) + '"/>'; });
      h += blk.map(function (r, j) { return '<rect class="seq-hit" data-i="' + (b0 + j) + '" x="' + (LW + j * CW) + '" y="0" width="' + CW + '" height="' + y + '"><title>' + esc(r.resName + ' ' + r.resSeq) + '</title></rect>'; }).join('');
      var W = LW + blk.length * CW + 8;
      out.push('<div class="seq-block"><p class="small muted">Residues ' + esc(blk[0].resSeq) + '–' + esc(blk[blk.length - 1].resSeq) + '</p><div class="scroll"><svg class="seqv" viewBox="0 0 ' + W + ' ' + (y + 2) + '" width="' + W + '" height="' + (y + 2) + '" role="img" aria-label="Contacts along residues ' + esc(blk[0].resSeq) + ' to ' + esc(blk[blk.length - 1].resSeq) + '">' + h + '</svg></div></div>');
    }
    return out.join('');
  }

  function chainView(pdb, base, chain, th, st) {
    var host = document.getElementById('chain-view'); if (!host) return;
    var cv = st.cv && st.cv.chain === chain ? st.cv : (st.cv = { chain: chain, ov: 0, sel: null, anchor: null });
    chainData(base).then(function (d) {
      host = document.getElementById('chain-view'); if (!host || route.current.indexOf('ref/PDB/' + pdb) !== 0) return;
      var rows = d.csv ? d.csv.rows.filter(function (r) { return r.chainID === chain && (r.chainInstance === '1' || r.chainInstance === undefined); }) : [];
      var ct = d.topo && (d.topo.topology || []).filter(function (t) { return t.chainID === chain && +t.chainInstance === 1; })[0];
      /* the pipeline's file numbers residues along the whole table, so later chains are shifted back to their own rows */
      if (ct && !ct.shifted) { var off = d.csv && rows.length ? d.csv.rows.indexOf(rows[0]) : 0; ct.shifted = true; if (off > 0) (ct.segments || []).forEach(function (sg) { (sg.elements || []).forEach(function (el) { el.resIdxs = (el.resIdxs || []).map(function (i) { return i - off; }); }); }); }
      if (!ct && rows.length) { try { ct = topoBuild(rows, th && th.bulk_mid != null ? +th.bulk_mid : 0); if (!ct.segments.length) ct = null; } catch (e) { ct = null; } }
      if (!ct && !rows.length) { host.innerHTML = '<p class="small muted">The analysis files for this chain could not be loaded from file storage.</p>'; return; }
      var tracks = d.csv ? seqTracks(d.csv.head) : [];
      function selText() {
        if (!cv.sel) return 'Click a helix or strand, or a residue in the sequence, to select it.';
        var a = rows[cv.sel[0]] || {}, b = rows[cv.sel[1]] || {};
        return 'Selected ' + (cv.sel[0] === cv.sel[1] ? esc(a.resName + ' ' + a.resSeq) : 'residues ' + esc(a.resSeq) + '–' + esc(b.resSeq)) + (MOL.viewer && MOL.pdb === pdb ? ', also highlighted in the 3D view.' : '.') + ' <button type="button" class="linkbtn" id="cv-clear">Clear</button>';
      }
      function paint() {
        host.innerHTML =
          (ct ? '<h3>Topology of chain ' + esc(chain) + '</h3><p class="small muted">Helices and strands of at least five residues, arranged relative to the bilayer (shaded, with its local thickness). Choose an overlay to show contacts along the backbone: the larger the circle, the more of the simulation a residue spends in contact.' + (ct.computed ? ' This diagram was worked out in your browser from the per-residue analysis.' : '') + '</p>' +
            '<div class="seg" role="group" aria-label="Overlay">' + OVERLAYS.map(function (o, i) { return '<button type="button" data-ov="' + i + '" aria-pressed="' + (i === cv.ov) + '">' + o[0] + '</button>'; }).join('') + '</div>' +
            '<div class="topo-box scroll">' + topoSvg(ct, rows, th, OVERLAYS[cv.ov][1], cv.sel) + '</div>' : '') +
          '<p class="small" id="cv-sel">' + selText() + '</p>' +
          (rows.length ? '<h3>Sequence view</h3><p class="small muted">Contacts along the sequence, as the share of the simulation each residue spends within 6 Å of each group: pale is rarely, strong is always. Helices are blue, strands green. Click a residue to select it; shift-click to extend the selection.</p><div class="ct-key" aria-hidden="true"><span>0%</span><i class="seq-key"></i><span>100%</span></div>' + seqSvgs(rows, tracks, cv.sel) : '');
        wire();
      }
      function setSel(a, b) {
        cv.sel = a == null ? null : [Math.min(a, b), Math.max(a, b)];
        var ra = cv.sel && rows[cv.sel[0]], rb = cv.sel && rows[cv.sel[1]];
        MOL.sel = cv.sel && ra && rb ? { chain: chain, a: +ra.resSeq, b: +rb.resSeq } : null;
        if (MOL.viewer && MOL.pdb === pdb) molPaint(base);
        var y = window.scrollY; paint(); window.scrollTo(0, y);
      }
      function wire() {
        Array.prototype.forEach.call(host.querySelectorAll('[data-ov]'), function (b) { b.addEventListener('click', function () { cv.ov = +b.getAttribute('data-ov'); var y = window.scrollY; paint(); window.scrollTo(0, y); }); });
        Array.prototype.forEach.call(host.querySelectorAll('[data-res]'), function (e) {
          function go() { var r = e.getAttribute('data-res').split('-'); cv.anchor = +r[0]; setSel(+r[0], +r[1]); }
          e.addEventListener('click', go); e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
        });
        Array.prototype.forEach.call(host.querySelectorAll('.seq-hit'), function (e) { e.addEventListener('click', function (ev) {
          var i = +e.getAttribute('data-i');
          if (ev.shiftKey && cv.anchor != null) setSel(cv.anchor, i); else { cv.anchor = i; setSel(i, i); }
        }); });
        var c = document.getElementById('cv-clear'); if (c) c.addEventListener('click', function () { cv.anchor = null; setSel(null); });
      }
      paint();
    });
  }

  /* ---------- statistics ---------- */
  var GROUP_NAMES = ['Negative', 'Positive', 'Hydrophilic polar', 'Low weight', 'Aromatic', 'Mildly hydrophobic', 'Low-weight hydrophobic', 'Hydrophobic'];
  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* diverging scale on a square-root ramp, so small differences from glycine still show; strong cells get white text */
  function heat(v) {
    if (!v) return '';
    var t = Math.sqrt(Math.min(1, Math.abs(v) / 100)), pc = Math.round(t * 100);
    return 'background:color-mix(in oklab, var(--heat-' + (v > 0 ? 'pos' : 'neg') + ') ' + pc + '%, var(--surface))' + (t > 0.62 ? ';color:var(--heat-on)' : '');
  }
  function ctable(id, t) {
    var CW = 46, RH = 30, LW = 104, n = t.cols.length;
    var h = '<div class="scroll"><div class="ctable" id="' + id + '" style="width:' + (LW + n * CW) + 'px;height:' + ((t.rows.length + 1) * RH) + 'px">' +
      t.rows.map(function (r, ri) { return '<button type="button" class="ct-label" data-row="' + ri + '" aria-pressed="false" style="top:' + ((ri + 1) * RH) + 'px;width:' + LW + 'px">' + esc(r.label) + '<span class="ct-dir" aria-hidden="true"></span></button>'; }).join('') +
      t.cols.map(function (aa, ci) {
        return '<div class="ct-col" data-aa="' + aa + '" style="left:' + LW + 'px;width:' + CW + 'px;transform:translateX(' + ci * CW + 'px)"><div class="ct-h">' + aa + '</div>' +
          t.rows.map(function (r) { var v = r.v[ci]; return '<div class="ct-c" style="' + heat(v) + '">' + (v < 0 ? '−' + (-v) : v) + '</div>'; }).join('') + '</div>';
      }).join('') + '</div></div>';
    return h;
  }
  function wireTable(id, t, initial) {
    var CW = 46, el = document.getElementById(id), state = { row: initial[0], dir: initial[1] };
    function order() {
      var idx = t.cols.map(function (c, i) { return i; });
      if (state.row !== null) idx.sort(function (a, b) { return state.dir * (t.rows[state.row].v[a] - t.rows[state.row].v[b]) || a - b; });
      idx.forEach(function (ci, pos) { el.querySelector('[data-aa="' + t.cols[ci] + '"]').style.transform = 'translateX(' + pos * CW + 'px)'; });
      Array.prototype.forEach.call(el.querySelectorAll('.ct-label'), function (b) {
        var on = +b.getAttribute('data-row') === state.row; b.setAttribute('aria-pressed', String(on));
        b.querySelector('.ct-dir').textContent = on ? (state.dir > 0 ? ' ↑' : ' ↓') : '';
      });
    }
    Array.prototype.forEach.call(el.querySelectorAll('.ct-label'), function (b) {
      b.addEventListener('click', function () { var r = +b.getAttribute('data-row'); if (state.row === r) state.dir = -state.dir; else { state.row = r; state.dir = 1; } order(); });
    });
    order();
  }
  function highlight(aa) {
    each('[data-aa]', function (e) { e.classList.toggle('hl', !!aa && e.getAttribute('data-aa') === aa); e.classList.toggle('dim', !!aa && e.getAttribute('data-aa') !== aa && e.hasAttribute('data-line')); });
  }
  function growth() {
    var GROUPS = [['all', 'All structures'], ['xray', 'X-ray'], ['em', 'Cryo-EM'], ['nmr', 'NMR'], ['other', 'Other']];
    var y0 = 9999, y1 = 0, per = {};
    GROUPS.forEach(function (g) { per[g[0]] = {}; });
    DB.pdb.forEach(function (r) {
      if (!r[5]) return; var y = +String(r[5]).slice(0, 4); if (!y) return; y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      var m = String(r[3] || ''), k = /X-RAY/.test(m) ? 'xray' : /ELECTRON MICROSCOPY/.test(m) ? 'em' : /NMR/.test(m) ? 'nmr' : 'other';
      per.all[y] = (per.all[y] || 0) + 1; per[k][y] = (per[k][y] || 0) + 1;
    });
    var years = []; for (var y = y0; y <= y1; y++) years.push(y);
    var data = { per: {}, cum: {} };
    GROUPS.forEach(function (g) { var c = 0; data.per[g[0]] = years.map(function (y) { return per[g[0]][y] || 0; }); data.cum[g[0]] = data.per[g[0]].map(function (v) { c += v; return c; }); });
    return { groups: GROUPS, years: years, data: data };
  }
  function growthChart(G, meta) {
    meta = meta || { noun: 'Structures', note: 'Structures in MemProtMD by the year they were released in the PDB.' };
    var W = 860, H = 300, L = 52, R = 16, T = 14, B = 30, mode = 'cum', on = { all: 1, xray: 1, em: 1, nmr: 1, other: 1 }, anim = null;
    var n = G.years.length;
    function X(i) { return L + i / (n - 1) * (W - L - R); }
    function ymax(m) { var mx = 0; G.groups.forEach(function (g) { if (on[g[0]]) G.data[m][g[0]].forEach(function (v) { mx = Math.max(mx, v); }); }); return nice(mx || 1); }
    function nice(v) { var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
    function Y(v, ym) { return T + (1 - v / ym) * (H - T - B); }
    function d(vals, ym) { return vals.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v, ym).toFixed(1); }).join(''); }
    function axes(ym) {
      var h = '';
      for (var k = 0; k <= 4; k++) { var v = ym * k / 4, yy = Y(v, ym).toFixed(1); h += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text class="ytick" x="' + (L - 8) + '" y="' + (+yy + 4) + '" text-anchor="end">' + num(v) + '</text>'; }
      return h;
    }
    var xt = ''; G.years.forEach(function (y, i) { if (y % 5 === 0) xt += '<text class="xtick" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + y + '</text><line class="tickm" x1="' + X(i) + '" x2="' + X(i) + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '"/>'; });
    var ym = ymax(mode);
    var html = '<div class="growth"><div class="head-row" style="margin:0"><div class="chips" role="group" aria-label="Series">' + G.groups.map(function (g) { return '<button type="button" class="chip key g-' + g[0] + '" data-series="' + g[0] + '" aria-pressed="true"><i></i>' + g[1] + '</button>'; }).join('') + '</div>' +
      '<div class="seg" role="group" aria-label="Scale"><button type="button" data-gmode="cum" aria-pressed="true">Cumulative</button><button type="button" data-gmode="per" aria-pressed="false">Per year</button></div></div>' +
      '<div class="gwrap"><svg class="gsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(meta.noun) + ' in MemProtMD by year, ' + G.years[0] + ' to ' + G.years[n - 1] + '"><g class="gaxes">' + axes(ym) + '</g>' + xt +
      '<line class="baseline" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>' +
      G.groups.slice().reverse().map(function (g) { return '<path class="gline g-' + g[0] + '" data-series="' + g[0] + '" d="' + d(G.data[mode][g[0]], ym) + '"/>'; }).join('') +
      '<line class="guide" y1="' + T + '" y2="' + (H - B) + '" hidden/>' + G.groups.map(function (g) { return '<circle class="gdot g-' + g[0] + '" r="4" hidden/>'; }).join('') +
      '<rect class="hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/></svg><div class="gtip" hidden></div></div>' +
      '<p class="small muted">' + esc(meta.note) + ' ' + G.years[n - 1] + ' is part of a year.</p></div>';
    function wire(root) {
      var svg = root.querySelector('.gsvg'), tip = root.querySelector('.gtip'), guide = root.querySelector('.guide');
      function redraw(fromMode, fromYm, fromOn) {
        var toYm = ymax(mode), t0 = performance.now(), dur = REDUCE ? 0 : 650;
        root.querySelector('.gaxes').innerHTML = axes(toYm);
        cancelAnimationFrame(anim);
        (function step(now) {
          var k = dur ? Math.min(1, (now - t0) / dur) : 1, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2, yv = fromYm + (toYm - fromYm) * e;
          Array.prototype.forEach.call(root.querySelectorAll('.gline'), function (p) {
            var s = p.getAttribute('data-series'), a = G.data[fromMode][s], b = G.data[mode][s];
            p.setAttribute('d', d(a.map(function (v, i) { return v + (b[i] - v) * e; }), yv));
          });
          if (k < 1) anim = requestAnimationFrame(step);
        })(t0);
        Array.prototype.forEach.call(root.querySelectorAll('.gline'), function (p) { p.classList.toggle('off', !on[p.getAttribute('data-series')]); });
      }
      Array.prototype.forEach.call(root.querySelectorAll('[data-gmode]'), function (b) { b.addEventListener('click', function () {
        var to = b.getAttribute('data-gmode'); if (to === mode) return; var fm = mode, fy = ymax(fm); mode = to;
        Array.prototype.forEach.call(root.querySelectorAll('[data-gmode]'), function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-gmode') === to)); });
        redraw(fm, fy); hide();
      }); });
      Array.prototype.forEach.call(root.querySelectorAll('button[data-series]'), function (b) { b.addEventListener('click', function () {
        var sKey = b.getAttribute('data-series'), fy = ymax(mode); on[sKey] = on[sKey] ? 0 : 1; if (!Object.keys(on).some(function (k) { return on[k]; })) on[sKey] = 1;
        b.setAttribute('aria-pressed', String(!!on[sKey])); redraw(mode, fy); hide();
      }); });
      function hide() { guide.setAttribute('hidden', ''); tip.hidden = true; Array.prototype.forEach.call(root.querySelectorAll('.gdot'), function (c) { c.setAttribute('hidden', ''); }); }
      function move(ev) {
        var r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W, i = Math.max(0, Math.min(n - 1, Math.round((sx - L) / (W - L - R) * (n - 1)))), ymv = ymax(mode);
        guide.removeAttribute('hidden'); guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i));
        G.groups.forEach(function (g, gi) { var c = root.querySelectorAll('.gdot')[gi]; if (on[g[0]]) { c.removeAttribute('hidden'); c.setAttribute('cx', X(i)); c.setAttribute('cy', Y(G.data[mode][g[0]][i], ymv)); } else c.setAttribute('hidden', ''); });
        tip.innerHTML = '<b>' + G.years[i] + '</b>' + G.groups.filter(function (g) { return on[g[0]]; }).map(function (g) { return '<span class="g-' + g[0] + '"><i></i>' + g[1] + '<em>' + num(G.data[mode][g[0]][i]) + '</em></span>'; }).join('');
        tip.hidden = false;
        var px = X(i) / W * r.width; tip.style.left = Math.min(Math.max(px + 14, 0), r.width - tip.offsetWidth - 4) + 'px';
        if (px + 14 + tip.offsetWidth > r.width) tip.style.left = Math.max(0, px - tip.offsetWidth - 14) + 'px';
      }
      svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', hide);
      if (!REDUCE) Array.prototype.forEach.call(root.querySelectorAll('.gline'), function (p) { var len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.getBoundingClientRect(); p.style.transition = 'stroke-dashoffset 1.2s ease-out'; p.style.strokeDashoffset = 0; setTimeout(function () { p.style.transition = ''; p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }, 1300); });
    }
    return { html: html, wire: wire };
  }
  var COUNTS = [['structures', 'Structures'], ['uniprot', 'Proteins'], ['pfam', 'Pfam families']];
  var COUNT_NOTE = {
    structures: 'Structures in MemProtMD by the year they were released in the PDB.',
    uniprot: 'Distinct proteins (UniProt accessions of the chains in the membrane), each counted in the year its first structure was released and under that structure\'s method.',
    pfam: 'Distinct Pfam families with a structure in MemProtMD, each counted in the year its first structure was released and under that structure\'s method. Pfam assignments come from MemProtMD and the RCSB PDB.'
  };
  function growthOf(key, gj) {
    if (key === 'structures' || !gj || !gj[key]) return growth();
    var base = growth(), years = [], data = { per: {}, cum: {} };
    for (var y = gj.years[0]; y <= gj.years[1]; y++) years.push(y);
    base.groups.forEach(function (g) { var c = 0, per = (gj[key].per[g[0]] || []).slice(); data.per[g[0]] = per; data.cum[g[0]] = per.map(function (v) { c += v; return c; }); });
    return { groups: base.groups.map(function (g) { return g[0] === 'all' ? ['all', key === 'uniprot' ? 'All proteins' : 'All Pfam families'] : g; }), years: years, data: data };
  }
  function pageStats() {
    show('stats', '<p class="muted">Loading…</p>', 'Statistics');
    Promise.all([getJSON('data/stats.json'), getJSON('data/growth.json').catch(function () { return null; })]).then(function (res) {
      var d = res[0], gj = res[1];
      if (route.current !== 'stats') return;
      var GC = growthChart(growth()), counts = gj ? COUNTS : COUNTS.slice(0, 1);
      var W = 300, H = 170, L = 34, R = 8, T = 8, B = 26, x0 = d.bins[0][0], x1 = d.bins[d.bins.length - 1][1];
      var total = 0; d.groups.forEach(function (g) { Object.keys(g.counts).forEach(function (k) { total += g.counts[k]; }); });
      function series(mode) {
        var out = {};
        d.groups.forEach(function (g) { Object.keys(g.h).forEach(function (aa) { var f = mode === 'abs' ? g.counts[aa] / total * Object.keys(d.groups).length : 1; out[aa] = g.h[aa].map(function (v) { return v * f; }); }); });
        return out;
      }
      var modes = { norm: series('norm'), abs: series('abs') }, mode = 'norm';
      function ymax(m) { var mx = 0; Object.keys(modes[m]).forEach(function (k) { modes[m][k].forEach(function (v) { mx = Math.max(mx, v); }); }); return mx * 1.08; }
      function X(z) { return L + (z - x0) / (x1 - x0) * (W - L - R); }
      function path(vals, ym) {
        return vals.map(function (v, i) { var z = (d.bins[i][0] + d.bins[i][1]) / 2; return (i ? 'L' : 'M') + X(z).toFixed(1) + ',' + (T + (1 - v / ym) * (H - T - B)).toFixed(1); }).join('');
      }
      function axis(ym) {
        var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return f * ym / 1.08; });
        return ticks.map(function (v) { var y = (T + (1 - v / ym) * (H - T - B)).toFixed(1); return '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text class="ytick" x="' + (L - 5) + '" y="' + (+y + 3) + '" text-anchor="end">' + v.toFixed(3).replace(/^0/, '') + '</text>'; }).join('');
      }
      var cards = d.groups.map(function (g, gi) {
        var aas = Object.keys(g.h), ym = ymax(mode);
        return '<figure class="hcard"><figcaption>' + GROUP_NAMES[gi] + '</figcaption><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Depth distribution of ' + aas.join(', ') + '">' +
          '<rect class="band" x="' + X(-20) + '" y="' + T + '" width="' + (X(20) - X(-20)) + '" height="' + (H - T - B) + '"/>' +
          '<g class="yaxis">' + axis(ym) + '</g>' +
          '<line class="phos" x1="' + X(-20) + '" x2="' + X(-20) + '" y1="' + T + '" y2="' + (H - B) + '"/><line class="phos" x1="' + X(20) + '" x2="' + X(20) + '" y1="' + T + '" y2="' + (H - B) + '"/>' +
          [-40, -20, 0, 20, 40].map(function (z) { return '<text class="xtick" x="' + X(z) + '" y="' + (H - B + 13) + '" text-anchor="middle">' + (z < 0 ? '−' + (-z) : z) + '</text>'; }).join('') +
          '<text class="xtick" x="' + (W - R) + '" y="' + (H - 2) + '" text-anchor="end">Å from bilayer centre</text>' +
          aas.map(function (aa, k) { return '<path class="sline s' + (k + 1) + '" data-line="1" data-aa="' + aa + '" d="' + path(modes[mode][aa], ym) + '"><title>' + aa + '</title></path>'; }).join('') +
          '</svg><div class="hlegend">' + aas.map(function (aa, k) { return '<button type="button" class="key s' + (k + 1) + '" data-aa="' + aa + '"><i></i>' + aa + '</button>'; }).join('') + '</div></figure>';
      }).join('');
      show('stats', '<div class="stack-lg"><div class="pagehead"><h1>MemProtMD findings</h1><p class="muted" style="max-width:46rem">Ensemble analysis across every simulation in the database.</p></div>' +
        '<section class="panel stack"><div class="head-row" style="margin:0"><h2>Growth of the database</h2>' + (counts.length > 1 ? '<div class="seg" role="group" aria-label="What to count">' + counts.map(function (c, i) { return '<button type="button" data-count="' + c[0] + '" aria-pressed="' + (i === 0) + '">' + c[1] + '</button>'; }).join('') + '</div>' : '') + '</div>' +
        '<div class="figures"><div><b>' + num(DB.pdb.length) + '</b><span>structures</span></div>' + (gj ? '<div><b>' + num(gj.uniprot.total) + '</b><span>distinct proteins</span></div><div><b>' + num(gj.pfam.total) + '</b><span>Pfam families</span></div>' : '') + '</div>' +
        '<div id="growth-box">' + GC.html + '</div></section>' +
        '<section class="panel stack"><h2>Amino acid interactions</h2><p class="small muted" style="max-width:46rem">How often each amino acid touches solvent, lipid head groups and lipid tails, relative to glycine (0) and scaled so the amino acid with most contact in each row is 100. Red cells mean more contact than glycine, blue cells less. Select a row to sort the amino acids by it; select it again to reverse. Point at an amino acid in a table or chart to highlight it everywhere on the page.</p>' +
        '<div class="ct-key" aria-hidden="true"><span>Less contact than glycine</span><i></i><span>More</span></div>' +
        '<h3>Overview</h3>' + ctable('ct-over', d.overview) + '<h3>By lipid bead and solvent species</h3>' + ctable('ct-detail', d.detail) + '</section>' +
        '<section class="panel stack"><div class="head-row" style="margin:0"><h2>Where amino acids sit within membranes</h2>' + '<div class="seg" role="group" aria-label="Scale"><button type="button" data-mode="norm" aria-pressed="true">Normalised</button><button type="button" data-mode="abs" aria-pressed="false">Absolute</button></div></div>' +
        '<p class="small muted" style="max-width:46rem" id="h-note"></p><div class="hgrid">' + cards + '</div></section></div>', 'Statistics');
      GC.wire(app.querySelector('.growth'));
      each('[data-count]', function (b) { b.addEventListener('click', function () {
        var k = b.getAttribute('data-count'), box = document.getElementById('growth-box');
        each('[data-count]', function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        var C = growthChart(growthOf(k, gj), { noun: COUNTS.filter(function (c) { return c[0] === k; })[0][1], note: COUNT_NOTE[k] });
        box.innerHTML = C.html; C.wire(box.querySelector('.growth'));
      }); });
      wireTable('ct-over', d.overview, [2, 1]); wireTable('ct-detail', d.detail, [null, 1]);
      var note = { norm: 'Abundance of each amino acid at each depth, normalised so the area under each line is one. Dotted lines mark the phosphate groups of the lipids next to the protein; the shaded band is the membrane core.', abs: 'Abundance scaled by how common each amino acid is, so commoner residues have larger areas. Dotted lines mark the phosphate groups of the lipids next to the protein; the shaded band is the membrane core.' };
      document.getElementById('h-note').textContent = note.norm;
      var anim = null;
      each('[data-mode]', function (b) { b.addEventListener('click', function () {
        var to = b.getAttribute('data-mode'); if (to === mode) return;
        var from = mode, yf = ymax(from), yt = ymax(to), t0 = performance.now(), dur = REDUCE ? 0 : 700; mode = to;
        each('[data-mode]', function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-mode') === to)); });
        document.getElementById('h-note').textContent = note[to];
        each('.yaxis', function (g) { g.innerHTML = axis(yt); });
        cancelAnimationFrame(anim);
        (function step(now) {
          var k = dur ? Math.min(1, (now - t0) / dur) : 1, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          each('path.sline', function (p) { var aa = p.getAttribute('data-aa'), a = modes[from][aa], c = modes[to][aa];
            var ym = yf + (yt - yf) * e; p.setAttribute('d', path(a.map(function (v, i) { return v + (c[i] - v) * e; }), ym)); });
          if (k < 1) anim = requestAnimationFrame(step);
        })(t0);
      }); });
      each('[data-aa]', function (e) {
        e.addEventListener('mouseenter', function () { highlight(e.getAttribute('data-aa')); });
        e.addEventListener('mouseleave', function () { highlight(null); });
        e.addEventListener('focus', function () { highlight(e.getAttribute('data-aa')); });
        e.addEventListener('blur', function () { highlight(null); });
      });
    });
  }

  function notFound(what) { show(null, '<div class="stack"><h1>Not found</h1><p>There is no MemProtMD record for <b>' + esc(what) + '</b>.</p><p><a class="btn" href="' + href('home') + '">Back to home</a></p></div>', 'Not found'); }

  /* ---------- router ---------- */
  function route() {
    var h = location.hash.replace(/^#/, ''), p = h.charAt(0) === '/' ? h.slice(1) : dec(h), m, qi = p.indexOf('?');
    route.query = qi >= 0 ? p.slice(qi + 1) : '';
    p = (qi >= 0 ? p.slice(0, qi) : p).replace(/\/+$/, '');
    if (!p) p = window.MPM_ROUTE || 'home';
    route.current = p;
    var mp = p.match(/^ref\/PDB\/([0-9a-z]{4})/i);
    if (MOL.pdb && (!mp || mp[1].toLowerCase() !== MOL.pdb)) molReset();
    if (p === 'home') pageHome();
    else if (p === 'search/text') pageSearch();
    else if (p === 'stats') pageStats();
    else if (p === 'about' || p === 'api' || p === 'data') pageStatic(p, p, { about: 'About', api: 'API', data: 'Data files' }[p]);
    else if (p === 'status') pageStatus();
    else if ((m = p.match(/^ref\/PDB\/([0-9a-z]{4})(?:\/chain\/(\w+))?$/i))) pageEntry(m[1].toLowerCase(), m[2] || null);
    else if ((m = p.match(/^ref\/([A-Za-z]+)\/(.+)$/))) pageCollection(m[1], m[2]);
    else notFound(p);
    var key = p.replace(/\/chain\/.*/, '');
    if (route.last !== key) window.scrollTo(0, 0);
    route.last = key;
  }
  document.addEventListener('mousedown', function (e) { var qs = document.getElementById('qs'), pop = document.getElementById('qs-pop'); if (qs && pop && !qs.contains(e.target)) pop.hidden = true; });
  app.innerHTML = '<p style="padding:2rem">Loading MemProtMD…</p>';
  load().then(function () { window.addEventListener('hashchange', route); route(); })
    .catch(function () { app.innerHTML = '<p style="padding:2rem">Could not load the MemProtMD index. Reload the page to try again.</p>'; });
})();
