// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The report box over the view: what an export or a path check found, or why something failed.

import { $, el } from './dom.js';
import { clickCount } from './routes.js';

/** Shows what an export or a path check (`checkOnly`) found in the report box: `r` is the engine's report. */
export function showReport(r, checkOnly = false) {
    const failed = r.warnings.filter(w => w.kind === 'failed_route').length;
    const closed = r.warnings.filter(w => w.kind === 'closed_passage').length;
    const winding = r.warnings.length - failed - closed;
    // Routes too long for one click that shorter clicks complete (newer engines): no fault, said apart.
    const long = r.routes.long ?? 0,
        clicks = (r.long_routes ?? []).map(w => w.clicks);
    const level = failed ? 'bad' : r.warnings.length ? 'warn' : 'good';
    const explain = text =>
        el('details', {}, el('summary', { textContent: 'What this means' }), el('p', { className: 'note', textContent: text }));
    const p = (className, text) => el('p', { className, textContent: text });
    $('reportBody').replaceChildren(
        ...[
            el('h3', { textContent: checkOnly ? 'Path check' : `Exported ${r.name}` }),
            el('div', { className: `big ${level}`, textContent: `${r.routes.ok + long} of ${r.routes.total} routes work` }),
            p('', "NWN's pathfinding, simulated on random routes between places your ground joins."),
            ...(long
                ? [
                      p(
                          '',
                          `● ${long} of them ${long > 1 ? 'are' : 'is'} too long for one click: ${clickCount(clicks)} shorter clicks get there.`,
                      ),
                      explain(
                          `NWN's pathfinding gives up when the way is about 20 tiles (200 m) longer than going straight across the tiles between its ends, as from one end of a long descent to the other: a player who clicks that far walks a few metres and stops. Clicking part of the way, or walking with the keys, gets there; the ground is fine. Shorten the way (fewer or shorter halls) only if players should cross it in one click.`,
                      ),
                  ]
                : []),
            ...(failed
                ? [
                      p('bad', `● ${failed} route(s) stop short: red markers, where the walker stops.`),
                      explain(
                          `The ground joins the two ends, but NWN's pathfinding finds no way through, so a player clicking past there stops short. NWN only crosses from one 10 m tile to the next at a few fixed points on each tile edge, so the usual causes are a passage the tiles can't use (see closed passages), a steep step between tile heights, or a narrow way along a tile edge or corner. Widen or straighten the way there, soften the slope, or keep openings away from tile edges and corners (every 10 m on the grid).`,
                      ),
                  ]
                : []),
            ...(closed
                ? [
                      p('warn', `● ${closed} passage(s) closed: orange markers.`),
                      explain(
                          `Ground you can walk through, but no NWN tile layout can use it (a gap between obstacles at a tile corner, a strip along a tile edge), so the export made that bit unwalkable. Harmless where nobody needs to pass: a sliver beside a wall, a corner behind rocks. Where players should get through, move or widen the gap, away from tile corners and edges; if it cut a way off, routes through it show as red too.`,
                      ),
                  ]
                : []),
            ...(winding
                ? [
                      p('warn', `● ${winding} tile(s) too winding: orange markers.`),
                      explain(
                          `NWN searches inside each tile with a time limit. Ground that twists within one tile (U-bends, zigzags, many small pockets) can take too long, so creatures there sometimes give up or go the long way. Usually it still works; if creatures misbehave there, straighten or widen the passages in that tile.`,
                      ),
                  ]
                : []),
            p('', `Walkable ground kept: ${(100 * r.coverage).toFixed(1)}%`),
            ...(checkOnly
                ? [p('note', 'Nothing was exported: this only checks.')]
                : [
                      ...updated(r.updated, !!r.download),
                      r.added_to_module &&
                          el(
                              'p',
                              {},
                              'Added to module ',
                              el('b', { textContent: r.added_to_module.module }),
                              ` as area ${r.added_to_module.area}: link its entrances to the others there (Entrance tool, Leads to).`,
                          ),
                      r.download
                          ? el(
                                'p',
                                {},
                                'Downloaded ',
                                el('b', { textContent: r.download }),
                                ": its module goes in your NWN user folder's modules folder, its haks in hak (its README says where).",
                            )
                          : el(
                                'p',
                                {},
                                'Ready to play: ',
                                el('b', { textContent: r.name }),
                                ' is in your NWN modules list.',
                                el('br'),
                                el('code', { textContent: r.installed_module || r.module }),
                            ),
                      r.download &&
                          !r.shaders &&
                          p(
                              'warn',
                              "● Made without your game folder: the tiles' shaders are stand-ins, so the area doesn't draw right in the game. Export again to choose it.",
                          ),
                  ]),
        ].filter(Boolean),
    );
    $('report').hidden = false;
}

// What happened to a module that was already installed (and maybe built on): its paragraphs.
// `download`: the export is a download (the page in the browser), so no module of the visitor's own was changed on disk.
function updated(u, download = false) {
    if (!u) return [];
    const p = (className, text) => el('p', { className, textContent: text });
    const out = [
        p(
            '',
            `Updated your module: new ground, everything you placed kept (${u.objects} object${u.objects === 1 ? '' : 's'}` +
                (u.ground_known
                    ? `, ${u.moved} moved up or down with the ground).`
                    : `; the last ground wasn't found, so none were raised or lowered).`),
        ),
    ];
    if (u.outside.length) {
        const where = u.outside
            .slice(0, 5)
            .map(o => `${o.tag || '(no tag)'} at ${o.at[0].toFixed(0)}, ${o.at[1].toFixed(0)}`)
            .join('; ');
        out.push(p('warn', `● ${u.outside.length} now outside the area: ${where}${u.outside.length > 5 ? '…' : ''}`));
    }
    if (u.placeables_added || u.placeables_removed)
        out.push(
            p(
                '',
                `Placeables: ${u.placeables_added} added, ${u.placeables_removed} removed; the others moved where you put them, keeping what the toolset gave them.`,
            ),
        );
    if (u.doors_added) out.push(p('', `${u.doors_added} new entrance door(s) added: link their transitions in the toolset.`));
    out.push(
        p(
            '',
            u.atmosphere ? 'Light and fog: set from the editor.' : 'Light and fog: unchanged in the editor, so the module keeps its own.',
        ),
        !download && p('note', 'Close the module in the toolset before exporting, or saving there will overwrite this update.'),
    );
    return out;
}

/** A problem in the report box: `title` says what failed, `msg` why. */
export function showError(msg, title) {
    $('reportBody').replaceChildren(el('h3', { className: 'bad', textContent: title }), el('p', { textContent: msg }));
    $('report').hidden = false;
}

/** Wires the report box's close button. */
export function initReport() {
    $('reportClose').onclick = () => {
        $('report').hidden = true;
    };
}
