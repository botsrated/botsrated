#!/usr/bin/env bash
# Self-test for verify-tag.sh (GPG path), with throwaway keys in a throwaway repo. Needs git and gpg.
#   usage: bash integrations/release-tools/test-verify-tag.sh
# The SSH path needs ssh-keygen; it is tested when ssh-keygen is available.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); vt="$here/verify-tag.sh"
t=$(mktemp -d); trap 'gpgconf --homedir "$t/runner-gnupg" --kill all 2>/dev/null || true; gpgconf --homedir "$t/keys" --kill all 2>/dev/null || true; rm -rf "$t"' EXIT
pass=0; failn=0
ok()  { if "$@" >"$t/log" 2>&1; then pass=$((pass+1)); echo "ok   - accepts: ${label}"; else failn=$((failn+1)); echo "FAIL - should accept: ${label}"; cat "$t/log"; fi; }
bad() { if "$@" >"$t/log" 2>&1; then failn=$((failn+1)); echo "FAIL - should reject: ${label}"; cat "$t/log"; else pass=$((pass+1)); echo "ok   - rejects: ${label} ($(grep -o '::error::.*' "$t/log" | head -n1 | cut -c10-80))"; fi; }

# Keys: K1 pinned, K2 valid but not pinned; K3 has a signing subkey, K3's primary is pinned.
export GNUPGHOME="$t/keys"; mkdir -m 700 "$GNUPGHOME"
gen() { gpg --batch --quiet --pinentry-mode loopback --passphrase '' --quick-gen-key "$1" ed25519 sign never 2>/dev/null; gpg --with-colons --fingerprint "$1" 2>/dev/null | awk -F: '/^fpr/ {print $10; exit}'; }
K1=$(gen "pinned <k1@example.invalid>"); K2=$(gen "other <k2@example.invalid>"); K3=$(gen "sub <k3@example.invalid>")
gpg --batch --quiet --pinentry-mode loopback --passphrase '' --quick-add-key "$K3" ed25519 sign never 2>/dev/null
K3SUB=$(gpg --with-colons --fingerprint --with-subkey-fingerprints "$K3" 2>/dev/null | awk -F: '/^fpr/ {n++; if (n==2) {print $10; exit}}')

mkdir -p "$t/signers" "$t/signers-k2" "$t/signers-none"
gpg --armor --export "$K1" > "$t/signers/k1.asc"; gpg --armor --export "$K3" > "$t/signers/k3.asc"
gpg --armor --export "$K2" > "$t/signers-k2/k2.asc"; gpg --armor --export "$K1" > "$t/signers-k2/k1.asc"
printf '# pinned\n%s\n%s\n' "$K1" "$(sed 's/.\{4\}/& /g' <<<"$K3")" > "$t/allow.txt"
: > "$t/empty.txt"; echo "# comments only" > "$t/comments.txt"

# Repo: main with one commit, a side commit not on main.
git init -q -b main "$t/repo"; cd "$t/repo"
git config user.name t; git config user.email t@example.invalid; git config tag.gpgSign false
echo a > f; git add f; git commit -qm a; main=$(git rev-parse HEAD)
git update-ref refs/remotes/origin/main "$main"
git checkout -q -b side; echo b > f; git commit -qam b; side=$(git rev-parse HEAD); git checkout -q main
git -c user.signingkey="$K1" tag -s -m t1 pkg-v1.0.0 "$main"
git -c user.signingkey="$K2" tag -s -m t2 pkg-v2.0.0 "$main"
git -c user.signingkey="$K3SUB!" tag -s -m t3 pkg-v3.0.0 "$main"
git -c user.signingkey="$K1" tag -s -m t4 pkg-v4.0.0 "$side"
git tag -a -m unsigned pkg-v5.0.0 "$main"; git tag pkg-v6.0.0 "$main"

# The runner's own keyring holds K2 (as a pre-installed or injected key would be): it must not count.
export GNUPGHOME="$t/runner-gnupg"; mkdir -m 700 "$GNUPGHOME"; gpg --batch --quiet --import "$t/signers-k2/k2.asc" 2>/dev/null

