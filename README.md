# pi-anthropic-text-editor

[![ci](https://github.com/code-yeongyu/pi-anthropic-text-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/code-yeongyu/pi-anthropic-text-editor/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Anthropic native text editor extension for the [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

This package is the standalone extraction of senpi's former builtin `anthropic-text-editor` extension.

## Behavior

When `PI_ANTHROPIC_TEXT_EDITOR` is enabled and API is `anthropic-messages`, the extension:

1. Registers a function tool named `str_replace_based_edit_tool` with commands:
   - `view`
   - `create`
   - `str_replace`
   - `insert`
2. Rewrites outgoing Anthropic tool payloads to ensure native `text_editor_20250728` is present.
3. Strips function-shape `str_replace_based_edit_tool`, `read`, `write`, and `edit` tools from Anthropic payloads.
4. Appends a system-prompt section that instructs the model to use native text editor operations.

| Case | Result |
|------|--------|
| `PI_ANTHROPIC_TEXT_EDITOR` enabled, API `anthropic-messages`, no native tool present | injects `{ type: "text_editor_20250728", name: "str_replace_based_edit_tool" }` |
| Native `text_editor_*` tool already present | preserves caller-provided native tool, no duplication |
| Function-shape `str_replace_based_edit_tool` / `read` / `write` / `edit` present | strips function shapes from outgoing Anthropic payload |
| Env unset or disabled | no-op |
| API is non-Anthropic | no-op |

Truthy values for `PI_ANTHROPIC_TEXT_EDITOR`: `1`, `true`, `yes`, `on` (case-insensitive; surrounding whitespace allowed).

## Installation

```bash
# From npm (once published)
pi install npm:pi-anthropic-text-editor

# From git
pi install git:github.com/code-yeongyu/pi-anthropic-text-editor

# Manual placement
git clone https://github.com/code-yeongyu/pi-anthropic-text-editor ~/.pi/agent/extensions/pi-anthropic-text-editor
cd ~/.pi/agent/extensions/pi-anthropic-text-editor && npm install

# Dev / one-shot test
pi -e /path/to/pi-anthropic-text-editor/src/index.ts
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run check
```

## Origin

Ported from `packages/coding-agent/src/core/extensions/builtin/anthropic-text-editor/index.ts` in `code-yeongyu/senpi-mono`.

## License

[MIT](LICENSE).
