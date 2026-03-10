#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
man_root="${XDG_DATA_HOME:-$HOME/.local/share}/man/man1"

mkdir -p "$man_root"

for page in dd-cli.1 doordash-cli.1; do
  ln -sfn "$repo_root/man/$page" "$man_root/$page"
done

echo "Installed man pages to: $man_root"
echo "Try: man dd-cli"
