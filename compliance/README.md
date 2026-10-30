# Compliance documentation pack

The documents the licensing service offers to accounts an administrator has granted access, and
to administrators, under /account/compliance. The manifest in `src/data/compliance/manifest.ts`
lists them; the NIST SP 800-53 control matrix is `src/data/compliance/controls.ts`.

Every statement in these documents must be true of the code at the release they describe. They
are written from the repositories and the documentation site, not from intentions, and each
carries the version and date of its last revision.

## Contents

| Artifact id | Kind | Files |
|---|---|---|
| `nist-800-53-controls` | NIST SP 800-53 Rev. 5 control matrix | `nist-800-53/overview.md`; `nist-800-53-controls.csv` and `nist-800-53-controls.json`, generated from `src/data/compliance/controls.ts` |
| `sbom` | Software bills of materials | `sbom/README.md`; `sbom/generated/ens-products-page.spdx.json`, written at build (not committed) |
| `vulnerability-management-policy` | Vulnerability management policy | `vulnerability-management-policy.md` |
| `secure-software-development` | Secure software development evidence | `secure-development/ssdf-evidence.md`, `secure-development/cisa-attestation-crosswalk.md` |
| `software-supply-chain-security` | Software supply chain security | `supply-chain/software-supply-chain-security.md`; `compliance-manifest.json`, generated from the manifest |

## Conventions

- Markdown with front matter `title`, `version`, `date` (ISO) and `owner`; a one-paragraph scope,
  a "Document control" table (version, date, owner, review cycle, applies to), and an
  "Evidence index" at the end listing every repository path and URL cited.
- Evidence paths are repository-relative and prefixed with the repository name
  (`cert-alert: src/main/java/...`); documentation pages are cited by URL under
  `https://winllc.github.io/ens-apps-documentation/`.
- Status words in the matrix come only from `ControlStatus` in `src/data/compliance/types.ts`.
- Version 1.0 of every document was written against CertAlert `main` e21a31a, Directory Services
  Portal `main` 5b04576 (v0.0.5), ReadyRoom (`in-n-out-work`) `main` 84553c6 (v0.0.5), the RSA
  Operations Portal `main` 183b562 and the documentation site `master` ab820d1. Revise the
  "applies to" rows, the matrix and the version and date together at each major release.
