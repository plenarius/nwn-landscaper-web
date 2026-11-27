// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The few files the engine reads from a game install, made here with none of the game's content (the engine's
// docs/DESIGN-web-demo.md, "What needs the game"): an empty key and talk table, empty palettes, one lighting scheme.

import { Directory, File } from '../vendor/browser_wasi_shim/index.js';

const enc = new TextEncoder();
const u32 = (...v) => new Uint8Array(new Uint32Array(v).buffer);
const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
};

/** A palette (`.itp`, GFF) whose MAIN list is empty: what the module's custom palettes start from. */
export function emptyPalette() {
    // Header: the five sections' offsets and counts (one struct, one field, one label, no field data or indices, one list).
    const head = cat(enc.encode('ITP V3.2'), u32(56, 1, 68, 1, 80, 1, 96, 0, 96, 0, 96, 4));
    const struct = u32(0xffffffff, 0, 1); // the top struct: one field, field 0
    const field = u32(15, 0, 0); // a list, label 0, at list index 0
    const label = cat(enc.encode('MAIN'), new Uint8Array(12));
    return cat(head, struct, field, label, u32(0));
}

const PALETTES = ['creature', 'door', 'encounter', 'item', 'placeable', 'sound', 'store', 'trigger', 'waypoint'];

/** environment.2da: one day-and-night lighting scheme, the export's lighting when the area names none. */
export function environment() {
    const cols = [
        ['LABEL', 'Demo'],
        ['STRREF', '****'],
        ['DAYNIGHT', 'cycle'],
        ...['LIGHT_AMB', 'LIGHT_DIFF'].flatMap((k, i) =>
            ['RED', 'GREEN', 'BLUE'].map((c, j) => [`${k}_${c}`, [60, 60, 90, 230, 225, 210][i * 3 + j]]),
        ),
        ['LIGHT_SHADOWS', 1],
        ...['DARK_AMB', 'DARK_DIFF'].flatMap((k, i) =>
            ['RED', 'GREEN', 'BLUE'].map((c, j) => [`${k}_${c}`, [10, 10, 30, 80, 80, 140][i * 3 + j]]),
        ),
        ['DARK_SHADOWS', 1],
        ...['LIGHT_FOG', 'DARK_FOG'].flatMap((k, i) =>
            ['RED', 'GREEN', 'BLUE'].map((c, j) => [`${k}_${c}`, [120, 130, 150, 20, 20, 40][i * 3 + j]]),
        ),
        ['LIGHT_FOG', 10],
        ['DARK_FOG', 15],
        ...['MAIN1', 'MAIN2', 'SECONDARY'].flatMap(k => [1, 2, 3, 4].map(n => [`${k}_COLOR${n}`, 0])),
        ['WIND', 1],
        ['SNOW', 0],
        ['RAIN', 0],
        ['LIGHTNING', 0],
        ['SHADOW_ALPHA', 0.5],
    ];
    const text = `2DA V2.0\n\n${cols.map(c => c[0]).join('   ')}\n0 ${cols.map(c => c[1]).join('   ')}\n`;
    return enc.encode(text);
}

export const standIns = {
    /** The stand-in install: `data/nwn_base.key` with no files and `lang/en/data/dialog.tlk` with no strings, as /game's entries. */
    install() {
        const key = cat(enc.encode('KEY V1  '), u32(0, 0, 64, 64, 126, 1), new Uint8Array(32));
        const tlk = cat(enc.encode('TLK V3.0'), u32(0, 0, 20));
        const dir = entries => new Directory(new Map(entries));
        return new Map([
            ['data', dir([['nwn_base.key', new File(key)]])],
            ['lang', dir([['en', dir([['data', dir([['dialog.tlk', new File(tlk)]])]])]])],
        ]);
    },
    /** What goes in the user folder's `override`: [name, bytes]. */
    override() {
        const palette = emptyPalette();
        return [...PALETTES.map(p => [`${p}pal.itp`, palette]), ['environment.2da', environment()]];
    },
};
