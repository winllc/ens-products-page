/*
 * The contact form's shape, shared by the prerendered page, the browser
 * script and the licensing service's endpoint that stores and forwards what
 * is sent: the topics a visitor can pick and how long each field may be.
 */

import { CONTACT_MESSAGE_LIMIT, contactTopics } from './products';

/** The topics in the order the form lists them; the service accepts no other. */
export const contactTopicList: readonly string[] = ['General inquiry', ...Object.values(contactTopics), 'IT services'];

/** Maximum length of each field, as the form's maxlength and the service's check. */
export const contactLimits = {
    name: 120,
    email: 200,
    organization: 160,
    phone: 40,
    message: CONTACT_MESSAGE_LIMIT,
} as const;

/**
 * The honeypot: a field people never see (hidden by CSS, off the tab order)
 * that form-filling bots fill anyway. A submission with it set is accepted
 * and dropped.
 */
export const CONTACT_HONEYPOT = 'website';

/** Where the service's endpoint lives; nginx proxies /api/licensing to it. */
export const CONTACT_ENDPOINT = '/api/licensing/contact';
