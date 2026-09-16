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

async function main() {
  const raw = JSON.parse(fs.readFileSync(localBankPath, "utf8"));
  const normalized = await questionBank.validateApprovedBundledIeltsBank(raw, { sha256 });
  if (!normalized) throw new Error("bank does not satisfy the approved bundled IELTS contract");
}

main().catch((error) => {
  console.error(`Local question bank validation failed: ${error.message}`);
  process.exit(1);
});
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
