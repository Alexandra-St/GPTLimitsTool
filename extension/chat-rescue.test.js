"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "rescue.js"), "utf8");

function loadRescue() {
  const context = { console, URL, Date, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "rescue.js" });
  return context.GptChatRescue;
}

class FakeText {
  constructor(value, ownerDocument) { this.nodeType = 3; this.nodeValue = value; this.ownerDocument = ownerDocument; this.parentElement = null; }
}

class FakeElement {
  constructor(tagName, attrs = {}, ownerDocument = null, children = []) {
    this.nodeType = 1; this.tagName = tagName.toUpperCase(); this.attrs = { ...attrs }; this.ownerDocument = ownerDocument;
    this.childNodes = []; this.parentElement = null; this.isConnected = true; this.style = {};
    this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; this.clientWidth = 400;
    this.rect = { top: 0, bottom: 80, left: 0, right: 400, width: 400, height: 80 };
    for (const child of children) this.append(child);
    ownerDocument?.allElements?.push(this);
  }
  append(child) { child.parentElement = this; child.ownerDocument = this.ownerDocument; this.childNodes.push(child); }
  get children() { return this.childNodes.filter((child) => child.nodeType === 1); }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value: String(value) })); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  matches(selector) {
    return selector.split(",").some((part) => {
      const value = part.trim();
      if (value === "*") return true;
      if (!value.startsWith("[")) return this.tagName.toLowerCase() === value.toLowerCase();
      const match = value.match(/^\[([^\]]+)\]$/);
      if (!match) return false;
      const condition = match[1].match(/^([^\^=]+)(\^=|=)?(?:['\"]?([^'\"]*)['\"]?)?$/);
      if (!condition) return false;
      const actual = this.getAttribute(condition[1]);
      if (actual === null) return false;
      if (condition[2] === "^=") return String(actual).startsWith(condition[3] || "");
      if (condition[2] === "=") return String(actual) === (condition[3] || "");
      return true;
    });
  }
  contains(target) { for (let parent = target; parent; parent = parent.parentElement) if (parent === this) return true; return false; }
  getBoundingClientRect() { return typeof this.rect === "function" ? this.rect() : this.rect; }
}

function text(value, doc) { return new FakeText(value, doc); }
function el(doc, tag, attrs, children) { return new FakeElement(tag, attrs, doc, children); }

function fakeConversation({ count = 8, initialScrollTop = null, blockedScroll = false, messageBuilder = null } = {}) {
  const doc = { defaultView: null, documentElement: null, body: null, scrollingElement: null, readyState: "complete", allMessages: [], allElements: [] };
  const win = { location: { pathname: "/c/private-conversation-id", hostname: "chatgpt.com" }, getComputedStyle: (node) => node.style || {} };
  win.top = win;
  doc.defaultView = win;
  const scroll = new FakeElement("main", {}, doc);
  scroll.clientHeight = 200; scroll.clientWidth = 500; scroll.scrollHeight = count * 80; scroll._scrollTop = initialScrollTop === null ? Math.max(0, scroll.scrollHeight - scroll.clientHeight) : initialScrollTop;
  Object.defineProperty(scroll, "scrollTop", { get() { return this._scrollTop; }, set(value) { if (!blockedScroll) this._scrollTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); } });
  doc.scrollingElement = scroll; doc.documentElement = scroll; doc.body = scroll;
  for (let index = 0; index < count; index += 1) {
    const content = messageBuilder ? messageBuilder(index, doc) : [el(doc, "p", {}, [text(`Message ${index}`, doc)])];
    const message = el(doc, "div", { "data-message-author-role": index % 2 ? "assistant" : "user", "data-message-id": `secret-message-${index}` }, content);
    message.rect = () => {
      const top = index * 80 - scroll.scrollTop;
      return { top, bottom: top + 80, left: 0, right: 400, width: 400, height: 80 };
    };
    message.ownerDocument = doc; scroll.append(message); doc.allMessages.push(message);
  }
  doc.querySelectorAll = (selector) => {
    const selectors = selector.split(",").map((value) => value.trim());
    return [...new Set(selectors.flatMap((part) => {
      if (part === "main") return [scroll];
      return doc.allElements.filter((element) => element.matches(part));
    }))];
  };
  return { document: doc, window: win, scroll };
}

async function collect(rescue, dom, overrides = {}) {
  let time = 100000;
  return rescue.collect({
    ...dom,
    wait: async (milliseconds) => { time += milliseconds; overrides.onWait?.(milliseconds); },
    now: () => time,
    settleMs: 10,
    stableChecks: 2,
    maxSteps: 200,
    ...overrides,
  });
}

