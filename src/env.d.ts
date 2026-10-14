/// <reference types="astro/client" />

declare namespace App {
    interface Locals {
        /** The signed-in account on licensing pages; null when signed out or on static pages. */
        account: import('./server/accounts').Account | null;
        /** The raw session token, for actions that keep this session and end the others. */
        sessionToken: string | null;
    }
}
