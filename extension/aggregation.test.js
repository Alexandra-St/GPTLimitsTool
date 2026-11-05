"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { mergePage } = require("./aggregator.js");
const calibrationSummary = require("./calibration-summary.js");
const historyCollector = require("./history-collector.js");
const riskNotifications = require("./risk-notifications.js");

function page(conversationId, title, items, hasPreviousPage = true, isPaginationResponse = false) {
  return {
    conversationId,
    title,
    items,
    isPaginationResponse,
    hasPreviousPage,
    hasNextPage: false,
    capturedAt: 100,
  };
}

function item(id, role, textTokens = 0, attachments = {}) {
  return { id, role, textTokens, attachments };
}

test("collects two pages for one conversation and counts overlapping IDs once", () => {
  let state = mergePage(null, page("chat-a", "First title", [
    item("m1", "user", 4, { images: 1 }),
    item("m2", "assistant", 7),
  ]));
  state = mergePage(state, page("chat-a", "Updated title", [
    item("m2", "assistant", 700, { images: 9 }),
    item("m3", "other", 2, { files: 1 }),
  ], false, true));

  assert.equal(state.title, "Updated title");
  assert.equal(state.messagesCollected, 3);
  assert.equal(state.userMessages, 1);
  assert.equal(state.assistantMessages, 1);
  assert.equal(state.otherMessages, 1);
  assert.equal(state.estimatedTextTokens, 13);
  assert.equal(state.attachments.images, 1);
  assert.equal(state.attachments.files, 1);
  assert.equal(state.historyComplete, true);
  assert.deepEqual(state.processedMessageIds, ["m1", "m2", "m3"]);
});

test("adds only sanitized numeric image totals for new IDs and preserves them across pagination", () => {
  let state = mergePage(null, page("chat-images-aggregate", "Images", [
    item("one-image", "user", 0, { images: 1 }),
  ]));
  assert.equal(state.attachments.images, 1);

  state = mergePage(state, page("chat-images-aggregate", "Images", [
    // The final deduplicated count is canonical. Provenance fields are for
    // diagnostics and must not be added to it a second time.
    {
      ...item("fifteen-images", "user", 0, { images: 15 }),
      attachmentSources: { imageParts: 15, metadataImages: 15 },
    },
  ]));
  assert.equal(state.attachments.images, 16);
  assert.equal(state.attachmentTrace.imagesCounted, 15);

  state = mergePage(state, page("chat-images-aggregate", "Images", [
    {
      ...item("two-images", "user", 0, { images: 2 }),
      attachmentSources: { imageParts: 2, metadataImages: 2 },
    },
  ]));
  assert.equal(state.attachments.images, 18);

  state = mergePage(state, page("chat-images-aggregate", "Images", [
    {
      ...item("fifteen-images", "user", 0, { images: 15 }),
      attachmentSources: { imageParts: 15, metadataImages: 15 },
    },
  ]));
  assert.equal(state.attachments.images, 18);
  assert.equal(state.attachmentTrace.imagesCounted, 0);

  state = mergePage(state, page("chat-images-aggregate", "Images", [
    {
      ...item("no-images", "assistant", 0, { images: 0 }),
      attachmentSources: { imageParts: 0, metadataImages: 0 },
    },
  ]));
  assert.equal(state.attachments.images, 18);

  const persisted = JSON.stringify(state);
  assert.deepEqual(state.processedMessageIds, ["one-image", "fifteen-images", "two-images", "no-images"]);
  assert.equal(state.attachments.images, 18);
  assert.equal(persisted.includes("attachmentSources"), false);
  assert.equal(persisted.includes("asset_pointer"), false);
  assert.equal(persisted.includes("file_id"), false);
  assert.equal(persisted.includes("filename"), false);
  assert.equal(persisted.includes("https://"), false);
});

test("accumulates numeric image diagnostics across responses and retains them through image-free pages", () => {
  const tracePage = (items, raw, sanitized) => ({
    ...page("chat-cumulative-images", "Cumulative", items),
    attachmentTrace: {
      rawImagePartsDetected: raw,
      sanitizedImagePartsPreserved: sanitized,
      rawMetadataImageAttachments: 0,
      sanitizedMetadataImageAttachments: 0,
    },
  });
  let state = mergePage(null, tracePage([
    {
      ...item("image-message", "user", 0, { images: 3 }),
      attachmentSources: { imageParts: 3, metadataImages: 0 },
    },
  ], 3, 3));
  assert.equal(state.attachmentTrace.totalRawImagePartsObserved, 3);
  assert.equal(state.attachmentTrace.totalSanitizedImageParts, 3);
  assert.equal(state.attachmentTrace.totalAggregatorImagePartsReceived, 3);
  assert.equal(state.attachmentTrace.totalImagesAccepted, 3);
  assert.equal(state.attachmentTrace.imageBearingResponsesObserved, 1);
  assert.equal(state.attachmentTrace.imageBearingUniqueMessagesObserved, 1);

  state = mergePage(state, tracePage([
    {
      ...item("image-message", "user", 0, { images: 3 }),
      attachmentSources: { imageParts: 3, metadataImages: 0 },
    },
  ], 3, 3));
  assert.equal(state.attachmentTrace.totalRawImagePartsObserved, 6);
  assert.equal(state.attachmentTrace.totalSanitizedImageParts, 6);
  assert.equal(state.attachmentTrace.totalAggregatorImagePartsReceived, 6);
  assert.equal(state.attachmentTrace.totalImagesAccepted, 3);
  assert.equal(state.attachmentTrace.imageBearingResponsesObserved, 2);
  assert.equal(state.attachmentTrace.imageBearingUniqueMessagesObserved, 1);

  state = mergePage(state, tracePage([item("text-only", "assistant")], 0, 0));
  assert.equal(state.attachmentTrace.totalRawImagePartsObserved, 6);
  assert.equal(state.attachmentTrace.totalSanitizedImageParts, 6);
  assert.equal(state.attachmentTrace.totalAggregatorImagePartsReceived, 6);
  assert.equal(state.attachmentTrace.totalImagesAccepted, 3);
  assert.equal(state.attachmentTrace.imageBearingResponsesObserved, 2);
  assert.equal(state.attachmentTrace.imageBearingUniqueMessagesObserved, 1);
  assert.ok(Object.values(state.attachmentTrace).every((value) => Number.isSafeInteger(value) && value >= 0));
  assert.equal(JSON.stringify(state.attachmentTrace).includes("image-message"), false);

  const resetState = mergePage(null, page("chat-cumulative-images", "Cumulative", []));
  assert.equal(resetState.attachmentTrace.totalRawImagePartsObserved, 0);
  assert.equal(resetState.attachmentTrace.totalSanitizedImageParts, 0);
  assert.equal(resetState.attachmentTrace.totalAggregatorImagePartsReceived, 0);
  assert.equal(resetState.attachmentTrace.totalImagesAccepted, 0);
  assert.equal(resetState.attachmentTrace.imageBearingResponsesObserved, 0);
  assert.equal(resetState.attachmentTrace.imageBearingUniqueMessagesObserved, 0);
});

test("pagination without a title keeps the known title, while a nonempty title can update it", () => {
  let state = mergePage(null, page("chat-title", "C.", [item("initial", "user")]));
  state = mergePage(state, page("chat-title", "", [item("older", "assistant")]));
  assert.equal(state.title, "C.");
  state = mergePage(state, page("chat-title", "Updated title", [item("oldest", "user")]));
  assert.equal(state.title, "Updated title");
  const noTitle = mergePage(null, page("chat-no-title", "", [item("m1", "user")]));
  assert.equal(noTitle.title, "");
});

test("missing and null titles never replace a known title, and a later initial title fills it", () => {
  let state = mergePage(null, page("chat-title-null", "C.", [item("m1", "user")]));
  state = mergePage(state, { ...page("chat-title-null", null, [item("m2", "assistant")]), title: null });
  assert.equal(state.title, "C.");

  let paginationFirst = mergePage(null, page("chat-title-late", "", [item("older", "assistant")]));
  assert.equal(paginationFirst.title, "");
  paginationFirst = mergePage(paginationFirst, page("chat-title-late", "C.", [item("newer", "user")]));
  assert.equal(paginationFirst.title, "C.");
});

test("a different conversation starts a separate accumulator", () => {
  const first = mergePage(null, page("chat-a", "A", [item("same-id", "user", 8)]));
  const second = mergePage(first, page("chat-b", "B", [item("same-id", "assistant", 3)]));
  assert.equal(second.conversationId, "chat-b");
  assert.equal(second.messagesCollected, 1);
  assert.equal(second.userMessages, 0);
  assert.equal(second.assistantMessages, 1);
  assert.deepEqual(second.processedMessageIds, ["same-id"]);
});

test("counts a message with no content but adds no text tokens", () => {
  const state = mergePage(null, page("chat-a", "A", [item("empty-content", "user")]));
  assert.equal(state.messagesCollected, 1);
  assert.equal(state.userMessages, 1);
  assert.equal(state.estimatedTextTokens, 0);
});

test("history stays partial until a page confirms there are no earlier pages", () => {
  const partial = mergePage(null, page("chat-a", "A", [item("m1", "user")], true));
  assert.equal(partial.historyComplete, false);
  assert.equal(partial.hasPreviousPage, true);
  const complete = mergePage(partial, page("chat-a", "A", [item("m0", "user")], false, true));
  assert.equal(complete.historyComplete, true);
  assert.equal(complete.hasPreviousPage, false);
});

test("completes on an accepted nonempty terminal page and keeps final counters stable on replay", () => {
  let state = mergePage(null, page("chat-history-complete", "Known title", [
    item("newest", "user", 10, { images: 1 }),
  ], true, false));
  assert.equal(state.historyComplete, false);
  assert.equal(state.hasPreviousPage, true);

  state = mergePage(state, page("chat-history-complete", "", [
    item("middle-one", "assistant", 20, { images: 2 }),
  ], true, true));
  assert.equal(state.historyComplete, false);
  assert.equal(state.hasPreviousPage, true);
  state = mergePage(state, page("chat-history-complete", "", [
    item("middle-one", "assistant", 200, { images: 20 }),
    item("middle-two", "user", 30, { images: 0 }),
  ], true, true));
  assert.equal(state.historyComplete, false);
  assert.equal(state.messagesCollected, 3);

  const oldestPage = page("chat-history-complete", "", [
    item("middle-two", "user", 300, { images: 30 }),
    item("oldest", "assistant", 40, { images: 3 }),
  ], false, true);
  state = mergePage(state, oldestPage);
  assert.equal(state.historyComplete, true);
  assert.equal(state.hasPreviousPage, false);
  assert.equal(state.title, "Known title");
  assert.equal(state.messagesCollected, 4);
  assert.equal(state.estimatedTextTokens, 100);
  assert.equal(state.attachments.images, 6);

  const beforeReplay = {
    title: state.title,
    messagesCollected: state.messagesCollected,
    userMessages: state.userMessages,
    assistantMessages: state.assistantMessages,
    estimatedTextTokens: state.estimatedTextTokens,
    images: state.attachments.images,
    historyComplete: state.historyComplete,
    hasPreviousPage: state.hasPreviousPage,
  };
  state = mergePage(state, oldestPage);
  assert.deepEqual({
    title: state.title,
    messagesCollected: state.messagesCollected,
    userMessages: state.userMessages,
    assistantMessages: state.assistantMessages,
    estimatedTextTokens: state.estimatedTextTokens,
    images: state.attachments.images,
    historyComplete: state.historyComplete,
    hasPreviousPage: state.hasPreviousPage,
  }, beforeReplay);

  const unconfirmed = mergePage(null, page("chat-unconfirmed", "", [], false, false));
  assert.equal(unconfirmed.hasPreviousPage, false);
  assert.equal(unconfirmed.historyComplete, false);
  const shortResponse = page("chat-short", "", [item("user-turn", "user"), item("assistant-turn", "assistant")], false, false);
  assert.equal(shortResponse.isPaginationResponse, false);
  const shortDetail = mergePage(null, shortResponse);
  assert.equal(shortDetail.messagesCollected, 2);
  assert.equal(shortDetail.historyComplete, true);
});

test("network hook forwards aggregate metadata and never forwards message content", async () => {
  const privateText = "private text that must not leave the response clone";
  const responseData = {
    title: "Test chat",
    conversation_id: "chat-hook",
    messages: [
      { id: "u1", author: { role: "user" }, content: { content_type: "text", parts: [privateText] } },
      { id: "a1", author: { role: "assistant" }, content: { content_type: "text", parts: ["Example answer"] } },
      { id: "s1", author: { role: "system" } },
      { id: "u2", author: { role: "user" } },
    ],
    page_info: { has_previous_page: true, has_next_page: false },
  };
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/chat-hook", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(responseData), {
      headers: { "content-type": "application/json" },
    }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });

  const response = await window.fetch("https://chatgpt.com/backend-api/conversation/chat-hook");
  assert.equal((await response.json()).messages[0].content.parts[0], privateText);
  await new Promise((resolve) => setImmediate(resolve));

  const captureEvent = posted.find((message) => message.summary);
  assert.ok(captureEvent);
  const encoded = JSON.stringify(posted);
  assert.equal(encoded.includes(privateText), false);
  assert.equal(encoded.includes("Example answer"), false);
  assert.equal(captureEvent.diagnostic.captureSource, "fetch");
  assert.deepEqual(JSON.parse(JSON.stringify(captureEvent.diagnostic.responseKeys)), ["title", "conversation_id", "messages", "page_info"]);
  assert.deepEqual(JSON.parse(JSON.stringify(captureEvent.diagnostic.messageKeys)), ["id", "author", "content"]);
  assert.equal(captureEvent.diagnostic.lastResponseMessageCount, 4);
  assert.equal(captureEvent.diagnostic.candidatePath.includes("?"), false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(captureEvent.summary.items)),
    [
      { id: "u1", role: "user", textTokens: 13, activityTime: null, attachments: { images: 0, audio: 0, video: 0, files: 0 }, attachmentSources: { imageParts: 0, metadataImages: 0 } },
      { id: "a1", role: "assistant", textTokens: 4, activityTime: null, attachments: { images: 0, audio: 0, video: 0, files: 0 }, attachmentSources: { imageParts: 0, metadataImages: 0 } },
      { id: "s1", role: "other", textTokens: 0, activityTime: null, attachments: { images: 0, audio: 0, video: 0, files: 0 }, attachmentSources: { imageParts: 0, metadataImages: 0 } },
      { id: "u2", role: "user", textTokens: 0, activityTime: null, attachments: { images: 0, audio: 0, video: 0, files: 0 }, attachmentSources: { imageParts: 0, metadataImages: 0 } },
    ],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(captureEvent.summary.attachmentTrace)), {
    rawImagePartsDetected: 0,
    sanitizedImagePartsPreserved: 0,
    deduplicatedImagesProduced: 0,
    rawMetadataImageAttachments: 0,
    sanitizedMetadataImageAttachments: 0,
  });

  const accumulated = mergePage(null, captureEvent.summary);
  assert.equal(JSON.stringify(accumulated).includes(privateText), false);
  assert.equal(accumulated.messagesCollected, 4);
});

test("counts supported attachment types once per typed part and reports only safe structure", async () => {
  const privateValues = [
    "https://files.example/private-image-url",
    "private-file-id-123",
    "private attachment text",
  ];
  const posted = [];
  const responseData = {
    title: "Attachment test", conversation_id: "chat-attachments",
    messages: [{
      id: "attachment-message", author: { role: "user" },
      content: {
        content_type: "multimodal_text",
        parts: [
          { content_type: "image", image_url: privateValues[0] },
          { type: "audio", audio_file: { file_id: privateValues[1] } },
          { type: "video", video: "private video payload" },
          { type: "file", file_id: privateValues[1], text: privateValues[2] },
          // A typed part with a companion key still represents one item.
          { type: "image", image: "private image payload" },
        ],
      },
      metadata: { attachments: [{ file_id: privateValues[1] }], image: privateValues[0] },
    }],
    page_info: { has_previous_page: false },
  };
  const window = {
    location: { href: "https://chatgpt.com/c/chat-attachments", origin: "https://chatgpt.com", pathname: "/c/chat-attachments" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(responseData), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversations/chat-attachments");
  await new Promise((resolve) => setImmediate(resolve));
  const capture = posted.find((message) => message.summary);
  assert.ok(capture);
  assert.deepEqual(JSON.parse(JSON.stringify(capture.summary.items[0].attachments)), {
    images: 2, audio: 1, video: 1, files: 1,
  });
  const diagnostic = posted.find((message) => message.diagnostic).diagnostic;
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.contentTypes)), ["multimodal_text"]);
  assert.ok(diagnostic.partTypes.includes("image"));
  assert.ok(diagnostic.partKeys.includes("image_url"));
  assert.ok(diagnostic.metadataKeys.includes("attachments"));
  assert.equal(diagnostic.attachmentSignals.image, true);
  const encoded = JSON.stringify(posted);
  for (const privateValue of [...privateValues, "private video payload", "private image payload"]) {
    assert.equal(encoded.includes(privateValue), false);
  }
});

test("deduplicates parts and metadata images by temporary IDs with conservative fallback", async () => {
  const privateIds = [
    "private-file-one", "private-file-two", "private-file-three", "private-file-four", "private-file-five",
    "part-namespace", "metadata-other-namespace", "base-image", "extra-metadata-image",
    "https://files.example/private-image", "private image filename.png", "private image text",
  ];
  const part = (fileId) => ({
    content_type: "image_asset_pointer", file_id: fileId, asset_pointer: `pointer-${fileId}`,
  });
  const metadataImage = (fileId) => ({ type: "image", mime_type: "image/png", file_id: fileId });
  const messages = [
    { id: "same", author: { role: "user" }, content: { parts: [part(privateIds[0])] }, metadata: { attachments: [metadataImage(privateIds[0])] } },
    { id: "pair", author: { role: "user" }, content: { parts: [part(privateIds[1]), part(privateIds[2])] }, metadata: { attachments: [metadataImage(privateIds[1]), metadataImage(privateIds[2])] } },
    { id: "message-3", author: { role: "user" }, content: { parts: [part(privateIds[3])] } },
    { id: "message-4", author: { role: "user" }, content: { parts: [] }, metadata: { attachments: [metadataImage(privateIds[4])] } },
    {
      id: "ambiguous-metadata", author: { role: "user" },
      content: { parts: [part(privateIds[5])] },
      metadata: { attachments: [{ type: "image", id: privateIds[6] }] },
    },
    {
      id: "unique-metadata", author: { role: "user" },
      content: { parts: [part(privateIds[7])] },
      metadata: { attachments: [metadataImage(privateIds[7]), metadataImage(privateIds[8])] },
    },
  ];
  const bodies = [
    { title: "Dedup test", conversation_id: "chat-image-dedup", messages, page_info: { has_previous_page: true } },
    { messages: [messages[1]], page_info: { has_previous_page: false } },
  ];
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/chat-image-dedup", origin: "https://chatgpt.com", pathname: "/c/chat-image-dedup" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(bodies.shift()), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversations/chat-image-dedup");
  await new Promise((resolve) => setImmediate(resolve));
  const first = posted.find((message) => message.summary);
  assert.deepEqual(
    JSON.parse(JSON.stringify(first.summary.items.map((entry) => entry.attachments.images))),
    [1, 2, 1, 1, 1, 2],
  );
  assert.equal(first.summary.attachmentTrace.deduplicatedImagesProduced, 8);
  assert.equal(first.summary.attachmentTrace.sanitizedMetadataImageAttachments, 2);

  await window.fetch("https://chatgpt.com/backend-api/conversations/chat-image-dedup/messages?cursor=private");
  await new Promise((resolve) => setImmediate(resolve));
  let state = null;
  for (const capture of posted.filter((message) => message.summary)) state = mergePage(state, capture.summary);
  assert.equal(state.attachments.images, 8);
  assert.equal(state.attachmentTrace.totalImagesAccepted, 8);
  assert.equal(state.attachmentTrace.totalDeduplicatedImagesProduced, 10);
  assert.ok(Object.values(state.attachmentTrace).every((value) => Number.isSafeInteger(value) && value >= 0));
  const persisted = JSON.stringify({ summaries: posted.filter((message) => message.summary).map((message) => message.summary), state });
  const privateValuesToCheck = [...privateIds, ...privateIds.slice(0, 9).map((id) => `pointer-${id}`), "chat-image-dedup?cursor=private"];
  for (const [index, privateValue] of privateValuesToCheck.entries()) {
    assert.equal(persisted.includes(privateValue), false, `private sentinel ${index} was serialized`);
  }
});

test("counts real metadata image attachments by objects and deduplicates repeated message pages", async () => {
  const secretValues = [
    "private-file-id-one", "private-file-id-two", "private-file-id-three",
    "https://files.example/signed/private-image", "private-photo-name.png", "private image caption",
  ];
  const imageOne = {
    type: "image", mime_type: "image/jpeg", height: 1200, width: 800,
    file_id: secretValues[0], filename: secretValues[4], content_references: [{ url: secretValues[3] }],
  };
  const imageTwo = { mime_type: "image/png", height: 900, width: 600, file_id: secretValues[1] };
  const refOnlyImage = { type: "image", mime_type: "image/webp", file_id: secretValues[2] };
  const bodies = [
    {
      title: "Images chat", conversation_id: "image-chat", page_info: { has_previous_page: true },
      messages: [{
        id: "image-message", author: { role: "user" },
        content: { content_type: "multimodal_text", parts: [imageOne, secretValues[5]] },
        metadata: {
          attachments: [imageOne, imageTwo,
            { type: "image", mime_type: "application/pdf", height: 300, width: 200, file_id: "not-an-image" },
            { height: 500, width: 400, file_id: "dimensions-alone" },
          ],
          content_references: [{ ...imageOne }, refOnlyImage],
        },
      }],
    },
    {
      page_info: { has_previous_page: false },
      messages: [
        {
          id: "image-message", author: { role: "user" },
          content: { content_type: "multimodal_text", parts: [] },
          metadata: { attachments: [imageOne, imageTwo] },
        },
        { id: "no-image-message", author: { role: "assistant" }, content: { parts: ["ordinary text"] } },
      ],
    },
  ];
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/image-chat", origin: "https://chatgpt.com", pathname: "/c/image-chat" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(bodies.shift()), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversations/image-chat");
  await new Promise((resolve) => setImmediate(resolve));
  const firstCapture = posted.find((message) => message.summary);
  assert.equal(firstCapture.summary.items[0].attachments.images, 3);
  assert.equal(firstCapture.diagnostic.attachmentSignals.image, true);

  await window.fetch("https://chatgpt.com/backend-api/conversations/image-chat/messages?cursor=private");
  await new Promise((resolve) => setImmediate(resolve));
  const captures = posted.filter((message) => message.summary);
  let state = null;
  for (const capture of captures) state = mergePage(state, capture.summary);
  assert.equal(state.messagesCollected, 2);
  assert.equal(state.attachments.images, 3);
  assert.equal(state.title, "Images chat");
  assert.equal(state.hasPreviousPage, false);
  const persisted = JSON.stringify({ captures: captures.map((capture) => capture.summary), state });
  for (const secret of [...secretValues, "not-an-image", "dimensions-alone", "ordinary text", "cursor=private"]) {
    assert.equal(persisted.includes(secret), false);
  }
});

