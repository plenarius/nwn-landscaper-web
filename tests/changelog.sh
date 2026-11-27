#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
# SPDX-License-Identifier: MIT
#
# Tests scripts/changelog.sh in a scratch folder: two fragments fold into a release's section, in the order of their names,
# above the entries `## Unreleased` had, their links made relative to CHANGELOG.md and markdownlint comments dropped, and none
# is left behind; and what `unreleased` and `check` do. CI runs it (check.yml).
# Usage: tests/changelog.sh   Exit status: 0 when every case passes.

set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unset GITHUB_BASE_REF
failed=0

# A scratch repository with the script, a changelog and two fragments (written out of order: b before a).
setup() {
    rm -rf "$tmp/r" && mkdir -p "$tmp/r/scripts" "$tmp/r/changelog.d"
    cp "$here/scripts/changelog.sh" "$tmp/r/scripts/"
    printf '{ "MD041": false }\n' > "$tmp/r/changelog.d/.markdownlint.jsonc"
    printf '%s\n' '<!-- markdownlint-disable-file MD041 -->' '- **Second.** From b.md,' '  over two lines.' '' \
        > "$tmp/r/changelog.d/b-second.md"
    printf '%s\n' '- **First.** From a.md ([docs](../docs/X.md)).' > "$tmp/r/changelog.d/a-first.md"
    printf '%s\n' "$@" > "$tmp/r/CHANGELOG.md"
}
expect() { # <case> <expected file content, one argument a line>
    local name=$1; shift
    if diff -u <(printf '%s\n' "$@") "$tmp/r/CHANGELOG.md"; then echo "ok   $name"; else echo "FAIL $name"; failed=1; fi
}
left() { # <case>: no fragment may be left; the folder's own settings stay
    local n
    n=$(find "$tmp/r/changelog.d" -name '*.md' | wc -l)
    if ((n == 0)) && [[ -f "$tmp/r/changelog.d/.markdownlint.jsonc" ]]; then echo "ok   $name: no fragment left"
    else echo "FAIL $name: $n fragment(s) left, or the folder's settings went"; failed=1; fi
}
run() { "$tmp/r/scripts/changelog.sh" "$@" > /dev/null 2>&1; }
first='- **First.** From a.md ([docs](docs/X.md)).' # a-first.md as folded: its link from CHANGELOG.md's folder

name="release, Unreleased with an entry"
setup '# Changelog' '' 'Intro.' '' '## Unreleased' '' '- **Old.** Already there.' '' '## 0.6.1' '' '- A fix.'
run release 0.7.0 || { echo "FAIL $name: exit status"; failed=1; }
expect "$name" '# Changelog' '' 'Intro.' '' '## 0.7.0' '' "$first" '- **Second.** From b.md,' '  over two lines.' \
    '- **Old.** Already there.' '' '## 0.6.1' '' '- A fix.'
left

name="release, no Unreleased"
setup '# Changelog' '' '## 0.6.1' '' '- A fix.'
run release 0.7.0 || { echo "FAIL $name: exit status"; failed=1; }
expect "$name" '# Changelog' '' '## 0.7.0' '' "$first" '- **Second.** From b.md,' '  over two lines.' '' \
    '## 0.6.1' '' '- A fix.'
left

name="release, the same twice"
setup '# Changelog' '' '## 0.6.1' '' '- A fix.'
run release 0.6.1 && { echo "FAIL $name: a second ## 0.6.1 was made"; failed=1; } || echo "ok   $name refused"

name="release, nothing to release"
setup '# Changelog' '' '## Unreleased' '' '## 0.6.1' '' '- A fix.'
rm "$tmp/r/changelog.d/"*.md
run release 0.7.0 && { echo "FAIL $name: made an empty section"; failed=1; } || echo "ok   $name refused"
expect "$name: unchanged" '# Changelog' '' '## Unreleased' '' '## 0.6.1' '' '- A fix.'

name="unreleased, an empty Unreleased"
setup '# Changelog' '' '## Unreleased' '' '## 0.6.1' '' '- A fix.'
run unreleased || { echo "FAIL $name: exit status"; failed=1; }
expect "$name" '# Changelog' '' '## Unreleased' '' "$first" '- **Second.** From b.md,' '  over two lines.' '' \
    '## 0.6.1' '' '- A fix.'
left

name="preview changes nothing"
setup '# Changelog' '' '## Unreleased' '' '## 0.6.1'
out=$("$tmp/r/scripts/changelog.sh" preview)
if [[ "$out" == $'## Unreleased\n\n- **First.** From a.md ([docs](docs/X.md)).\n- **Second.** From b.md,\n  over two lines.' ]] &&
    [[ -f "$tmp/r/changelog.d/a-first.md" ]]; then echo "ok   $name"; else echo "FAIL $name: $out"; failed=1; fi

name="check"
setup '# Changelog' '' '## Unreleased' '' '## 0.6.1'
run check && echo "ok   $name passes" || { echo "FAIL $name: fails a good folder"; failed=1; }
printf '%s\n' '## A heading' '- x' > "$tmp/r/changelog.d/c.md"
run check && { echo "FAIL $name: passes a fragment with a heading"; failed=1; } || echo "ok   $name: a heading fails"
setup '# Changelog' '' '## Unreleased' '' '## 0.6.1'
printf '%s\n' '- See [docs](docs/X.md).' > "$tmp/r/changelog.d/c.md"
run check && { echo "FAIL $name: passes a link from CHANGELOG.md's folder"; failed=1; } || echo "ok   $name: a link from the top fails"
setup '# Changelog' '' '## 0.6.1' '' '- A fix.'
run check && echo "ok   $name: entries wait without ## Unreleased" || { echo "FAIL $name: wants ## Unreleased"; failed=1; }

# In a pull request: a new fragment without a change under docs/ warns about the handbook, and still passes.
name="check, the handbook nudge"
setup '# Changelog' '' '## 0.6.1' '' '- A fix.'
nudge() { (cd "$tmp/r" && GITHUB_BASE_REF=master scripts/changelog.sh check 2>&1); }
git -C "$tmp/r" init -q && git -C "$tmp/r" add -A && git -C "$tmp/r" -c user.name=t -c user.email=t@invalid commit -qm base &&
    git -C "$tmp/r" update-ref refs/remotes/origin/master HEAD
printf '%s\n' '- **New.** A change.' > "$tmp/r/changelog.d/c-new.md"
git -C "$tmp/r" add -A && git -C "$tmp/r" -c user.name=t -c user.email=t@invalid commit -qm fragment
if out=$(nudge) && [[ "$out" == *"changes nothing under docs/"* ]]; then echo "ok   $name: warns, passes"
else echo "FAIL $name: $out"; failed=1; fi
mkdir -p "$tmp/r/docs" && printf '%s\n' '# Page' > "$tmp/r/docs/page.md"
git -C "$tmp/r" add -A && git -C "$tmp/r" -c user.name=t -c user.email=t@invalid commit -qm docs
if out=$(nudge) && [[ "$out" != *"changes nothing under docs/"* ]]; then echo "ok   $name: quiet with docs/"
else echo "FAIL $name: $out"; failed=1; fi

exit "$failed"
