_default:
  @ just --list --unsorted

# One-time post-clone setup: installs the prepare-commit-msg hook from
# scripts/git-hooks/ so every commit in this clone auto-adds the DCO
# Signed-off-by trailer. See CONTRIBUTING.md ("Developer Certificate of Origin").
setup-dev:
  #!/bin/sh
  set -eu
  git config core.hooksPath scripts/git-hooks
  chmod +x scripts/git-hooks/prepare-commit-msg
  echo "✅ DCO prepare-commit-msg hook installed for this clone"

# Confirm potentially dangerous actions with a specific confirmation input (e.g. version, environment name)
[private]
manual-confirmation-input message required_confirmation:
  #!/bin/sh
  set -eu

  message="{{ message }}"
  required_confirmation="{{ required_confirmation }}"

  echo "$message"
  echo "Type '$required_confirmation' to confirm:"
  read response

  if [ "$response" != "$required_confirmation" ]; then
    echo "Confirmation failed. Exiting..."
    exit 1
  fi

# Tag and push the version currently in package.json. Run after the prep PR is merged into main.
release:
  #!/bin/sh
  set -eu
  git checkout main
  git pull
  version=$(node -p 'require("./package.json").version')
  just manual-confirmation-input "About to tag and push v$version" "$version"
  git tag -a "v$version" -m "Release $version"
  git push origin "v$version"
