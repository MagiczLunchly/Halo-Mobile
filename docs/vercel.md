# Vercel deployment

Import this repository with the Other framework preset and the repository root
as the Root Directory. Leave Output Directory unset: the build writes Vercel's
Build Output API to `.vercel/output`.

`vercel.json` installs Python and Ninja. The build script installs official
Emscripten 6.0.10, compiles the game, runs the browser tests, and packages the
launcher with cross-origin isolation headers. No game data is included.

## Optional streamed maps

Set the Vercel environment variable `HALO_MAP_ORIGIN` to an HTTPS origin you
control, such as `https://maps.example.com`, then redeploy. The origin must serve:

- `/local-maps.json`: a manifest with a `files` array. Each entry has `name`,
  `size` (bytes), and `url` equal to `/downloaded-maps/<name>`.
- `/downloaded-maps/<name>`: map files supporting HTTP Range requests with
  status 206, Content-Range, and the requested bytes. Include `ui.map`.

Vercel proxies those two paths to the map origin so the existing launcher can
load maps through its own origin. The Play streamed maps button appears once
the manifest is available. Maps load on demand; downloading all maps for offline
use remains an explicit visitor action. Host only data you may distribute.

Without that variable, the launcher supports importing a visitor's own ISO/XISO
or maps folder. A missing map server does not prevent deployment.
