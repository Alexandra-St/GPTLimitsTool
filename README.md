# GPT Limits Tool

GPT Limits Tool is a macOS menu bar app that monitors the size of your ChatGPT conversations and warns you before they get dangerously close to the conversation limit.

It works with your existing ChatGPT session and can monitor regular and project chats, including pinned conversations.

## What it does

- Tracks conversation size and keeps a persistent lower bound when a full count cannot be confirmed.
- Shows **Watch**, **Near**, and **Critical** states as a conversation approaches the limit.
- Marks incomplete checks as **Uncertain** instead of pretending everything is fine.
- Supports automatic background checks and manual `Check now`.
- Includes **Rescue** export to HTML and TXT for conversations you want to save.
- Does not steal focus or keep its window permanently on top.

## Current beta

- **Published beta:** v5.106.0
- **Build:** `dffbf97fa46307b5`

Beta package: `GPT-Limits-Tool-v5.106.0-beta.dmg`

SHA-256:

`8c39557040df48b32ef0beb8ef7f46b107ee6c22396b4f406473eff62cbc2fc0`

Current native source/runtime version: **6.2.3**. The published beta and current native source use separate version numbers because development has continued since v5.106.0.

## Repository structure

- `native-prototype/` — current primary macOS implementation.
- `extension/` — separate Chrome beta implementation (`0.2.0-beta`).
- `gpt_limits.py` — standalone local analyzer for saved ChatGPT conversation JSON.

## Installation

1. Open `GPT-Limits-Tool-v5.106.0-beta.dmg`.
2. Copy **GPT Limits Tool** to `/Applications`.
3. Open the app.

The beta is distributed without Apple notarization, so macOS may block the first launch.

If that happens:

- Open **System Settings → Privacy & Security**.
- Find the message about GPT Limits Tool.
- Click **Open Anyway**.

You can also try opening the app from Finder with **right click → Open**. This is normally required only for the first launch.

## Privacy

The app works with your existing ChatGPT session and does not ask you for your ChatGPT password. The tool runs locally. No paid API is used. The app and extension do not make their own undocumented ChatGPT API requests. They do not extract cookies, tokens, or passwords. Monitoring does not store message text. Rescue creates local HTML and TXT exports when you choose to save a conversation. Chat titles in risk notifications can be hidden in the app’s settings.

## Known beta limitations

- **Rescue** uses a safety limit and may intentionally stop before the end of extremely large conversations. The export reports when this happens.
- HTML Rescue export preserves conversation content and order, but some structured formatting is simplified.
- Very large or difficult-to-read conversations may remain **Unknown / Uncertain** if GPT Limits Tool cannot prove a complete count. The app keeps the confirmed lower bound rather than reporting a false safe result.
- ChatGPT-side rate limits or temporary loading failures can occasionally make a monitoring cycle incomplete.

## Chrome extension

The project also includes a beta Chrome extension. To load it locally:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the project’s `extension` folder.
3. Reload ChatGPT and open a conversation.

The extension version is **0.2.0-beta**.

## Beta feedback

If something behaves strangely, the most useful report includes:

- GPT Limits Tool version;
- what you were doing;
- what you expected;
- what happened instead;
- whether the problem happens again after repeating the same steps.

Please do not include private conversation content in bug reports unless it is genuinely necessary.

## License

MIT License. See [LICENSE](LICENSE).
