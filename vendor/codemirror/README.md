# CodeMirror bundle

CodeMirror 6 (MIT), bundled into one file, `codemirror.js`, for the script editor (`js/scripts.js`). It is
[esbuild](https://esbuild.github.io/)'s output for the entry file below, unchanged.

```js
export { EditorView, keymap } from '@codemirror/view';
export { EditorState } from '@codemirror/state';
export { basicSetup } from 'codemirror';
export { cpp } from '@codemirror/lang-cpp';
export { setDiagnostics, lintGutter } from '@codemirror/lint';
export { oneDark } from '@codemirror/theme-one-dark';
```

## Versions

Bundled on 2026-10-28 with the latest release of each package on that day. Rebuilding with these versions gives a byte-identical
`codemirror.js` (checked on 2026-11-11).

| Package | Version | Licence |
| --- | --- | --- |
| esbuild (the bundler, not in the file) | 0.28.2 | MIT |
| `codemirror` | 6.0.2 | MIT |
| `@codemirror/view` | 6.43.15 | MIT |
| `@codemirror/state` | 6.7.6 | MIT |
| `@codemirror/lint` | 6.9.7 | MIT |
| `@codemirror/lang-cpp` | 6.0.3 | MIT |
| `@codemirror/theme-one-dark` | 6.1.3 | MIT |
| `@codemirror/autocomplete` | 6.20.4 | MIT |
| `@codemirror/commands` | 6.11.1 | MIT |
| `@codemirror/language` | 6.13.1 | MIT |
| `@codemirror/search` | 6.7.2 | MIT |
| `@lezer/common` | 1.5.4 | MIT |
| `@lezer/cpp` | 1.1.6 | MIT |
| `@lezer/highlight` | 1.2.5 | MIT |
| `@lezer/lr` | 1.4.11 | MIT |
| `@marijn/find-cluster-break` | 1.0.4 | MIT |
| `crelt` | 1.0.7 | MIT |
| `style-mod` | 4.1.4 | MIT |
| `w3c-keyname` | 2.2.8 | MIT |

All of them are by Marijn Haverbeke and others; `LICENSE` here is their common licence text.

## Rebuild

Save the entry file above as `entry.js` in an empty folder, then:

```bash
npm install --before 2026-10-28T23:59:00Z codemirror@6 @codemirror/view @codemirror/state @codemirror/lint \
    @codemirror/lang-cpp @codemirror/theme-one-dark esbuild
npx esbuild entry.js --bundle --format=esm --minify --outfile=codemirror.js
```

To update CodeMirror, drop `--before`, then change this file and the line in the top README in the same commit.
