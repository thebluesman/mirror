// v2 spike (W-C, D5): builds a static, offline HTML contact sheet from the
// screenshots d5-render-drive.mjs captured — Meshy vs. Hunyuan, same views,
// same in-app lighting, laid out for easy side-by-side eyeballing at C3.
// Not a build step; run once after d5-render-drive.mjs:
//   node spike-v2/d5-generate-contact-sheet.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = HERE + "d5-contact-sheets/";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

const VIEWS = ["view0", "view45", "view90", "view180", "top"];
const VIEW_LABELS = {
  view0: "view A (0°)",
  view45: "view B (45°)",
  view90: "view C (90°)",
  view180: "view D (180° — back-view stand-in)",
  top: "top-down",
};

const ITEMS = [
  { name: "water-cooler", title: "Water Cooler", hasMeshy: true },
  { name: "bookshelf", title: "Bookshelf", hasMeshy: true },
  { name: "sonderod-rug", title: "SONDEROD Rug", hasMeshy: true },
  { name: "table", title: "Dining Table (multi-view probe — Hunyuan only, no Meshy counterpart)", hasMeshy: false },
];

function itemPage(item) {
  const rows = item.hasMeshy ? ["meshy", "hunyuan"] : ["hunyuan"];
  const cells = rows
    .map((provider) => {
      const cols = VIEWS.map((v) => {
        const src = `../d5-render-screenshots/${item.name}/${provider}-${v}.png`;
        return `<td><img src="${src}" alt="${provider} ${v}"><div class="viewlabel">${VIEW_LABELS[v]}</div></td>`;
      }).join("\n");
      return `<tr><th>${provider === "meshy" ? "Meshy" : "Hunyuan3D (v3.1 Pro)"}</th>${cols}</tr>`;
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>D5 — ${item.title}</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #1b1b1b; color: #eee; margin: 2rem; }
  h1 { font-size: 1.2rem; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #444; padding: 6px; text-align: center; vertical-align: top; }
  th { background: #2a2a2a; writing-mode: horizontal-tb; min-width: 80px; }
  img { width: 220px; height: 165px; object-fit: cover; background: #000; display: block; }
  .viewlabel { font-size: 0.75rem; color: #aaa; margin-top: 2px; }
  a { color: #8cf; }
</style></head>
<body>
<h1>D5 — ${item.title}</h1>
<p><a href="./index.html">&larr; all items</a></p>
<table>
${cells}
</table>
</body></html>`;
}

function indexPage() {
  const links = ITEMS.map((i) => `<li><a href="./${i.name}.html">${i.title}</a></li>`).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>D5 contact sheets</title>
<style>body { font-family: -apple-system, sans-serif; background: #1b1b1b; color: #eee; margin: 2rem; } a { color: #8cf; }</style>
</head><body>
<h1>v2 spike D5 — Meshy vs. Hunyuan contact sheets</h1>
<p>Same item, same camera views, same in-app lighting (this app's real
buildScene() sun+hemisphere lights + PMREM/RoomEnvironment IBL, via
spike-v2/render-harness.ts) — not a fal/Hunyuan preview viewer. See
spike-v2/OUTCOME.md's D5 section for the full writeup, pricing, and the
multi-view coverage caveat before judging the table item.</p>
<ul>
${links}
</ul>
</body></html>`;
}

for (const item of ITEMS) {
  writeFileSync(OUT + item.name + ".html", itemPage(item));
}
writeFileSync(OUT + "index.html", indexPage());
console.log("wrote contact sheets to", OUT);