test("virtualized DOM snapshots deduplicate overlap and preserve chronological message order", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 8, initialScrollTop: 320 });
  const result = await collect(rescue, dom);
  assert.equal(result.status, "rescue_complete");
  assert.deepEqual([...result.messages].map((message) => message.text), Array.from({ length: 8 }, (_, index) => `Message ${index}`));
  assert.equal(new Set(result.messages.map((message) => message.text)).size, 8);
});

test("DOM inspector reports sanitized counts and structure without message text or IDs", () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 3 });
  const diagnostic = rescue.inspectDOM(dom.document, dom.window);
  assert.equal(diagnostic.readyState, "complete");
  assert.equal(diagnostic.mainCount, 1);
  assert.equal(diagnostic.explicitAuthorRoleCount, 3);
  assert.equal(diagnostic.validatedMessageCandidateCount, 3);
  assert.equal(JSON.stringify(diagnostic).includes("Message 0"), false);
  assert.equal(JSON.stringify(diagnostic).includes("secret-message"), false);
  assert.equal(JSON.stringify(diagnostic).includes("private-conversation-id"), false);
});

test("fallback discovers alternating user/assistant conversation-turn fixtures and preserves formatting", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 4 });
  for (const [index, message] of dom.document.allMessages.entries()) {
    message.attrs = { "data-testid": `conversation-turn-${index}`, "data-turn": index % 2 ? "assistant" : "user" };
  }
  const result = await collect(rescue, dom);
  assert.equal(result.messages.length, 4);
  assert.deepEqual([...result.messages].map((message) => message.role), ["User", "Assistant", "User", "Assistant"]);
  assert.deepEqual([...result.messages].map((message) => message.text), ["Message 0", "Message 1", "Message 2", "Message 3"]);
  assert.equal(result.status, "rescue_complete");
});

test("current ChatGPT role markers discover user bubbles and assistant turns without the legacy author attribute", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 4 });
  for (const [index, message] of dom.document.allMessages.entries()) {
    message.attrs = index % 2 === 0 ? { "data-user-message-bubble": "" } : { "data-conversation-role": "assistant", "data-chatgpt-agent-turn-start": "" };
  }
  const result = await collect(rescue, dom);
  assert.deepEqual([...result.messages].map((message) => message.role), ["User", "Assistant", "User", "Assistant"]);
  assert.deepEqual([...result.messages].map((message) => message.text), ["Message 0", "Message 1", "Message 2", "Message 3"]);
  assert.equal(result.status, "rescue_complete");
});

test("fallback assistant fixture retains headings, lists, code, and tables", () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 1 });
  const assistant = dom.document.allMessages[0];
  assistant.attrs = { "data-testid": "conversation-turn-0", "aria-label": "Assistant message" };
  assistant.childNodes = [];
  assistant.append(el(dom.document, "h2", {}, [text("Heading", dom.document)]));
  assistant.append(el(dom.document, "ul", {}, [el(dom.document, "li", {}, [text("Item", dom.document)])]));
  assistant.append(el(dom.document, "pre", {}, [el(dom.document, "code", {}, [text("const answer = 42;", dom.document)])]));
  assistant.append(el(dom.document, "table", {}, [el(dom.document, "tbody", {}, [el(dom.document, "tr", {}, [el(dom.document, "td", {}, [text("Cell", dom.document)])])])]));
  const message = rescue.snapshotMessages(dom.document, dom.window)[0];
  assert.equal(message.role, "Assistant");
  for (const token of ["<h2>Heading</h2>", "<ul>", "<pre>", "<table>"]) assert.ok(message.html.includes(token), token);
});

test("fallback accepts article turn semantics but excludes sidebar and composer candidates", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 2 });
  for (const [index, message] of dom.document.allMessages.entries()) message.attrs = { "data-turn": index ? "assistant" : "user" };
  const sidebar = el(dom.document, "aside", { "data-role": "user", class: "sidebar" }, [el(dom.document, "p", {}, [text("must not capture", dom.document)])]);
  const composer = el(dom.document, "form", { "data-testid": "composer", "data-role": "user" }, [el(dom.document, "p", {}, [text("must not capture", dom.document)])]);
  dom.scroll.append(sidebar); dom.scroll.append(composer);
  dom.scroll.scrollHeight=240;
  const result = await collect(rescue, dom);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages.some((message) => message.text.includes("must not capture")), false);
});

test("empty message discovery remains an explicit unsupported result with safe diagnostics", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 0 });
  const result = await collect(rescue, dom);
  assert.equal(result.status, "rescue_unsupported_layout");
  assert.equal(result.reason, "message_blocks_unavailable");
  assert.equal(result.messages.length, 0);
  assert.equal(result.domDiagnostics.validatedMessageCandidateCount, 0);
});

