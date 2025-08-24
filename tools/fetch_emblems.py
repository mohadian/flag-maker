#!/usr/bin/env python3
import json, os, re, time, random
from typing import Optional, Dict, Any, List, Tuple
import requests
from lxml import etree

# ================== YOU MUST EDIT THIS ==================
# Use a descriptive UA with a way to contact you (policy requirement):
CONTACT = "https://example.com/flag-maker ; email: you@example.com"
USER_AGENT = f"FlagMakerCollector/1.0 ({CONTACT}) requests"
# ========================================================

COMMONS_API = "https://commons.wikimedia.org/w/api.php"

OUT_JSON = os.path.join("public", "symbols.json")
CACHE_DIR = "public/emblems"
os.makedirs(CACHE_DIR, exist_ok=True)

# Politeness: small random delay between requests
def nap(min_s=0.35, max_s=0.7):
    time.sleep(random.uniform(min_s, max_s))

# Countries list (trim as you like). You can also restrict to a subset while testing.
UN_COUNTRIES = [
    "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria",
    "Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan",
    "Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia",
    "Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica",
    "Côte d'Ivoire","Croatia","Cuba","Cyprus","Czechia","Democratic Republic of the Congo","Denmark","Djibouti","Dominica","Dominican Republic",
    "Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland",
    "France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea",
    "Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq",
    "Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait",
    "Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
    "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico",
    "Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru",
    "Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman",
    "Pakistan","Palau","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar",
    "Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia",
    "Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa",
    "South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Tajikistan",
    "Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu",
    "Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam",
    "Yemen","Zambia","Zimbabwe"
]

session = requests.Session()
session.headers.update({
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
})

def get_json(params: Dict[str, Any], max_retries=5) -> Optional[dict]:
    """Call Commons API with retries and JSON-safe parsing."""
    for attempt in range(1, max_retries + 1):
        try:
            resp = session.get(COMMONS_API, params=params, timeout=30)
            if resp.status_code in (429, 500, 502, 503, 504):
                # backoff
                wait = 1.0 * attempt
                print(f"  ! HTTP {resp.status_code}, retrying in {wait:.1f}s …")
                time.sleep(wait)
                continue
            # Some block pages come back as text/html; guard parsing:
            ctype = resp.headers.get("Content-Type", "")
            if "application/json" not in ctype:
                # Try to detect HTML block:
                text_snip = resp.text[:200].strip().replace("\n", " ")
                print(f"  ! Non-JSON response (ctype={ctype}). Snippet: {text_snip!r}")
                time.sleep(1.0 * attempt)
                continue
            return resp.json()
        except requests.RequestException as e:
            wait = 1.0 * attempt
            print(f"  ! Request error: {e} — retrying in {wait:.1f}s …")
            time.sleep(wait)
        except ValueError as e:
            # JSON decode
            wait = 1.0 * attempt
            print(f"  ! JSON parse error: {e} — retrying in {wait:.1f}s …")
            time.sleep(wait)
    return None

def sanitize_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.\-]", "_", name)

def commons_file_info_by_title(title: str) -> Optional[Tuple[str, str, str]]:
    """
    Get pageurl + original SVG url by exact File:Title.
    Returns (page_title, pageurl, original_url) or None.
    """
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "imageinfo|info",
        "titles": f"File:{title}",
        "inprop": "url",
        "iiprop": "url|mediatype|mime",
        "origin": "*",
    }
    data = get_json(params)
    if not data:
        return None
    pages = data.get("query", {}).get("pages", [])
    if not pages:
        return None
    page = pages[0]
    if page.get("missing"):
        return None
    pageurl = page.get("fullurl") or page.get("canonicalurl")
    imageinfo = page.get("imageinfo", [])
    if not imageinfo:
        return None
    ii = imageinfo[0]
    url = ii.get("url", "")
    mime = ii.get("mime", "")
    if not url.lower().endswith(".svg") and "svg" not in mime:
        return None
    return page.get("title"), pageurl, url

def commons_search_svg(country: str) -> Optional[Dict[str, str]]:
    """
    Try common exact titles; if not found, search.
    Returns dict: {'title', 'pageurl', 'url'} or None.
    """
    patterns = [
        f"Coat of arms of {country}.svg",
        f"Emblem of {country}.svg",
        f"State emblem of {country}.svg",
        f"National emblem of {country}.svg",
    ]
    # 1) exact tries
    for t in patterns:
        res = commons_file_info_by_title(t)
        if res:
            title, pageurl, url = res
            return {"title": title, "pageurl": pageurl, "url": url}
        nap()

    # 2) search API in File namespace (6) for .svg
    query_variants = [
        f'intitle:"Coat of arms of {country}" filetype:svg',
        f'intitle:"Emblem of {country}" filetype:svg',
        f'intitle:"{country}" coat arms filetype:svg',
        f'intitle:"{country}" emblem filetype:svg',
    ]
    for q in query_variants:
        params = {
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "list": "search",
            "srsearch": q,
            "srnamespace": "6",  # File:
            "srlimit": "10",
            "origin": "*",
        }
        data = get_json(params)
        if not data:
            nap()
            continue
        hits = data.get("query", {}).get("search", [])
        for h in hits:
            title = h.get("title", "")
            if not title.startswith("File:") or not title.lower().endswith(".svg"):
                continue
            # Resolve to get original file URL
            info = commons_file_info_by_title(title.replace("File:", "", 1))
            if info:
                t, pageurl, url = info
                return {"title": t, "pageurl": pageurl, "url": url}
        nap()
    return None

