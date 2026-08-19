# Security Policy

## Supported Versions

This project releases continuously via git tags. Only the latest release is officially supported for security updates and bug fixes.

## Reporting a Vulnerability

To report a security vulnerability privately, please use GitHub's private vulnerability reporting feature:

1. Navigate to the [Security tab](https://github.com/NaturalDevCR/Snapcast-Manager/security) of the repository
2. Click "Report a vulnerability"
3. Provide details of the vulnerability through the GitHub Security Advisory

This ensures your report reaches the maintainers confidentially and allows time for a fix before public disclosure.

## Threat Model

Snapcast Manager is designed for **trusted local/LAN environments only**. The application runs with elevated system privileges (typically root or sudo) to manage services and packages on the host system.

**Important security considerations:**

- This application should **not** be exposed directly to the public internet without a reverse proxy and TLS encryption
- It is intended for use on trusted networks where all users are authorized to manage system services
- In multi-tenant or untrusted network scenarios, place the application behind a reverse proxy with strong authentication and TLS

A broader security-hardening effort is tracked in [`docs/superpowers/plans/2026-08-18-professional-hardening.md`](docs/superpowers/plans/2026-08-18-professional-hardening.md) (Stage 1), which includes additional security improvements planned for future releases.
