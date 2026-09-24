# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-09-24

### Changed

- Migrate peer dependency scope from `@mariozechner/pi-*` to `@earendil-works/pi-*`.
- Refresh all devDependencies to latest stable versions: biome 2.5.14, vitest 5.0.1, typescript 7.0.2, @types/node 26.6.2, @typescript/native-preview 7.0.0-dev.20260707.2.
- Update Node.js engine requirement to >=22.19.0.
- Add CI workflow with Bun 1.4.2 (ubuntu-latest + macos-latest, node 22 + 24).
- Update installation instructions to use `pi install git:github.com/code-yeongyu/pi-anthropic-text-editor` (no npm publish).

## [0.1.0] - 2026-05-07

### Added

- Initial release. Native Anthropic text editor policy extension for the pi coding agent. Registers `str_replace_based_edit_tool`, executes view/create/str_replace/insert commands, and injects `text_editor_20250728` into anthropic-messages requests when `PI_ANTHROPIC_TEXT_EDITOR` is enabled.

[Unreleased]: https://github.com/code-yeongyu/pi-anthropic-text-editor/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/code-yeongyu/pi-anthropic-text-editor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/code-yeongyu/pi-anthropic-text-editor/releases/tag/v0.1.0
