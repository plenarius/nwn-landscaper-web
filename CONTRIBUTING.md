# Contributing

Issues and pull requests are welcome. For a change to how areas are built, exported or checked, look at the engine,
[landscaper](https://github.com/plenarius/landscaper), too: most of that work happens there, and this page only shows it.

## Before a pull request

- Follow [STYLE.md](STYLE.md), the standard shared with the engine and nwn-bake. Its Rust sections (*Rust*, the Rust rows of
  *The checks*, `cargo-deny` and `cargo-about`) don't apply here: this repository has no Rust. The rest does, in particular
  *Writing*, *JavaScript, CSS and HTML* and *Licences and REUSE*.
- Run `scripts/check.sh` and `scripts/shared-files.sh`. They run the checks CI runs; [STYLE.md](STYLE.md#the-checks) lists the
  tools and how to install them.
- Keep the two rules in [README.md](README.md#development): data goes into the page as text, and every request to the engine
  goes through `api()`.
- Run the tests: `node --test 'tests/*.test.js'` (Node 24; CI runs them too). They cover what runs without the browser's
  drawing: the area, its undo and JSON, the save queue and the requests to the engine. A change to that logic comes with a
  test; for the rest, say in the pull request what you tried in the browser, against which engine.
- Don't change `STYLE.md` or the other shared files listed in it here alone: they are identical in every repository that
  follows it, and nwn-bake's copy is the master. `scripts/shared-files.sh` checks ours against nwn-bake's at the release
  pinned in `scripts/shared-files.sha256` (CI runs it with `--online`, which also checks the pins against nwn-bake). To take a
  new release's copies: `scripts/shared-files.sh --pin vX.Y.Z`.

By sending a pull request you agree to license your change under the MIT licence of this repository ([LICENSE](LICENSE)).

Report security problems privately: see [SECURITY.md](SECURITY.md).
