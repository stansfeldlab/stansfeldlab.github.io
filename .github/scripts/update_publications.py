#!/usr/bin/env python3
"""Refresh publications.html (and the home page's "Latest papers") from PubMed
(or Europe PMC if PubMed is down).

Run weekly by .github/workflows/update-publications.yml. Replaces everything
between the PUBS:START and PUBS:END markers in the page; the rest of the page
(header, menu, intro) is left alone. Standard library only.
"""
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

TERM = "Stansfeld PJ[au]"          # PubMed author search
MIN_PAPERS = 50                    # refuse to publish a suspiciously short list
PAGE = Path(__file__).resolve().parents[2] / "publications.html"
START, END = "<!-- PUBS:START -->", "<!-- PUBS:END -->"
HOME = PAGE.parent / "index.html"
HOME_START, HOME_END = "<!-- LATEST:START -->", "<!-- LATEST:END -->"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
SKIP_TYPES = {"Published Erratum", "Preprint", "Retraction of Publication", "Expression of Concern"}
TITLE_TAGS = {"i", "b", "sup", "sub", "u"}

# Group members shown in bold: read from the site's own Members and Alumni pages, so
# anyone added there is picked up automatically. Key: (surname, first initial) -> years.
# Alumni count from their start year to four years after they left; current members always.
GROUP = {("stansfeld", "p"): (0, 9999)}


def norm(s):
    s = unicodedata.normalize("NFKD", html.unescape(s))
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def _add_person(name, lo, hi):
    parts = re.sub(r"\(.*?\)", " ", html.unescape(name)).split()
    if len(parts) < 2:
        return
    key = (norm(" ".join(parts[1:])), norm(parts[0])[:1])
    old = GROUP.get(key)
    GROUP[key] = (min(lo, old[0]), max(hi, old[1])) if old else (lo, hi)


def load_group():
    site = PAGE.parent
    members = (site / "members.html").read_text(encoding="utf-8")
    for name in re.findall(r"<h3>([^<]+)</h3>", members):
        _add_person(name, 0, 9999)
    alumni = (site / "alumni.html").read_text(encoding="utf-8")
    for block in re.findall(r'<article class="alum">(.*?)</article>', alumni, re.S):
        name = re.search(r"<h3>([^<]+)</h3>", block)
        dates = re.search(r'<p class="dates">([^<]*)</p>', block)
        years = [int(y) for y in re.findall(r"\d{4}", dates.group(1) if dates else "")]
        if name:
            _add_person(name.group(1), *((min(years), max(years) + 4) if years else (0, 9999)))
    print(f"Bolding {len(GROUP)} group members")


def in_group(last, initials, year):
    """Surname matches and the person's first initial is their first or second initial
    (covers people who go by a middle name, e.g. C. Keith Cassidy = Cassidy CK).
    A double-barrelled surname in PubMed also matches on its last part
    (e.g. Bunoro-Batista M = Mariana Batista)."""
    if not last or not initials:
        return False
    ini = norm(initials)
    surnames = {norm(last), re.split(r"[\s-]+", norm(last))[-1]}
    for s in surnames:
        for k in {ini[:1], ini[1:2]} - {""}:
            span = GROUP.get((s, k))
            if span and span[0] <= year <= span[1]:
                return True
    return False


def eutils(endpoint, **params):
    params.update(tool="stansfeld-group-site")
    url = EUTILS + endpoint + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "stansfeld-group-site (+https://stansfeldlab.github.io/)"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8")
        except Exception as e:  # network blip, NCBI busy or rate limit: back off and retry
            body = e.read(300).decode("utf-8", "replace") if hasattr(e, "read") else ""
            print(f"  {endpoint} attempt {attempt + 1} failed: {e} {body!r}", file=sys.stderr)
            if attempt == 4:
                raise
            time.sleep(10 * (attempt + 1))


def fetch_ids():
    res = json.loads(eutils("esearch.fcgi", db="pubmed", term=TERM, retmax=1000, retmode="json"))
    return res["esearchresult"]["idlist"]


def fetch_records(ids):
    out = []
    for i in range(0, len(ids), 100):
        out.append(eutils("efetch.fcgi", db="pubmed", id=",".join(ids[i:i + 100]), retmode="xml"))
        time.sleep(1)
    return out


def inner(el):
    """Element text as safe HTML, keeping only simple inline formatting."""
    if el is None:
        return ""
    out = [html.escape(el.text or "", quote=False)]
    for c in el:
        body = inner(c)
        out.append(f"<{c.tag}>{body}</{c.tag}>" if c.tag in TITLE_TAGS else body)
        out.append(html.escape(c.tail or "", quote=False))
    return re.sub(r"\s+", " ", "".join(out)).strip()


