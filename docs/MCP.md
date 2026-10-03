# SSL Monitor MCP — MCP Specification

## Transport

Official TypeScript MCP SDK with production HTTP transport; Streamable HTTP is the target hosted transport.

MCP is an adapter over shared business services, not a second SSL implementation.

## Authentication

User-scoped random API keys.

- Raw key shown only once.
- Only a hash is stored.
- Optional expiry.
- Revocation supported.
- One key maps to one user.
- Invalid/revoked/expired keys are rejected.

# Final MVP tool set

## add_domain

Input: `{ "hostname": "example.com" }`
Purpose: add an owned hostname.
Validation: hostname-only + SSRF/network-safety policy.
Output: `{ "domainId":"uuid","hostname":"example.com","status":"pending" }`
Errors: invalid, unsafe, duplicate, rate limit.

## remove_domain

Input: `{ "domainId":"uuid" }`
Owner only.
Output: `{ "removed": true }`.

## get_domains

Input: `{}`
Returns caller-owned domains using the existing domain service.

## get_ssl_status

Input: `{ "domainId":"uuid" }`
Owner only.
Returns the current SSL status, expiry information, check timestamp and available TLS/error information.

## get_certificate_details

Input: `{ "domainId":"uuid" }`
Owner only.
Returns certificate information including issuer, subject, DNS names, validity timestamps, remaining validity and available TLS/chain information.

## check_domain_now

Input: `{ "domainId":"uuid" }`
Owner only.
Runs bounded immediate check through the shared SSL service.
Errors: unsafe target, TLS failure, timeout, rate limit.

## list_expiring_certificates

Input: `{ "days": 30 }`
Validation: integer between 0 and 3650.
Returns caller-owned domains at/below the threshold.

## list_ssl_errors

Input: `{}`
Returns current SSL/TLS error states for caller-owned domains.

## get_monitoring_history

Input: `{ "domainId":"uuid", "limit":20 }`
Validation: limit 1–100; owner only.
Returns recent check history.

## Deferred MCP tool

`update_alert_settings` is not part of the initial MCP surface. Alert settings remain available through the REST API/dashboard. It can be added later without changing the architecture.

## Tool-wide rules

- Validate every input.
- Derive identity from MCP authentication, never a user-supplied ID.
- Enforce resource ownership.
- Return stable structured output.
- Sanitize errors.
- Never expose secrets, SQL errors, stack traces or raw sensitive network details.
- Use the same services as REST and worker paths.
