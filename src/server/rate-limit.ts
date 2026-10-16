/*
 * A small fixed-window rate limiter for sign-in, sign-up and reset requests,
 * kept in memory. One service instance is the deployment model; a restart
 * clears it, which is acceptable for slowing down password guessing.
 */

const windows = new Map<string, { start: number; count: number }>();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        if (windows.size > 10_000) {
            for (const [k, v] of windows) {
                if (now - v.start >= windowMs) windows.delete(k);
            }
        }
        return true;
    }
    w.count += 1;
    return w.count <= limit;
}

export function resetRateLimitsForTests(): void {
    windows.clear();
}
