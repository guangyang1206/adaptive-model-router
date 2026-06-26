# Security Policy

## Supported versions

Adaptive Model Router is currently pre-1.0. Security fixes will target the latest main branch until the first release is cut.

## Reporting a vulnerability

Please avoid opening public issues for sensitive vulnerabilities. Once the GitHub repository is published, use GitHub's private vulnerability reporting if enabled, or contact the maintainers through the repository instructions.

## Secrets and logs

- Provider API keys must not be stored in the dashboard database.
- Prompt content should be redacted by default in dashboard views.
- Metadata should support field-level hiding.
- `.env` files are ignored by git.
