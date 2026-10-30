/*
 * The artifacts in the compliance documentation pack. Filled in by the
 * content author; the service and the pages read it. Keep ids stable: they
 * appear in URLs, in the audit trail and in the admin's publish list.
 */

import type { ComplianceArtifact } from './types';

export const complianceArtifacts: readonly ComplianceArtifact[] = [];

export function artifact(id: string): ComplianceArtifact | undefined {
    return complianceArtifacts.find((a) => a.id === id);
}
