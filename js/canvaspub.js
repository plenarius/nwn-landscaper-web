// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What a canvas's Publish dialog shows and may send, from the engine's `/api/canvas-changes`: each piece's tick and reasons, the
// pieces it refuses (a stale export would send ground the builder no longer has), and the send's warnings as sentences.

/** A piece the dialog can't send: never exported into the canvas's module, or exported before the canvas changed. */
export const refusedWhy = p =>
    !p.exported ? 'never exported: export it first' : p.stale ? 'changed since its export: export again first' : '';

/** `p`'s reasons as one line: "new", "changed: …", or unchanged. */
export function whyText(p) {
    const why = p.why ?? [];
    if (!why.length) return p.published == null ? 'new' : 'unchanged since the last publish';
    if (why.some(w => w.kind === 'new')) return 'new';
    return why.map(w => w.text).join('; ');
}

/**
 * The dialog's rows from `changes` (`/api/canvas-changes`): `{ name, label, why, refused, ticked }` a piece. Ticked by default:
 * what the engine ticks, less what it would refuse. `label(name)` gives a piece's name in the game when it has one.
 */
export function publishRows(changes, label = n => n) {
    const ticked = new Set(changes.ticked ?? []);
    return (changes.pieces ?? []).map(p => {
        const refused = refusedWhy(p);
        return {
            name: p.name,
            label: label(p.name),
            why: whyText(p),
            moved: (p.why ?? []).some(w => w.kind === 'moved'),
            refused,
            ticked: !refused && ticked.has(p.name),
        };
    });
}

/** Which of `names` (the ticked pieces) `rows` refuses: the send waits until they are exported again. */
export const refusedOf = (rows, names) => rows.filter(r => r.refused && names.includes(r.name)).map(r => r.name);

/** The pieces "Send every piece" ticks: every one it may send. */
export const everyPiece = rows => rows.filter(r => !r.refused).map(r => r.name);

/** The send's warnings (`send_too`, `moved`, `removed`, `stale`, `left_out`) as `[level, text]`, each once. */
export function warningLines(warnings = []) {
    const seen = new Set();
    const out = [];
    for (const w of warnings) {
        const text =
            w.kind === 'send_too'
                ? `Send ${w.pieces.join(', ')} too: ${w.why}`
                : w.kind === 'left_out'
                  ? `Left out: ${w.pieces.join(', ')}. ${w.why ?? 'Crossings into them lead to the live copy.'}`
                  : w.why;
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push([w.kind === 'stale' ? 'error' : 'warn', text]);
    }
    return out;
}

/** The published pieces no longer on the canvas, as the dialog lists them. */
export const removedLines = (removed = []) =>
    removed.map(
        r => `${r.name}: no longer on the canvas${r.renamed ? ` (now ${r.renamed})` : ''}; the reviewer decides whether its area goes.`,
    );

/** A send's button: "Send 3 pieces for review". */
export const sendText = n => `Send ${n} piece${n === 1 ? '' : 's'} for review`;

/** The piece and its place in a canvas export job's label ("rivl: rivl02 (piece 2 of 3)"), and the export's share done so
 *  far with `f` of that piece done: `{ piece, k, n, overall }`, or null for another label. */
export function pieceOf(label, f = 0) {
    const m = /^[^:]+: (\S+) \(piece (\d+) of (\d+)\)/.exec(label ?? '');
    if (!m) return null;
    const k = +m[2],
        n = +m[3];
    return { piece: m[1], k, n, overall: Math.min(1, (k - 1 + Math.max(0, Math.min(1, f))) / n) };
}
