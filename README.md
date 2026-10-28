# BrickPrint

Static site: find a missing LEGO piece (by set, part number, pasted link, or category), preview it in 3D,
download an STL generated in the browser, and get filament suggestions for a LEGO color.

- **Multi-color parts**: about a hundred parts (windows, signs, hinged and assembled parts) carry real multiple
  colors in their LDraw model. They show in color in the viewer and export as a multi-color 3MF
  (one material per color; the "main" color follows the LEGO color you pick). The plain STL stays one color.
- **Printed and sticker parts**: LDraw stores printed artwork as image textures, so these print as the plain shape;
  the part page shows the Rebrickable photo as a guide. Parts without a photo get a 3D render instead.
- **Names** are tidied from Rebrickable's (`2x4` becomes `2 x 4`, `w/` becomes `with`).

## Multi-color printing (Snapmaker U1 and other multi-material printers)

Parts that carry several colors in their LDraw model export as a 3MF with one base material per color. In
Snapmaker Orca or OrcaSlicer the colors can be mapped to your U1 filaments, so one print comes out in all its
colors. This export has not been tested in a slicer yet. Printed and sticker parts are plain shapes (see above).

## Run

```
python -m http.server 8765 --directory site
```
Open http://localhost:8765 (opening index.html as a file won't work: it fetches JSON).

## Rebuild the data

Download into one folder (`rb/` and `spool/` and `ldraw/`):
- Rebrickable CSVs (`sets, inventories, inventory_parts, parts, part_categories, colors, themes`) from https://rebrickable.com/downloads/
- LDraw `complete.zip` from https://library.ldraw.org/library/updates/complete.zip (extract to `ldraw/`)
- Optional: LDraw unofficial parts `ldrawunf.zip` from https://library.ldraw.org/library/unofficial/ldrawunf.zip (extract to `unf/`)
- Also needed from Rebrickable: `part_relationships.csv`
- SpoolmanDB `filaments/*.json` from https://github.com/Donkie/SpoolmanDB into `spool/`

```
python build/build_meshes.py <src> site/data
python build/build_data.py   <src> site/data
```

## Sources
See the Sources page in the site (`#/sources`) for licenses. LEGO® is a trademark of the LEGO Group; this is an unofficial fan project.