test("counts image_asset_pointer parts, MIME-only image parts, and suppresses metadata duplicates", async () => {
  const secrets = [
    "asset-pointer-1", "asset-pointer-2", "asset-pointer-3", "asset-pointer-4",
    "https://files.example/signed/one", "private image text",
  ];
  const partOne = {
    // A generic type and non-MIME mime_type must not mask the explicit part type.
    type: "other", content_type: "image_asset_pointer", mime_type: "image_asset_pointer",
    width: 1200, height: 800, asset_pointer: secrets[0],
  };
  const partTwo = { content_type: "image_asset_pointer", asset_pointer: secrets[1] };
  const partThree = { content_type: "image_asset_pointer", mime_type: "image/png", asset_pointer: secrets[2] };
  const mimeOnly = { mime_type: "image/jpeg", width: 640, height: 480, asset_pointer: secrets[3] };
  const originalMessages = [
    {
      id: "one-image", author: { role: "user" },
      content: { content_type: "multimodal_text", parts: [partOne, { content_type: "text", text: secrets[5] }] },
      metadata: { attachments: [{ ...partOne }] },
    },
    {
      id: "two-images", author: { role: "user" },
      content: { content_type: "multimodal_text", parts: [partTwo, partThree] },
      metadata: { attachments: [{ ...partTwo }, { ...partThree }] },
    },
    { id: "mime-image", author: { role: "user" }, content: { parts: [mimeOnly] } },
    { id: "text-only", author: { role: "user" }, content: { content_type: "text", parts: ["plain text"] } },
  ];
  const bodies = [
    {
      title: "Image pointer chat", conversation_id: "pointer-chat", page_info: { has_previous_page: true },
      messages: originalMessages,
    },
    {
      page_info: { has_previous_page: false },
      messages: [originalMessages[0], { id: "later-text", author: { role: "assistant" }, content: { parts: ["private pagination response body"] } }],
    },
  ];
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/pointer-chat", origin: "https://chatgpt.com", pathname: "/c/pointer-chat" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(bodies.shift()), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversations/pointer-chat");
  await new Promise((resolve) => setImmediate(resolve));
  const firstCapture = posted.find((message) => message.summary);
  assert.deepEqual(
    JSON.parse(JSON.stringify(firstCapture.summary.items.map((entry) => entry.attachments.images))),
    [1, 2, 1, 0],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(firstCapture.summary.attachmentTrace)), {
    rawImagePartsDetected: 4,
    sanitizedImagePartsPreserved: 4,
    deduplicatedImagesProduced: 4,
    rawMetadataImageAttachments: 3,
    sanitizedMetadataImageAttachments: 0,
  });

  await window.fetch("https://chatgpt.com/backend-api/conversations/pointer-chat/messages?cursor=private-cursor");
  await new Promise((resolve) => setImmediate(resolve));
  let state = null;
  for (const capture of posted.filter((message) => message.summary)) state = mergePage(state, capture.summary);
  assert.equal(state.messagesCollected, 5);
  assert.equal(state.attachments.images, 4);
  assert.equal(state.title, "Image pointer chat");
  assert.deepEqual(JSON.parse(JSON.stringify(state.attachmentTrace)), {
    rawImagePartsDetected: 1,
    sanitizedImagePartsPreserved: 1,
    deduplicatedImagesProduced: 1,
    aggregatorImagePartsReceived: 1,
    imagesCounted: 0,
    rawMetadataImageAttachments: 1,
    sanitizedMetadataImageAttachments: 0,
    aggregatorMetadataImageAttachments: 0,
    totalRawImagePartsObserved: 5,
    totalSanitizedImageParts: 5,
    totalDeduplicatedImagesProduced: 5,
    totalAggregatorImagePartsReceived: 5,
    totalImagesAccepted: 4,
    imageBearingResponsesObserved: 2,
    imageBearingUniqueMessagesObserved: 3,
    totalRawMetadataImageAttachments: 4,
    totalSanitizedMetadataImageAttachments: 0,
    totalAggregatorMetadataImageAttachments: 0,
  });
  const persisted = JSON.stringify({ summaries: posted.filter((message) => message.summary).map((message) => message.summary), state });
  for (const secret of [...secrets, "private-cursor", "plain text", "private pagination response body"]) {
    assert.equal(persisted.includes(secret), false);
  }
});

test("ignores a URL candidate whose JSON only contains status", async () => {
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/chat-status", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify({ status: "ok" }), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversation/candidate?token=must-not-be-kept");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.some((message) => message.diagnostic || message.summary), false);
  const candidate = posted.find((message) => message.candidatePath);
  assert.ok(candidate);
  assert.equal(candidate.candidatePath, "/backend-api/conversation/candidate");
  assert.equal(JSON.stringify(posted).includes("must-not-be-kept"), false);
});

test("reports a high-confidence conversation-like response missing messages", async () => {
  const posted = [];
  const body = { conversation_id: "chat-missing", title: "Safe title", secret_value: "never forward", page_info: {} };
  const window = {
    location: { href: "https://chatgpt.com/c/chat-missing", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversation/chat-missing");
  await new Promise((resolve) => setImmediate(resolve));
  const errorEvent = posted.find((message) => message.diagnostic);
  assert.ok(errorEvent);
  assert.match(errorEvent.diagnostic.error, /messages/);
  assert.equal(JSON.stringify(posted).includes("never forward"), false);
  assert.equal(errorEvent.summary, undefined);
});

test("keeps waiting when a URL candidate contains invalid JSON", async () => {
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/chat-invalid", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response("not json", { headers: { "content-type": "text/plain" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversation/chat-invalid");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.some((message) => message.diagnostic || message.summary), false);
  assert.ok(posted.some((message) => message.candidatePath));
  assert.equal(JSON.stringify(posted).includes("not json"), false);
});

test("a false candidate does not prevent the following real response from being captured", async () => {
  const posted = [];
  const bodies = [
    { status: "ok" },
    { title: "Actual chat", conversation_id: "real-chat", messages: [{ id: "m1", author: { role: "user" } }], page_info: {} },
  ];
  const window = {
    location: { href: "https://chatgpt.com/c/real-chat", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(bodies.shift()), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversation/real-chat?secret=redacted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.some((message) => message.diagnostic), false);
  await window.fetch("https://chatgpt.com/backend-api/conversation/real-chat?secret=redacted");
  await new Promise((resolve) => setImmediate(resolve));
  const actual = posted.find((message) => message.summary);
  assert.ok(actual);
  assert.equal(actual.summary.conversationId, "real-chat");
  assert.equal(actual.diagnostic.title, "Actual chat");
  assert.equal(JSON.stringify(posted).includes("secret=redacted"), false);
});

test("captures valid XHR responses and reports capture type", async () => {
  const posted = [];
  class FakeXHR {
    open(_method, url) { this.url = url; }
    addEventListener(type, callback) { if (type === "load") this.loadHandler = callback; }
    send() {
      this.responseURL = this.url;
      this.responseType = "";
      this.responseText = JSON.stringify({
        title: "XHR chat", conversation_id: "chat-xhr", messages: [{ id: "x1", author: { role: "user" } }],
        page_info: { has_previous_page: false, has_next_page: false },
      });
      this.loadHandler();
    }
  }
  const window = {
    location: { href: "https://chatgpt.com/c/chat-xhr", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response("{}"),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: FakeXHR, Set, String, Date, Promise });
  const xhr = new FakeXHR();
  xhr.open("GET", "https://chatgpt.com/backend-api/conversation/chat-xhr");
  xhr.send();
  const captured = posted.find((message) => message.summary);
  assert.ok(captured);
  assert.equal(captured.diagnostic.captureSource, "XHR");
  assert.equal(captured.diagnostic.conversationId, "chat-xhr");
  assert.equal(captured.diagnostic.lastResponseMessageCount, 1);
});

test("page hook replays only the latest sanitized capture for the same conversation and active session", async () => {
  const posted = [];
  const handlers = [];
  const payload = {
    title: "Replay chat", conversation_id: "replay-chat",
    messages: [{ id: "replay-message", author: { role: "user" }, content: { parts: [{ text: "private message body" }] } }],
    page_info: { has_previous_page: false },
  };
  const window = {
    location: { href: "https://chatgpt.com/c/replay-chat", origin: "https://chatgpt.com" },
    addEventListener(_type, listener) { handlers.push(listener); },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8"), {
    window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise,
  });
  await window.fetch("https://chatgpt.com/backend-api/conversations/replay-chat");
  await new Promise((resolve) => setImmediate(resolve));
  const captured = posted.find((message) => message.summary);
  assert.ok(captured);
  assert.equal(typeof captured.captureSequence, "number");
  const replayRequest = (conversationId, startedAt, requestId) => handlers[0](
    { source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1:replay-last-capture", conversationId, startedAt, requestId } },
  );
  replayRequest("another-chat", captured.summary.capturedAt - 1, "wrong-chat");
  replayRequest("replay-chat", captured.summary.capturedAt + 1, "old-session");
  assert.equal(posted.filter((message) => message.replayRequestId).length, 0);
  replayRequest("replay-chat", captured.summary.capturedAt, "current-session");
  const replay = posted.find((message) => message.replayRequestId === "current-session");
  assert.ok(replay);
  assert.equal(replay.captureSequence, captured.captureSequence);
  assert.equal(JSON.stringify(replay).includes("private message body"), false);
});

test("installs the hook before the simulated initial fetch without popup involvement", async () => {
  const posted = [];
  const payload = {
    title: "Initial chat", conversation_id: "initial-chat", messages: [{ id: "first", author: { role: "user" } }],
    page_info: {},
  };
  const window = {
    location: { href: "https://chatgpt.com/c/initial-chat", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  // Evaluating the static MAIN-world script represents document_start; the
  // first page request runs immediately, before any popup exists.
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  const installedIndex = posted.findIndex((message) => message.hookStatus === "installed");
  const response = await window.fetch("https://chatgpt.com/backend-api/conversation/initial-chat");
  await response.json();
  await new Promise((resolve) => setImmediate(resolve));
  const captureIndex = posted.findIndex((message) => message.summary);
  assert.ok(installedIndex >= 0);
  assert.ok(captureIndex > installedIndex);
  assert.ok(Number.isFinite(posted[installedIndex].hookInstalledAt));
  assert.equal(posted[captureIndex].summary.conversationId, "initial-chat");
});

test("ignores stream_status even when its path contains conversation", async () => {
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/chat-stream", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify({ status: "complete" }), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversation/chat-stream/stream_status?secret=no-store");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.some((message) => message.summary || message.diagnostic || message.candidatePath), false);
  assert.equal(posted.find((message) => message.networkResource)?.networkResource.pathname, "/backend-api/conversation/chat-stream/stream_status");
  assert.equal(JSON.stringify(posted).includes("secret=no-store"), false);
});

test("ignores the singular conversation init endpoint as a history response", async () => {
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/chat-init", origin: "https://chatgpt.com", pathname: "/c/chat-init" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify({ status: "ready" }), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversation/init");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.some((message) => message.summary || message.diagnostic || message.candidatePath), false);
  assert.equal(posted.some((message) => message.networkResource?.pathname === "/backend-api/conversation/init"), true);
});

test("captures plural conversations endpoint and merges repeated responses without recounting IDs", async () => {
  const privateText = "private text stays out of the stored summary";
  const responses = [
    { title: "Chat", conversation_id: "plural-chat", current_node: "n2", page_info: { has_previous_page: true, has_next_page: false }, messages: [
      { id: "m1", author: { role: "user" }, content: { parts: [privateText] } },
      { id: "m2", author: { role: "assistant" }, content: { parts: ["assistant secret"] } },
    ] },
    { title: "Chat", conversation_id: "plural-chat", current_node: "n2", page_info: { has_previous_page: true, has_next_page: false }, messages: [
      { id: "m1", author: { role: "user" }, content: { parts: [privateText] } },
      { id: "m2", author: { role: "assistant" }, content: { parts: ["assistant secret"] } },
    ] },
    { title: "Chat updated", conversation_id: "plural-chat", current_node: "n3", page_info: { has_previous_page: false, has_next_page: false }, messages: [
      { id: "m2", author: { role: "assistant" }, content: { parts: ["assistant secret"] } },
      { id: "m3", author: { role: "user" }, content: { parts: ["new secret"] } },
    ] },
  ];
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/plural-chat", origin: "https://chatgpt.com", pathname: "/c/plural-chat" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(responses.shift()), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  for (let index = 0; index < 3; index += 1) {
    // Same pathname, different opaque cursor values. The hook must not retain them.
    await window.fetch(`https://chatgpt.com/backend-api/conversations/plural-chat?num_turns=10&cursor=cursor-${index}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const captures = posted.filter((message) => message.summary);
  assert.equal(captures.length, 3);
  assert.equal(captures[0].diagnostic.candidatePath, "/backend-api/conversations/plural-chat");
  assert.equal(captures[0].diagnostic.captureSource, "fetch");
  assert.deepEqual(JSON.parse(JSON.stringify(captures[0].diagnostic.responseKeys)), ["title", "conversation_id", "current_node", "page_info", "messages"]);
  let state = null;
  for (const [index, capture] of captures.entries()) {
    state = mergePage(state, capture.summary);
    if (index === 0) {
      assert.equal(state.messagesCollected, 2);
      assert.equal(state.responsesCaptured, 1);
      assert.equal(state.hasPreviousPage, true);
      assert.equal(state.historyComplete, false);
    } else if (index === 1) {
      assert.equal(state.messagesCollected, 2);
      assert.equal(state.responsesCaptured, 2);
      assert.equal(state.historyComplete, false);
    }
  }
  assert.equal(state.conversationId, "plural-chat");
  assert.equal(state.title, "Chat updated");
  assert.equal(state.messagesCollected, 3);
  assert.equal(state.userMessages, 2);
  assert.equal(state.assistantMessages, 1);
  assert.equal(state.responsesCaptured, 3);
  assert.equal(state.hasPreviousPage, false);
  assert.equal(state.hasNextPage, false);
  assert.equal(state.historyComplete, true);
  assert.deepEqual(state.processedMessageIds, ["m1", "m2", "m3"]);
  const stored = JSON.stringify({ captures: captures.map((capture) => capture.summary), state });
  for (const forbidden of [privateText, "assistant secret", "new secret", "num_turns=10", "cursor-0", "cursor-1", "cursor-2"]) {
    assert.equal(stored.includes(forbidden), false);
  }
});

test("captures messages pagination response by pathname and merges it without retaining text", async () => {
  const privateText = "pagination body text must never persist";
  const bodies = [
    {
      title: "Long chat", conversation_id: "paged-chat",
      page_info: { has_previous_page: true, has_next_page: false },
      messages: [
        { id: "newer-1", author: { role: "user" }, content: { parts: ["existing user"] } },
        { id: "newer-2", author: { role: "assistant" }, content: { parts: ["existing reply"] } },
      ],
    },
    {
      // The pagination response intentionally has no conversation_id field.
      page_info: { has_previous_page: true, has_next_page: true },
      messages: [
        { id: "older-1", author: { role: "user" }, content: { parts: [privateText] } },
        { id: "newer-2", author: { role: "assistant" }, content: { parts: ["duplicate reply"] } },
      ],
    },
    {
      page_info: { has_previous_page: true, has_next_page: true },
      messages: [
        { id: "older-1", author: { role: "user" }, content: { parts: [privateText] } },
        { id: "newer-2", author: { role: "assistant" }, content: { parts: ["duplicate reply"] } },
      ],
    },
    {
      page_info: { has_previous_page: false, has_next_page: true },
      messages: [
        { id: "oldest-1", author: { role: "assistant" }, content: { parts: ["oldest answer"] } },
        { id: "older-1", author: { role: "user" }, content: { parts: [privateText] } },
      ],
    },
  ];
  const posted = [];
  const window = {
    location: {
      href: "https://chatgpt.com/c/paged-chat", origin: "https://chatgpt.com", pathname: "/c/paged-chat",
    },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(bodies.shift()), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });

  await window.fetch("https://chatgpt.com/backend-api/conversations/paged-chat");
  await new Promise((resolve) => setImmediate(resolve));
  for (let index = 0; index < 3; index += 1) {
    await window.fetch(`https://chatgpt.com/backend-api/conversations/paged-chat/messages?cursor=secret-${index}`);
    await new Promise((resolve) => setImmediate(resolve));
  }

  const captures = posted.filter((message) => message.summary);
  assert.equal(captures.length, 4);
  assert.equal(captures[1].diagnostic.isPaginationResponse, true);
  assert.equal(captures[1].diagnostic.conversationIdSource, "pathname");
  assert.equal(captures[1].diagnostic.conversationId, "paged-chat");
  assert.deepEqual(JSON.parse(JSON.stringify(captures[1].diagnostic.responseKeys)), ["page_info", "messages"]);
  assert.deepEqual(JSON.parse(JSON.stringify(captures[1].diagnostic.messageKeys)), ["id", "author", "content"]);
  assert.equal(captures[1].diagnostic.hasPreviousPage, true);
  assert.equal(captures[1].summary.hasNextPage, true);

  let state = null;
  for (const capture of captures) state = mergePage(state, capture.summary);
  assert.equal(state.conversationId, "paged-chat");
  assert.equal(state.messagesCollected, 4);
  assert.equal(state.userMessages, 2);
  assert.equal(state.assistantMessages, 2);
  assert.equal(state.responsesCaptured, 4);
  assert.equal(state.hasPreviousPage, false);
  assert.equal(state.hasNextPage, true);
  assert.equal(state.historyComplete, true);
  assert.deepEqual(state.processedMessageIds, ["newer-1", "newer-2", "older-1", "oldest-1"]);
  const serialized = JSON.stringify({ posted, state });
  for (const forbidden of [privateText, "existing user", "existing reply", "duplicate reply", "oldest answer", "cursor=secret"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("rejects mismatched messages path and does not capture conversations batch", async () => {
  const posted = [];
  const bodies = [
    { page_info: {}, messages: [{ id: "wrong-chat-message", author: { role: "user" } }] },
    { messages: [{ id: "batch-message", author: { role: "user" } }] },
  ];
  const window = {
    location: { href: "https://chatgpt.com/c/open-chat", origin: "https://chatgpt.com", pathname: "/c/open-chat" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(bodies.shift()), { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversations/other-chat/messages");
  await new Promise((resolve) => setImmediate(resolve));
  await window.fetch("https://chatgpt.com/backend-api/conversations/batch");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.some((message) => message.summary), false);
  const mismatch = posted.find((message) => message.diagnostic);
  assert.match(mismatch.diagnostic.error, /does not match/);
  assert.equal(mismatch.diagnostic.conversationId, "other-chat");
  assert.equal(posted.some((message) => message.candidatePath === "/backend-api/conversations/batch"), false);
});

test("reports an unexpected messages pagination structure without forwarding body", async () => {
  const privateText = "unexpected payload value";
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/shape-chat", origin: "https://chatgpt.com", pathname: "/c/shape-chat" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify({ messages: [{ content: privateText }] }), {
      headers: { "content-type": "application/json" },
    }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversations/shape-chat/messages");
  await new Promise((resolve) => setImmediate(resolve));
  const error = posted.find((message) => message.diagnostic);
  assert.ok(error);
  assert.match(error.diagnostic.error, /message ID or author role missing/);
  assert.equal(error.diagnostic.lastResponseMessageCount, 1);
  assert.equal(error.summary, undefined);
  assert.equal(JSON.stringify(posted).includes(privateText), false);
});

test("does not report a capture when no conversation response is observed", async () => {
  const posted = [];
  const window = {
    location: { href: "https://chatgpt.com/c/chat-none", origin: "https://chatgpt.com" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/other");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posted.some((message) => message.diagnostic || message.summary || message.candidatePath), false);
  assert.ok(posted.some((message) => message.hookStatus === "installed"));
  // With no conversation diagnostic the popup uses its explicit Waiting status.
});

test("content script persists aggregate state only, never message text", async () => {
  const privateText = "do not persist this private body";
  const stored = {
    gptLimitsLastCaptureDiagnostic: { responseKeys: ["messages"] },
    gptLimitsLastCandidatePath: "/backend-api/conversations/example",
    gptLimitsHookTiming: { hookInstalledAt: 1 },
    gptLimitsObservedNetworkResources: [{ pathname: "/backend-api/conversations/example" }],
  };
  let windowListener;
  let runtimeListener;
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/chat-local" },
    addEventListener(type, callback) {
      if (type === "message") windowListener = callback;
    },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, stored[key]]));
        },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
    },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  const source = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  vm.runInNewContext(source, { window, chrome, globalThis: { GptLimitsAggregator: require("./aggregator.js") } });

  const compactSummary = {
    title: "Local only",
    conversationId: "chat-local",
    items: [item("m1", "user", 9)],
    hasPreviousPage: true,
    hasNextPage: false,
    capturedAt: 100,
  };
  assert.equal(JSON.stringify(compactSummary).includes(privateText), false);
  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", summary: compactSummary },
  });

  await new Promise((resolve) => setImmediate(resolve));
  const response = await new Promise((resolve) => {
    runtimeListener({ type: "gpt-limits:get-current-state" }, {}, resolve);
  });
  const encodedStorage = JSON.stringify(stored);
  assert.equal(response.state.messagesCollected, 1);
  assert.deepEqual(response.state.processedMessageIds, ["m1"]);
  assert.equal(encodedStorage.includes(privateText), false);
  assert.equal(encodedStorage.includes("content"), false);
  assert.equal("attachmentTrace" in stored.gptLimitsChats["chat-local"], false);
  assert.equal("responsesCaptured" in stored.gptLimitsChats["chat-local"], false);
  assert.equal(stored.gptLimitsCurrentConversation, undefined);

  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", diagnostic: {
      captureSource: "fetch", capturedAt: 101, responseKeys: ["title", "messages"], messageKeys: ["id"],
      conversationId: "chat-local", title: "Local only", lastResponseMessageCount: 1,
      hasPreviousPage: true, hasNextPage: false, error: null,
      contentTypes: ["multimodal_text", "private content string"],
      partTypes: ["image", "https://files.example/private-url"],
      partKeys: ["image_url", "private-file-id"],
      metadataKeys: ["attachments", "private text"],
      attachmentSignals: { image: true, audio: false, video: false, file: true, privateValue: "secret" },
    } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.gptLimitsLastCaptureDiagnostic, undefined);
  assert.equal(stored.gptLimitsLastCandidatePath, undefined);
  assert.equal(stored.gptLimitsHookTiming, undefined);
  assert.equal(stored.gptLimitsObservedNetworkResources, undefined);

  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", diagnostic: {
      captureSource: "fetch", capturedAt: 102, responseKeys: ["status"], messageKeys: [],
      conversationId: null, title: null, lastResponseMessageCount: null,
      hasPreviousPage: null, hasNextPage: null, error: "stale weak error",
    } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", candidatePath: "/backend-api/conversation/x", candidateAt: 103 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.gptLimitsLastCaptureDiagnostic, undefined);
  assert.equal(stored.gptLimitsLastCandidatePath, undefined);
  assert.equal(JSON.stringify(stored).includes("?"), false);

  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", hookStatus: "installed", hookInstalledAt: 104 },
  });
  await new Promise((resolve) => setImmediate(resolve));
  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", candidatePath: "/backend-api/conversation/x/stream_status", candidateAt: 105, candidateSource: "fetch" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const timingResult = await new Promise((resolve) => {
    runtimeListener({ type: "gpt-limits:get-current-state" }, {}, resolve);
  });
  assert.equal(timingResult.captureStatus, "Error");
  assert.equal(timingResult.timing, undefined);
});

