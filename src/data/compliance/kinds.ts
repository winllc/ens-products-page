/*
 * How the pages name and order the kinds of artifact in the compliance
 * documentation pack. The kinds themselves are in types.ts (the contract
 * with the documents); this is presentation, so the product pages and the
 * licensing pages agree on it.
 */

import type { ArtifactKind, ControlStatus } from './types';

/** In the order the pages group them. */
export const artifactKinds: readonly ArtifactKind[] = ['nist-800-53', 'sbom', 'vulnerability-management', 'secure-development', 'supply-chain'];

export const artifactKindLabels: Readonly<Record<ArtifactKind, string>> = {
    'nist-800-53': 'NIST SP 800-53 control matrix',
    sbom: 'Software bill of materials',
    'vulnerability-management': 'Vulnerability management',
    'secure-development': 'Secure development',
    'supply-chain': 'Supply chain',
};

export const controlStatusLabels: Readonly<Record<ControlStatus, string>> = {
    implemented: 'Implemented',
    partial: 'Partial',
    planned: 'Planned',
    customer: 'Customer',
    inherited: 'Inherited',
    'not-applicable': 'Not applicable',
};
