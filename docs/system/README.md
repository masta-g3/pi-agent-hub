# pi-agent-hub system atlas

This folder contains two synchronized views of the repository architecture.

| File | Role | Edit it? |
|---|---|---|
| `atlas/data.mjs` | Single source of truth for structures, flows, chapters, decisions, and questions | Yes |
| `atlas/template.html` | Interactive atlas renderer | Presentation only |
| `atlas/build.mjs` | Generates the HTML atlas and text twin | Presentation only |
| `atlas.html` | Self-contained interactive atlas | No; generated |
| `SYSTEM.md` | Complete text twin | No; generated |

## Rebuild

```bash
node docs/system/atlas/build.mjs
```

Edit only `atlas/data.mjs` for architecture content. Rebuild both outputs after every change. Do not hand-edit `atlas.html` or `SYSTEM.md`.

## View

Serve the repository root and open `/docs/system/atlas.html`:

```bash
uv run python -m http.server 8765
```
