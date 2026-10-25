# BrickPrint

Static site: find a missing LEGO piece (by set, part number, pasted link, or category), preview it in 3D,
download an STL generated in the browser, and get filament suggestions for a LEGO color.

## Run

```
python -m http.server 8765 --directory site
```
Open http://localhost:8765 (opening index.html as a file won't work: it fetches JSON).

## Rebuild the data

Download into one folder (`rb/` and `spool/` and `ldraw/`):
- Rebrickable CSVs (`sets, inventories, inventory_parts, parts, part_categories, colors, themes`) from https://rebrickable.com/downloads/
- LDraw `complete.zip` from https://library.ldraw.org/library/updates/complete.zip (extract to `ldraw/`)
- SpoolmanDB `filaments/*.json` from https://github.com/Donkie/SpoolmanDB into `spool/`

```
python build/build_meshes.py <src> site/data
python build/build_data.py   <src> site/data
```

## Sources
See the Sources page in the site (`#/sources`) for licenses. LEGO® is a trademark of the LEGO Group; this is an unofficial fan project.
