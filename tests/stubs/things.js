// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Things tool, for the tests: only the class, which newbp.js adds the blueprint dialog to (the real one draws with three.js).

/** The Things tool: `ctx` is what app.js gives it. */
export class ThingsTool {
    constructor(ctx) {
        this.ctx = ctx;
    }
}
