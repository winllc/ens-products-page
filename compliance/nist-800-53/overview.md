---
title: "NIST SP 800-53 Rev. 5 control matrix: how to read it"
version: "1.0"
date: "2026-10-30"
owner: "ENS Solutions, LLC"
---

# NIST SP 800-53 Rev. 5 control matrix: how to read it

This document accompanies the control matrix ENS Solutions publishes for its four self-hosted applications: CertAlert, the Directory Services Portal, ReadyRoom and the RSA Operations Portal. The matrix states, control by control and product by product, what the software does, what it does not do, and what the operating organization has to do for the control to hold. It was written from the application source code, the continuous-integration workflows and the public documentation site at the revisions in the table below, and every row points at the files or pages a reviewer can open to confirm it. It is an input to a customer's system security plan, not a substitute for one, and it is not an authorization, certification or third-party assessment.

## Document control

| Item | Value |
|---|---|
| Version | 1.0 |
| Date | 2026-10-30 |
| Owner | ENS Solutions, LLC |
| Review cycle | Annual, and at each major release of any product |
| Applies to | CertAlert, `main` at e21a31a (after v0.0.2); Directory Services Portal, `main` at 5b04576 (v0.0.5); ReadyRoom (repository `in-n-out-work`), `main` at 84553c6 (v0.0.5); RSA Operations Portal, `main` at 183b562 (after v0.0.1); documentation site `master` at ab820d1 |

## What the matrix is

The matrix has 81 controls from 13 families of the NIST SP 800-53 Revision 5 moderate baseline: AC (12), AU (10), CM (6), CP (3), IA (8), IR (3), MA (2), PL (3), RA (2), SA (7), SC (10), SI (10) and SR (5). These are the families application software can affect. Controls that belong wholly to the organization (awareness and training, personnel security, physical protection, media protection, most of planning and program management) are left out, not because they do not apply to a deployment but because nothing in the software bears on them.

Each control has one row per product (IA-3, device authentication, has rows only for ReadyRoom and the RSA Operations Portal, the two products that authenticate something other than a person). A row carries four things:

- **Status**: one word from the vocabulary below.
- **Implementation**: plain sentences on how the control is met or what is missing. Settings are named as they appear in the documentation (`ENS_SESSION_IDLE_TIMEOUT`, `rsa.rate-limit.*`), defaults are stated, and where the default is not the hardened value the row says so.
- **Evidence**: repository paths, prefixed with the repository name (`cert-alert: src/main/java/com/winllc/certalert/security/ReadOnlyRoleFilter.java`), CI workflow files, and documentation URLs under `https://winllc.github.io/ens-apps-documentation/`. A path such as `README.md (section "Releases")` names a heading in that file.
- **Customer responsibility**: what the operating organization must do, when the control depends on it.

The CSV has one line per control and product; the JSON keeps the nested structure and suits a tool.

## The status vocabulary

| Status | Meaning |
|---|---|
| `implemented` | The product implements the control as the row describes, at the revision named above. |
| `partial` | The product implements part of the control; the gap is named in the implementation text. A control is also `partial` when the product does its part but a written ENS process the control expects does not yet exist. |
| `planned` | Not in the product today and on the roadmap. No row in this version uses it: nothing is claimed on the strength of a plan. |
| `customer` | The operating organization meets the control through its directory, platform, procedures or policy. The row says what the software provides to help. |
| `inherited` | The platform the product runs on meets the control: the Kubernetes or container runtime, the host operating system, the Java runtime, the database or the directory. |
| `not-applicable` | The control does not apply to application software of this kind, with the reason given. |

## Shared responsibility

ENS Solutions supplies the software: the container images, Helm charts and release packages, the documentation, the audit trail format, the vulnerability scanning and signing of what it ships, and the fixes. The customer supplies everything the software runs on and talks to, and the procedures around it:

| Layer | Who | Examples in the matrix |
|---|---|---|
| Application code and its defaults | ENS | Access enforcement, session limits, audit events, input validation, security headers, encryption of stored secrets, signed releases |
| Build and release pipeline | ENS | Trivy gate, CodeQL, Dependabot, cosign signatures, SBOM attestations, SLSA provenance (CertAlert), GPG-signed checksums |
| Platform | Customer | Kubernetes or Podman host, network policy enablement, storage encryption, TLS termination and the cryptographic modules it uses, clock synchronisation, host patching |
| Directory and identity provider | Customer | Accounts, groups, password and lockout policy, multi-factor enforcement, PKI issuance and revocation, Authentication Manager roles |
| Database | Customer | PostgreSQL or MySQL availability, backups where the application's scripts are not used, encryption at rest, TLS |
| Procedures | Customer | Audit review, incident response, contingency plan, risk assessment, configuration approval, verification of releases before deployment |

A per-product DISA STIG settings table lists the settings that need a decision (the notice-and-consent banner, administrator idle timeout, concurrent sessions, revocation mode, Secure cookie, audit forwarding). Several are off by default on purpose; the matrix says so in each row rather than counting them as implemented.

## The baseline addressed

The matrix is written against the Rev. 5 moderate baseline, choosing in each family the controls the application layer can satisfy, weaken or support. Five enhancements have rows of their own because the software has something specific to say: AC-6(9), IA-2(1), SC-8(1), SC-28(1) and SI-7(1). Nothing in the matrix is specific to moderate except the selection; a high-baseline reviewer finds the same rows and the same gaps.

## Known gaps

Stated here so that a reviewer need not find them row by row.

**Suite-wide**

