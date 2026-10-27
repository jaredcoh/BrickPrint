"""Convert the chosen LDraw parts into compact binary meshes for the website.

Inputs  (downloaded separately, see build/README.md):
  Rebrickable CSV dumps  -> part list, categories
  LDraw complete.zip     -> geometry
Outputs:
  site/data/meshes/<part>.bin   header(3 x uint32: nv, ni, flags) + float32 xyz (mm)
                                [+ int8 xyz tolerance directions] + uint16/uint32 indices
  site/data/parts.json
"""
import csv, html, json, os, re, sys
import numpy as np

SRC = sys.argv[1]            # folder holding rb/ and ldraw/
OUT = sys.argv[2]            # site/data
RB = os.path.join(SRC, "rb")
LD = os.path.join(SRC, "ldraw", "ldraw")
UNF = os.path.join(SRC, "unf")          # LDraw unofficial library (ldrawunf.zip), optional
LDU = 0.4                    # mm per LDraw unit
MAX_TRIS = 60000

# Rebrickable part_cat_id values chosen with the user: bricks/plates/tiles + slopes/curves/wedges
CATS = {11: "Bricks", 14: "Plates", 19: "Tiles", 67: "Tiles Round and Curved",
        20: "Bricks Round and Cones", 3: "Bricks Sloped", 37: "Bricks Curved",
        6: "Bricks Wedged", 49: "Plates Wedged", 21: "Plates Round Curved and Dishes"}

# Categories whose parts are mostly printed / multi-colored. To keep the data small, only parts that
# appear in at least one set inventory are included from these.
CATS_MC = {59: "Minifig Heads", 60: "Minifig Torsos", 61: "Minifig Legs", 65: "Minifig Headwear",
           70: "Minifig Hipwear", 71: "Minifig Neckwear", 27: "Minifig Accessories",
           5: "Bricks Special", 9: "Plates Special", 15: "Tiles Special", 16: "Windows and Doors",
           23: "Panels", 38: "Flags, Banners and Signs", 58: "Stickers"}

TOP_STUDS = {"stud", "stud2", "stud-logo", "stud-logo2", "stud-logo3", "stud-logo4", "stud-logo5",
             "stud2-logo", "stud2-logo2", "stud2-logo3", "stud2-logo4", "stud2-logo5"}
TUBES = {"stud4"}

# ---------- LDraw colors (LDConfig.ldr) ----------
COLORS = {}
with open(os.path.join(LD, "LDConfig.ldr"), encoding="utf8", errors="ignore") as _fh:
    for _line in _fh:
        _m = re.match(r"0\s+!COLOUR\s+\S+\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})", _line)
        if _m:
            COLORS[int(_m.group(1))] = _m.group(2).upper()
MAIN = 16                      # "use the parent's color"
# a polygon that lives in a print/sticker file is artwork laid on top of the base surface
DECAL_RE = re.compile(r"(?:pr|pb|bpb|bp|pat|stk|px|ps|pt|ph|pd|pm)\d")
DECAL_LIFT = 0.08              # LDU (~0.03 mm): lifts artwork off the coplanar base face


def parse_col(tok):
    try:
        return int(tok)
    except ValueError:
        try:
            return int(tok, 16)
        except ValueError:
            return MAIN


def color_hex(code):
    if code >= 0x2000000:
        return "%06X" % (code & 0xFFFFFF)
    return COLORS.get(code)


# ---------- LDraw file index ----------
index = {}
for base in [os.path.join(LD, "p"), os.path.join(LD, "parts"),
             os.path.join(UNF, "p"), os.path.join(UNF, "parts")]:   # official first, so it wins
    for dp, _, fs in os.walk(base):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), base).replace("\\", "/").lower()
            index.setdefault(rel, os.path.join(dp, f))


def resolve(ref):
    ref = ref.replace("\\", "/").lower()
    return index.get(ref)


cache = {}