test("resets only the current chat aggregate and lets its message IDs be counted again", async () => {
  const currentState = mergePage(null, {
    ...page("chat-reset", "Old title", [item("known-before-reset", "user", 40, { images: 0 })], false, true),
    attachmentTrace: { rawImagePartsDetected: 9, sanitizedImagePartsPreserved: 9 },
  });
  currentState.riskNotificationLevel = 3;
  assert.equal(currentState.historyComplete, true);
  const otherState = mergePage(null, page("chat-other", "Other chat", [
    item("other-message", "assistant", 12, { images: 3 }),
  ]));
  const stored = {
    gptLimitsChats: { "chat-reset": currentState, "chat-other": otherState },
    extensionSettings: { enabled: true },
    authToken: "untouched-test-sentinel",
  };
  let windowListener;
  let runtimeListener;
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/chat-reset" },
    addEventListener(type, callback) { if (type === "message") windowListener = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, stored[key]]));
        },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
        },
      },
    },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  const source = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  vm.runInNewContext(source, { window, chrome, globalThis: { GptLimitsAggregator: require("./aggregator.js") } });

  const beforeReset = await new Promise((resolve) => {
    runtimeListener({ type: "gpt-limits:get-current-state" }, {}, resolve);
  });
  assert.equal(beforeReset.state?.conversationId, "chat-reset");

  const resetResult = await new Promise((resolve) => {
    runtimeListener({ type: "gpt-limits:reset-current-chat", conversationId: "chat-reset" }, {}, resolve);
  });
  assert.equal(resetResult.ok, true);
  assert.equal(stored.gptLimitsChats["chat-reset"].title, "Old title");
  assert.deepEqual(JSON.parse(JSON.stringify(stored.gptLimitsChats["chat-reset"].processedMessageIds)), []);
  assert.equal(stored.gptLimitsChats["chat-reset"].attachmentTrace, undefined);
  assert.equal(stored.gptLimitsChats["chat-reset"].responsesCaptured, undefined);
  assert.equal(stored.gptLimitsChats["chat-reset"].messagesCollected, 0);
  assert.equal(stored.gptLimitsChats["chat-reset"].attachments.images, 0);
  assert.equal(stored.gptLimitsChats["chat-reset"].historyComplete, false);
  assert.equal(stored.gptLimitsChats["chat-reset"].riskNotificationLevel, 0, "Reset clears notification deduplication state");
  assert.equal(stored.gptLimitsChats["chat-other"].title, "Other chat");
  assert.equal(stored.gptLimitsChats["chat-other"].messagesCollected, 1);
  assert.equal(stored.gptLimitsChats["chat-other"].attachments.images, 3);
  assert.deepEqual(stored.extensionSettings, { enabled: true });
  assert.equal(stored.authToken, "untouched-test-sentinel");

  const rejectedReset = await new Promise((resolve) => {
    runtimeListener({ type: "gpt-limits:reset-current-chat", conversationId: "chat-other" }, {}, resolve);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(rejectedReset)), { ok: false });
  assert.equal(stored.gptLimitsChats["chat-other"].title, "Other chat");
  assert.equal(stored.gptLimitsChats["chat-other"].messagesCollected, 1);
  assert.equal(stored.gptLimitsChats["chat-other"].attachments.images, 3);

  windowListener({
    source: window,
    origin: window.location.origin,
    data: {
      source: "gpt-limits-tool-capture-v1",
      summary: {
        ...page("chat-reset", "", [
          { ...item("known-before-reset", "user", 40, { images: 2 }), attachmentSources: { imageParts: 3, metadataImages: 0 } },
        ]),
        attachmentTrace: { rawImagePartsDetected: 3, sanitizedImagePartsPreserved: 3 },
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const rebuilt = stored.gptLimitsChats["chat-reset"];
  assert.equal(rebuilt.title, "Old title");
  assert.equal(rebuilt.messagesCollected, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(rebuilt.processedMessageIds)), ["known-before-reset"]);
  assert.equal(rebuilt.attachments.images, 2);
  assert.equal(rebuilt.hasPreviousPage, true);
  assert.equal(rebuilt.historyComplete, false);
  assert.equal(rebuilt.attachmentTrace, undefined);
  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", summary: page("chat-reset", "C.", []) },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.gptLimitsChats["chat-reset"].title, "C.");
  assert.equal(stored.gptLimitsChats["chat-other"].title, "Other chat");
  assert.equal(stored.gptLimitsChats["chat-other"].messagesCollected, 1);
  assert.equal(stored.gptLimitsChats["chat-other"].attachments.images, 3);
  assert.deepEqual(stored.extensionSettings, { enabled: true });
  assert.equal(stored.authToken, "untouched-test-sentinel");
});

test("popup exposes compact aggregate fields and monitor actions without research diagnostics", () => {
  const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  for (const id of ["title", "message-count", "user-count", "assistant-count", "other-count", "token-count", "risk-state", "images-count", "audio-count", "video-count", "files-count", "history-status", "last-updated", "reset-current-chat", "desktop-risk-notifications", "desktop-risk-notifications-state"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["tracked-chats-section", "monitored-chats", "other-tracked-chats"]) assert.match(html, new RegExp(`id="${id}"`));
  const popupJs = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  assert.match(popupJs, /Stop monitoring/);
  assert.match(popupJs, /gpt-limits:set-monitored/);
  assert.match(popupJs, /Calibration samples/);
  assert.match(popupJs, /Normal/);
  assert.match(popupJs, /Near limit/);
  assert.match(popupJs, /Limit reached/);
  assert.match(popupJs, /gpt-limits:set-calibration-label/);
  assert.match(html, /Calibration data/);
  for (const id of ["latest-points", "latest-complete-points"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Risk model details/);
  assert.match(html, /Desktop risk notifications/);
  assert.match(html, /id="send-test-notification"[^>]*disabled/);
  assert.match(popupJs, /gpt-limits:send-test-notification/);
  assert.match(html, /Automatic monitored-chat checks/);
  assert.match(html, /id="automatic-check-interval"/);
  for (const id of ["automatic-scheduler-alarm", "automatic-scheduler-next", "automatic-scheduler-last-tick", "automatic-scheduler-result", "run-automatic-tick"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const value of ["off", "30", "60", "180"]) assert.match(html, new RegExp(`<option value="${value}"`));
  assert.match(html, /automatic-check-status/);
  assert.match(html, /automatic-check-next/);
  assert.match(html, /automatic-check-schedule/);
  assert.match(html, /<details id="background-monitoring-details">[\s\S]*?id="check-monitored-chat"[\s\S]*?id="automatic-scheduler-result"[\s\S]*?id="run-automatic-tick"[\s\S]*?<\/details>/);
  assert.match(html, /<summary>Background monitoring details<\/summary>/);
  assert.match(html, /Background monitoring \(experimental\)/);
  assert.match(html, /desktop-risk-notifications-state/);
  assert.match(popupJs, /chrome\.permissions\.request/);
  assert.match(popupJs, /gptLimitsDesktopRiskNotifications/);
  assert.match(popupJs, /buildRiskModel/);
  assert.match(popupJs, /renderCurrentRisk/);
  assert.match(html, /Copy calibration summary/);
  assert.match(popupJs, /Delete point/);
  for (const id of ["collect-full-history", "stop-history-collection", "history-collection-status"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(popupJs, /gpt-limits:collect-full-history/);
  assert.match(popupJs, /gpt-limits:stop-history-collection/);
  for (const diagnostic of ["candidate-path", "network-resources", "response-keys", "message-keys", "attachment-pipeline", "trace-total-images-accepted", "hook-installed-at"]) {
    assert.equal(html.includes(diagnostic), false, `popup still contains ${diagnostic}`);
  }
});

test("popup keeps global background controls active on any tab and requests alarms in the click gesture", async () => {
  const source = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  async function createPopup(url, { permission = true, response = { ok: true }, runtimeThrows = false } = {}) {
    const elements = new Map();
    const makeElement = () => ({
      hidden: false, checked: false, disabled: false, textContent: "", value: "", children: [], dataset: {},
      listeners: {}, classList: { contains() { return false; } },
      addEventListener(type, callback) { this.listeners[type] = callback; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, remove() {}, select() {}, closest() { return null; },
    });
    const document = {
      getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); },
      createElement() { return makeElement(); }, execCommand() { return true; }, body: makeElement(),
    };
    const order = [];
    const sent = [];
    const chrome = {
      storage: { local: {
        async get(key) {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.map((item) => [item, item === "gptLimitsBackgroundMonitoring" ? true : undefined]));
        }, async set() {},
      } },
      permissions: {
        async contains() { return false; },
        request(details) { order.push(["permission", details]); return Promise.resolve(permission); },
      },
      tabs: {
        async query() { return [{ id: 12, url }]; },
        async sendMessage() { throw new Error("No current-chat receiver"); },
      },
      runtime: { async sendMessage(message) { order.push(["runtime", message]); sent.push(message); if (runtimeThrows) throw new Error("no receiver"); return response; } },
    };
    vm.runInNewContext(source, {
      document, chrome, URL, Date, Promise, Number, String, Array, Object, Set,
      navigator: {}, globalThis: { GptCalibrationSummary: {} },
      setInterval() { return 1; }, clearInterval() {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    const button = elements.get("check-monitored-chat");
    assert.equal(button.disabled, false, "global button is enabled by saved monitoring preference");
    const clickPromise = button.listeners.click();
    assert.equal(elements.get("background-check-status").textContent, "Background check: Starting…", "click immediately updates status");
    assert.equal(order[0][0], "permission", "optional permission request happens synchronously in the click handler");
    await clickPromise;
    return { elements, order, sent };
  }

  for (const url of ["chrome://extensions/", "https://example.org/page", "https://chatgpt.com/c/example-chat"]) {
    const popup = await createPopup(url);
    assert.equal(popup.sent.length, 1, `background check starts from ${url}`);
    assert.equal(popup.sent[0].type, "gpt-limits:start-background-check");
    assert.equal(popup.elements.get("background-check-status").textContent, "Background check: Not run");
    assert.equal(popup.elements.get("tracked-chats-section").hidden, !url.includes("/c/"), "current-chat sections are gated independently");
  }

  const denied = await createPopup("chrome://extensions/", { permission: false });
  assert.deepEqual(denied.sent, []);
  assert.equal(denied.elements.get("background-check-status").textContent, "Background check: Failed · alarm permission required.");

  const workerFailure = await createPopup("https://example.org/", { response: { ok: false, reason: "not-eligible" } });
  assert.match(workerFailure.elements.get("background-check-status").textContent, /no eligible monitored chat/);

  const deliveryFailure = await createPopup("chrome://extensions/", { runtimeThrows: true });
  assert.equal(deliveryFailure.elements.get("background-check-status").textContent, "Background check: Failed · could not start.");

  const diagnostic = await createPopup("chrome://extensions/");
  await diagnostic.elements.get("run-automatic-tick").listeners.click();
  assert.equal(diagnostic.sent.at(-1).type, "gpt-limits:run-automatic-scheduler-tick", "diagnostic button calls scheduler tick directly");
});

test("popup automatic-check setting requests optional alarms permission and persists the chosen cadence", async () => {
  const source = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  const elements = new Map();
  const makeElement = () => ({
    hidden: false, checked: false, disabled: false, textContent: "", value: "", children: [], dataset: {}, listeners: {},
    classList: { contains() { return false; } }, addEventListener(type, callback) { this.listeners[type] = callback; },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute() {}, remove() {}, select() {}, closest() { return null; },
  });
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); }, createElement: makeElement, body: makeElement(), execCommand() { return true; } };
  const stored = { gptLimitsAutomaticSchedulerStatus: { enabled: false, interval: "30", alarmExists: false, nextScheduledTime: null, lastTickAt: null, lastTickResult: null, lastReason: "scheduler-alarm-missing" } };
  const writes = [];
  const permissionRequests = [];
  const messages = [];
  const chrome = {
    storage: { local: {
      async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, stored[key]])); },
      async set(value) { Object.assign(stored, value); writes.push(value); },
    } },
    permissions: { async contains() { return false; }, async request(value) { permissionRequests.push(value); return true; } },
    tabs: { async query() { return [{ id: 5, url: "chrome://extensions/" }]; }, async sendMessage() { throw new Error("no chat tab"); } },
    runtime: { async sendMessage(message) { messages.push(message); return { ok: true }; } },
  };
  vm.runInNewContext(source, { document, chrome, URL, Date, Promise, Number, String, Array, Object, Set, navigator: {}, globalThis: { GptCalibrationSummary: {} }, setInterval() { return 1; }, clearInterval() {} });
  await new Promise((resolve) => setImmediate(resolve));
  const select = elements.get("automatic-check-interval");
  assert.equal(select.value, "off", "automatic checks default to Off");
  assert.match(elements.get("automatic-scheduler-alarm").textContent, /alarm was not created/, "popup explains when the recurring alarm is missing");
  select.value = "60";
  await select.listeners.change();
  assert.deepEqual(JSON.parse(JSON.stringify(permissionRequests)), [{ permissions: ["alarms"] }]);
  assert.equal(stored.gptLimitsAutomaticCheckInterval, "60");
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), { type: "gpt-limits:configure-automatic-checks", interval: "60" });
  select.value = "off";
  await select.listeners.change();
  assert.equal(stored.gptLimitsAutomaticCheckInterval, "off");
  assert.equal(permissionRequests.length, 1, "turning scheduling Off does not request additional permission");
  assert.equal(writes.length, 2);
  await elements.get("run-automatic-tick").listeners.click();
  assert.equal(messages.at(-1).type, "gpt-limits:run-automatic-scheduler-tick", "diagnostic button calls the scheduler tick, not the manual check route");
  assert.equal(elements.get("automatic-check-schedule").textContent, "Automatic checks: Off");
  assert.match(elements.get("automatic-check-next").textContent, /^Next check:/);
});

test("popup test notification requires enabled setting, sends a dedicated command, and explains denied permission", async () => {
  const source = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  async function makePopup({ permissionGranted, runtimeResult = { ok: true } }) {
    const elements = new Map();
    const makeElement = () => ({ hidden: false, checked: false, disabled: false, textContent: "", value: "", children: [], dataset: {}, listeners: {}, classList: { contains() { return false; } }, addEventListener(type, callback) { this.listeners[type] = callback; }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute() {}, remove() {}, select() {}, closest() { return null; } });
    const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); }, createElement: makeElement, body: makeElement(), execCommand() { return true; } };
    const stored = { gptLimitsDesktopRiskNotifications: true, gptLimitsBackgroundMonitoring: false };
    const messages = [];
    const chrome = {
      storage: { local: { async get(key) { const keys = Array.isArray(key) ? key : [key]; return Object.fromEntries(keys.map((name) => [name, stored[name]])); }, async set(value) { Object.assign(stored, value); } } },
      permissions: { async contains() { return permissionGranted; }, async request() { return permissionGranted; } },
      tabs: { async query() { return [{ id: 4, url: "chrome://extensions/" }]; }, async sendMessage() { throw new Error("no chat tab"); } },
      runtime: { async sendMessage(message) { messages.push(message); return runtimeResult; } },
    };
    vm.runInNewContext(source, { document, chrome, URL, Date, Promise, Number, String, Array, Object, Set, navigator: {}, globalThis: { GptCalibrationSummary: {} }, setInterval() { return 1; }, clearInterval() {} });
    await new Promise((resolve) => setImmediate(resolve));
    return { elements, messages, stored };
  }
  const enabled = await makePopup({ permissionGranted: true });
  const button = enabled.elements.get("send-test-notification");
  assert.equal(button.disabled, false);
  await button.listeners.click();
  assert.deepEqual(JSON.parse(JSON.stringify(enabled.messages.at(-1))), { type: "gpt-limits:send-test-notification" });
  assert.equal(enabled.elements.get("desktop-risk-notifications-help").textContent, "Test notification sent.");
  const denied = await makePopup({ permissionGranted: false });
  assert.equal(denied.elements.get("send-test-notification").disabled, true);
  assert.equal(denied.elements.get("desktop-risk-notifications").checked, false);
  assert.equal(denied.stored.gptLimitsDesktopRiskNotifications, false);
  denied.elements.get("desktop-risk-notifications").checked = true;
  await denied.elements.get("desktop-risk-notifications").listeners.change();
  assert.equal(denied.elements.get("desktop-risk-notifications-help").textContent, "Notifications unavailable — permission was not granted.");
  assert.equal(denied.elements.get("send-test-notification").disabled, true);
});

test("one scroll may remain unchanged while polling; delayed pagination response continues collection", async () => {
  const initial = { messagesCollected: 10, updatedAt: 1, historyComplete: false, hasPreviousPage: true };
  let state = initial;
  let polls = 0;
  let pageSignal = 0;
  let domVersion = 0;
  const result = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-current",
    getState: async () => state, findContainers: () => [{ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }],
    scrollToTop: () => ({ alreadyAtTop: true }), getExtraSignals: () => ({ historyPagesObserved: pageSignal, domMutationVersion: domVersion }),
    wait: async () => {
      polls += 1;
      if (polls === 2) domVersion += 1;
      if (polls === 4) {
        pageSignal += 1;
        state = { messagesCollected: 20, updatedAt: 2, historyComplete: false, hasPreviousPage: true };
      }
      if (polls === 5) state = { messagesCollected: 30, updatedAt: 3, historyComplete: true, hasPreviousPage: false };
    },
    isCancelled: () => false, onProgress() {}, pollIntervalMs: 1, attemptWaitMs: 3, maxAttemptWaitMs: 6, mutationQuietMs: 2,
  });
  assert.equal(result.status, "complete");
  assert.equal(polls, 5);
  assert.equal(result.state.messagesCollected, 30);
});

test("scrollHeight growth and prepended-content compensation count as progress and refresh the container", async () => {
  const firstContainer = { scrollHeight: 3000, clientHeight: 700, scrollTop: 1200, isConnected: true };
  const replacement = { scrollHeight: 5000, clientHeight: 700, scrollTop: 1500, isConnected: true };
  let currentContainer = firstContainer;
  let state = { messagesCollected: 40, updatedAt: 1, historyComplete: false, hasPreviousPage: true };
  let scrollCalls = 0;
  let waits = 0;
  const result = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-current",
    getState: async () => state, findContainers: () => [currentContainer],
    scrollToTop: (container) => {
      scrollCalls += 1;
      const beforeScrollTop = container.scrollTop;
      container.scrollTop = 0;
      return { moved: beforeScrollTop > 0, alreadyAtTop: beforeScrollTop === 0 };
    },
    wait: async () => {
      waits += 1;
      if (waits === 1) {
        firstContainer.isConnected = false;
        currentContainer = replacement;
        replacement.scrollHeight = 6200;
        replacement.scrollTop = 800; // browser preserved the visual position after prepend
      } else if (waits === 2) {
        state = { messagesCollected: 55, updatedAt: 2, historyComplete: true, hasPreviousPage: false };
      }
    },
    isCancelled: () => false, onProgress() {}, pollIntervalMs: 1, attemptWaitMs: 1, maxAttemptWaitMs: 2,
  });
  assert.equal(result.status, "complete");
  assert.equal(scrollCalls, 2);
  assert.equal(result.state.messagesCollected, 55);
});

test("a DOM mutation without aggregate change extends waiting, while only sustained stall pauses", async () => {
  const partial = { messagesCollected: 12, updatedAt: 100, historyComplete: false, hasPreviousPage: true };
  let waits = 0;
  let domVersion = 0;
  const paused = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-current",
    getState: async () => partial, findContainers: () => [{ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }],
    scrollToTop: () => ({ alreadyAtTop: true }), getExtraSignals: () => ({ historyPagesObserved: 0, domMutationVersion: domVersion }),
    wait: async () => { waits += 1; if (waits === 2) domVersion += 1; },
    isCancelled: () => false, onProgress() {}, pollIntervalMs: 1, attemptWaitMs: 2, maxAttemptWaitMs: 4,
    mutationQuietMs: 1, maxStalledAttempts: 2,
  });
  assert.equal(paused.status, "paused");
  assert.equal(paused.reason, "no-progress");
  assert.ok(waits > 2, "DOM activity keeps the current attempt waiting beyond its normal window");
});

test("new pagination response signal is progress even before aggregate updates", async () => {
  const partial = { messagesCollected: 12, updatedAt: 100, historyComplete: false, hasPreviousPage: true };
  let pageCount = 0;
  let waits = 0;
  let container = { scrollHeight: 1000, clientHeight: 500, scrollTop: 0 };
  const result = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-current",
    getState: async () => partial, findContainers: () => [container],
    scrollToTop: () => ({ alreadyAtTop: true }), getExtraSignals: () => ({ historyPagesObserved: pageCount, domMutationVersion: 0 }),
    wait: async () => {
      waits += 1;
      if (waits === 4) pageCount += 1;
    },
    isCancelled: () => false, onProgress() {}, pollIntervalMs: 1, attemptWaitMs: 2, maxAttemptWaitMs: 3,
    maxCycles: 2, maxStalledAttempts: 2,
  });
  assert.equal(result.status, "paused");
  assert.equal(result.reason, "safety-limit");
  assert.equal(waits, 4);
});

test("collector only pauses after three complete no-progress windows and still completes on confirmed Complete", async () => {
  const partial = { messagesCollected: 12, updatedAt: 100, historyComplete: false, hasPreviousPage: true };
  let waits = 0;
  const paused = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-current",
    getState: async () => partial, findContainers: () => [{ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }],
    scrollToTop: () => ({ alreadyAtTop: true }), wait: async () => { waits += 1; },
    isCancelled: () => false, onProgress() {}, pollIntervalMs: 2, attemptWaitMs: 6, maxAttemptWaitMs: 6,
  });
  assert.equal(paused.status, "paused");
  assert.equal(paused.reason, "no-progress");
  assert.equal(waits, 9);

  const complete = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-current",
    getState: async () => ({ messagesCollected: 99, historyComplete: true, hasPreviousPage: false }),
    findContainers: () => [], scrollToTop() {}, wait: async () => {}, isCancelled: () => false, onProgress() {},
  });
  assert.equal(complete.status, "complete");

  let cancelled = false;
  const stopped = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-current",
    getState: async () => partial, findContainers: () => [{ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 }],
    scrollToTop: () => ({ alreadyAtTop: true }), wait: async () => { cancelled = true; },
    isCancelled: () => cancelled, onProgress() {}, pollIntervalMs: 1, attemptWaitMs: 1, maxAttemptWaitMs: 1,
  });
  assert.equal(stopped.status, "stopped");
  const navigated = await historyCollector.collect({
    expectedConversationId: "chat-current", getConversationId: () => "chat-other",
    getState: async () => partial, findContainers: () => [], scrollToTop() {}, wait: async () => {}, isCancelled: () => false, onProgress() {},
  });
  assert.equal(navigated.status, "stopped");
  assert.equal(navigated.reason, "navigation");
});