- **No FIPS 140-3 validated module from ENS.** The applications implement no cryptography of their own and rely on the Java runtime's providers (and OpenSSL, for the Directory Services Portal's nginx). On a RHEL host or OpenShift cluster in FIPS mode, Red Hat's OpenJDK switches to its FIPS providers and the applications need no setting; but no application has a CI job that runs it end to end in FIPS mode. The only FIPS-mode tests are the license library's. A license issued before ENS enabled ECDSA P-256 signing must be re-signed before a move to a FIPS host.
- **No third-party penetration test** has been performed or published for any product. What runs is ENS's own test suites, Trivy, CodeQL (three of four repositories) and axe-core.
- **Accessibility conformance reports are drafts.** Each repository holds a WCAG 2.1 AA self-audit and a draft VPAT 2.5 report that has not been validated with assistive technology. Builds fail on serious or critical axe-core violations; no product claims conformance.
- **No written ENS secure-development standard, supply chain risk management plan or customer security-advisory channel** exists beyond the documents in this pack and the trust and support pages. The SA-15, SR-2 and SI-5 rows are `partial` for that reason.
- **Repository protections are not visible in the code.** Whether branch protection, required reviews and multi-factor authentication are enforced on the GitHub organization is a setting ENS confirms separately; the matrix does not claim it.
- **GPG signing of release checksums is optional** in every pipeline: `SHA256SUMS.asc` exists only when the signing key is configured on the repository, and no public key fingerprint is published yet. Cosign signatures and SBOM attestations do not depend on that key.
- **Hash-chained, not signed.** The audit trail proves tampering, not origin (AU-10 is `partial`).

**CertAlert**

- Three accepted CVEs in `.trivyignore` (pcre2 in the UBI 9 runtime base image), each with a justification and an expiry of 2026-11-17, after which the build fails until the base image is rebuilt.
- `cert-alert.revocation.allow-unverified-crl` defaults to `true`; the STIG table says to set it `false` once `issuer-directory` is populated.
- The API rate limiter counts per replica.
- The directory-password sign-in path is single-factor unless disabled or fronted by an identity provider that enforces MFA.

**Directory Services Portal**

- One LDAP server, no failover in the product.
- The tested-directory matrix on the install page says which directory servers are tested; OpenLDAP, 389-DS and Active Directory are marked not tested in CI.
- No password change, reset or approval workflow; every write applies at once.

**ReadyRoom**

- The Windows agent's PowerShell scripts are not code-signed and there is no MSI; the agent has not been penetration-tested.
- The repository's earlier development CA ("WINLLC DEV CA") had its private keys published; the security page says it must not be trusted anywhere.
- The consent banner and, before this release, revocation checking were off by default; revocation now defaults to `ocsp-then-crl` soft-fail, and a STIG deployment must set the mode explicitly with `ENS_X509_REVOCATION_FAIL=closed`.
- Scale beyond about 5,000 tracked people is unproven.

**RSA Operations Portal**

- The Connector runs Spring Framework 3.2.18, Spring Security 3.2.10, log4j 1 and Axis 1.4 on Tomcat 9 because the RSA Authentication Manager SDK (am-client 8.8) requires them. Twenty-three CVEs are accepted in `.trivyignore`, each with a written justification and an expiry of 2027-04-18; the compensating controls are mutual TLS and a shared secret in front of the Connector, a Hessian endpoint that rebuilds only allow-listed classes, a JEP 290 filter on Authentication Manager's replies, and a NetworkPolicy that admits only the Portal. The vulnerability management policy in this pack uses this as its worked example.
- The Connector runs as a single replica by design (the chart refuses more), so its restart time is the deployment's recovery time for sign-ins.
- No CodeQL workflow in this repository.
- The hardened Connector path has been tested against the mock Authentication Manager in CI, not against a production Authentication Manager.
- SMTP in the templates is port 25 without TLS; webhooks cannot use an egress proxy; the Portal does no CAC sign-in of its own.

## How to request evidence

The matrix and this pack are available to accounts an ENS administrator has authorized, from the account's compliance page on the licensing portal. For anything the rows point at:

1. **Source files and workflows**: in the product repositories at the revisions named above; where the agreement does not include source access, ask ENS for the file or an engineer walk-through.
2. **Documentation pages**: public at `https://winllc.github.io/ens-apps-documentation/`.
3. **Release artifacts** (SBOMs, signatures, attestations, checksums): with every release on the Downloads page; verification commands are in the supply-chain document of this pack.
4. **Test and scan outputs** and the **draft accessibility conformance reports**: on request, for a named release.

Send requests through the product site's contact page or the support address, naming the product, release and control ids. Security vulnerabilities go to the disclosure address in `/.well-known/security.txt`.

## Evidence index

- Repositories, at the revisions in the document control table: `cert-alert`, `directory-services-portal`, `in-n-out-work` (ReadyRoom) and `rsa-operations-portal`, each cited by path in the matrix rows: the security, audit, session, SSO, X.509, API, webhook and license packages under `src/main/java`, `.github/workflows/ci.yml` and `codeql.yml`, `.github/dependabot.yml`, `.trivyignore`, the Dockerfiles, the Helm charts under `deploy/helm/`, the release packages under `deploy/`, and `docs/accessibility/`.
- `ens-products-page`: `public/.well-known/security.txt`, `src/pages/trust.astro`, `src/pages/support.astro`, `src/data/pricing.ts`, `src/data/compliance/controls.ts`.
- `ens-apps-documentation`: `tools/audit/verify_chain.py`, `tools/splunk/TA-ens-audit`.
- Documentation site, `https://winllc.github.io/ens-apps-documentation/`: `audit-logging/`, `fips-and-stig/`, `releases/`, `licensing/`, `availability-and-sizing/`, and each product's `security/`, `fips-and-stig/`, `single-sign-on/`, `availability-and-sizing/`, `operator-guide/`, `admin-guide/` and `accessibility/` pages.
