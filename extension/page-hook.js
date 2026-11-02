(() => {
  "use strict";

  const marker = "gpt-limits-tool-capture-v1";
  const replayMarker = `${marker}:replay-last-capture`;
  let captureSequence = 0;
  let responsePipelineSequence = 0;
  let historyRequestOrdinal = 0;
  let latestSanitizedCapture = null;
  const historyRequestRecords = new Map();
  const firstPassRequestCursors = [];
  let firstPassRequestCount = 0;
  let firstPassResponseCount = 0;
  const firstPassPageRecords = [];
  const firstPassItemIdentities = new Set();
  const firstPassIdentityLimit = 50000;
  let firstPassIdentitySetTruncated = false;
  let firstPassPreviousBounds = null;
  let historyRequestInFlight = 0;
  let historyResponseInFlight = 0;
  const historyTelemetryLimit = 24;
  const internalChannels = new Set([
    "analysis",
    "commentary",
    "justify",
    "confidence",
    "reasoning",
    "tool",
    "tool_call",
    "delegate_summary",
    "juicepred",
  ]);
  const attachmentKeys = {
    image: "images",
    image_url: "images",
    audio: "audio",
    audio_file: "audio",
    audio_url: "audio",
    input_audio: "audio",
    output_audio: "audio",
    video: "video",
    file: "files",
    file_id: "files",
    document: "files",
    spreadsheet: "files",
    attachment: "files",
  };
  const safeStructureKeys = new Set([
    "content_type", "type", "parts", "text_parts", "text", "image", "image_url", "image_asset_pointer",
    "asset_pointer", "file", "file_id", "file_name", "filename", "mime_type", "audio", "audio_file",
    "audio_url", "input_audio", "output_audio", "video", "attachment", "attachments", "document",
    "spreadsheet", "metadata", "width", "height", "size_bytes", "duration", "transcript", "caption",
    "sanitized", "content_references", "image_asset", "audio_asset", "video_asset", "source",
  ]);
  const safeStructureTypes = new Set([
    "text", "multimodal_text", "image", "image_url", "image_asset_pointer", "audio", "audio_file",
    "audio_url", "input_audio", "output_audio", "video", "file", "file_id", "document", "spreadsheet",
    "attachment", "image_asset", "audio_asset", "video_asset", "unknown",
  ]);
  const tokenPieces = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu;

  function conversationIdFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin) return null;
      const match = url.pathname.match(/\/conversation\/([^/]+)/i);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function matchingUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin || /\/stream_status\/?$/i.test(url.pathname)) return false;
      if (/^\/backend-api\/conversation\/init\/?$/i.test(url.pathname)) return false;
      if (/^\/backend-api\/conversations\/batch\/?$/i.test(url.pathname)) return false;
      return (
        /^\/backend-api\/conversations\/[^/]+\/messages\/?$/i.test(url.pathname) ||
        /^\/backend-api\/conversations\/[^/]+\/?$/i.test(url.pathname) ||
        /^\/backend-api\/conversation\/[^/]+\/?$/i.test(url.pathname)
      );
    } catch {
      return false;
    }
  }

  function potentialHistoryUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      return url.origin === window.location.origin && /^\/backend-api\//i.test(url.pathname) &&
        /(conversation|messages|history|chat|thread)/i.test(url.pathname) && !matchingUrl(rawUrl);
    } catch { return false; }
  }

  function paginationConversationId(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin) return null;
      const match = url.pathname.match(/^\/backend-api\/conversations\/([^/]+)\/messages\/?$/i);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function relevantNetworkUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin) return false;
      const pathname = url.pathname;
      const conversationId = currentConversationId();
      return Boolean(
        (conversationId && pathname.includes(conversationId)) ||
        /\/conversation/i.test(pathname) ||
        /^\/backend-api\//i.test(pathname) ||
        (conversationId && pathname.startsWith(`/c/${conversationId}`)),
      );
    } catch {
      return false;
    }
  }

  function isStreamStatusUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      return url.origin === window.location.origin && /\/stream_status\/?$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  function safePath(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      return url.origin === window.location.origin ? url.pathname.slice(0, 500) : "";
    } catch {
      return "";
    }
  }

  function reportCandidate(rawUrl, captureSource) {
    const candidatePath = safePath(rawUrl);
    if (!candidatePath) return;
    window.postMessage(
      { source: marker, candidatePath, candidateSource: captureSource, candidateAt: Date.now() },
      window.location.origin,
    );
  }

  function currentConversationId() {
    try {
      const match = window.location.pathname.match(/\/c\/([^/]+)/i);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  }

  function relativeNow() {
    const value = window.performance?.now?.();
    return Number.isFinite(value) ? value : 0;
  }

  function fingerprint(value, count = null) {
    if (value == null) return null;
    const text = String(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const prefix = Number.isSafeInteger(count) ? `${count}:` : "";
    return `${prefix}${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function historyRequestClass(rawUrl) {
    try {
      const pathname = new URL(rawUrl, window.location.href).pathname;
      if (/^\/backend-api\/conversations\/[^/]+\/messages\/?$/i.test(pathname)) return "conversation_messages";
      if (/^\/backend-api\/(?:conversation|conversations)\/[^/]+\/?$/i.test(pathname)) return "conversation_detail";
    } catch {}
    return "other";
  }

  const cursorKeys = new Set(["cursor", "next_cursor", "before", "after", "page_token", "pagination_token", "continuation_token"]);
  function cursorValueFromObject(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 4) return null;
    for (const [key, child] of Object.entries(value)) {
      if (cursorKeys.has(key.toLowerCase()) && (typeof child === "string" || typeof child === "number")) return child;
    }
    for (const child of Object.values(value)) {
      const nested = cursorValueFromObject(child, depth + 1);
      if (nested !== null) return nested;
    }
    return null;
  }

  function requestCursorFingerprint(rawUrl, body) {
    try {
      const url = new URL(rawUrl, window.location.href);
      for (const key of cursorKeys) {
        const value = url.searchParams.get(key);
        if (value !== null) return fingerprint(value);
      }
    } catch {}
    try {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      return fingerprint(cursorValueFromObject(parsed));
    } catch { return null; }
  }

  function canonicalIdentityFingerprint(value) {
    return typeof value === "string" && value.length > 0 ? fingerprint(value) : null;
  }

  function normalizedEndpointTemplate(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/backend-api/")) return "/other";
      if (/^\/backend-api\/conversations\/[^/]+\/messages\/?$/i.test(url.pathname)) return "/backend-api/conversations/:id/messages";
      if (/^\/backend-api\/(?:conversation|conversations)\/[^/]+\/?$/i.test(url.pathname)) return "/backend-api/conversations/:id";
      return "/backend-api/:other";
    } catch { return "/other"; }
  }

  function responseContentTypeCategory(value) {
    if (typeof value !== "string" || !value.trim()) return "unknown";
    const mediaType = value.split(";", 1)[0].trim().toLowerCase();
    if (mediaType === "application/json" || mediaType.endsWith("+json")) return "json";
    if (mediaType.startsWith("text/")) return "text";
    return "other";
  }

  function responseShape(payload) {
    const topLevelType = payload === null ? "null" : Array.isArray(payload) ? "array" :
      typeof payload === "object" ? "object" : ["string", "number", "boolean"].includes(typeof payload) ? typeof payload : "unknown";
    const safeName = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value) ? value : null;
    const entries = payload && typeof payload === "object" && !Array.isArray(payload) ? Object.entries(payload) : [];
    const topLevelKeyNames = entries.map(([key]) => safeName(key)).filter(Boolean).slice(0, 32);
    const topLevelArrayCounts = entries.filter(([, value]) => Array.isArray(value)).slice(0, 32)
      .map(([key, value]) => ({ key: safeName(key), count: Math.min(100000, value.length) })).filter(item => item.key);
    const pageInfo = payload && typeof payload === "object" ? payload.page_info : null;
    return {
      topLevelType, topLevelKeyNames, topLevelArrayCounts,
      expectedStructure: {
        conversationId: typeof payload?.conversation_id === "string",
        messagesArray: Array.isArray(payload?.messages),
        mappingObject: !!payload?.mapping && typeof payload.mapping === "object" && !Array.isArray(payload.mapping),
        pageInfoObject: !!pageInfo && typeof pageInfo === "object" && !Array.isArray(pageInfo),
        hasPreviousPageBoolean: typeof pageInfo?.has_previous_page === "boolean",
      },
    };
  }

  function makeResponseParseDiagnostic(rawUrl, transport, status, contentType, payload, {
    parserAttempted = false, parserAccepted = false, rejectionReason = "unknown",
    extractedPageCount = 0, extractedMessageCount = null, hasPreviousPage = null,
  } = {}) {
    const endpointTemplate = ["/backend-api/conversations/:id/messages", "/backend-api/conversations/:id", "/backend-api/:other", "/other"].includes(rawUrl) ? rawUrl : normalizedEndpointTemplate(rawUrl);
    const requestClass = endpointTemplate === "/backend-api/:other" || endpointTemplate === "/other" ? "other" : historyRequestClass(rawUrl);
    let safeReason = rejectionReason;
    if (requestClass === "other") safeReason = "endpoint_not_recognized";
    const shape = responseShape(payload);
    return {
      endpointTemplate, transport: transport === "XHR" ? "XHR" : "fetch",
      status: Number.isSafeInteger(status) && status >= 0 && status <= 599 ? status : 0,
      contentTypeCategory: ["json","text","other","unknown"].includes(contentType) ? contentType : responseContentTypeCategory(contentType),
      ...shape, parserAttempted: parserAttempted === true, parserAccepted: parserAccepted === true,
      rejectionReason: ["endpoint_not_recognized", "top_level_shape_changed", "conversation_mapping_missing", "messages_array_missing", "pagination_field_changed", "parser_exception", "parsed_but_empty", "accepted", "http_error", "route_mismatch", "not_history_payload"].includes(safeReason) ? safeReason : "parser_exception",
      extractedPageCount: Math.max(0, Math.min(1, Number.isSafeInteger(extractedPageCount) ? extractedPageCount : 0)),
      extractedMessageCount: Number.isSafeInteger(extractedMessageCount) ? Math.max(0, Math.min(100000, extractedMessageCount)) : null,
      hasPreviousPage: typeof hasPreviousPage === "boolean" ? hasPreviousPage : null,
      pageUpdateCallbackFired: false,
    };
  }

  function parsedResponseDiagnostic(rawUrl, transport, status, contentType, payload, {
    accepted = false, rejectionReason = "unknown", extractedMessageCount = null, hasPreviousPage = null,
  } = {}) {
    return makeResponseParseDiagnostic(rawUrl, transport, status, contentType, payload, {
      parserAttempted: true, parserAccepted: accepted, rejectionReason,
      extractedPageCount: accepted ? 1 : 0, extractedMessageCount, hasPreviousPage,
    });
  }
  window.gptSanitizeHistoryResponseDiagnostic = (rawUrl, transport, status, contentType, payload, options = {}) =>
    makeResponseParseDiagnostic(rawUrl, transport, status, contentType, payload, options);

  function responseMetadata(rawUrl, transport, status, liveResumeGeneration, requestCursor, requestRecord, contentType = null) {
    return {
      requestClass: historyRequestClass(rawUrl),
      endpointTemplate: normalizedEndpointTemplate(rawUrl),
      transport,
      status,
      contentTypeCategory: responseContentTypeCategory(contentType),
      liveResumeGeneration,
      requestCursorFingerprint: requestCursor,
      requestOrdinal: requestRecord?.ordinal ?? null,
      requestOrigin: requestRecord?.origin ?? "unknown",
      requestRecord: requestRecord ?? null,
    };
  }

  function beginHistoryRequest(rawUrl, transport, generation, cursor) {
    if (historyRequestClass(rawUrl) !== "conversation_messages") return null;
    const continuationGeneration = window.gptLiveResumeContinuationGeneration;
    const firstPassGeneration = window.gptLiveResumeFirstPassGeneration;
    const origin = typeof generation !== "string" ? "unknown"
      : generation === continuationGeneration ? "continuation"
      : generation === firstPassGeneration ? "first_pass" : "unknown";
    const record = { ordinal: ++historyRequestOrdinal, origin, transport, generation, requestCursorFingerprint: cursor,
      responseCursorFingerprint: null, pageFingerprint: null, itemSetFingerprint: null, accepted: null,
      temporalRelation: "unknown", hasPreviousPage: null, itemCount: null, completed: false,
      responseCompleted: false, startedAtMs: Math.max(0, Math.round(relativeNow())) };
    historyRequestRecords.set(record.ordinal, record);
    while (historyRequestRecords.size > 128) historyRequestRecords.delete(historyRequestRecords.keys().next().value);
    historyRequestInFlight++;
    if (origin === "first_pass") {
      firstPassRequestCount++;
      firstPassRequestCursors.push({ ordinal: record.ordinal, fingerprint: cursor });
      if (firstPassRequestCursors.length > historyTelemetryLimit) firstPassRequestCursors.shift();
    }
    return record;
  }

  function requestReachedServer(record) {
    if (!record || record.completed) return;
    record.completed = true;
    historyRequestInFlight = Math.max(0, historyRequestInFlight - 1);
  }

  function temporalRelation(bounds, previous) {
    if (!Number.isFinite(bounds?.minimum) || !Number.isFinite(bounds?.maximum)) return "unknown";
    if (!previous) return "first";
    if (!Number.isFinite(previous.minimum) || !Number.isFinite(previous.maximum)) return "unknown";
    return bounds.maximum < previous.minimum || (bounds.minimum < previous.minimum && bounds.maximum <= previous.maximum)
      ? "older" : "not_older";
  }

  function updateHistoryResponseTelemetry(metadata, fields, itemIdentityFingerprints = []) {
    const record = metadata?.requestRecord;
    if (!record || record.responseCompleted) return {};
    record.responseCompleted = true;
    historyResponseInFlight = Math.max(0, historyResponseInFlight - 1);
    record.responseCursorFingerprint = fields.responseCursorFingerprint || null;
    record.pageFingerprint = fields.responsePageFingerprint || null;
    record.itemSetFingerprint = fields.responsePageFingerprint || null;
    record.itemCount = Number.isSafeInteger(fields.itemCount) ? fields.itemCount : null;
    record.hasPreviousPage = typeof fields.hasPreviousPage === "boolean" ? fields.hasPreviousPage : null;
    const bounds = fields.pageActivityBounds;
    record.temporalRelation = temporalRelation(bounds, record.origin === "first_pass" ? firstPassPreviousBounds : null);
    if (record.origin === "first_pass") {
      if (Number.isFinite(bounds?.minimum) && Number.isFinite(bounds?.maximum)) firstPassPreviousBounds = { minimum: bounds.minimum, maximum: bounds.maximum };
      record.identityFingerprints = itemIdentityFingerprints.slice(0, 5000);
      firstPassResponseCount++;
      firstPassPageRecords.push({ record, identities: new Set(record.identityFingerprints) });
      if (firstPassPageRecords.length > historyTelemetryLimit) firstPassPageRecords.shift();
      return {};
    }
    if (record.origin !== "continuation") return {};
    const firstPassCursors = firstPassRequestCursors.filter(item => item.fingerprint && item.fingerprint === record.requestCursorFingerprint);
    const exactPageMatch = !!record.pageFingerprint && firstPassPageRecords.some(item => item.record.pageFingerprint === record.pageFingerprint);
    const continuationItems = new Set(itemIdentityFingerprints);
    const baselineOverlap = [...continuationItems].filter(identity => firstPassItemIdentities.has(identity)).length;
    const allKnown = firstPassIdentitySetTruncated ? null : continuationItems.size > 0 && baselineOverlap === continuationItems.size;
    return {
      requestCursorSeenFirstPass: firstPassCursors.length > 0,
      requestCursorFirstPassMatchOrdinal: firstPassCursors.at(-1)?.ordinal ?? null,
      requestCursorMatchesLastFirstPass: !!record.requestCursorFingerprint && firstPassRequestCursors.at(-1)?.fingerprint === record.requestCursorFingerprint,
      exactFirstPassPageMatch: exactPageMatch,
      baselineIdentityOverlapCount: firstPassIdentitySetTruncated ? null : baselineOverlap,
      baselineIdentitySetCount: firstPassItemIdentities.size,
      allItemsAlreadyKnownBaseline: allKnown,
      newIdentityCount: firstPassIdentitySetTruncated ? null : continuationItems.size - baselineOverlap,
    };
  }

  window.gptRecordHistoryRequestAcceptance = (ordinal, accepted, hasPreviousPage, relation) => {
    const record = Number.isSafeInteger(ordinal) ? historyRequestRecords.get(ordinal) : null;
    if (!record || record.origin !== "first_pass") return false;
    record.accepted = accepted === true;
    if (record.accepted) for (const identity of record.identityFingerprints || []) {
      if (firstPassItemIdentities.size >= firstPassIdentityLimit && !firstPassItemIdentities.has(identity)) { firstPassIdentitySetTruncated = true; break; }
      firstPassItemIdentities.add(identity);
    }
    const pageRecord = firstPassPageRecords.find(item => item.record === record);
    if (pageRecord) pageRecord.accepted = record.accepted;
    if (typeof hasPreviousPage === "boolean") record.hasPreviousPage = hasPreviousPage;
    if (["first", "older", "not_older", "unknown"].includes(relation)) record.temporalRelation = relation;
    return true;
  };

  window.gptCaptureHistoryRequestBoundary = (aggregateBaselineIdentities = null) => {
    let aggregateBaselineIdentityCount = null;
    let aggregateBaselineIdentitySetTruncated = false;
    let aggregateBaselineSource = "unavailable";
    if (Array.isArray(aggregateBaselineIdentities)) {
      firstPassItemIdentities.clear();
      firstPassIdentitySetTruncated = false;
      for (const value of aggregateBaselineIdentities) {
        const identity = canonicalIdentityFingerprint(value);
        if (!identity) continue;
        if (firstPassItemIdentities.size >= firstPassIdentityLimit && !firstPassItemIdentities.has(identity)) {
          firstPassIdentitySetTruncated = true;
          break;
        }
        firstPassItemIdentities.add(identity);
      }
      aggregateBaselineIdentityCount = firstPassItemIdentities.size;
      aggregateBaselineIdentitySetTruncated = firstPassIdentitySetTruncated;
      aggregateBaselineSource = "first_pass_aggregate";
    }
    const pages = firstPassPageRecords.slice(-historyTelemetryLimit).sort((a,b) => a.record.ordinal-b.record.ordinal).map(({ record }) => ({
      ordinal: record.ordinal, requestCursorFingerprint: record.requestCursorFingerprint,
      responseCursorFingerprint: record.responseCursorFingerprint, pageFingerprint: record.pageFingerprint,
      itemSetFingerprint: record.itemSetFingerprint, accepted: record.accepted,
      temporalRelation: record.temporalRelation, hasPreviousPage: record.hasPreviousPage,
    }));
    const lastRequest = [...historyRequestRecords.values()].filter(item => item.origin === "first_pass").at(-1) || null;
    const lastPage = firstPassPageRecords.at(-1)?.record || null;
    const lastAccepted = [...firstPassPageRecords].reverse().find(item => item.record.accepted === true)?.record || null;
    return {
      requestCount: firstPassRequestCount, responseCount: firstPassResponseCount,
      requestInFlightCount: historyRequestInFlight, responseInFlightCount: historyResponseInFlight,
      identitySetTruncated: firstPassIdentitySetTruncated,
      aggregateBaselineSource,
      aggregateBaselineIdentityCount,
      aggregateBaselineIdentitySetTruncated,
      firstPassObservedPageCount: firstPassResponseCount,
      savedPageEntryCount: pages.length,
      lastRequestCursorFingerprint: lastRequest?.requestCursorFingerprint || null,
      lastResponsePageFingerprint: lastPage?.pageFingerprint || null,
      lastAcceptedPageFingerprint: lastAccepted?.pageFingerprint || null,
      lastHasPreviousPage: lastAccepted?.hasPreviousPage ?? lastPage?.hasPreviousPage ?? null,
      pendingRequestOrdinal: lastRequest && !lastRequest.completed ? lastRequest.ordinal : null,
      routeTemplate: /^\/g\/[^/]+\/c\/[^/]+\/?$/.test(location.pathname) ? "/g/<id>/c/<id>"
        : /^\/c\/[^/]+\/?$/.test(location.pathname) ? "/c/<id>" : "unknown",
      documentIdentityPresent: typeof window.gptLiveResumeDocumentIdentity === "string",
      documentGenerationFingerprint: fingerprint(window.gptLiveResumeDocumentIdentity),
      firstPassGenerationPresent: typeof window.gptLiveResumeFirstPassGeneration === "string",
      firstPassGenerationMatches: !!lastRequest && lastRequest.generation === window.gptLiveResumeFirstPassGeneration,
      pages,
    };
  };

  function responseCursorFingerprint(payload) {
    const pageInfo = payload?.page_info;
    return fingerprint(cursorValueFromObject(pageInfo) ?? cursorValueFromObject(payload));
  }

  function responsePageFingerprint(messages) {
    if (!Array.isArray(messages)) return null;
    const ids = messages.map((message) => typeof message?.id === "string" ? message.id : "")
      .filter(Boolean).sort();
    let hash = 2166136261;
    for (const id of ids) {
      for (let index = 0; index < id.length; index++) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      hash ^= 0xff;
      hash = Math.imul(hash, 16777619);
    }
    return `${ids.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function responsePageActivityBounds(messages) {
    if (!Array.isArray(messages)) return { minimum: null, maximum: null };
    const times = messages.map((message) => Number(message?.create_time))
      .filter((value) => Number.isFinite(value) && value > 0);
    return times.length ? { minimum: Math.min(...times), maximum: Math.max(...times) } : { minimum: null, maximum: null };
  }

  function buildResponsePipeline(metadata, fields) {
    if (!metadata) return null;
    const { itemIdentityFingerprints = [], ...safeFields } = fields || {};
    const comparisons = updateHistoryResponseTelemetry(metadata, safeFields, itemIdentityFingerprints);
    return {
      sequence: ++responsePipelineSequence,
      elapsedMs: Math.max(0, Math.round(relativeNow())),
      requestClass: metadata.requestClass,
      transport: metadata.transport,
      status: Number.isSafeInteger(metadata.status) ? metadata.status : 0,
      requestCursorFingerprint: metadata.requestCursorFingerprint || null,
      requestOrdinal: metadata.requestOrdinal,
      requestOrigin: metadata.requestOrigin,
      requestObserved: !!metadata.requestRecord,
      captureSource: typeof fields.captureSource === "string" && ["fetch", "XHR"].includes(fields.captureSource) ? fields.captureSource : metadata.transport,
      responseObserved: true,
      historyRequestsInFlight: historyRequestInFlight,
      pageTemporalRelation: metadata.requestRecord?.temporalRelation || "unknown",
      liveResumeGeneration: metadata.liveResumeGeneration || null,
      documentIdentity: typeof window.gptLiveResumeDocumentIdentity === "string" ? window.gptLiveResumeDocumentIdentity : null,
      ...comparisons,
      ...safeFields,
    };
  }

  function emitResponsePipeline(metadata, fields) {
    const reason = fields?.rejectionReason === "http_error" ? "http_error"
      : fields?.rejectionReason === "route_mismatch" ? "route_mismatch"
      : fields?.rejectionReason === "payload_parse_failed" ? "parser_exception"
      : fields?.rejectionReason === "not_history_payload" ? "top_level_shape_changed" : "parser_exception";
    const diagnostic = fields?.responseParseDiagnostic || makeResponseParseDiagnostic(
      metadata?.endpointTemplate || "/other", metadata?.transport || "fetch", metadata?.status || 0,
      metadata?.contentTypeCategory || null, null,
      { parserAttempted: false, parserAccepted: false, rejectionReason: reason },
    );
    const pipeline = buildResponsePipeline(metadata, { ...fields, responseParseDiagnostic: diagnostic });
    if (!pipeline) return null;
    try { window.postMessage({ source: marker, responsePipeline: pipeline }, window.location.origin); } catch {}
    return pipeline;
  }

  function emitUnrecognizedEndpointDiagnostic(rawUrl, transport, status, contentType, payload = null, parseFailed = false) {
    const metadata = responseMetadata(rawUrl, transport, status, window.gptLiveResumeCaptureGeneration || null, null, null, contentType);
    const diagnostic = makeResponseParseDiagnostic(rawUrl, transport, status, contentType, payload, {
      parserAttempted: false, parserAccepted: false,
      rejectionReason: parseFailed ? "parser_exception" : "endpoint_not_recognized",
    });
    emitResponsePipeline(metadata, {
      payloadRecognized: false, itemCount: null, hasPreviousPage: null,
      responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null,
      routeMatches: false, rejectionReason: parseFailed ? "payload_parse_failed" : "not_history_payload",
      responseParseDiagnostic: diagnostic,
    });
  }

  function safeContentType(value) {
    if (typeof value !== "string") return null;
    const mediaType = value.split(";", 1)[0].trim().toLowerCase();
    return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType) ? mediaType.slice(0, 100) : null;
  }

  function recordResource(rawUrl, initiatorType, details = {}) {
    try {
      const url = new URL(rawUrl, window.location.href);
      const pathname = url.pathname.slice(0, 500);
      const conversationId = currentConversationId();
      const containsConversationId = Boolean(conversationId && pathname.includes(conversationId));
      const chatRoutePath = conversationId && pathname.startsWith(`/c/${conversationId}`);
      if (!containsConversationId && !/\/conversation/i.test(pathname) && !/^\/backend-api\//i.test(pathname) && !chatRoutePath) return;
      const status = Number.isInteger(details.status) && details.status >= 100 && details.status <= 599 ? details.status : null;
      window.postMessage({
        source: marker,
        networkResource: {
          pathname,
          initiatorType: typeof initiatorType === "string" ? initiatorType.slice(0, 40) : "other",
          status,
          contentType: safeContentType(details.contentType),
          startTime: Number.isFinite(details.startTime) ? details.startTime : relativeNow(),
          containsConversationId,
        },
      }, window.location.origin);
    } catch {
      // Resource diagnostics must never affect page requests.
    }
  }

  function observeResourceTiming(entry) {
    if (!entry || typeof entry.name !== "string") return;
    recordResource(entry.name, entry.initiatorType || "other", {
      status: Number.isInteger(entry.responseStatus) ? entry.responseStatus : null,
      contentType: null,
      startTime: entry.startTime,
    });
  }

  try {
    for (const entry of window.performance?.getEntriesByType?.("resource") || []) observeResourceTiming(entry);
    if (typeof PerformanceObserver !== "undefined") {
      const resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) observeResourceTiming(entry);
      });
      resourceObserver.observe({ type: "resource", buffered: true });
    }
  } catch {
    // Resource Timing is optional; fetch/XHR diagnostics continue to work.
  }

  function extractText(value, output) {
    if (typeof value === "string") {
      output.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) extractText(item, output);
      return;
    }
    if (!value || typeof value !== "object") return;

    const type = String(value.content_type || value.type || "").toLowerCase();
    if (["image", "audio", "video", "file", "attachment", "reasoning", "thought"].includes(type)) {
      return;
    }
    if (typeof value.text === "string") output.push(value.text);
    if ("parts" in value) extractText(value.parts, output);
    if ("text_parts" in value) extractText(value.text_parts, output);
  }

  function estimateTokens(text) {
    let total = 0;
    for (const piece of text.match(tokenPieces) || []) {
      if (/^[\p{L}\p{N}_]/u.test(piece)) {
        total += Math.max(1, Math.ceil(Array.from(piece).length / 4));
      } else {
        total += 1;
      }
    }
    return total;
  }

  function countAttachments(message) {
    const counts = { images: 0, audio: 0, video: 0, files: 0 };
    const trace = {
      rawImagePartsDetected: Array.isArray(message.content?.parts)
        ? message.content.parts.filter(isRawImageObject).length
        : 0,
      sanitizedImagePartsPreserved: 0,
      rawMetadataImageAttachments: countRawMetadataImages([
        message.metadata?.attachments,
        message.metadata?.content_references,
      ]),
      sanitizedMetadataImageAttachments: 0,
    };
    const seenObjects = new WeakSet();
    const seenAttachmentIds = new Set();
    const contentPartImageIdentityTypes = new Set();

    function imageType(node) {
      const contentType = String(node.content_type || "").toLowerCase();
      const type = String(node.type || "").toLowerCase();
      return [contentType, type].some((value) =>
        value === "image" || value === "image_url" || value === "image_asset" || value === "image_asset_pointer",
      );
    }

    function attachmentKind(node) {
      // The confirmed ChatGPT image part has this explicit content_type.
      if (String(node.content_type || "").toLowerCase() === "image_asset_pointer") return "images";
      const mimeType = typeof node.mime_type === "string" ? node.mime_type.trim().toLowerCase() : "";
      if (mimeType) {
        if (/^image\/[a-z0-9.+-]+$/.test(mimeType)) return "images";
        // Explicit non-image MIME is stronger than a generic type/dimensions.
        if (imageType(node)) return null;
      }
      const type = String(node.content_type || node.type || "").toLowerCase();
      if (attachmentKeys[type]) return attachmentKeys[type];
      if (imageType(node)) return "images";
      const key = Object.keys(attachmentKeys).find((candidate) => candidate in node);
      return key ? attachmentKeys[key] : null;
    }

    function isRawImageObject(node) {
      if (!node || typeof node !== "object" || Array.isArray(node)) return false;
      const contentType = String(node.content_type || "").toLowerCase();
      const mimeType = typeof node.mime_type === "string" ? node.mime_type.trim().toLowerCase() : "";
      return contentType === "image_asset_pointer" || /^image\/[a-z0-9.+-]+$/.test(mimeType);
    }

    function countRawMetadataImages(roots) {
      let total = 0;
      function scan(node, depth = 0) {
        if (depth > 12 || !node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const child of node) scan(child, depth + 1);
          return;
        }
        const mimeType = typeof node.mime_type === "string" ? node.mime_type.trim().toLowerCase() : "";
        const types = [node.type, node.content_type].filter((value) => typeof value === "string").map((value) => value.toLowerCase());
        if (/^image\/[a-z0-9.+-]+$/.test(mimeType) || types.some((type) =>
          ["image", "image_asset", "image_asset_pointer", "image_url"].includes(type),
        )) {
          total += 1;
          return;
        }
        for (const [key, child] of Object.entries(node)) {
          if (key !== "text" && key !== "filename" && key !== "file_name") scan(child, depth + 1);
        }
      }
      for (const root of roots) scan(root);
      return total;
    }

    function attachmentIdentities(node) {
      const identities = [];
      for (const key of ["file_id", "id", "asset_pointer", "image_asset_pointer", "content_reference"]) {
        const value = node[key];
        if ((typeof value === "string" && value.length > 0) || (typeof value === "number" && Number.isFinite(value))) {
          identities.push({ key, value: String(value) });
        }
      }
      return identities;
    }

    let contentPartImageCount = 0;
    function visit(node, source = "content", depth = 0) {
      if (depth > 12) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item, source, depth + 1);
        return;
      }
      if (!node || typeof node !== "object") return;
      const kind = attachmentKind(node);
      if (kind) {
        const identities = attachmentIdentities(node);
        if (seenObjects.has(node) || identities.some((identity) => seenAttachmentIds.has(identity.value))) return;
        if (source === "metadata" && kind === "images" && contentPartImageCount > 0) {
          // Metadata without an ID, or with only an ID namespace absent from
          // parts, cannot be proven to be a separate image. Prefer parts.
          if (!identities.some((identity) => contentPartImageIdentityTypes.has(identity.key))) return;
        }
        for (const identity of identities) seenAttachmentIds.add(identity.value);
        seenObjects.add(node);
        counts[kind] += 1;
        if (source === "parts" && kind === "images") {
          contentPartImageCount += 1;
          trace.sanitizedImagePartsPreserved += 1;
          for (const identity of identities) contentPartImageIdentityTypes.add(identity.key);
        }
        if (source === "metadata" && kind === "images") trace.sanitizedMetadataImageAttachments += 1;
        return;
      }
      for (const [keyName, child] of Object.entries(node)) {
        if (keyName !== "metadata" && keyName !== "text" && keyName !== "filename" && keyName !== "file_name") {
          visit(child, source, depth + 1);
        }
      }
    }
    visit(message.content?.parts, "parts");
    visit(message.content);
    visit(message.metadata?.attachments, "metadata");
    visit(message.metadata?.content_references, "metadata");
    trace.deduplicatedImagesProduced = counts.images;
    return { counts, trace };
  }

  function safeKeys(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).slice(0, 100).filter((key) => typeof key === "string").map((key) => key.slice(0, 100))
      : [];
  }

  function safeStructureName(value) {
    if (typeof value !== "string") return null;
    const normalized = value.toLowerCase();
    return safeStructureTypes.has(normalized) ? normalized : "other";
  }

  function attachmentStructure(messages) {
    const contentTypes = new Set();
    const partTypes = new Set();
    const partKeys = new Set();
    const metadataKeys = new Set();
    const signals = { image: false, audio: false, video: false, file: false };
    function markType(type) {
      if (attachmentKeys[type] === "images" || type.startsWith("image")) signals.image = true;
      else if (attachmentKeys[type] === "audio") signals.audio = true;
      else if (attachmentKeys[type] === "video") signals.video = true;
      else if (attachmentKeys[type] === "files") signals.file = true;
    }
    function inspect(node, keys, types, depth = 0) {
      if (depth > 8 || !node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) inspect(child, keys, types, depth + 1);
        return;
      }
      const contentType = typeof node.content_type === "string" ? node.content_type.toLowerCase() : "";
      const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
      const mimeType = typeof node.mime_type === "string" ? node.mime_type.toLowerCase() : "";
      if (mimeType.startsWith("image/")) signals.image = true;
      if (contentType) {
        types.add(safeStructureName(contentType));
        markType(contentType);
      }
      if (type) {
        types.add(safeStructureName(type));
        markType(type);
      }
      for (const key of Object.keys(node)) {
        const normalizedKey = key.toLowerCase();
        if (safeStructureKeys.has(normalizedKey)) keys.add(normalizedKey);
        markType(normalizedKey);
        if (normalizedKey !== "text" && normalizedKey !== "filename" && normalizedKey !== "file_name") {
          inspect(node[key], keys, types, depth + 1);
        }
      }
    }
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const content = message.content;
      if (content && typeof content === "object" && !Array.isArray(content) && typeof content.content_type === "string") {
        contentTypes.add(safeStructureName(content.content_type));
      }
      if (Array.isArray(content?.parts)) inspect(content.parts, partKeys, partTypes);
      if (content && typeof content === "object" && message.metadata && typeof message.metadata === "object") {
        inspect(message.metadata, metadataKeys, new Set());
      }
      inspect(content, partKeys, partTypes);
    }
    return {
      contentTypes: [...contentTypes].filter(Boolean).slice(0, 20),
      partTypes: [...partTypes].filter(Boolean).slice(0, 30),
      partKeys: [...partKeys].slice(0, 50),
      metadataKeys: [...metadataKeys].slice(0, 50),
      attachmentSignals: signals,
    };
  }

  function reportDiagnostic(diagnostic) {
    window.postMessage(
      { source: marker, diagnostic: { ...diagnostic, capturedAt: Date.now(), captureSource: diagnostic.captureSource || "unknown" } },
      window.location.origin,
    );
  }

  // The isolated-world content script can start listening after this hook has
  // already observed the initial response. Keep only the latest sanitized page
  // summary so that the temporary background-check tab can request it once.
  if (typeof window.addEventListener === "function") {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const request = event.data;
      if (!request || request.source !== replayMarker || !latestSanitizedCapture) return;
      if (request.conversationId !== latestSanitizedCapture.summary.conversationId) return;
      if (!Number.isSafeInteger(request.startedAt) || latestSanitizedCapture.summary.capturedAt < request.startedAt) return;
      window.postMessage({
        source: marker,
        summary: latestSanitizedCapture.summary,
        captureSequence: latestSanitizedCapture.captureSequence,
        replayRequestId: request.requestId,
      }, window.location.origin);
    });
  }

  function classifyMessage(message) {
    const author = message.author;
    const roleName = author && typeof author === "object" ? String(author.role || "").toLowerCase() : "";
    const role = roleName === "user" ? "user" : roleName === "assistant" ? "assistant" : "other";
    const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
    const channel = String(metadata.channel || "").toLowerCase();
    const messageType = String(metadata.message_type || "").toLowerCase();
    const recipient = String(message.recipient || metadata.recipient || "all").toLowerCase();
    const internal =
      role === "assistant" &&
      (internalChannels.has(channel) || internalChannels.has(messageType) || (recipient && recipient !== "all"));

    const textParts = [];
    if (!internal && role !== "other") extractText(message.content, textParts);
    const attachmentResult = countAttachments(message);
    const createdAt = Number(message.create_time);
    return {
      id: String(message.id),
      role,
      textTokens: estimateTokens(textParts.join("\n")),
      activityTime: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : null,
      attachments: attachmentResult.counts,
      attachmentSources: {
        imageParts: attachmentResult.trace.sanitizedImagePartsPreserved,
        metadataImages: attachmentResult.trace.sanitizedMetadataImageAttachments,
      },
      attachmentTrace: attachmentResult.trace,
    };
  }

  function capture(rawUrl, payload, captureSource, metadata) {
    const responseKeys = safeKeys(payload);
    const messages = payload && typeof payload === "object" ? payload.messages : undefined;
    const firstMessage = Array.isArray(messages) ? messages.find((item) => item && typeof item === "object") : null;
    const candidatePath = safePath(rawUrl);
    const pathConversationId = paginationConversationId(rawUrl);
    const isPaginationResponse = pathConversationId !== null;
    const bodyConversationId = typeof payload?.conversation_id === "string" && payload.conversation_id.length > 0
      ? payload.conversation_id
      : null;
    const conversationId = isPaginationResponse ? pathConversationId : bodyConversationId;
    const hasConversationId = typeof conversationId === "string" && conversationId.length > 0;
    const hasMessages = Array.isArray(messages);
    const pipelineFields = {
      itemCount: Array.isArray(messages) ? messages.length : null,
      hasPreviousPage: typeof payload?.page_info?.has_previous_page === "boolean" ? payload.page_info.has_previous_page : null,
      responseCursorFingerprint: responseCursorFingerprint(payload),
      responsePageFingerprint: responsePageFingerprint(messages),
      itemIdentityFingerprints: Array.isArray(messages) ? messages.map(message => canonicalIdentityFingerprint(message?.id)).filter(Boolean) : [],
      pageActivityBounds: responsePageActivityBounds(messages),
      captureSource,
      payloadRecognized: false,
      routeMatches: hasConversationId && conversationId === currentConversationId(),
      rejectionReason: null,
    };
    const pageInfo = payload && typeof payload === "object" ? payload.page_info : null;
    const parseDiagnostic = (accepted, reason) => parsedResponseDiagnostic(rawUrl, captureSource, metadata?.status || 0,
      metadata?.contentTypeCategory || null, payload, {
        accepted, rejectionReason: reason,
        extractedMessageCount: Array.isArray(messages) ? messages.length : null,
        hasPreviousPage: typeof pageInfo?.has_previous_page === "boolean" ? pageInfo.has_previous_page : null,
      });
    const characteristicCount = [
      typeof payload?.title === "string",
      Object.prototype.hasOwnProperty.call(payload || {}, "current_node"),
      Boolean(payload?.page_info && typeof payload.page_info === "object"),
    ].filter(Boolean).length;
    const diagnostic = {
      captureSource,
      candidatePath,
      responseKeys,
      messageKeys: safeKeys(firstMessage),
      lastResponseMessageCount: Array.isArray(messages) ? messages.length : null,
      conversationId: conversationId ? conversationId.slice(0, 256) : null,
      conversationIdSource: isPaginationResponse ? "pathname" : "response",
      isPaginationResponse,
      title: typeof payload?.title === "string" ? payload.title.slice(0, 500) : null,
      hasPreviousPage: typeof payload?.page_info?.has_previous_page === "boolean" ? payload.page_info.has_previous_page : null,
      hasNextPage: typeof payload?.page_info?.has_next_page === "boolean" ? payload.page_info.has_next_page : null,
      ...(Array.isArray(messages) ? attachmentStructure(messages) : {}),
      error: null,
    };
    if (isPaginationResponse && conversationId !== currentConversationId()) {
      diagnostic.conversationId = conversationId.slice(0, 256);
      diagnostic.error = "pagination response conversation ID does not match the open chat";
      reportDiagnostic(diagnostic);
      pipelineFields.rejectionReason = "route_mismatch";
      pipelineFields.responseParseDiagnostic = parseDiagnostic(false, "route_mismatch");
      emitResponsePipeline(metadata, pipelineFields);
      return;
    }

    if (!hasConversationId || !hasMessages) {
      // A matching path alone is not enough: e.g. {status: ...} is unrelated.
      // Surface an error only when multiple independent response fields strongly
      // identify a conversation payload despite a missing required field.
      if (characteristicCount >= 2) {
        diagnostic.error = !hasConversationId
          ? "conversation-like response is missing conversation_id"
          : "conversation-like response is missing messages field or it is not an array";
        reportDiagnostic(diagnostic);
      }
      pipelineFields.rejectionReason = characteristicCount >= 2 ? "payload_parse_failed" : "not_history_payload";
      pipelineFields.responseParseDiagnostic = parseDiagnostic(false,
        payload?.mapping && typeof payload.mapping === "object" && !Array.isArray(payload.mapping) ? "conversation_mapping_missing" :
        !Array.isArray(messages) ? "messages_array_missing" : "top_level_shape_changed");
      emitResponsePipeline(metadata, pipelineFields);
      return;
    }

    if (payload.messages.some((message) =>
      !message || typeof message !== "object" || message.id == null ||
      (isPaginationResponse && (!message.author || typeof message.author !== "object" || typeof message.author.role !== "string"))
    )) {
      diagnostic.error = isPaginationResponse
        ? "pagination response messages have an unexpected structure (message ID or author role missing)"
        : "conversation response messages have an unexpected structure (message ID missing)";
      reportDiagnostic(diagnostic);
      pipelineFields.rejectionReason = "payload_parse_failed";
      pipelineFields.responseParseDiagnostic = parseDiagnostic(false, "parser_exception");
      emitResponsePipeline(metadata, pipelineFields);
      return;
    }

    const items = [];
    for (const message of payload.messages) {
      if (!message || typeof message !== "object" || message.id == null) continue;
      const id = String(message.id);
      if (id.length === 0 || id.length > 256) continue;
      items.push(classifyMessage(message));
    }

    const attachmentTrace = {
      rawImagePartsDetected: 0,
      sanitizedImagePartsPreserved: 0,
      deduplicatedImagesProduced: 0,
      rawMetadataImageAttachments: 0,
      sanitizedMetadataImageAttachments: 0,
    };
    for (const item of items) {
      for (const key of Object.keys(attachmentTrace)) {
        attachmentTrace[key] += item.attachmentTrace?.[key] || 0;
      }
      delete item.attachmentTrace;
    }

    const capturedAt = Date.now();
    const summary = {
      title: typeof payload.title === "string" ? payload.title.slice(0, 500) : "",
      conversationId: conversationId.slice(0, 256),
      items,
      attachmentTrace,
      isPaginationResponse,
      hasPreviousPage:
        pageInfo && typeof pageInfo.has_previous_page === "boolean" ? pageInfo.has_previous_page : null,
      hasNextPage: pageInfo && typeof pageInfo.has_next_page === "boolean" ? pageInfo.has_next_page : null,
      captureSource,
      responseObserved: true,
      capturedAt,
      ...(typeof metadata?.liveResumeGeneration === "string" ? { liveResumeGeneration: metadata.liveResumeGeneration } : {}),
    };
    const sequence = ++captureSequence;
    summary.captureSequence = sequence;
    summary.sourceLineage = {
      endpointClass: ["conversation_messages", "conversation_detail", "other"].includes(metadata?.requestClass) ? metadata.requestClass : "unknown",
      requestObserved: !!metadata?.requestRecord,
      requestOrigin: ["first_pass", "continuation", "unknown"].includes(metadata?.requestOrigin) ? metadata.requestOrigin : "unknown",
      requestOrdinal: Number.isSafeInteger(metadata?.requestOrdinal) ? metadata.requestOrdinal : null,
      requestCursorFingerprint: /^[a-f0-9]{8}$/.test(metadata?.requestCursorFingerprint || "") ? metadata.requestCursorFingerprint : null,
      generationPresent: typeof metadata?.liveResumeGeneration === "string",
      generationMatchesFirstPass: typeof metadata?.liveResumeGeneration === "string" && metadata.liveResumeGeneration === window.gptLiveResumeFirstPassGeneration,
      captureSource: ["fetch", "XHR"].includes(captureSource) ? captureSource : "unknown",
      elapsedMs: Math.max(0, Math.round(relativeNow())),
    };
    latestSanitizedCapture = { summary, captureSequence: sequence };
    pipelineFields.payloadRecognized = true;
    pipelineFields.rejectionReason = null;
    pipelineFields.responseParseDiagnostic = parseDiagnostic(true, "accepted");
    const pipeline = buildResponsePipeline(metadata, pipelineFields);
    window.postMessage({
      source: marker,
      diagnostic: { ...diagnostic, error: null, capturedAt },
      summary,
      captureSequence: sequence,
      responsePipeline: pipeline,
    }, window.location.origin);
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    let requestUrl = "";
    try { requestUrl = args[0] instanceof Request ? args[0].url : String(args[0]); } catch {}
    const startedAt = relativeNow();
    const liveResumeGeneration = typeof window.gptLiveResumeCaptureGeneration === "string" ? window.gptLiveResumeCaptureGeneration : null;
    const requestCursor = requestCursorFingerprint(requestUrl, args[1]?.body);
    const requestRecord = requestUrl && matchingUrl(requestUrl) ? beginHistoryRequest(requestUrl, "fetch", liveResumeGeneration, requestCursor) : null;
    const candidateHistoryEndpoint = potentialHistoryUrl(requestUrl);
    const metadata = requestRecord || candidateHistoryEndpoint ? responseMetadata(requestUrl, "fetch", 0, liveResumeGeneration, requestCursor, requestRecord) : null;
    const responsePromise = originalFetch.apply(this, args);
    if (requestUrl && relevantNetworkUrl(requestUrl)) {
      responsePromise.then(async (response) => {
        requestReachedServer(requestRecord);
        if (matchingUrl(requestUrl)) reportCandidate(requestUrl, "fetch");
        recordResource(requestUrl, "fetch", { status: response.status, contentType: response.headers?.get?.("content-type"), startTime: startedAt });
        if (!matchingUrl(requestUrl) || isStreamStatusUrl(requestUrl)) {
          if (candidateHistoryEndpoint && !isStreamStatusUrl(requestUrl)) {
            const contentType = response.headers?.get?.("content-type") || null;
            if (!response.ok) { emitUnrecognizedEndpointDiagnostic(requestUrl, "fetch", response.status, contentType); return; }
            response.clone().json().then(payload => emitUnrecognizedEndpointDiagnostic(requestUrl, "fetch", response.status, contentType, payload))
              .catch(() => emitUnrecognizedEndpointDiagnostic(requestUrl, "fetch", response.status, contentType, null, true));
          }
          return;
        }
        if (requestRecord) historyResponseInFlight++;
        const contentType = response.headers?.get?.("content-type") || null;
        const responseMeta = responseMetadata(requestUrl, "fetch", response.status, liveResumeGeneration, requestCursor, requestRecord, contentType);
        if (!response.ok) { emitResponsePipeline(responseMeta, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "http_error" }); return; }
        try {
          if (response.url && new URL(response.url).origin !== window.location.origin) {
            emitResponsePipeline(responseMeta, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "route_mismatch" }); return;
          }
        } catch { emitResponsePipeline(responseMeta, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "route_mismatch" }); return; }
        const responseClone = response.clone();
        return responseClone.json().then(payload => capture(requestUrl, payload, "fetch", responseMeta))
          .catch(() => emitResponsePipeline(responseMeta, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "payload_parse_failed", responseParseDiagnostic:parsedResponseDiagnostic(requestUrl,"fetch",response.status,contentType,null,{accepted:false,rejectionReason:"parser_exception"}) }));
      }).catch(() => {
        requestReachedServer(requestRecord);
        const responseMeta = metadata || responseMetadata(requestUrl, "fetch", 0, liveResumeGeneration, requestCursor, requestRecord);
        emitResponsePipeline(responseMeta, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "request_failed" });
      });
    }
    return responsePromise;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__gptLimitsUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const requestUrl = this.__gptLimitsUrl || "";
    const liveResumeGeneration = typeof window.gptLiveResumeCaptureGeneration === "string" ? window.gptLiveResumeCaptureGeneration : null;
    if (requestUrl && relevantNetworkUrl(requestUrl)) {
      const startedAt = relativeNow(), cursor = requestCursorFingerprint(requestUrl, args[0]);
      const tracksHistory = matchingUrl(requestUrl) && !isStreamStatusUrl(requestUrl);
      const requestRecord = tracksHistory ? beginHistoryRequest(requestUrl, "XHR", liveResumeGeneration, cursor) : null;
      const responseMeta = responseMetadata(requestUrl, "XHR", 0, liveResumeGeneration, cursor, requestRecord);
      const settle = () => requestReachedServer(requestRecord);
      this.addEventListener("load", () => {
        settle();
        if (matchingUrl(requestUrl)) reportCandidate(requestUrl, "XHR");
        let responseContentType = null; try { responseContentType = this.getResponseHeader("content-type"); } catch {}
        recordResource(requestUrl, "xmlhttprequest", { status: this.status, contentType: responseContentType, startTime: startedAt });
        if (!matchingUrl(requestUrl) || isStreamStatusUrl(requestUrl)) {
          if (potentialHistoryUrl(requestUrl) && !isStreamStatusUrl(requestUrl)) {
            if (this.status < 200 || this.status >= 300) { emitUnrecognizedEndpointDiagnostic(requestUrl, "XHR", this.status, responseContentType); return; }
            try {
              const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
              emitUnrecognizedEndpointDiagnostic(requestUrl, "XHR", this.status, responseContentType, payload);
            } catch { emitUnrecognizedEndpointDiagnostic(requestUrl, "XHR", this.status, responseContentType, null, true); }
          }
          return;
        }
        if (requestRecord) historyResponseInFlight++;
        const metadata = responseMetadata(requestUrl, "XHR", this.status, liveResumeGeneration, cursor, requestRecord, responseContentType);
        if (this.status < 200 || this.status >= 300) { emitResponsePipeline(metadata, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "http_error" }); return; }
        try {
          if (this.responseURL && new URL(this.responseURL).origin !== window.location.origin) { emitResponsePipeline(metadata, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "route_mismatch" }); return; }
          const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
          capture(requestUrl, payload, "XHR", metadata);
        } catch { emitResponsePipeline(metadata, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "payload_parse_failed", responseParseDiagnostic:parsedResponseDiagnostic(requestUrl,"XHR",this.status,responseContentType,null,{accepted:false,rejectionReason:"parser_exception"}) }); }
      }, { once: true });
      for (const event of ["error", "timeout", "abort"]) this.addEventListener(event, () => {
        settle(); emitResponsePipeline(responseMeta, { payloadRecognized: false, itemCount: null, hasPreviousPage: null, responseCursorFingerprint: null, responsePageFingerprint: null, pageActivityBounds: null, routeMatches: false, rejectionReason: "request_failed" });
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  window.postMessage(
    { source: marker, hookStatus: "installed", hookInstalledAt: Date.now() },
    window.location.origin,
  );
})();
