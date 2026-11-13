> **Historical research build:** Later validation found no authoritative context-usage or remaining-capacity signal and no trustworthy failure threshold. The warning labels in this beta were experimental heuristics; do not use this build as an accurate remaining-capacity tool. The current [README](README.md) and [postmortem](docs/POSTMORTEM.md) record the final research conclusion.

# GPT Limits Tool v5.106.0 Beta

The first public beta of GPT Limits Tool is ready.

GPT Limits Tool monitors ChatGPT conversation size and warns when chats are approaching their limits. It supports regular and project conversations, automatic and manual checks, persistent uncertainty warnings, and Rescue export to HTML/TXT.

## Download

`GPT-Limits-Tool-v5.106.0-beta.dmg`

SHA-256:

`8c39557040df48b32ef0beb8ef7f46b107ee6c22396b4f406473eff62cbc2fc0`

## Install

Open the DMG, copy **GPT Limits Tool** to `/Applications`, and launch it.

This beta is distributed without Apple notarization.

If macOS blocks the first launch, use:

**System Settings → Privacy & Security → Open Anyway**

or:

**Finder → right click GPT Limits Tool → Open**

## Known limitations

- Rescue may produce a partial export for extremely large chats when its safety limit is reached.
- Some HTML formatting is simplified.
- When a complete conversation count cannot be proven, GPT Limits Tool intentionally reports **Unknown / Uncertain** rather than a false safe result.
- Temporary ChatGPT rate limits can occasionally produce an incomplete monitoring cycle.

## Build

- **Version:** v5.106.0
- **Build:** `dffbf97fa46307b5`
