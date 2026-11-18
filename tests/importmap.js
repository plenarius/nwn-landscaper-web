// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's import map (index.html) for the tests: the vendored packages the modules import by name (`'simplex-noise'`) resolve
// to the files the map names, as in the browser. Import this file first, then the page's modules with import(): the map applies
// only to modules loaded after it.

import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

const page = new URL('../index.html', import.meta.url);
const { imports } = JSON.parse(readFileSync(page, 'utf8').match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);

registerHooks({
    resolve(specifier, context, next) {
        // A name in the map, or under one of its folder prefixes (`three/addons/`).
        const key = Object.keys(imports).find(k => specifier === k || (k.endsWith('/') && specifier.startsWith(k)));
        if (!key) return next(specifier, context);
        return { url: new URL(imports[key] + specifier.slice(key.length), page).href, shortCircuit: true };
    },
});