test("duplicate rendered messages are removed without exporting internal message IDs", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 4, initialScrollTop: 80, messageBuilder: (index, doc) => [el(doc, "p", {}, [text(index === 1 ? "Repeated text" : `Unique ${index}`, doc)])] });
  const result = await collect(rescue, dom);
  assert.ok(result.messages.length <= 4);
  const html = rescue.renderHTML(result);
  assert.equal(html.includes("secret-message"), false);
  assert.equal(html.includes("private-conversation-id"), false);
});

test("the same virtualized message node rendered twice is captured once", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 1, initialScrollTop: 0 });
  dom.scroll.scrollHeight = dom.scroll.clientHeight;
  const single = dom.document.allMessages[0];
  dom.document.querySelectorAll = (selector) => selector === "[data-message-author-role]" ? [single, single] : [];
  const result = await collect(rescue, dom);
  assert.equal(result.status, "rescue_complete");
  assert.equal(result.messages.length, 1);
});

test("sanitizer preserves code, lists, tables, headings, blockquotes, paragraphs, and ordinary public links", () => {
  const rescue = loadRescue(); const doc = { defaultView: { getComputedStyle: () => ({}) } };
  const root = el(doc, "div", { "data-message-author-role": "assistant" }, [
    el(doc, "h2", {}, [text("Heading", doc)]),
    el(doc, "p", {}, [text("Paragraph ", doc), el(doc, "strong", {}, [text("bold", doc)]), el(doc, "a", { href: "https://example.org/guide?private=secret#part" }, [text("link", doc)])]),
    el(doc, "ul", {}, [el(doc, "li", {}, [text("List item", doc)])]),
    el(doc, "blockquote", {}, [el(doc, "p", {}, [text("Quoted", doc)])]),
    el(doc, "pre", {}, [el(doc, "code", {}, [text("const x = 1;\n  return x;", doc)])]),
    el(doc, "table", {}, [el(doc, "tbody", {}, [el(doc, "tr", {}, [el(doc, "td", {}, [text("Cell", doc)])])])]),
  ]);
  const snapshot = rescue.snapshotMessages({ querySelectorAll: () => [root] }, { getComputedStyle: () => ({}) })[0];
  const html = rescue.renderHTML({ status: "rescue_complete", messages: [snapshot], generatedAt: "2026-10-25T10:00:00Z" });
  for (const token of ["<h2>Heading</h2>", "<p>Paragraph", "<strong>bold</strong>", "<ul>", "<blockquote>", "<pre>", "<table>", "href=\"https://example.org/guide\""]) assert.ok(html.includes(token), token);
  assert.equal(html.includes("private=secret"), false);
  assert.equal(html.includes("#part"), false);
});

test("images and files become placeholders; private attachment URLs are not retained", () => {
  const rescue = loadRescue(); const doc = { defaultView: { getComputedStyle: () => ({}) } };
  const root = el(doc, "div", { "data-message-author-role": "user" }, [
    el(doc, "img", { src: "https://files.example.org/private/signed-image?token=secret", alt: "private alt" }, []),
    el(doc, "a", { href: "https://files.example.org/private/document.pdf?signature=secret" }, [text("private.pdf", doc)]),
    el(doc, "a", { href: "blob:https://chatgpt.com/private-object-id" }, [text("temporary file", doc)]),
  ]);
  const snapshot = rescue.snapshotMessages({ querySelectorAll: () => [root] }, { getComputedStyle: () => ({}) })[0];
  const html = rescue.renderHTML({ status: "rescue_complete", messages: [snapshot], generatedAt: "2026-10-25T10:00:00Z" });
  assert.ok(html.includes("[Image attachment]")); assert.equal((html.match(/\[File attachment\]/g) || []).length, 2);
  for (const secret of ["files.example.org", "signed-image", "signature=secret", "private alt", "private-object-id"]) assert.equal(html.includes(secret), false);
});

test("export is self-contained, uses a fixed title, and timestamp-only filenames", () => {
  const rescue = loadRescue();
  const result = { status: "rescue_complete", generatedAt: "2026-10-25T10:00:00.000Z", messages: [{ role: "User", html: "<p>Hello</p>", text: "Hello" }] };
  const html = rescue.renderHTML(result);
  assert.ok(html.startsWith("<!doctype html>")); assert.ok(html.includes("<title>Chat Rescue</title>"));
  assert.equal(/<script|<link[^>]+href|<img[^>]+src/i.test(html), false);
  assert.equal(rescue.generatedFilename(new Date(2026, 9, 25, 9, 7), "html"), "chat-rescue-2026-10-25-0907.html");
  assert.equal(rescue.renderText(result).includes("Hello"), true);
});

