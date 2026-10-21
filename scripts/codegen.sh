#!/usr/bin/env bash
set -euo pipefail
npx --yes @openapitools/openapi-generator-cli generate \
  -i contracts/openapi.yaml -g typescript-axios -o frontend/shared-contract-client
