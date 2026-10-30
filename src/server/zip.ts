/*
 * A ZIP writer for the compliance documentation package: every entry stored
 * (no compression), which is all a pack of small text files needs, and no
 * dependency beyond node:zlib's crc32. Names are UTF-8 (general purpose bit
 * 11), times are the entry's own or now, and the whole archive is built in
 * memory: the pack is a few hundred kilobytes.
 *
 * Layout (PKWARE APPNOTE 4.4): for each entry a local file header and its
 * bytes, then the central directory with one header per entry, then the end
 * of central directory record. No ZIP64: nothing here approaches 4 GB.
 */

import { crc32 } from 'node:zlib';

export interface ZipEntry {
    /** Path inside the archive, with forward slashes. */
    name: string;
    data: Buffer | string;
    /** Modification time written to the entry; defaults to now. */
    date?: Date;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const VERSION = 20; // 2.0: enough for stored entries
const UTF8_NAMES = 1 << 11;

/** MS-DOS date and time, as ZIP stores them (two-second resolution, 1980 and later). */
function dosDateTime(d: Date): { date: number; time: number } {
    const year = Math.max(1980, d.getUTCFullYear());
    const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
    return { date, time };
}

export function zip(entries: ZipEntry[]): Buffer {
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
        const name = Buffer.from(e.name, 'utf8');
        const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
        const crc = crc32(data);
        const { date, time } = dosDateTime(e.date ?? new Date());

        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL_HEADER, 0);
        local.writeUInt16LE(VERSION, 4);
        local.writeUInt16LE(UTF8_NAMES, 6);
        local.writeUInt16LE(0, 8); // stored
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        parts.push(local, name, data);

        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(CENTRAL_HEADER, 0);
        dir.writeUInt16LE(VERSION, 4);
        dir.writeUInt16LE(VERSION, 6);
        dir.writeUInt16LE(UTF8_NAMES, 8);
        dir.writeUInt16LE(0, 10);
        dir.writeUInt16LE(time, 12);
        dir.writeUInt16LE(date, 14);
        dir.writeUInt32LE(crc, 16);
        dir.writeUInt32LE(data.length, 20);
        dir.writeUInt32LE(data.length, 24);
        dir.writeUInt16LE(name.length, 28);
        dir.writeUInt16LE(0, 30); // extra
        dir.writeUInt16LE(0, 32); // comment
        dir.writeUInt16LE(0, 34); // disk
        dir.writeUInt16LE(0, 36); // internal attributes
        dir.writeUInt32LE(0, 38); // external attributes
        dir.writeUInt32LE(offset, 42);
        central.push(dir, name);

        offset += local.length + name.length + data.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_RECORD, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...parts, directory, end]);
}
