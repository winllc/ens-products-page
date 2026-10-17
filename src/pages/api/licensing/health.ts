import type { APIRoute } from 'astro';
import { db } from '../../../server/db';
import { signingKeys } from '../../../server/keys';

export const prerender = false;

/** For the container health check: the database answers and the signing keys load. */
export const GET: APIRoute = () => {
    db().prepare('SELECT 1').get();
    signingKeys();
    return new Response('ok\n', { headers: { 'Content-Type': 'text/plain' } });
};