test("scroll container selection prefers the manually observed current-view scroller and uses geometry only", () => {
  const decoy = { clientHeight: 700, clientWidth: 600, scrollHeight: 15000, scrollTop: 0, querySelectorAll: () => [], isConnected: true };
  const actual = { clientHeight: 700, clientWidth: 600, scrollHeight: 10000, scrollTop: 400, querySelectorAll: () => [], isConnected: true };
  const main = { clientHeight: 800, clientWidth: 700, scrollHeight: 9000, scrollTop: 0, querySelectorAll: () => [decoy, actual], contains: (element) => element === decoy || element === actual, isConnected: true };
  Object.defineProperty(actual, "textContent", { get() { throw new Error("message text must not be read"); } });
  const document = { querySelectorAll: () => [main], body: main, scrollingElement: null };
  const window = { getComputedStyle: () => ({ overflowY: "auto" }) };
  assert.equal(historyCollector.findScrollableContainer(document, window, actual), actual);
  assert.equal(historyCollector.findScrollableContainer(document, window), decoy);
  const source = fs.readFileSync(path.join(__dirname, "history-collector.js"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest|Authorization|cookie/i);
  assert.doesNotMatch(source, /textContent|innerText/);
});

test("background DOM readiness waits for a delayed scroll container and distinguishes missing conversation DOM", async () => {
  let polls = 0;
  const container = { scrollHeight: 1200, clientHeight: 600, clientWidth: 500, scrollTop: 0 };
  const delayed = await historyCollector.waitForScrollableContainers({
    findContainers: () => { polls += 1; return polls >= 3 ? [container] : []; },
    hasConversationDom: () => polls >= 2,
    wait: async () => {},
    timeoutMs: 5,
    pollIntervalMs: 1,
  });
  assert.equal(delayed.status, "ready");
  assert.equal(polls, 3, "catch-up waits for the conversation DOM before starting the collector");
  const noDom = await historyCollector.waitForScrollableContainers({
    findContainers: () => [], hasConversationDom: () => false, wait: async () => {}, timeoutMs: 2, pollIntervalMs: 1,
  });
  assert.equal(noDom.reason, "conversation-dom-not-ready");
  const noScroller = await historyCollector.waitForScrollableContainers({
    findContainers: () => [], hasConversationDom: () => true, wait: async () => {}, timeoutMs: 2, pollIntervalMs: 1,
  });
  assert.equal(noScroller.reason, "scroll-container-not-found");
});

test("history collection starts only for the current chat and Reset cancels it without changing other chats", async () => {
  const current = mergePage(null, page("collect-current", "Current", [item("current-message", "user", 4)], true));
  const other = mergePage(null, page("collect-other", "Other", [item("other-message", "assistant", 9, { images: 1 })], true));
  current.monitored = true;
  current.calibrationLabel = "limit_reached";
  current.calibrationPoints = [{ timestamp: 1, label: "limit_reached", messagesCollected: 1, userMessages: 1, assistantMessages: 0, otherMessages: 0, estimatedTextTokens: 4, images: 0, audio: 0, video: 0, otherAttachments: 0, historyStatus: "Partial" }];
  const stored = { gptLimitsChats: { "collect-current": current, "collect-other": other } };
  let runtimeListener;
  let windowMessageListener;
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/collect-current" },
    addEventListener(type, callback) { if (type === "message") windowMessageListener = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
    },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  let collectionOptions;
  let finish;
  const fakeCollector = {
    findScrollableContainers() { throw new Error("not used by this handler test"); },
    collect(options) {
      collectionOptions = options;
      return new Promise((resolve) => { finish = resolve; });
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => null }, setTimeout, globalThis: { GptLimitsAggregator: require("./aggregator.js"), GptHistoryCollector: fakeCollector },
  });
  const send = (message) => new Promise((resolve) => runtimeListener(message, {}, resolve));
  await send({ type: "gpt-limits:get-current-state" });
  assert.equal((await send({ type: "gpt-limits:collect-full-history", conversationId: "collect-other" })).ok, false);
  const started = await send({ type: "gpt-limits:collect-full-history", conversationId: "collect-current" });
  assert.equal(started.ok, true, JSON.stringify(started));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof collectionOptions.scrollToTop, "function");
  assert.equal(collectionOptions.expectedConversationId, "collect-current");
  assert.equal(collectionOptions.isCancelled(), false);
  assert.equal(collectionOptions.getExtraSignals().historyPagesObserved, 0);
  windowMessageListener({
    source: window, origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", summary: { ...page("collect-current", "Current", [], true, true), capturedAt: 200 } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(collectionOptions.getExtraSignals().historyPagesObserved, 1);
  const otherBefore = JSON.stringify(stored.gptLimitsChats["collect-other"]);
  const stopped = await send({ type: "gpt-limits:stop-history-collection", conversationId: "collect-current" });
  assert.equal(stopped.ok, true);
  assert.equal(collectionOptions.isCancelled(), true);
  assert.equal(collectionOptions.getExtraSignals().historyPagesObserved, 1);
  finish({ status: "stopped", reason: "user", state: current });
  await new Promise((resolve) => setImmediate(resolve));
  const restarted = await send({ type: "gpt-limits:collect-full-history", conversationId: "collect-current" });
  assert.equal(restarted.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  const reset = await send({ type: "gpt-limits:reset-current-chat", conversationId: "collect-current" });
  assert.equal(reset.ok, true);
  assert.equal(collectionOptions.isCancelled(), true);
  assert.equal(collectionOptions.getExtraSignals().historyPagesObserved, 0);
  finish({ status: "stopped", reason: "reset", state: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.gptLimitsChats["collect-current"].messagesCollected, 0);
  assert.equal(stored.gptLimitsChats["collect-current"].calibrationLabel, "limit_reached");
  assert.equal(stored.gptLimitsChats["collect-current"].calibrationPoints.length, 1);
  assert.equal(JSON.stringify(stored.gptLimitsChats["collect-other"]), otherBefore);
});

test("calibration summaries count labels and calculate ranges, medians, attachment totals, and history groups", () => {
  const point = (label, metrics) => ({
    timestamp: 100, label, messagesCollected: 10, userMessages: 4, assistantMessages: 5, otherMessages: 1,
    estimatedTextTokens: 1000, images: 2, audio: 1, video: 0, otherAttachments: 3,
    historyStatus: "Complete", ...metrics,
  });
  const chats = [
    { conversationId: "secret-conversation-a", title: "A", calibrationSourceKey: "src_aaaaaaaaaaaaaaaa", calibrationPoints: [
      point("normal", { timestamp: 100, messagesCollected: 1, estimatedTextTokens: 101, images: 1, otherAttachments: 2 }),
      point("normal", { timestamp: 110, messagesCollected: 3, estimatedTextTokens: 303, images: 3, audio: 0, video: 1, otherAttachments: 1 }),
      point("normal", { timestamp: 200, messagesCollected: 5, estimatedTextTokens: 505, images: 5, audio: 0, video: 0, otherAttachments: 0, historyStatus: "Partial" }),
      point("near_limit", { messagesCollected: 2, estimatedTextTokens: 202, images: 2, otherAttachments: 1, historyStatus: "Partial" }),
    ] },
    { conversationId: "secret-conversation-b", title: "B", calibrationSourceKey: "src_bbbbbbbbbbbbbbbb", calibrationPoints: [
      point("near_limit", { timestamp: 150, messagesCollected: 4, estimatedTextTokens: 404, images: 4, audio: 0, video: 0, otherAttachments: 0, historyStatus: "Complete" }),
      point("limit_reached", { messagesCollected: 8, estimatedTextTokens: 808, images: 8, audio: 0, video: 0, otherAttachments: 0, historyStatus: "Unknown" }),
    ] },
  ];
  const summary = calibrationSummary.summarize(chats);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.counts)), { normal: 3, near_limit: 2, limit_reached: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(summary.uniqueSourceCounts)), { normal: 1, near_limit: 2, limit_reached: 1 });
  assert.equal(summary.latestPerSource.length, 2);
  assert.equal(summary.latestPerSource.find((point) => point.sourceKey === "src_aaaaaaaaaaaaaaaa").historyStatus, "Partial");
  assert.equal(summary.latestCompletePerSource.length, 2);
  assert.equal(summary.latestCompletePerSource.find((point) => point.sourceKey === "src_aaaaaaaaaaaaaaaa").timestamp, 110);
  assert.equal(summary.latestCompletePerSource.find((point) => point.sourceKey === "src_bbbbbbbbbbbbbbbb").timestamp, 150);
  const normalComplete = summary.byLabel.normal.byHistory.Complete;
  assert.equal(normalComplete.count, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(normalComplete.ranges.messagesCollected)), { min: 1, median: 2, max: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(normalComplete.ranges.estimatedTextTokens)), { min: 101, median: 202, max: 303 });
  assert.deepEqual(JSON.parse(JSON.stringify(normalComplete.ranges.images)), { min: 1, median: 2, max: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(normalComplete.ranges.totalAttachments)), { min: 4, median: 4.5, max: 5 });
  assert.equal(summary.byLabel.normal.byHistory.Partial.count, 1);
  assert.equal(summary.byLabel.near_limit.byHistory.Partial.count, 1);
  assert.equal(summary.byLabel.near_limit.byHistory.Complete.count, 1);
  assert.equal(summary.byLabel.limit_reached.byHistory.Unknown.count, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.byLabel.limit_reached.byHistory.Unknown.ranges.messagesCollected)), { min: 8, median: 8, max: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(calibrationSummary.ranges([point("normal", { messagesCollected: 1 }), point("normal", { messagesCollected: 2 }), point("normal", { messagesCollected: 9 })]).messagesCollected)), { min: 1, median: 2, max: 9 });
  assert.deepEqual(JSON.parse(JSON.stringify(calibrationSummary.ranges([point("normal", { messagesCollected: 1 }), point("normal", { messagesCollected: 2 }), point("normal", { messagesCollected: 9 }), point("normal", { messagesCollected: 10 })]).messagesCollected)), { min: 1, median: 5.5, max: 10 });
});

function empiricalCalibrationChats() {
  const record = (sourceKey, points) => ({ sourceKey, calibrationSourceKey: sourceKey, calibrationPoints: points });
  const point = (timestamp, label, tokens, messages, historyStatus = "Complete", attachments = {}) => ({
    timestamp, label, estimatedTextTokens: tokens, messagesCollected: messages, historyStatus,
    images: attachments.images || 0, audio: attachments.audio || 0, video: attachments.video || 0, otherAttachments: attachments.otherAttachments || 0,
  });
  return [
    record("src_0000000000000001", [
      point(1, "normal", 1000, 10),
      point(2, "normal", 2000, 20, "Complete", { images: 100, audio: 10 }),
      point(3, "limit_reached", 900000, 900, "Partial"),
    ]),
    record("src_0000000000000002", [point(1, "normal", 1500, 25)]),
    record("src_0000000000000003", [point(1, "limit_reached", 5000, 40)]),
    record("src_0000000000000004", [point(1, "limit_reached", 6000, 50)]),
    record("src_0000000000000005", [point(1, "near_limit", 4000, 35)]),
  ];
}

test("empirical model uses only the latest Complete point per source and derives thresholds dynamically", () => {
  const chats = empiricalCalibrationChats();
  const model = calibrationSummary.buildRiskModel(chats);
  assert.equal(model.available, true);
  assert.equal(model.normalSources, 2);
  assert.equal(model.limitReachedSources, 2);
  assert.equal(model.safeCeiling, 2000);
  assert.equal(model.limitFloor, 5000);
  assert.equal(model.watchThreshold, 2900);
  assert.equal(model.nearLimitThreshold, 3800);
  assert.equal(model.criticalThreshold, 4400);
  assert.equal(model.normalMessagesCeiling, 25);
  assert.equal(model.limitMessagesFloor, 40);
  assert.equal(chats[0].calibrationPoints[1].label, "normal", "risk calculation does not overwrite manual labels");
  const withManyAttachments = structuredClone(chats);
  withManyAttachments[1].calibrationPoints[0].images = 999999;
  withManyAttachments[1].calibrationPoints[0].otherAttachments = 999999;
  const attachmentModel = calibrationSummary.buildRiskModel(withManyAttachments);
  assert.deepEqual(
    [attachmentModel.safeCeiling, attachmentModel.limitFloor, attachmentModel.watchThreshold, attachmentModel.nearLimitThreshold, attachmentModel.criticalThreshold],
    [model.safeCeiling, model.limitFloor, model.watchThreshold, model.nearLimitThreshold, model.criticalThreshold],
  );
});

test("provided Stage 4.8 calibration sample produces the documented approximate boundaries", () => {
  const add = (label, sourcePrefix, values) => values.map((tokens, index) => ({
    calibrationSourceKey: `src_${sourcePrefix.repeat(8)}${String(index + 1).padStart(8, "0")}`,
    calibrationPoints: [{ timestamp: 1, label, historyStatus: "Complete", estimatedTextTokens: tokens, messagesCollected: label === "normal" ? [500, 1200, 1800, 2000, 2252][index] : [2840, 3200, 3600][index] }],
  }));
  const model = calibrationSummary.buildRiskModel([
    ...add("normal", "a", [24618, 161437, 180257, 183471, 210640]),
    ...add("limit_reached", "b", [539543, 607197, 652266]),
  ]);
  assert.equal(model.safeCeiling, 210640);
  assert.equal(model.limitFloor, 539543);
  assert.equal(model.watchThreshold, 309311);
  assert.equal(model.nearLimitThreshold, 407982);
  assert.equal(model.criticalThreshold, 473762);
  assert.equal(model.normalMessagesCeiling, 2252);
  assert.equal(model.limitMessagesFloor, 2840);
});

test("empirical risk classifies Complete and incomplete history conservatively at each boundary", () => {
  const model = calibrationSummary.buildRiskModel(empiricalCalibrationChats());
  const assess = (tokens, history) => calibrationSummary.assessRisk(model, tokens, history);
  assert.equal(assess(2899, "Complete").level, "normal");
  assert.equal(assess(2900, "Complete").level, "watch");
  assert.equal(assess(3800, "Complete").level, "near-limit");
  assert.equal(assess(4400, "Complete").level, "critical");
  assert.equal(assess(2899, "Partial").level, "unknown");
  assert.equal(assess(2899, "Unknown").level, "unknown");
  assert.equal(assess(2900, "Partial").level, "at-least-watch");
  assert.equal(assess(3800, "Partial").level, "at-least-near-limit");
  assert.equal(assess(4400, "Unknown").level, "at-least-critical");
  assert.match(assess(2899, "Partial").text, /Unknown — history incomplete/);
  assert.doesNotMatch(assess(4400, "Complete").text, /Limit reached/);
});

test("empirical model is unavailable with too few sources or overlapping complete classes", () => {
  const insufficient = calibrationSummary.buildRiskModel(empiricalCalibrationChats().slice(0, 3));
  assert.equal(insufficient.available, false);
  assert.equal(insufficient.reason, "insufficient-data");
  assert.equal(calibrationSummary.assessRisk(insufficient, 5000, "Complete").text, "Risk model unavailable — more calibration data is needed.");
  const overlapChats = [
    { calibrationSourceKey: "src_1111111111111111", calibrationPoints: [{ timestamp: 1, label: "normal", historyStatus: "Complete", estimatedTextTokens: 500, messagesCollected: 1 }] },
    { calibrationSourceKey: "src_2222222222222222", calibrationPoints: [{ timestamp: 1, label: "normal", historyStatus: "Complete", estimatedTextTokens: 600, messagesCollected: 2 }] },
    { calibrationSourceKey: "src_3333333333333333", calibrationPoints: [{ timestamp: 1, label: "limit_reached", historyStatus: "Complete", estimatedTextTokens: 600, messagesCollected: 3 }] },
    { calibrationSourceKey: "src_4444444444444444", calibrationPoints: [{ timestamp: 1, label: "limit_reached", historyStatus: "Complete", estimatedTextTokens: 700, messagesCollected: 4 }] },
  ];
  const overlap = calibrationSummary.buildRiskModel(overlapChats);
  assert.equal(overlap.available, false);
  assert.equal(overlap.reason, "overlap");
  assert.equal(calibrationSummary.assessRisk(overlap, 900, "Complete").text, "Calibration overlap detected — risk model unavailable.");
});

test("risk notification transitions notify once per ascending threshold and jump directly to the highest crossed level", () => {
  const model = calibrationSummary.buildRiskModel(empiricalCalibrationChats());
  const assess = calibrationSummary.assessRisk;
  const current = (tokens, historyStatus = "Complete") => ({ estimatedTextTokens: tokens, historyStatus });
  const watch = riskNotifications.crossing(current(2899), current(2900), model, 0, assess);
  assert.equal(watch.level, "Watch");
  assert.equal(riskNotifications.crossing(current(2900), current(2950), model, watch.rank, assess), null);
  const near = riskNotifications.crossing(current(2900), current(3800), model, watch.rank, assess);
  assert.equal(near.level, "Near limit");
  const critical = riskNotifications.crossing(current(3800), current(4400), model, near.rank, assess);
  assert.equal(critical.level, "Critical");
  const jump = riskNotifications.crossing(current(1000), current(5000), model, 0, assess);
  assert.equal(jump.level, "Critical");
  assert.equal(jump.rank, 3);
});

test("risk notification policy suppresses startup, unchanged aggregates, disabled setting, and active collection", () => {
  const model = calibrationSummary.buildRiskModel(empiricalCalibrationChats());
  const current = (tokens, historyStatus = "Complete") => ({ estimatedTextTokens: tokens, historyStatus });
  assert.equal(riskNotifications.crossing(null, current(5000), model, 0, calibrationSummary.assessRisk), null, "startup at Critical is a baseline, not a transition");
  assert.equal(riskNotifications.crossing(current(5000), current(5000), model, 0, calibrationSummary.assessRisk), null, "threshold recalculation without aggregate growth does not notify");
  const transition = riskNotifications.crossing(current(1000), current(2900, "Partial"), model, 0, calibrationSummary.assessRisk);
  assert.equal(transition.level, "Watch");
  assert.equal(transition.partial, true);
  assert.equal(riskNotifications.shouldDispatch({ enabled: false, collecting: false, crossing: transition }), false);
  assert.equal(riskNotifications.shouldDispatch({ enabled: true, collecting: true, crossing: transition }), false);
  assert.equal(riskNotifications.shouldDispatch({ enabled: true, collecting: false, crossing: transition }), true);
  const text = riskNotifications.notificationText("Янис", transition);
  assert.match(text.title, /At least Watch/);
  assert.match(text.message, /at least the Watch threshold in the loaded part/);
  const criticalText = riskNotifications.notificationText("Янис", { level: "Critical", partial: false });
  assert.match(criticalText.message, /new branch or chat/);
  assert.match(criticalText.message, /not been confirmed reached/);
  for (const forbidden of ["conversation-id", "sourceKey", "message-id"]) {
    assert.equal(JSON.stringify({ ...text, ...criticalText }).includes(forbidden), false);
  }
});

test("MV3 notifications permission is optional and the service worker checks preference and permission", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.optional_permissions, ["notifications", "alarms"]);
  assert.equal(manifest.permissions.includes("notifications"), false);
  assert.equal(manifest.background.service_worker, "background.js");
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const listeners = [];
  let permissionGranted = true;
  let preference = true;
  const shown = [];
  const localWrites = [];
  const chrome = {
    runtime: {
      id: "extension-id",
      onMessage: { addListener(callback) { listeners.push(callback); } },
      getURL(pathValue) { return `chrome-extension://extension-id/${pathValue}`; },
    },
    permissions: { async contains() { return permissionGranted; } },
    storage: {
      local: { async get() { return { gptLimitsDesktopRiskNotifications: preference }; }, async set(value) { localWrites.push(value); } },
      session: { async get(key) { return { [key]: undefined }; }, async set() {}, async remove() {} },
    },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
    alarms: { onAlarm: { addListener() {} }, async create() {}, async clear() {} },
    notifications: { async create(details) { shown.push(details); } },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {} });
  const send = (message) => new Promise((resolve) => {
    for (const listener of listeners) listener(message, { id: "extension-id" }, resolve);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await send({ type: "gpt-limits:show-risk-notification", level: "Near limit", chatTitle: "Янис", partial: false }))), { ok: true });
  assert.equal(shown.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  const writesBeforeTestNotice = localWrites.length;
  const testResult = await send({ type: "gpt-limits:send-test-notification" });
  assert.deepEqual(JSON.parse(JSON.stringify(testResult)), { ok: true });
  assert.equal(shown.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(shown[1])), {
    type: "basic",
    iconUrl: "chrome-extension://extension-id/notification-icon.png",
    title: "GPT Limits — Test notification",
    message: "Desktop risk notifications are working.",
  });
  assert.equal(localWrites.length, writesBeforeTestNotice, "test notification leaves risk preference and per-chat dedup state untouched");
  assert.match(shown[0].title, /Near limit/);
  assert.match(shown[0].message, /Янис/);
  for (const forbidden of ["conversation-id", "sourceKey", "message-id"]) assert.equal(JSON.stringify(shown[0]).includes(forbidden), false);
  preference = false;
  assert.equal((await send({ type: "gpt-limits:show-risk-notification", level: "Critical", chatTitle: "Янис" })).ok, false);
  assert.equal((await send({ type: "gpt-limits:send-test-notification" })).reason, "disabled");
  permissionGranted = false;
  preference = true;
  assert.equal((await send({ type: "gpt-limits:show-risk-notification", level: "Critical", chatTitle: "Янис" })).ok, false);
  assert.equal(shown.length, 2);
  assert.equal((await send({ type: "gpt-limits:send-test-notification" })).reason, "permission-required");
  assert.equal(shown.length, 2);
});

