/*
 * The NIST SP 800-53 Rev. 5 control matrix for the four products, written
 * from the application repositories and the documentation site at the
 * revisions named in compliance/nist-800-53/overview.md (CertAlert e21a31a,
 * Directory Services Portal 5b04576 / v0.0.5, ReadyRoom 84553c6 / v0.0.5,
 * RSA Operations Portal 183b562, documentation ab820d1). Every evidence
 * entry is a repository path (prefixed with the repository name) or a
 * documentation URL that a reader can open. The service renders this and
 * offers it as CSV and JSON.
 *
 * Status words come from ControlStatus in ./types. "customer" means the
 * operating organization meets the control; "inherited" means the platform
 * the product runs on does; "partial" names its gap in the text.
 */

import type { Control } from './types';

const DOCS = 'https://winllc.github.io/ens-apps-documentation';
const ca = (page: string): string => `${DOCS}/cert-alert/${page}/`;
const dsp = (page: string): string => `${DOCS}/directory-services-portal/${page}/`;
const rr = (page: string): string => `${DOCS}/readyroom/${page}/`;
const rsa = (page: string): string => `${DOCS}/rsa-operations-portal/${page}/`;
const suite = (page: string): string => `${DOCS}/${page}/`;

const CA = 'cert-alert: ';
const DSP = 'directory-services-portal: ';
const RR = 'in-n-out-work: ';
const RSA = 'rsa-operations-portal: ';

const CA_SEC = CA + 'src/main/java/com/winllc/certalert/security/';
const DSP_SRC = DSP + 'backend/src/main/java/com/winllc/dsp/';
const RR_SRC = RR + 'src/main/java/com/winllc/innoutwork/';
const RSA_SRC = RSA + 'rsaapp-portal/src/main/java/com/winllc/rsaapp/portal/';
const RSA_CONN = RSA + 'rsaapp-connector/src/main/java/com/winllc/rsaapp/connector/';

const CI = {
    ca: CA + '.github/workflows/ci.yml',
    dsp: DSP + '.github/workflows/ci.yml',
    rr: RR + '.github/workflows/ci.yml',
    rsa: RSA + '.github/workflows/ci.yml',
};

const AUDIT_DOC = suite('audit-logging');
const FIPS_DOC = suite('fips-and-stig');
const RELEASES_DOC = suite('releases');
const HA_DOC = suite('availability-and-sizing');

