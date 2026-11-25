# Changelog

## v0.2.1 - 2026-11-25

### Fixes

- use the current HustleOps app icon (`ui`)
- align request validation with HustleOps (`api`)

### Documentation

- map plugin operations to HustleOps API endpoints

### CI

- bind npm publishing to the production environment (`release`)
- recover npm trusted publication without moving tags (`release`)

## v0.2.0 - 2026-11-24

### Features

- **Breaking:** align the n8n plugin with current HustleOps contracts (`api`)

## v0.1.5 - 2026-07-06

### CI

- refresh PR validation

## v0.1.4 - 2026-07-03

### Features

- add picklist dropdowns for structured fields

### Tests

- remove README contract assertions

## v0.1.3 - 2026-07-03

### Fixes

- surface HTTP response data in HustleOps errors

### Documentation

- trim README tail
- document one-run release workflow
- align release docs with npm publishing

### Tests

- remove brittle README spacing assertions
- cover release file generation (`ci`)
- expect one-run release workflow (`ci`)

### CI

- use release app token
- require release bypass token
- finalize one-run release workflow
- run release preparation in release workflow

## v0.1.2 - 2026-07-03

### Features

- redesign payload input mode
- add release preparation scripts (`ci`)

### Fixes

- satisfy payload quality checks (`ci`)
- harden input mode validation (`payload`)

### Refactoring

- share search request validation

### Documentation

- document protected release flow (`ci`)

### Tests

- define payload input mode metadata contract
- assert release workflow contract (`ci`)
- add release utility coverage (`ci`)
- add commit metadata validator (`ci`)

### CI

- require prepared release commits
- remove invalid GitHub Packages release publish
- upgrade GitHub Actions and workflow checks
- validate PR and push commit subjects
- require release workflow to run from main
- consolidate PR checks into one workflow
- add manual release workflow
- add required pull request checks

### Style

- format payload metadata tests

### Chores

- ignore codegraph cache
- ignore Codex and Claude workspace files
- ignore local docs artifacts
