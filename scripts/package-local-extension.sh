#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
check_script="$script_dir/check-release.sh"
local_bank="data/ielts-question-bank.local.json"
dist_dir="$repo_root/dist"

fail() {
  printf 'Local packaging failed: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is required"
command -v zip >/dev/null 2>&1 || fail "zip is required"
command -v unzip >/dev/null 2>&1 || fail "unzip is required"
command -v shasum >/dev/null 2>&1 || fail "shasum is required"

cd "$repo_root"

# A local archive is deliberately stricter than the public package: it starts
# from the same checked public allowlist, then adds only the approved local bank.
npm test
"$check_script"

[[ -f "$local_bank" && ! -L "$local_bank" ]] || fail "approved local question bank is missing: $local_bank"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  && git ls-files --error-unmatch "$local_bank" >/dev/null 2>&1; then
  fail "local question bank must remain Git-ignored: $local_bank"
fi

node - "$local_bank" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const questionBank = require("./question-bank.js");

const localBankPath = process.argv[2];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const isDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

function fail(reason) {
  throw new Error(reason);
}

try {
  const raw = JSON.parse(fs.readFileSync(localBankPath, "utf8"));
  const approval = raw?.approval;
  if (
    !raw
    || raw.source !== "bundled_ielts"
    || !Array.isArray(raw.profiles)
    || raw.profiles.length !== 1
    || raw.profiles[0] !== "ielts"
    || !Array.isArray(raw.questions)
    || raw.questions.length < 3
    || raw.questions.length > questionBank.LIMITS.maxQuestionsPerBank
    || approval?.status !== "approved"
    || approval.schemaVersion !== 1
    || approval.pageCount !== 46
    || approval.reviewedPageCount !== approval.pageCount
    || !Number.isInteger(approval.correctionsApplied)
    || approval.correctionsApplied < 0
    || !isDigest(approval.sourcePdfSha256)
    || !isDigest(approval.ocrSha256)
    || !isDigest(approval.bankSha256)
    || !Number.isFinite(Date.parse(approval.reviewedAt || ""))
  ) {
    fail("bank is missing a complete approved-review record");
  }

  const normalized = questionBank.normalizeBank(raw);
  if (
    !normalized
    || !normalized.id
    || !normalized.name
    || raw.id !== normalized.id
    || raw.name !== normalized.name
    || normalized.questions.length !== raw.questions.length
  ) {
    fail("bank payload would be changed by shared question-bank normalization");
  }

  const counts = { part1: 0, part2: 0, part3: 0 };
  const byId = new Map(normalized.questions.map((question) => [question.id, question]));
  for (let index = 0; index < raw.questions.length; index += 1) {
    const original = raw.questions[index];
    const question = normalized.questions[index];
    if (
      !original
      || original.id !== question?.id
      || original.bankId !== normalized.id
      || original.source !== "bundled_ielts"
      || !Array.isArray(original.profiles)
      || original.profiles.length !== 1
      || original.profiles[0] !== "ielts"
      || !Object.hasOwn(counts, original.part)
      || original.topic !== question.topic
      || original.question !== question.question
      || !Array.isArray(original.cuePoints)
      || original.cuePoints.length !== question.cuePoints.length
      || original.cuePoints.some((point, pointIndex) => point !== question.cuePoints[pointIndex])
      || original.parentCueCardId !== question.parentCueCardId
      || original.season !== question.season
      || original.createdAt !== question.createdAt
    ) {
      fail(`question ${index + 1} is not an exact shared-contract record`);
    }
    counts[original.part] += 1;
  }
  if (Object.values(counts).some((count) => count === 0)) {
    fail("bank must contain Part 1, Part 2, and Part 3 questions");
  }
  for (const question of normalized.questions) {
    if (question.part === "part3" && !question.parentCueCardId) {
      fail("a Part 3 question is missing its Part 2 parent");
    }
    if (question.parentCueCardId && byId.get(question.parentCueCardId)?.part !== "part2") {
      fail("a question has an invalid Part 2 parent");
    }
  }
  if (sha256(JSON.stringify(normalized)) !== approval.bankSha256) {
    fail("approved bank digest does not match the normalized payload");
  }
} catch (error) {
  console.error(`Local question bank validation failed: ${error.message}`);
  process.exit(1);
}
NODE

release_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && release_files+=("$file")
done < <("$check_script" --print-files)
(( ${#release_files[@]} > 0 )) || fail "public release allowlist is empty"

for file in "${release_files[@]}"; do
  case "$file" in
    "$local_bank"|data/*|scripts/*|config.js|.DS_Store|.git|.git/*)
      fail "public release allowlist contains a private path: $file"
      ;;
  esac
done

archive_files=("${release_files[@]}" "$local_bank")
node - "${archive_files[@]}" <<'NODE'
const fs = require("fs");

const files = process.argv.slice(2);
const localBank = "data/ielts-question-bank.local.json";
if (new Set(files).size !== files.length) {
  throw new Error("archive file list contains duplicates");
}
if (files.filter((file) => file.startsWith("data/")).join("\n") !== localBank) {
  throw new Error("archive must contain exactly one data file: the local question bank");
}
const forbiddenPath = /(?:^|\/)(?:config\.js|\.DS_Store|\.git)(?:\/|$)|^scripts\//;
const patterns = [
  ["private key block", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["Supadata-style key", /\bsd_[A-Za-z0-9_-]{16,}\b/g],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["Slack token", /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["credential assignment", /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][^"'\s]{16,}["']/gi],
];

for (const file of files) {
  if (forbiddenPath.test(file)) throw new Error(`forbidden private path: ${file}`);
  const text = fs.readFileSync(file, "utf8");
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) throw new Error(`possible ${label} in ${file}`);
  }
}
NODE

version="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.version)' "$repo_root/manifest.json")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || fail "unsafe manifest version: $version"

mkdir -p "$dist_dir"
temporary_dir="$(mktemp -d "$dist_dir/.youtube-digest-local-package.XXXXXX")"
temporary_zip="$temporary_dir/youtube-digest-local.zip"
output_zip="$dist_dir/youtube-digest-v$version-local-with-question-bank.zip"

cleanup() {
  [[ -f "$temporary_zip" ]] && rm -f "$temporary_zip"
  [[ -d "$temporary_dir" ]] && rmdir "$temporary_dir" 2>/dev/null || true
}
trap cleanup EXIT

zip -X -q "$temporary_zip" "${archive_files[@]}"
if ! unzip -t "$temporary_zip" >/dev/null; then
  fail "created archive did not pass its integrity test"
fi

if ! diff -u \
  <(printf '%s\n' "${archive_files[@]}" | sort) \
  <(unzip -Z1 "$temporary_zip" | sort); then
  fail "archive contents differ from the guarded file list"
fi

mv -f "$temporary_zip" "$output_zip"
rmdir "$temporary_dir"
trap - EXIT

checksum="$(shasum -a 256 "$output_zip" | awk '{print $1}')"
printf 'Created %s\n' "$output_zip"
printf 'SHA-256: %s\n' "$checksum"
