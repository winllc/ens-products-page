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
