"""Package the compiled launcher for Vercel's Build Output API."""
import json
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit


def output_config(map_origin=""):
    routes = [{"src": "/(.*)", "headers": {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
    }, "continue": True}, {
        "src": "/(?:sw\\.js|version\\.json|local-maps\\.json)",
        "headers": {"Cache-Control": "no-cache"}, "continue": True,
    }]
    if map_origin:
        parsed = urlsplit(map_origin)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ("", "/")):
            raise ValueError("HALO_MAP_ORIGIN must be an HTTPS origin without a path or credentials")
        origin = map_origin.rstrip("/")
        routes.extend([
            {"src": "/local-maps\\.json", "dest": origin + "/local-maps.json"},
            {"src": "/downloaded-maps/([a-z0-9_-]+\\.map)",
             "dest": origin + "/downloaded-maps/$1"},
        ])
    routes.append({"handle": "filesystem"})
    return {"version": 3, "routes": routes, "cache": [".cache/emsdk/**"]}


def main():
    config = output_config(os.environ.get("HALO_MAP_ORIGIN", "").strip())
    site = Path("build/web/site")
    for name in ("index.html", "halo.js", "halo.wasm"):
        file = site / name
        if not file.is_file() or not file.stat().st_size:
            raise RuntimeError(f"Missing compiled game asset: {file}")
    output = Path(".vercel/output")
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(site, output / "static", dirs_exist_ok=True)
    (output / "config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
