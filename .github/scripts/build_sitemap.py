#!/usr/bin/env python3
"""Rebuild sitemap.xml from the site's top-level pages.

Run by .github/workflows/update-sitemap.yml whenever a page changes, so new
pages (a new game, the Photos page once it's published) are listed
automatically. Pages in folders (group/ redirects, _drafts/) are left out, as
are Google's verification file and any page marked noindex.
"""
import datetime
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITEMAP = ROOT / "sitemap.xml"
BASE = "https://stansfeldlab.github.io/"

# Menu order first; any other page (the games) follows alphabetically.
MENU = ["index.html", "members.html", "pi.html", "alumni.html",
        "publications.html", "research-tools.html", "funding.html",
        "positions.html", "find-us.html", "games-vr.html", "complexes.html"]


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                          text=True).stdout.strip()


def lastmod(name):
    today = datetime.date.today().isoformat()
    if git("status", "--porcelain", "--", name):   # edited but not committed
        return today
    return git("log", "-1", "--format=%cs", "--", name) or today


def listed(path):
    if path.name.startswith("google") or path.name == "404.html":
        return False
    head = path.read_text(encoding="utf-8", errors="ignore")[:5000].lower()
    return "noindex" not in head


def main():
    pages = sorted(p.name for p in ROOT.glob("*.html") if listed(p))
    ordered = [p for p in MENU if p in pages] + [p for p in pages if p not in MENU]
    rows = []
    for name in ordered:
        loc = BASE if name == "index.html" else BASE + name
        rows.append(f"  <url><loc>{loc}</loc><lastmod>{lastmod(name)}</lastmod></url>")
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + "\n".join(rows) + "\n</urlset>\n")
    if not SITEMAP.exists() or SITEMAP.read_text(encoding="utf-8") != xml:
        SITEMAP.write_text(xml, encoding="utf-8")
        print(f"sitemap.xml updated: {len(rows)} pages")
    else:
        print(f"sitemap.xml unchanged: {len(rows)} pages")


if __name__ == "__main__":
    main()