test("content script notifies only on observed aggregate growth and persists the highest notified level", async () => {
  const calibrationRecord = (conversationId, sourceKey, label, tokens) => {
    const state = mergePage(null, { ...page(conversationId, conversationId, [item(`msg-${conversationId}`, "user", tokens)], false, true) });
    state.calibrationSourceKey = sourceKey;
    state.calibrationPoints = [{ sourceKey, timestamp: 1, label, estimatedTextTokens: tokens, messagesCollected: 10, historyStatus: "Complete", images: 0, audio: 0, video: 0, otherAttachments: 0 }];
    return state;
  };
  const current = mergePage(null, page("risk-current", "Янис", [item("before", "user", 2800)], true));
  current.calibrationSourceKey = "src_eeeeeeeeeeeeeeee";
  const stored = { gptLimitsDesktopRiskNotifications: true, gptLimitsChats: {
    "risk-normal-a": calibrationRecord("risk-normal-a", "src_aaaaaaaaaaaaaaaa", "normal", 1500),
    "risk-normal-b": calibrationRecord("risk-normal-b", "src_bbbbbbbbbbbbbbbb", "normal", 2000),
    "risk-limit-a": calibrationRecord("risk-limit-a", "src_cccccccccccccccc", "limit_reached", 5000),
    "risk-limit-b": calibrationRecord("risk-limit-b", "src_dddddddddddddddd", "limit_reached", 6000),
    "risk-current": current,
  } };
  const sent = [];
  const notificationsSent = () => sent.filter((message) => message.type === "gpt-limits:show-risk-notification");
  let windowListener;
  let runtimeListener;
  let storageChangedListener;
  let finishCollection;
  const historyCollectorStub = {
    findScrollableContainers() { return []; },
    collect() { return new Promise((resolve) => { finishCollection = resolve; }); },
  };
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/risk-current" },
    addEventListener(type, callback) { if (type === "message") windowListener = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
      onChanged: { addListener(callback) { storageChangedListener = callback; } },
    },
    runtime: {
      onMessage: { addListener(callback) { runtimeListener = callback; } },
      async sendMessage(message) { sent.push(message); return { ok: true }; },
    },
  };
  const globals = {
    window, chrome,
    document: { querySelector() { return null; } },
    globalThis: {
      GptLimitsAggregator: require("./aggregator.js"),
      GptHistoryCollector: historyCollectorStub,
      GptCalibrationSummary: calibrationSummary,
      GptRiskNotifications: riskNotifications,
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), globals);
  const emit = async (summary) => {
    windowListener({ source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const send = (message) => new Promise((resolve) => runtimeListener(message, {}, resolve));
  await emit(page("risk-current", "Янис", [item("watch-cross", "user", 100)], true));
  await emit(page("risk-current", "Янис", [item("watch-cross", "user", 100)], true));
  await emit(page("risk-current", "Янис", [item("near-cross", "user", 900)], true));
  await emit(page("risk-current", "Янис", [item("critical-cross", "user", 600)], true));
  assert.deepEqual(JSON.parse(JSON.stringify(notificationsSent().map((message) => message.level))), ["Watch", "Near limit", "Critical"]);
  assert.deepEqual(JSON.parse(JSON.stringify(notificationsSent().map((message) => message.partial))), [true, true, true]);
  assert.equal(stored.gptLimitsChats["risk-current"].riskNotificationLevel, 3);
  const serializedMessages = JSON.stringify(notificationsSent());
  for (const forbidden of ["risk-current", "src_eeeeeeeeeeeeeeee", "before", "watch-cross", "conversationId"]) {
    assert.equal(serializedMessages.includes(forbidden), false);
  }

  stored.gptLimitsDesktopRiskNotifications = false;
  storageChangedListener({ gptLimitsDesktopRiskNotifications: { newValue: false } }, "local");
  await send({ type: "gpt-limits:reset-current-chat", conversationId: "risk-current" });
  await emit(page("risk-current", "Янис", [item("rebuilt-low", "user", 2800)], true));
  await emit(page("risk-current", "Янис", [item("disabled-cross", "user", 100)], true));
  assert.equal(notificationsSent().length, 3, "Off prevents the content script from requesting notifications");

  await send({ type: "gpt-limits:reset-current-chat", conversationId: "risk-current" });
  await emit(page("risk-current", "Янис", [item("collector-low", "user", 2800)], true));
  stored.gptLimitsDesktopRiskNotifications = true;
  storageChangedListener({ gptLimitsDesktopRiskNotifications: { newValue: true } }, "local");
  const collecting = await send({ type: "gpt-limits:collect-full-history", conversationId: "risk-current" });
  assert.equal(collecting.historyCollection.status, "collecting");
  await emit(page("risk-current", "Янис", [item("during-collection-cross", "user", 100)], true));
  assert.equal(notificationsSent().length, 3, "full-history collection suppresses desktop notifications");
  const stopped = await send({ type: "gpt-limits:stop-history-collection", conversationId: "risk-current" });
  assert.equal(stopped.ok, true);
  finishCollection({ status: "stopped", reason: "user", state: stored.gptLimitsChats["risk-current"] });
});

test("calibration copy export contains anonymous source keys and only safe point fields", () => {
  const empty = calibrationSummary.summarize([]);
  assert.deepEqual(JSON.parse(JSON.stringify(empty.counts)), { normal: 0, near_limit: 0, limit_reached: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(empty.points)), []);
  const chats = [{ conversationId: "secret-conversation-id", title: "Safe title", calibrationSourceKey: "src_0123456789abcdef", calibrationPoints: [{
    timestamp: 1234, label: "limit_reached", messagesCollected: 12, userMessages: 6, assistantMessages: 5,
    otherMessages: 1, estimatedTextTokens: 900, images: 2, audio: 1, video: 1, otherAttachments: 3,
    historyStatus: "Partial", messageId: "secret-message-id", asset_pointer: "secret-asset-pointer", url: "https://private.example/file",
  }] }];
  const text = calibrationSummary.exportText(chats);
  const parsed = JSON.parse(text);
  assert.equal(parsed.points[0].title, "Safe title");
  assert.equal(parsed.points[0].sourceKey, "src_0123456789abcdef");
  assert.equal(parsed.points[0].label, "Limit reached");
  assert.equal(parsed.points[0].totalAttachments, 7);
  assert.equal(parsed.points[0].historyStatus, "Partial");
  assert.deepEqual(parsed.uniqueSources, { normal: 0, nearLimit: 0, limitReached: 1 });
  for (const forbidden of ["secret-conversation-id", "secret-message-id", "secret-asset-pointer", "https://private.example", "messageId", "asset_pointer"]) {
    assert.equal(text.includes(forbidden), false);
  }
});

test("deleting one calibration point preserves chat aggregate, label, and other points", async () => {
  const aggregate = mergePage(null, page("delete-point-chat", "Delete test", [item("message-kept", "user", 45, { images: 2 })]));
  const calibrationPoints = ["normal", "near_limit", "limit_reached"].map((label, index) => ({
    timestamp: 100 + index, label, messagesCollected: 1, userMessages: 1, assistantMessages: 0,
    otherMessages: 0, estimatedTextTokens: 45, images: 2, audio: 0, video: 0,
    otherAttachments: 0, historyStatus: "Partial",
  }));
  const stored = { gptLimitsChats: { "delete-point-chat": {
    ...aggregate, monitored: true, calibrationLabel: "limit_reached", calibrationPoints,
  } } };
  let runtimeListener;
  const window = { location: { origin: "https://chatgpt.com", pathname: "/c/delete-point-chat" }, addEventListener() {} };
  const chrome = {
    storage: { local: {
      async get(keys) { const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.map((key) => [key, stored[key]])); },
      async set(values) { Object.assign(stored, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    } },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, globalThis: { GptLimitsAggregator: require("./aggregator.js") },
  });
  const send = (message) => new Promise((resolve) => runtimeListener(message, {}, resolve));
  await send({ type: "gpt-limits:get-current-state" });
  const result = await send({ type: "gpt-limits:delete-calibration-point", conversationId: "delete-point-chat", pointIndex: 1 });
  assert.equal(result.ok, true);
  const state = stored.gptLimitsChats["delete-point-chat"];
  assert.deepEqual(JSON.parse(JSON.stringify(state.calibrationPoints.map((point) => point.label))), ["normal", "limit_reached"]);
  assert.equal(state.calibrationLabel, "limit_reached");
  assert.equal(state.messagesCollected, 1);
  assert.equal(state.processedMessageIds[0], "message-kept");
  assert.equal(state.estimatedTextTokens, 45);
  assert.equal(state.attachments.images, 2);
  assert.equal((await send({ type: "gpt-limits:delete-calibration-point", conversationId: "delete-point-chat", pointIndex: 5 })).ok, false);
});

test("multi-chat storage migrates legacy state, isolates chats, sorts them, and supports reset/remove", async () => {
  const legacy = mergePage(null, page("chat-a", "A", [item("shared-id", "user", 4, { images: 1 })]));
  legacy.updatedAt = 100;
  const stage41Chat = mergePage(null, page("chat-b", "B", [], true, false));
  stage41Chat.updatedAt = 150;
  stage41Chat.calibrationPoints = [{ timestamp: 90, label: "normal", messagesCollected: 0, historyStatus: "Partial" }];
  const stored = { gptLimitsCurrentConversation: legacy, gptLimitsChats: { "chat-b": stage41Chat } };
  let windowListener;
  let runtimeListener;
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/chat-a" },
    addEventListener(type, callback) { if (type === "message") windowListener = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, stored[key]]));
        },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
    },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  const source = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  vm.runInNewContext(source, { window, chrome, globalThis: { GptLimitsAggregator: require("./aggregator.js") } });

  const queryState = () => new Promise((resolve) => runtimeListener({ type: "gpt-limits:get-current-state" }, {}, resolve));
  let messageWindow = window;
  const emit = async (summary) => {
    windowListener({ source: messageWindow, origin: messageWindow.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const initial = await queryState();
  assert.equal(initial.state.title, "A");
  assert.equal(initial.state.monitored, false);
  assert.match(initial.state.calibrationSourceKey, /^src_[a-f0-9]{16}$/);
  assert.equal(initial.state.calibrationLabel, null);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.state.calibrationPoints)), []);
  assert.equal(stored.gptLimitsChats["chat-b"].monitored, false);
  assert.match(stored.gptLimitsChats["chat-b"].calibrationSourceKey, /^src_[a-f0-9]{16}$/);
  assert.equal(stored.gptLimitsChats["chat-b"].calibrationPoints[0].sourceKey, stored.gptLimitsChats["chat-b"].calibrationSourceKey);
  assert.notEqual(stored.gptLimitsChats["chat-a"].calibrationSourceKey, stored.gptLimitsChats["chat-b"].calibrationSourceKey);
  assert.equal(stored.gptLimitsCurrentConversation, undefined);
  assert.equal(stored.gptLimitsChats["chat-a"].messagesCollected, 1);

  const monitorA = await new Promise((resolve) => runtimeListener({
    type: "gpt-limits:set-monitored", conversationId: "chat-a", monitored: true,
  }, {}, resolve));
  assert.equal(monitorA.ok, true);
  assert.equal(stored.gptLimitsChats["chat-a"].monitored, true);

  let reloadedWindowListener;
  let reloadedRuntimeListener;
  const reloadedWindow = {
    location: { origin: "https://chatgpt.com", pathname: "/c/chat-a" },
    addEventListener(type, callback) { if (type === "message") reloadedWindowListener = callback; },
  };
  const reloadedChrome = {
    storage: chrome.storage,
    runtime: { onMessage: { addListener(callback) { reloadedRuntimeListener = callback; } } },
  };
  vm.runInNewContext(source, { window: reloadedWindow, chrome: reloadedChrome, globalThis: { GptLimitsAggregator: require("./aggregator.js") } });
  windowListener = reloadedWindowListener;
  runtimeListener = reloadedRuntimeListener;
  messageWindow = reloadedWindow;
  const afterReload = await new Promise((resolve) => runtimeListener({ type: "gpt-limits:get-current-state" }, {}, resolve));
  assert.equal(afterReload.state.monitored, true);
  assert.equal(afterReload.state.calibrationSourceKey, initial.state.calibrationSourceKey);

  window.location.pathname = "/c/chat-b";
  reloadedWindow.location.pathname = "/c/chat-b";
  await emit({ ...page("chat-b", "B", [item("shared-id", "assistant", 9, { images: 2 })]), capturedAt: 200 });
  let resultB = await queryState();
  assert.equal(resultB.state.conversationId, "chat-b");
  assert.equal(resultB.state.messagesCollected, 1);
  assert.equal(resultB.state.userMessages, 0);
  assert.equal(resultB.state.assistantMessages, 1);
  assert.equal(resultB.state.monitored, false);
  assert.equal(stored.gptLimitsChats["chat-a"].messagesCollected, 1);
  assert.equal(stored.gptLimitsChats["chat-a"].attachments.images, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(resultB.chats.map((chat) => chat.conversationId))), ["chat-a", "chat-b"]);

  await emit({ ...page("chat-b", "B", [], true, true), capturedAt: 500 });

  window.location.pathname = "/c/chat-a";
  reloadedWindow.location.pathname = "/c/chat-a";
  await emit({ ...page("chat-a", "A renamed", [item("shared-id", "user", 700, { images: 8 }), item("a2", "assistant", 3)], true, true), capturedAt: 300 });
  const resultA = await queryState();
  assert.equal(resultA.state.title, "A renamed");
  assert.equal(resultA.state.messagesCollected, 2);
  assert.equal(resultA.state.estimatedTextTokens, 7);
  assert.equal(resultA.state.attachments.images, 1);
  assert.equal(resultA.state.monitored, true);
  assert.deepEqual(JSON.parse(JSON.stringify(resultA.chats.map((chat) => chat.conversationId))), ["chat-a", "chat-b"]);
  assert.equal(stored.gptLimitsChats["chat-b"].messagesCollected, 1);
  assert.equal(stored.gptLimitsChats["chat-b"].attachments.images, 2);

  const reset = await new Promise((resolve) => runtimeListener({ type: "gpt-limits:reset-current-chat", conversationId: "chat-a" }, {}, resolve));
  assert.equal(reset.ok, true);
  assert.equal(stored.gptLimitsChats["chat-a"].title, "A renamed");
  assert.equal(stored.gptLimitsChats["chat-a"].monitored, true);
  assert.equal(stored.gptLimitsChats["chat-a"].messagesCollected, 0);
  assert.equal(stored.gptLimitsChats["chat-b"].messagesCollected, 1);

  const stopMonitoring = await new Promise((resolve) => runtimeListener({
    type: "gpt-limits:set-monitored", conversationId: "chat-a", monitored: false,
  }, {}, resolve));
  assert.equal(stopMonitoring.ok, true);
  resultB = await queryState();
  assert.equal(stored.gptLimitsChats["chat-a"].monitored, false);
  assert.deepEqual(JSON.parse(JSON.stringify(resultB.chats.map((chat) => chat.conversationId))), ["chat-b", "chat-a"]);

  const removed = await new Promise((resolve) => runtimeListener({ type: "gpt-limits:remove-chat", conversationId: "chat-a" }, {}, resolve));
  assert.equal(removed.ok, true);
  assert.equal(stored.gptLimitsChats["chat-a"], undefined);
  assert.equal(stored.gptLimitsChats["chat-b"].title, "B");
  await emit({ ...page("chat-a", "A renamed", [item("shared-id", "user", 5)]), capturedAt: 400 });
  assert.equal(stored.gptLimitsChats["chat-a"].messagesCollected, 1);
  assert.equal(stored.gptLimitsChats["chat-a"].attachments.images, 0);
  assert.equal(stored.gptLimitsChats["chat-a"].monitored, false);
  assert.equal(stored.gptLimitsChats["chat-b"].messagesCollected, 1);

  const serialized = JSON.stringify(stored);
  for (const forbidden of ["private message text", "asset_pointer", "file_id", "https://files.example"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("monitored chats keep compact calibration snapshots only at configured aggregate changes", async () => {
  const stored = {};
  let windowListener;
  let runtimeListener;
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/calibration-a" },
    addEventListener(type, callback) { if (type === "message") windowListener = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, stored[key]]));
        },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
    },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  const source = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  vm.runInNewContext(source, { window, chrome, globalThis: { GptLimitsAggregator: require("./aggregator.js") } });
  const emit = async (summary) => {
    windowListener({ source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const setMonitored = (id, monitored) => new Promise((resolve) => runtimeListener({
    type: "gpt-limits:set-monitored", conversationId: id, monitored,
  }, {}, resolve));

  await emit({ ...page("calibration-a", "Calibration A", [item("a0", "user", 1)]), capturedAt: 1 });
  assert.equal(stored.gptLimitsChats["calibration-a"].monitored, false);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.gptLimitsChats["calibration-a"].calibrationSnapshots)), []);
  await setMonitored("calibration-a", true);
  await emit({ ...page("calibration-a", "Calibration A", [item("a1", "user", 2)]), capturedAt: 2 });
  let snapshots = stored.gptLimitsChats["calibration-a"].calibrationSnapshots;
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].messagesCollected, 2);

  await emit({ ...page("calibration-a", "Calibration A", [item("a2", "user", 1)]), capturedAt: 3 });
  assert.equal(stored.gptLimitsChats["calibration-a"].calibrationSnapshots.length, 1);
  await emit({ ...page("calibration-a", "Calibration A", Array.from({ length: 10 }, (_, i) => item(`ten-${i}`, "user")), true), capturedAt: 4 });
  snapshots = stored.gptLimitsChats["calibration-a"].calibrationSnapshots;
  assert.equal(snapshots.length, 2);
  assert.ok(snapshots[1].messagesCollected - snapshots[0].messagesCollected >= 10);

  await emit({ ...page("calibration-a", "Calibration A", [item("tokens-2000", "assistant", 2000)]), capturedAt: 5 });
  assert.equal(stored.gptLimitsChats["calibration-a"].calibrationSnapshots.length, 3);
  await emit({ ...page("calibration-a", "Calibration A", [item("image-change", "user", 0, { images: 1 })]), capturedAt: 6 });
  assert.equal(stored.gptLimitsChats["calibration-a"].calibrationSnapshots.length, 4);
  await emit({ ...page("calibration-a", "Calibration A", [], false, true), capturedAt: 7 });
  snapshots = stored.gptLimitsChats["calibration-a"].calibrationSnapshots;
  assert.equal(snapshots.length, 5);
  assert.equal(snapshots[4].historyStatus, "Complete");

  const stop = await setMonitored("calibration-a", false);
  assert.equal(stop.ok, true);
  await emit({ ...page("calibration-a", "Calibration A", Array.from({ length: 10 }, (_, i) => item(`stopped-${i}`, "user")), true, true), capturedAt: 8 });
  assert.equal(stored.gptLimitsChats["calibration-a"].calibrationSnapshots.length, 5);

  await setMonitored("calibration-a", true);
  await emit({ ...page("calibration-a", "Calibration A", Array.from({ length: 10 }, (_, i) => item(`cap-${i}`, "assistant")), true, true), capturedAt: 9 });
  for (let batch = 0; batch < 105; batch += 1) {
    await emit({
      ...page("calibration-a", "Calibration A", Array.from({ length: 10 }, (_, i) => item(`batch-${batch}-${i}`, "user")), true, true),
      capturedAt: 10 + batch,
    });
  }
  snapshots = stored.gptLimitsChats["calibration-a"].calibrationSnapshots;
  assert.equal(snapshots.length, 100);
  assert.equal(snapshots.at(-1).timestamp, 114);
  const snapshotKeys = ["timestamp", "messagesCollected", "userMessages", "assistantMessages", "otherMessages", "estimatedTextTokens", "images", "audio", "video", "otherAttachments", "historyStatus"];
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(snapshots[0]).sort())), [...snapshotKeys].sort());

  window.location.pathname = "/c/calibration-b";
  await setMonitored("calibration-a", true);
  await emit({ ...page("calibration-b", "Calibration B", [item("b0", "user")]), capturedAt: 200 });
  await setMonitored("calibration-b", true);
  await emit({ ...page("calibration-b", "Calibration B", [item("b1", "assistant")]), capturedAt: 201 });
  const otherChatSnapshots = JSON.parse(JSON.stringify(stored.gptLimitsChats["calibration-b"].calibrationSnapshots));

  window.location.pathname = "/c/calibration-a";
  const reset = await new Promise((resolve) => runtimeListener({
    type: "gpt-limits:reset-current-chat", conversationId: "calibration-a",
  }, {}, resolve));
  assert.equal(reset.ok, true);
  assert.equal(stored.gptLimitsChats["calibration-a"].monitored, true);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.gptLimitsChats["calibration-a"].calibrationSnapshots)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.gptLimitsChats["calibration-b"].calibrationSnapshots)), otherChatSnapshots);
  const remove = await new Promise((resolve) => runtimeListener({
    type: "gpt-limits:remove-chat", conversationId: "calibration-a",
  }, {}, resolve));
  assert.equal(remove.ok, true);
  assert.equal(stored.gptLimitsChats["calibration-a"], undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.gptLimitsChats["calibration-b"].calibrationSnapshots)), otherChatSnapshots);

  const serialized = JSON.stringify(stored);
  for (const forbidden of ["private message text", "message-id", "asset_pointer", "file_id", "filename", "https://"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("manual calibration points are labeled, deduplicated, capped, retained on reset, and removed with their chat", async () => {
  const stored = {};
  let windowListener;
  let runtimeListener;
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/manual-cal-a" },
    addEventListener(type, callback) { if (type === "message") windowListener = callback; },
  };
  const chrome = {
    storage: { local: {
      async get(keys) { const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.map((key) => [key, stored[key]])); },
      async set(values) { Object.assign(stored, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    } },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  const source = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  vm.runInNewContext(source, { window, chrome, globalThis: { GptLimitsAggregator: require("./aggregator.js") } });
  const emit = async (summary) => {
    windowListener({ source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const send = (message) => new Promise((resolve) => runtimeListener(message, {}, resolve));
  await emit({ ...page("manual-cal-a", "Calibration A", [item("m0", "user", 10, { images: 1 })], true), capturedAt: 1 });
  await emit({ ...page("manual-cal-b", "Calibration B", [item("b0", "assistant")]), capturedAt: 1 });
  assert.equal(stored.gptLimitsChats["manual-cal-a"].calibrationLabel, null);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.gptLimitsChats["manual-cal-a"].calibrationPoints)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "normal" }))), { ok: false });
  await send({ type: "gpt-limits:set-monitored", conversationId: "manual-cal-a", monitored: true });
  await send({ type: "gpt-limits:set-monitored", conversationId: "manual-cal-b", monitored: true });
  await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-b", label: "normal" });

  let result = await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "normal" });
  assert.equal(result.ok, true);
  let state = stored.gptLimitsChats["manual-cal-a"];
  const sourceKey = state.calibrationSourceKey;
  assert.match(sourceKey, /^src_[a-f0-9]{16}$/);
  assert.equal(state.calibrationLabel, "normal");
  assert.equal(state.calibrationPoints.length, 1);
  assert.equal(state.calibrationPoints[0].messagesCollected, 1);
  assert.equal(state.calibrationPoints[0].images, 1);
  assert.equal(state.calibrationPoints[0].historyStatus, "Partial");
  assert.equal(state.calibrationPoints[0].sourceKey, sourceKey);

  await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "normal" });
  assert.equal(state.calibrationPoints.length, 1, "same label and unchanged aggregate do not duplicate the last point");
  await emit({ ...page("manual-cal-a", "Calibration A", [item("m1", "assistant", 20, { images: 0 })], true), capturedAt: 2 });
  assert.equal(stored.gptLimitsChats["manual-cal-a"].calibrationLabel, "normal", "aggregate updates preserve the current manual label");
  await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "normal" });
  await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "near_limit" });
  await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "limit_reached" });
  state = stored.gptLimitsChats["manual-cal-a"];
  assert.deepEqual(JSON.parse(JSON.stringify(state.calibrationPoints.map((point) => point.label))), ["normal", "normal", "near_limit", "limit_reached"]);
  const stopped = await send({ type: "gpt-limits:set-monitored", conversationId: "manual-cal-a", monitored: false });
  assert.equal(stopped.ok, true);
  assert.equal(stored.gptLimitsChats["manual-cal-a"].calibrationSourceKey, sourceKey, "Stop monitoring preserves the source key");
  assert.equal(stored.gptLimitsChats["manual-cal-a"].calibrationLabel, "limit_reached");
  assert.equal(stored.gptLimitsChats["manual-cal-a"].calibrationPoints.length, 4);
  await send({ type: "gpt-limits:set-monitored", conversationId: "manual-cal-a", monitored: true });

  await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: null });
  state = stored.gptLimitsChats["manual-cal-a"];
  assert.equal(state.calibrationLabel, null);
  assert.equal(state.calibrationPoints.length, 4, "clearing current label keeps historical points");
  result = await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "unknown" });
  assert.equal(result.ok, false);

  for (let index = 0; index < 22; index += 1) {
    await emit({ ...page("manual-cal-a", "Calibration A", [item(`cap-${index}`, "user", 1)]), capturedAt: 10 + index });
    await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "near_limit" });
  }
  state = stored.gptLimitsChats["manual-cal-a"];
  assert.equal(state.calibrationPoints.length, 20);
  assert.equal(state.calibrationLabel, "near_limit");
  await emit({ ...page("manual-cal-a", "Calibration A", [], false, true), capturedAt: 100 });
  await send({ type: "gpt-limits:set-calibration-label", conversationId: "manual-cal-a", label: "limit_reached" });
  state = stored.gptLimitsChats["manual-cal-a"];
  assert.equal(state.calibrationPoints.at(-1).historyStatus, "Complete");

  const otherPoints = JSON.parse(JSON.stringify(stored.gptLimitsChats["manual-cal-b"].calibrationPoints));
  result = await send({ type: "gpt-limits:reset-current-chat", conversationId: "manual-cal-a" });
  assert.equal(result.ok, true);
  state = stored.gptLimitsChats["manual-cal-a"];
  assert.equal(state.monitored, true);
  assert.equal(state.calibrationSourceKey, sourceKey, "Reset preserves the source key");
  assert.equal(state.calibrationLabel, "limit_reached");
  assert.equal(state.messagesCollected, 0);
  assert.equal(state.attachments.images, 0);
  assert.equal(state.historyComplete, false);
  assert.equal(state.calibrationPoints.length, 20, "manual points persist through aggregate reset");
  assert.deepEqual(JSON.parse(JSON.stringify(stored.gptLimitsChats["manual-cal-b"].calibrationPoints)), otherPoints);

  state.riskNotificationLevel = 2;
  await chrome.storage.local.set({ gptLimitsChats: stored.gptLimitsChats });
  result = await send({ type: "gpt-limits:remove-chat", conversationId: "manual-cal-a" });
  assert.equal(result.ok, true);
  assert.equal(stored.gptLimitsChats["manual-cal-a"], undefined);
  assert.ok(stored.gptLimitsChats["manual-cal-b"]);
  await emit({ ...page("manual-cal-a", "Calibration A", [item("m0", "user", 10, { images: 1 })], true), capturedAt: 200 });
  const recreatedKey = stored.gptLimitsChats["manual-cal-a"].calibrationSourceKey;
  assert.match(recreatedKey, /^src_[a-f0-9]{16}$/);
  assert.notEqual(recreatedKey, sourceKey, "a recreated record receives a fresh independent key");
  assert.equal(stored.gptLimitsChats["manual-cal-a"].riskNotificationLevel, 0, "a recreated record starts without notification history");

  const serialized = JSON.stringify(stored);
  for (const forbidden of ["message text", "asset_pointer", "file_id", "filename", "https://files", "cap-0"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  const point = stored.gptLimitsChats["manual-cal-b"].calibrationPoints[0];
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(point).sort())), [
    "assistantMessages", "audio", "calibrationSnapshotsCount", "estimatedTextTokens", "historyStatus", "images", "label", "messagesCollected", "otherAttachments", "otherMessages", "sourceKey", "timestamp", "userMessages", "video",
  ].sort());
});