# Organism names are italicised in titles (PubMed often leaves them plain).
GENERA = ("Escherichia|Bacillus|Pseudomonas|Staphylococcus|Mycobacterium|Caulobacter|Klebsiella|Acinetobacter|"
          "Enterococcus|Enterobacter|Salmonella|Vibrio|Helicobacter|Thermus|Streptococcus|Streptomyces|Toxoplasma|"
          "Plasmodium|Saccharomyces|Neisseria|Shigella|Yersinia|Campylobacter|Clostridioides|Clostridium|Listeria|"
          "Legionella|Chlamydia|Haemophilus|Bordetella|Aquifex|Thermotoga|Nitrosopumilus|Synechocystis|Deinococcus|"
          "Borrelia|Bacteroides|Corynebacterium|Xanthomonas|Rhodobacter|Agrobacterium|Serratia|Burkholderia|"
          "Francisella|Lactococcus|Cronobacter|Proteus|Aeromonas|Myxococcus|Drosophila|Caenorhabditis|Arabidopsis")
EPITHETS = ("coli|subtilis|aeruginosa|aureus|tuberculosis|smegmatis|marinum|crescentus|pneumoniae|baumannii|faecium|"
            "faecalis|cloacae|cholerae|pylori|thermophilus|gondii|falciparum|cerevisiae|enterica|jejuni|meningitidis|"
            "gonorrhoeae|influenzae|monocytogenes|pneumophila|trachomatis|difficile|maritimus|aeolicus|maritima|"
            "radiodurans|burgdorferi|sphaeroides|tumefaciens|marcescens|cepacia|tularensis|lactis|fragilis|glutamicum|"
            "coelicolor|pyogenes|sakazakii|mirabilis|xanthus|melanogaster|elegans|thaliana")
_FULL = re.compile(rf"\b(?:{GENERA})(?:\s+(?:{EPITHETS}))?\b")
_ABBR = re.compile(rf"\b[A-Z]\.\s?(?:{EPITHETS})\b")


def italicise(title_html):
    """Wrap organism names in <i>, leaving text that is already italic alone."""
    out, depth = [], 0
    for tok in re.split(r"(<[^>]+>)", title_html):
        if tok.startswith("<"):
            depth += 1 if tok == "<i>" else -1 if tok == "</i>" else 0
        elif depth == 0 and tok:
            tok = _FULL.sub(lambda m: f"<i>{m.group(0)}</i>", tok)
            tok = re.sub(r"(<i>.*?</i>)|" + _ABBR.pattern,
                         lambda m: m.group(1) or f"<i>{m.group(0)}</i>", tok)
        out.append(tok)
    return "".join(out)


def txt(el, path):
    found = el.find(path)
    return (found.text or "").strip() if found is not None and found.text else ""


def authors(art, year):
    names = []  # (shown as, surname, initials)
    for a in art.findall("AuthorList/Author"):
        if txt(a, "LastName"):
            names.append((f"{txt(a, 'LastName')} {txt(a, 'Initials')}".strip(), txt(a, "LastName"), txt(a, "Initials")))
        elif txt(a, "CollectiveName"):
            names.append((txt(a, "CollectiveName"), "", ""))
    return format_authors(names, year)


def format_authors(names, year):
    bold = [in_group(last, ini, year) for _, last, ini in names]
    keep = range(len(names))
    if len(names) > 25:  # long consortium lists: first ten, group members, last author
        keep = sorted(set(range(10)) | {k for k, b in enumerate(bold) if b} | {len(names) - 1})
    out, prev = [], -1
    for k in keep:
        if k != prev + 1:
            out.append("…")
        shown = html.escape(names[k][0], quote=False)
        out.append(f"<b>{shown}</b>" if bold[k] else shown)
        prev = k
    return ", ".join(out).replace(", …, ", " … ")


