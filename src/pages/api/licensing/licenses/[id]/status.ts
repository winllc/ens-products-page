/*
 * For applications that do have a network route: whether a license has been
 * revoked and what its latest revision is. Carries no customer details; the
 * license id itself is the only key, and it is unguessable.
 */
import type { APIRoute } from 'astro';
import { publicStatus } from '../../../../../server/licenses';

export const prerender = false;

export const GET: APIRoute = ({ params }) => {
    const id = params.id ?? '';
    const status = /^lic_[0-9a-f]{20}$/.test(id) ? publicStatus(id) : null;
    if (!status) {
        return Response.json({ error: 'not-found' }, { status: 404 });
    }
    return Response.json(status);
};
