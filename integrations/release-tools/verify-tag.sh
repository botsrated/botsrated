#!/usr/bin/env bash
# Verifies a release tag before anything is built (used by docs/drafts/publish-*.yml).
#   usage: verify-tag.sh <tag> <expected-tag> <signers-dir>
# - the tag is an annotated tag named exactly <expected-tag> (<package>-v<version> from the package manifest);
# - its signature verifies against the signer keys in <signers-dir>, which the workflow takes from main, never from
#   the tag itself (allowed_signers for SSH-signed tags and/or *.asc public keys for GPG-signed tags);
# - the tagged commit is on main (so only reviewed code is released).
set -euo pipefail
tag="$1"; expected="$2"; signers="$3"
if [ "$tag" != "$expected" ]; then echo "::error::tag '$tag' does not match the package version (expected '$expected')"; exit 1; fi
if [ "$(git cat-file -t "refs/tags/$tag")" != "tag" ]; then echo "::error::'$tag' is not an annotated (signable) tag"; exit 1; fi
found=0
if [ -f "$signers/allowed_signers" ]; then git config gpg.ssh.allowedSignersFile "$signers/allowed_signers"; found=1; fi
shopt -s nullglob
for k in "$signers"/*.asc; do gpg --batch --quiet --import "$k"; found=1; done
if [ "$found" = 0 ]; then echo "::error::no release signer keys in $signers (on main)"; exit 1; fi
git verify-tag "$tag"
git merge-base --is-ancestor "refs/tags/$tag^{commit}" origin/main || { echo "::error::$tag is not on main"; exit 1; }
echo "verified: $tag -> $(git rev-parse "refs/tags/$tag^{commit}")"
