# Security Policy

## Supported versions

WatchToSay is a small GitHub-only project. Security fixes are made on the latest code on `main` and, when releases are published, the latest GitHub release. Older snapshots are not supported.

## Report a vulnerability privately

Do not publish vulnerability details, exposed credentials, private video information, or transcript data through a public issue or pull request. This repository does not accept public security reports.

Use GitHub's private vulnerability reporting flow from this repository's **Security** tab when it is available. If the private reporting link is not visible, contact the repository owner through their GitHub profile and ask for a private reporting channel without including vulnerability details in the public message. Include the following only in the private report:

- the affected version or commit;
- the minimum steps needed to reproduce the problem;
- the expected and observed behavior;
- the security and privacy impact; and
- a suggested fix, if you have one.

Remove real API keys, access tokens, private URLs, transcripts, notes, and personal information. Use redacted values and public test content.

There is no guaranteed response time or bug-bounty program. Please allow a reasonable period for investigation and remediation before public disclosure.

## High-priority issues

Examples include:

- API keys or private content included in source, logs, screenshots, or release ZIPs;
- an OCR-derived local IELTS bank entering a public release or being shared without permission;
- requests to network origins outside the documented YouTube, Supadata, and DeepSeek hosts;
- script or HTML injection through transcript, metadata, service errors, or model output;
- access to browsing data outside the documented YouTube scope;
- unintended transmission of notes, transcripts, or credentials;
- an Obsidian export URL that writes outside the configured local Vault or
  exposes learner content to an unintended application; and
- a dependency or release-workflow compromise; and
- bypasses of local data deletion or DeepSeek configuration controls.

## User security guidance

- Install only from a GitHub source or release you trust.
- Review changes and the packaged file list before loading an update.
- Use dedicated, scoped API keys where possible and set provider spending limits.
- Do not reuse keys from production systems.
- Revoke keys immediately if a device, browser profile, ZIP, log, or screenshot exposes them.
- Remember that Chrome local extension storage is not an encrypted password vault.

The release tooling uses an explicit file allowlist and scans public files for common credential patterns, but automated checks cannot detect every secret. `npm run package` never includes `data/ielts-question-bank.local.json`. `npm run package:local` first validates that Git-ignored bank and then packages only it in addition to the public allowlist, scanning those archive inputs and printing a SHA-256 digest. Inspect the file list and checksum before sharing either archive.

The extension has no runtime PDF import, PDF renderer, or OCR engine. Treat the macOS OCR conversion tooling and all PDF/OCR/review artifacts as local development material. Do not commit source PDFs, OCR output, review records, or an OCR-derived bank unless you have confirmed the necessary rights and intentionally changed the publishing boundary.