test("network diagnostics filter, sanitize, and cap stored resource entries", async () => {
  const stored = {};
  let windowListener;
  let runtimeListener;
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/current-chat-id" },
    addEventListener(type, callback) { if (type === "message") windowListener = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, stored[key]]));
        },
        async set(values) { Object.assign(stored, values); },
      },
    },
    runtime: { onMessage: { addListener(callback) { runtimeListener = callback; } } },
  };
  const source = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  vm.runInNewContext(source, { window, chrome, URL, globalThis: { GptLimitsAggregator: require("./aggregator.js") } });

  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", hookStatus: "installed", hookInstalledAt: 1 },
  });
  windowListener({
    source: window,
    origin: window.location.origin,
    data: { source: "gpt-limits-tool-capture-v1", networkResource: {
      pathname: "/assets/unrelated.js", initiatorType: "script", status: 200, startTime: 2,
    } },
  });
  for (let index = 0; index < 35; index += 1) {
    windowListener({
      source: window,
      origin: window.location.origin,
      data: { source: "gpt-limits-tool-capture-v1", networkResource: {
        pathname: `/backend-api/resource-${index}?q=private`, initiatorType: "fetch", status: 200,
        contentType: "application/json", startTime: 10 + index,
      } },
    });
  }
  for (const [pathname, startTime] of [
    ["/backend-api/conversation/current-chat-id?token=secret-query", 50],
    // PerformanceResourceTiming can report the same request as the fetch hook.
    ["/backend-api/conversation/current-chat-id?another=secret", 50.5],
    ["/backend-api/conversation/current-chat-id/stream_status?token=secret-query", 51],
    ["/other-resource/current-chat-id?token=secret-query", 52],
  ]) {
    windowListener({
      source: window,
      origin: window.location.origin,
      data: { source: "gpt-limits-tool-capture-v1", networkResource: {
        pathname, initiatorType: "fetch", status: 200,
        contentType: "application/json; secret=parameter", startTime,
        body: "private message body", requestBody: "request payload", cookies: "cookie value",
        headers: { Authorization: "Bearer secret" }, query: "sensitive query",
      } },
    });
  }
  for (let index = 0; index < 5; index += 1) {
    windowListener({
      source: window,
      origin: window.location.origin,
      data: { source: "gpt-limits-tool-capture-v1", networkResource: {
        pathname: `/backend-api/later-${index}`, initiatorType: "fetch", status: 200, startTime: 60 + index,
      } },
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  const result = await new Promise((resolve) => {
    runtimeListener({ type: "gpt-limits:get-current-state" }, {}, resolve);
  });
  const serialized = JSON.stringify(stored);
  assert.equal(result.chats.length, 0);
  assert.equal(result.conversationResources, undefined);
  assert.equal(result.otherResources, undefined);
  for (const key of ["gptLimitsLastCaptureDiagnostic", "gptLimitsLastCandidatePath", "gptLimitsHookTiming", "gptLimitsObservedNetworkResources"]) {
    assert.equal(stored[key], undefined);
  }
  for (const forbidden of ["secret-query", "private message body", "request payload", "cookie value", "Authorization", "Bearer secret", "sensitive query", "?token="]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("PerformanceResourceTiming records resources not observed by fetch or XHR hooks", () => {
  const posted = [];
  let observerCallback;
  class FakePerformanceObserver {
    constructor(callback) { observerCallback = callback; }
    observe(options) { this.options = options; }
  }
  const window = {
    location: {
      href: "https://chatgpt.com/c/observed-id",
      origin: "https://chatgpt.com",
      pathname: "/c/observed-id",
    },
    performance: {
      now: () => 123,
      getEntriesByType: () => [],
    },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response("{}"),
  };
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, PerformanceObserver: FakePerformanceObserver, Set, String, Date, Promise });
  observerCallback({ getEntries: () => [{
    name: "https://chatgpt.com/backend-api/conversation/observed-id?secret=query",
    initiatorType: "other", responseStatus: 200, startTime: 7.5,
  }] });
  const resource = posted.find((message) => message.networkResource)?.networkResource;
  assert.deepEqual(JSON.parse(JSON.stringify(resource)), {
    pathname: "/backend-api/conversation/observed-id",
    initiatorType: "other",
    status: 200,
    contentType: null,
    startTime: 7.5,
    containsConversationId: true,
  });
  assert.equal(JSON.stringify(posted).includes("secret=query"), false);
});

test("background catch-up overlap is checked only against the pre-check baseline IDs", () => {
  const baseline = new Set(["old-a", "old-b"]);
  assert.equal(historyCollector.containsBaselineOverlap(["new-during-check", "old-b"], baseline), true);
  assert.equal(historyCollector.containsBaselineOverlap(["new-during-check"], baseline), false);
  assert.equal(historyCollector.containsBaselineOverlap([], baseline), false);
});

test("background catch-up loads pages until baseline overlap and then stops", async () => {
  const container = { scrollTop: 250, scrollHeight: 1200, clientHeight: 600, clientWidth: 500, isConnected: true };
  let pagesObserved = 0;
  let overlapFound = false;
  let scrolls = 0;
  const result = await historyCollector.collectUntilOverlap({
    expectedConversationId: "background-chat",
    getConversationId: () => "background-chat",
    getState: async () => ({ messagesCollected: 25 }),
    findContainers: () => [container],
    scrollToTop: () => { scrolls += 1; container.scrollTop = 0; },
    getPageSignals: () => ({ pagesObserved, overlapFound }),
    wait: async () => {
      pagesObserved += 1;
      if (pagesObserved === 2) overlapFound = true;
    },
    pollIntervalMs: 1,
    pageWaitMs: 10,
    maxPages: 5,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.overlapFound, true);
  assert.equal(result.pagesLoaded, 2);
  assert.equal(scrolls, 2, "the collector stops after the overlapping page");
});

test("background catch-up fails safely when no older-page overlap arrives", async () => {
  const container = { scrollTop: 0, scrollHeight: 1200, clientHeight: 600, clientWidth: 500, isConnected: true };
  const result = await historyCollector.collectUntilOverlap({
    expectedConversationId: "background-chat",
    getConversationId: () => "background-chat",
    getState: async () => ({ messagesCollected: 20 }),
    findContainers: () => [container],
    scrollToTop: () => {},
    getPageSignals: () => ({ pagesObserved: 0, overlapFound: false }),
    wait: async () => {},
    pollIntervalMs: 1,
    pageWaitMs: 2,
    maxStalledPages: 2,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "no-overlap");
});

test("automatic schedule defaults off, replaces intervals, and clears its recurring alarm", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const local = {};
  const session = {};
  const listeners = [];
  const alarmCalls = [];
  const runtimeListeners = [];
  let schedulerAlarm = null;
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(fn) { runtimeListeners.push(fn); } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    permissions: { async contains() { return true; }, onAdded: { addListener() {} } },
    storage: {
      local: { async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } },
      session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, values); }, async remove(key) { delete session[key]; } },
    },
    alarms: {
      onAlarm: { addListener(fn) { listeners.push(fn); } },
      async create(name, info) {
        alarmCalls.push({ name, info });
        if (name === "gptLimitsMonitoredChatScheduler") schedulerAlarm = { name, scheduledTime: Date.now() + (info.delayInMinutes || 0) * 60000, periodInMinutes: info.periodInMinutes };
      },
      async clear(name) { alarmCalls.push({ clear: name }); if (name === "gptLimitsMonitoredChatScheduler") schedulerAlarm = null; },
      async get() { return schedulerAlarm; },
    },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Map, Number, Object, Array });
  const send = (message, sender = { id: "ext" }) => new Promise((resolve) => {
    let asyncReply = false;
    for (const listener of runtimeListeners) if (listener(message, sender, resolve) === true) asyncReply = true;
    if (!asyncReply) resolve(undefined);
  });
  assert.equal(local.gptLimitsAutomaticCheckInterval, undefined, "missing setting is treated as Off");
  assert.deepEqual(JSON.parse(JSON.stringify(await send({ type: "gpt-limits:configure-automatic-checks", interval: "30" }))), { ok: true, interval: "30" });
  assert.equal(alarmCalls.at(-1).name, "gptLimitsMonitoredChatScheduler");
  assert.deepEqual(JSON.parse(JSON.stringify(alarmCalls.at(-1).info)), { delayInMinutes: 30, periodInMinutes: 30 });
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.alarmExists, true, "alarms.get confirms the created recurring alarm");
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.nextScheduledTime, schedulerAlarm.scheduledTime);
  await send({ type: "gpt-limits:configure-automatic-checks", interval: "60" });
  assert.deepEqual(JSON.parse(JSON.stringify(alarmCalls.slice(-2))), [
    { clear: "gptLimitsMonitoredChatScheduler" },
    { name: "gptLimitsMonitoredChatScheduler", info: { delayInMinutes: 60, periodInMinutes: 60 } },
  ]);
  assert.equal(schedulerAlarm.periodInMinutes, 60);
  await send({ type: "gpt-limits:configure-automatic-checks", interval: "180" });
  assert.equal(schedulerAlarm.periodInMinutes, 180);
  await send({ type: "gpt-limits:configure-automatic-checks", interval: "off" });
  assert.deepEqual(JSON.parse(JSON.stringify(alarmCalls.at(-1))), { clear: "gptLimitsMonitoredChatScheduler" });
  assert.equal(alarmCalls.some((call) => call.name === "gptLimitsBackgroundCheckDeadline"), false);
});

test("automatic scheduler chooses one eligible oldest chat per tick and shares the manual temporary-tab engine", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const chats = {
    never: { conversationId: "never-chat", title: "Never checked", calibrationSourceKey: "src_never", monitored: true, historyComplete: true, hasPreviousPage: false, processedMessageIds: ["n1"] },
    oldest: { conversationId: "old-chat", title: "Oldest", calibrationSourceKey: "src_old", monitored: true, historyComplete: true, hasPreviousPage: false, processedMessageIds: ["o1"], lastAutomaticCheckAt: 100 },
    newer: { conversationId: "new-chat", title: "Newer", calibrationSourceKey: "src_new", monitored: true, historyComplete: true, hasPreviousPage: false, processedMessageIds: ["x1"], lastAutomaticCheckAt: 200 },
    partial: { conversationId: "partial-chat", title: "Partial", calibrationSourceKey: "src_partial", monitored: true, historyComplete: false, hasPreviousPage: true, processedMessageIds: ["p1"] },
    unmonitored: { conversationId: "off-chat", title: "Unmonitored", calibrationSourceKey: "src_off", monitored: false, historyComplete: true, hasPreviousPage: false, processedMessageIds: ["u1"] },
  };
  const local = { gptLimitsAutomaticCheckInterval: "30", gptLimitsChats: chats };
  const session = {};
  const runtimeListeners = [];
  const alarmListeners = [];
  const removed = [];
  const created = [];
  const navigated = [];
  let tabId = 70;
  let openConversationId = null;
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(fn) { runtimeListeners.push(fn); } }, onStartup: { addListener(fn) { this.fn = fn; } }, onInstalled: { addListener() {} } },
    permissions: { async contains() { return true; }, onAdded: { addListener() {} } },
    storage: {
      local: { async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } },
      session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, values); }, async remove(key) { delete session[key]; } },
    },
    alarms: { onAlarm: { addListener(fn) { alarmListeners.push(fn); } }, async create() {}, async clear() {}, async get(name) { return name === "gptLimitsMonitoredChatScheduler" ? { name, scheduledTime: Date.now() + 60000, periodInMinutes: 30 } : null; } },
    tabs: {
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
      async query() { return openConversationId ? [{ id: 4, url: `https://chatgpt.com/c/${openConversationId}` }] : []; }, async create(options) { const tab = { id: ++tabId, ...options }; created.push(tab); return tab; },
      async update(id, options) { navigated.push({ id, ...options }); }, async remove(id) { removed.push(id); },
      async get(id) { return { id, url: navigated.find((tab) => tab.id === id)?.url || "about:blank" }; },
    },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Map, Number, Object, Array });
  const send = (message, sender = { id: "ext" }) => new Promise((resolve) => {
    let asyncReply = false;
    for (const listener of runtimeListeners) if (listener(message, sender, resolve) === true) asyncReply = true;
    if (!asyncReply) resolve(undefined);
  });
  const tick = async () => {
    alarmListeners[0]({ name: "gptLimitsMonitoredChatScheduler" });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  alarmListeners[0]({ name: "gptLimitsBackgroundCheckDeadline" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(local.gptLimitsAutomaticSchedulerStatus?.lastTickAt, null, "timeout alarm does not route to the scheduler tick");
  await tick();
  assert.equal(created.length, 1, "one scheduled tick creates one temporary tab");
  assert.equal(Number.isFinite(local.gptLimitsAutomaticSchedulerStatus.lastTickAt), true);
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.lastTickResult, "Started");
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.alarmExists, true);
  assert.equal(JSON.stringify(local.gptLimitsAutomaticSchedulerStatus).includes("never-chat"), false, "scheduler diagnostics contain no conversation IDs");
  assert.match(navigated[0].url, /never-chat/, "never automatically checked chat is selected before older timestamps");
  assert.deepEqual(JSON.parse(JSON.stringify(created[0])), { id: 71, url: "about:blank", active: false });
  await tick();
  assert.equal(created.length, 1, "a running check blocks another scheduled tick");
  assert.equal(local.gptLimitsBackgroundCheckStatus.reason, "already-running");
  const finish = async (ownedTab, status = "failed") => {
    await send({ type: "gpt-limits:background-check-result", tabId: ownedTab, status, reason: status === "complete" ? null : "no-overlap", newMessages: status === "complete" ? 7 : 0, pagesLoaded: 2, overlapFound: status === "complete" }, { tab: { id: ownedTab } });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  await finish(71);
  assert.equal(chats.never.lastAutomaticCheckResult, "failed");
  assert.equal(removed.includes(71), true);
  openConversationId = "old-chat";
  await tick();
  assert.equal(created.length, 1, "already-open user chat is skipped without creating a temporary tab");
  assert.equal(chats.oldest.lastAutomaticCheckResult, "skipped");
  openConversationId = null;
  await tick();
  assert.equal(created.length, 2);
  assert.match(navigated[1].url, /new-chat/, "after the failed never-checked and skipped oldest chats, the next oldest eligible chat is chosen");
  assert.equal(chats.partial.lastAutomaticCheckAt, undefined, "Partial monitored chats are not checked");
  assert.equal(chats.unmonitored.lastAutomaticCheckAt, undefined, "unmonitored chats are not checked");
  await finish(72);
  await tick();
  assert.match(navigated[2].url, /never-chat/, "a failure timestamp moves the selection round-robin to the oldest attempt");
  await finish(73, "complete");
  assert.equal(chats.never.lastAutomaticCheckResult, "complete");
  assert.equal(Number.isFinite(chats.never.lastAutomaticCheckAt), true);
  assert.equal(removed.includes(73), true, "automatic success closes its owned temporary tab");
  assert.match(source, /startBackgroundCheck\(\{ automatic: true, selectedSourceKey:/, "automatic checks call the same engine used by the manual button");
  assert.doesNotMatch(source, /fetch\s*\(/, "scheduler does not make API fetches");
});

test("scheduler reports a missing alarm and a missing alarms permission after worker restoration", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const local = { gptLimitsAutomaticCheckInterval: "60" };
  const listeners = [];
  const runtimeListeners = [];
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(fn) { runtimeListeners.push(fn); } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    permissions: { async contains() { return false; }, onAdded: { addListener() {} } },
    storage: { local: { async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } }, session: { async get(key) { return { [key]: undefined }; }, async set() {}, async remove() {} } },
    alarms: { onAlarm: { addListener(fn) { listeners.push(fn); } }, async create() {}, async clear() {}, async get() { return null; } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Map, Number, Object, Array });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.enabled, false);
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.alarmExists, false);
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.lastReason, "alarm-permission-missing");
});

test("scheduler create is not accepted until alarms.get verifies the recurring alarm", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const local = {};
  const runtimeListeners = [];
  const createCalls = [];
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(fn) { runtimeListeners.push(fn); } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    permissions: { async contains() { return true; }, onAdded: { addListener() {} } },
    storage: { local: { async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } }, session: { async get(key) { return { [key]: undefined }; }, async set() {}, async remove() {} } },
    alarms: { onAlarm: { addListener() {} }, async create(name, info) { createCalls.push({ name, info }); }, async clear() {}, async get() { return null; } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Map, Number, Object, Array });
  await new Promise((resolve) => setImmediate(resolve));
  const result = await new Promise((resolve) => runtimeListeners[0]({ type: "gpt-limits:configure-automatic-checks", interval: "30" }, { id: "ext" }, resolve));
  assert.equal(createCalls.at(-1).info.periodInMinutes, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, reason: "scheduler-alarm-missing" });
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.alarmExists, false);
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.lastReason, "scheduler-alarm-missing");
});

test("scheduler tick reports explicit no-monitored and no-eligible outcomes", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const local = { gptLimitsAutomaticCheckInterval: "30", gptLimitsChats: {} };
  const session = {};
  const listeners = [];
  const runtimeListeners = [];
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(fn) { runtimeListeners.push(fn); } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
    permissions: { async contains() { return true; }, onAdded: { addListener() {} } },
    storage: { local: { async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } }, session: { async get(key) { return { [key]: session[key] }; }, async set() {}, async remove() {} } },
    alarms: { onAlarm: { addListener(fn) { listeners.push(fn); } }, async create() {}, async clear() {}, async get(name) { return { name, scheduledTime: Date.now() + 60000, periodInMinutes: 30 }; } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} }, async query() { return []; } },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Map, Number, Object, Array });
  const send = (message) => new Promise((resolve) => {
    let asyncReply = false;
    for (const listener of runtimeListeners) if (listener(message, { id: "ext" }, resolve) === true) asyncReply = true;
    if (!asyncReply) resolve(undefined);
  });
  const none = await send({ type: "gpt-limits:run-automatic-scheduler-tick" });
  assert.deepEqual(JSON.parse(JSON.stringify(none)), { ok: false, result: "Skipped", reason: "no-monitored-chats", trigger: "manual" });
  assert.equal(Number.isFinite(local.gptLimitsAutomaticSchedulerStatus.lastTickAt), true);
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.lastReason, "no-monitored-chats");
  local.gptLimitsChats = {
    partial: { monitored: true, historyComplete: false, hasPreviousPage: true, processedMessageIds: ["p"] },
    off: { monitored: false, historyComplete: true, hasPreviousPage: false, processedMessageIds: ["u"] },
  };
  const ineligible = await send({ type: "gpt-limits:run-automatic-scheduler-tick" });
  assert.equal(ineligible.reason, "no-eligible-chats");
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.lastTickResult, "Skipped");
});

