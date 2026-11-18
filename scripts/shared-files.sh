#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
# SPDX-License-Identifier: MIT
#
# Checks that the files STYLE.md shares word for word ("The checks": STYLE.md, scripts/check.sh and the tools' settings) are
# nwn-bake's copies at the release named in scripts/shared-files.sha256, where nwn-bake's copy is the master. The engine runs
# the same check in its tests (tests/nwn_bake_split.rs) against the nwn-bake release it builds with.
#
# This is a script of its own, not a step of scripts/check.sh, because check.sh is itself one of the shared files: a step
# only this repository needs can't go into it.
#
# Usage: scripts/shared-files.sh [--online | --pin TAG]
#   (none)     offline: each shared file's SHA-256 against the pinned list, and the same set of Vale styles
#   --online   also fetches nwn-bake's files at the pinned tag and checks that the list is theirs (set GITHUB_TOKEN to avoid
#              GitHub's rate limit)
#   --pin TAG  copies nwn-bake's shared files at TAG over ours and writes their SHA-256s to the list; then run the checks
# Exit status: 0 when the files match, 1 when they don't, 2 for a wrong option or a list that can't be read.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PINS=scripts/shared-files.sha256
REPO=plenarius/nwn-bake
# The shared files a web page's repository has (STYLE.md: in Rust workspaces also rustfmt.toml, deny.toml and about.toml).
FILES=(STYLE.md scripts/check.sh .editorconfig _typos.toml .vale.ini .markdownlint.jsonc lychee.toml)
VALE=.vale/styles/Plain

mode=offline
tag=
case "${1:-}" in
    '') ;;
    --online) mode=online ;;
    --pin)
        mode=pin
        tag=${2:-}
        [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "--pin needs a release tag such as v0.5.2" >&2; exit 2; }
        ;;
    *) echo "unknown option $1 (see the top of $0)" >&2; exit 2 ;;
esac

# GitHub: a file of nwn-bake at a tag, and the files of a folder there.
fetch() { curl -fsSL --retry 3 "https://raw.githubusercontent.com/$REPO/$1/$2"; }
folder() {
    local auth=()
    [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
    curl -fsSL --retry 3 "${auth[@]}" "https://api.github.com/repos/$REPO/contents/$2?ref=$1" |
        grep -oE '"path": *"[^"]+"' | cut -d'"' -f4 | sort
}
hash_of() { sha256sum "$1" | cut -d' ' -f1; }

if [[ $mode == pin ]]; then
    mapfile -t vale < <(folder "$tag" "$VALE")
    ((${#vale[@]})) || { echo "could not list $VALE in $REPO at $tag" >&2; exit 1; }
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    for f in "${FILES[@]}" "${vale[@]}"; do
        mkdir -p "$tmp/$(dirname "$f")"
        fetch "$tag" "$f" > "$tmp/$f" || { echo "could not fetch $f from $REPO at $tag" >&2; exit 1; }
    done
    # Our Vale styles that nwn-bake no longer has go; the rest are replaced by theirs.
    mapfile -t gone < <(comm -23 <(git ls-files "$VALE" | sort) <(printf '%s\n' "${vale[@]}"))
    ((${#gone[@]})) && git rm -q -- "${gone[@]}"
    {
        echo "# nwn-bake's copies of the files STYLE.md shares, at the release below, as scripts/shared-files.sh --pin wrote them."
        echo "# Change them only with that command (see the top of scripts/shared-files.sh)."
        echo "tag $tag"
        for f in "${FILES[@]}" "${vale[@]}"; do
            mkdir -p "$(dirname "$f")"
            /bin/cp -f "$tmp/$f" "$f"
            printf '%s  %s\n' "$(hash_of "$f")" "$f"
        done
    } >| "$PINS"
    echo "copied nwn-bake $tag's shared files and pinned them in $PINS: review the diff, then commit them together"
    exit 0
fi

[[ -r $PINS ]] || { echo "$PINS is missing" >&2; exit 2; }
tag=$(sed -n 's/^tag \(v[0-9.]*\)$/\1/p' "$PINS")
[[ -n "$tag" ]] || { echo "$PINS names no tag" >&2; exit 2; }
declare -A pin=()
while read -r sum f; do
    [[ "$sum" =~ ^[0-9a-f]{64}$ ]] && pin[$f]=$sum
done < "$PINS"

failed=0
bad() { printf '   %s\n' "$1"; failed=1; }
echo "== shared files: ours against nwn-bake $tag's ($PINS)"
for f in "${FILES[@]}"; do [[ -n "${pin[$f]:-}" ]] || bad "$f is not in $PINS"; done
for f in "${!pin[@]}"; do
    if [[ ! -f "$f" ]]; then
        bad "$f is missing (nwn-bake has it)"
    elif [[ "$(hash_of "$f")" != "${pin[$f]}" ]]; then
        bad "$f differs from nwn-bake's: copy theirs (a shared file is changed in nwn-bake first)"
    fi
done
while IFS= read -r f; do
    [[ -n "${pin[$f]:-}" ]] || bad "$f is not one of nwn-bake's Vale styles"
done < <(git ls-files "$VALE")

if [[ $mode == online ]]; then
    echo "== the list against nwn-bake $tag on GitHub"
    mapfile -t vale < <(folder "$tag" "$VALE")
    if ((${#vale[@]} == 0)); then
        bad "could not list $VALE in $REPO at $tag"
    else
        for f in "${vale[@]}"; do [[ -n "${pin[$f]:-}" ]] || bad "nwn-bake $tag has $f; $PINS doesn't"; done
    fi
    for f in "${!pin[@]}"; do
        got=$(fetch "$tag" "$f" | sha256sum | cut -d' ' -f1) || { bad "could not fetch $f from $REPO at $tag"; continue; }
        [[ "$got" == "${pin[$f]}" ]] || bad "$PINS has a SHA-256 for $f that isn't nwn-bake $tag's"
    done
fi

if ((failed)); then
    echo "Shared files differ. To take nwn-bake's: scripts/shared-files.sh --pin <its release tag>"
    exit 1
fi
echo "   the same as nwn-bake $tag's"
