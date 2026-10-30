#!/usr/bin/env python3
"""Aggregate one locally saved ChatGPT conversation response without exposing its text."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any


WORD_OR_PUNCTUATION = re.compile(r"[\w]+|[^\w\s]", re.UNICODE)
INTERNAL_CHANNELS = {
    "analysis",
    "commentary",
    "justify",
    "confidence",
    "reasoning",
    "tool",
    "tool_call",
    "delegate_summary",
    "juicepred",
}
ATTACHMENT_TYPES = {
    "image": "image",
    "image_url": "image",
    "audio": "other",
    "audio_file": "other",
    "video": "other",
    "file": "other",
    "file_id": "other",
    "document": "other",
    "spreadsheet": "other",
    "attachment": "other",
}
ATTACHMENT_LABELS = {
    "image": "image",
    "image_url": "image",
    "audio": "audio",
    "audio_file": "audio",
    "video": "video",
    "file": "file",
    "file_id": "file",
    "document": "file",
    "spreadsheet": "file",
    "attachment": "file",
}


def _text_from_content(value: Any) -> list[str]:
    """Read textual content fields only; never stringify metadata or binary payloads."""
    result: list[str] = []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for item in value:
            result.extend(_text_from_content(item))
        return result
    if not isinstance(value, Mapping):
        return result

    content_type = str(value.get("content_type", value.get("type", ""))).lower()
    if content_type in {"image", "audio", "video", "file", "attachment", "reasoning", "thought"}:
        return result
    if isinstance(value.get("text"), str):
        result.append(value["text"])
    for key in ("parts", "text_parts"):
        if key in value:
            result.extend(_text_from_content(value[key]))
    return result


def _attachment_counts(value: Any) -> dict[str, int]:
    counts = {"image": 0, "other": 0}

    def visit(node: Any) -> None:
        if isinstance(node, Mapping):
            kind = str(node.get("content_type", node.get("type", ""))).lower()
            category = ATTACHMENT_TYPES.get(kind)
            if category:
                counts[category] += 1
                return
            matched_key = next((key for key in ATTACHMENT_TYPES if key in node), None)
            if matched_key:
                counts[ATTACHMENT_TYPES[matched_key]] += 1
                return
            for child in node.values():
                visit(child)
        elif isinstance(node, Sequence) and not isinstance(node, (str, bytes, bytearray)):
            for child in node:
                visit(child)

    visit(value)
    return counts


def _estimate_tokens(text: str) -> int:
    """A small, intentionally rough word/punctuation estimate, not a model tokenizer."""
    total = 0
    for piece in WORD_OR_PUNCTUATION.findall(text):
        if piece[0].isalnum() or piece[0] == "_":
            total += max(1, (len(piece) + 3) // 4)
        else:
            total += 1
    return total


def _role(message: Mapping[str, Any]) -> str:
    author = message.get("author")
    if isinstance(author, Mapping):
        return str(author.get("role", "")).lower()
    return ""


def _is_internal_assistant(message: Mapping[str, Any]) -> bool:
    metadata = message.get("metadata")
    if not isinstance(metadata, Mapping):
        return False
    channel = str(metadata.get("channel", "")).lower()
    message_type = str(metadata.get("message_type", "")).lower()
    recipient = str(message.get("recipient", metadata.get("recipient", "all"))).lower()
    return channel in INTERNAL_CHANNELS or message_type in INTERNAL_CHANNELS or (recipient and recipient != "all")


def analyze(data: Any) -> dict[str, Any]:
    if not isinstance(data, Mapping):
        raise ValueError("JSON root must be an object.")
    messages = data.get("messages")
    if not isinstance(messages, list):
        raise ValueError("Expected a top-level 'messages' array in the supplied JSON.")

    unique_messages: list[Mapping[str, Any]] = []
    seen_ids: set[str] = set()
    for item in messages:
        if not isinstance(item, Mapping):
            continue
        message_id = item.get("id")
        if message_id is not None:
            normalized_id = str(message_id)
            if normalized_id in seen_ids:
                continue
            seen_ids.add(normalized_id)
        unique_messages.append(item)

    user_messages = sum(_role(message) == "user" for message in unique_messages)
    assistant_messages = sum(_role(message) == "assistant" for message in unique_messages)
    token_text: list[str] = []
    images = other_attachments = 0
    for message in unique_messages:
        role = _role(message)
        if role in {"user", "assistant"} and not (role == "assistant" and _is_internal_assistant(message)):
            token_text.extend(_text_from_content(message.get("content")))
        attachment_counts = _attachment_counts(message.get("content"))
        images += attachment_counts["image"]
        other_attachments += attachment_counts["other"]

    page_info = data.get("page_info")
    if data.get("history_complete") is True:
        history_complete = "Yes"
    elif isinstance(page_info, Mapping) and (
        page_info.get("has_previous_page") is True or page_info.get("has_next_page") is True
    ):
        history_complete = "No"
    else:
        history_complete = "Unknown"

    return {
        "title": str(data.get("title") or "Unknown"),
        "conversation_id": str(data.get("conversation_id") or "Unknown"),
        "messages": len(unique_messages),
        "user_messages": user_messages,
        "assistant_messages": assistant_messages,
        "estimated_text_tokens": _estimate_tokens("\n".join(token_text)),
        "images": images,
        "other_attachments": other_attachments,
        "history_complete": history_complete,
    }


def render_report(report: Mapping[str, Any]) -> str:
    return "\n".join(
        [
            "GPT Limits Tool — Research Prototype",
            "",
            f"Chat: {report['title']}",
            f"Conversation ID: {report['conversation_id']}",
            f"Messages: {report['messages']}",
            f"User messages: {report['user_messages']}",
            f"Assistant messages: {report['assistant_messages']}",
            f"Estimated text tokens: {report['estimated_text_tokens']}",
            f"Images: {report['images']}",
            f"Other attachments: {report['other_attachments']}",
            f"History complete: {report['history_complete']}",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Aggregate one local ChatGPT conversation JSON response.")
    parser.add_argument("json_file", type=Path, help="Path to a JSON response already saved locally")
    args = parser.parse_args(argv)
    try:
        with args.json_file.open("r", encoding="utf-8") as source:
            data = json.load(source)
        print(render_report(analyze(data)))
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