def parse(xml_text):
    papers = []
    for pa in ET.fromstring(xml_text).findall("PubmedArticle"):
        mc = pa.find("MedlineCitation")
        art = mc.find("Article")
        types = {t.text for t in art.findall("PublicationTypeList/PublicationType")}
        if types & SKIP_TYPES:
            continue
        title = italicise(inner(art.find("ArticleTitle")).rstrip("."))
        if not title:
            continue
        ji = art.find("Journal/JournalIssue")
        year = txt(ji, "PubDate/Year") or (re.findall(r"\d{4}", txt(ji, "PubDate/MedlineDate")) or [""])[0] \
            or txt(art, "ArticleDate/Year")
        if not year:
            continue
        vol, issue, pages = txt(ji, "Volume"), txt(ji, "Issue"), txt(art, "Pagination/MedlinePgn")
        if re.match(r"S\d{4}-", pages):  # Elsevier PII code, not page numbers
            pages = ""
        details = year
        if vol:
            details += f";{vol}" + (f"({issue})" if issue else "")
        if pages:
            details += f":{pages}"
        doi = ""
        for aid in pa.findall("PubmedData/ArticleIdList/ArticleId"):
            if aid.get("IdType") == "doi" and aid.text:
                doi = aid.text.strip()
        if not doi:
            for loc in art.findall("ELocationID"):
                if loc.get("EIdType") == "doi" and loc.text:
                    doi = loc.text.strip()
        pmid = txt(mc, "PMID")
        pmcid = next((aid.text.strip() for aid in pa.findall("PubmedData/ArticleIdList/ArticleId")
                      if aid.get("IdType") == "pmc" and aid.text), "")
        url = f"https://doi.org/{doi}" if doi else f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        papers.append({
            "pmid": int(pmid), "year": int(year), "title": title, "authors": authors(art, int(year)),
            "journal": html.escape(txt(art, "Journal/ISOAbbreviation") or txt(art, "Journal/Title"), quote=False),
            "details": html.escape(details, quote=False), "url": html.escape(url), "pmcid": pmc_id(pmcid),
        })
    return papers


def pmc_id(s):
    """'PMC1234567' (or '') from whatever form the source gives."""
    m = re.search(r"PMC\d+", s or "", re.I)
    return m.group(0).upper() if m else ""


def render_item(p):
    lines = [
        "  <li>",
        f'    <a class="t" href="{p["url"]}">{p["title"]}</a>',
        f'    <p class="a">{p["authors"]}</p>',
        f'    <p class="j"><em>{p["journal"]}</em> {p["details"]}</p>',
    ]
    if p.get("pmcid"):  # free full text in PubMed Central
        lines.append(f'    <p class="x"><a href="https://pmc.ncbi.nlm.nih.gov/articles/{p["pmcid"]}/">Free full text (PMC)</a></p>')
    return lines + ["  </li>"]


def replace_block(page_html, start, end, block):
    """Swap the text between two marker comments, keeping the page's indentation."""
    head, rest = page_html.split(start, 1)
    _, tail = rest.split(end, 1)
    indent = re.search(r"[ \t]*$", head).group(0)
    return head + f"{start}\n{block}\n{end}".replace("\n", "\n" + indent) + tail


def update_home(page_html, papers, n=3):
    """The home page's "Latest papers" list: the n newest papers."""
    if HOME_START not in page_html or HOME_END not in page_html:
        return page_html
    newest = sorted(papers, key=lambda p: (p["year"], p["pmid"]), reverse=True)[:n]
    block = "\n".join(['<ol class="pubs">'] + [l for p in newest for l in render_item(p)] + ["</ol>"])
    return replace_block(page_html, HOME_START, HOME_END, block)


def render(papers):
    by_year = {}
    for p in sorted(papers, key=lambda p: (p["year"], p["pmid"]), reverse=True):
        by_year.setdefault(p["year"], []).append(p)
    lines = ['<ul class="years" aria-label="Jump to year">']
    lines += [f'  <li><a href="#y{y}">{y}</a></li>' for y in by_year]
    lines.append("</ul>")
    for y, ps in by_year.items():
        lines.append(f'<h2 class="pub-year" id="y{y}">{y}</h2>')
        lines.append('<ol class="pubs">')
        for p in ps:
            lines += render_item(p)
        lines.append("</ol>")
    return "\n".join(lines)


def update_page(page_html, papers, today=None, source="PubMed"):
    today = today or date.today()
    if START not in page_html or END not in page_html:
        raise SystemExit(f"Markers {START} / {END} not found in {PAGE}")
    link = (f"https://pubmed.ncbi.nlm.nih.gov/?term={urllib.parse.quote(TERM)}" if source == "PubMed"
            else f"https://europepmc.org/search?query={urllib.parse.quote(EPMC_QUERY)}")
    stamp = (f'<p class="updated">{len(papers)} papers · checked against '
             f'<a href="{link}">{source}</a> on {today.day} {today:%B %Y}</p>')
    return replace_block(page_html, START, END, f"{stamp}\n{render(papers)}")


# ---------------------------------------------------------------- Europe PMC fallback
# Europe PMC mirrors PubMed (SRC:MED) on separate servers, used if NCBI is unavailable.
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
EPMC_QUERY = 'AUTH:"Stansfeld PJ" AND SRC:MED'


