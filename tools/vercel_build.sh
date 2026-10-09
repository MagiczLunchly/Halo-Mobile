#!/usr/bin/env bash
set -euo pipefail

# Cache the official compiler alongside Vercel's build cache.
sdk_dir="$PWD/.cache/emsdk"
if [ ! -f "$sdk_dir/emsdk.py" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$sdk_dir"
fi
python3 "$sdk_dir/emsdk.py" install 6.0.10
python3 "$sdk_dir/emsdk.py" activate 6.0.10
# Emscripten's environment setup can read optional unset variables.
set +u
source "$sdk_dir/emsdk_env.sh"
set -u

python3 configure.py --release
ninja -j 2 web
node --test port/web/tests/*.cjs
python3 tools/vercel_output.py
