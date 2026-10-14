import type { APIRoute } from 'astro';
import { db } from '../../../server/db';
import { signingKey } from '../../../server/keys';

export const prerender = false;

/** For the container health check: the database answers and the signing key loads. */
export const GET: APIRoute = () => {
    db().prepare('SELECT 1').get();
    signingKey();
    return new Response('ok\n', { headers: { 'Content-Type': 'text/plain' } });
};
