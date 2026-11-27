<!-- markdownlint-disable-file MD041 -->
- **The browser page starts without downloading its engine again.** The page keeps `landscaper.wasm` and the stock models it
  fetched in the browser's Cache Storage, named by their SHA-256 in `try/site.json`, and reads them from there on later
  visits; a release with a new engine or stock bundle fetches the new files and deletes the old ones. The engine is kept only
  when its SHA-256 matches. Firefox is no longer asked for persistent storage, which made it show a prompt.
