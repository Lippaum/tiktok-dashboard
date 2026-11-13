#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rm -rf _site
mkdir -p _site/data _site/covers
cp web/index.html web/styles.css web/app.js web/favicon.svg _site/
cp web/covers/*.svg _site/covers/
cp data/videos.json _site/data/videos.json
: > _site/.nojekyll

test -s _site/index.html
test -s _site/data/videos.json
test -s _site/styles.css
test -s _site/app.js
echo "Site montado em _site/"
