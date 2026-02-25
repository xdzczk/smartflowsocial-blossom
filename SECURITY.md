# Security Policy

## Reporting a Vulnerability

Report vulnerabilities privately by emailing `security@satellite.earth`.

Include:

- impact and affected endpoints,
- a minimal reproduction,
- suggested remediation if known.

Do not open public issues for active vulnerabilities.

### Response SLA

- Initial triage response: within 2 business days.
- Severity assessment and mitigation plan: within 5 business days.
- Public disclosure only after remediation is deployed.

## Supported Versions

Only the latest release tag receives security fixes.

## Security Controls

- CI runs lint/type/tests/coverage/build.
- Release workflow performs dependency audit and container vulnerability scan.
- Upload tokens and internal API secrets must be distinct.
- Threat model: `docs/security/threat-model.md`.
- Operational checklist: `docs/security/operational-security-checklist.md`.
