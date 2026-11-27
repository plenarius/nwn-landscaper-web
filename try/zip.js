// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A zip of files made in the page (an export to download). The files are stored as they are: the zip is made and saved on the
// visitor's own machine, so compressing it would only cost time (about 1 s for an 8 by 8 area's haks).

const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});

/** The CRC-32 of `bytes`, as zip files take it. */
export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** A zip (a Blob) of `files`, [name, bytes] each; a name may have folders (`hak/area.hak`). */
export function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let at = 0;
    for (const [name, data] of files) {
        const crc = crc32(data);
        const n = enc.encode(name);
        // The fields the local header and the central directory share, from "version needed" to the name's length.
        const common = new DataView(new ArrayBuffer(26));
        common.setUint16(0, 20, true);
        common.setUint16(2, 0x0800, true); // (names in UTF-8)
        common.setUint16(8, 0x21, true); // 1980-01-01: a download of the same area is the same zip
        common.setUint32(10, crc, true);
        common.setUint32(14, data.length, true);
        common.setUint32(18, data.length, true);
        common.setUint16(22, n.length, true);
        const shared = new Uint8Array(common.buffer);
        const local = new Uint8Array(30);
        new DataView(local.buffer).setUint32(0, 0x04034b50, true);
        local.set(shared, 4);
        const dir = new Uint8Array(46);
        const d = new DataView(dir.buffer);
        d.setUint32(0, 0x02014b50, true);
        d.setUint16(4, 20, true);
        dir.set(shared, 6);
        d.setUint32(42, at, true);
        parts.push(local, n, data);
        central.push(dir, n);
        at += 30 + n.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, at, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