class _TitleCleaner(HTMLParser):
    """Keep only simple inline formatting from an HTML-ish title string."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag in TITLE_TAGS:
            self.out.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag in TITLE_TAGS:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        self.out.append(html.escape(data, quote=False))


def clean_title(s):
    p = _TitleCleaner()
    p.feed(html.unescape(s or ""))  # Europe PMC sends inline tags escaped (&lt;i&gt;)
    p.close()
    return re.sub(r"\s+", " ", "".join(p.out)).strip().rstrip(".")


def epmc_get(params):
    url = EPMC + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "stansfeld-group-site (+https://stansfeldlab.github.io/)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print(f"  Europe PMC attempt {attempt + 1} failed: {e}", file=sys.stderr)
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))


def _split_name(s):
    """'Corey RA' -> ('Corey RA', 'Corey', 'RA')."""
    s = s.strip()
    m = re.match(r"(.+?)\s+([A-Z]{1,4})$", s)
    return (s, m.group(1), m.group(2)) if m else (s, "", "")


def epmc_papers():
    results, cursor = [], "*"
    while True:
        data = epmc_get({"query": EPMC_QUERY, "resultType": "core", "format": "json",
                         "pageSize": 1000, "cursorMark": cursor})
        batch = data.get("resultList", {}).get("result", [])
        results += batch
        nxt = data.get("nextCursorMark")
        if not batch or not nxt or nxt == cursor:
            break
        cursor = nxt
    print(f"Europe PMC returned {len(results)} records (hitCount {data.get('hitCount')})")
    papers = []
    for r in results:
        types = set(r.get("pubTypeList", {}).get("pubType", []) or [])
        if types & SKIP_TYPES or not r.get("pmid"):
            continue
        title = italicise(clean_title(r.get("title")))
        ji = r.get("journalInfo", {}) or {}
        j = ji.get("journal", {}) or {}
        year = str(r.get("pubYear") or ji.get("yearOfPublication") or "")
        if not title or not year.isdigit():
            continue
        names = []
        for a in (r.get("authorList", {}) or {}).get("author", []) or []:
            if a.get("lastName"):
                names.append((f"{a['lastName']} {a.get('initials', '')}".strip(), a["lastName"], a.get("initials", "")))
            elif a.get("collectiveName"):
                names.append((a["collectiveName"], "", ""))
            elif a.get("fullName"):
                names.append(_split_name(a["fullName"]))
        if not names and r.get("authorString"):
            names = [_split_name(n) for n in r["authorString"].rstrip(".").split(",") if n.strip()]
        details = year
        if ji.get("volume"):
            details += f";{ji['volume']}" + (f"({ji['issue']})" if ji.get("issue") else "")
        if r.get("pageInfo") and not re.match(r"S\d{4}-", r["pageInfo"]):  # skip Elsevier PII codes
            details += f":{r['pageInfo']}"
        doi = r.get("doi", "")
        url = f"https://doi.org/{doi}" if doi else f"https://pubmed.ncbi.nlm.nih.gov/{r['pmid']}/"
        journal = j.get("isoabbreviation") or j.get("ISOAbbreviation") or j.get("medlineAbbreviation") or j.get("title") or ""
        papers.append({
            "pmid": int(r["pmid"]), "year": int(year), "title": title, "authors": format_authors(names, int(year)),
            "journal": html.escape(journal, quote=False), "details": html.escape(details, quote=False),
            "url": html.escape(url), "pmcid": pmc_id(r.get("pmcid", "")),
        })
    return papers


def pubmed_papers():
    ids = fetch_ids()
    print(f"PubMed returned {len(ids)} records for {TERM!r}")
    return [p for chunk in fetch_records(ids) for p in parse(chunk)]


def main():
    load_group()
    try:
        papers, source = pubmed_papers(), "PubMed"
    except Exception as e:
        print(f"PubMed unavailable ({e!r}); falling back to Europe PMC", file=sys.stderr)
        papers, source = epmc_papers(), "Europe PMC"
    print(f"Kept {len(papers)} papers")
    for p in sorted(papers, key=lambda p: p["pmid"], reverse=True)[:3]:
        print(f"  e.g. {p['year']} {p['journal']} {p['details']} | {p['title'][:90]}")
    if len(papers) < MIN_PAPERS:
        raise SystemExit(f"Only {len(papers)} papers found (expected at least {MIN_PAPERS}); leaving the page unchanged.")
    PAGE.write_text(update_page(PAGE.read_text(encoding="utf-8"), papers, source=source), encoding="utf-8")
    if HOME.exists():
        HOME.write_text(update_home(HOME.read_text(encoding="utf-8"), papers), encoding="utf-8")
    print(f"Wrote {PAGE}")


if __name__ == "__main__":
    main()