def flatten(path):
    """Return (V, D, C, K): V, D are n x 3 x 3 arrays in LDU (local space, CCW-wound; D = tolerance
    directions); C = LDraw color code per triangle (16 = inherit); K = artwork (decal) flag."""
    if path in cache:
        return cache[path]
    stem = os.path.splitext(os.path.basename(path))[0].lower()
    tris, dirs, cols, decs = [], [], [], []
    is_print = bool(DECAL_RE.search(stem))
    cw = False
    invert_next = False
    with open(path, encoding="utf8", errors="ignore") as fh:
        for line in fh:
            p = line.split()
            if not p:
                continue
            t = p[0]
            if t == "0":
                if len(p) > 2 and p[1] == "BFC":
                    if "CW" in p[2:] and "CCW" not in p[2:]:
                        cw = True
                    if "CCW" in p[2:]:
                        cw = False
                    if "INVERTNEXT" in p[2:]:
                        invert_next = True
                continue
            if t == "1" and len(p) >= 15:
                cc = parse_col(p[1])
                vals = list(map(float, p[2:14]))
                x, y, z, a, b, c, d, e, f, g, h, i = vals
                A = np.array([[a, b, c], [d, e, f], [g, h, i]])
                tr = np.array([x, y, z])
                sub = resolve(" ".join(p[14:]))
                inv = invert_next
                invert_next = False
                if sub is None:
                    continue
                V, D, C, K = flatten(sub)
                if len(V) == 0:
                    continue
                if cc not in (MAIN, 24):
                    C = np.where(C == MAIN, cc, C)
                V2 = V @ A.T + tr
                D2 = D @ A.T
                n = np.linalg.norm(D2, axis=2, keepdims=True)
                D2 = np.divide(D2, n, out=np.zeros_like(D2), where=n > 1e-9)
                if (np.linalg.det(A) < 0) != inv:
                    V2 = V2[:, [0, 2, 1], :]
                    D2 = D2[:, [0, 2, 1], :]
                tris.append(V2)
                dirs.append(D2)
                cols.append(C)
                decs.append(K)
            elif t in ("3", "4"):
                k = 3 if t == "3" else 4
                if len(p) < 2 + k * 3:
                    continue
                pts = np.array(list(map(float, p[2:2 + k * 3]))).reshape(k, 3)
                if k == 4:
                    tri = np.array([[pts[0], pts[1], pts[2]], [pts[0], pts[2], pts[3]]])
                else:
                    tri = pts[None]
                if cw:
                    tri = tri[:, [0, 2, 1], :]
                tris.append(tri)
                dirs.append(np.zeros_like(tri))
                code = parse_col(p[1])
                cols.append(np.full(len(tri), MAIN if code == 24 else code, dtype=np.int64))
                decs.append(np.full(len(tri), is_print, dtype=bool))
                invert_next = False
    if tris:
        V = np.concatenate(tris)
        D = np.concatenate(dirs)
        C = np.concatenate(cols)
        K = np.concatenate(decs)
    else:
        V = np.zeros((0, 3, 3))
        D = np.zeros((0, 3, 3))
        C = np.zeros(0, dtype=np.int64)
        K = np.zeros(0, dtype=bool)
    if stem in TOP_STUDS or stem in TUBES:
        r = np.sqrt(V[:, :, 0] ** 2 + V[:, :, 2] ** 2)
        rad = np.stack([V[:, :, 0], np.zeros_like(r), V[:, :, 2]], axis=2)
        with np.errstate(invalid="ignore", divide="ignore"):
            unit = np.where(r[..., None] > 1e-6, rad / r[..., None], 0)
        if stem in TOP_STUDS:       # outer stud wall shrinks
            mask = r >= 5.5
            D = np.where(mask[..., None], -unit, 0)
        else:                        # tube bore (r = 6) grows
            mask = (r >= 5.5) & (r <= 6.5)
            D = np.where(mask[..., None], unit, 0)
    cache[path] = (V, D, C, K)
    return V, D, C, K


