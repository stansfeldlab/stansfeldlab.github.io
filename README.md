# stansfeldlab.github.io

Website of the Stansfeld Research Group, University of Warwick: https://stansfeldlab.github.io/

Static site for GitHub Pages (no build step).

## Group site

- One HTML file per page (`index.html`, `members.html`, `pi.html`, `alumni.html`, `publications.html`, `research-tools.html`, `funding.html`, `positions.html`, `find-us.html`, `games-vr.html`, `complexes.html`); shared styles in `style.css`; images in `images/`.
- To add a person, copy an `<article class="person">` block in `members.html` (or `<article class="alum">` in `alumni.html`).
- The menu is repeated at the top of each page; edit all files if you add a page.
- `group/` only holds redirects from the site's old /group/ addresses.
- `_drafts/` holds pages that aren't published yet (GitHub Pages skips folders starting with `_`). The Photos page (`_drafts/photos.html`, images in `_drafts/images/photos/`) is there; to publish it, move it back to the top level and add Photos to the menu on every page.

## Publications

Every Monday a GitHub Action (`.github/workflows/update-publications.yml`) rebuilds the list in `publications.html` from PubMed (`Stansfeld PJ[au]`), falling back to Europe PMC if PubMed is unavailable. It also runs when `members.html` or `alumni.html` change, because group members' names are shown in bold. Don't edit between the `PUBS:START`/`PUBS:END` markers by hand. To refresh now: **Actions** tab → **Update publications** → **Run workflow**.

## Complexes

Structure images are in `images/complexes/`. The Mol* views and downloads come from the [pstansfeld/ecoli-complexes](https://github.com/pstansfeld/ecoli-complexes) repo (forked from Rebecca Mann's `rebeccamann/rebeccamann.github.io`).

## Games

`Dont-Get-Solubilised-XR.html`, `Dont-Get-Solubilised.html`, `Active-Site-Sorter.html` (uses `levels/`), `Culture-Code.html`, `Drop-the-Dose.html`, `ESKAPE-Chase.html`, `ESKAPE-Containment.html`, `ESKAPE-Invaders.html`, `Galaxy-ESKAPE.html`, `SuperBugs.html`, `Superbug-Showdown.html`, `Superbug-Smackdown.html`. `MD-example.molx` and `Elongasome.molx` are used by the VR demos.

## Search engines and visitor counts

- `sitemap.xml` lists every top-level page for Google. It is rebuilt automatically (`.github/workflows/update-sitemap.yml`) whenever a page is added or changed, so don't edit it by hand. `robots.txt` points search engines to it.
- `index.html` and `pi.html` carry structured data (the `application/ld+json` blocks) describing the group and the PI for Google.
- `google1f4e1a8725accb95.html` verifies the site in Google Search Console; leave it in place.
- Visits are counted by GoatCounter (https://pstansfeld.goatcounter.com); the script is at the bottom of each page.