def download_svg(url: str, dest: str) -> bool:
    """Download with UA + basic retries. Returns True on success."""
    for attempt in range(1, 5):
        try:
            r = session.get(url, timeout=60)
            if r.status_code == 200:
                with open(dest, "wb") as f:
                    f.write(r.content)
                return True
            elif r.status_code in (429, 500, 502, 503, 504):
                wait = 1.0 * attempt
                print(f"  ! HTTP {r.status_code} on file, retrying in {wait:.1f}s …")
                time.sleep(wait)
                continue
            elif r.status_code == 403:
                print("  ✗ 403 Forbidden on file: Wikimedia requires a proper User-Agent.")
                print("    Edit CONTACT in this script to include your site/email, then try again.")
                return False
            else:
                print(f"  ✗ HTTP {r.status_code} on file")
                return False
        except requests.RequestException as e:
            wait = 1.0 * attempt
            print(f"  ! Download error: {e} — retrying in {wait:.1f}s …")
            time.sleep(wait)
    return False

def extract_inner_svg(svg_path: str) -> Optional[Dict[str, str]]:
    """Return {'viewBox': 'minx miny w h', 'inner': '<g>…</g>'} or None."""
    try:
        parser = etree.XMLParser(remove_comments=False, recover=True)
        tree = etree.parse(svg_path, parser)
        root = tree.getroot()

        def local(tag): return tag.split("}")[-1]
        if local(root.tag) != "svg":
            return None

        viewBox = root.get("viewBox")
        if not viewBox:
            w = root.get("width")
            h = root.get("height")
            if w and h:
                w = re.sub(r"[^0-9.\-]", "", w)
                h = re.sub(r"[^0-9.\-]", "", h)
                viewBox = f"0 0 {w} {h}"
            else:
                # hopeless without dimensions
                return None

        parts: List[str] = []
        for child in root:
            parts.append(etree.tostring(child, encoding="unicode"))
        inner = "".join(parts).strip()
        if not inner:
            return None
        return {"viewBox": viewBox, "inner": inner}
    except Exception as e:
        print("  ✗ extract error:", svg_path, e)
        return None

def main():
    results = []
    ok, skipped, failed = 0, 0, 0

    # Load existing symbols.json (to merge)
    existing = []
    if os.path.exists(OUT_JSON):
        try:
            with open(OUT_JSON, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = []

    existing_by_id = {s["id"]: s for s in existing if isinstance(s, dict) and "id" in s}

    for i, country in enumerate(UN_COUNTRIES, 1):
        print(f"[{i}/{len(UN_COUNTRIES)}] {country} …")
        hit = commons_search_svg(country)
        if not hit:
            print("  ✗ not found via API/search")
            failed += 1
            continue

        title = hit["title"]
        pageurl = hit["pageurl"]
        url    = hit["url"]

        safe = sanitize_filename(title)
        dest = os.path.join(CACHE_DIR, safe)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print("  • cached")
        else:
            if not download_svg(url, dest):
                print("  ✗ download failed")
                failed += 1
                continue
            nap()

        parsed = extract_inner_svg(dest)
        if not parsed:
            print("  ✗ parse/viewBox/inner failed")
            failed += 1
            continue

        safe_country = country.lower().replace(" ", "_").replace("'", "").replace("-", "_")
        sym_id = f"{safe_country}_emblem"
        item = {
            "id": sym_id,
            "name": f"{country} – National emblem",
            "category": "National Emblems",
            "viewBox": parsed["viewBox"],
            "svg": parsed["inner"],
            "source": pageurl or f"https://commons.wikimedia.org/wiki/{safe}",
            "license": "Check file page on Wikimedia Commons"
        }
        results.append(item)
        ok += 1

    # Merge results into existing by id
    for r in results:
        existing_by_id[r["id"]] = r
    merged = list(existing_by_id.values())

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"\n✅ Done. Added/updated {ok}, failed {failed}, kept {len(merged)-ok} existing.")
    print(f"→ Wrote {OUT_JSON}")
    print("If any countries failed, re-run later; caching avoids redownloading.")

if __name__ == "__main__":
    main()
