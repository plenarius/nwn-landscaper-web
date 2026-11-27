// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The path check's routes in words: the Live button's state and the report's click counts.

/** The live check's [state, text, title] for the engine's `report`. A route too long for one click that shorter clicks
 *  complete (`routes.long`; older engines count it as failed) is not blocked: NWN gives up on a way much longer than going
 *  straight there, as from one end of a long descent to the other. */
export function liveState(report) {
    const { ok, total, long = 0 } = report.routes;
    // (Placeables whose models the engine lacks block nothing in its check: said, but no fault of the ground.)
    const missing = report.missing_models?.length ?? 0;
    const unchecked = missing
        ? ` Placeables of ${missing} model${missing > 1 ? 's' : ''} the engine doesn't have (the boxes) don't block paths in this check.`
        : '';
    const warnings = report.warnings || [];
    const failed = total - ok - long,
        others = warnings.length - warnings.filter(w => w.kind === 'failed_route').length;
    const tooLong = long
        ? ` ${long} more are too long for one click (NWN gives up when the way is about 20 tiles longer than going straight there) but get there in shorter clicks.`
        : '';
    if (failed)
        return [
            'bad',
            `${failed} blocked`,
            `${ok + long} of ${total} test routes reach their goal; red pillars mark where the ${failed} blocked ones stop.${unchecked}`,
        ];
    if (others)
        return [
            'warn',
            `${others} spot${others > 1 ? 's' : ''}`,
            `All ${total} test routes get there; orange pillars mark ${others} spot(s) to look at (Check paths explains).${tooLong}${unchecked}`,
        ];
    const state = missing ? 'warn' : 'ok';
    if (long) return [state, 'Paths OK', `${ok} of ${total} test routes work in one click.${tooLong}${unchecked}`];
    return [state, 'Paths OK', `All ${total} test routes work.${unchecked}`];
}

/** How many clicks routes too long for one click take, in words: "2", "2 or 3", "2 to 4". */
export function clickCount(clicks) {
    if (!clicks.length) return 'a few';
    const lo = Math.min(...clicks),
        hi = Math.max(...clicks);
    return lo === hi ? `${lo}` : hi === lo + 1 ? `${lo} or ${hi}` : `${lo} to ${hi}`;
}
