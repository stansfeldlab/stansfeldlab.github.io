/* MemProtMD static site (modernised draft). Data comes from static JSON; bulky files stay on file storage. */
(function () {
  'use strict';
  var CFG = window.MPM_CFG || {};
  var STORE = CFG.storage || 'https://memprotmd.bioch.ox.ac.uk/data/memprotmd/';
  var DB = null, byId = {}, colById = {}, kids = {}, memberOf = null, searchRecs = null, ALL = null, NOT = {}, NOG = {}, GROUPS = {};
  var app = document.getElementById('mpm-app');
  var DBNAMES = { mpm: 'MemProtMD groups', TCDB: 'TCDB', mpstruc: 'mpstruc', Pfam: 'Pfam', PDB: 'PDB' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ttl(s) { return esc(s).replace(/&lt;(\/?)(sub|sup|i|em|b)&gt;/g, '<$1$2>'); }
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
  function colThumb(db, acc) { return NOG[db + '|' + acc] ? null : 'thumbs/' + db + '/' + enc(acc) + '.jpg'; }
  function remote(path) { return CFG.remoteImages === false ? null : STORE + path; }
  function imgUrl(kind, a) {
    var p = a.split('/');
    if (kind === 'pdb100' || kind === 'pdbtile') return pdbThumb(a);
    if (kind === 'col100') return colThumb(p[0], p.slice(1).join('/'));
    if (kind === 'pdbhero') return remote('databases/PDB/thumbs/' + a + '.jpg') || pdbThumb(a);
    if (kind === 'colhero') return remote('databases/' + p[0] + '/thumbs/' + encodeURIComponent(p.slice(1).join('/')) + '.jpg');
    if (kind === 'sim') return remote('simulations/' + p[0] + '_default_dppc/images/' + p[1] + '.jpg');
    return null;
  }
  function fallback(kind, a) { return kind === 'pdbhero' ? pdbThumb(a) : null; }
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
      DB = d; (d.noThumb || []).forEach(function (k) { NOT[k] = 1; }); (d.noGroupThumb || []).forEach(function (k) { NOG[k] = 1; });
      d.pdb.forEach(function (r) { byId[r[0]] = r; });
      Object.keys(d.cols).forEach(function (db) {
        d.cols[db].forEach(function (c) { colById[db + '|' + c[0]] = { db: db, acc: c[0], title: c[1], n: c[2], parent: c[3] || null, sub: c[4] || '', mem: c[5] }; });
      });
      Object.keys(colById).forEach(function (id) { var p = colById[id].parent; if (p) (kids[p] = kids[p] || []).push(id); });
    });
  }
  function groupInfo(db) { if (!GROUPS[db]) GROUPS[db] = getJSON('data/groups/' + db + '.json').catch(function () { return {}; }); return GROUPS[db]; }
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
    DB.pdb.forEach(function (r) { searchRecs.push({ db: 'PDB', acc: r[0], title: r[1], size: 1, date: r[5], text: (r[0] + ' ' + plain(r[1]) + ' ' + (r[2] || '')).toLowerCase() }); });
    return searchRecs;
  }
  function search(q, n, dbs) {
    var pos = [], neg = [], m, re = /(-?)"([^"]+)"|(-?)(\S+)/g;
    while ((m = re.exec(q.toLowerCase()))) { var t = (m[2] || m[4]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); if (t) ((m[1] || m[3]) ? neg : pos).push(new RegExp('(^|[^a-z0-9])' + t + '($|[^a-z0-9])')); }
    var out = []; out.total = 0;
    if (!pos.length) return out;
    recs().forEach(function (r) {
      if (dbs && !dbs[r.db]) return;
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
      '<footer class="foot"><div class="wrap"><div><h3>Reuse this work</h3><p>Except where indicated otherwise, data on this site is part of the MemProtMD database, by Thomas D. Newport, Mark S.P. Sansom and Phillip J. Stansfeld, licensed under ' + extA('https://creativecommons.org/licenses/by/4.0/', 'Creative Commons Attribution 4.0') + '.</p></div>' +
      '<div><h3>Cite</h3><p>Newport TD, Sansom MSP, Stansfeld PJ. The MemProtMD database. <i>Nucleic Acids Research</i> (2019). ' + extA('https://doi.org/10.1093/nar/gky1047', 'doi:10.1093/nar/gky1047') + '</p></div>' +
      '<div><h3>Get in touch</h3><p>' + extA('https://stansfeldlab.github.io/', 'Stansfeld Research Group') + '<br>' + extA('https://twitter.com/memprotmd', '@memprotmd') + '</p><p style="margin-top:.5rem">Supported by BBSRC, Wellcome and EPSRC.</p></div></div></footer>';
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
    var ncol = Object.keys(colById).length;
    var roots = [['mpm', 'membrane_proteins', 'MemProtMD groups', 'Fold and family groups assigned from the simulations'], ['TCDB', 'TCDB', 'Transporter Classification Database', 'Channels, carriers and pumps by transport mechanism'], ['mpstruc', 'mpstruc', 'mpstruc', 'Membrane proteins of known structure, curated by family']];
    var h = '<div class="stack-lg"><section class="hero stack"><p class="eyebrow">MemProtMD</p><h1>Membrane proteins, simulated in their lipid bilayer</h1>' +
      '<p class="lede">Every intrinsic membrane protein structure in the Protein Data Bank, inserted into a lipid bilayer by coarse-grained self-assembly molecular dynamics. Browse the analysis, or download the files to run your own coarse-grained and atomistic simulations.</p>' +
      '<div class="find"><input class="field big" id="home-q" type="search" placeholder="Search by protein, family or PDB code, for example LeuT or 1a0s" aria-label="Search MemProtMD" autocomplete="off"><div class="rowlist" id="home-res" style="margin-top:.5rem"></div></div>' +
      '<div class="figures"><div><b>' + num(DB.pdb.length) + '</b><span>simulated structures</span></div><div><b>' + num(ncol) + '</b><span>families and groups</span></div><div><b>' + esc(fmtDate(latest[0][5])) + '</b><span>most recent structure</span></div></div></section>' +
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
    var q = document.getElementById('home-q');
    q.addEventListener('input', function () {
      var v = q.value.trim(), r = v ? search(v, 8) : [];
      document.getElementById('home-res').innerHTML = !v ? '' : r.length ? r.map(rowLink).join('') + (r.total > r.length ? '<p class="small" style="padding-top:.6rem"><a href="' + href('search/text') + '" id="home-all">All ' + num(r.total) + ' results</a></p>' : '') : '<p class="small muted">No matches. Search uses whole words, so <code>lipo</code> will not match lipoprotein.</p>';
      var a = document.getElementById('home-all'); if (a) a.addEventListener('click', function () { pending = v; });
    });
  }

  /* ---------- search ---------- */
  var SOURCES = [['PDB', 'PDB structures'], ['mpm', 'MemProtMD groups'], ['TCDB', 'TCDB'], ['mpstruc', 'mpstruc'], ['Pfam', 'Pfam']];
  function pageSearch() {
    var on = {}, shown = 30; SOURCES.forEach(function (s) { on[s[0]] = true; });
    show('search/text', '<div class="stack"><div class="pagehead"><h1>Search</h1><p class="muted" style="max-width:44rem">Search works on whole words. Put a phrase <code>"in quotes"</code> to match it exactly, or add a minus sign to leave words out, for example <code>lipoprotein -mlaa</code>.</p></div>' +
      '<input class="field big" id="ts-q" type="search" placeholder="Protein, family, process or PDB code" aria-label="Search term" autocomplete="off">' +
      '<div class="chips" role="group" aria-label="Sources">' + SOURCES.map(function (s) { return '<button class="chip" type="button" aria-pressed="true" data-db="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<p class="small muted" id="ts-msg">Try <a href="#" data-try="GPCR">GPCR</a>, <a href="#" data-try="porin">porin</a>, <a href="#" data-try="&quot;ion channel&quot; -sodium">"ion channel" -sodium</a> or <a href="#" data-try="1a0s">1a0s</a>.</p><div class="panel" id="ts-panel" hidden><div class="rowlist" id="ts-res"></div><p style="margin-top:1rem"><button class="btn ghost" id="ts-more" type="button" hidden>Show more</button></p></div></div>', 'Search');
    var q = document.getElementById('ts-q');
    function run() {
      var v = q.value.trim(), r = v ? search(v, shown, on) : [];
      document.getElementById('ts-panel').hidden = !r.length;
      document.getElementById('ts-res').innerHTML = r.map(rowLink).join('');
      document.getElementById('ts-more').hidden = r.total <= r.length;
      if (v) document.getElementById('ts-msg').textContent = r.length ? 'Showing ' + r.length + ' of ' + num(r.total) + ' results.' : 'No results. Try another spelling or a related term.';
    }
    q.addEventListener('input', function () { shown = 30; run(); });
    each('[data-db]', function (b) { b.addEventListener('click', function () { var d = b.getAttribute('data-db'); on[d] = !on[d]; b.setAttribute('aria-pressed', on[d]); run(); }); });
    each('[data-try]', function (a) { a.addEventListener('click', function (e) { e.preventDefault(); q.value = a.getAttribute('data-try'); run(); }); });
    document.getElementById('ts-more').addEventListener('click', function () { shown += 30; run(); });
    if (pending) { q.value = pending; pending = ''; run(); }
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
      show('status', '<div class="stack"><div class="pagehead"><h1>Pipeline status</h1><p class="muted" style="max-width:44rem">The MemProtMD pipeline handles around 40 new protein simulations per month. Proteins shown here are running through the pipeline, so may not be on the site yet.</p></div>' +
        '<input class="field" id="st-q" type="search" placeholder="Filter by PDB code" aria-label="Filter by PDB code" style="max-width:20rem"><h2>In progress</h2><div class="jobs">' + s.jobs.map(function (j) {
          var at = STAGES.indexOf(j.status);
          return '<div class="panel" data-job="' + esc(j.id) + '"><div class="job-top">' + imgTag('pdb100', j.id) + '<div><a class="mono" style="font-size:1.25rem;font-weight:500;text-decoration:none" href="' + refHref('PDB', j.id) + '">' + esc(j.id) + '</a><p class="small muted">' + esc(j.status.charAt(0).toUpperCase() + j.status.slice(1)) + ' since ' + esc(fmtDate(j.time)) + '</p></div></div>' +
            '<div class="steps">' + STAGES.map(function (st, i) { return '<span class="' + (i < at ? 'done' : i === at ? 'now' : '') + '">' + st.charAt(0).toUpperCase() + st.slice(1) + '</span>'; }).join('') + '</div></div>';
        }).join('') + '</div><p class="small muted" id="st-none" hidden>No pipeline job matches that code.</p><p class="small muted">Status file written ' + esc(fmtDate(s.written)) + '.</p></div>', 'Pipeline status');
      var f = document.getElementById('st-q');
      f.addEventListener('input', function () { var n = 0; each('[data-job]', function (c) { c.hidden = c.getAttribute('data-job').indexOf(f.value.trim().toLowerCase()) === -1; if (!c.hidden) n++; }); document.getElementById('st-none').hidden = n > 0; });
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
    var y = {}, m = {}, r = {};
    ids.forEach(function (id) {
      var e = byId[id]; if (!e) return;
      if (e[5]) { var yr = String(e[5]).slice(0, 4); y[yr] = (y[yr] || 0) + 1; }
      if (e[3]) m[e[3]] = (m[e[3]] || 0) + 1;
      if (e[4]) { var b = Math.min(12, Math.floor(e[4] * 2) / 2).toFixed(1); r[b] = (r[b] || 0) + 1; }
    });
    return { year: y, method: m, res: r };
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
        (mem.length ? '<section class="panel"><h2>Structures in this group</h2><div class="scroll"><table class="tbl"><thead><tr>' + th('id', 'PDB') + '<th>Title</th>' + th('date', 'Published', 'opt') + '<th class="opt">Method</th>' + th('res', 'Å', 'num') + '</tr></thead><tbody>' +
          list.slice(0, st.n).map(function (m) { var e = byId[m]; return '<tr><td class="id"><a href="' + refHref('PDB', m) + '">' + m + '</a></td><td>' + ttl(pdbTitle(e[1], m)) + '</td><td class="nw opt">' + esc(e[5] || '') + '</td><td class="opt small muted method">' + esc(sentence(e[3] || '')) + '</td><td class="num">' + (e[4] ? Number(e[4]).toFixed(1) : '') + '</td></tr>'; }).join('') +
          '</tbody></table></div>' + (mem.length > st.n ? '<p style="margin-top:1rem"><button class="btn ghost" type="button" data-act="more">Show 25 more of ' + num(mem.length) + '</button></p>' : '') + '</section>' : '') +
        '</div><aside class="stack">' + (hero ? '<div class="well"><img class="heroimg" src="' + hero + '" data-fb="hide" alt="Example structures from this group in their bilayers" onerror="mpmFb(this)"></div>' : '') +
        '<section class="panel stack"><h2>How this group compares</h2><div class="legend"><span><i class="s"></i>This group</span><span><i></i>All entries</span></div><div class="hists">' +
        hist('Publication year', ALL.year, mine.year) + hist('Experimental method', ALL.method, mine.method) + hist('Resolution (Å)', ALL.res, mine.res) +
        (db === 'mpm' && DB.thick[acc] ? hist('Membrane thickness (Å)', DB.thick.membrane_proteins, DB.thick[acc]) : '') + '</div><p class="small muted">Each set is normalised separately.</p></section></aside></div></div>';
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
  function uniprot(r) {
    var seen = {}, out = [];
    (r.entities || []).forEach(function (en) { (en.refs || []).forEach(function (x) { if (x.db === 'UniProt' && !seen[x.accession]) { seen[x.accession] = 1; out.push(extA('https://www.uniprot.org/uniprotkb/' + x.accession, esc(x.accession))); } }); });
    return out.join(', ');
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
  function pageEntry(pdb, chainSel) {
    var e = byId[pdb];
    if (!e) return notFound('PDB ' + pdb);
    var sim = pdb + '_default_dppc', base = STORE + 'simulations/' + sim + '/';
    var st = { rec: null, tried: false, v: [1, 0], contact: 0, rep: 0, violins: null, topo: null };
    function view(title, opts, selIdx, key, note, extra) {
      return '<div class="view"><div class="head-row" style="margin:0"><h3>' + title + '</h3></div><div class="well">' + opts.map(function (o, i) { var u = imgUrl('sim', pdb + '/' + o[1]); return '<img src="' + (u || PH) + '" alt="' + esc(title + ': ' + o[0]) + '"' + (i === selIdx ? '' : ' hidden') + ' loading="lazy" onerror="mpmPh(this)">'; }).join('') + '</div>' +
        '<div class="seg" role="group" aria-label="' + esc(title) + ' view">' + opts.map(function (o, i) { return '<button type="button" data-' + key + '="' + i + '" aria-pressed="' + (i === selIdx) + '">' + o[0] + '</button>'; }).join('') + '</div>' + (extra || '') + '<p>' + note + '</p></div>';
    }
    function render() {
      var r = (st.rec && st.rec.ref) || {}, s = (st.rec && st.rec.sim) || {}, cit = r.primary_citation || {}, sv = s.sim_validate || {};
      var hasImgs = CFG.remoteImages !== false;
      var byDb = {}; collectionsOf(pdb).forEach(function (g) { var c = colById[g]; (byDb[c.db] = byDb[c.db] || []).push(c); });
      var groups = ['mpm', 'TCDB', 'mpstruc', 'Pfam'].map(function (d) {
        var l = (byDb[d] || []).sort(function (a, b) { return b.n - a.n; }); if (!l.length) return '';
        if (d === 'TCDB' || d === 'mpstruc') l = l.slice(-2);
        return '<span class="eyebrow">' + esc(DBNAMES[d]) + '</span><div class="chips">' + l.map(function (c) { return '<a class="chip" href="' + refHref(c.db, c.acc) + '"><span>' + ttl(c.title) + '</span><b>' + num(c.n) + '</b></a>'; }).join('') + '</div>';
      }).join('');
      var ch = s.chains || [], selc = ch.filter(function (c) { return c.chainID === chainSel; })[0];
      var contactImgs = []; CONTACTS.forEach(function (cn) { REPS.forEach(function (rp) { contactImgs.push([cn[0] + ', ' + rp[0].toLowerCase(), 'front-contacts-' + cn[1] + '-' + rp[1]]); }); });
      var h = '<div class="stack-lg"><div class="cols entry"><div class="well"><img class="heroimg" src="' + (imgUrl('pdbhero', pdb) || PH) + '"' + fbAttr('pdbhero', pdb) + ' alt="' + esc(pdb.toUpperCase()) + ' in its simulated bilayer" onerror="mpmFb(this)"></div>' +
        '<div class="stack"><div class="pagehead">' + crumbs([['Home', href('home')], ['Structures', refHref('mpm', 'membrane_proteins')], [pdb.toUpperCase(), null]]) +
        '<h1>' + ttl(pdbTitle(r.title || e[1], pdb)) + '</h1><div class="idline"><span class="tag">PDB ' + pdb + '</span>' + ((r.subtitle || e[2]) ? '<span>' + esc(sentence(r.subtitle || e[2])) + '</span>' : '') + '</div></div>' +
        '<dl class="facts">' + [['Published', fmtDate(e[5])], ['Method', esc(sentence(e[3] || ''))], ['Resolution', e[4] ? Number(e[4]).toFixed(2).replace(/0$/, '') + ' Å' : ''], ['Organism', r.organism && r.organism.scientific_name ? '<i>' + esc(r.organism.scientific_name) + '</i>' : ''],
          ['UniProt', uniprot(r)], ['Ligands', esc((r.ligands || []).map(function (l) { return sentence(l.description); }).join(', '))], ['Keywords', esc((r.keywords || []).join(', '))]].filter(function (p) { return p[1]; }).map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>' +
        (cit.title ? '<p class="cite">' + esc(cit.title) + ' <span class="muted">' + esc((r.primary_authors || []).slice(0, 4).join(', ') + ((r.primary_authors || []).length > 4 ? ' et al.' : '')) + '. ' + esc([cit.journal, cit.year].filter(Boolean).join(' ')) + '.</span> ' + (cit.DOI ? extA('https://doi.org/' + cit.DOI, 'doi:' + esc(cit.DOI)) : '') + '</p>' : '') +
        '<div class="btns">' + extA('https://molstar.org/viewer/?structure-url=' + encodeURIComponent(base + 'files/structures/at.pdb') + '&structure-url-format=pdb', 'Open in Mol* ↗', 'btn') + extA(base + 'files/structures/at.pdb', 'Atomistic PDB ↓', 'btn ghost') + extA('https://www.rcsb.org/structure/' + pdb, 'RCSB ↗', 'btn ghost') + extA('https://www.ebi.ac.uk/pdbe/entry/pdb/' + pdb, 'PDBe ↗', 'btn ghost') + extA('https://pdbj.org/mine/summary/' + pdb, 'PDBj ↗', 'btn ghost') + '</div></div></div>' +
        (groups ? '<section class="panel"><h2>Member of</h2><div class="groups">' + groups + '</div></section>' : '') +
        '<section class="stack"><div class="head-row" style="margin:0"><h2>Simulation</h2><span class="mono muted">' + sim + '</span></div>' +
        (s.thinning ? '<div class="panel stack"><h3>Bilayer thickness</h3>' + gauge(s.thinning) + (sv.n_lipid_molecules ? '<p class="small muted">' + num(sv.n_lipid_molecules) + ' ' + esc(Object.keys(s.composition || { lipid: 1 }).join('/')) + ' lipids around ' + num(sv.n_protein_residues) + ' protein residues.</p>' : '') + '</div>' : '') +
        (hasImgs ? '<div class="panel"><div class="views">' + view(VIEWS[0][0], VIEWS[0][1], st.v[0], 'v0', VIEWS[0][3]) + view(VIEWS[1][0], VIEWS[1][1], st.v[1], 'v1', VIEWS[1][3]) +
          view('Lipid contacts', contactImgs, st.contact * 2 + st.rep, 'none', 'Average occupancy of the chosen group within 6 Å of the protein over the final 800 ns.', '').replace(/<div class="seg"[\s\S]*?<\/div>/, '<div class="btns"><div class="seg" role="group" aria-label="Contact group">' + CONTACTS.map(function (c, i) { return '<button type="button" data-contact="' + i + '" aria-pressed="' + (st.contact === i) + '">' + c[0] + '</button>'; }).join('') + '</div><div class="seg" role="group" aria-label="Representation">' + REPS.map(function (c, i) { return '<button type="button" data-rep="' + i + '" aria-pressed="' + (st.rep === i) + '">' + c[0] + '</button>'; }).join('') + '</div></div>') + '</div></div>'
          : '<p class="small muted">Rendered images load from file storage, which this preview cannot reach.</p>') + '</section>' +
        '<section class="panel stack"><h2>Polypeptide chains</h2>' + (!st.tried ? '<p class="muted">Loading…</p>' : !ch.length ? '<p class="muted">No chain analysis is recorded for this entry.</p>' :
          '<div class="chainpick">' + ch.map(function (c) {
            var tm = c.tm_alpha ? c.tm_alpha + ' TM helices' : c.tm_beta ? c.tm_beta + ' TM strands' : c.type;
            return '<a href="' + href('ref/PDB/' + pdb + '/chain/' + c.chainID) + '"' + (c.chainID === chainSel ? ' aria-current="true"' : '') + '>' + (st.rec && st.rec.prof && st.rec.prof.c[c.chainID] ? '<span class="chainsvg">' + violin(st.rec.prof, c.chainID, s.thinning) + '</span>' : '') + '<span>Chain ' + esc(c.chainID) + '<small>' + esc(tm) + '</small></span></a>';
          }).join('') + '</div>' + (st.rec && st.rec.prof ? '<p class="small muted">Each icon shows where the chain\'s residues sit along the bilayer normal: all residues in white, helices in blue, strands in green. The shaded band is the bulk bilayer.</p>' : '') +
          (selc ? '<dl class="facts"><dt>Placement</dt><dd>' + esc(sentence(selc.type.toUpperCase())) + '</dd><dt>Membrane-spanning helices</dt><dd>' + selc.tm_alpha + '</dd><dt>Membrane-spanning strands</dt><dd>' + selc.tm_beta + '</dd><dt>Lipid-facing elements</dt><dd>' + (selc.tm_alpha_lipid + selc.tm_beta_lipid) + '</dd></dl>' +
            (st.topo && st.topo.chain === chainSel ? '<h3>Topology of chain ' + esc(chainSel) + '</h3><p class="small muted">Helices and strands of at least five residues, arranged relative to the bilayer.</p><div class="well topology scroll">' + st.topo.svg + '</div>' : '') : '<p class="small muted">Choose a chain for its membrane placement.</p>')) + '</section>' +
        '<section class="panel stack"><h2>Downloads</h2><p class="small muted">Files are served from file storage. Licensed under Creative Commons Attribution 4.0.</p><div class="files">' + FILES.map(function (g) {
          return '<div><h3>' + g[0] + '</h3><ul>' + g[1].map(function (f) { return '<li>' + extA(base + f[1], sim + '-' + f[0]) + '<span>' + f[2] + '</span></li>'; }).join('') + '</ul></div>';
        }).join('') + '</div></section></div>';
      show(null, h, 'PDB ' + pdb);
      function seg(attr, fn) { each('[data-' + attr + ']', function (b) { b.addEventListener('click', function () { fn(+b.getAttribute('data-' + attr)); keep(); }); }); }
      seg('v0', function (i) { st.v[0] = i; }); seg('v1', function (i) { st.v[1] = i; }); seg('contact', function (i) { st.contact = i; }); seg('rep', function (i) { st.rep = i; });
    }
    function keep() { var y = window.scrollY; render(); window.scrollTo(0, y); }
    render();
    var jobs = [];
    jobs.push(getJSON('data/entries/' + pdb + '.json').then(function (j) { st.rec = j; }).catch(function () {}));
    if (DB.snap[pdb]) jobs.push(getText('pages/chains_' + pdb + '.html').then(function (t) {
      var d = document.createElement('div'); d.innerHTML = t;
      var tp = d.querySelector('[data-topology]'); if (tp) st.topo = { chain: tp.getAttribute('data-topology'), svg: tp.innerHTML };
    }).catch(function () {}));
    Promise.all(jobs).then(function () { st.tried = true; if (route.current.indexOf('ref/PDB/' + pdb) === 0) keep(); });
  }

  function notFound(what) { show(null, '<div class="stack"><h1>Not found</h1><p>There is no MemProtMD record for <b>' + esc(what) + '</b>.</p><p><a class="btn" href="' + href('home') + '">Back to home</a></p></div>', 'Not found'); }

  /* ---------- router ---------- */
  function route() {
    var h = location.hash.replace(/^#/, ''), p = (h.charAt(0) === '/' ? h.slice(1) : dec(h)).replace(/\/+$/, ''), m;
    if (!p) p = 'home';
    route.current = p;
    if (p === 'home') pageHome();
    else if (p === 'search/text') pageSearch();
    else if (p === 'about' || p === 'stats' || p === 'api' || p === 'data') pageStatic(p, p, { about: 'About', stats: 'Statistics', api: 'API', data: 'Data files' }[p]);
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
