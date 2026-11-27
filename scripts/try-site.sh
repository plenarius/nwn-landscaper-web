#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
# SPDX-License-Identifier: MIT
#
# Makes the page that runs the Landscaper in a browser (the engine's docs/DESIGN-web-demo.md): this editor, the engine built for
# WebAssembly and the demo's texture pack, in one folder to serve as it is (the handbook site's `/try/`). Only listed files
# go in: the editor's own (index.html, sw.js, CHANGELOG.md, css/, js/, vendor/, try/), landscaper.wasm, and the pack's
# pictures that its pack.json names, each checked against its SHA-256. Anything else in the pack's folder stops it: nothing
# of the game's can reach the site by accident.
#
# Usage: scripts/try-site.sh OUT LANDSCAPER_WASM PACK_DIR
#   OUT              the folder to make (it must not exist, or be empty)
#   LANDSCAPER_WASM  the engine for the browser (landscaper-wasm.zip's landscaper.wasm, or scripts/build-wasm.sh's)
#   PACK_DIR         the demo texture pack (the engine's packs/demo: pack.json, pictures/, CREDITS.md)
set -euo pipefail
if (($# != 3)); then
    sed -n '/^# Usage/,/^set /p' "$0" | sed '$d' >&2
    exit 2
fi
# (The paths as given, from where it was started; then the editor's own files from its folder.)
out=$(realpath -m "$1") wasm=$(realpath -m "$2") pack=$(realpath -m "$3")
cd "$(dirname "$0")/.."
[[ -f "$wasm" ]] || { echo "no engine at $wasm" >&2; exit 1; }
[[ -f "$pack/pack.json" ]] || { echo "no pack.json in $pack" >&2; exit 1; }
if [[ -e "$out" && -n "$(ls -A "$out")" ]]; then
    echo "$out is not empty" >&2
    exit 1
fi
mkdir -p "$out/try/demo"

# The editor: the files git keeps of these, nothing else (no tests, docs or scripts). CHANGELOG.md: the version menu's notes.
git ls-files -z index.html sw.js LICENSE CHANGELOG.md css js vendor try | xargs -0 cp --parents -t "$out"

# The engine.
cp "$wasm" "$out/try/landscaper.wasm"

# The pack: pack.json, CREDITS.md, and each picture pack.json names with its SHA-256; any other file stops it.
python3 - "$pack" "$out/try/demo" << 'EOF'
import hashlib, json, pathlib, shutil, sys
pack, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
spec = json.loads((pack / "pack.json").read_text())
named = {t["file"]: t["sha256"] for t in spec["textures"]}
pictures = pack / "pictures"
for f in pictures.iterdir():
    if f.name not in named:
        sys.exit(f"{f}: not in pack.json, refused")
for name, sha in named.items():
    data = (pictures / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != sha:
        sys.exit(f"{name}: its SHA-256 isn't pack.json's")
    (out / name).write_bytes(data)
shutil.copy(pack / "pack.json", out / "pack.json")
shutil.copy(pack / "CREDITS.md", out / "CREDITS.md")
EOF

# What the page reads first (js/start.js): where the engine and the pack are, and their SHA-256 (the pack's decides when
# the browser builds its texture library again).
sha() { sha256sum "$1" | cut -d' ' -f1; }
cat > "$out/try/site.json" << EOF
{
    "engine": "landscaper.wasm",
    "engineSha256": "$(sha "$out/try/landscaper.wasm")",
    "pack": "demo/pack.json",
    "packSha256": "$(sha "$out/try/demo/pack.json")"
}
EOF
echo "$out: $(du -sh "$out" | cut -f1), $(find "$out" -type f | wc -l) files"
