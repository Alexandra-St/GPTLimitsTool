(() => {
  "use strict";

  const MESSAGE_SELECTOR = "[data-message-author-role]";
  const FALLBACK_SELECTORS = ["[data-message-author-role]", "[data-conversation-role]", "[data-user-message-bubble]", "[data-chatgpt-agent-turn-start]", "[data-testid^='conversation-turn-']", "article", "[role='article']", "[data-turn]", "[data-author]", "[data-role]", "[aria-label]"];
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "HR"]);
  const INLINE_TAGS = new Set(["STRONG", "B", "EM", "I", "S", "DEL", "CODE", "BR"]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "SVG", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "OPTION", "NAV"]);
  const FILE_EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|rtf|zip|json|md|py|js|ts|html?|xml|yaml|yml)$/i;

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function normalizeFingerprintText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function safePublicLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      const host = url.hostname.toLowerCase();
      if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "openai.com" || host.endsWith(".openai.com")) return null;
      if (/backend-api|attachment|file|download|upload/i.test(url.pathname)) return null;
      if (url.pathname.split("/").some((part) => part.length > 80 || /^[a-f0-9-]{24,}$/i.test(part))) return null;
      return `${url.origin}${url.pathname}`;
    } catch { return null; }
  }

  function isPrivateAttachmentURL(value) {
    try {
      if (/^(?:blob|data|filesystem):/i.test(String(value || ""))) return true;
      const url = new URL(value);
      return /backend-api|attachment|files?|uploads?|download/i.test(url.pathname) || /[?&](?:token|access_token|signature|sig|expires|auth|key|x-amz-[^=]+)=/i.test(url.search);
    } catch { return false; }
  }

  function fileAttachment(element) {
    const tag = String(element?.tagName || "").toUpperCase();
    const href = tag === "A" ? (element.getAttribute?.("href") || "") : "";
    if (href && FILE_EXTENSION.test(href.split(/[?#]/, 1)[0])) return true;
    const marker = `${element.getAttribute?.("data-testid") || ""} ${element.getAttribute?.("data-attachment-type") || ""}`;
    return /(?:file|attachment)/i.test(marker);
  }

  function serializeSafeNode(node) {
    if (!node) return { html: "", text: "" };
    if (node.nodeType === 3) {
      const text = String(node.nodeValue || "");
      return { html: escapeHTML(text), text };
    }
    if (node.nodeType !== 1) return { html: "", text: "" };

    const tag = String(node.tagName || "").toUpperCase();
    if (tag === "IMG") return { html: "<span class=\"attachment\">[Image attachment]</span>", text: "[Image attachment]" };
    if (fileAttachment(node)) return { html: "<span class=\"attachment\">[File attachment]</span>", text: "[File attachment]" };
    if (SKIP_TAGS.has(tag)) {
      if (tag === "BUTTON" && node.querySelector?.("img")) return { html: "<span class=\"attachment\">[Image attachment]</span>", text: "[Image attachment]" };
      return { html: "", text: "" };
    }
    if (node.getAttribute?.("aria-hidden") === "true") return { html: "", text: "" };
    const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    if (style?.display === "none" || style?.visibility === "hidden") return { html: "", text: "" };

    const children = [...(node.childNodes || [])].map(serializeSafeNode);
    const contentHTML = children.map((child) => child.html).join("");
    const contentText = children.map((child) => child.text).join("");

    if (tag === "A") {
      const rawHref = node.getAttribute?.("href") || "";
      if (isPrivateAttachmentURL(rawHref)) {
        const image = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(rawHref);
        const label = image ? "[Image attachment]" : "[File attachment]";
        return { html: `<span class=\"attachment\">${label}</span>`, text: label };
      }
      const href = safePublicLink(rawHref);
      if (href) return { html: `<a href="${escapeHTML(href)}" rel="nofollow noopener noreferrer">${contentHTML}</a>`, text: contentText };
      return { html: contentHTML, text: contentText };
    }
    if (tag === "BR") return { html: "<br>", text: "\n" };
    if (tag === "HR") return { html: "<hr>", text: "\n" };
    if (BLOCK_TAGS.has(tag)) {
      const name = tag.toLowerCase();
      return { html: `<${name}>${contentHTML}</${name}>`, text: `${contentText}${contentText.endsWith("\n") ? "" : "\n"}` };
    }
    if (INLINE_TAGS.has(tag)) {
      const name = tag.toLowerCase();
      return { html: `<${name}>${contentHTML}</${name}>`, text: contentText };
    }
    if (tag === "DIV") return { html: contentHTML, text: `${contentText}${contentText && !contentText.endsWith("\n") ? "\n" : ""}` };
    return { html: contentHTML, text: contentText };
  }

  function messageRole(value) {
    if (value === "user") return "User";
    if (value === "assistant") return "Assistant";
    return "System/Other";
  }

  function isRenderedMessage(element, window) {
    if (!element || element.isConnected === false) return false;
    if (element.getAttribute?.("aria-hidden") === "true") return false;
    const style = window?.getComputedStyle?.(element);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.contentVisibility === "hidden") return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || ((rect.width || 0) > 0 && (rect.height || 0) > 0);
  }

  function queryAll(document, selector) {
    try { return [...new Set(document?.querySelectorAll?.(selector) || [])]; } catch { return []; }
  }

  function normalizeRole(value) {
    const role = String(value || "").trim().toLowerCase();
    if (/^(?:user|you said|вы сказали)(?:\s+(?:message|turn))?:?$/.test(role)) return "User";
    if (/^(?:assistant|chatgpt)(?:\s+(?:message|turn|response|said|сказал|ответил))?:?$/.test(role)) return "Assistant";
    return null;
  }

  function isExcludedConversationRegion(element) {
    for (let node = element; node; node = node.parentElement) {
      if (["NAV", "ASIDE", "FORM", "HEADER", "FOOTER", "TEXTAREA", "INPUT", "BUTTON"].includes(String(node.tagName || "").toUpperCase())) return true;
      if (node.getAttribute?.("contenteditable") === "true") return true;
      if (/(?:composer|sidebar|navigation)/i.test(String(node.getAttribute?.("data-testid") || ""))) return true;
    }
    return false;
  }

  function roleForCandidate(element) {
    if (element.getAttribute?.("data-user-message-bubble") !== null) return "User";
    if (element.getAttribute?.("data-chatgpt-agent-turn-start") !== null) return "Assistant";
    const names = ["data-message-author-role", "data-turn", "data-author", "data-role", "aria-label"];
    names.splice(1, 0, "data-conversation-role");
    for (const name of names) {
      const role = normalizeRole(element.getAttribute?.(name));
      if (role) return role;
    }
    const descendants = queryAll(element.ownerDocument || {}, "[data-message-author-role], [data-turn], [data-author], [data-role], [aria-label]");
    for (const descendant of descendants) {
      if (descendant === element || !element.contains?.(descendant)) continue;
      for (const name of names) {
        const role = normalizeRole(descendant.getAttribute?.(name));
        if (role) return role;
      }
    }
    return null;
  }

  function candidateHasRenderableContent(element) {
    try {
      const body = serializeSafeNode(element);
      return Boolean(body.text.trim() || body.html.trim());
    } catch { return false; }
  }

  function findMessageNodes(document, window) {
    const mains = queryAll(document, "main");
    const inConversation = (element) => !isExcludedConversationRegion(element) &&
      (!mains.length || mains.some((main) => main === element || main.contains?.(element)));
    const explicit = queryAll(document, MESSAGE_SELECTOR).filter((element) =>
      isRenderedMessage(element, window) && inConversation(element) &&
      Boolean(normalizeRole(element.getAttribute?.("data-message-author-role"))) && candidateHasRenderableContent(element));
    const source = explicit.length ? explicit : FALLBACK_SELECTORS.flatMap((selector) => queryAll(document, selector));
    const candidates = [...new Set(source)].filter((element) => isRenderedMessage(element, window) && inConversation(element) &&
      Boolean(roleForCandidate(element)) && candidateHasRenderableContent(element));
    const documentOrder = new Map(queryAll(document, "*").map((element, index) => [element, index]));
    const selected = candidates.filter((element) => {
      let parent = element.parentElement;
      while (parent) {
        if (candidates.includes(parent) && isRenderedMessage(parent, window)) return false;
        parent = parent.parentElement;
      }
      return true;
    });
    return selected.sort((left, right) => (documentOrder.get(left) ?? 0) - (documentOrder.get(right) ?? 0));
  }

  function inspectDOM(document, window) {
    const mains = queryAll(document, "main");
    const messages = findMessageNodes(document, window);
    const diagnosticCandidates = [...new Set([ ...queryAll(document, MESSAGE_SELECTOR), ...FALLBACK_SELECTORS.flatMap((selector) => queryAll(document, selector)), ...queryAll(document, "[data-testid]") ])]
      .filter((element) => !isExcludedConversationRegion(element) && (!mains.length || mains.some((main) => main === element || main.contains?.(element))) && isRenderedMessage(element, window));
    const visibleTextBearingCandidateBlocks = diagnosticCandidates.filter(candidateHasRenderableContent).length;
    const shape = (node) => ({ tag: String(node.tagName || "UNKNOWN").toLowerCase(), classTokenCount: String(node.getAttribute?.("class") || "").trim().split(/\s+/).filter(Boolean).length });
    const mainDirectChildShape = mains.flatMap((main) => [...(main.children || [])].slice(0, 12)).map(shape);
    const elements = queryAll(document, "*").filter((element) => mains.some((main) => main === element || main.contains?.(element)) && !isExcludedConversationRegion(element));
    const signalPriority = (element) => ["data-message-author-role", "data-conversation-role", "data-user-message-bubble", "data-chatgpt-agent-turn-start", "data-turn", "data-author", "data-role", "aria-label", "role"]
      .reduce((score, name, index) => element.getAttribute?.(name) !== null ? score + (10 - index) : score, 0);
    elements.sort((left, right) => signalPriority(right) - signalPriority(left));
    const schema = new Set();
    const semanticCandidateShape = [];
    for (const element of elements) {
      const names = [...(element.attributes || [])].map((attribute) => String(attribute.name || "").toLowerCase())
        .filter((name) => (name.startsWith("data-") || name === "role" || name === "aria-label" || name === "contenteditable") && !/(?:^|[-_])(?:id|url|token|title|text)(?:$|[-_])/i.test(name));
      for (const name of names) schema.add(name);
      if (semanticCandidateShape.length >= 24 || !names.length || !isRenderedMessage(element, window)) continue;
      let textBearing = false;
      try { textBearing = Boolean(String(element.textContent || "").trim()); } catch {}
      if (!textBearing) continue;
      semanticCandidateShape.push({ ...shape(element), attributes: names, inferredRole: roleForCandidate(element) || "unknown" });
    }
    const dataTestIds = queryAll(document, "[data-testid]");
    let testIdConversationLikeCount = 0;
    for (const element of dataTestIds) if (/conversation|turn|message/i.test(String(element.getAttribute?.("data-testid") || ""))) testIdConversationLikeCount += 1;
    return {
      readyState: String(document?.readyState || "unknown"),
      mainCount: mains.length,
      articleLikeCount: queryAll(document, "article").length + queryAll(document, "[role='article']").length,
      explicitAuthorRoleCount: queryAll(document, MESSAGE_SELECTOR).length,
      conversationTurnCount: queryAll(document, "[data-testid^='conversation-turn-']").length,
      roleAriaMetadataCount: queryAll(document, "[role], [aria-label], [data-turn], [data-author], [data-role]").length,
      visibleTextBearingCandidateBlocks,
      validatedMessageCandidateCount: messages.length,
      dataTestIdCount: dataTestIds.length,
      conversationLikeTestIdCount: testIdConversationLikeCount,
      dataTurnCount: queryAll(document, "[data-turn]").length,
      dataConversationRoleCount: queryAll(document, "[data-conversation-role]").length,
      userMessageBubbleCount: queryAll(document, "[data-user-message-bubble]").length,
      assistantTurnStartCount: queryAll(document, "[data-chatgpt-agent-turn-start]").length,
      semanticAttributeNames: [...schema].sort(),
      mainDirectChildShape,
      semanticCandidateShape,
      isTopLevelFrame: Boolean(window && window.top === window),
      chatgptDocument: String(window?.location?.hostname || "").toLowerCase() === "chatgpt.com",
    };
  }

  function findScrollContainer(document, window, messages) {
    if (!messages.length) return null;
    const last = messages[messages.length - 1];
    let ancestor = messages[0].parentElement;
    while (ancestor) {
      if (ancestor === last || ancestor.contains?.(last)) {
        const style = window?.getComputedStyle?.(ancestor);
        const range = (ancestor.scrollHeight || 0) - (ancestor.clientHeight || 0);
        if (range > 1 && (style?.overflowY === "auto" || style?.overflowY === "scroll" || ancestor === document.scrollingElement)) return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    const root = document.scrollingElement || document.documentElement || document.body;
    if (root && (root.scrollHeight || 0) >= (root.clientHeight || 0)) return root;
    return null;
  }

  function snapshotMessages(document, window) {
    const nodes = findMessageNodes(document, window);
    const serialized = nodes.map((element) => {
      const body = serializeSafeNode(element);
      const role = normalizeRole(element.getAttribute?.("data-message-author-role")) || roleForCandidate(element) || messageRole(null);
      return { role, html: body.html, text: body.text.trim() };
    }).filter((message) => message.text || message.html);
    return serialized.map((message, index) => {
      const previous = serialized[index - 1];
      const next = serialized[index + 1];
      const normalized = normalizeFingerprintText(message.text);
      const context = [previous, next].map((item) => item ? `${item.role}:${normalizeFingerprintText(item.text).slice(0, 96)}` : "edge").join("|");
      return { ...message, baseFingerprint: `${message.role}\u001f${normalized}`, fingerprint: `${message.role}\u001f${normalized}\u001f${context}` };
    });
  }

  function scrollMetrics(container) {
    const scrollTop = Math.max(0, Number(container?.scrollTop) || 0);
    const clientHeight = Math.max(0, Number(container?.clientHeight) || 0);
    const scrollHeight = Math.max(clientHeight, Number(container?.scrollHeight) || 0);
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    return { scrollTop, clientHeight, scrollHeight, maxScrollTop };
  }

  function insertNewMessages(ordered, known, current, direction) {
    const baseCounts = new Map();
    for (const message of current) baseCounts.set(message.baseFingerprint, (baseCounts.get(message.baseFingerprint) || 0) + 1);
    const items = current.map((message) => {
      let existingKey = known.has(message.fingerprint) ? message.fingerprint : null;
      if (!existingKey && baseCounts.get(message.baseFingerprint) === 1) {
        const matches = ordered.filter((entry) => entry.baseFingerprint === message.baseFingerprint);
        if (matches.length === 1) existingKey = matches[0].fingerprint;
      }
      return { message, key: existingKey || message.fingerprint, existing: Boolean(existingKey) };
    });
    const traversal = direction === "up" ? [...items].reverse() : items;
    for (const item of traversal) {
      const { message } = item;
      const key = item.key;
      if (item.existing || known.has(key)) continue;
      const originalIndex = items.indexOf(item);
      const findKnown = (indices) => indices.map((index) => items[index]).find((candidate) => candidate && (candidate.existing || known.has(candidate.key)));
      let insertAt = -1;
      if (direction === "up") {
        const next = findKnown(Array.from({ length: items.length - originalIndex - 1 }, (_, offset) => originalIndex + offset + 1));
        if (next) insertAt = ordered.findIndex((entry) => entry.fingerprint === next.key);
        if (insertAt < 0) {
          const previous = findKnown(Array.from({ length: originalIndex }, (_, index) => originalIndex - index - 1));
          if (previous) insertAt = ordered.findIndex((entry) => entry.fingerprint === previous.key) + 1;
        }
        if (insertAt < 0) insertAt = 0;
      } else {
        const previous = findKnown(Array.from({ length: originalIndex }, (_, index) => originalIndex - index - 1));
        if (previous) insertAt = ordered.findIndex((entry) => entry.fingerprint === previous.key) + 1;
        if (insertAt < 0) {
          const next = findKnown(Array.from({ length: items.length - originalIndex - 1 }, (_, offset) => originalIndex + offset + 1));
          if (next) insertAt = ordered.findIndex((entry) => entry.fingerprint === next.key);
        }
        if (insertAt < 0) insertAt = ordered.length;
      }
      ordered.splice(insertAt, 0, { ...message, fingerprint: key });
      known.add(key);
      item.key = key;
      item.existing = true;
    }
  }

  function generatedFilename(date = new Date(), extension = "html") {
    const pad = (value) => String(value).padStart(2, "0");
    return `chat-rescue-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.${extension}`;
  }

  function renderHTML(result) {
    const status = result.status === "rescue_complete" ? "Complete" : "Partial";
    const reason = result.status === "rescue_complete" ? "The beginning and end of the captured history range were reached." : `Partial snapshot · ${escapeHTML(result.reason || result.status)}`;
    const content = (result.messages || []).map((message) => `<article class="message"><h2>${escapeHTML(message.role)}</h2><div class="body">${message.html}</div></article>`).join("\n");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chat Rescue</title><style>body{max-width:860px;margin:2rem auto;padding:0 1rem;color:#202124;font:16px/1.55 system-ui,sans-serif}header{border-bottom:1px solid #dadce0;margin-bottom:1.5rem;padding-bottom:1rem}.meta{color:#5f6368;font-size:.9rem}.message{padding:1rem 0;border-bottom:1px solid #e8eaed}.message h2{font-size:.85rem;color:#5f6368;margin:0 0 .5rem}.body{overflow-wrap:anywhere}pre{overflow:auto;padding:.8rem;background:#f6f8fa;border-radius:6px}code{font-family:ui-monospace,monospace}table{border-collapse:collapse;max-width:100%}th,td{border:1px solid #dadce0;padding:.35rem .55rem}blockquote{border-left:3px solid #dadce0;margin-left:0;padding-left:1rem;color:#5f6368}.attachment{color:#5f6368;font-style:italic}a{color:#1558d6}</style></head><body><header><h1>Chat Rescue</h1><p class="meta">Generated: ${escapeHTML(result.generatedAt || "Unknown")}</p><p><strong>Status: ${status}</strong> · Messages: ${Number(result.messages?.length || 0)}</p><p class="meta">${reason}</p></header>${content}</body></html>`;
  }

  function renderText(result) {
    const status = result.status === "rescue_complete" ? "Complete" : "Partial";
    const messages = (result.messages || []).map((message) => `${message.role}\n${message.text.trim()}`).join("\n\n---\n\n");
    return `Chat Rescue\nGenerated: ${result.generatedAt || "Unknown"}\nStatus: ${status}\nMessages: ${Number(result.messages?.length || 0)}\n\n${messages}`;
  }

  async function collect(options) {
    const {
      document,
      window,
      wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      isCancelled = () => false,
      onProgress = () => {},
      now = () => Date.now(),
      maxSteps = 500,
      maxDurationMs = 300000,
      maxNoProgress = 3,
      stableChecks = 3,
      settleMs = 120,
    } = options;
    const routeAtStart = String(window?.location?.pathname || "");
    const isConversationRoute = /(?:^|\/)c\/[^/]+(?:\/|$)/i.test(routeAtStart);
    if (!isConversationRoute) return { status: "rescue_unsupported_layout", reason: "conversation_route_unavailable", messages: [], restoreSuccess: true, steps: 0 };

    const initialMessages = snapshotMessages(document, window);
    if (!initialMessages.length) return { status: "rescue_unsupported_layout", reason: "message_blocks_unavailable", messages: [], restoreSuccess: true, steps: 0, domDiagnostics: inspectDOM(document, window) };
    const container = findScrollContainer(document, window, findMessageNodes(document, window));
    if (!container) return { status: "rescue_unsupported_layout", reason: "conversation_scroll_container_unavailable", messages: [], restoreSuccess: true, steps: 0 };

    const originalScrollTop = Math.max(0, Number(container.scrollTop) || 0);
    const ordered = [];
    const known = new Set();
    insertNewMessages(ordered, known, initialMessages, "initial");
    const startedAt = now();
    let steps = 0;
    let direction = "up";
    let topProven = false;
    let terminal = null;
    let noProgress = 0;
    let boundarySignature = "";
    let stableAtBoundary = 0;
    let previousMetrics = scrollMetrics(container);

    const sample = (phase) => {
      const current = snapshotMessages(document, window);
      const before = ordered.length;
      insertNewMessages(ordered, known, current, phase);
      const metrics = scrollMetrics(container);
      return { current, metrics, added: ordered.length - before, signature: current.map((message) => message.fingerprint).join("\u001e") };
    };
    const progress = () => {
      const metrics = scrollMetrics(container);
      onProgress({
        capturedUniqueMessages: ordered.length,
        step: steps,
        elapsedMs: Math.max(0, now() - startedAt),
        scrollPercent: metrics.maxScrollTop > 0 ? Math.round((metrics.scrollTop / metrics.maxScrollTop) * 100) : 100,
      });
    };
    const waitForDOMStability = async (phase) => {
      let previous = null;
      let stable = 0;
      let latest = null;
      for (let poll = 0; poll < stableChecks + 3 && steps < maxSteps && now() - startedAt < maxDurationMs; poll += 1) {
        await wait(settleMs);
        latest = sample(phase);
        steps += 1;
        const key = `${latest.metrics.scrollTop}|${latest.metrics.scrollHeight}|${latest.signature}`;
        stable = key === previous && latest.added === 0 ? stable + 1 : 0;
        previous = key;
        progress();
        if (stable >= stableChecks) break;
      }
      return latest;
    };

    try {
      progress();
      while (steps < maxSteps && now() - startedAt < maxDurationMs) {
        if (isCancelled()) { terminal = { status: "rescue_cancelled", reason: "user_cancelled" }; break; }
        if (String(window?.location?.pathname || "") !== routeAtStart) { terminal = { status: "rescue_unsupported_layout", reason: "conversation_route_changed" }; break; }
        const currentSample = sample(direction);
        const { metrics, signature, added } = currentSample;
        steps += 1;
        const atBoundary = direction === "up" ? metrics.scrollTop <= 1 : metrics.scrollTop >= metrics.maxScrollTop - 1;

        if (atBoundary) {
          const key = `${direction}|${metrics.scrollTop}|${metrics.scrollHeight}|${signature}`;
          stableAtBoundary = key === boundarySignature && added === 0 ? stableAtBoundary + 1 : 0;
          boundarySignature = key;
          progress();
          if (stableAtBoundary >= stableChecks) {
            if (direction === "up") {
              topProven = true;
              direction = "down";
              stableAtBoundary = 0;
              boundarySignature = "";
              noProgress = 0;
              continue;
            }
            terminal = { status: "rescue_complete", reason: "top_and_end_reached" };
            break;
          }
          await wait(settleMs);
          continue;
        }

        const beforeTop = metrics.scrollTop;
        const stride = Math.max(120, Math.floor(Math.max(1, metrics.clientHeight) * 0.78));
        const target = direction === "up" ? Math.max(0, beforeTop - stride) : Math.min(metrics.maxScrollTop, beforeTop + stride);
        container.scrollTop = target;
        const afterSample = await waitForDOMStability(direction) || sample(direction);
        const moved = Math.abs(afterSample.metrics.scrollTop - beforeTop) > 1;
        const contentChanged = afterSample.added > 0 || afterSample.signature !== signature || afterSample.metrics.scrollHeight !== metrics.scrollHeight;
        if (moved || contentChanged) noProgress = 0;
        else noProgress += 1;
        previousMetrics = afterSample.metrics;
        progress();
        if (!moved && noProgress >= maxNoProgress && !((direction === "up" && afterSample.metrics.scrollTop <= 1) || (direction === "down" && afterSample.metrics.scrollTop >= afterSample.metrics.maxScrollTop - 1))) {
          terminal = { status: direction === "up" && !topProven ? "rescue_partial_top_unproven" : "rescue_partial_no_progress", reason: "scroll_and_content_stalled" };
          break;
        }
      }
      if (!terminal) {
        terminal = !topProven
          ? { status: "rescue_partial_top_unproven", reason: "safety_limit_before_top" }
          : { status: "rescue_partial_no_progress", reason: "safety_limit_before_end" };
      }
    } catch {
      terminal = { status: "rescue_unsupported_layout", reason: "unexpected_ui_structure" };
    } finally {
      try {
        if (String(window?.location?.pathname || "") === routeAtStart) container.scrollTop = originalScrollTop;
      } catch {}
    }

    const restoreSuccess = String(window?.location?.pathname || "") === routeAtStart && Math.abs((Number(container.scrollTop) || 0) - originalScrollTop) <= 2;
    const result = {
      ...terminal,
      messages: ordered.map(({ role, html, text }) => ({ role, html, text })),
      generatedAt: new Date(now()).toISOString(),
      steps,
      elapsedMs: Math.max(0, now() - startedAt),
      restoreSuccess,
      topProven,
      finalScrollMetrics: previousMetrics ? { scrollTop: previousMetrics.scrollTop, maxScrollTop: previousMetrics.maxScrollTop } : null,
    };
    return result;
  }

  globalThis.GptChatRescue = { collect, escapeHTML, safePublicLink, snapshotMessages, findMessageNodes, inspectDOM, findScrollContainer, renderHTML, renderText, generatedFilename };

  let activeOperation = null;
  let lastResult = null;
  if (globalThis.chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "gpt-limits:rescue:start") {
        if (activeOperation) { sendResponse({ ok: false, reason: "already-running" }); return false; }
        activeOperation = { cancelled: false, status: "collecting", progress: { capturedUniqueMessages: 0, step: 0, elapsedMs: 0, scrollPercent: 0 }, result: null };
        lastResult = null;
        sendResponse({ ok: true, status: "collecting" });
        const operation = activeOperation;
        void collect({ document, window, isCancelled: () => operation.cancelled, onProgress: (value) => { operation.progress = value; } })
          .then((result) => { operation.status = result.status; operation.result = result; lastResult = result; })
          .catch(() => { operation.status = "rescue_unsupported_layout"; operation.result = { status: operation.status, reason: "unexpected_ui_structure", messages: [], restoreSuccess: false }; lastResult = operation.result; })
          .finally(() => { activeOperation = null; });
        return false;
      }
      if (message?.type === "gpt-limits:rescue:cancel") {
        if (!activeOperation) { sendResponse({ ok: false, reason: "not-running" }); return false; }
        activeOperation.cancelled = true;
        sendResponse({ ok: true });
        return false;
      }
      if (message?.type === "gpt-limits:rescue:status") {
        sendResponse(activeOperation
          ? { ok: true, status: activeOperation.status, progress: activeOperation.progress,
            result: activeOperation.result ? { reason: activeOperation.result.reason || null, messageCount: activeOperation.result.messages.length, steps: activeOperation.result.steps, elapsedMs: activeOperation.result.elapsedMs, restoreSuccess: activeOperation.result.restoreSuccess } : null }
          : { ok: true, status: lastResult?.status || "idle", result: lastResult ? { reason: lastResult.reason || null, messageCount: lastResult.messages.length, steps: lastResult.steps, elapsedMs: lastResult.elapsedMs, restoreSuccess: lastResult.restoreSuccess } : null });
        return false;
      }
      if (message?.type === "gpt-limits:rescue:export") {
        if (!lastResult || !["rescue_complete", "rescue_partial_top_unproven", "rescue_partial_no_progress", "rescue_cancelled", "rescue_unsupported_layout"].includes(lastResult.status)) {
          sendResponse({ ok: false, reason: "not-ready" });
          return false;
        }
        sendResponse({ ok: true, html: renderHTML(lastResult), text: renderText(lastResult), filenameBase: generatedFilename(new Date(lastResult.generatedAt)) });
        return false;
      }
      return undefined;
    });
  }
})();
