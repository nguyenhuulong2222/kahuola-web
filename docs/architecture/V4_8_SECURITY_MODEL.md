# V4.8 Security Model
## Platform Security, Input Safety, and Boundary Protection

**Status:** Authoritative V4.8 Security Model

## Security Principle

Kahu Ola must be secure by architecture.

Primary security controls:
- stateless clients
- controlled API boundary
- strict schema validation
- cache-first serving
- no direct upstream exposure
- no unnecessary user data storage

## Boundary Model

### External boundary
Public clients can only access Kahu Ola-controlled endpoints.

### Internal boundary
Only pollers and controlled ingestion services may fetch upstream hazard providers.

### Trust boundary
Validated cache storage is a trust boundary. Unvalidated data must never cross it.

## Input Validation Security

All upstream payloads are untrusted until validated.

Required protections:
- strict schema validation
- GeoJSON validation
- timestamp validation
- field-type enforcement

Invalid inputs must be dropped.

## API Security Rules

Public APIs must:
- expose stable contracts only
- hide upstream keys
- hide internal URLs
- enforce sane rate limits
- preserve degraded-safe responses instead of crashing

## Privacy Rules

Kahu Ola is privacy-first:
- no unnecessary storage of precise user location
- no server-side retention of user position by default
- no client need to share location for normal statewide browsing

## Forbidden Security Behaviors

Kahu Ola must never:
- expose upstream API keys to clients
- trust raw upstream input
- let malformed data into cache
- rely on client-side hazard logic for safety decisions
- store precise personal location unnecessarily

## Final Requirement

All Kahu Ola components must comply with this security model before release.
