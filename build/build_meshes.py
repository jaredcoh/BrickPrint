"""Convert the chosen LDraw parts into compact binary meshes for the website.

Inputs  (downloaded separately, see build/README.md):
  Rebrickable CSV dumps  -> part list, categories
  LDraw complete.zip     -> geometry
Outputs:
  site/data/meshes/<part>.bin   header(3 x uint32: nv, ni, flags) + float32 xyz (mm)
                                [+ int8 xyz tolerance directions] + uint16/uint32 indices
  site/data/parts.json
"""
import csv, json, os, re, sys
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

TOP_STUDS = {"stud", "stud2", "stud-logo", "stud-logo2", "stud-logo3", "stud-logo4", "stud-logo5",
             "stud2-logo", "stud2-logo2", "stud2-logo3", "stud2-logo4", "stud2-logo5"}
TUBES = {"stud4"}

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
    """Return (V, D): n x 3 x 3 arrays in LDU, local space, CCW-wound; D = tolerance directions."""
    if path in cache:
        return cache[path]
    stem = os.path.splitext(os.path.basename(path))[0].lower()
    tris, dirs = [], []
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
                vals = list(map(float, p[2:14]))
                x, y, z, a, b, c, d, e, f, g, h, i = vals
                A = np.array([[a, b, c], [d, e, f], [g, h, i]])
                tr = np.array([x, y, z])
                sub = resolve(" ".join(p[14:]))
                inv = invert_next
                invert_next = False
                if sub is None:
                    continue
                V, D = flatten(sub)
                if len(V) == 0:
                    continue
                V2 = V @ A.T + tr
                D2 = D @ A.T
                n = np.linalg.norm(D2, axis=2, keepdims=True)
                D2 = np.divide(D2, n, out=np.zeros_like(D2), where=n > 1e-9)
                if (np.linalg.det(A) < 0) != inv:
                    V2 = V2[:, [0, 2, 1], :]
                    D2 = D2[:, [0, 2, 1], :]
                tris.append(V2)
                dirs.append(D2)
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
                invert_next = False
    if tris:
        V = np.concatenate(tris)
        D = np.concatenate(dirs)
    else:
        V = np.zeros((0, 3, 3))
        D = np.zeros((0, 3, 3))
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
    cache[path] = (V, D)
    return V, D


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


def write_mesh(pid, V, D):
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
    has_dir = bool(np.any(dd))
    flags = (1 if has_dir else 0) | (2 if len(pos) > 65535 else 0)
    buf = np.array([len(pos), len(idx), flags], dtype=np.uint32).tobytes()
    buf += pos.tobytes()
    if has_dir:
        buf += dd.tobytes()
    buf += idx.astype(np.uint32 if flags & 2 else np.uint16).tobytes()
    with open(os.path.join(OUT, "meshes", pid + ".bin"), "wb") as fh:
        fh.write(buf)
    size = flat.max(axis=0) - flat.min(axis=0)
    return [round(float(s), 2) for s in size], len(idx) // 3


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

    def in_scope(pid):
        cur = pid
        for _ in range(5):
            r = allparts.get(cur)
            if r and int(r["part_cat_id"]) in CATS:
                return CATS[int(r["part_cat_id"])]
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
            V, D = flatten(path)
            if len(V) == 0:
                meshes[gid] = None
            elif len(V) > MAX_TRIS:
                meshes[gid] = None
            else:
                title, author, lic = header(path)
                size, ntri = write_mesh(gid, V, D)
                meshes[gid] = {"ldraw_title": title, "author": author, "license": lic,
                               "size_mm": size, "tris": ntri, "tweak": bool(np.any(D))}
        m = meshes[gid]
        if m is None:
            skipped["empty"] += 1
            continue
        e = {"id": pid, "name": r["name"], "cat": cat, **m}
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
