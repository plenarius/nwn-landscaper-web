CodeMirror 6 (MIT), bundled for the script editor with esbuild from `codemirror`, `@codemirror/lang-cpp`, `@codemirror/lint`,
`@codemirror/theme-one-dark`, `@codemirror/state` and `@codemirror/view`. The entry file re-exports `EditorView`, `keymap`,
`EditorState`, `basicSetup`, `cpp`, `setDiagnostics`, `lintGutter` and `oneDark`. Rebuild: `npm i` those packages, then
`esbuild entry.js --bundle --format=esm --minify --outfile=codemirror.js`.
