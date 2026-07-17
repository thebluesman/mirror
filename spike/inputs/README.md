# Drop zone for spike 3 inputs

Put your files here with these exact names (any of .jpg/.jpeg/.png/.webp), then run
`node spike/run-spike3.mjs` from the repo root. Run it as often as you like — it only
does work whose input is present and whose output doesn't exist yet.

| Path | What | Needed for |
|---|---|---|
| `items/swivel-chair.jpg` | flat-lit product photo, front-3/4 (West Elm Cozy) | W-A generation (+FAL_KEY) |
| `items/shoe-cabinet.jpg` | IKEA STÄLL listing photo, front-on | W-A generation (+FAL_KEY) |
| `items/bookshelf.jpg` | your own photo (IMG_0455/2369/4263), front-on | W-A generation (+FAL_KEY) |
| `surfaces/wall.jpg` | straight-on, evenly lit wall photo | W-B (or use `--cc0`) |
| `surfaces/floor.jpg` | straight-on floor photo | W-B (or use `--cc0`) |
| `surfaces/ceiling.jpg` | ceiling photo | W-B (or use `--cc0`) |
| `reference/couch.jpg` | room photo from the couch-view camera position | C2 judgment (mandatory) |
| `reference/reverse.jpg` | room photo from the reverse-view camera position | C2 judgment (mandatory) |

Preferred-shot details per item: `spike/import/items.json` (notes field).
These files are yours and fine to commit — the generated outputs (GLBs, downloaded
texture sets) stay gitignored.
