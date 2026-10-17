/*
 * Imported by the built server's entry point (see the ens-audit-startup
 * integration in astro.config.mjs), so the audit outputs start, and
 * system.started is recorded, once per server process when it starts rather
 * than on the first request.
 */

import { startAudit } from './audit-outputs';

if (process.env.ASTRO_NODE_AUTOSTART !== 'disabled') {
    try {
        startAudit();
    } catch (err) {
        // The database or an output's settings are wrong: say so and stop,
        // rather than serve requests that can't be audited.
        process.stderr.write(`ens.audit: could not start: ${(err as Error).stack ?? err}\n`);
        process.exit(1);
    }
}
