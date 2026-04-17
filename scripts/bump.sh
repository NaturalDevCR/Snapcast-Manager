#!/bin/bash
# Usage: ./scripts/bump.sh patch|minor|major
set -e

TYPE=${1:-patch}
if [[ "$TYPE" != "patch" && "$TYPE" != "minor" && "$TYPE" != "major" ]]; then
  echo "Usage: $0 patch|minor|major"
  exit 1
fi

# Bump root package.json only (no git ops)
npm version "$TYPE" --no-git-tag-version --no-workspaces-update

# Sync client, server and install.sh
node scripts/sync-version.js

# Read final version
VERSION=$(node -p "require('./package.json').version")

# Commit and tag everything together
git add package.json client/package.json server/package.json scripts/install.sh
git commit -m "chore: bump version to v$VERSION"
git tag "v$VERSION"

echo ""
echo "✓ Bumped to v$VERSION — run: git push origin main v$VERSION"
