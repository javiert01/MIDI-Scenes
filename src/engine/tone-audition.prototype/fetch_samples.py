"""PROTOTYPE (#45), throwaway. Fetches the candidate sample sets for the Tone
audition page and writes one region map per Tone to samples/<tone>/map.json.

    python3 src/engine/tone-audition.prototype/fetch_samples.py

Downloads about 300 MB, only the files the page plays. Samples stay in their
original FLAC/WAV (no encoder needed); the page estimates MP3 sizes instead.
The samples/ folder is gitignored. Wipe it freely.
"""

import io
import json
import re
import sys
import tarfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "samples"

NOTE_INDEX = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def safe(name):
    """Local file name the dev server can serve: no '#' (Vite treats it as a fragment) or spaces."""
    return name.replace("#", "s").replace(" ", "_")


def raw_url(repo, branch, path):
    return f"https://raw.githubusercontent.com/{repo}/{branch}/{urllib.parse.quote(path)}"


def fetch(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def fetch_text(url):
    return fetch(url).decode("utf-8", errors="replace")


def to_key(value):
    """SFZ key value: a number, or a note name with C4 = 60."""
    value = value.strip().lower()
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    m = re.fullmatch(r"([a-g])(#|b)?(-?\d+)", value)
    if not m:
        raise ValueError(f"bad key {value!r}")
    n = NOTE_INDEX[m.group(1)] + {"#": 1, "b": -1, None: 0}[m.group(2)]
    return n + (int(m.group(3)) + 1) * 12


def parse_sfz_inherit(text):
    """Flattens an SFZ into region dicts, inheriting control/global/master/group opcodes in document order."""
    text = re.sub(r"//[^\n]*", "", text)
    tokens = list(re.finditer(r"<(\w+)>|([A-Za-z_][\w$]*)=", text))
    order = ["control", "global", "master", "group"]
    levels = {k: {} for k in order}
    out, current, current_is_region = [], None, False

    def flush():
        if current_is_region:
            merged = {}
            for level in order:
                merged.update(levels[level])
            merged.update(current)
            out.append(merged)

    for i, tok in enumerate(tokens):
        end = tokens[i + 1].start() if i + 1 < len(tokens) else len(text)
        if tok.group(1):
            flush()
            header = tok.group(1)
            current_is_region = header == "region"
            if header in levels:
                for lower in order[order.index(header):]:
                    levels[lower] = {}
                current = levels[header]
            else:
                current = {}
        else:
            current[tok.group(2)] = text[tok.end():end].strip()
    flush()
    return out


def region_from_sfz(op, file):
    key = to_key(op.get("pitch_keycenter", op.get("key", "60")))
    lo = to_key(op.get("lokey", op.get("key", str(key))))
    hi = to_key(op.get("hikey", op.get("key", str(key))))
    loop = None
    if "loop_start" in op and "loop_end" in op and op.get("loop_mode", "loop_continuous") != "no_loop":
        loop = [int(op["loop_start"]), int(op["loop_end"])]
    return {
        "file": safe(file),
        "key": key,
        "lo": lo,
        "hi": hi,
        "vlo": int(op.get("lovel", 1)),
        "vhi": int(op.get("hivel", 127)),
        "tune": float(op.get("tune", 0)),
        "gainDb": float(op.get("volume", 0)),
        "pan": float(op.get("pan", 0)) / 100,
        "loop": loop,
        "release": op.get("trigger") == "release",
    }


def download_all(jobs):
    """jobs: list of (url, dest Path). Skips files already present."""
    todo = [(u, d) for u, d in jobs if not d.exists()]
    print(f"  {len(jobs)} files, {len(todo)} to download")

    def one(job):
        url, dest = job
        dest.parent.mkdir(parents=True, exist_ok=True)
        data = fetch(url)
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        tmp.rename(dest)
        return len(data)

    with ThreadPoolExecutor(8) as pool:
        total = sum(pool.map(one, todo))
    print(f"  downloaded {total / 2**20:.1f} MiB")


def write_map(tone, regions, notes):
    d = OUT / tone
    d.mkdir(parents=True, exist_ok=True)
    (d / "map.json").write_text(json.dumps({"tone": tone, "notes": notes, "regions": regions}, indent=1))
    keys = [r["key"] for r in regions if not r["release"]]
    print(f"  {tone}: {len(regions)} regions, keycentres {min(keys)}..{max(keys)}")


def piano():
    print("Grand Piano: Salamander V3 (CC BY 3.0), 4 of 16 layers")
    repo, branch = "sfzinstruments/SalamanderGrandPiano", "master"
    names = ["A", "C", "D#", "F#"]
    layers = ["v4", "v8", "v12", "v16"]
    regions, jobs = [], []
    for i in range(30):
        key = 21 + 3 * i
        name = f"{names[i % 4]}{(key // 12) - 1}"
        lo, hi = (21, 22) if i == 0 else (key - 1, min(key + 1, 108))
        for layer in layers:
            file = safe(f"{name}{layer}.flac")
            jobs.append((raw_url(repo, branch, f"Samples/{file}"), OUT / "piano" / file))
            regions.append({"file": file, "key": key, "lo": lo, "hi": hi, "vlo": 1, "vhi": 127,
                            "tune": 0, "gainDb": 0, "loop": None, "release": False, "layer": layer})
    download_all(jobs)
    write_map("piano", regions, "Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0. Layers v4/v8/v12/v16; the page splits velocity across the active ones.")


def strings():
    print("Strings: VSCO 2 CE Cello + Violin sections, susVib (CC0)")
    repo = "sgossner/VSCO-2-CE"
    split = 60
    regions, jobs = [], []
    for sfz, keep in [("CelloEnsSusVib.sfz", lambda r: r["lo"] < split),
                      ("ViolinEnsSusVib.sfz", lambda r: r["hi"] >= split)]:
        for op in parse_sfz_inherit(fetch_text(raw_url(repo, "SFZ", sfz))):
            path = (op.get("default_path", "") + op["sample"]).replace("\\", "/")
            file = Path(path).name
            r = region_from_sfz(op, file)
            if not keep(r):
                continue
            if sfz.startswith("Cello"):
                r["hi"] = min(r["hi"], split - 1)
            else:
                r["lo"] = max(r["lo"], split)
            regions.append(r)
            jobs.append((raw_url(repo, "master", path), OUT / "strings" / safe(file)))
    download_all(jobs)
    write_map("strings", regions, "VSCO 2 CE, Cello Section below C4 and Violin Section from C4, sustained vibrato, CC0. No loop points: the page can bake a crossfade loop.")


def guitar(tone, repo, sfz, notes):
    print(f"{tone}: {repo}")
    regions, jobs = [], []
    for op in parse_sfz_inherit(fetch_text(raw_url(repo, "main", sfz))):
        if float(op.get("lorand", 0)) != 0:
            continue  # one round robin only, as the shipped estimate assumes
        path = op["sample"].replace("\\", "/")
        file = path.replace("/", "_")
        regions.append(region_from_sfz(op, file))
        jobs.append((raw_url(repo, "main", path), OUT / tone / safe(file)))
    download_all(jobs)
    write_map(tone, regions, notes)


def accordion():
    print("Accordion: FreePats Button Accordion HN (CC0)")
    repo = "freepats/button-accordion-HN"
    regions, jobs = [], []
    for op in parse_sfz_inherit(fetch_text(raw_url(repo, "main", "PRESET Button Accordion HN tuned.sfz"))):
        path = op["sample"].replace("\\", "/")
        file = path.replace("/", "_")
        regions.append(region_from_sfz(op, file))
        jobs.append((raw_url(repo, "main", path), OUT / "accordion" / safe(file)))
    download_all(jobs)
    write_map("accordion", regions, "FreePats Button Accordion HN, CC0. One layer, loop points and per-note tune from the SFZ, release samples on note-off.")


def organ():
    print("Rock Organ: FreePats Rock Organ Emulation (CC0), archive")
    url = "https://freepats.zenvoid.org/Organ/RockOrganEmulation/RockOrganEmulation-SFZ-20190715.tar.xz"
    dest = OUT / "organ"
    if (dest / "map.json").exists():
        print("  already fetched")
        return
    dest.mkdir(parents=True, exist_ok=True)
    archive = tarfile.open(fileobj=io.BytesIO(fetch(url)), mode="r:xz")
    files = {}
    for m in archive.getmembers():
        name = m.name
        if not m.isfile() or name.startswith("/") or ".." in Path(name).parts:
            continue
        if not re.search(r"\.(sfz|wav|flac)$", name, re.I):
            continue
        files[name] = archive.extractfile(m).read()
    sfzs = [n for n in files if n.lower().endswith(".sfz")]
    print(f"  archive holds {len(files)} audio/sfz files; sfz: {sfzs}")
    sfz = sfzs[0]
    base = Path(sfz).parent
    regions = []
    for op in parse_sfz_inherit(files[sfz].decode("utf-8", errors="replace")):
        rel = (op.get("default_path", "") + op["sample"]).replace("\\", "/")
        src = str(base / rel)
        file = Path(rel).name
        if src not in files:
            print(f"  missing {src}")
            continue
        (dest / safe(file)).write_bytes(files[src])
        regions.append(region_from_sfz(op, file))
    write_map("organ", regions, f"FreePats Rock Organ Emulation ({Path(sfz).name}), rendered from setBfree, CC0.")


if __name__ == "__main__":
    which = sys.argv[2:] or ["piano", "strings", "guitar", "clean", "accordion", "organ"]
    if "accordion" in which:
        accordion()
    if "organ" in which:
        organ()
    if "clean" in which:
        guitar("guitar-clean", "freepats/electric-guitar-FSBS-clean", "EGuitarFSBS-clean bridge small 20260807.sfz",
               "FreePats FSBS Clean #1 small, CC0. For the clean + shared drive A/B.")
    if "guitar" in which:
        guitar("guitar", "freepats/electric-guitar-FSBS-dist2", "EGuitarFSBS-dist2 bridge 20220911.sfz",
               "FreePats FSBS Electric Guitar Distorted #2, CC0. One round robin per layer.")
    if "strings" in which:
        strings()
    if "piano" in which:
        piano()
