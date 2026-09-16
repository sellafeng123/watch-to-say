# Final review fix report

Base reviewed: `90d52f4`.

| Finding | RED reproduction | GREEN verification |
| --- | --- | --- |
| Settings classic-script loading did not expose `YTD_QUESTION_BANK_UI` | `tests/browser-integrations.test.js` loads `options.html` script tags in their real order without injecting globals. | `var YTD_QUESTION_BANK_UI` binds the classic-script global; the Settings integration test passes. |
| Listening classic-script loading did not expose `YTD_PRACTICE` | The same VM harness loads `sidepanel.html` in its real order and mounts listening. | `var YTD_PRACTICE` binds the classic-script global; reveal uses the real session module and passes. |
| A cross-sentence or fragmentary `targetText` was displayed instead of one context sentence | Four `tests/practice-session.test.js` cases failed: three boundary shapes and a complete sentence over the fallback bound. | The selected expression filters context candidates; target overlap selects one terminated context sentence. Complete terminated sentences are returned intact, while only unpunctuated fallbacks remain bounded. |
| Unsaved Settings draft was lost after language/rename/delete rerender | Three VM/DOM integration cases failed after textarea/name/profile edits and a full rerender. | Input and change events synchronize the live draft to Settings state. Language, rename, and delete rerenders preserve it; only successful save and explicit replace change/clear it. |

## Verification

- Focused: `node --test tests/browser-integrations.test.js tests/practice-session.test.js tests/question-bank-ui.test.js` — 48 passing, 0 failing.
- Full suite: `npm test` — 223 passing, 0 failing.
- Release checks: `npm run check` — passed.
- Public package: `npm run package` — passed; `unzip -t dist/youtube-digest-v2.1.0.zip` reported no errors.
- Local package: `npm run package:local` — passed; `unzip -t dist/youtube-digest-v2.1.0-local-with-question-bank.zip` reported no errors.
- ZIP boundary inspection: the public ZIP has no `data/` entry; the local ZIP has exactly `data/ielts-question-bank.local.json` and no OCR/review artifacts.

Commit: `fix: restore browser practice integrations` (this report is included in that commit).
