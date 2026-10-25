"""Build colors, sets, set inventories (sharded) and filaments for the website.

Usage: python build_data.py <src folder with rb/ and spool/> <site/data>
Run build_meshes.py first (needs parts.json).
"""
import csv, json, os, re, sys, zlib, collections

SRC, OUT = sys.argv[1], sys.argv[2]
RB = os.path.join(SRC, "rb")
SHARDS = 32


def rows(name):
    with open(os.path.join(RB, name), encoding="utf8") as fh:
        yield from csv.DictReader(fh)


def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf8") as fh:
        json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False)


# ---- colors (Rebrickable colors.csv) ----
colors = []
for r in rows("colors.csv"):
    if r["id"] == "-1":
        continue
    colors.append({"id": int(r["id"]), "name": r["name"], "hex": r["rgb"].upper(),
                   "trans": r["is_trans"] == "True", "sets": int(r["num_sets"])})
colors.sort(key=lambda c: -c["sets"])
dump("colors.json", colors)

# ---- sets that use at least one library part ----
parts = json.load(open(os.path.join(OUT, "parts.json"), encoding="utf8"))
have = {p["id"] for p in parts}
themes = {r["id"]: r for r in rows("themes.csv")}


def theme_path(tid):
    names = []
    while tid and tid in themes:
        names.append(themes[tid]["name"])
        tid = themes[tid]["parent_id"]
    return " / ".join(reversed(names))


sets = {r["set_num"]: r for r in rows("sets.csv")}
best = {}
for r in rows("inventories.csv"):
    if r["set_num"] not in sets:
        continue
    v = int(r["version"])
    if r["set_num"] not in best or v > best[r["set_num"]][0]:
        best[r["set_num"]] = (v, r["id"])
inv_to_set = {inv: s for s, (_, inv) in best.items()}

inv = collections.defaultdict(lambda: collections.defaultdict(int))
other = collections.defaultdict(int)
part_img = {}
with open(os.path.join(RB, "inventory_parts.csv"), encoding="utf8") as fh:
    for r in csv.DictReader(fh):
        s = inv_to_set.get(r["inventory_id"])
        if not s or r["is_spare"] == "True":
            continue
        q = int(r["quantity"])
        if r["part_num"] in have:
            inv[s][(r["part_num"], int(r["color_id"]))] += q
            if r["part_num"] not in part_img and r["img_url"]:
                part_img[r["part_num"]] = r["img_url"]
        else:
            other[s] += q

index, shards = [], [dict() for _ in range(SHARDS)]
for s, d in inv.items():
    meta = sets[s]
    index.append({"n": s, "name": meta["name"], "y": int(meta["year"] or 0),
                  "t": theme_path(meta["theme_id"]), "p": int(meta["num_parts"] or 0),
                  "img": meta["img_url"], "lib": sum(d.values()), "oth": other.get(s, 0)})
    shards[zlib.crc32(s.encode()) % SHARDS][s] = [[p, c, q] for (p, c), q in sorted(d.items())]
index.sort(key=lambda s: (-s["y"], s["n"]))
dump("sets.json", index)
os.makedirs(os.path.join(OUT, "inv"), exist_ok=True)
for i, sh in enumerate(shards):
    dump("inv/%d.json" % i, sh)

# part images / how many sets use each part
use = collections.Counter()
for d in inv.values():
    for (p, _c) in d:
        use[p] += 1
for p in parts:
    p["img"] = part_img.get(p["id"], "")
    p["sets"] = use.get(p["id"], 0)
dump("parts.json", parts)

# ---- filaments (SpoolmanDB) ----
WANT = {"PLA", "PLA+", "PETG", "ABS", "ASA"}
fils = []
sd = os.path.join(SRC, "spool")
for f in sorted(os.listdir(sd)):
    d = json.load(open(os.path.join(sd, f), encoding="utf8"))
    for fl in d["filaments"]:
        if fl["material"] not in WANT:
            continue
        for c in fl["colors"]:
            if "hex" not in c:
                continue          # multi-colour spools can't be matched on one swatch
            name = fl["name"].replace("{color_name}", c["name"]).strip()
            low = (name + " " + str(fl.get("finish", "")) + str(c.get("finish", ""))).lower()
            fils.append({
                "brand": d["manufacturer"], "name": name, "color": c["name"],
                "mat": "PLA" if fl["material"] == "PLA+" else fl["material"],
                "hex": c["hex"].lstrip("#").upper()[:6],
                "trans": bool(fl.get("translucent") or c.get("translucent")
                              or re.search(r"transparent|translucent|clear", low)),
                "finish": (c.get("finish") or fl.get("finish") or
                           next((k for k in ("silk", "matte", "metallic", "glitter", "marble", "sparkle")
                                 if k in low), "")),
                "dia": fl["diameters"][0] if fl.get("diameters") else 1.75,
                "src": "https://github.com/Donkie/SpoolmanDB/blob/main/filaments/" + f,
            })
dump("filaments.json", fils)
print(len(colors), "colors;", len(index), "sets;", len(fils), "filament colors;",
      sum(1 for p in parts if p["sets"]), "parts used in sets")
