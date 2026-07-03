# Changelog

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