label="signed by pinned K1";                                   ok  bash "$vt" pkg-v1.0.0 pkg-v1.0.0 "$t/signers" "$t/allow.txt"
label="signed by a pinned primary key's subkey";               ok  bash "$vt" pkg-v3.0.0 pkg-v3.0.0 "$t/signers" "$t/allow.txt"
label="valid K2 signature, K2 in runner keyring, not in dir";  bad bash "$vt" pkg-v2.0.0 pkg-v2.0.0 "$t/signers" "$t/allow.txt"
label="valid K2 signature, K2 in signers dir, not pinned";     bad bash "$vt" pkg-v2.0.0 pkg-v2.0.0 "$t/signers-k2" "$t/allow.txt"
label="pinned K1 but allowlist empty";                         bad bash "$vt" pkg-v1.0.0 pkg-v1.0.0 "$t/signers" "$t/empty.txt"
label="pinned K1 but allowlist has only comments";             bad bash "$vt" pkg-v1.0.0 pkg-v1.0.0 "$t/signers" "$t/comments.txt"
label="pinned K1 but allowlist missing";                       bad bash "$vt" pkg-v1.0.0 pkg-v1.0.0 "$t/signers" "$t/nope.txt"
label="no keys in signers dir";                                bad bash "$vt" pkg-v1.0.0 pkg-v1.0.0 "$t/signers-none" "$t/allow.txt"
label="signed by K1 but not on main";                          bad bash "$vt" pkg-v4.0.0 pkg-v4.0.0 "$t/signers" "$t/allow.txt"
label="annotated but unsigned";                                bad bash "$vt" pkg-v5.0.0 pkg-v5.0.0 "$t/signers" "$t/allow.txt"
label="lightweight tag";                                       bad bash "$vt" pkg-v6.0.0 pkg-v6.0.0 "$t/signers" "$t/allow.txt"
label="tag name differs from the package version";             bad bash "$vt" pkg-v1.0.0 pkg-v9.9.9 "$t/signers" "$t/allow.txt"
label="default allowlist (signers.txt next to the script)";    if grep -qvE '^\s*(#|$)' "$here/signers.txt"; then echo "skip - signers.txt is not empty"; else bad bash "$vt" pkg-v1.0.0 pkg-v1.0.0 "$t/signers"; fi

if command -v ssh-keygen >/dev/null; then
  ssh-keygen -q -t ed25519 -N '' -f "$t/ssh1" -C s1; ssh-keygen -q -t ed25519 -N '' -f "$t/ssh2" -C s2
  mkdir -p "$t/signers-ssh"; printf 's1@example.invalid namespaces="git" %s\ns2@example.invalid namespaces="git" %s\n' "$(cat "$t/ssh1.pub")" "$(cat "$t/ssh2.pub")" > "$t/signers-ssh/allowed_signers"
  ssh-keygen -lf "$t/ssh1.pub" | awk '{print $2}' > "$t/allow-ssh.txt"
  git -c gpg.format=ssh -c user.signingkey="$t/ssh1" tag -s -m s1 pkg-v7.0.0 "$main"
  git -c gpg.format=ssh -c user.signingkey="$t/ssh2" tag -s -m s2 pkg-v8.0.0 "$main"
  label="SSH: signed by pinned key";                           ok  bash "$vt" pkg-v7.0.0 pkg-v7.0.0 "$t/signers-ssh" "$t/allow-ssh.txt"
  label="SSH: key in allowed_signers but not pinned";          bad bash "$vt" pkg-v8.0.0 pkg-v8.0.0 "$t/signers-ssh" "$t/allow-ssh.txt"
  ssh-keygen -q -t ed25519 -N '' -f "$t/ssh3" -C s3; ssh-keygen -lf "$t/ssh3.pub" | awk '{print $2}' >> "$t/allow-ssh.txt"
  git -c gpg.format=ssh -c user.signingkey="$t/ssh3" tag -s -m s3 pkg-v10.0.0 "$main"
  label="SSH: pinned fingerprint but key not in allowed_signers"; bad bash "$vt" pkg-v10.0.0 pkg-v10.0.0 "$t/signers-ssh" "$t/allow-ssh.txt"
else
  echo "skip - SSH cases (no ssh-keygen)"
fi

echo "verify-tag self-test: $pass passed, $failn failed"
[ "$failn" = 0 ]
