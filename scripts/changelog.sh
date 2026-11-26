#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
# SPDX-License-Identifier: MIT
#
# The changelog's entries waiting for a release are one file per change in changelog.d/ (any name ending in .md): the Markdown
# bullet(s) the change would have put under `## Unreleased`, with links to our own files relative to changelog.d/
# (`../docs/X.md`, which the fold makes `docs/X.md`). Two pull requests never write the same file, so they never conflict
# over CHANGELOG.md. This script folds them into CHANGELOG.md. The same script is in nwn-landscaper and nwn-landscaper-web.
#
# Usage: scripts/changelog.sh <command>
#   release X.Y.Z  the release's pull request: `## Unreleased` (if there is one) becomes `## X.Y.Z`, with every fragment at its
#                  top, and the fragments are deleted. Fails when there is nothing to release.
#   unreleased     folds the fragments into `## Unreleased` (made if missing) and deletes them, to read them in place
#   preview        prints `## Unreleased` as the fold would make it, and changes nothing
#   check          each fragment is a bullet list, and CHANGELOG.md starts with `## Unreleased` while fragments wait (builds
#                  between releases say +dev by that heading). In a pull request's CI (GITHUB_BASE_REF), warns when the pull
#                  request adds entries to CHANGELOG.md's `## Unreleased` instead of a fragment.
# Fragments fold in the order of their names (byte order), above the entries `## Unreleased` already has.
# Exit status: 0 when it worked or the check passed, 1 otherwise, 2 for a wrong command.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

LOG=CHANGELOG.md
DIR=changelog.d

die() { echo "changelog: $*" >&2; exit 1; }

# The fragment files, in the order they fold.
fragments() {
    local f
    for f in "$DIR"/*.md; do [[ -f "$f" ]] && printf '%s\n' "$f"; done | LC_ALL=C sort
}

# Every fragment's lines, one after the other: a single list, without a fragment's trailing blank lines, and its links to our
# own files made relative to CHANGELOG.md.
entries() {
    local f
    while IFS= read -r f; do
        sed -e 's/\r$//' -e 's/](\.\.\//](/g' "$f" |
            awk '/^[[:space:]]*$/ {blank++; next} {if (seen) for (; blank > 0; blank--) print ""; blank = 0; seen = 1; print}'
    done < <(fragments)
}

# CHANGELOG.md (stdin) with `$1` as the first `## ` section, `entries` (a file) at its top: the old `## Unreleased` renamed when
# there is one, else a new section above the first `## `.
fold() {
    awk -v head="## $1" -v file="$2" '
        BEGIN { while ((getline l < file) > 0) add = add l "\n" }
        function put() { print head; print ""; printf "%s", add; done = 1 }
        !done && /^## / {
            put()
            if (tolower($0) ~ /^## +unreleased *$/) { after = 1; next }
            if (add != "") print ""
            print; next
        }
        # The old section: its own entries follow ours in one list; anything else after a blank line.
        after && /^[[:space:]]*$/ { next }
        after { if (add != "" && $0 !~ /^- /) print ""; after = 0 }
        { print }
        END { if (!done) { print ""; put() } }'
}

# The lines of the `## Unreleased` section of a changelog (stdin), without its heading.
unreleased_section() { awk '/^## / {f = (tolower($0) ~ /^## +unreleased *$/); next} f'; }

# The first `## ` heading's text.
top() { awk '/^## / {sub(/^## +/, ""); sub(/ +$/, ""); print; exit}' "$LOG"; }

cmd=${1:-}
case "$cmd" in
    release | unreleased | preview)
        [[ -f "$LOG" ]] || die "no $LOG here"
        head=Unreleased
        if [[ $cmd == release ]]; then
            version=${2:-}
            [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "release needs a version such as 0.7.0" >&2; exit 2; }
            grep -qxF "## $version" "$LOG" && die "$LOG already has a ## $version section"
            head=$version
        fi
        tmp=$(mktemp -d)
        trap 'rm -rf "$tmp"' EXIT
        entries > "$tmp/entries"
        fold "$head" "$tmp/entries" < "$LOG" > "$tmp/log" || die "could not fold $LOG"
        if [[ $cmd == preview ]]; then
            echo "## Unreleased"
            unreleased_section < "$tmp/log"
            exit 0
        fi
        if [[ $cmd == release ]] && ! awk -v v="## $version" '$0 == v {f = 1; next} /^## / {f = 0} f && /^- /' "$tmp/log" | grep -q .; then
            die "nothing to release: no fragment in $DIR/ and no entry under ## Unreleased (add one, even 'No change to ...')"
        fi
        cat "$tmp/log" > "$LOG"
        mapfile -t folded < <(fragments)
        ((${#folded[@]})) && rm -- "${folded[@]}"
        echo "folded ${#folded[@]} fragment(s) into ## $head of $LOG"
        ;;
    check)
        bad=0
        while IFS= read -r f; do
            first=$(grep -m1 -v '^[[:space:]]*$' "$f")
            if [[ "$first" != "- "* ]]; then echo "$f: a fragment is the changelog's bullet list: start it with '- '" >&2; bad=1; fi
            if grep -q '^#' "$f"; then echo "$f: no headings in a fragment: the fold gives the section's" >&2; bad=1; fi
            if grep -qE '\]\(([^.#)h]|h[^t]|\.[^.])' "$f"; then
                echo "$f: a link to one of our files starts with ../ (from changelog.d/): '../docs/X.md'" >&2
                bad=1
            fi
        done < <(fragments)
        if [[ -n "$(fragments)" && "$(top)" != [Uu]nreleased ]]; then
            echo "$LOG: $DIR/ has entries, so $LOG must start with '## Unreleased' (a build between releases says +dev by it):" \
                "add that heading, empty, above '## $(top)'" >&2
            bad=1
        fi
        base=${GITHUB_BASE_REF:-}
        if [[ -n "$base" ]] && git rev-parse -q --verify "origin/$base" > /dev/null; then
            from=$(git merge-base HEAD "origin/$base")
            added=$(unreleased_section < "$LOG" | grep -vxFf <(git show "$from:$LOG" 2> /dev/null | unreleased_section) | grep -c '^- ')
            if ((added)); then
                echo "::warning file=$LOG::this pull request adds $added line(s) under ## Unreleased: put each entry in a file" \
                    "of its own in $DIR/ instead, so other pull requests don't conflict with it"
            fi
        fi
        exit "$bad"
        ;;
    *)
        echo "usage: scripts/changelog.sh release X.Y.Z | unreleased | preview | check (see the top of $0)" >&2
        exit 2
        ;;
esac