def to_stl_space(a):
    # LDraw: -Y is up. STL: +Z is up.  (x, y, z) -> (x, z, -y) is a proper rotation.
    return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1)


def header(path):
    title, author, lic = "", "", ""
    with open(path, encoding="utf8", errors="ignore") as fh:
        for n, line in enumerate(fh):
            if n == 0:
                title = line[2:].strip()
            elif line.startswith("0 Author:"):
                author = line[9:].strip()
            elif line.startswith("0 !LICENSE"):
                lic = line[10:].strip()
            if n > 40:
                break
    return title, author, lic


def write_mesh(pid, V, D, C, K):
    # per-triangle color: 0 = the color the user picks, 1.. = fixed colors from the LDraw model;
    # bit 7 marks artwork, which is lifted off the base surface so it can be told apart.
    pal, tri_attr = [], np.zeros(len(V), dtype=np.uint8)
    for code in sorted(set(int(c) for c in C) - {MAIN}):
        hx = color_hex(code)
        if hx is None or len(pal) >= 127:
            continue
        pal.append(hx)
        tri_attr[C == code] = len(pal)
    art = (K & (tri_attr > 0)) if pal else np.zeros(len(V), dtype=bool)
    if art.any():
        V = V.copy()
        e1, e2 = V[art, 1] - V[art, 0], V[art, 2] - V[art, 0]
        nrm = np.cross(e1, e2)
        ln = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm = np.divide(nrm, ln, out=np.zeros_like(nrm), where=ln > 1e-9)
        V[art] += nrm[:, None, :] * DECAL_LIFT
    tri_attr[art] |= 0x80
    Vm = to_stl_space(V) * LDU
    Dm = to_stl_space(D)
    flat = Vm.reshape(-1, 3)
    dflat = np.round(Dm.reshape(-1, 3) * 127).astype(np.int8)
    zmin = flat[:, 2].min()
    cx = (flat[:, 0].min() + flat[:, 0].max()) / 2
    cy = (flat[:, 1].min() + flat[:, 1].max()) / 2
    flat = flat - np.array([cx, cy, zmin])
    key = np.concatenate([np.round(flat * 1000).astype(np.int32), dflat.astype(np.int32)], axis=1)
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    pos = flat[first].astype(np.float32)
    dd = dflat[first]
    idx = inv.reshape(-1)
    # drop degenerate triangles
    t = idx.reshape(-1, 3)
    keep = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    idx = t[keep].reshape(-1)
    tri_attr = tri_attr[keep]
    has_dir = bool(np.any(dd))
    flags = (1 if has_dir else 0) | (2 if len(pos) > 65535 else 0) | (4 if pal else 0)
    buf = np.array([len(pos), len(idx), flags], dtype=np.uint32).tobytes()
    buf += pos.tobytes()
    if has_dir:
        buf += dd.tobytes()
    buf += idx.astype(np.uint32 if flags & 2 else np.uint16).tobytes()
    if pal:
        buf += tri_attr.tobytes()
    with open(os.path.join(OUT, "meshes", pid + ".bin"), "wb") as fh:
        fh.write(buf)
    size = flat.max(axis=0) - flat.min(axis=0)
    return [round(float(s), 2) for s in size], len(idx) // 3, pal, int(((tri_attr & 0x80) > 0).sum())


def std_name(n):
    """Tidy Rebrickable part names so they read and search the same way."""
    n = html.unescape(n)
    n = re.sub(r"(?<=\w)�(?=\w)", " ", n).replace("�", "")
    n = re.sub(r"(?<=\d)\s*[xX×]\s*(?=\d)", " x ", n)        # 2x4, 2X4, 2 × 4 -> 2 x 4
    n = re.sub(r"w/\s*", "with ", n, flags=re.I)
    n = re.sub(r"w/o", "without", n, flags=re.I)
    n = re.sub(r"\s*,\s*", ", ", n)
    n = re.sub(r"\s+", " ", n).strip(" ,")
    return n[:1].upper() + n[1:]