test("top proof plus full downward pass produces Complete and restores the initial scroll position", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 7, initialScrollTop: 200 });
  const result = await collect(rescue, dom);
  assert.equal(result.status, "rescue_complete"); assert.equal(result.topProven, true);
  assert.equal(result.restoreSuccess, true); assert.equal(dom.scroll.scrollTop, 200);
});

test("a blocked scroll cannot prove the beginning and returns Partial", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 7, initialScrollTop: 100, blockedScroll: true });
  const result = await collect(rescue, dom, { maxNoProgress: 2 });
  assert.equal(result.status, "rescue_partial_top_unproven");
});

test("repeated no-progress states after top are Partial and user cancellation restores scroll", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 8, initialScrollTop: 0 });
  let waits = 0;
  const result = await collect(rescue, dom, { isCancelled: () => waits >= 3, onWait: () => { waits += 1; } });
  assert.equal(result.status, "rescue_cancelled");
  assert.equal(result.restoreSuccess, true); assert.equal(dom.scroll.scrollTop, 0);
});

test("downward traversal that stops before the end returns Partial", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 8, initialScrollTop: 0, blockedScroll: true });
  const result = await collect(rescue, dom, { maxNoProgress: 2 });
  assert.equal(result.status, "rescue_partial_no_progress");
  assert.equal(result.topProven, true);
});

test("safety limit returns Partial and restores the original position", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 20, initialScrollTop: 300 });
  const result = await collect(rescue, dom, { maxSteps: 1 });
  assert.ok(["rescue_partial_top_unproven", "rescue_partial_no_progress"].includes(result.status));
  assert.equal(result.restoreSuccess, true); assert.equal(dom.scroll.scrollTop, 300);
});

test("missing conversation structure returns the explicit unsupported-layout result", async () => {
  const rescue = loadRescue(); const dom = fakeConversation({ count: 0 });
  const result = await collect(rescue, dom);
  assert.equal(result.status, "rescue_unsupported_layout");
});

test("popup presents warning, start/cancel, progress counts and a cancel control without message text", () => {
  const html = fs.readFileSync(path.join(__dirname, "popup.html"), "utf8");
  const popup = fs.readFileSync(path.join(__dirname, "popup.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  assert.equal(manifest.version_name, "0.2.0-beta");
  for (const phrase of ["Rescue current chat", "Start rescue", "Cancel", "automatically scroll", "may take some time", "Avoid interacting", "result may be Partial"]) assert.ok(html.includes(phrase));
  assert.match(html, /id="rescue-progress-status"/); assert.match(html, /id="cancel-rescue-operation"/);
  assert.match(popup, /capturedUniqueMessages/); assert.match(popup, /gpt-limits:rescue:start/); assert.match(popup, /gpt-limits:rescue:cancel/);
  assert.doesNotMatch(popup, /rescueProgressStatus\.textContent\s*=\s*.*\.text/);
});

test("rescue reads the UI only and does not request APIs or persist captured message text", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  assert.ok(manifest.content_scripts.some((entry) => entry.js.includes("rescue.js")));
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|chrome\.storage|chrome\.cookies|conversationId|data-message-id|location\.(?:href|pathname)\s*=/);
  assert.doesNotMatch(source, /messageText|rawReact|__reactProps|__reactFiber/);
});

test("runtime bridge starts once, exposes progress, supports cancellation, and returns an in-memory export", async () => {
  const dom = fakeConversation({ count: 2, initialScrollTop: 0 });
  dom.scroll.scrollHeight = dom.scroll.clientHeight;
  let listener = null;
  const context = { console, URL, Date, setTimeout, clearTimeout, document: dom.document, window: dom.window,
    chrome: { runtime: { onMessage: { addListener(callback) { listener = callback; } } } } };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "rescue.js" });
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  assert.equal((await send({ type: "gpt-limits:rescue:start" })).status, "collecting");
  assert.equal((await send({ type: "gpt-limits:rescue:start" })).reason, "already-running");
  let status;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    status = await send({ type: "gpt-limits:rescue:status" });
    if (status.status !== "collecting") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(status.status, "rescue_complete");
  assert.equal(status.result.messageCount, 2);
  const artifact = await send({ type: "gpt-limits:rescue:export" });
  assert.equal(artifact.ok, true);
  assert.ok(artifact.html.includes("Message 0"));
  assert.equal(artifact.html.includes("private-conversation-id"), false);
  assert.match(artifact.filenameBase, /^chat-rescue-\d{4}-\d{2}-\d{2}-\d{4}\.html$/);
});