test("automatic scheduler restores a recurring alarm on Chrome startup without running a check immediately", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const local = { gptLimitsAutomaticCheckInterval: "180" };
  const createCalls = [];
  let startup;
  const runtimeListeners = [];
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(fn) { runtimeListeners.push(fn); } }, onStartup: { addListener(fn) { startup = fn; } }, onInstalled: { addListener() {} } },
    permissions: { async contains() { return true; }, onAdded: { addListener() {} } },
    storage: { local: { async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } }, session: { async get(key) { return { [key]: undefined }; }, async set() {}, async remove() {} } },
    alarms: { onAlarm: { addListener() {} }, async create(name, info) { createCalls.push({ name, info }); }, async clear() {}, async get() { return null; } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Map, Number, Object, Array });
  startup();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(createCalls)), [{ name: "gptLimitsMonitoredChatScheduler", info: { delayInMinutes: 180, periodInMinutes: 180 } }]);
  assert.equal(local.gptLimitsBackgroundCheckStatus, undefined, "startup only restores the alarm; no check runs immediately");
});

test("automatic scheduler reload keeps a correct existing alarm without creating a duplicate", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const local = { gptLimitsAutomaticCheckInterval: "60" };
  const created = [];
  const runtimeListeners = [];
  let startup;
  const existing = { name: "gptLimitsMonitoredChatScheduler", periodInMinutes: 60, scheduledTime: Date.now() + 3600000 };
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(fn) { runtimeListeners.push(fn); } }, onStartup: { addListener(fn) { startup = fn; } }, onInstalled: { addListener() {} } },
    permissions: { async contains() { return true; }, onAdded: { addListener() {} } },
    storage: { local: { async get(keys) { const names = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(names.map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } }, session: { async get(key) { return { [key]: undefined }; }, async set() {}, async remove() {} } },
    alarms: { onAlarm: { addListener() {} }, async create(name, info) { created.push({ name, info }); }, async clear() {}, async get() { return existing; } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} } },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Map, Number, Object, Array });
  startup();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(created, [], "restoring an existing alarm does not create another one");
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.alarmExists, true);
  assert.equal(local.gptLimitsAutomaticSchedulerStatus.nextScheduledTime, existing.scheduledTime);
});

test("Stage 4.10 service worker opens one inactive tab, reports safe status, and closes it", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const contentSource = fs.readFileSync(path.join(__dirname, "content.js"), "utf8");
  const collectorSource = fs.readFileSync(path.join(__dirname, "history-collector.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.optional_permissions, ["notifications", "alarms"]);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(contentSource, /\bfetch\s*\(|textContent|innerText|Authorization|cookies?/i);
  assert.doesNotMatch(collectorSource, /\bfetch\s*\(|textContent|innerText|Authorization|cookies?/i);

  const local = {
    gptLimitsBackgroundMonitoring: true,
    gptLimitsChats: { "private-conversation-id": {
      conversationId: "private-conversation-id", title: "Private title", monitored: true,
      historyComplete: true, hasPreviousPage: false, estimatedTextTokens: 9000,
      processedMessageIds: ["private-message-a", "private-message-b"],
    } },
  };
  const session = {};
  const messageListeners = [];
  let updatedListener;
  let removedListener;
  let created;
  let navigated;
  let sentToTab;
  let removedTab;
  const alarmListeners = [];
  const alarmCalls = [];
  const operationOrder = [];
  const chrome = {
    runtime: {
      id: "extension-id",
      onMessage: { addListener(listener) { messageListeners.push(listener); } },
      getURL: (value) => value,
    },
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])); },
        async set(values) { Object.assign(local, values); operationOrder.push("status"); },
      },
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(values) { Object.assign(session, values); },
        async remove(key) { delete session[key]; },
      },
    },
    tabs: {
      onUpdated: { addListener(listener) { updatedListener = listener; } },
      onRemoved: { addListener(listener) { removedListener = listener; } },
      async query() { return []; },
      async create(options) { created = options; return { id: 41 }; },
      async update(tabId, options) { navigated = { tabId, ...options }; },
      async sendMessage(tabId, message) { sentToTab = { tabId, message }; return { ok: true, started: true }; },
        async remove(tabId) { removedTab = tabId; operationOrder.push(`remove:${tabId}`); removedListener(tabId); },
    },
    permissions: { async contains({ permissions }) { return permissions.includes("alarms"); } },
    alarms: {
      onAlarm: { addListener(listener) { alarmListeners.push(listener); } },
      async create(name, info) { alarmCalls.push({ name, info }); },
      async clear(name) { alarmCalls.push({ clear: name }); },
    },
    notifications: { async create() {} },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array });
  const send = (message, sender = {}) => new Promise((resolve) => {
    let asyncReply = false;
    for (const listener of messageListeners) {
      const result = listener(message, sender, resolve);
      if (result === true) asyncReply = true;
    }
    if (!asyncReply) resolve(undefined);
  });

  const started = await send({ type: "gpt-limits:start-background-check" });
  assert.equal(started.ok, true);
  const activeSession = session.gptLimitsActiveCheckSession;
  assert.equal(activeSession.temporaryTabId, 41);
  assert.equal("conversationId" in activeSession, false);
  assert.deepEqual(JSON.parse(JSON.stringify(activeSession.baselineIds)), ["private-message-a", "private-message-b"]);
  assert.equal("messageIds" in activeSession, false);
  assert.equal("conversationId" in activeSession, false);
  assert.deepEqual(JSON.parse(JSON.stringify(created)), { url: "about:blank", active: false });
  assert.deepEqual(JSON.parse(JSON.stringify(navigated)), { tabId: 41, url: "https://chatgpt.com/c/private-conversation-id" });
  updatedListener(41, { status: "complete" }, { id: 41, url: "https://chatgpt.com/g/workspace/c/private-conversation-id" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sentToTab, undefined, "page load alone waits for the content-ready handshake");
  assert.equal(local.gptLimitsBackgroundCheckStatus.phase, "waiting-for-content");
  const wrongTabReady = await send({ type: "gpt-limits:background-check-ready" }, { tab: { id: 7, url: "https://chatgpt.com/c/private-conversation-id" } });
  assert.deepEqual(JSON.parse(JSON.stringify(wrongTabReady)), { ok: false });
  assert.equal(sentToTab, undefined, "ready from a user tab cannot start the collector");
  const ready = await send({ type: "gpt-limits:background-check-ready" }, { tab: { id: 41, url: "https://chatgpt.com/g/workspace/c/private-conversation-id" } });
  assert.equal(ready.ok, true);
  assert.equal(ready.started, true);
  assert.equal(sentToTab.tabId, 41);
  assert.equal(local.gptLimitsBackgroundCheckStatus.phase, "waiting-for-capture");
  assert.deepEqual(JSON.parse(JSON.stringify(sentToTab.message.baselineIds)), ["private-message-a", "private-message-b"]);
  assert.equal("processedMessageIds" in sentToTab.message.baselineState, false);
  assert.equal(JSON.stringify(local.gptLimitsBackgroundCheckStatus).includes("private-conversation-id"), false);
  assert.equal(alarmCalls.some((call) => call.name === "gptLimitsBackgroundCheckDeadline"), true);

  const result = await send({
    type: "gpt-limits:background-check-result", tabId: 41, status: "complete",
    newMessages: 7, pagesLoaded: 2, overlapFound: true,
  }, { tab: { id: 41 } });
  assert.equal(result.ok, true);
  assert.equal(removedTab, 41);
  assert.ok(operationOrder.indexOf("status") < operationOrder.indexOf("remove:41"), "terminal status is persisted before tab removal");
  assert.equal(session.gptLimitsActiveCheckSession, undefined, "active check is removed after cleanup");
  assert.deepEqual(JSON.parse(JSON.stringify(local.gptLimitsBackgroundCheckStatus)), {
    status: "complete", lastCheckAt: local.gptLimitsBackgroundCheckStatus.lastCheckAt,
    phase: null, reason: null, newMessages: 7, pagesLoaded: 2, overlapFound: true,
  });
  const storedJson = JSON.stringify({ local: local.gptLimitsBackgroundCheckStatus, session });
  assert.equal(storedJson.includes("private-conversation-id"), false);
  assert.equal(storedJson.includes("private-message-a"), false);
  assert.equal(storedJson.includes("Private title"), false);

  assert.equal((await send({ type: "gpt-limits:start-background-check" })).ok, true);
  const failed = await send({
    type: "gpt-limits:background-check-result", tabId: 41, status: "failed",
    reason: "no-overlap", newMessages: 7, pagesLoaded: 30, overlapFound: false,
  }, { tab: { id: 41 } });
  assert.equal(failed.ok, true);
  assert.equal(removedTab, 41);
  assert.equal(local.gptLimitsBackgroundCheckStatus.status, "failed");
  assert.equal(local.gptLimitsBackgroundCheckStatus.reason, "no-overlap");
});

test("background check lifecycle closes only its owned tab on timeout, zero-message success, failure, exceptions and manual close", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const record = { conversationId: "lifecycle-chat", monitored: true, historyComplete: true, hasPreviousPage: false, processedMessageIds: ["old-1"], estimatedTextTokens: 12 };
  async function makeWorker(collectorResponse = { ok: true, started: true }) {
    const local = { gptLimitsBackgroundMonitoring: true, gptLimitsChats: { [record.conversationId]: record } };
    const session = {};
    const listeners = [];
    const alarmListeners = [];
    const tabUpdatedListeners = [];
    const tabRemovedListeners = [];
    const removed = [];
    let nextTabId = 91;
    const chrome = {
      runtime: { id: "ext", onMessage: { addListener(listener) { listeners.push(listener); } }, getURL: (value) => value },
      storage: {
        local: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } },
        session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, values); }, async remove(key) { delete session[key]; } },
      },
      tabs: {
        onUpdated: { addListener(listener) { tabUpdatedListeners.push(listener); } },
        onRemoved: { addListener(listener) { tabRemovedListeners.push(listener); } },
        async query() { return [{ id: 7, url: "https://chatgpt.com/c/other-user-chat" }]; },
        async create() { return { id: nextTabId }; }, async update() {},
        async sendMessage() { return collectorResponse; },
        async remove(tabId) { removed.push(tabId); for (const listener of tabRemovedListeners) listener(tabId); },
        async get(tabId) { if (removed.includes(tabId)) throw new Error("missing"); return { id: tabId, url: `https://chatgpt.com/g/workspace/c/${record.conversationId}` }; },
      },
      permissions: { async contains() { return true; } },
      alarms: { onAlarm: { addListener(listener) { alarmListeners.push(listener); } }, async create() {}, async clear() {} },
      notifications: { async create() {} },
    };
    const runWorker = () => vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array });
    runWorker();
    const send = (message, sender = {}) => new Promise((resolve) => {
      let asyncReply = false;
      for (const listener of listeners) if (listener(message, sender, resolve) === true) asyncReply = true;
      if (!asyncReply) resolve(undefined);
    });
    const start = async () => {
      const result = await send({ type: "gpt-limits:start-background-check" });
      assert.equal(result.ok, true, JSON.stringify(result));
      return nextTabId;
    };
    return { local, session, removed, alarmListeners, tabUpdatedListeners, tabRemovedListeners, send, start, restart: runWorker, get nextTabId() { return nextTabId; } };
  }

  const zeroSuccess = await makeWorker();
  const zeroTab = await zeroSuccess.start();
  const zeroResult = await zeroSuccess.send({ type: "gpt-limits:background-check-result", tabId: zeroTab, status: "complete", newMessages: 0, pagesLoaded: 3, overlapFound: true }, { tab: { id: zeroTab } });
  assert.equal(zeroResult.ok, true);
  assert.deepEqual(zeroSuccess.removed, [zeroTab]);
  assert.equal(zeroSuccess.local.gptLimitsBackgroundCheckStatus.newMessages, 0);

  const timed = await makeWorker();
  const timedTab = await timed.start();
  timed.alarmListeners.length = 0;
  timed.tabRemovedListeners.length = 0;
  timed.restart(); // Simulate an MV3 worker suspension/restart while the tab remains open.
  await new Promise((resolve) => setImmediate(resolve));
  timed.session.gptLimitsActiveCheckSession.deadlineAt = Date.now() - 1;
  timed.alarmListeners.at(-1)({ name: "gptLimitsBackgroundCheckDeadline" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timed.removed, [timedTab]);
  assert.equal(timed.local.gptLimitsBackgroundCheckStatus.reason, "timeout");
  assert.equal(timed.session.gptLimitsActiveCheckSession, undefined);

  const missingReady = await makeWorker();
  const missingReadyTab = await missingReady.start();
  missingReady.tabUpdatedListeners[0](missingReadyTab, { status: "complete" }, { id: missingReadyTab, url: "https://chatgpt.com/g/workspace/c/lifecycle-chat" });
  await new Promise((resolve) => setImmediate(resolve));
  missingReady.session.gptLimitsActiveCheckSession.phaseDeadlineAt = Date.now() - 1;
  missingReady.tabRemovedListeners.length = 0;
  missingReady.restart();
  await new Promise((resolve) => setImmediate(resolve));
  missingReady.alarmListeners.at(-1)({ name: "gptLimitsBackgroundCheckDeadline" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(missingReady.local.gptLimitsBackgroundCheckStatus.reason, "content-not-ready");
  assert.deepEqual(missingReady.removed, [missingReadyTab]);
  assert.equal(missingReady.session.gptLimitsActiveCheckSession, undefined);

  const failedStart = await makeWorker({ ok: false, reason: "conversation-dom-not-ready" });
  const failedStartTab = await failedStart.start();
  const failedStartResult = await failedStart.send({ type: "gpt-limits:background-check-ready" }, { tab: { id: failedStartTab, url: "https://chatgpt.com/c/lifecycle-chat" } });
  assert.equal(failedStartResult.reason, "conversation-dom-not-ready");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failedStart.local.gptLimitsBackgroundCheckStatus.reason, "conversation-dom-not-ready");
  assert.deepEqual(failedStart.removed, [failedStartTab]);
  assert.equal(failedStart.session.gptLimitsActiveCheckSession, undefined);

  const noCapture = await makeWorker();
  const noCaptureTab = await noCapture.start();
  const noCaptureReady = await noCapture.send({ type: "gpt-limits:background-check-ready" }, { tab: { id: noCaptureTab, url: "https://chatgpt.com/c/lifecycle-chat" } });
  assert.equal(noCaptureReady.started, true);
  noCapture.session.gptLimitsActiveCheckSession.phaseDeadlineAt = Date.now() - 1;
  noCapture.tabRemovedListeners.length = 0;
  noCapture.restart();
  await new Promise((resolve) => setImmediate(resolve));
  noCapture.alarmListeners.at(-1)({ name: "gptLimitsBackgroundCheckDeadline" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(noCapture.local.gptLimitsBackgroundCheckStatus.reason, "initial-capture-unavailable");
  assert.deepEqual(noCapture.removed, [noCaptureTab]);
  assert.equal(noCapture.session.gptLimitsActiveCheckSession, undefined);

  const manuallyClosed = await makeWorker();
  const manualTab = await manuallyClosed.start();
  manuallyClosed.tabRemovedListeners[0](manualTab);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manuallyClosed.local.gptLimitsBackgroundCheckStatus.reason, "user-closed");
  assert.equal(manuallyClosed.session.gptLimitsActiveCheckSession, undefined);
  assert.deepEqual(manuallyClosed.removed, [], "manual close does not retry-close the already removed tab");

  const unrelated = await makeWorker();
  const ownedTab = await unrelated.start();
  await unrelated.send({ type: "gpt-limits:background-check-result", tabId: 7, status: "failed", reason: "no-overlap" }, { tab: { id: 7 } });
  assert.deepEqual(unrelated.removed, [], "a pre-existing user tab cannot be removed by a result from another tab");
  const failure = await unrelated.send({ type: "gpt-limits:background-check-result", tabId: ownedTab, status: "failed", reason: "no-overlap" }, { tab: { id: ownedTab } });
  assert.equal(failure.ok, true);
  assert.deepEqual(unrelated.removed, [ownedTab]);
});

test("background check skips an already open user conversation and requires a complete monitored baseline", async () => {
  const run = async (record, open) => {
    const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
    const local = { gptLimitsBackgroundMonitoring: true, gptLimitsChats: { [record.conversationId]: record } };
    const listeners = [];
    let createCalls = 0;
    let sendMessageCalls = 0;
    const chrome = {
      runtime: { id: "ext", onMessage: { addListener(listener) { listeners.push(listener); } }, getURL: (value) => value },
      storage: {
        local: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } },
        session: { async get(key) { return { [key]: undefined }; }, async set() {}, async remove() {} },
      },
      tabs: {
        onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
        async query() { return open ? [{ id: 7, url: `https://chatgpt.com/c/${record.conversationId}` }] : []; },
        async create() { createCalls += 1; return { id: 9 }; }, async update() {}, async sendMessage() { sendMessageCalls += 1; return { ok: true }; }, async remove() {},
      },
      permissions: { async contains({ permissions }) { return permissions.includes("alarms"); } },
      alarms: { onAlarm: { addListener() {} }, async create() {}, async clear() {} },
      notifications: { async create() {} },
    };
    vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array });
    const response = await new Promise((resolve) => {
      let replied = false;
      let asyncReply = false;
      for (const listener of listeners) {
        const result = listener({ type: "gpt-limits:start-background-check" }, {}, (value) => { replied = true; resolve(value); });
        if (result === true) asyncReply = true;
      }
      if (!asyncReply && !replied) resolve(undefined);
    });
    return { response, createCalls, sendMessageCalls, status: local.gptLimitsBackgroundCheckStatus };
  };
  const base = { conversationId: "local-id", monitored: true, historyComplete: true, hasPreviousPage: false, processedMessageIds: ["m1"], estimatedTextTokens: 10 };
  const skipped = await run(base, true);
  assert.deepEqual(JSON.parse(JSON.stringify(skipped.response)), { ok: false, reason: "already-open" });
  assert.equal(skipped.createCalls, 0);
  assert.equal(skipped.sendMessageCalls, 0, "an already open user tab is neither reloaded nor scrolled by the extension");
  const partial = await run({ ...base, historyComplete: false, hasPreviousPage: true }, false);
  assert.deepEqual(JSON.parse(JSON.stringify(partial.response)), { ok: false, reason: "collect-full-history-first" });
  assert.equal(partial.createCalls, 0);
  assert.equal(partial.sendMessageCalls, 0);
});

test("worker restore retains the temporary-tab baseline and starts after ready on a project route", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const session = { gptLimitsActiveCheckSession: {
    temporaryTabId: 41, phase: "waiting-for-content", startedAt: Date.now(), deadlineAt: Date.now() + 180000,
    phaseDeadlineAt: Date.now() + 20000, started: false, baselineIds: ["restore-message"],
    baselineState: { estimatedTextTokens: 42, historyComplete: true, hasPreviousPage: false }, closeTab: true,
  } };
  const listeners = [];
  let sent = null;
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(listener) { listeners.push(listener); } }, getURL: (value) => value },
    storage: {
      local: { async get() { return {}; }, async set() {} },
      session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, values); }, async remove(key) { delete session[key]; } },
    },
    tabs: {
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
      async get(id) { return { id, url: "https://chatgpt.com/g/project/c/restore-chat" }; },
      async sendMessage(tabId, message) { sent = { tabId, message }; return { ok: true, started: true }; },
      async remove() {}, async query() { return []; },
    },
    permissions: { async contains() { return true; } },
    alarms: { onAlarm: { addListener() {} }, async create() {}, async clear() {} },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array });
  const ready = await new Promise((resolve) => listeners[0]({ type: "gpt-limits:background-check-ready" }, { tab: { id: 41, url: "https://chatgpt.com/g/project/c/restore-chat" } }, resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(ready)), { ok: true, started: true });
  assert.equal(sent.tabId, 41);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.message.baselineIds)), ["restore-message"]);
  assert.equal(sent.message.conversationId, "restore-chat");
  assert.equal(sent.message.startedAt, session.gptLimitsActiveCheckSession.startedAt);
  assert.equal("conversationId" in session.gptLimitsActiveCheckSession, false);
});

test("temporary content-tab SPA monitor allows same-ID routes and stops only after the conversation ID changes", async () => {
  const initial = mergePage(null, page("spa-chat", "SPA chat", [item("baseline", "user", 10)], false, true));
  initial.monitored = true;
  const stored = { gptLimitsChats: { "spa-chat": initial } };
  const reports = [];
  const messageListeners = [];
  const intervals = [];
  const cleared = [];
  let pathname = "/c/spa-chat";
  const window = {
    location: {
      origin: "https://chatgpt.com",
      get pathname() { return pathname; },
      get href() { return `https://chatgpt.com${pathname}`; },
    },
    addEventListener() {},
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); }, async remove() {},
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      onMessage: { addListener(listener) { messageListeners.push(listener); } },
      async sendMessage(message) {
        reports.push(message);
        if (message.type === "gpt-limits:identify-background-check-tab") return { active: true };
        if (message.type === "gpt-limits:background-check-ready") return { ok: true, started: true };
        return { ok: true };
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => null }, setTimeout() { return 1; },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    clearInterval(id) { cleared.push(id); },
    globalThis: { GptLimitsAggregator: require("./aggregator.js"), GptHistoryCollector: historyCollector },
  });
  await new Promise((resolve) => setImmediate(resolve));
  intervals[0]();
  await new Promise((resolve) => setImmediate(resolve));
  const started = await new Promise((resolve) => messageListeners[0]({
    type: "gpt-limits:background-check-start", conversationId: "spa-chat", tabId: 55,
    baselineIds: ["baseline"], baselineState: { estimatedTextTokens: 10, historyComplete: true, hasPreviousPage: false },
  }, { tab: { id: 55 } }, resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(started)), { ok: true, started: true });
  for (const sameIdRoute of ["/g/project/c/spa-chat", "/c/spa-chat?cursor=x#fragment"]) {
    pathname = sameIdRoute;
    intervals[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reports.some((message) => message.type === "gpt-limits:background-check-result"), false, `${sameIdRoute} is the same conversation`);
  }
  pathname = "/g/project/c/other-chat";
  intervals[0]();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const result = reports.find((message) => message.type === "gpt-limits:background-check-result");
  assert.equal(result.reason, "navigation");
  assert.deepEqual(cleared, [1], "the temporary-tab route monitor stops when the conversation changes");
});

test("background navigation guard compares conversation IDs across redirects, route changes, query and hash", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const session = { gptLimitsActiveCheckSession: {
    temporaryTabId: 41, phase: "waiting-for-content", startedAt: Date.now(), deadlineAt: Date.now() + 180000,
    phaseDeadlineAt: Date.now() + 20000, started: false, baselineIds: ["baseline-id"],
    baselineState: { estimatedTextTokens: 0, historyComplete: true, hasPreviousPage: false }, closeTab: true,
  } };
  const local = {};
  const updates = [];
  const removed = [];
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener() {} }, getURL: (value) => value },
    storage: {
      local: { async get(key) { return { [key]: local[key] }; }, async set(values) { Object.assign(local, values); } },
      session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, values); }, async remove(key) { delete session[key]; } },
    },
    tabs: {
      onUpdated: { addListener(callback) { updates.push(callback); } }, onRemoved: { addListener() {} },
      async get(_id) { return { id: 41, url: "https://chatgpt.com/c/ABC" }; },
      async remove(id) { removed.push(id); }, async query() { return []; },
    },
    permissions: { async contains() { return true; } },
    alarms: { onAlarm: { addListener() {} }, async create() {}, async clear() {} },
  };
  vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array });
  const observeUrl = async (url, status = undefined) => {
    updates[0](41, { ...(status ? { status } : {}), url }, { id: 41, url });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  for (const route of [
    "https://chatgpt.com/", // Intermediate redirect without an ID is not a changed conversation.
    "https://chatgpt.com/c/ABC?cursor=opaque#section",
    "https://chatgpt.com/g/project-or-gpt/c/ABC?query=1#hash",
    "https://chatgpt.com/c/ABC",
  ]) {
    await observeUrl(route, "complete");
    assert.deepEqual(removed, [], `${route} keeps the temporary check alive`);
  }
  await observeUrl("https://chatgpt.com/g/project-or-gpt/c/XYZ");
  assert.deepEqual(removed, [41]);
  assert.equal(local.gptLimitsBackgroundCheckStatus.reason, "navigation");
  assert.equal(session.gptLimitsActiveCheckSession, undefined);
});