REL_KIND = {"A": "alt", "M": "alt", "P": "print", "T": "print"}


def main():
    os.makedirs(os.path.join(OUT, "meshes"), exist_ok=True)
    with open(os.path.join(RB, "parts.csv"), encoding="utf8") as fh:
        allparts = {r["part_num"]: r for r in csv.DictReader(fh)}
    parent = {}
    with open(os.path.join(RB, "part_relationships.csv"), encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            if r["rel_type"] in REL_KIND:
                parent.setdefault(r["child_part_num"], (r["parent_part_num"], REL_KIND[r["rel_type"]]))

    def find_file(pid):
        """Return (path, geometry id, kind, unofficial) following alternate/print relationships."""
        kind, cur = "exact", pid
        for _ in range(5):
            for root, unf in ((LD, False), (UNF, True)):
                f = os.path.join(root, "parts", cur + ".dat")
                if os.path.exists(f):
                    return f, cur, kind, unf
            if cur not in parent:
                return None
            cur, k = parent[cur]
            kind = "print" if "print" in (kind, k) else "alt"
        return None

    used = set()
    with open(os.path.join(RB, "inventory_parts.csv"), encoding="utf8") as fh:
        for r in csv.DictReader(fh):
            if r["is_spare"] != "True":
                used.add(r["part_num"])

    def in_scope(pid):
        cur = pid
        for _ in range(5):
            r = allparts.get(cur)
            if r:
                c = int(r["part_cat_id"])
                if c in CATS:
                    return CATS[c]
                if c in CATS_MC and pid in used:
                    return CATS_MC[c]
            if cur not in parent:
                return None
            cur = parent[cur][0]
        return None

    parts, skipped, meshes = [], {"no_ldraw": 0, "too_big": 0, "empty": 0}, {}
    for pid, r in allparts.items():
        cat = in_scope(pid)
        if not cat:
            continue
        found = find_file(pid)
        if not found:
            skipped["no_ldraw"] += 1
            continue
        path, gid, kind, unf = found
        if gid not in meshes:
            V, D, C, K = flatten(path)
            if len(V) == 0:
                meshes[gid] = None
            elif len(V) > MAX_TRIS:
                meshes[gid] = None
            else:
                title, author, lic = header(path)
                size, ntri, pal, nart = write_mesh(gid, V, D, C, K)
                if min(size) < 0.05:          # paper-thin (e.g. sticker sheets): nothing to print
                    meshes[gid] = None
                    os.remove(os.path.join(OUT, "meshes", gid + ".bin"))
                else:
                    meshes[gid] = {"ldraw_title": title, "author": author, "license": lic,
                                   "size_mm": size, "tris": ntri, "tweak": bool(np.any(D))}
                    if pal:
                        meshes[gid]["pal"] = pal
                        meshes[gid]["art"] = nart
        m = meshes[gid]
        if m is None:
            skipped["empty"] += 1
            continue
        if cat in CATS_MC.values() and "pal" not in m:      # plain shape adds nothing for these
            skipped["plain_mc"] = skipped.get("plain_mc", 0) + 1
            continue
        name = std_name(r["name"])
        e = {"id": pid, "name": name, "cat": cat, **m}
        if name != r["name"]:
            e["orig"] = r["name"]
        if gid != pid:
            e["mesh"] = gid
        if kind != "exact":
            e["kind"] = kind
        if unf:
            e["unf"] = True
        parts.append(e)
    parts.sort(key=lambda p: (p["cat"], p["id"]))
    with open(os.path.join(OUT, "parts.json"), "w", encoding="utf8") as fh:
        json.dump(parts, fh, separators=(",", ":"))
    print(len(parts), "parts;", len(meshes), "meshes; skipped", skipped,
          "alt:", sum(p.get("kind") == "alt" for p in parts), "print:", sum(p.get("kind") == "print" for p in parts),
          "unofficial:", sum(bool(p.get("unf")) for p in parts))


main()
