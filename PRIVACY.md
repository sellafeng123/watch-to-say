# Privacy

Effective: July 28, 2026

YouTube Digest is a GitHub-only, bring-your-own-key Chrome extension. It has no YouTube Digest account, developer-operated backend, analytics, advertising, or telemetry.

## Data the extension handles

Depending on the feature you use, YouTube Digest handles:

- the canonical URL and video ID of the active YouTube video;
- transcript text and timestamps;
- video metadata such as title, channel, description, and duration;
- text you select in the transcript and nearby transcript context;
- transcript context around a timestamped note;
- content you ask to translate;
- notes you save;
- structured learner question banks and an active speaking-round state;
- raw question-bank text only while you keep it in the Settings textarea or review a recognition preview;
- learner entries you prepare for an Obsidian Markdown note, including selected
  expressions, nearby subtitle context, AI contextual glosses, and your edits;
- Supadata and DeepSeek configuration, including API keys; and
- cached transcript, digest, translation, and AI contextual-gloss results.

## Where data goes

### Supadata

YouTube Digest sends the canonical YouTube video URL to `https://api.supadata.ai` with your Supadata API key. Supadata returns the transcript and timestamps. A Supadata key is required for transcript retrieval.

### DeepSeek

The published version sends AI feature content to DeepSeek V4 Flash at `https://api.deepseek.com`:

- transcript plus relevant title, channel, description, or duration for an overview;
- selected text plus nearby transcript context for an explanation;
- small semantic transcript batches currently needed for progressive Chinese
  translation, or requested overview or explanation content;
- nearby transcript context and video metadata when polishing a saved note.
- raw pasted question-bank text only after you choose **Recognize question bank**; and
- the current video's selected expressions and a bounded candidate-question list when preparing a speaking round or reference answer.

The endpoint and `deepseek-v4-flash` model are fixed in the published Settings page. You provide one DeepSeek API key. To use another provider or model, you must adapt your own local source copy and its permissions. The Settings page provides a coding-agent prompt for that purpose and warns you never to include an API key in the prompt or chat.

Requests go directly from the extension to Supadata or DeepSeek. They are authenticated with the keys you supply. YouTube Digest's developer does not proxy or receive these requests.

### Obsidian

When you explicitly choose **Append to Obsidian**, the extension constructs an
`obsidian://new` URL containing the selected Markdown entry, the Vault name,
and the chosen per-video note path. Your operating system hands that URL to the
local Obsidian application. The extension does not upload this Markdown to a
developer server and does not claim that a local write succeeded; verify the
result in Obsidian. Do not use this export with a Vault or device you do not
control.

Those services process data under their own terms, privacy policies, retention practices, and account settings. Do not send confidential, personal, or regulated content unless their terms and your obligations permit it.

## Local storage and retention

YouTube Digest uses Chrome's local extension storage, not a YouTube Digest cloud service.

- Supadata and DeepSeek settings and API keys remain on the device in Chrome's extension storage.
- Saved notes remain until you delete them or remove/clear the extension's data. The extension keeps up to 100 notes.
- Obsidian export history stores only a local handoff record used to keep the
  same video's note path stable. It does not contain the exported Markdown.
- Recent transcript, digest, and per-segment translation cache entries are stored
  locally. The cache is limited to 20 videos, and entries older than 30 days are
  removed when the side panel opens.
- Up to 300 AI contextual glosses are stored locally by video, caption occurrence,
  and selected text so reopening the same highlighted context does not send another
  DeepSeek request. Choosing **重新生成** replaces that one cached gloss.
- Structured learner question banks remain locally until you delete them. The original pasted text is discarded after you explicitly save a successful structured preview. Active speaking-round state remains only in the current side-panel session.

Chrome extension storage is not a password vault. Anyone with sufficient access to your browser profile or device may be able to recover locally stored keys or content. Use scoped keys where providers support them, set spending limits, and rotate or revoke a key if the device or browser profile is compromised.

To remove data:

- delete individual saved notes in YouTube Digest;
- use the Options page to clear cached digests, delete all notes, or reset all extension data;
- remove the extension or clear its stored data from Chrome to delete all local settings, keys, notes, and cache entries; and
- revoke keys in the Supadata or DeepSeek dashboard to stop their future use.

Clearing local data does not delete information already processed or retained by Supadata or DeepSeek. Use each service's controls for service-side requests.

## Local IELTS publishing boundary

The extension has no runtime scanned-PDF import, PDF renderer, or OCR engine. Any macOS PDF/OCR conversion is development-time tooling, not an extension feature. An OCR-derived IELTS bank may be kept in the Git-ignored local file `data/ielts-question-bank.local.json` for a personal installation after review. The public package excludes it because the source material can contain third-party content. The local package command validates the approval record, uses the public allowlist plus only that bank, scans package inputs for common credentials, and prints a SHA-256 digest. Do not publish or share a local bank unless you have redistribution permission.

## Permissions

YouTube Digest uses Chrome permissions for these purposes:

- `sidePanel`: display the YouTube Digest interface beside YouTube.
- `storage`: store settings, keys, notes, and cached results locally.
- `tabs`: identify and interact with the active YouTube tab.
- `scripting`: coordinate the extension's YouTube page controls.
- YouTube host access: read the active video's URL and metadata and provide timestamp controls.
- Supadata host access: retrieve transcripts.
- DeepSeek host access: provide AI overviews, explanations, translation, and note polishing through DeepSeek V4 Flash.

YouTube Digest does not use these permissions to monitor general browsing activity.

## No sale or advertising use

YouTube Digest does not sell personal information, build advertising profiles, or share data with data brokers. It does not include analytics SDKs.

## Changes

Privacy-relevant changes will be documented in this file and in the repository history. Review updates before installing a new version.

## Questions

This repository does not provide a public support or issue channel. Review this policy, the source code, and each provider's documentation before using the extension. For a vulnerability or accidental secret exposure, follow the private process in [SECURITY.md](SECURITY.md).