export const controls: readonly Control[] = [
    // ------------------------------------------------------------------ AC
    {
        id: 'AC-2',
        family: 'AC',
        title: 'Account Management',
        products: {
            certalert: {
                status: 'customer',
                implementation:
                    'CertAlert keeps no user database. Everyone who authenticates is a directory entry; the administrator and auditor roles come from directory groups (security.groups.admin, security.groups.auditor), from uid or DN lists, or from an identity provider\'s admin-groups and auditor-groups. Accounts are created, disabled and removed in the directory, and an API token is re-checked against its creator\'s live directory entry on every use.',
                evidence: [CA_SEC + 'DirectoryGroups.java', CA_SEC + 'AdminIdentifierCheck.java', CA + 'src/main/java/com/winllc/certalert/api/ApiTokens.java', ca('security'), ca('single-sign-on')],
                customerResponsibility: 'Manage accounts, group membership and disabling in the directory and the identity provider; review the admin and auditor groups.',
            },
            'directory-portal': {
                status: 'customer',
                implementation:
                    'The portal stores no accounts. People sign in against the directory; ROLE_ADMIN comes from ADMIN_USERS or ADMIN_GROUPS and is re-read every GROUP_REFRESH_INTERVAL (5 minutes), so a removed administrator loses the role within that interval and a deleted account\'s sessions end. API tokens act as their creator and are refused when the creator is disabled or locked.',
                evidence: [DSP_SRC + 'service/AuthService.java', DSP_SRC + 'integration/ApiTokenOwners.java', dsp('security'), dsp('admin-guide')],
                customerResponsibility: 'Manage accounts and groups in the directory; keep ADMIN_GROUPS small and controlled.',
            },
            readyroom: {
                status: 'customer',
                implementation:
                    'ReadyRoom has no local accounts. Users are directory entries loaded through AppUserDetailsService; USER, MANAGER and ADMIN come from directory groups, super-user-dns or an identity provider\'s groups through ENS_SSO_ROLE_MAPPING. API tokens act for their creating administrator with that person\'s roles and account status re-checked in the directory on every call.',
                evidence: [RR_SRC + 'security/AppUserDetailsService.java', RR_SRC + 'security/sso/RoleMapping.java', RR_SRC + 'api/ApiTokenService.java', rr('security'), rr('admin-guide')],
                customerResponsibility: 'Manage people, groups and managers in the directory; set super-user-dns to the real administrators only.',
            },
            'mfa-portal': {
                status: 'customer',
                implementation:
                    'Users are RSA Authentication Manager principals; the Portal keeps no accounts. The TRUSTED_AGENT, PMO and HELP_DESK roles are mapped from Authentication Manager administrative roles (role.mapped.N.*) or, with an identity provider configured, come only from its groups through ENS_SSO_ROLES_*. Integration API tokens are scoped and limited to named security domains.',
                evidence: [RSA_SRC + 'security/CustomAuthenticationProvider.java', RSA_SRC + 'sso/SsoSettings.java', RSA_SRC + 'api/ApiTokens.java', rsa('security'), rsa('rsa-integration')],
                customerResponsibility: 'Manage users, tokens and administrative roles in Authentication Manager and the identity provider.',
            },
        },
    },
    {
        id: 'AC-3',
        family: 'AC',
        title: 'Access Enforcement',
        products: {
            certalert: {
                status: 'implemented',
                implementation:
                    'Spring Security URL rules and role checks enforce the permissions matrix on the server: readers, points of contact, project administrators, auditors and administrators. Refusals answer 403 with a problem-detail body and are audited as access.denied. The UI hides controls a user cannot use but the server decides.',
                evidence: [CA_SEC + 'SecurityConfig.java', CA_SEC + 'ServerAccessPolicy.java', CA_SEC + 'ReadOnlyRoleFilter.java', ca('security')],
            },
            'directory-portal': {
                status: 'implemented',
                implementation:
                    'Access levels none, read and write per directory definition, enforced by PermissionService on every read and write; namespace confinement limits each operation to entries below the definition\'s base DN that match its filter; read-only (white pages) definitions can never be written through, administrators included. /api/admin/** needs ROLE_ADMIN.',
                evidence: [DSP_SRC + 'service/PermissionService.java', DSP_SRC + 'service/EntryService.java', DSP_SRC + 'config/SecurityConfig.java', dsp('security'), dsp('admin-guide')],
            },
            readyroom: {
                status: 'implemented',
                implementation:
                    'Method security (@PreAuthorize) on controllers and REST services, with AccessPolicy deciding whose data a page shows: the person, their directory manager, their group managers, their delegates and ADMIN. Nobody decides their own leave request. Coworker visibility is a configured policy applied in pages and the API alike.',
                evidence: [RR_SRC + 'security/AccessPolicy.java', RR_SRC + 'config/SecurityConfig.java', RR_SRC + 'security/CoworkerVisibility.java', rr('security')],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation:
                    'Method security is on and every controller carries @PreAuthorize rules; WebSecurityConfig backs them with URL rules. Every 403 is audited as access.denied with its reason (role, license, CSRF, demo). Operators\' Authentication Manager changes run in their own AM session, so AM enforces that operator\'s permissions as well.',
                evidence: [RSA_SRC + 'configuration/WebSecurityConfig.java', RSA_SRC + 'security/PageAccess.java', RSA_SRC + 'audit/AccessDeniedAudit.java', rsa('security')],
            },
        },
    },
    {
        id: 'AC-5',
        family: 'AC',
        title: 'Separation of Duties',
        products: {
            certalert: {
                status: 'partial',
                implementation:
                    'The auditor role reads everything an administrator reads and changes nothing, so review can be separated from administration. There is no approval step for administrative changes; separation beyond auditor and administrator is a matter of who is placed in which group.',
                evidence: [CA_SEC + 'ReadOnlyRoleFilter.java', ca('single-sign-on')],
                customerResponsibility: 'Assign the auditor and administrator groups to different people where policy requires it.',
            },
            'directory-portal': {
                status: 'partial',
                implementation:
                    'Permissions are granted per definition to users or groups, and self-service edits are limited to the fields and entries that match the signed-in user. There is no approval workflow: every write applies at once, so a second pair of eyes on privileged group changes has to be organised outside the portal.',
                evidence: [DSP_SRC + 'service/PermissionService.java', DSP_SRC + 'service/Memberships.java', dsp('security')],
                customerResponsibility: 'Grant write access to privileged definitions narrowly; add an approval step in your own procedures.',
            },
            readyroom: {
                status: 'implemented',
                implementation:
                    'A leave or absence request is decided by the person\'s directory manager, their delegates or an administrator, and nobody decides their own request, administrators included. Only ADMIN may download or erase someone else\'s data, and never their own.',
                evidence: [RR_SRC + 'service/Approvers.java', RR_SRC + 'security/AccessPolicy.java', rr('security')],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation:
                    'Help-desk changes to privileged users need dual control: a second operator with an approver role (rsa.helpdesk.dual-control.approver-roles) approves the request, never the requester or the account itself. Every help-desk change needs a ticket and a verified user, and the user is notified.',
                evidence: [RSA_SRC + 'helpdesk/HelpDeskService.java', RSA_SRC + 'helpdesk/PrivilegedUsers.java', RSA_SRC + 'helpdesk/HelpDeskSettings.java', rsa('help-desk')],
            },
        },
    },
    {
        id: 'AC-6',
        family: 'AC',
        title: 'Least Privilege',
        products: {
            certalert: {
                status: 'implemented',
                implementation:
                    'A read-only auditor role; contact editing limited to administrators by default (contact-editors: ADMIN); API tokens with scopes and an expiry that are never more than their creator and cannot manage tokens or webhooks; a directory service account that needs read access plus writes to exactly the attributes defined on the Admin page. The container runs as uid 185.',
                evidence: [CA_SEC + 'ReadOnlyRoleFilter.java', CA + 'src/main/java/com/winllc/certalert/api/ApiScope.java', CA + 'Dockerfile', ca('security')],
                customerResponsibility: 'Give the service account only the directory rights the security page lists; keep admin-identifiers short.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation:
                    'One least-privilege service account performs every directory operation, with the portal enforcing its own per-definition permissions on top. API tokens are scoped, expiring and optionally limited to some directories. Containers run as unprivileged users (uid 185 and 1001); the native package runs the API as the dsp user under a sandboxed systemd unit.',
                evidence: [DSP_SRC + 'integration/ApiScope.java', DSP + 'deploy/package/native/directory-services-portal.service', DSP + 'backend/Dockerfile', dsp('security')],
                customerResponsibility: 'Give the service account read access to the schema and exposed namespaces and write access only where portal users should edit.',
            },
            readyroom: {
                status: 'implemented',
                implementation:
                    'The MANAGER role alone shows nobody\'s details; visibility derives from directory relationships. The public API is read-only and token scopes are per endpoint. The directory bind account only needs to read. The container runs as uid 185 with a read-only root file system in the chart.',
                evidence: [RR_SRC + 'api/ApiScope.java', RR_SRC + 'api/ApiSecurityConfig.java', RR + 'deploy/helm/readyroom/values.yaml', rr('security')],
                customerResponsibility: 'Use a read-only bind account; set super-user-dns to the real administrators only.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation:
                    'The Connector\'s service account and the optional read-only account take custom least-privilege Authentication Manager roles rather than Super Admin, and operators\' changes run under their own AM roles. Integration API tokens carry seven scopes and can be limited to security domains. Secrets are split into files each service alone reads.',
                evidence: [rsa('rsa-integration'), RSA_SRC + 'api/ApiScope.java', RSA_SRC + 'api/DomainRestriction.java', RSA + 'util/file-owners.sh', rsa('security')],
                customerResponsibility: 'Create the custom AM roles the integration page describes and assign them to the service accounts.',
            },
        },
    },
    {
        id: 'AC-6(9)',
        family: 'AC',
        title: 'Least Privilege | Log Use of Privileged Functions',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Settings changes, token and webhook management, sync and clean-up jobs, exports, license changes and log-level changes are audited with the actor, in the ens-audit/1 trail.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditActions.java', CA + 'src/main/java/com/winllc/certalert/observability/AuditedLoggers.java', AUDIT_DOC],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Every change to definitions, permissions, entries, tokens and webhooks is audited with old and new values; a delete\'s audit record keeps every attribute.',
                evidence: [DSP_SRC + 'audit/AuditCatalog.java', DSP_SRC + 'audit/AuditLog.java', AUDIT_DOC],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Administrative actions (settings, group managers, delegates, permissions, exports, erasure, retention runs, license) are audited with the actor and client address.',
                evidence: [RR_SRC + 'audit/AuditActions.java', RR_SRC + 'audit/AuditService.java', AUDIT_DOC],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Every Authentication Manager change is recorded before it is made (am.change-attempt, fail closed) and after (am.change-outcome), with the operator, target, token serial, operation and AM account; help-desk requests, role changes, settings and exports are audited too.',
                evidence: [RSA_SRC + 'audit/AuditLog.java', RSA_SRC + 'audit/AuditActions.java', AUDIT_DOC],
            },
        },
    },
    {
        id: 'AC-7',
        family: 'AC',
        title: 'Unsuccessful Logon Attempts',
        products: {
            certalert: {
                status: 'customer',
                implementation: 'A password sign-in is an LDAP bind as the user, so the directory\'s lockout policy applies; CertAlert adds no lockout of its own. Repeated failures for one name are audited at alert severity.',
                evidence: [CA_SEC + 'DirectoryAuthenticationConfig.java', CA + 'src/main/java/com/winllc/certalert/audit/AuthenticationAudit.java', ca('fips-and-stig')],
                customerResponsibility: 'Set the lockout policy in the directory.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'LOGIN_MAX_FAILURES (default 8) failures per client address and user name within LOGIN_LOCKOUT_WINDOW (15 minutes) give HTTP 429 and an auth.lockout alert; with a shared database the counters are in dsp_login_failure across replicas. The directory\'s own lockout still applies to binds. DISA STIG guidance suggests 3 in 15 minutes.',
                evidence: [DSP_SRC + 'service/LoginThrottle.java', dsp('security'), dsp('fips-and-stig')],
            },
            readyroom: {
                status: 'customer',
                implementation: 'A password sign-in is a bind as the user, so the directory\'s lockout applies; ReadyRoom adds none of its own. Refused workstation logouts are rate-limited per client address.',
                evidence: [RR_SRC + 'security/AppUserDetailsService.java', RR_SRC + 'security/ClientRateLimiter.java', rr('fips-and-stig')],
                customerResponsibility: 'Set the lockout policy in the directory.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Authentication Manager\'s lockout policy applies to every passcode. In front of it the Portal rate-limits sign-in per client address and user ID in fixed windows kept in the database, and after three failures for a user ID applies a backoff of 30 seconds doubling to 15 minutes. The Portal does not lock accounts itself.',
                evidence: [RSA_SRC + 'ratelimit/RateLimitFilter.java', RSA_SRC + 'ratelimit/RateLimiter.java', rsa('security')],
                customerResponsibility: 'Set the lockout policy in Authentication Manager.',
            },
        },
    },
    {
        id: 'AC-8',
        family: 'AC',
        title: 'System Use Notification',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'With ENS_CONSENT_BANNER_ENABLED=true every browser session is sent to /consent before any sign-in filter runs, so no sign-in of any kind succeeds first; API calls get 401. The standard DoD text is the default and ENS_CONSENT_BANNER_FILE replaces it. Acknowledgement is audited as auth.consent-acknowledged. The banner is off by default.',
                evidence: [CA_SEC + 'ConsentFilter.java', CA_SEC + 'ConsentBanner.java', ca('security'), ca('fips-and-stig')],
                customerResponsibility: 'Set ENS_CONSENT_BANNER_ENABLED=true where a notice is required.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'With ENS_CONSENT_BANNER_ENABLED=true no sign-in of any kind succeeds until the browser session has acknowledged the banner (API answers 403 consent_required); the acknowledgement is audited. Off by default.',
                evidence: [DSP_SRC + 'service/ConsentService.java', dsp('security'), dsp('configuration')],
                customerResponsibility: 'Enable the banner where required.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'With ENS_CONSENT_BANNER_ENABLED=true the banner comes before any sign-in, enforced by the server; the workstation agent\'s /api/check/** calls are machine endpoints and are not held by it. Off by default.',
                evidence: [RR_SRC + 'security/ConsentFilter.java', RR_SRC + 'security/ConsentBanner.java', rr('security')],
                customerResponsibility: 'Enable the banner where required.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'With ENS_CONSENT_BANNER_ENABLED=true a browser session reaches only the banner until I agree is pressed: no page, sign-in or self-service step. Forms sent before it return to the banner and AJAX calls get 403. Off by default.',
                evidence: [RSA_SRC + 'security/ConsentBanner.java', rsa('security')],
                customerResponsibility: 'Enable the banner where required.',
            },
        },
    },
    {
        id: 'AC-10',
        family: 'AC',
        title: 'Concurrent Session Control',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'ENS_SESSION_MAX_PER_USER limits sessions per user; beyond it the oldest session ends and is audited as auth.session-expired with reason concurrent. Enforced across replicas with the JDBC session store. Default 0 (no limit); 3 is the suggested STIG value.',
                evidence: [CA_SEC + 'SessionPolicyFilter.java', CA_SEC + 'SessionPolicy.java', ca('security')],
                customerResponsibility: 'Set ENS_SESSION_MAX_PER_USER to your policy.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'ENS_SESSION_MAX_PER_USER ends the oldest session beyond the limit, across instances with the shared database. Default 0.',
                evidence: [DSP_SRC + 'config/SessionControlFilter.java', DSP_SRC + 'service/SessionService.java', dsp('security')],
                customerResponsibility: 'Set ENS_SESSION_MAX_PER_USER to your policy.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'ENS_SESSION_MAX_PER_USER ends the oldest session beyond the limit; each end is audited. Default 0.',
                evidence: [RR_SRC + 'security/SessionControlFilter.java', RR_SRC + 'security/SessionControls.java', rr('security')],
                customerResponsibility: 'Set ENS_SESSION_MAX_PER_USER to your policy.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'ENS_SESSION_MAX_PER_USER ends the oldest session beyond the limit, shared by every Portal replica through the JDBC session store. Default 0.',
                evidence: [RSA_SRC + 'security/SessionControls.java', RSA_SRC + 'session/SharedSessions.java', rsa('security')],
                customerResponsibility: 'Set ENS_SESSION_MAX_PER_USER to your policy.',
            },
        },
    },
    {
        id: 'AC-11',
        family: 'AC',
        title: 'Device Lock',
        products: {
            certalert: {
                status: 'partial',
                implementation: 'The application ends an idle session after ENS_SESSION_IDLE_TIMEOUT (30m) and ENS_SESSION_ADMIN_IDLE_TIMEOUT for administrators, sending the browser back to sign-in. Locking the device itself is the workstation\'s job.',
                evidence: [CA_SEC + 'SessionPolicyFilter.java', ca('fips-and-stig')],
                customerResponsibility: 'Enforce the screen lock on workstations.',
            },
            'directory-portal': {
                status: 'partial',
                implementation: 'Idle timeout (30m default, a shorter administrator value available); background polling does not keep a session alive. Device lock is the workstation\'s.',
                evidence: [DSP_SRC + 'config/SessionControlFilter.java', dsp('security')],
                customerResponsibility: 'Enforce the screen lock on workstations.',
            },
            readyroom: {
                status: 'partial',
                implementation: 'Idle and administrator idle timeouts end the web session. ReadyRoom records workstation lock and unlock events but does not enforce the lock.',
                evidence: [RR_SRC + 'security/SessionControlFilter.java', rr('security')],
                customerResponsibility: 'Enforce the screen lock on workstations.',
            },
            'mfa-portal': {
                status: 'partial',
                implementation: 'Idle and administrator idle timeouts end the Portal session. Device lock is the workstation\'s.',
                evidence: [RSA_SRC + 'security/SessionControls.java', RSA_SRC + 'session/IdleSessions.java', rsa('security')],
                customerResponsibility: 'Enforce the screen lock on workstations.',
            },
        },
    },
    {
        id: 'AC-12',
        family: 'AC',
        title: 'Session Termination',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Sessions end after the idle timeout, the absolute lifetime (ENS_SESSION_ABSOLUTE_TIMEOUT, 12h) or when the per-user limit is exceeded, each audited with its reason; Sign out invalidates the session and, with single sign-on, can end the provider\'s session (OIDC provider-logout, SAML single logout).',
                evidence: [CA_SEC + 'SessionPolicyFilter.java', CA_SEC + 'sso/SsoSignIn.java', ca('security'), ca('single-sign-on')],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Idle, absolute (12h) and concurrent limits end sessions, audited as auth.session-expired; the session is invalidated at sign-out and provider sign-out is available (SSO_OIDC_PROVIDER_LOGOUT, SSO_SAML_SINGLE_LOGOUT).',
                evidence: [DSP_SRC + 'config/SessionControlFilter.java', DSP_SRC + 'sso/SamlLogout.java', dsp('security'), dsp('single-sign-on')],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Idle, absolute (12h) and concurrent limits, each audited; single sign-out to the provider through a one-use continuation (ENS_SSO_OIDC_END_SESSION, ENS_SSO_SAML_SINGLE_LOGOUT). Certificate sessions have no sign-out entry because the browser would sign straight back in.',
                evidence: [RR_SRC + 'security/SessionControlFilter.java', RR_SRC + 'security/sso/SsoLogout.java', rr('security'), rr('single-sign-on')],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Idle, absolute (12h) and concurrent limits end sessions with an audited reason; /perform_logout deletes the cookie and logs the Authentication Manager session out; OIDC end-session and SAML single logout are available (off for upgraded installations, on in the new install templates).',
                evidence: [RSA_SRC + 'security/SessionControls.java', RSA_SRC + 'security/CustomLogoutSuccessHandler.java', RSA_SRC + 'sso/SsoLogout.java', rsa('security')],
            },
        },
    },
    {
        id: 'AC-14',
        family: 'AC',
        title: 'Permitted Actions Without Identification or Authentication',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'The public paths are listed and limited: the sign-in and consent pages, static files, health endpoints, the OpenAPI document and, on the management port, Prometheus. Everything else requires signing in.',
                evidence: [CA_SEC + 'SecurityConfig.java', ca('security')],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Unauthenticated access is limited to the sign-in flow, health on the management port and the OpenAPI document; the compose files never publish the API directly.',
                evidence: [DSP_SRC + 'config/SecurityConfig.java', dsp('security')],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'The documented open endpoints are the workstation check-out (which accepts only an unused, recent check-in sessionId), health, Prometheus on the management port, the sign-in, consent and error pages, static assets and the token-protected APIs.',
                evidence: [RR_SRC + 'config/SecurityConfig.java', rr('security')],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The public self-service steps (Test My Token, PIN reset, registration, exemption and appointment requests) are listed, rate-limited, and answer uniformly whatever the cause; everything else needs a signed-in user.',
                evidence: [RSA_SRC + 'configuration/WebSecurityConfig.java', RSA_SRC + 'ratelimit/UniformResponses.java', rsa('security')],
            },
        },
    },
    {
        id: 'AC-17',
        family: 'AC',
        title: 'Remote Access',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'All access is over HTTPS: CertAlert terminates TLS itself (TLS 1.2 and 1.3 only) or sits behind your proxy with X-Forwarded-Proto handling and a Secure cookie. The release package refuses plain HTTP on an interface other hosts reach unless CERT_ALERT_ALLOW_PLAIN_HTTP=true is set.',
                evidence: [CA + 'deploy/release/install.sh', CA + 'src/main/resources/application.yml', ca('security')],
                customerResponsibility: 'Terminate TLS at CertAlert or at a proxy you control; never set CERT_ALERT_ALLOW_PLAIN_HTTP outside a lab.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'The Docker package publishes plain HTTP on 127.0.0.1 only unless --https or --bind is given; the native package\'s nginx listens on 127.0.0.1:8080; TLS is served by nginx (mtls profile) or by your proxy.',
                evidence: [DSP + 'deploy/package/docker/install.sh', DSP + 'web/nginx/templates-mtls/default.conf.template', dsp('security')],
                customerResponsibility: 'Put TLS in front of the portal and set ENS_COOKIE_SECURE=true.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'ReadyRoom terminates TLS itself (SSL_ENABLED with your keystore and truststore; it refuses to start with TLS on and no stores) or runs behind a TLS proxy; the workstation agent validates the server certificate by default.',
                evidence: [RR + 'deploy/bundle/install.sh', RR_SRC + 'config/SslStoresCheck.java', rr('security')],
                customerResponsibility: 'Provide the keystore, truststore and CA; leave SkipCertificateCheck off on workstations.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Browsers reach the Portal over TLS it terminates (server.ssl.*) or through your ingress; the Portal-to-Connector hop is HTTPS with mutual TLS in new installations (util/connector-tls.sh, Helm connector.tls.mutual) plus a shared secret, and the Connector\'s plain HTTP health port binds to loopback.',
                evidence: [RSA + 'util/connector-tls.sh', RSA_CONN + 'security/ConnectorAuthFilter.java', RSA_CONN + 'security/MutualTlsCheck.java', rsa('security')],
                customerResponsibility: 'Configure TLS on 8443 or at the ingress; do not expose 8080 beyond the host.',
            },
        },
    },
    // ------------------------------------------------------------------ AU
    {
        id: 'AU-2',
        family: 'AU',
        title: 'Event Logging',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'The ens-audit/1 trail records sign-ins (success and failure, with the method and reason), every refused request, changes to settings, contacts, projects, tokens and webhooks with old and new values, the license, scheduled jobs, exports and the trail\'s own events.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditActions.java', CA + 'src/main/java/com/winllc/certalert/audit/AuditLog.java', AUDIT_DOC],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'The same ens-audit/1 categories: authentication (including lockout and consent), authorization denials, entry and configuration changes with old and new values, license, jobs, exports and audit events.',
                evidence: [DSP_SRC + 'audit/AuditCatalog.java', DSP_SRC + 'audit/AuditLog.java', AUDIT_DOC],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'The same ens-audit/1 categories, plus person.erased, data.purged for retention runs and the calendar request events.',
                evidence: [RR_SRC + 'audit/AuditActions.java', RR_SRC + 'audit/AuditService.java', AUDIT_DOC],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The same ens-audit/1 categories, plus am.change-attempt and am.change-outcome for every Authentication Manager change, the helpdesk.* request events, auth.rate-limited and auth.self-service-failed with the causes visitors are not told.',
                evidence: [RSA_SRC + 'audit/AuditActions.java', RSA_SRC + 'audit/AuditLog.java', AUDIT_DOC],
            },
        },
    },
    {
        id: 'AU-3',
        family: 'AU',
        title: 'Content of Audit Records',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Each event is one JSON object with id, sequence, UTC time, product, version, host, installation id, category, action, outcome, severity, actor (type, id, roles), source address and user agent, target, reason, details, request id, a hash of the session id, and the chain hashes. Secrets are recorded as [redacted].',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditRecord.java', CA + 'src/main/java/com/winllc/certalert/audit/AuditFormat.java', AUDIT_DOC],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'The same ens-audit/1 fields; password attributes are recorded as (redacted).',
                evidence: [DSP_SRC + 'audit/AuditEvent.java', DSP_SRC + 'audit/AuditJson.java', AUDIT_DOC],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'The same ens-audit/1 fields, with redaction of passwords, tokens, keys, session ids and codes.',
                evidence: [RR_SRC + 'audit/AuditEventRecord.java', RR_SRC + 'audit/AuditRedaction.java', AUDIT_DOC],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The same ens-audit/1 fields; PINs, tokencodes, passcodes and emergency codes are never recorded.',
                evidence: [RSA_SRC + 'audit/AuditRecord.java', RSA_SRC + 'audit/AuditRedactor.java', AUDIT_DOC],
            },
        },
    },
    {
        id: 'AU-5',
        family: 'AU',
        title: 'Response to Audit Logging Process Failures',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Events are stored first and forwarded by a background sender that queues when Splunk or syslog is unreachable; after 15 minutes of failed delivery an audit.delivery-failed alert is recorded and the audit page shows the backlog. The audit store has a health indicator.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditDeliveryService.java', CA + 'src/main/java/com/winllc/certalert/audit/AuditHealthIndicator.java', AUDIT_DOC],
                customerResponsibility: 'Alert on audit.delivery-failed events and on the store health indicator.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Store-first delivery with retry and an audit.delivery-failed alert after 15 minutes; the readiness probe fails when the audit log is not writable.',
                evidence: [DSP_SRC + 'audit/AuditDelivery.java', DSP_SRC + 'audit/AuditUnavailableException.java', AUDIT_DOC],
                customerResponsibility: 'Alert on audit.delivery-failed and the readiness probe.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Store-first delivery with retry, an audit.delivery-failed alert after 15 minutes, and an audit store health indicator.',
                evidence: [RR_SRC + 'audit/AuditForwarder.java', RR_SRC + 'audit/AuditStoreHealthIndicator.java', AUDIT_DOC],
                customerResponsibility: 'Alert on audit.delivery-failed events.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Store-first delivery with retry and the delivery-failed alert; in addition, a sign-in, role, settings or license change that cannot be audited does not happen, and an Authentication Manager change whose am.change-attempt cannot be committed is refused (fail closed).',
                evidence: [RSA_SRC + 'audit/AuditDelivery.java', RSA_SRC + 'audit/AuditLog.java', RSA_SRC + 'audit/AuditOrderException.java', AUDIT_DOC],
                customerResponsibility: 'Alert on audit.delivery-failed events.',
            },
        },
    },
    {
        id: 'AU-6',
        family: 'AU',
        title: 'Audit Record Review, Analysis, and Reporting',
        products: {
            certalert: {
                status: 'partial',
                implementation: 'The audit page filters by time, category, action, outcome, severity, user, target, address and free text, and the Splunk add-on maps events onto the CIM Authentication and Change data models. The review itself, and correlation with other systems, is the customer\'s procedure.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditAdminController.java', 'ens-apps-documentation: tools/splunk/TA-ens-audit', AUDIT_DOC],
                customerResponsibility: 'Review the trail on your schedule; forward it to your SIEM.',
            },
            'directory-portal': {
                status: 'partial',
                implementation: 'The same audit page, export and Splunk add-on; the review is the customer\'s procedure.',
                evidence: [DSP_SRC + 'web/AdminAuditController.java', DSP_SRC + 'audit/AuditSearch.java', AUDIT_DOC],
                customerResponsibility: 'Review the trail on your schedule; forward it to your SIEM.',
            },
            readyroom: {
                status: 'partial',
                implementation: 'The same audit page, export and Splunk add-on; the review is the customer\'s procedure.',
                evidence: [RR_SRC + 'audit/AuditController.java', RR_SRC + 'audit/AuditQueryService.java', AUDIT_DOC],
                customerResponsibility: 'Review the trail on your schedule; forward it to your SIEM.',
            },
            'mfa-portal': {
                status: 'partial',
                implementation: 'The same audit page (PMO), export and Splunk add-on; the review is the customer\'s procedure.',
                evidence: [RSA_SRC + 'audit/AuditAdminController.java', RSA_SRC + 'audit/AuditSearch.java', AUDIT_DOC],
                customerResponsibility: 'Review the trail on your schedule; forward it to your SIEM.',
            },
        },
    },
    {
        id: 'AU-7',
        family: 'AU',
        title: 'Audit Record Reduction and Report Generation',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'The current filter exports as CSV (formula-neutralised) or NDJSON; exports are themselves audited as audit.exported.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditAdminController.java', AUDIT_DOC],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Filtered CSV and NDJSON export from the audit page, audited; a search that stops at ENS_AUDIT_QUERY_MAX_SCAN says so.',
                evidence: [DSP_SRC + 'web/AdminAuditController.java', AUDIT_DOC],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Filtered CSV (formula-neutralised) and NDJSON export, audited.',
                evidence: [RR_SRC + 'audit/AuditCsv.java', RR_SRC + 'audit/AuditController.java', AUDIT_DOC],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Filtered CSV and NDJSON export, audited; a CSV value starting with =, +, -, @, a tab or a carriage return gets a leading apostrophe so a spreadsheet does not run it.',
                evidence: [RSA_SRC + 'audit/AuditAdminController.java', AUDIT_DOC],
            },
        },
    },
    {
        id: 'AU-8',
        family: 'AU',
        title: 'Time Stamps',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Every event carries time in UTC from the host clock, plus a gapless per-installation sequence number. Clock synchronisation (NTP) is the host\'s or cluster\'s.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditRecord.java', AUDIT_DOC],
                customerResponsibility: 'Synchronise host clocks with an authoritative time source.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'UTC time and a sequence number on every event; clock synchronisation is the host\'s.',
                evidence: [DSP_SRC + 'audit/AuditEvent.java', AUDIT_DOC],
                customerResponsibility: 'Synchronise host clocks with an authoritative time source.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'UTC time and a sequence number on every event; the server\'s clock must also be within 5 minutes of the domain controllers for Kerberos sign-in.',
                evidence: [RR_SRC + 'audit/AuditEventRecord.java', AUDIT_DOC, rr('security')],
                customerResponsibility: 'Synchronise host clocks with an authoritative time source.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'UTC time and a sequence number on every event; rate-limit windows are aligned to the UTC clock; Connector console lines are timestamped.',
                evidence: [RSA_SRC + 'audit/AuditRecord.java', RSA_CONN + 'logging/ConsoleLayout.java', AUDIT_DOC],
                customerResponsibility: 'Synchronise host clocks with an authoritative time source.',
            },
        },
    },
    {
        id: 'AU-9',
        family: 'AU',
        title: 'Protection of Audit Information',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Each event\'s SHA-256 hash covers the previous hash and its own JSON; Verify integrity recomputes the chain and reports where it breaks, and tools/audit/verify_chain.py checks an export independently. Only administrators and auditors open the audit page; pull-API tokens are read-only and stored as hashes. Nothing is removed unless a retention period is set, and only delivered events, with the removal audited.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditVerifier.java', CA + 'src/main/java/com/winllc/certalert/audit/AuditRetention.java', 'ens-apps-documentation: tools/audit/verify_chain.py', AUDIT_DOC],
                customerResponsibility: 'Protect the database and backups; forward the trail to a SIEM so a copy exists outside the application.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'The same hash chain, verification and retention rules, kept in monthly files (FileAuditStore) or in dsp_audit_event with a shared database.',
                evidence: [DSP_SRC + 'audit/AuditStore.java', DSP_SRC + 'audit/FileAuditStore.java', DSP_SRC + 'audit/JdbcAuditStore.java', AUDIT_DOC],
                customerResponsibility: 'Protect the data directory or database and its backups; forward the trail.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'The same hash chain, verification, read-only pull tokens and retention rules.',
                evidence: [RR_SRC + 'audit/AuditChainHead.java', RR_SRC + 'audit/AuditRetention.java', AUDIT_DOC],
                customerResponsibility: 'Protect the database and backups; forward the trail.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The same hash chain, verification (AuditVerifier), read-only pull tokens and retention rules.',
                evidence: [RSA_SRC + 'audit/AuditVerifier.java', RSA_SRC + 'audit/AuditRetention.java', AUDIT_DOC],
                customerResponsibility: 'Protect the database and backups; forward the trail.',
            },
        },
    },
    {
        id: 'AU-10',
        family: 'AU',
        title: 'Non-repudiation',
        products: {
            certalert: {
                status: 'partial',
                implementation: 'Every event names its actor, source address and a hash of the session, and the chain makes later alteration evident. Events are hash-chained, not digitally signed, so the trail proves tampering, not origin, to a third party.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditRecord.java', AUDIT_DOC],
            },
            'directory-portal': {
                status: 'partial',
                implementation: 'Actor, address and chain on every event; hash-chained, not signed.',
                evidence: [DSP_SRC + 'audit/AuditEvent.java', AUDIT_DOC],
            },
            readyroom: {
                status: 'partial',
                implementation: 'Actor, address and chain on every event; hash-chained, not signed.',
                evidence: [RR_SRC + 'audit/AuditEventRecord.java', AUDIT_DOC],
            },
            'mfa-portal': {
                status: 'partial',
                implementation: 'Actor, address and chain on every event, and Authentication Manager\'s own audit log names the operator because changes run in their own AM session; hash-chained, not signed.',
                evidence: [RSA_SRC + 'audit/AuditRecord.java', rsa('rsa-integration'), AUDIT_DOC],
            },
        },
    },
    {
        id: 'AU-11',
        family: 'AU',
        title: 'Audit Record Retention',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Nothing is removed by default. ENS_AUDIT_RETENTION_DAYS runs a daily job that removes only events every enabled output has delivered, never the newest, and records audit.pruned. CertAlert\'s older cert-alert.audit.retention.* settings apply while the suite setting is 0.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditRetention.java', AUDIT_DOC, ca('configuration')],
                customerResponsibility: 'Set the retention period to your policy; keep the SIEM copy as long as required.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'The same ENS_AUDIT_RETENTION_DAYS behaviour; nothing removed by default.',
                evidence: [DSP_SRC + 'audit/AuditLifecycle.java', AUDIT_DOC],
                customerResponsibility: 'Set the retention period to your policy.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'The same ENS_AUDIT_RETENTION_DAYS behaviour; nothing removed by default.',
                evidence: [RR_SRC + 'audit/AuditRetention.java', AUDIT_DOC],
                customerResponsibility: 'Set the retention period to your policy.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The same ENS_AUDIT_RETENTION_DAYS behaviour; nothing removed by default.',
                evidence: [RSA_SRC + 'audit/AuditRetention.java', AUDIT_DOC],
                customerResponsibility: 'Set the retention period to your policy.',
            },
        },
    },
    {
        id: 'AU-12',
        family: 'AU',
        title: 'Audit Record Generation',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Events are generated by the application and written to the database and stdout by default, with optional audit file, Splunk HTTP Event Collector, syslog (RFC 5424 over UDP, TCP or TLS) and a pull API with read-only tokens. The audit page and pull API work while the application is read-only or unlicensed.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditSinks.java', CA + 'src/main/java/com/winllc/certalert/audit/SplunkHecForwarder.java', CA + 'src/main/java/com/winllc/certalert/audit/SyslogForwarder.java', CA + 'src/main/java/com/winllc/certalert/audit/AuditPullController.java', AUDIT_DOC],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'The same outputs: stdout, file, Splunk HEC, syslog and the pull API.',
                evidence: [DSP_SRC + 'audit/AuditOutputs.java', DSP_SRC + 'audit/SplunkHecForwarder.java', DSP_SRC + 'audit/SyslogForwarder.java', AUDIT_DOC],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'The same outputs: stdout, file, Splunk HEC, syslog and the pull API.',
                evidence: [RR_SRC + 'audit/AuditOutputs.java', RR_SRC + 'audit/SplunkHecOutput.java', RR_SRC + 'audit/SyslogOutput.java', RR_SRC + 'audit/AuditApiController.java', AUDIT_DOC],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The same outputs: stdout, file, Splunk HEC, syslog and the pull API; the Connector writes timestamped text or ECS JSON console logs.',
                evidence: [RSA_SRC + 'audit/AuditStreams.java', RSA_SRC + 'audit/SplunkHecOutput.java', RSA_SRC + 'audit/AuditApiController.java', RSA_CONN + 'logging/EcsJsonLayout.java', AUDIT_DOC],
            },
        },
    },
    // ------------------------------------------------------------------ CM
    {
        id: 'CM-2',
        family: 'CM',
        title: 'Baseline Configuration',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'The baseline is the release: a container image built from Red Hat UBI 9 (ubi9/openjdk-21-runtime) pinned by digest, a Helm chart and a release bundle whose compose file is pinned to the release images, with env.template and values.yaml as the documented settings. Every pull request builds a dry-run bundle so packaging differences show before a release.',
                evidence: [CA + 'Dockerfile', CA + 'deploy/release/env.template', CA + 'deploy/helm/cert-alert/values.yaml', CI.ca, RELEASES_DOC],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Two images (ubi9/openjdk-21-runtime for the API, ubi9/nginx-126 for the web tier) pinned by digest, a Helm chart, a Docker package and a native systemd package, each with its settings template.',
                evidence: [DSP + 'backend/Dockerfile', DSP + 'web/Dockerfile', DSP + 'deploy/package/docker/env.template', DSP + 'deploy/helm/directory-services-portal/values.yaml', CI.dsp],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'One image on ubi9/openjdk-21-runtime pinned by digest (built with a digest-pinned eclipse-temurin JDK stage), a Helm chart and a release bundle with env.template.',
                evidence: [RR + 'Dockerfile', RR + 'deploy/bundle/env.template', RR + 'deploy/helm/readyroom/values.yaml', CI.rr],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Portal and Connector images on ubi9/ubi with java-17-openjdk-headless, pinned by digest through the BASE_TAG build argument, a Helm chart and a release bundle with separate settings templates per service (.env, connector.env, mysql.env).',
                evidence: [RSA + 'rsaapp-portal/Dockerfile', RSA + 'rsaapp-connector/Dockerfile', RSA + 'deploy/release/install.sh', RSA + 'deploy/helm/rsa-operations-portal/values.yaml', CI.rsa],
            },
        },
    },
    {
        id: 'CM-3',
        family: 'CM',
        title: 'Configuration Change Control',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Changes reach main through pull requests that CI builds and tests (build, test-postgres, a11y, helm, release-bundle, image jobs) and CodeQL analyses; a release is a tag that CI turns into signed images, chart and bundle. Whether the repository requires reviews and status checks before merge is an organization setting ENS confirms separately.',
                evidence: [CI.ca, CA + '.github/workflows/codeql.yml', RELEASES_DOC],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Pull requests run api-test, web-test, accessibility, helm, bundle and image jobs plus CodeQL and npm audit; releases are tags. Branch protection is an organization setting ENS confirms separately.',
                evidence: [CI.dsp, DSP + '.github/workflows/codeql.yml', RELEASES_DOC],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Pull requests run build, helm, bundle, accessibility, windows-client and image jobs plus CodeQL; releases are tags. Branch protection is an organization setting ENS confirms separately.',
                evidence: [CI.rr, RR + '.github/workflows/codeql.yml', RELEASES_DOC],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Pull requests run build, accessibility, compose, helm, image and podman-bundle jobs; releases are tags. This repository has no CodeQL workflow. Branch protection is an organization setting ENS confirms separately.',
                evidence: [CI.rsa, RELEASES_DOC],
            },
        },
    },
    {
        id: 'CM-5',
        family: 'CM',
        title: 'Access Restrictions for Change',
        products: {
            certalert: {
                status: 'partial',
                implementation: 'Signing and upload run only in the GitHub release environment on a v* tag, with contents: read and id-token: write and an AWS role assumed through OIDC; the workflow holds contents: read elsewhere. Who may push to main and approve a release is a repository setting not visible in the code; ENS confirms it separately. In the product, settings changes need the administrator role and are audited.',
                evidence: [CI.ca, CA + 'README.md (section "Releases")', RELEASES_DOC],
                customerResponsibility: 'Restrict who may change .env, values files and Secrets on your platform.',
            },
            'directory-portal': {
                status: 'partial',
                implementation: 'The release job runs in the release environment with id-token: write on that job only; repository permissions are an organization setting ENS confirms separately. In the product, configuration changes need ROLE_ADMIN and are audited.',
                evidence: [CI.dsp, RELEASES_DOC],
                customerResponsibility: 'Restrict who may change settings and Secrets on your platform.',
            },
            readyroom: {
                status: 'partial',
                implementation: 'The image job runs under the release environment on tags, with the long-lived keys only a warned fallback; repository permissions are an organization setting ENS confirms separately. In the product, settings need ADMIN and are audited.',
                evidence: [CI.rr, RELEASES_DOC],
                customerResponsibility: 'Restrict who may change settings and Secrets on your platform.',
            },
            'mfa-portal': {
                status: 'partial',
                implementation: 'The image job runs under the release environment on tags; repository permissions are an organization setting ENS confirms separately. In the product, settings need PMO and are audited; util/check-env.sh refuses a .env that holds Connector or MySQL secrets.',
                evidence: [CI.rsa, RSA + 'util/check-env.sh', RELEASES_DOC],
                customerResponsibility: 'Keep .env, connector.env and mysql.env at the modes install.sh sets.',
            },
        },
    },
    {
        id: 'CM-6',
        family: 'CM',
        title: 'Configuration Settings',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Security settings default closed: security headers and CSRF always on, HttpOnly and SameSite cookies, TLS 1.2 and 1.3 only, error messages off (server.error.include-message: never), the application refuses to start with security off outside the dev profile, and the release package refuses plain HTTP to other hosts. The settings a STIG deployment must decide (banner, session limits, revocation, allowed issuers, Secure cookie, audit forwarding) are tabulated with defaults.',
                evidence: [CA_SEC + 'SecurityOffGuard.java', CA_SEC + 'SecurityHeaders.java', CA + 'src/main/resources/application.yml', ca('fips-and-stig'), ca('configuration')],
                customerResponsibility: 'Apply the STIG settings table; set revocation.allow-unverified-crl to false once issuer-directory is populated.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Headers and the request-header CSRF check always on; plain HTTP on 127.0.0.1 by default; the demo directory refuses to start outside demo mode; startup warns about trust-all, mutable claims and proxy misconfiguration. The STIG settings table lists what to decide.',
                evidence: [DSP_SRC + 'config/StartupChecks.java', DSP_SRC + 'config/RequestHeaderCsrfFilter.java', DSP + 'deploy/package/docker/install.sh', dsp('fips-and-stig'), dsp('configuration')],
                customerResponsibility: 'Apply the STIG settings table and the hardening checklist.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Headers and CSRF always on; TLS refuses to start without a keystore and truststore; revocation defaults to ocsp-then-crl; STARTTLS required for mail by default; demo mode cannot run with Windows sign-in. The STIG settings table lists what to decide.',
                evidence: [RR_SRC + 'config/SecurityHeadersConfig.java', RR_SRC + 'config/SslStoresCheck.java', RR_SRC + 'security/x509/X509Config.java', rr('fips-and-stig'), rr('configuration')],
                customerResponsibility: 'Apply the STIG settings table and the hardening checklist.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Headers, CSRF and method security always on; rate limits on; mutual TLS to the Connector in new installations; the Connector refuses every request while no shared secret is set and warns about plain HTTP, trust-all host names and a disabled serial filter; settings files are made mode 600/640 by install.sh. The STIG settings table lists what to decide.',
                evidence: [RSA_SRC + 'security/SecurityHeaders.java', RSA_CONN + 'security/ConnectorAuthFilter.java', RSA + 'util/file-owners.sh', rsa('fips-and-stig'), rsa('configuration')],
                customerResponsibility: 'Apply the STIG settings table; keep CONNECTOR_TLS_CLIENT_AUTH=required.',
            },
        },
    },
    {
        id: 'CM-7',
        family: 'CM',
        title: 'Least Functionality',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Only health, info and the OpenAPI document are open on the application port; Prometheus is on a separate management port never published by the compose file, ingress or route; other actuator endpoints need ADMIN. Outbound connections are enumerated and bounded (allowed-hosts for revocation fetches and webhooks). The container runs as non-root with no capabilities in the chart.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/observability/ManagementEndpoints.java', CA + 'deploy/helm/cert-alert/values.yaml', ca('security')],
                customerResponsibility: 'Keep the management port off every ingress and published port.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'The compose files never publish the API; only the web proxy reaches it. The management port serves health and metrics without sign-in and is never published; the native package binds it to 127.0.0.1 and its systemd unit drops capabilities and filters system calls. Demo seeding is off in production.',
                evidence: [DSP + 'deploy/package/docker/docker-compose.yml', DSP + 'deploy/package/native/directory-services-portal.service', dsp('security')],
                customerResponsibility: 'Keep the management port off user networks; SEED_DEMO_CONFIG=false.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Actuator exposure is health only on the application port, Prometheus only on the management port; Windows sign-in is off by default and applies to three check-in calls; the public API serves GETs only.',
                evidence: [RR_SRC + 'config/ManagementPortExposure.java', RR_SRC + 'api/ApiSecurityConfig.java', rr('security')],
                customerResponsibility: 'Keep Actuator exposure at health; never publish the management port.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Only health and prometheus are exposed, prometheus on the management port only. The Connector has two handlers, a Hessian endpoint that rebuilds allow-listed classes and accepts only POST, and a health endpoint; its plain HTTP port binds to loopback. The mock Authentication Manager is not shipped in releases.',
                evidence: [RSA_CONN + 'security/AllowListHessianServiceExporter.java', RSA + 'scripts/release-bundle.sh', rsa('security')],
                customerResponsibility: 'Never publish the management port; do not expose 8080 beyond the host.',
            },
        },
    },
    {
        id: 'CM-8',
        family: 'CM',
        title: 'System Component Inventory',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'CI generates an SPDX 2.3 SBOM of the image with syft on every image build, ships it in the release download (sbom-cert-alert.spdx.json) and attaches it to the image as a cosign attestation of type spdxjson on release tags.',
                evidence: [CI.ca, RELEASES_DOC, FIPS_DOC],
                customerResponsibility: 'Record the deployed image digests and chart version in your own inventory.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'SPDX SBOMs of both images (api and web) generated with syft, in the download and attested on the images.',
                evidence: [CI.dsp, RELEASES_DOC],
                customerResponsibility: 'Record the deployed image digests and chart version.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'SPDX SBOMs of the application image (sbom-in-n-out-work.spdx.json) and the bundled postgres image, in the download; the application image\'s SBOM is attested on the image.',
                evidence: [CI.rr, RELEASES_DOC],
                customerResponsibility: 'Record the deployed image digests and chart version.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'SPDX SBOMs of the Portal, Connector and bundled MySQL images, in the download; the Portal\'s and Connector\'s are attested on the images.',
                evidence: [CI.rsa, RELEASES_DOC],
                customerResponsibility: 'Record the deployed image digests and chart version.',
            },
        },
    },
    // ------------------------------------------------------------------ CP
    {
        id: 'CP-2',
        family: 'CP',
        title: 'Contingency Plan',
        products: {
            certalert: {
                status: 'customer',
                implementation: 'The contingency plan is the operating organization\'s. The documentation supplies its inputs: what to back up (the PostgreSQL database and the license volume), the recovery order, cold-standby guidance and the rollback rule. ENS has not load-tested the application and publishes no capacity figures.',
                evidence: [HA_DOC, ca('availability-and-sizing')],
                customerResponsibility: 'Write and exercise the plan; decide RPO and RTO.',
            },
            'directory-portal': {
                status: 'customer',
                implementation: 'As above; what to back up is the data directory (or the shared database) and the license directory. The portal talks to one LDAP server (no failover in the product).',
                evidence: [HA_DOC, dsp('availability-and-sizing')],
                customerResponsibility: 'Write and exercise the plan; provide directory availability.',
            },
            readyroom: {
                status: 'customer',
                implementation: 'As above; what to back up is the PostgreSQL database and the license volume.',
                evidence: [HA_DOC, rr('availability-and-sizing')],
                customerResponsibility: 'Write and exercise the plan.',
            },
            'mfa-portal': {
                status: 'customer',
                implementation: 'As above; what to back up is the MySQL database, the license volume, the AM trust store and the Connector\'s certificates. The Connector runs as one replica by design.',
                evidence: [HA_DOC, rsa('availability-and-sizing')],
                customerResponsibility: 'Write and exercise the plan; accept or mitigate the single-Connector recovery time.',
            },
        },
    },
    {
        id: 'CP-9',
        family: 'CP',
        title: 'System Backup',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'The release package has backup.sh and restore.sh (exercised in CI), upgrade.sh writes a database dump before upgrading, and the Helm chart runs a pre-upgrade backup hook. Scheduling backups is the customer\'s.',
                evidence: [CA + 'deploy/release/backup.sh', CA + 'deploy/release/restore.sh', CA + 'deploy/helm/cert-alert/templates/upgrade-backup.yaml', CI.ca, ca('availability-and-sizing')],
                customerResponsibility: 'Schedule and store backups off the host; back up the database with your own tooling where you run it externally.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: './portal.sh backup and ./portal.sh restore in the Docker package (the license volume is not included); native and Helm installations use tar or volume snapshots. upgrade.sh writes a backup first.',
                evidence: [DSP + 'deploy/package/docker/portal.sh', DSP + 'deploy/package/docker/upgrade.sh', dsp('availability-and-sizing')],
                customerResponsibility: 'Schedule backups; include the license directory and DSP_SECRETS_KEY, kept apart from the backups.',
            },
            readyroom: {
                status: 'implemented',
                implementation: './backup.sh (database and license volume, kept 14 days) and ./restore.sh in the bundle; the Helm chart has a backup CronJob, off by default (backup.enabled).',
                evidence: [RR + 'deploy/bundle/backup.sh', RR + 'deploy/bundle/restore.sh', RR + 'deploy/helm/readyroom/templates/backup.yaml', rr('availability-and-sizing')],
                customerResponsibility: 'Schedule backups; run ./backup.sh before an upgrade.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'util/backupdb.sh and scripts/restoredb.sh for the MySQL database; upgrade.sh backs up first; the Helm chart has a backup CronJob, off by default.',
                evidence: [RSA + 'util/backupdb.sh', RSA + 'scripts/restoredb.sh', RSA + 'deploy/helm/rsa-operations-portal/templates/backup.yaml', rsa('availability-and-sizing')],
                customerResponsibility: 'Schedule backups; include the license volume, trust store and Connector certificates.',
            },
        },
    },
    {
        id: 'CP-10',
        family: 'CP',
        title: 'System Recovery and Reconstitution',
        products: {
            certalert: {
                status: 'partial',
                implementation: 'Recovery is documented: install the same release, restore settings, license volume and data, start, then check the license screen, Verify integrity and a sign-in. Rollback needs the pre-upgrade backup. ENS has not tested rollbacks as procedures; the documentation says to practise one.',
                evidence: [HA_DOC, ca('operator-guide'), CA + 'deploy/release/restore.sh'],
                customerResponsibility: 'Practise the recovery on a test installation; reset pull-API cursors after a restore.',
            },
            'directory-portal': {
                status: 'partial',
                implementation: 'The same documented recovery order; rollbacks untested as procedures.',
                evidence: [HA_DOC, dsp('operator-guide')],
                customerResponsibility: 'Practise the recovery on a test installation.',
            },
            readyroom: {
                status: 'partial',
                implementation: 'The same documented recovery order; rollbacks untested as procedures.',
                evidence: [HA_DOC, rr('operator-guide'), RR + 'deploy/bundle/restore.sh'],
                customerResponsibility: 'Practise the recovery on a test installation.',
            },
            'mfa-portal': {
                status: 'partial',
                implementation: 'The same documented recovery order; rollbacks untested as procedures; the Connector\'s state (pending multi-step logins) is in memory and lost on restart by design.',
                evidence: [HA_DOC, rsa('operator-guide'), RSA + 'scripts/restoredb.sh'],
                customerResponsibility: 'Practise the recovery on a test installation.',
            },
        },
    },
    // ------------------------------------------------------------------ IA
    {
        id: 'IA-2',
        family: 'IA',
        title: 'Identification and Authentication (Organizational Users)',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Three methods: an X.509 client certificate (CAC/PIV) matched by SHA-256 fingerprint to the certificate the directory publishes for the person, with issuer and live revocation checks; the directory password by LDAP bind; and OpenID Connect or SAML 2.0 single sign-on whose asserted identity must match exactly one directory entry. No passwords are stored.',
                evidence: [CA_SEC + 'X509DirectoryUserDetailsService.java', CA_SEC + 'ClientCertificateChecks.java', CA_SEC + 'DirectoryAuthenticationConfig.java', CA_SEC + 'sso/SsoSignIn.java', ca('security'), ca('single-sign-on')],
                customerResponsibility: 'Operate the directory, PKI and identity provider the sign-in relies on.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Password sign-in by LDAP bind after a service-account search that must match exactly one entry; X.509 client certificates with validity, key-usage, issuer, chain and revocation checks mapped to exactly one directory user; OIDC and SAML 2.0 single sign-on. PASSWORD_LOGIN_ENABLED=false gives certificate-only sign-in.',
                evidence: [DSP_SRC + 'service/AuthService.java', DSP_SRC + 'x509/X509AuthService.java', DSP_SRC + 'x509/CertificateValidator.java', DSP_SRC + 'sso/SsoSignIn.java', dsp('security'), dsp('single-sign-on')],
                customerResponsibility: 'Operate the directory, PKI and identity provider.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Client certificates (mutual TLS) mapped to a directory user by DN or an LDAP filter with issuer and revocation checks; LDAP username and password; OIDC and SAML 2.0 single sign-on; and, for the three workstation check-in calls only, Kerberos tickets validated against the keytab.',
                evidence: [RR_SRC + 'security/x509/X509SignIn.java', RR_SRC + 'security/x509/RevocationChecker.java', RR_SRC + 'security/NegotiateAuthenticationFilter.java', RR_SRC + 'security/sso/SsoSignIn.java', rr('security'), rr('single-sign-on')],
                customerResponsibility: 'Operate the directory, PKI, Active Directory and identity provider.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Users sign in with their Authentication Manager user ID and SecurID passcode (PIN plus tokencode), checked by Authentication Manager through the Connector, with next-tokencode and new-PIN prompts handled; operators may start with OIDC or SAML single sign-on and must then enter the SecurID passcode of the same user ID. The Portal keeps no passwords and does no CAC sign-in of its own.',
                evidence: [RSA_SRC + 'security/CustomAuthenticationProvider.java', RSA_SRC + 'security/AdditionalPrompts.java', RSA_SRC + 'sso/SsoSignIn.java', rsa('security'), rsa('single-sign-on')],
                customerResponsibility: 'Operate Authentication Manager and the identity provider.',
            },
        },
    },
    {
        id: 'IA-2(1)',
        family: 'IA',
        title: 'Identification and Authentication | Multi-factor Authentication to Privileged Accounts',
        products: {
            certalert: {
                status: 'partial',
                implementation: 'Smart-card sign-in and single sign-on through an identity provider that enforces MFA are multi-factor; the directory-password path alone is single-factor. Certificate-only sign-in is available (cert-alert.security.ldap.enabled: false), and an identity provider\'s groups can confine the administrator role to its sessions.',
                evidence: [CA_SEC + 'SecurityConfig.java', ca('fips-and-stig'), ca('single-sign-on')],
                customerResponsibility: 'Disable the password path or require MFA at the identity provider for administrators.',
            },
            'directory-portal': {
                status: 'partial',
                implementation: 'Smart-card sign-in and provider-enforced MFA through SSO are multi-factor; the password path is single-factor. PASSWORD_LOGIN_ENABLED=false removes it; SSO_*_ADMIN_GROUPS can confine the administrator role to provider sessions bounded by SSO_IDP_ADMIN_SESSION_LIFETIME.',
                evidence: [DSP_SRC + 'config/SecurityConfig.java', DSP_SRC + 'sso/SsoSecurity.java', dsp('security')],
                customerResponsibility: 'Disable the password path or require MFA at the identity provider for administrators.',
            },
            readyroom: {
                status: 'partial',
                implementation: 'Certificate sign-in and provider-enforced MFA through SSO are multi-factor; the LDAP password path is single-factor and cannot be switched off on its own in this release.',
                evidence: [RR_SRC + 'config/SecurityConfig.java', rr('security')],
                customerResponsibility: 'Require MFA at the identity provider, or issue administrators certificates and restrict password sign-in by directory policy.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Every sign-in is a SecurID passcode (something known plus something held), and with ENS_SSO_REQUIRE_FOR_ADMIN_ROLES at its default the roles mapped from identity-provider groups come only through the provider, so its conditional access cannot be bypassed with a passcode alone.',
                evidence: [RSA_SRC + 'security/CustomAuthenticationProvider.java', RSA_SRC + 'sso/SsoSettings.java', rsa('single-sign-on')],
            },
        },
    },
    {
        id: 'IA-3',
        family: 'IA',
        title: 'Device Identification and Authentication',
        products: {
            readyroom: {
                status: 'implemented',
                implementation: 'The Windows workstation agent authenticates its check-in, lock and unlock calls with the user\'s client certificate or a Kerberos ticket; computer accounts (names ending in $) and service principals are rejected, so the record is tied to a person, and the logout call accepts only an unused, recent check-in sessionId.',
                evidence: [RR_SRC + 'config/WindowsAuthSecurityConfig.java', RR_SRC + 'security/x509/CertificateCredentialsFilter.java', RR_SRC + 'rest/CheckInOutRestService.java', rr('security'), rr('windows-client')],
                customerResponsibility: 'Domain-join workstations and issue the user certificates or keytab.',
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The Connector authenticates the Portal by mutual TLS (a client certificate from CONNECTOR_TLS_CLIENT_CA) and a shared secret on every request, and the Connector authenticates Authentication Manager by its certificate chain and host name.',
                evidence: [RSA_CONN + 'security/ConnectorAuthFilter.java', RSA_CONN + 'security/MutualTlsCheck.java', RSA_CONN + 'security/HostnameCheckingSocketFactory.java', rsa('security')],
            },
        },
    },
    {
        id: 'IA-4',
        family: 'IA',
        title: 'Identifier Management',
        products: {
            certalert: {
                status: 'customer',
                implementation: 'Identifiers are the directory\'s (uid and entry DN). CertAlert matches administrators by uid or DN only, never by e-mail address or display name, because those can be edited or shared.',
                evidence: [CA_SEC + 'AdminIdentifierCheck.java', ca('security')],
                customerResponsibility: 'Manage identifiers in the directory; map SSO on a claim people cannot change.',
            },
            'directory-portal': {
                status: 'customer',
                implementation: 'Identifiers are the directory\'s; SSO identities map through SSO_*_USER_FILTER and the startup check warns when the OIDC username claim is mutable.',
                evidence: [DSP_SRC + 'config/StartupChecks.java', dsp('security')],
                customerResponsibility: 'Manage identifiers in the directory; use an immutable SSO claim.',
            },
            readyroom: {
                status: 'customer',
                implementation: 'Identifiers are directory DNs; certificates, tickets and SSO identities each resolve to exactly one directory user or sign in nobody.',
                evidence: [RR_SRC + 'security/sso/SsoUserMapper.java', RR_SRC + 'security/x509/CertificateIdentity.java', rr('security')],
                customerResponsibility: 'Manage identifiers in the directory.',
            },
            'mfa-portal': {
                status: 'customer',
                implementation: 'Identifiers are Authentication Manager user IDs and principal GUIDs; the SSO identity must name the same user ID that then enters the passcode.',
                evidence: [RSA_SRC + 'sso/SsoIdentity.java', rsa('single-sign-on')],
                customerResponsibility: 'Manage identifiers in Authentication Manager.',
            },
        },
    },
    {
        id: 'IA-5',
        family: 'IA',
        title: 'Authenticator Management',
        products: {
            certalert: {
                status: 'customer',
                implementation: 'Passwords live in the directory and are verified by bind, never stored; certificates are the PKI\'s and are checked for issuer, validity and revocation. CertAlert manages only API tokens: created with scopes and an expiry (a year at most by default), stored as SHA-256, shown once, revocable.',
                evidence: [CA + 'src/main/java/com/winllc/certalert/api/ApiTokens.java', CA_SEC + 'ClientCertificateChecks.java', ca('api-reference')],
                customerResponsibility: 'Password policy, certificate issuance and revocation.',
            },
            'directory-portal': {
                status: 'customer',
                implementation: 'Passwords are verified by LDAP bind and never stored; empty passwords are rejected before any bind; the portal offers no password change or reset. API tokens are 32 random bytes kept as SHA-256, scoped and expiring.',
                evidence: [DSP_SRC + 'service/AuthService.java', DSP_SRC + 'integration/ApiTokens.java', dsp('security')],
                customerResponsibility: 'Password policy and resets in the directory; certificate issuance and revocation.',
            },
            readyroom: {
                status: 'customer',
                implementation: 'Passwords are verified by bind on a dedicated connection so a change takes effect at once; the keytab for Kerberos is the customer\'s and is treated as a password; API and pull tokens are SHA-256 hashed and expiring.',
                evidence: [RR_SRC + 'api/ApiTokenService.java', RR_SRC + 'audit/AuditTokenService.java', rr('security')],
                customerResponsibility: 'Password policy, certificates and the keytab.',
            },
            'mfa-portal': {
                status: 'customer',
                implementation: 'SecurID PINs and tokens are Authentication Manager\'s; the Portal\'s PIN reset and token swap flows prove identity first (certificate, Windows password plus serial, or an e-mailed link plus tokencode) and are rate-limited; help-desk e-mailed codes are kept only as an HMAC. API tokens are SHA-256 hashed, scoped and expiring.',
                evidence: [RSA_SRC + 'helpdesk/EmailCodeVerification.java', RSA_SRC + 'api/ApiTokens.java', rsa('user-guide'), rsa('help-desk')],
                customerResponsibility: 'Token and PIN policy in Authentication Manager.',
            },
        },
    },
    {
        id: 'IA-6',
        family: 'IA',
        title: 'Authentication Feedback',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'A failed sign-in returns to the form without saying why; the reason goes to the audit trail. Password fields are standard masked inputs.',
                evidence: [CA_SEC + 'SecurityConfig.java', CA + 'src/main/java/com/winllc/certalert/audit/AuthenticationAudit.java'],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Failures give one message; lockout answers 429; reasons are in the audit trail.',
                evidence: [DSP_SRC + 'service/AuthService.java', dsp('security')],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Failed sign-ins go to /login?error with no cause; the reason is audited.',
                evidence: [RR_SRC + 'config/SecurityConfig.java', rr('security')],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Sign-in and every public self-service step give one answer whatever the cause (unknown user, wrong passcode, locked account), padded to a uniform response time; the cause is recorded only in the audit trail.',
                evidence: [RSA_SRC + 'ratelimit/UniformResponses.java', RSA_SRC + 'security/CustomAuthenticationFailureHandler.java', rsa('security')],
            },
        },
    },
    {
        id: 'IA-8',
        family: 'IA',
        title: 'Identification and Authentication (Non-organizational Users)',
        products: {
            certalert: {
                status: 'not-applicable',
                implementation: 'Every user must be a directory entry; there is no access for people outside the organization\'s directory.',
                evidence: [ca('security')],
            },
            'directory-portal': {
                status: 'not-applicable',
                implementation: 'Every user must be a directory entry.',
                evidence: [dsp('security')],
            },
            readyroom: {
                status: 'not-applicable',
                implementation: 'Every user must be a directory entry.',
                evidence: [rr('security')],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'The anonymous self-service pages (Test My Token, PIN reset, registration, exemption and appointment requests) identify a visitor by Authentication Manager user ID or token serial and prove it with a tokencode, certificate, Windows password or e-mailed link before anything changes, under rate limits and uniform answers.',
                evidence: [RSA_SRC + 'controller/UserPinResetController.java', RSA_SRC + 'ratelimit/RateLimitFilter.java', rsa('user-guide'), rsa('security')],
            },
        },
    },
    {
        id: 'IA-11',
        family: 'IA',
        title: 'Re-authentication',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'The absolute session lifetime (12h default) forces a new sign-in whatever the activity; certificate sign-ins are re-evaluated (issuer, revocation) on every request that presents a certificate.',
                evidence: [CA_SEC + 'SessionPolicyFilter.java', ca('security')],
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Absolute lifetime (12h default); administrator sessions from an identity provider are bounded by SSO_IDP_ADMIN_SESSION_LIFETIME; groups are re-read every 5 minutes.',
                evidence: [DSP_SRC + 'config/SessionControlFilter.java', dsp('security')],
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Absolute lifetime (12h default); API tokens re-check the creator\'s directory status on every call.',
                evidence: [RR_SRC + 'security/SessionControlFilter.java', rr('security')],
            },
            'mfa-portal': {
                status: 'implemented',
                implementation: 'Absolute lifetime (12h default); after a role change the user must sign in again; an ended Authentication Manager session signs the user out.',
                evidence: [RSA_SRC + 'session/TimedOutSessions.java', rsa('security')],
            },
        },
    },
    // ------------------------------------------------------------------ IR
    {
        id: 'IR-4',
        family: 'IR',
        title: 'Incident Handling',
        products: {
            certalert: {
                status: 'customer',
                implementation: 'Incident handling is the operating organization\'s. ENS supports it with the audit trail, SIEM forwarding and the support policy: P1 to P4 severities, first response within the tier\'s target, a P1 worked continuously within the tier\'s hours, and a written cause summary within five business days of a P1\'s resolution.',
                evidence: ['ens-products-page: src/pages/support.astro', 'ens-products-page: src/data/pricing.ts', AUDIT_DOC],
                customerResponsibility: 'Run your incident response process; report product defects through support.',
            },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: ['ens-products-page: src/pages/support.astro', AUDIT_DOC], customerResponsibility: 'Run your incident response process.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert.', evidence: ['ens-products-page: src/pages/support.astro', AUDIT_DOC], customerResponsibility: 'Run your incident response process.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: ['ens-products-page: src/pages/support.astro', AUDIT_DOC], customerResponsibility: 'Run your incident response process.' },
        },
    },
    {
        id: 'IR-6',
        family: 'IR',
        title: 'Incident Reporting',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Vulnerabilities in the products, the licensing portal or the product site are reported to info@ens-solutions.com, published in /.well-known/security.txt (RFC 9116) and on the trust page, which states the acknowledgement target of three business days and the disclosure expectations. Fixes reach customers as releases through the Downloads page.',
                evidence: ['ens-products-page: public/.well-known/security.txt', 'ens-products-page: src/pages/trust.astro', 'ens-products-page: compliance/vulnerability-management-policy.md'],
                customerResponsibility: 'Report incidents involving your deployment to your own authorities; report suspected product vulnerabilities to ENS.',
            },
            'directory-portal': { status: 'implemented', implementation: 'As for CertAlert.', evidence: ['ens-products-page: public/.well-known/security.txt', 'ens-products-page: src/pages/trust.astro'] },
            readyroom: { status: 'implemented', implementation: 'As for CertAlert.', evidence: ['ens-products-page: public/.well-known/security.txt', 'ens-products-page: src/pages/trust.astro'] },
            'mfa-portal': { status: 'implemented', implementation: 'As for CertAlert.', evidence: ['ens-products-page: public/.well-known/security.txt', 'ens-products-page: src/pages/trust.astro'] },
        },
    },
    {
        id: 'IR-8',
        family: 'IR',
        title: 'Incident Response Plan',
        products: {
            certalert: { status: 'customer', implementation: 'The plan is the operating organization\'s; ENS\'s part is the vulnerability management policy in this pack and the support policy.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md', 'ens-products-page: src/pages/support.astro'], customerResponsibility: 'Maintain the plan and name ENS support as the vendor contact.' },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Maintain the plan.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Maintain the plan.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Maintain the plan.' },
        },
    },
    // ------------------------------------------------------------------ MA
    {
        id: 'MA-2',
        family: 'MA',
        title: 'Controlled Maintenance',
        products: {
            certalert: {
                status: 'customer',
                implementation: 'Maintenance of the installation (upgrades, database maintenance, host patching) is the customer\'s. The release package\'s upgrade.sh carries settings and license across and dumps the database first; the chart\'s pre-upgrade hook does the same; every scheduled job run and settings change is audited.',
                evidence: [CA + 'deploy/release/upgrade.sh', CA + 'deploy/helm/cert-alert/templates/upgrade-backup.yaml', ca('operator-guide')],
                customerResponsibility: 'Schedule, approve and record maintenance; patch the host and database.',
            },
            'directory-portal': { status: 'customer', implementation: 'As above, with the Docker package\'s upgrade.sh and the native package\'s install.sh.', evidence: [DSP + 'deploy/package/docker/upgrade.sh', DSP + 'deploy/package/native/install.sh', dsp('operator-guide')], customerResponsibility: 'Schedule, approve and record maintenance.' },
            readyroom: { status: 'customer', implementation: 'As above, with the bundle\'s upgrade.sh (run ./backup.sh first).', evidence: [RR + 'deploy/bundle/upgrade.sh', rr('operator-guide')], customerResponsibility: 'Schedule, approve and record maintenance; re-run the agent installer on workstations after a client upgrade.' },
            'mfa-portal': { status: 'customer', implementation: 'As above, with the release package\'s upgrade.sh, which backs up, splits legacy settings files and moves passwords out of JAVA_OPTS.', evidence: [RSA + 'deploy/release/upgrade.sh', rsa('operator-guide')], customerResponsibility: 'Schedule, approve and record maintenance.' },
        },
    },
    {
        id: 'MA-4',
        family: 'MA',
        title: 'Nonlocal Maintenance',
        products: {
            certalert: { status: 'customer', implementation: 'ENS has no remote access to any installation; the products make no connection to ENS and report no usage. Any remote maintenance session is one the customer arranges under its own controls.', evidence: [ca('security'), 'ens-products-page: src/pages/trust.astro'], customerResponsibility: 'Control and record any remote session you grant.' },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: [dsp('security')], customerResponsibility: 'Control and record any remote session you grant.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert.', evidence: [rr('security')], customerResponsibility: 'Control and record any remote session you grant.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: [rsa('security')], customerResponsibility: 'Control and record any remote session you grant.' },
        },
    },
    // ------------------------------------------------------------------ PL
    {
        id: 'PL-2',
        family: 'PL',
        title: 'System Security and Privacy Plans',
        products: {
            certalert: { status: 'customer', implementation: 'The system security plan is the customer\'s. This matrix, the security page, the architecture page and the outbound-connections table are written to be pasted into it.', evidence: [ca('architecture'), ca('security'), 'ens-products-page: compliance/nist-800-53/overview.md'], customerResponsibility: 'Write the plan; cite this matrix for the application layer.' },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: [dsp('architecture'), dsp('security')], customerResponsibility: 'Write the plan.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert; ReadyRoom also has a privacy page written for a DPIA.', evidence: [rr('security'), rr('privacy')], customerResponsibility: 'Write the plan and, where personal data law applies, the DPIA.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: [rsa('architecture'), rsa('security')], customerResponsibility: 'Write the plan.' },
        },
    },
    {
        id: 'PL-4',
        family: 'PL',
        title: 'Rules of Behavior',
        products: {
            certalert: { status: 'customer', implementation: 'The consent banner presents the organization\'s rules before sign-in and records each acknowledgement (AC-8); the rules themselves are the customer\'s.', evidence: [CA_SEC + 'ConsentBanner.java', ca('security')], customerResponsibility: 'Supply the banner text where the DoD default does not apply.' },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: [DSP_SRC + 'service/ConsentService.java'], customerResponsibility: 'Supply the banner text.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert; the profile notes field also warns against classified or personal data.', evidence: [RR_SRC + 'security/ConsentBanner.java', rr('security')], customerResponsibility: 'Supply the banner text.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert.', evidence: [RSA_SRC + 'security/ConsentBanner.java'], customerResponsibility: 'Supply the banner text.' },
        },
    },
    {
        id: 'PL-8',
        family: 'PL',
        title: 'Security and Privacy Architectures',
        products: {
            certalert: { status: 'implemented', implementation: 'The architecture page and the security page describe the components, the sign-in filter chain, the trust boundaries (directory, PKI, SIEM, identity provider, webhook receivers) and every outbound connection.', evidence: [ca('architecture'), ca('security')] },
            'directory-portal': { status: 'implemented', implementation: 'The architecture page describes the web tier, the API, the single service account and the shared-database mode; the security page the trust model and network exposure.', evidence: [dsp('architecture'), dsp('security')] },
            readyroom: { status: 'implemented', implementation: 'The security page carries the authentication flow diagram and the open-endpoint table; the Windows client page the agent\'s side; the privacy page what is stored and who sees it.', evidence: [rr('security'), rr('windows-client'), rr('privacy')] },
            'mfa-portal': { status: 'implemented', implementation: 'The architecture page describes the Portal, the Connector and Authentication Manager and the two protected hops; the integration page lists exactly which classes each hop accepts.', evidence: [rsa('architecture'), rsa('rsa-integration'), rsa('security')] },
        },
    },
    // ------------------------------------------------------------------ RA
    {
        id: 'RA-3',
        family: 'RA',
        title: 'Risk Assessment',
        products: {
            certalert: { status: 'customer', implementation: 'The risk assessment of a deployment is the customer\'s. ENS\'s inputs are the known gaps stated in the overview (no FIPS-mode run, no third-party penetration test, draft VPAT) and the accepted-risk entries in .trivyignore (three pcre2 CVEs in the base image, expiring 2026-11-17).', evidence: [CA + '.trivyignore', 'ens-products-page: compliance/nist-800-53/overview.md'], customerResponsibility: 'Assess the risk of the deployment; accept or mitigate the stated gaps.' },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert; .trivyignore holds no accepted risks at this revision. Single LDAP server without failover is a stated availability gap.', evidence: [DSP + '.trivyignore', 'ens-products-page: compliance/nist-800-53/overview.md'], customerResponsibility: 'Assess the risk of the deployment.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert; .trivyignore holds no accepted risks. The unsigned Windows agent and the retired development CA whose keys were published are stated gaps.', evidence: [RR + '.trivyignore', rr('security'), 'ens-products-page: compliance/nist-800-53/overview.md'], customerResponsibility: 'Assess the risk of the deployment, the agent included.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert; the Connector carries 23 accepted CVEs in .trivyignore, each with a justification and an expiry of 2027-04-18, on an end-of-life Spring 3.2 stack the RSA SDK requires. The ISSM should read that file and the vulnerability management policy\'s worked example.', evidence: [RSA + '.trivyignore', RSA + 'README.md (section "Dependency Constraints")', 'ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Record the accepted Connector risk in your assessment.' },
        },
    },
    {
        id: 'RA-5',
        family: 'RA',
        title: 'Vulnerability Monitoring and Scanning',
        products: {
            certalert: {
                status: 'implemented',
                implementation: 'Every image build runs Trivy 0.75.0 (vulnerability scanner, severity HIGH and CRITICAL, --ignore-unfixed, --exit-code 1) and fails on a fixable finding; accepted risks live in .trivyignore with a reason and an exp: date after which Trivy stops ignoring them. CodeQL (java-kotlin, javascript-typescript) runs on push, pull request and weekly (Mondays 04:17 UTC). Dependabot proposes weekly updates for Gradle, Docker digests, GitHub Actions and the a11y npm packages.',
                evidence: [CI.ca, CA + '.github/workflows/codeql.yml', CA + '.github/dependabot.yml', CA + '.trivyignore'],
                customerResponsibility: 'Scan the running hosts, cluster and database with your own tooling.',
            },
            'directory-portal': {
                status: 'implemented',
                implementation: 'Trivy on both images with the same gate; CodeQL (Java and TypeScript) on push, pull request and weekly; npm audit --omit=dev --audit-level=high on every run; Dependabot weekly for Maven, npm, Docker and Actions.',
                evidence: [CI.dsp, DSP + '.github/workflows/codeql.yml', DSP + '.github/dependabot.yml', DSP + '.trivyignore'],
                customerResponsibility: 'Scan your hosts and cluster.',
            },
            readyroom: {
                status: 'implemented',
                implementation: 'Trivy on the image with the same gate; CodeQL (Java and JavaScript) on push, pull request and weekly; Dependabot weekly for Gradle, Docker and Actions.',
                evidence: [CI.rr, RR + '.github/workflows/codeql.yml', RR + '.github/dependabot.yml', RR + '.trivyignore'],
                customerResponsibility: 'Scan your hosts and cluster, and the workstations that run the agent.',
            },
            'mfa-portal': {
                status: 'partial',
                implementation: 'Trivy on both images (Portal and Connector) with the same gate, and Dependabot weekly for Maven, Docker and Actions. There is no CodeQL workflow in this repository, and the base image digest is updated by hand because Dependabot cannot follow the BASE_TAG build argument. The Connector\'s 23 accepted CVEs are listed in .trivyignore with justifications and an expiry of 2027-04-18.',
                evidence: [CI.rsa, RSA + '.github/dependabot.yml', RSA + '.trivyignore'],
                customerResponsibility: 'Scan your hosts, cluster and database.',
            },
        },
    },
    // ------------------------------------------------------------------ SA
    {
        id: 'SA-4',
        family: 'SA',
        title: 'Acquisition Process',
        products: {
            certalert: { status: 'implemented', implementation: 'What a buyer receives is specified: the licensed features, the release contents (bundle, chart, SBOMs, checksums and signature), the support policy with severities and supported versions, and this compliance pack. Prices and terms are published.', evidence: [suite('licensing'), RELEASES_DOC, 'ens-products-page: src/pages/support.astro', 'ens-products-page: src/pages/licensing.astro'] },
            'directory-portal': { status: 'implemented', implementation: 'As for CertAlert.', evidence: [suite('licensing'), RELEASES_DOC, 'ens-products-page: src/pages/support.astro'] },
            readyroom: { status: 'implemented', implementation: 'As for CertAlert.', evidence: [suite('licensing'), RELEASES_DOC, 'ens-products-page: src/pages/support.astro'] },
            'mfa-portal': { status: 'implemented', implementation: 'As for CertAlert.', evidence: [suite('licensing'), RELEASES_DOC, 'ens-products-page: src/pages/support.astro'] },
        },
    },
    {
        id: 'SA-5',
        family: 'SA',
        title: 'System Documentation',
        products: {
            certalert: { status: 'implemented', implementation: 'Install, configuration, operator, administrator, user, security, single sign-on, API, webhooks, exports, FIPS and STIG, accessibility, availability and troubleshooting pages on the documentation site, built from the repository README, plus the chart and bundle READMEs.', evidence: [ca('index'), CA + 'README.md', CA + 'deploy/helm/cert-alert/README.md', CA + 'deploy/release/README.md'] },
            'directory-portal': { status: 'implemented', implementation: 'The same set, plus import/export; the install page carries a tested-directory matrix that says which directory servers are tested.', evidence: [dsp('index'), dsp('install'), DSP + 'README.md', DSP + 'deploy/helm/directory-services-portal/README.md'] },
            readyroom: { status: 'implemented', implementation: 'The same set, plus the Windows client and privacy pages.', evidence: [rr('index'), rr('windows-client'), RR + 'README.md', RR + 'deploy/helm/readyroom/README.md'] },
            'mfa-portal': { status: 'implemented', implementation: 'The same set, plus the Authentication Manager integration and help-desk pages.', evidence: [rsa('index'), rsa('rsa-integration'), RSA + 'README.md', RSA + 'deploy/helm/rsa-operations-portal/README.md'] },
        },
    },
    {
        id: 'SA-8',
        family: 'SA',
        title: 'Security and Privacy Engineering Principles',
        products: {
            certalert: { status: 'implemented', implementation: 'Secure defaults (headers, CSRF, TLS versions, plain-HTTP refusal, security-off guard), least privilege (auditor role, scoped tokens), fail-closed sign-in checks (unknown revocation refused once a mode is set, API tokens refused for disabled creators), bounded outbound connections, and no cryptography of ENS\'s own (the Java runtime\'s providers only).', evidence: [CA_SEC + 'SecurityOffGuard.java', CA + 'src/main/java/com/winllc/certalert/revocation/FetchPolicy.java', ca('security'), FIPS_DOC] },
            'directory-portal': { status: 'implemented', implementation: 'One service account with the portal\'s own permission layer, namespace confinement, server-side validation mirroring the client rules, escaped LDAP filters and DNs, the request-header CSRF check, encrypted stored secrets, and startup checks that warn about weak settings.', evidence: [DSP_SRC + 'config/StartupChecks.java', DSP_SRC + 'service/FormValidator.java', DSP_SRC + 'secrets/SecretBox.java', dsp('security')] },
            readyroom: { status: 'implemented', implementation: 'Identical access rules whichever way someone signs in, a read-only public API, privacy controls (coworker visibility, retention, export and erasure), fail-closed TLS startup, and a sessionId treated as a credential on the one open endpoint.', evidence: [RR_SRC + 'security/AccessPolicy.java', RR_SRC + 'service/RetentionService.java', rr('security'), rr('privacy')] },
            'mfa-portal': { status: 'implemented', implementation: 'Audit before change (fail closed), help-desk verification and dual control, uniform answers and rate limits on anonymous steps, two protected hops with deserialization filters at each, secrets split per service and kept off the command line, and no vendor mail address built in.', evidence: [RSA_SRC + 'audit/AuditLog.java', RSA_CONN + 'security/AuthManagerReplyFilter.java', RSA_CONN + 'security/JdkSerialFilter.java', rsa('security')] },
        },
    },
    {
        id: 'SA-10',
        family: 'SA',
        title: 'Developer Configuration Management',
        products: {
            certalert: { status: 'implemented', implementation: 'Source is in Git with pull requests; every GitHub Action is pinned to a commit SHA and every base image to a digest, kept current by Dependabot; releases are tags that CI builds into signed, attested images with SLSA build provenance; the README\'s upgrade notes record what each release changes.', evidence: [CI.ca, CA + '.github/dependabot.yml', CA + 'Dockerfile', CA + 'README.md (section "Releases")'] },
            'directory-portal': { status: 'implemented', implementation: 'As for CertAlert, without SLSA provenance; the security page documents the pipeline in full.', evidence: [CI.dsp, DSP + '.github/dependabot.yml', dsp('security')] },
            readyroom: { status: 'implemented', implementation: 'As for CertAlert, without SLSA provenance; the Windows agent is tested with Pester on Windows and Linux in the windows-client job.', evidence: [CI.rr, RR + '.github/dependabot.yml', RR + 'powershell/tests'] },
            'mfa-portal': { status: 'implemented', implementation: 'As for CertAlert, without SLSA provenance; the RSA SDK jars are vendored under Git LFS and their constraints are documented.', evidence: [CI.rsa, RSA + '.gitattributes', RSA + 'README.md (section "Dependency Constraints")'] },
        },
    },
    {
        id: 'SA-11',
        family: 'SA',
        title: 'Developer Testing and Evaluation',
        products: {
            certalert: { status: 'implemented', implementation: 'The build job runs the unit and integration suites (898 test methods in the repository at this revision, Testcontainers PostgreSQL in test-postgres), end-to-end business tests, Helm chart tests, a bundle install, backup and restore run, an image smoke test, the Trivy gate and an axe-core scan of every page that fails on serious or critical WCAG 2.1 A/AA violations.', evidence: [CI.ca, CA + 'src/test', CA + 'a11y/scan.mjs', CA + 'docs/accessibility/wcag-2.1-aa-self-audit.md'] },
            'directory-portal': { status: 'implemented', implementation: 'api-test (366 backend test methods with Testcontainers), web-test (13 Vitest files), Playwright axe-core accessibility checks, Helm tests, bundle installs with podman-compose 1.0.6 and 1.6.0, the image smoke test and Trivy gate. No OpenLDAP, 389-DS or Active Directory job, which the docs\' matrix states.', evidence: [CI.dsp, DSP + 'backend/src/test', DSP + 'web/src', DSP + 'docs/accessibility/wcag-2.1-aa-self-audit.md'] },
            readyroom: { status: 'implemented', implementation: 'build (1,157 JUnit test methods at this revision), windows-client (Pester on Windows and Linux), accessibility (axe-core through Playwright), Helm, bundle, image and Trivy jobs. There is no penetration test of the agent.', evidence: [CI.rr, RR + 'src/test', RR + 'powershell/tests', RR + 'docs/accessibility/wcag-2.1-aa-self-audit.md'] },
            'mfa-portal': { status: 'implemented', implementation: 'build (about 1,040 JUnit test methods across the Portal, Connector, mock Authentication Manager and api modules), accessibility (axe-core with Playwright for Java), compose and podman-bundle installs, Helm, image and Trivy jobs. The Connector has never been run against a real Authentication Manager in CI; its tests use the mock.', evidence: [CI.rsa, RSA + 'rsaapp-portal/src/test', RSA + 'rsaapp-connector/src/test', RSA + 'docs/accessibility/wcag-2.1-aa-self-audit.md'] },
        },
    },
    {
        id: 'SA-15',
        family: 'SA',
        title: 'Development Process, Standards, and Tools',
        products: {
            certalert: { status: 'partial', implementation: 'The process is in the repository: pull requests, CI gates, CodeQL, pinned tools (Trivy and cosign by version with checksums), weekly dependency updates and a release checklist that checks the documentation against the code before a tag. There is no written secure-development standard beyond this pack\'s SSDF evidence document, and the repository\'s review requirements are an organization setting.', evidence: [CI.ca, RELEASES_DOC, 'ens-products-page: compliance/secure-development/ssdf-evidence.md'] },
            'directory-portal': { status: 'partial', implementation: 'As for CertAlert.', evidence: [CI.dsp, 'ens-products-page: compliance/secure-development/ssdf-evidence.md'] },
            readyroom: { status: 'partial', implementation: 'As for CertAlert.', evidence: [CI.rr, 'ens-products-page: compliance/secure-development/ssdf-evidence.md'] },
            'mfa-portal': { status: 'partial', implementation: 'As for CertAlert, without CodeQL.', evidence: [CI.rsa, 'ens-products-page: compliance/secure-development/ssdf-evidence.md'] },
        },
    },
    {
        id: 'SA-22',
        family: 'SA',
        title: 'Unsupported System Components',
        products: {
            certalert: { status: 'implemented', implementation: 'Spring Boot 4.x, Java 21, PostgreSQL 17 and the vendored front-end libraries are current; Dependabot keeps them so. Nothing end-of-life at this revision.', evidence: [CA + 'build.gradle.kts', CA + '.github/dependabot.yml'] },
            'directory-portal': { status: 'implemented', implementation: 'Spring Boot 4.x, Java 21, React 19, Vite 8 and UBI 9 images, all current. The development-only deploy/openldap image builds on Ubuntu 25.10, which is past its support date; it is not part of any release.', evidence: [DSP + 'backend/pom.xml', DSP + 'package.json', DSP + 'deploy/openldap/Dockerfile'] },
            readyroom: { status: 'implemented', implementation: 'Spring Boot 4.x, Java 21, PostgreSQL 16, all current.', evidence: [RR + 'build.gradle', RR + '.github/dependabot.yml'] },
            'mfa-portal': { status: 'partial', implementation: 'The Portal is on Spring Boot 4 and Java 17 and MySQL 8.4 LTS. The Connector runs Spring Framework 3.2.18 and Spring Security 3.2.10 (end of life), log4j 1 and Axis 1.4 on Tomcat 9, because the RSA Authentication Manager SDK (am-client 8.8) is built on them and no later Spring runs it. ENS supports the Connector; its framework vendor does not. The compensating controls are in the vulnerability management policy.', evidence: [RSA + 'rsaapp-connector/pom.xml', RSA + 'README.md (section "Dependency Constraints")', RSA + '.trivyignore', 'ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Record the Connector\'s end-of-life framework as an accepted risk with the compensating controls.' },
        },
    },
    // ------------------------------------------------------------------ SC
    {
        id: 'SC-5',
        family: 'SC',
        title: 'Denial-of-service Protection',
        products: {
            certalert: { status: 'partial', implementation: 'API tokens are rate-limited per token, but the limiter keeps its buckets in memory, so N replicas allow N times requests-per-minute; revocation and webhook fetches are bounded in size, time and redirects; LDAP and HTTP timeouts are set. Network-level protection is the platform\'s.', evidence: [CA + 'src/main/java/com/winllc/certalert/api/ApiRateLimiter.java', CA + 'src/main/java/com/winllc/certalert/revocation/FetchPolicy.java', ca('security')], customerResponsibility: 'Rate-limit and filter at the ingress or load balancer.' },
            'directory-portal': { status: 'partial', implementation: 'Sign-in lockout, failed-token and SSO-start limits are counted per address and, with the shared database, across replicas in one statement; user regular expressions run with a time budget; entry lists stop at 1,000. Network-level protection is the platform\'s.', evidence: [DSP_SRC + 'integration/ApiRateLimiter.java', DSP_SRC + 'service/LoginThrottle.java', dsp('security')], customerResponsibility: 'Rate-limit and filter at the ingress.' },
            readyroom: { status: 'partial', implementation: 'Refused logouts and API tokens are rate-limited, with limits kept in the database (rate_limit_windows) and a memory fallback; LDAP connect and read timeouts bound directory calls. Network-level protection is the platform\'s.', evidence: [RR_SRC + 'security/DatabaseRateLimitStore.java', RR_SRC + 'security/RateLimitConfig.java', rr('security')], customerResponsibility: 'Rate-limit and filter at the ingress.' },
            'mfa-portal': { status: 'partial', implementation: 'Every anonymous step and sign-in is rate-limited per address and per user ID or serial in database-kept windows with backoff, refusals answer 429 with Retry-After before Authentication Manager is asked, and the Connector call has a read timeout. Network-level protection is the platform\'s.', evidence: [RSA_SRC + 'ratelimit/RateLimitFilter.java', RSA_SRC + 'ratelimit/RateLimiter.java', rsa('security')], customerResponsibility: 'Rate-limit and filter at the ingress; give every client its own address.' },
        },
    },
    {
        id: 'SC-7',
        family: 'SC',
        title: 'Boundary Protection',
        products: {
            certalert: { status: 'partial', implementation: 'The Helm chart has a NetworkPolicy (networkPolicy.enabled, off by default) that limits ingress to the application port and egress to DNS, the database, the directory, SMTP and the web; the management port is never on the ingress or route; the release package can bind to 127.0.0.1 behind a proxy; outbound fetches never go to link-local or metadata addresses and can be confined with allowed-hosts. Network segmentation beyond that is the platform\'s.', evidence: [CA + 'deploy/helm/cert-alert/templates/networkpolicy.yaml', CA + 'deploy/helm/cert-alert/values.yaml', CA + 'src/main/java/com/winllc/certalert/webhook/WebhookAddressGuard.java', ca('security')], customerResponsibility: 'Enable the NetworkPolicy or equivalent; keep the management port off every ingress.' },
            'directory-portal': { status: 'partial', implementation: 'The compose files never publish the API (only the web proxy reaches it); the chart\'s NetworkPolicy (off by default) is required with edge-terminated X.509 so that only the ingress controller reaches the web pods; webhook destinations must resolve to public addresses unless allow-listed and cloud metadata is always refused.', evidence: [DSP + 'deploy/helm/directory-services-portal/templates/networkpolicy.yaml', DSP + 'deploy/package/docker/docker-compose.yml', DSP_SRC + 'webhooks/UrlGuard.java', dsp('security')], customerResponsibility: 'Enable the NetworkPolicy; keep the management port off user networks.' },
            readyroom: { status: 'partial', implementation: 'The chart\'s NetworkPolicy (off by default) limits who may reach ReadyRoom\'s port; the management port is never published; webhooks go to public https receivers only (internal ranges only through APPLICATION_WEBHOOKS_ALLOWEDCIDRS) and can go through a CONNECT proxy to the checked address.', evidence: [RR + 'deploy/helm/readyroom/templates/networkpolicy.yaml', RR_SRC + 'webhook/WebhookAddressPolicy.java', RR_SRC + 'webhook/WebhookProxy.java', rr('security')], customerResponsibility: 'Enable the NetworkPolicy; never publish the management port.' },
            'mfa-portal': { status: 'partial', implementation: 'A NetworkPolicy admitting only the Portal\'s pods to the Connector is on by default even when networkPolicy.enabled is false; the compose release publishes no Connector port; the Connector\'s plain HTTP binds to loopback; webhook destinations pass an SSRF guard and cannot use an egress proxy in this release.', evidence: [RSA + 'deploy/helm/rsa-operations-portal/templates/networkpolicy.yaml', RSA + 'deploy/helm/rsa-operations-portal/values.yaml', RSA_SRC + 'webhook/SsrfGuard.java', rsa('security')], customerResponsibility: 'Enable the full NetworkPolicy; do not expose 8080 beyond the host.' },
        },
    },
    {
        id: 'SC-8',
        family: 'SC',
        title: 'Transmission Confidentiality and Integrity',
        products: {
            certalert: { status: 'implemented', implementation: 'Browsers: TLS at CertAlert (TLS 1.2 and 1.3 only) or at your proxy, with HSTS on secure requests. Directory: ldaps:// in the templates. Database: sslmode=verify-full available. Mail: STARTTLS when set. Splunk and syslog: TLS available, certificate checked against the JVM trust store. Webhooks: HTTPS only, HMAC-SHA256 signed.', evidence: [CA + 'src/main/resources/application.yml', CA + 'deploy/release/env.template', CA + 'src/main/java/com/winllc/certalert/webhook/WebhookTransport.java', FIPS_DOC, ca('fips-and-stig')], customerResponsibility: 'Use ldaps://, sslmode=verify-full, STARTTLS and syslog over TLS; terminate TLS in a module you trust.' },
            'directory-portal': { status: 'implemented', implementation: 'HTTPS by nginx (TLS 1.2 and 1.3 in the mtls configuration) or your proxy; ldaps:// or StartTLS to the directory with certificate checking; Splunk and syslog over TLS available; webhooks HTTPS only and HMAC-SHA256 signed; the API is never published in clear beyond the host by default.', evidence: [DSP + 'web/nginx/templates-mtls/default.conf.template', DSP + 'deploy/package/docker/install.sh', DSP_SRC + 'webhooks/WebhookSender.java', dsp('fips-and-stig')], customerResponsibility: 'Put TLS in front; keep LDAP_TLS_REJECT_UNAUTHORIZED=true.' },
            readyroom: { status: 'implemented', implementation: 'HTTPS at ReadyRoom (JDK defaults; no TLS 1.1) or at your proxy; ldaps:// default; STARTTLS required for mail by default with the certificate checked; the agent validates the server certificate; webhooks HTTPS only and signed; PostgreSQL TLS by URL parameters.', evidence: [RR_SRC + 'config/MailConfig.java', RR + 'deploy/bundle/env.template', RR_SRC + 'webhook/WebhookSignature.java', rr('fips-and-stig')], customerResponsibility: 'Use ldaps://, sslmode=verify-full and a verified mail server certificate.' },
            'mfa-portal': { status: 'partial', implementation: 'HTTPS at the Portal or ingress; Portal to Connector over TLS 1.2 or 1.3 with mutual TLS in new installations; Connector to Authentication Manager over TLS with chain and host-name checks; MySQL with sslMode=REQUIRED; LDAPS to Active Directory verified. SMTP is port 25 with no TLS configured in the templates, which the FIPS page states.', evidence: [RSA + 'util/connector-tls.sh', RSA_CONN + 'security/HostnameCheckingSocketFactory.java', RSA + 'deploy/helm/rsa-operations-portal/values.yaml', rsa('fips-and-stig')], customerResponsibility: 'Configure TLS for SMTP in your mail settings; keep sslMode=REQUIRED.' },
        },
    },
    {
        id: 'SC-8(1)',
        family: 'SC',
        title: 'Transmission Confidentiality and Integrity | Cryptographic Protection',
        products: {
            certalert: { status: 'inherited', implementation: 'The TLS implementation is the Java runtime\'s (JSSE); CertAlert sets protocols (1.2 and 1.3) and no cipher list, so the system crypto policy applies. On a FIPS-mode RHEL host the runtime uses its FIPS providers.', evidence: [FIPS_DOC, ca('fips-and-stig')], customerResponsibility: 'Run on a host whose cryptographic modules meet your requirements.' },
            'directory-portal': { status: 'inherited', implementation: 'TLS comes from OpenSSL through nginx and from JSSE in the API; no cipher list is set.', evidence: [FIPS_DOC, dsp('fips-and-stig')], customerResponsibility: 'Run on a host whose cryptographic modules meet your requirements.' },
            readyroom: { status: 'inherited', implementation: 'TLS comes from JSSE; ReadyRoom sets no protocol or cipher list. The Windows agent uses Windows\' own TLS.', evidence: [FIPS_DOC, rr('fips-and-stig')], customerResponsibility: 'Run on a host whose cryptographic modules meet your requirements.' },
            'mfa-portal': { status: 'inherited', implementation: 'TLS comes from JSSE in the Portal and the Connector (protocols 1.3 and 1.2 set, no cipher list); the Connector\'s start script uses openssl to build its PKCS12 store; what the RSA SDK uses is RSA\'s to state.', evidence: [FIPS_DOC, rsa('fips-and-stig')], customerResponsibility: 'Run on a host whose cryptographic modules meet your requirements.' },
        },
    },
    {
        id: 'SC-12',
        family: 'SC',
        title: 'Cryptographic Key Establishment and Management',
        products: {
            certalert: { status: 'customer', implementation: 'TLS keys, trust stores and the directory\'s certificates are the customer\'s, kept in the release package\'s tls/ directory or Kubernetes Secrets, never in the image. ENS manages two keys that touch the product: the license signing keys (Ed25519 and ECDSA P-256, public halves built in as EnsKeys) and the release GPG key, kept offline and separate from the license key. The webhook signing-secret key is generated by the installer on new installations.', evidence: [CA + 'src/main/java/com/winllc/certalert/license/EnsKeys.java', CA + 'deploy/release/install.sh', suite('licensing'), RELEASES_DOC], customerResponsibility: 'Manage TLS keys, trust stores and the webhook secret key; keep the secret key with your backups.' },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert; DSP_SECRETS_KEY is generated by the Docker, native and Helm installs on new installations and the chart keeps it across upgrades; the LDAP bind password and X.509 proxy secret are mounted as files in the chart.', evidence: [DSP_SRC + 'license/EnsKeys.java', DSP + 'deploy/package/docker/install.sh', DSP + 'deploy/helm/directory-services-portal/templates/_helpers.tpl', suite('licensing')], customerResponsibility: 'Manage TLS keys and trust stores; keep DSP_SECRETS_KEY apart from the backups.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert; ReadyRoom ships no keystore or truststore and refuses to start with TLS on until both are set; the Kerberos keytab is mounted read-only or from a Secret.', evidence: [RR_SRC + 'license/EnsKeys.java', RR_SRC + 'config/SslStoresCheck.java', suite('licensing')], customerResponsibility: 'Manage keystore, truststore, CA and keytab; never trust the retired development CA.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert; the Portal-to-Connector CA and certificates are made by util/connector-tls.sh (ECDSA P-256, the Connector key AES-256-CBC encrypted) or Helm\'s genCA, or supplied in connector.tls.existingSecret; Authentication Manager credentials and the trust store password are read from files or Secrets, never JAVA_OPTS; the help-desk code key is in rsa.helpdesk.code-key.', evidence: [RSA_SRC + 'license/EnsKeys.java', RSA + 'util/connector-tls.sh', RSA + 'util/helpdesk-code-key.sh', suite('licensing')], customerResponsibility: 'Manage the Connector CA, AM trust store and the help-desk code key.' },
        },
    },
    {
        id: 'SC-13',
        family: 'SC',
        title: 'Cryptographic Protection',
        products: {
            certalert: { status: 'partial', implementation: 'No cryptography of ENS\'s own: TLS, certificate path validation, OCSP and CRL checks, SHA-256 (fingerprints, audit chain, token hashes), HMAC-SHA256 (webhook signatures), AES-GCM (stored webhook secrets), SecureRandom and the license signature check (Ed25519, or ECDSA P-256 on a runtime without Ed25519) all go through the Java runtime\'s providers. ENS supplies no FIPS 140-3 validated module and has not run the application end to end in FIPS mode; on a FIPS-mode RHEL host Red Hat\'s OpenJDK switches to its FIPS providers, which the license library\'s tests exercise.', evidence: [CA + 'src/main/java/com/winllc/certalert/webhook/WebhookSecretEncryption.java', CA + 'src/main/java/com/enssolutions/license', FIPS_DOC, ca('fips-and-stig'), suite('licensing')], customerResponsibility: 'Choose and configure the validated modules (host, runtime, proxy, database).' },
            'directory-portal': { status: 'partial', implementation: 'As for CertAlert: JSSE and OpenSSL (nginx) for TLS, SHA-256 for the audit chain and token hashes, HMAC-SHA256 webhook signatures, AES-256-GCM envelope encryption of stored secrets, Ed25519 or P-256 license check. No validated module of ENS\'s; not run in FIPS mode.', evidence: [DSP_SRC + 'secrets/SecretBox.java', DSP_SRC + 'x509/RevocationChecker.java', FIPS_DOC, dsp('fips-and-stig')], customerResponsibility: 'Choose and configure the validated modules.' },
            readyroom: { status: 'partial', implementation: 'As for CertAlert: JSSE, PKIX revocation, SHA-256, HMAC-SHA256, AES-256-GCM for stored webhook secrets, SecureRandom, Ed25519 or P-256 license check. Kerberos sign-in and the Windows agent have not been run under FIPS policy.', evidence: [RR_SRC + 'webhook/SecretBox.java', RR_SRC + 'security/x509/RevocationChecker.java', FIPS_DOC, rr('fips-and-stig')], customerResponsibility: 'Choose and configure the validated modules.' },
            'mfa-portal': { status: 'partial', implementation: 'As for CertAlert: JSSE, SHA-256 (audit chain, rate-limit keys, token hashes), HMAC-SHA256 (help-desk codes, webhook signatures), AES-GCM for stored webhook secrets, Ed25519 or P-256 license check. The RSA SDK\'s cryptography is RSA\'s to state; neither the Portal, the Connector nor the SDK has been run in FIPS mode.', evidence: [RSA_SRC + 'webhook/SecretBox.java', RSA_SRC + 'helpdesk/EmailCodeKey.java', FIPS_DOC, rsa('fips-and-stig')], customerResponsibility: 'Choose and configure the validated modules; confirm the SDK\'s FIPS status with RSA.' },
        },
    },
    {
        id: 'SC-23',
        family: 'SC',
        title: 'Session Authenticity',
        products: {
            certalert: { status: 'implemented', implementation: 'A new session id on the first signed-in request; HttpOnly, SameSite=Lax cookies, Secure over TLS or with ENS_COOKIE_SECURE; session ids from SecureRandom; stored session attributes read back through an allow-list of types, refusing deserialization gadgets; CSRF tokens on every state-changing request; SAML assertions used once and OIDC nonce checked.', evidence: [CA + 'src/main/java/com/winllc/certalert/session/SessionAttributeSerialization.java', CA_SEC + 'SecurityConfig.java', CA_SEC + 'sso/JdbcSaml2AuthenticationRequests.java', ca('security')] },
            'directory-portal': { status: 'implemented', implementation: 'Session id rotated at sign-in and invalidated at sign-out; DSP_SESSION cookie HttpOnly, SameSite=Strict, Secure with TLS; the X-DSP-Request header check on state-changing requests; replayed SAML assertions and IdP-initiated responses refused.', evidence: [DSP_SRC + 'config/SecurityConfig.java', DSP_SRC + 'config/RequestHeaderCsrfFilter.java', DSP_SRC + 'sso/SsoStateStore.java', dsp('security')] },
            readyroom: { status: 'implemented', implementation: 'HttpOnly, SameSite=Lax, Secure cookies; CSRF tokens; one use per SAML assertion across replicas; a one-use session continuation for single sign-out; CSP nonces per request.', evidence: [RR_SRC + 'config/BrowserSessionConfig.java', RR_SRC + 'security/sso/SamlRequestStore.java', RR_SRC + 'security/sso/SsoLogout.java', rr('security')] },
            'mfa-portal': { status: 'implemented', implementation: 'HttpOnly, SameSite=Lax, Secure cookies; CSRF on every non-GET; sessions in the database read back only through a class allow-list with depth and size limits; SAML logout requests kept once-only in the database; OIDC nonce and SAML InResponseTo checked.', evidence: [RSA_SRC + 'session/SessionAttributeCodec.java', RSA_SRC + 'sso/JdbcSamlLogoutRequests.java', RSA_SRC + 'configuration/WebSecurityConfig.java', rsa('security')] },
        },
    },
    {
        id: 'SC-28',
        family: 'SC',
        title: 'Protection of Information at Rest',
        products: {
            certalert: { status: 'partial', implementation: 'Webhook signing secrets are encrypted at rest under cert-alert.webhooks.secret-key (AES); API and audit tokens are stored as SHA-256 hashes; no passwords are stored. Certificate inventory, contacts and the audit trail are in PostgreSQL in clear, so encryption of the database and its backups is the customer\'s.', evidence: [CA + 'src/main/java/com/winllc/certalert/webhook/WebhookSecretEncryption.java', CA + 'src/main/java/com/winllc/certalert/api/ApiTokens.java', ca('security')], customerResponsibility: 'Encrypt the database volume and backups.' },
            'directory-portal': { status: 'partial', implementation: 'Webhook signing secrets are encrypted with per-value AES-256-GCM data keys wrapped by DSP_SECRETS_KEY; tokens are hashed; the bind password can be read from a file. Configuration, the audit store and analysis results are on disk or in PostgreSQL in clear.', evidence: [DSP_SRC + 'secrets/SecretBox.java', DSP_SRC + 'webhooks/Webhooks.java', dsp('webhooks')], customerResponsibility: 'Encrypt the data directory, database and backups; keep DSP_SECRETS_KEY apart from them.' },
            readyroom: { status: 'partial', implementation: 'Webhook signing secrets encrypted (AES-256-GCM) under APPLICATION_WEBHOOKS_SECRETKEY; tokens hashed; the agent\'s session file readable only by the user, SYSTEM and Administrators. Attendance records and the audit trail are in PostgreSQL in clear.', evidence: [RR_SRC + 'webhook/SecretBox.java', RR_SRC + 'audit/TokenSecrets.java', rr('windows-client')], customerResponsibility: 'Encrypt the database volume and backups.' },
            'mfa-portal': { status: 'partial', implementation: 'Webhook secrets AES-GCM encrypted under a key derived from rsa.helpdesk.code-key; help-desk e-mailed codes kept only as HMACs; rate-limit keys as SHA-256; no passcode, PIN or emergency code written to the session table; settings files mode 600/640. The MySQL database holds sites, shipments, requests and the audit trail in clear.', evidence: [RSA_SRC + 'webhook/SecretBox.java', RSA_SRC + 'helpdesk/EmailCodeKey.java', RSA + 'util/file-owners.sh', rsa('security')], customerResponsibility: 'Encrypt the database volume and backups.' },
        },
    },
    {
        id: 'SC-28(1)',
        family: 'SC',
        title: 'Protection of Information at Rest | Cryptographic Protection',
        products: {
            certalert: { status: 'customer', implementation: 'Beyond the stored secrets named in SC-28, encryption at rest is the database\'s and the volume\'s (PostgreSQL TDE or disk encryption on the host or storage class).', evidence: [ca('availability-and-sizing')], customerResponsibility: 'Encrypt the database and volumes.' },
            'directory-portal': { status: 'customer', implementation: 'As for CertAlert, for the data directory or PostgreSQL.', evidence: [dsp('availability-and-sizing')], customerResponsibility: 'Encrypt the data directory, database and volumes.' },
            readyroom: { status: 'customer', implementation: 'As for CertAlert.', evidence: [rr('availability-and-sizing')], customerResponsibility: 'Encrypt the database and volumes.' },
            'mfa-portal': { status: 'customer', implementation: 'As for CertAlert, for MySQL.', evidence: [rsa('availability-and-sizing')], customerResponsibility: 'Encrypt the database and volumes.' },
        },
    },
    {
        id: 'SC-39',
        family: 'SC',
        title: 'Process Isolation',
        products: {
            certalert: { status: 'inherited', implementation: 'Isolation is the container runtime\'s and the kernel\'s. The chart runs the pod as non-root (uid 185) with a read-only root file system, no capabilities, no privilege escalation and the RuntimeDefault seccomp profile; the image is compatible with the OpenShift restricted SCC.', evidence: [CA + 'deploy/helm/cert-alert/values.yaml', CA + 'Dockerfile', ca('fips-and-stig')] },
            'directory-portal': { status: 'inherited', implementation: 'Both containers run as unprivileged users with read-only root file systems, dropped capabilities and seccomp in the chart and the Docker package; the native package\'s systemd unit sandboxes the API.', evidence: [DSP + 'deploy/helm/directory-services-portal/values.yaml', DSP + 'deploy/package/native/directory-services-portal.service', dsp('security')] },
            readyroom: { status: 'inherited', implementation: 'The chart runs ReadyRoom as uid 185 with a read-only root file system, no capabilities and RuntimeDefault seccomp.', evidence: [RR + 'deploy/helm/readyroom/values.yaml', RR + 'Dockerfile'] },
            'mfa-portal': { status: 'inherited', implementation: 'The chart runs the Portal (uid 1001), the Connector and the embedded MySQL with all capabilities dropped, no privilege escalation, read-only root file systems and RuntimeDefault seccomp; the Connector runs as the tomcat user.', evidence: [RSA + 'deploy/helm/rsa-operations-portal/values.yaml', RSA + 'rsaapp-connector/Dockerfile', rsa('security')] },
        },
    },
    // ------------------------------------------------------------------ SI
    {
        id: 'SI-2',
        family: 'SI',
        title: 'Flaw Remediation',
        products: {
            certalert: { status: 'implemented', implementation: 'Dependabot proposes weekly updates (minor and patch grouped, majors alone) for Gradle dependencies, the digest-pinned base images, GitHub Actions and the a11y packages; the Trivy gate fails the build on a fixable HIGH or CRITICAL finding; fixes ship as signed releases downloaded from the licensing portal, and the support policy gives a release security fixes for twelve months. The remediation targets by severity are in the vulnerability management policy.', evidence: [CA + '.github/dependabot.yml', CI.ca, 'ens-products-page: src/pages/support.astro', 'ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Install releases within your patch window; patch the host, database and directory.' },
            'directory-portal': { status: 'implemented', implementation: 'As for CertAlert, for Maven, npm, Docker and Actions.', evidence: [DSP + '.github/dependabot.yml', CI.dsp, 'ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Install releases within your patch window.' },
            readyroom: { status: 'implemented', implementation: 'As for CertAlert, for Gradle, Docker and Actions; version overrides in build.gradle carry security fixes ahead of Spring Boot where needed.', evidence: [RR + '.github/dependabot.yml', RR + 'build.gradle', CI.rr, 'ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Install releases within your patch window; redeploy the agent when it changes.' },
            'mfa-portal': { status: 'partial', implementation: 'As for CertAlert for Maven, Docker and Actions, but the Connector\'s Spring 3.2 line cannot be upgraded (the RSA SDK requires it) and the base image digest is updated by hand. Flaws in that stack are handled by risk acceptance with an expiry rather than by patching; the Trivy gate still fails the build when an accepted entry expires.', evidence: [RSA + '.github/dependabot.yml', RSA + '.trivyignore', CI.rsa, 'ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Install releases within your patch window.' },
        },
    },
    {
        id: 'SI-3',
        family: 'SI',
        title: 'Malicious Code Protection',
        products: {
            certalert: { status: 'not-applicable', implementation: 'The application executes no uploaded code and offers no file execution; malicious-code protection is the host\'s and endpoint\'s. Dependencies and images are scanned for known vulnerabilities (RA-5) and images are signed (SI-7).', evidence: [CI.ca], customerResponsibility: 'Run anti-malware on hosts and workstations as your policy requires.' },
            'directory-portal': { status: 'not-applicable', implementation: 'As for CertAlert; CSV and LDIF imports are parsed as data, never executed.', evidence: [CI.dsp], customerResponsibility: 'Run anti-malware on hosts as your policy requires.' },
            readyroom: { status: 'not-applicable', implementation: 'As for CertAlert for the server. The Windows agent is PowerShell installed by the customer; its scripts are unsigned in this release, so AppLocker or WDAC policies that require signatures cannot allow them by signature.', evidence: [CI.rr, RR + 'powershell/Install-InOutWorker.ps1'], customerResponsibility: 'Run anti-malware on hosts and workstations; install the agent under Program Files as the installer does.' },
            'mfa-portal': { status: 'not-applicable', implementation: 'As for CertAlert; the Connector\'s deserialization filters (SI-10) bound what Authentication Manager\'s replies may instantiate.', evidence: [CI.rsa], customerResponsibility: 'Run anti-malware on hosts as your policy requires.' },
        },
    },
    {
        id: 'SI-4',
        family: 'SI',
        title: 'System Monitoring',
        products: {
            certalert: { status: 'implemented', implementation: 'Prometheus metrics (ens_* gauges and counters) on a separate management port with a ServiceMonitor and a PrometheusRule of alert rules in the chart; ECS-style JSON logs; health endpoints with liveness and readiness; the audit trail to the SIEM with alert-severity events for lockouts, a broken chain and failed delivery.', evidence: [CA + 'src/main/java/com/winllc/certalert/observability/EnsMetrics.java', CA + 'deploy/helm/cert-alert/templates/prometheusrule.yaml', CA + 'deploy/helm/cert-alert/templates/servicemonitor.yaml', ca('operator-guide')], customerResponsibility: 'Scrape the metrics, collect the logs and alert on them.' },
            'directory-portal': { status: 'implemented', implementation: 'Prometheus metrics on the management port with a ServiceMonitor; readiness fails when the directory does not answer, the audit log is not writable or the data disk is full; audit delivery status on the audit page.', evidence: [DSP_SRC + 'config/Observability.java', DSP + 'deploy/helm/directory-services-portal/templates/servicemonitor.yaml', dsp('operator-guide')], customerResponsibility: 'Scrape, collect and alert.' },
            readyroom: { status: 'implemented', implementation: 'Prometheus metrics (ens_* and business metrics) on the management port with a ServiceMonitor; health probes; audit alerts.', evidence: [RR_SRC + 'metrics/EnsMetrics.java', RR_SRC + 'metrics/BusinessMetrics.java', RR + 'deploy/helm/readyroom/templates/servicemonitor.yaml', rr('operator-guide')], customerResponsibility: 'Scrape, collect and alert.' },
            'mfa-portal': { status: 'implemented', implementation: 'Prometheus ens_* metrics on the management port with a ServiceMonitor; health with database, Connector and disk details for PMO; request ids across both hops; ECS JSON logs available for both; a start-up warning when the lost-token report is unaddressed.', evidence: [RSA_SRC + 'metrics/PortalMetrics.java', RSA + 'deploy/helm/rsa-operations-portal/templates/servicemonitor.yaml', RSA_CONN + 'logging/EcsJsonLayout.java', rsa('operator-guide')], customerResponsibility: 'Scrape, collect and alert.' },
        },
    },
    {
        id: 'SI-5',
        family: 'SI',
        title: 'Security Alerts, Advisories, and Directives',
        products: {
            certalert: { status: 'partial', implementation: 'Advisories reach ENS through Dependabot, Trivy\'s database, CodeQL and reports to the disclosure address, and reach customers as release notes and the support policy\'s end-of-support e-mails. There is no customer security-advisory mailing list or advisory page yet; the vulnerability management policy says what ENS commits to.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md', 'ens-products-page: src/pages/support.astro', 'ens-products-page: src/pages/trust.astro'], customerResponsibility: 'Subscribe the account holder address to ENS release e-mails; track advisories for the host, database and directory.' },
            'directory-portal': { status: 'partial', implementation: 'As for CertAlert.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'As for CertAlert.' },
            readyroom: { status: 'partial', implementation: 'As for CertAlert.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'As for CertAlert.' },
            'mfa-portal': { status: 'partial', implementation: 'As for CertAlert; RSA\'s advisories for Authentication Manager and the SDK are RSA\'s.', evidence: ['ens-products-page: compliance/vulnerability-management-policy.md'], customerResponsibility: 'Track RSA\'s advisories for Authentication Manager.' },
        },
    },
    {
        id: 'SI-7',
        family: 'SI',
        title: 'Software, Firmware, and Information Integrity',
        products: {
            certalert: { status: 'implemented', implementation: 'On a release tag CI signs the image and the Helm chart with cosign (keyless, Sigstore, the workflow\'s GitHub OIDC identity, by digest), attaches the SPDX SBOM as a signed attestation, records SLSA build provenance with actions/attest-build-provenance (verifiable with gh attestation verify), and signs SHA256SUMS with the ENS release GPG key when that key is configured. The license file is signature-checked offline; the audit trail is hash-chained.', evidence: [CI.ca, RELEASES_DOC, suite('licensing')], customerResponsibility: 'Verify signatures, attestations and checksums before deploying; check the GPG fingerprint out of band.' },
            'directory-portal': { status: 'implemented', implementation: 'Both images and the chart signed with cosign on release tags, SPDX SBOM attestations on both images, GPG-signed checksums when the key is set. No SLSA provenance attestation in this repository.', evidence: [CI.dsp, RELEASES_DOC, dsp('security')], customerResponsibility: 'Verify before deploying.' },
            readyroom: { status: 'implemented', implementation: 'Image and chart signed with cosign on release tags, the image\'s SPDX SBOM attested, GPG-signed checksums when the key is set. No SLSA provenance attestation. The Windows agent scripts are not code-signed.', evidence: [CI.rr, RELEASES_DOC, RR + 'powershell/tasks'], customerResponsibility: 'Verify before deploying; control the agent\'s install folder permissions as the installer sets them.' },
            'mfa-portal': { status: 'implemented', implementation: 'Portal and Connector images and the chart signed with cosign on release tags, both images\' SBOMs attested, GPG-signed checksums when the key is set. No SLSA provenance attestation.', evidence: [CI.rsa, RELEASES_DOC, RSA + 'README.md (section "Releases")'], customerResponsibility: 'Verify before deploying.' },
        },
    },
    {
        id: 'SI-7(1)',
        family: 'SI',
        title: 'Software, Firmware, and Information Integrity | Integrity Checks',
        products: {
            certalert: { status: 'partial', implementation: 'Integrity checks are available at install time (cosign verify, cosign verify-attestation, gh attestation verify, gpg --verify, sha256sum -c) and for the audit trail at any time (Verify integrity, verify_chain.py). There is no runtime self-check of the deployed binaries; that is the platform\'s (image digests, admission policy).', evidence: [RELEASES_DOC, CA + 'src/main/java/com/winllc/certalert/audit/AuditVerifier.java'], customerResponsibility: 'Pin deployments by digest and enforce signature verification with an admission controller where available.' },
            'directory-portal': { status: 'partial', implementation: 'As for CertAlert, without the provenance check.', evidence: [RELEASES_DOC, DSP_SRC + 'audit/AuditStore.java'], customerResponsibility: 'As for CertAlert.' },
            readyroom: { status: 'partial', implementation: 'As for CertAlert, without the provenance check.', evidence: [RELEASES_DOC, RR_SRC + 'audit/AuditChainHead.java'], customerResponsibility: 'As for CertAlert.' },
            'mfa-portal': { status: 'partial', implementation: 'As for CertAlert, without the provenance check.', evidence: [RELEASES_DOC, RSA_SRC + 'audit/AuditVerifier.java'], customerResponsibility: 'As for CertAlert.' },
        },
    },
    {
        id: 'SI-10',
        family: 'SI',
        title: 'Information Input Validation',
        products: {
            certalert: { status: 'implemented', implementation: 'Request bodies are validated with Jakarta Bean Validation on the DTOs; CSRF tokens on every state-changing request; webhook and revocation destinations pass an address guard (no link-local, metadata or, by default, private addresses; at most three redirects; size and time limits); CSV and XLSX exports neutralise cells that a spreadsheet would run as formulas; LDAP values are escaped.', evidence: [CA + 'src/main/java/com/winllc/certalert/web/dto/ProjectRequest.java', CA + 'src/main/java/com/winllc/certalert/webhook/WebhookAddressGuard.java', CA + 'src/main/java/com/winllc/certalert/export/CsvTableWriter.java', ca('security')] },
            'directory-portal': { status: 'implemented', implementation: 'FormValidator re-checks every write on the server (required fields, single-value rules, options, formats, patterns); LDAP filters are built with the UnboundID filter API and DNs with RFC 4514 escaping; admin-supplied filters and DNs are validated (@LdapFilter, @ValidDn); user regular expressions run with a time budget; the X-DSP-Request header check replaces CSRF tokens; webhook URLs pass UrlGuard; CSV export neutralises formulas.', evidence: [DSP_SRC + 'service/FormValidator.java', DSP_SRC + 'web/validation/LdapFilter.java', DSP_SRC + 'web/validation/ValidDn.java', DSP_SRC + 'webhooks/UrlGuard.java', DSP_SRC + 'transfer/Csv.java', dsp('security')] },
            readyroom: { status: 'implemented', implementation: 'CSRF on every POST, PUT and DELETE except the agent\'s JSON-only check-in calls; LDAP search terms escaped; webhook addresses checked against WebhookAddressPolicy with no redirects; CSV and XLSX exports neutralise formula cells; the Kerberos account name must match exactly one directory user; a check-in date range is capped at 366 days.', evidence: [RR_SRC + 'config/SecurityConfig.java', RR_SRC + 'webhook/WebhookAddressPolicy.java', RR_SRC + 'export/CsvTableWriter.java', rr('security')] },
            'mfa-portal': { status: 'implemented', implementation: 'Form validators for PINs, sites, Trusted Agents and appointment requests; CSRF on every non-GET; the Hessian endpoint rebuilds only allow-listed classes (deny-all default) and Authentication Manager\'s replies pass a JEP 290 filter with depth, reference, array and size limits; webhook destinations pass SsrfGuard; the audit CSV neutralises formula cells; user IDs and serials are escaped before logging and CR/LF are encoded.', evidence: [RSA_SRC + 'validators/PinFormValidator.java', RSA_CONN + 'security/AllowListHessianServiceExporter.java', RSA_CONN + 'security/AuthManagerReplyFilter.java', RSA_SRC + 'webhook/SsrfGuard.java', RSA_SRC + 'audit/AuditAdminController.java', rsa('security')] },
        },
    },
    {
        id: 'SI-11',
        family: 'SI',
        title: 'Error Handling',
        products: {
            certalert: { status: 'implemented', implementation: 'server.error.include-message: never; API refusals are problem-detail bodies without stack traces; sign-in failures give no cause; log lines from sign-ins are kept to one line (LogSafe) so request data cannot forge entries.', evidence: [CA + 'src/main/resources/application.yml', CA + 'src/main/java/com/winllc/certalert/LogSafe.java', ca('security')] },
            'directory-portal': { status: 'implemented', implementation: 'JSON error bodies with codes, no stack traces; one sign-in failure message; the audit page says when a search stopped at its scan limit.', evidence: [DSP_SRC + 'config/JsonErrors.java', dsp('security')] },
            readyroom: { status: 'implemented', implementation: 'API errors are structured (ApiError) and pages show the Unauthorized or error page; refused logouts are collapsed into one audited event per address and minute; DN values are wrapped in LogSafe.', evidence: [RR_SRC + 'api/ApiError.java', RR_SRC + 'api/ApiExceptionHandler.java', rr('security')] },
            'mfa-portal': { status: 'implemented', implementation: 'Uniform answers on sign-in and every anonymous step, padded to a uniform response time, with the cause only in the audit trail; Tomcat error pages in the Connector show neither stack traces nor the server version; CR and LF in log messages are escaped.', evidence: [RSA_SRC + 'ratelimit/UniformResponses.java', RSA_SRC + 'ratelimit/SelfServiceFailures.java', RSA_CONN + 'logging/CrlfSafePatternLayout.java', rsa('security')] },
        },
    },
    {
        id: 'SI-12',
        family: 'SI',
        title: 'Information Management and Retention',
        products: {
            certalert: { status: 'partial', implementation: 'Audit retention is configurable (AU-11) and certificate clean-up and prune jobs remove stale directory data on the administrator\'s instruction; the inventory itself has no retention schedule beyond that.', evidence: [CA + 'src/main/java/com/winllc/certalert/audit/AuditRetention.java', ca('admin-guide')], customerResponsibility: 'Set retention to your records schedule.' },
            'directory-portal': { status: 'partial', implementation: 'Audit retention is configurable; the portal stores directory data only transiently, with configuration and analysis results on disk under the customer\'s retention.', evidence: [DSP_SRC + 'audit/AuditLifecycle.java', dsp('operator-guide')], customerResponsibility: 'Set retention to your records schedule.' },
            readyroom: { status: 'implemented', implementation: 'A retention job purges attendance records past the configured period with roll-ups, each run audited as data.purged and serialised across instances; a person\'s data can be exported and erased (person.erased), erasure working even while read-only; the privacy page states what is stored, where, for how long and who sees it.', evidence: [RR_SRC + 'service/RetentionService.java', rr('privacy'), rr('admin-guide')], customerResponsibility: 'Set the retention period and visibility policy.' },
            'mfa-portal': { status: 'partial', implementation: 'Audit retention is configurable; help-desk requests expire; expired unassigned tokens are taken back by a job. Other records (sites, shipments, appointments) have no retention schedule in the product.', evidence: [RSA_SRC + 'audit/AuditRetention.java', RSA_SRC + 'helpdesk/HelpDeskRequestStatus.java', rsa('admin-guide')], customerResponsibility: 'Set retention to your records schedule.' },
        },
    },
    {
        id: 'SI-16',
        family: 'SI',
        title: 'Memory Protection',
        products: {
            certalert: { status: 'inherited', implementation: 'Memory safety is the Java runtime\'s; the kernel\'s and runtime\'s protections apply, and the chart forbids privilege escalation and drops capabilities. Deserialization of stored sessions and of webhook deliveries is confined to allow-listed types.', evidence: [CA + 'src/main/java/com/winllc/certalert/session/SessionAttributeSerialization.java', CA + 'deploy/helm/cert-alert/values.yaml'] },
            'directory-portal': { status: 'inherited', implementation: 'As for CertAlert; the native package\'s systemd unit adds a system-call filter and address-family restrictions.', evidence: [DSP + 'deploy/package/native/directory-services-portal.service'] },
            readyroom: { status: 'inherited', implementation: 'As for CertAlert.', evidence: [RR + 'deploy/helm/readyroom/values.yaml'] },
            'mfa-portal': { status: 'inherited', implementation: 'As for CertAlert; the Connector reads Authentication Manager\'s replies through a JEP 290 filter and refuses to start on a JVM without serialization filters.', evidence: [RSA_CONN + 'security/JdkSerialFilter.java', RSA + 'deploy/helm/rsa-operations-portal/values.yaml'] },
        },
    },
    // ------------------------------------------------------------------ SR
    {
        id: 'SR-2',
        family: 'SR',
        title: 'Supply Chain Risk Management Plan',
        products: {
            certalert: { status: 'partial', implementation: 'ENS\'s practice is written in the software supply-chain security document of this pack: component sources, base-image policy, build integrity, signing, release channels and verification. A plan with named owners and review dates beyond that document does not yet exist.', evidence: ['ens-products-page: compliance/supply-chain/software-supply-chain-security.md', FIPS_DOC], customerResponsibility: 'Include the products in your own supply chain risk management plan.' },
            'directory-portal': { status: 'partial', implementation: 'As for CertAlert.', evidence: ['ens-products-page: compliance/supply-chain/software-supply-chain-security.md'], customerResponsibility: 'As for CertAlert.' },
            readyroom: { status: 'partial', implementation: 'As for CertAlert.', evidence: ['ens-products-page: compliance/supply-chain/software-supply-chain-security.md'], customerResponsibility: 'As for CertAlert.' },
            'mfa-portal': { status: 'partial', implementation: 'As for CertAlert, with the vendored RSA SDK as a named risk.', evidence: ['ens-products-page: compliance/supply-chain/software-supply-chain-security.md', RSA + 'README.md (section "Dependency Constraints")'], customerResponsibility: 'As for CertAlert.' },
        },
    },
    {
        id: 'SR-3',
        family: 'SR',
        title: 'Supply Chain Controls and Processes',
        products: {
            certalert: { status: 'implemented', implementation: 'Dependencies come from Maven Central through Gradle with versions declared in the build; base images from Red Hat\'s registry by digest; GitHub Actions by commit SHA; Trivy and cosign downloaded by version with a checksum check; weekly Dependabot review; every pull request builds the full bundle as a dry run.', evidence: [CA + 'build.gradle.kts', CA + 'Dockerfile', CI.ca, CA + '.github/dependabot.yml'] },
            'directory-portal': { status: 'implemented', implementation: 'Maven Central and npm (package-lock.json) with npm audit in CI; base images by digest; Actions by SHA; weekly Dependabot.', evidence: [DSP + 'backend/pom.xml', DSP + 'package-lock.json', CI.dsp, DSP + '.github/dependabot.yml'] },
            readyroom: { status: 'implemented', implementation: 'Maven Central through Gradle; base images by digest; Actions by SHA; weekly Dependabot with a rule keeping the build JDK on Java 21.', evidence: [RR + 'build.gradle', RR + 'Dockerfile', CI.rr, RR + '.github/dependabot.yml'] },
            'mfa-portal': { status: 'partial', implementation: 'Maven Central through the Maven reactor; base images by digest through build arguments updated by hand; Actions by SHA; weekly Dependabot. The RSA Authentication Manager SDK jars (am-client 8.8 and the libraries RSA ships with it) are vendored under Git LFS, identical copies in three modules, and cannot be updated independently of RSA.', evidence: [RSA + 'pom.xml', RSA + '.gitattributes', RSA + 'rsaapp-connector/rsa-lib', RSA + '.github/dependabot.yml', RSA + 'README.md (section "Dependency Constraints")'] },
        },
    },
    {
        id: 'SR-4',
        family: 'SR',
        title: 'Provenance',
        products: {
            certalert: { status: 'implemented', implementation: 'The image carries a SLSA build provenance attestation naming the workflow, commit and runner that built it, signed through Sigstore and recorded on the repository; the SBOM attestation and cosign signature are bound to the image digest; the release bundle is built from the same tested images and its checksums are GPG-signed.', evidence: [CI.ca, RELEASES_DOC] },
            'directory-portal': { status: 'partial', implementation: 'Cosign signatures and SBOM attestations bind the images and chart to the release workflow\'s identity (certificate identity https://github.com/winllc/directory-services-portal/.github/workflows/*). There is no SLSA provenance attestation in this repository.', evidence: [CI.dsp, RELEASES_DOC] },
            readyroom: { status: 'partial', implementation: 'As for the Directory Services Portal, with the identity under winllc/in-n-out-work; no SLSA provenance attestation.', evidence: [CI.rr, RELEASES_DOC] },
            'mfa-portal': { status: 'partial', implementation: 'As for the Directory Services Portal, with the identity under winllc/rsa-operations-portal; no SLSA provenance attestation. The provenance of the RSA SDK jars is RSA\'s distribution, vendored by ENS.', evidence: [CI.rsa, RELEASES_DOC, RSA + 'rsaapp-connector/rsa-lib'] },
        },
    },
    {
        id: 'SR-10',
        family: 'SR',
        title: 'Inspection of Systems or Components',
        products: {
            certalert: { status: 'implemented', implementation: 'Every image build is scanned with Trivy before it is published; the bundle is installed, upgraded, backed up and restored in CI; a customer can inspect the SBOM, signature, attestations and checksums of a release before installing it.', evidence: [CI.ca, RELEASES_DOC], customerResponsibility: 'Inspect releases before deployment using the documented verification.' },
            'directory-portal': { status: 'implemented', implementation: 'As for CertAlert (both images; bundle installs on podman-compose 1.0.6 and 1.6.0).', evidence: [CI.dsp, RELEASES_DOC], customerResponsibility: 'Inspect releases before deployment.' },
            readyroom: { status: 'implemented', implementation: 'As for CertAlert.', evidence: [CI.rr, RELEASES_DOC], customerResponsibility: 'Inspect releases before deployment.' },
            'mfa-portal': { status: 'implemented', implementation: 'As for CertAlert (both images; compose and podman-bundle installs). The accepted-CVE list in .trivyignore was verified at run time on 2026-10-18 by class-loading analysis of the demo stack, as its comments record.', evidence: [CI.rsa, RSA + '.trivyignore', RELEASES_DOC], customerResponsibility: 'Inspect releases before deployment.' },
        },
    },
    {
        id: 'SR-11',
        family: 'SR',
        title: 'Component Authenticity',
        products: {
            certalert: { status: 'implemented', implementation: 'A customer verifies the image and chart with cosign against the workflow identity and GitHub\'s OIDC issuer, the provenance with gh attestation verify, and the download with gpg --verify on SHA256SUMS.asc and sha256sum -c. The public GPG key is linked from the Downloads page when configured; its fingerprint must be checked out of band. Releases reach customers only through the licensing portal\'s private bucket with short-lived links.', evidence: [RELEASES_DOC, 'ens-products-page: src/pages/trust.astro', CI.ca], customerResponsibility: 'Verify every release; obtain the fingerprint from ENS separately.' },
            'directory-portal': { status: 'implemented', implementation: 'As for CertAlert, without the provenance step.', evidence: [RELEASES_DOC, dsp('security')], customerResponsibility: 'Verify every release.' },
            readyroom: { status: 'implemented', implementation: 'As for CertAlert, without the provenance step.', evidence: [RELEASES_DOC], customerResponsibility: 'Verify every release.' },
            'mfa-portal': { status: 'implemented', implementation: 'As for CertAlert, without the provenance step.', evidence: [RELEASES_DOC, RSA + 'README.md (section "Releases")'], customerResponsibility: 'Verify every release.' },
        },
    },
];
