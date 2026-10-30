/*
 * The compliance documentation pack: what the artifacts are, which products
 * they cover, and which files each one is made of.
 *
 * The documents themselves live under compliance/ at the repository root
 * (Markdown with front matter) and the NIST SP 800-53 control matrix in
 * src/data/compliance/controls.ts. The licensing service lists and serves
 * them to accounts an administrator has granted access, and to
 * administrators; the public product pages only say what is in the pack.
 *
 * Two agents fill this in at once (the service and pages on one side, the
 * documents and the control matrix on the other), so these types are the
 * contract between them: change them here first.
 */

import type { ProductId } from '../products';

/** What kind of artifact this is; the product pages group by it. */
export type ArtifactKind =
    | 'nist-800-53'
    | 'sbom'
    | 'vulnerability-management'
    | 'secure-development'
    | 'supply-chain';

/** One downloadable file of an artifact. */
export interface ArtifactFile {
    /** The file name offered for download, e.g. "vulnerability-management-policy.md". Letters, digits, dot, dash. */
    name: string;
    /** What it is, for the listing. */
    title: string;
    /** IANA media type served for the download. */
    contentType: string;
    /**
     * Where the bytes come from: a file under compliance/ (path relative to that directory), or one the
     * service generates from the control matrix or the manifest at request time.
     */
    source:
        | { kind: 'file'; path: string }
        | { kind: 'controls-csv' }
        | { kind: 'controls-json' }
        | { kind: 'manifest-json' };
}

export interface ComplianceArtifact {
    /** Stable id used in URLs and the audit trail; letters, digits and dashes. */
    id: string;
    kind: ArtifactKind;
    title: string;
    /** One or two sentences for the listing and the product pages. */
    summary: string;
    /** Which products it covers; 'all' for the suite-wide documents. */
    products: ProductId[] | 'all';
    /** Document version and the date it was last revised (ISO date). */
    version: string;
    date: string;
    files: ArtifactFile[];
}

/** The NIST SP 800-53 Rev. 5 control matrix: how each product meets, or does not meet, a control. */
export type ControlStatus =
    /** The product implements the control as described. */
    | 'implemented'
    /** The product implements part of it; the gap is named in the implementation text. */
    | 'partial'
    /** Not in the product today; on the roadmap, as the text says. */
    | 'planned'
    /** The operating organization meets it (their directory, their platform, their procedures). */
    | 'customer'
    /** Met by the platform the product runs on (Kubernetes, the host OS, the directory). */
    | 'inherited'
    /** Does not apply to application software of this kind. */
    | 'not-applicable';

export interface ControlImplementation {
    status: ControlStatus;
    /** How the control is met, or what is missing. Plain sentences, no marketing. */
    implementation: string;
    /** Where to look: repository paths, documentation URLs, CI workflow names. */
    evidence: string[];
    /** What the operating organization must do for the control to hold. */
    customerResponsibility?: string;
}

export interface Control {
    /** e.g. "AC-2" or "AU-9(2)". */
    id: string;
    /** Family code, e.g. "AC". */
    family: string;
    title: string;
    /** Per product; a product left out means the control row does not apply to it. */
    products: Partial<Record<ProductId, ControlImplementation>>;
}

export const CONTROL_FAMILIES: Readonly<Record<string, string>> = {
    AC: 'Access Control',
    AU: 'Audit and Accountability',
    CM: 'Configuration Management',
    CP: 'Contingency Planning',
    IA: 'Identification and Authentication',
    IR: 'Incident Response',
    MA: 'Maintenance',
    PL: 'Planning',
    RA: 'Risk Assessment',
    SA: 'System and Services Acquisition',
    SC: 'System and Communications Protection',
    SI: 'System and Information Integrity',
    SR: 'Supply Chain Risk Management',
};