test("optional alarms permission is safe at startup, registers once on grant, and gates temporary-tab creation", async () => {
  const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
  const local = {
    gptLimitsBackgroundMonitoring: true,
    gptLimitsChats: { "optional-alarm-chat": {
      conversationId: "optional-alarm-chat", monitored: true, historyComplete: true,
      hasPreviousPage: false, processedMessageIds: ["known-message"], estimatedTextTokens: 10,
    } },
  };
  const session = {};
  const runtimeListeners = [];
  const addedListeners = [];
  const alarmListeners = [];
  const alarmsApi = { onAlarm: { addListener(listener) { alarmListeners.push(listener); } }, async create() {}, async clear() {} };
  let alarmPermission = false;
  let created = 0;
  let removed = 0;
  const chrome = {
    runtime: { id: "ext", onMessage: { addListener(listener) { runtimeListeners.push(listener); } }, getURL: (value) => value },
    permissions: {
      async contains() { return alarmPermission; },
      onAdded: { addListener(listener) { addedListeners.push(listener); } },
    },
    storage: {
      local: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])); }, async set(values) { Object.assign(local, values); } },
      session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, values); }, async remove(key) { delete session[key]; } },
    },
    tabs: {
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
      async query() { return []; }, async create(options) { created += 1; assert.equal(options.active, false); return { id: 41 }; },
      async update() {}, async sendMessage() { return { ok: true }; }, async remove() { removed += 1; }, async get() { return { id: 41, url: "https://chatgpt.com/c/optional-alarm-chat" }; },
    },
    alarms: undefined,
    notifications: { async create() {} },
  };
  const runWorker = () => vm.runInNewContext(source, { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array });
  runWorker();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtimeListeners.length, 2, "runtime handlers register even when alarms permission is absent");
  assert.equal(alarmListeners.length, 0);
  const noAlarmsListeners = [];
  const noAlarmChrome = {
    ...chrome,
    runtime: { ...chrome.runtime, onMessage: { addListener(listener) { noAlarmsListeners.push(listener); } } },
    permissions: { async contains() { return false; }, onAdded: { addListener() {} } },
    alarms: undefined,
  };
  vm.runInNewContext(source, {
    chrome: noAlarmChrome, GptRiskNotifications: riskNotifications,
    importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array,
  });
  assert.equal(noAlarmsListeners.length, 2, "missing alarms API also leaves runtime messaging available");
  const send = (message, sender = {}) => new Promise((resolve) => {
    let asyncReply = false;
    for (const listener of runtimeListeners) if (listener(message, sender, resolve) === true) asyncReply = true;
    if (!asyncReply) resolve(undefined);
  });
  const denied = await send({ type: "gpt-limits:start-background-check" });
  assert.deepEqual(JSON.parse(JSON.stringify(denied)), { ok: false, reason: "alarm-permission" });
  assert.equal(created, 0, "declining optional permission creates no temporary tab");

  alarmPermission = true;
  chrome.alarms = alarmsApi;
  for (const listener of addedListeners) listener({ permissions: ["alarms"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alarmListeners.length, 1, "grant registers the listener");
  for (const listener of addedListeners) listener({ permissions: ["alarms"] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alarmListeners.length, 1, "repeated grants do not register duplicate listeners");

  const started = await send({ type: "gpt-limits:start-background-check" });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(created, 1);
  assert.equal((await send({ type: "gpt-limits:identify-background-check-tab" }, { tab: { id: 41 } })).active, true);
  assert.equal((await send({ type: "gpt-limits:identify-background-check-tab" }, { tab: { id: 7 } })).active, false);

  alarmListeners.length = 0;
  runWorker(); // Restart with permission already granted.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(alarmListeners.length, 1, "a restarted worker registers the persisted alarm listener");
  session.gptLimitsActiveCheckSession.deadlineAt = Date.now() - 1;
  alarmListeners[0]({ name: "gptLimitsBackgroundCheckDeadline" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removed, 1, "timeout cleanup still closes the owned temporary tab after restart");
});

test("temporary-tab initial capture completes on baseline overlap and preserves complete history", async () => {
  const baseline = mergePage(null, page("temporary-chat", "Background title", [item("baseline-message", "user", 10)], false, true));
  baseline.monitored = true;
  const stored = { gptLimitsChats: { "temporary-chat": baseline } };
  const listeners = {};
  const runtimeListeners = [];
  const reports = [];
  const routeIntervals = [];
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/temporary-chat" },
    addEventListener(type, callback) { listeners[type] = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      id: "ext",
      onMessage: { addListener(callback) { runtimeListeners.push(callback); } },
      async sendMessage(message) { reports.push(message); return message.type === "gpt-limits:identify-background-check-tab" ? { active: true } : { ok: true }; },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => null }, setTimeout, clearTimeout,
    setInterval(callback) { routeIntervals.push(callback); return routeIntervals.length; },
    clearInterval() {},
    globalThis: { GptLimitsAggregator: require("./aggregator.js"), GptHistoryCollector: historyCollector },
  });
  const emit = async (summary) => {
    listeners.message({ source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const send = (message, sender = { id: "ext" }) => new Promise((resolve) => runtimeListeners.at(-1)(message, sender, resolve));
  await send({ type: "gpt-limits:get-current-state" });
  await new Promise((resolve) => setImmediate(resolve));
  routeIntervals[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(reports.some((message) => message.type === "gpt-limits:background-check-ready"), "recognized temporary content tab announces readiness after installing its receiver");
  await emit({ ...page("temporary-chat", "Background title", [item("baseline-message", "user", 100), item("new-message", "assistant", 20)], true, false), capturedAt: 200 });
  const accepted = await send({
    type: "gpt-limits:background-check-start",
    conversationId: "temporary-chat", tabId: 55, startedAt: 100,
    baselineIds: ["baseline-message"],
    baselineState: { estimatedTextTokens: 10, historyComplete: true, hasPreviousPage: false },
  }, { id: "ext" });
  assert.equal(accepted.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reports.at(-1).status, "complete");
  assert.equal(reports.at(-1).overlapFound, true);
  assert.equal(reports.at(-1).newMessages, 1);
  assert.equal(reports.at(-1).pagesLoaded, 1);
  assert.equal(stored.gptLimitsChats["temporary-chat"].messagesCollected, 2);
  assert.equal(stored.gptLimitsChats["temporary-chat"].historyComplete, true);
  assert.equal(stored.gptLimitsChats["temporary-chat"].hasPreviousPage, false);
  assert.equal(JSON.stringify(stored).includes("content text"), false);
});

test("collector replays a pre-start initial capture missed by the content listener and consumes it once", async () => {
  const baseline = mergePage(null, page("replay-background", "Replay background", [item("baseline-replay", "user", 10)], false, true));
  baseline.monitored = true;
  const stored = { gptLimitsChats: { "replay-background": baseline } };
  const listeners = {};
  const runtimeListeners = [];
  const reports = [];
  const replayRequests = [];
  const latest = {
    ...page("replay-background", "Replay background", [item("baseline-replay", "user", 10), item("new-replay", "assistant", 20)], true, false),
    capturedAt: 200,
  };
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/replay-background", href: "https://chatgpt.com/c/replay-background" },
    addEventListener(type, callback) { listeners[type] = callback; },
    postMessage(request) {
      replayRequests.push(request);
      if (request.source !== "gpt-limits-tool-capture-v1:replay-last-capture") return;
      if (request.conversationId !== latest.conversationId || latest.capturedAt < request.startedAt) return;
      listeners.message({ source: window, origin: window.location.origin, data: {
        source: "gpt-limits-tool-capture-v1", summary: latest, captureSequence: 1, replayRequestId: request.requestId,
      } });
    },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); }, async remove() {},
      }, onChanged: { addListener() {} },
    },
    runtime: {
      id: "ext",
      onMessage: { addListener(callback) { runtimeListeners.push(callback); } },
      async sendMessage(message) { reports.push(message); return message.type === "gpt-limits:identify-background-check-tab" ? { active: true } : { ok: true }; },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => null }, setTimeout, clearTimeout,
    globalThis: { GptLimitsAggregator: require("./aggregator.js"), GptHistoryCollector: historyCollector },
  });
  const send = (message) => new Promise((resolve) => runtimeListeners.at(-1)(message, { id: "ext" }, resolve));
  await send({ type: "gpt-limits:get-current-state" });
  const result = await send({
    type: "gpt-limits:background-check-start", conversationId: "replay-background", tabId: 91, startedAt: 100,
    baselineIds: ["baseline-replay"], baselineState: { estimatedTextTokens: 10, historyComplete: true, hasPreviousPage: false },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, started: true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const final = reports.find((message) => message.type === "gpt-limits:background-check-result");
  assert.equal(final.status, "complete");
  assert.equal(final.overlapFound, true);
  assert.equal(final.pagesLoaded, 1, "the initial response counts as one page");
  assert.equal(final.newMessages, 1);
  assert.equal(stored.gptLimitsChats["replay-background"].messagesCollected, 2);
  assert.equal(replayRequests.length, 1);
  listeners.message({ source: window, origin: window.location.origin, data: {
    source: "gpt-limits-tool-capture-v1", summary: latest, captureSequence: 1,
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.gptLimitsChats["replay-background"].messagesCollected, 2, "replayed sequence is not aggregated twice");
  assert.equal(JSON.stringify(stored).includes("private message body"), false, "message content stays out of persisted aggregate state");
});

test("background check rejects an untrusted start sender and waits for a future capture when the buffer is empty", async () => {
  const baseline = mergePage(null, page("future-background", "Future background", [item("baseline-future", "user", 10)], false, true));
  baseline.monitored = true;
  const stored = { gptLimitsChats: { "future-background": baseline } };
  const listeners = {};
  let runtimeListener;
  const reports = [];
  const collectorCalls = [];
  const timers = [];
  const emptyCollector = {
    containsBaselineOverlap: historyCollector.containsBaselineOverlap,
    findScrollableContainers: () => [],
    collectUntilOverlap(options) { collectorCalls.push(options); return new Promise(() => {}); },
  };
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/future-background", href: "https://chatgpt.com/c/future-background" },
    addEventListener(type, callback) { listeners[type] = callback; },
    postMessage() {},
  };
  const chrome = {
    storage: {
      local: { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); }, async set(values) { Object.assign(stored, values); }, async remove() {} },
      onChanged: { addListener() {} },
    },
    runtime: { id: "ext", onMessage: { addListener(callback) { runtimeListener = callback; } }, async sendMessage(message) { reports.push(message); return { ok: true }; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => null },
    setTimeout(callback, delay) {
      if (delay === 150) { queueMicrotask(callback); return 0; }
      timers.push({ callback, delay }); return timers.length;
    }, clearTimeout() {},
    globalThis: { GptLimitsAggregator: require("./aggregator.js"), GptHistoryCollector: emptyCollector },
  });
  const send = (message, senderId = "ext") => new Promise((resolve) => runtimeListener(message, { id: senderId }, resolve));
  await send({ type: "gpt-limits:get-current-state" }, 92);
  const wrongTab = await send({
    type: "gpt-limits:background-check-start", conversationId: "future-background", tabId: 93, startedAt: 100,
    baselineIds: ["baseline-future"],
  }, "untrusted-sender");
  assert.deepEqual(JSON.parse(JSON.stringify(wrongTab)), { ok: false, reason: "not-eligible" });
  const accepted = await send({
    type: "gpt-limits:background-check-start", conversationId: "future-background", tabId: 92, startedAt: 100,
    baselineIds: ["baseline-future"],
  });
  assert.equal(accepted.ok, true);
  assert.equal(collectorCalls.length, 0, "empty buffer keeps waiting for the first future page");
  assert.ok(timers.some((timer) => timer.delay === 30000), "no-capture timeout starts only after the buffer check");
  listeners.message({ source: window, origin: window.location.origin, data: {
    source: "gpt-limits-tool-capture-v1",
    summary: { ...page("future-background", "Future background", [item("baseline-future", "user", 10)], true), capturedAt: 201 },
    captureSequence: 1,
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reports.some((message) => message.type === "gpt-limits:background-check-capture-observed" && message.pagesLoaded === 1), true);
  assert.equal(collectorCalls.length, 0, "future overlap completes without starting a redundant scroll");
});

test("background catch-up adds new IDs until an ID from the original baseline appears", async () => {
  const baseline = mergePage(null, page("catch-up-chat", "Catch up", [item("baseline-a", "user", 5), item("baseline-b", "assistant", 6)], false, true));
  baseline.monitored = true;
  const stored = { gptLimitsChats: { "catch-up-chat": baseline } };
  const listeners = {};
  let runtimeListener;
  const reports = [];
  let collectorOptions;
  let domReadyWaited = false;
  const fakeCollector = {
    containsBaselineOverlap: historyCollector.containsBaselineOverlap,
    async waitForScrollableContainers() {
      await new Promise((resolve) => setImmediate(resolve));
      domReadyWaited = true;
      return { status: "ready", reason: null, containers: [{}] };
    },
    findScrollableContainers: () => [],
    collectUntilOverlap(options) { collectorOptions = options; return new Promise(() => {}); },
  };
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/catch-up-chat" },
    addEventListener(type, callback) { listeners[type] = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      onMessage: { addListener(callback) { runtimeListener = callback; } },
      async sendMessage(message) { reports.push(message); return { ok: true }; },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => ({}) }, setTimeout,
    globalThis: { GptLimitsAggregator: require("./aggregator.js"), GptHistoryCollector: fakeCollector },
  });
  const emit = async (summary) => {
    listeners.message({ source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const send = (message, sender = {}) => new Promise((resolve) => runtimeListener(message, sender, resolve));
  await send({ type: "gpt-limits:get-current-state" });
  await emit({ ...page("catch-up-chat", "Catch up", [item("new-a", "user", 10), item("new-b", "assistant", 12)], true), capturedAt: 200 });
  const accepted = await send({
    type: "gpt-limits:background-check-start", conversationId: "catch-up-chat", tabId: 62, startedAt: 100,
    baselineIds: ["baseline-a", "baseline-b"],
    baselineState: { estimatedTextTokens: 11, historyComplete: true, hasPreviousPage: false },
  }, { tab: { id: 62 } });
  assert.equal(accepted.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof collectorOptions, "object", "no overlap on the initial page starts catch-up scrolling");
  assert.equal(domReadyWaited, true, "catch-up waits for the conversation DOM before starting scroll collection");

  await emit({ ...page("catch-up-chat", "Catch up", [item("new-older", "assistant", 8), item("baseline-a", "user", 50)], true, true), capturedAt: 300 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reports.at(-1).status, "complete");
  assert.equal(reports.at(-1).overlapFound, true);
  assert.equal(reports.at(-1).newMessages, 3);
  assert.equal(reports.at(-1).pagesLoaded, 2);
  assert.equal(stored.gptLimitsChats["catch-up-chat"].messagesCollected, 5);
  assert.equal(stored.gptLimitsChats["catch-up-chat"].historyComplete, true);
  assert.equal(stored.gptLimitsChats["catch-up-chat"].hasPreviousPage, false);
});

test("an exception in content catch-up reports failure so the background can clean up", async () => {
  const baseline = mergePage(null, page("throwing-catch-up", "Throwing catch-up", [item("baseline", "user", 5)], false, true));
  baseline.monitored = true;
  const stored = { gptLimitsChats: { "throwing-catch-up": baseline } };
  const listeners = {};
  let runtimeListener;
  const reports = [];
  const throwingCollector = {
    containsBaselineOverlap: historyCollector.containsBaselineOverlap,
    async waitForScrollableContainers() { return { status: "ready", reason: null, containers: [{}] }; },
    findScrollableContainers: () => [],
    async collectUntilOverlap() { throw new Error("simulated collector failure"); },
  };
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/throwing-catch-up" },
    addEventListener(type, callback) { listeners[type] = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      onMessage: { addListener(callback) { runtimeListener = callback; } },
      async sendMessage(message) { reports.push(message); return { ok: true }; },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => ({}) }, setTimeout,
    globalThis: { GptLimitsAggregator: require("./aggregator.js"), GptHistoryCollector: throwingCollector },
  });
  const emit = async (summary) => {
    listeners.message({ source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const send = (message, sender = {}) => new Promise((resolve) => runtimeListener(message, sender, resolve));
  await send({ type: "gpt-limits:get-current-state" });
  await emit({ ...page("throwing-catch-up", "Throwing catch-up", [item("newer", "assistant", 3)], true), capturedAt: 200 });
  const accepted = await send({
    type: "gpt-limits:background-check-start", conversationId: "throwing-catch-up", tabId: 83, startedAt: 100,
    baselineIds: ["baseline"], baselineState: { estimatedTextTokens: 5, historyComplete: true, hasPreviousPage: false },
  }, { tab: { id: 83 } });
  assert.equal(accepted.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reports.at(-1).type, "gpt-limits:background-check-result");
  assert.equal(reports.at(-1).status, "failed");
  assert.equal(reports.at(-1).reason, "collector-start-exception");
});

test("background-tab risk notifications are suppressed until catch-up succeeds", async () => {
  const baseline = mergePage(null, page("risk-background", "Background risk", [item("baseline-risk", "user", 10)], false, true));
  baseline.monitored = true;
  baseline.riskNotificationLevel = 0;
  const stored = { gptLimitsDesktopRiskNotifications: true, gptLimitsChats: { "risk-background": baseline } };
  const listeners = {};
  let runtimeListener;
  const sent = [];
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/risk-background" },
    addEventListener(type, callback) { listeners[type] = callback; },
  };
  const chrome = {
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])); },
        async set(values) { Object.assign(stored, values); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      onMessage: { addListener(callback) { runtimeListener = callback; } },
      async sendMessage(message) {
        sent.push(message);
        return message.type === "gpt-limits:identify-background-check-tab" ? { active: true } : { ok: true };
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "content.js"), "utf8"), {
    window, chrome, document: { querySelector: () => null }, setTimeout,
    globalThis: {
      GptLimitsAggregator: require("./aggregator.js"),
      GptHistoryCollector: historyCollector,
      GptCalibrationSummary: { buildRiskModel: () => ({ available: true }), assessRisk: (_model, tokens) => ({ level: tokens >= 100 ? "watch" : "unknown" }) },
      GptRiskNotifications: riskNotifications,
    },
  });
  const emit = async (summary) => {
    listeners.message({ source: window, origin: window.location.origin, data: { source: "gpt-limits-tool-capture-v1", summary } });
    await new Promise((resolve) => setImmediate(resolve));
  };
  const send = (message) => new Promise((resolve) => runtimeListener(message, { tab: { id: 77 } }, resolve));
  await send({ type: "gpt-limits:get-current-state" });
  await emit({ ...page("risk-background", "Background risk", [item("baseline-risk", "user", 10), item("growth-risk", "assistant", 200)], true), capturedAt: 200 });
  assert.equal(sent.filter((message) => message.type === "gpt-limits:show-risk-notification").length, 0);
  const accepted = await send({
    type: "gpt-limits:background-check-start", conversationId: "risk-background", tabId: 77, startedAt: 100,
    baselineIds: ["baseline-risk"], baselineState: { estimatedTextTokens: 10, historyComplete: true, hasPreviousPage: false },
  });
  assert.equal(accepted.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const notices = sent.filter((message) => message.type === "gpt-limits:show-risk-notification");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, "Watch");
});

test("continuation response pipeline emits sanitized response-to-page metadata for accepted and parser-rejected responses", async () => {
  const posted = [];
  const payloads = [
    { title: "Private title", conversation_id: "private-chat-id", current_node: "private-node", page_info: { has_previous_page: true, cursor: "private-response-cursor" }, messages: [
      { id: "private-message-id", author: { role: "user" }, create_time: 12, content: { parts: ["private message body"] } },
    ] },
    { title: "Private title", conversation_id: "private-chat-id", current_node: "private-node", page_info: { has_previous_page: true } },
  ];
  const window = {
    location: { href: "https://chatgpt.com/c/private-chat-id", origin: "https://chatgpt.com", pathname: "/c/private-chat-id" },
    postMessage(message) { posted.push(message); },
    fetch: async () => new Response(JSON.stringify(payloads.shift()), { headers: { "content-type": "application/json" } }),
  };
  window.gptLiveResumeCaptureGeneration = "private-generation-token";
  window.gptLiveResumeDocumentIdentity = "private-document-identity";
  const source = fs.readFileSync(path.join(__dirname, "page-hook.js"), "utf8");
  vm.runInNewContext(source, { window, URL, Request, XMLHttpRequest: class {}, Set, String, Date, Promise });
  await window.fetch("https://chatgpt.com/backend-api/conversations/private-chat-id/messages?cursor=private-request-cursor");
  await new Promise((resolve) => setImmediate(resolve));
  await window.fetch("https://chatgpt.com/backend-api/conversations/private-chat-id/messages?cursor=private-request-cursor-2");
  await new Promise((resolve) => setImmediate(resolve));
  const pipelines = posted.map((message) => message.responsePipeline).filter(Boolean);
  assert.equal(pipelines.length, 2);
  assert.equal(pipelines[0].status, 200);
  assert.equal(pipelines[0].requestClass, "conversation_messages");
  assert.equal(pipelines[0].transport, "fetch");
  assert.equal(pipelines[0].payloadRecognized, true);
  assert.equal(pipelines[0].itemCount, 1);
  assert.equal(pipelines[0].hasPreviousPage, true);
  assert.equal(pipelines[0].liveResumeGeneration, "private-generation-token");
  assert.equal(pipelines[0].documentIdentity, "private-document-identity");
  assert.match(pipelines[0].requestCursorFingerprint, /^[a-f0-9]{8}$/);
  assert.match(pipelines[0].responseCursorFingerprint, /^[a-f0-9]{8}$/);
  assert.match(pipelines[0].responsePageFingerprint, /^1:[a-f0-9]{8}$/);
  assert.equal(pipelines[1].rejectionReason, "payload_parse_failed");
  const encodedPipelines = JSON.stringify(pipelines);
  for (const raw of ["private-chat-id", "private-node", "private-message-id", "private-request-cursor", "private-response-cursor", "private title", "private message body"]) {
    assert.equal(encodedPipelines.includes(raw), false, `raw value escaped through response pipeline: ${raw}`);
  }
});
