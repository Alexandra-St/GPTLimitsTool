(() => {
  "use strict";

  const roles = ["user", "assistant", "other"];
  const attachmentKinds = ["images", "audio", "video", "files"];

  function nonnegativeCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function addCounts(left, right) {
    const sum = nonnegativeCount(left) + nonnegativeCount(right);
    return Number.isSafeInteger(sum) ? sum : Number.MAX_SAFE_INTEGER;
  }

  function emptyAttachmentTrace() {
    return {
      rawImagePartsDetected: 0,
      sanitizedImagePartsPreserved: 0,
      deduplicatedImagesProduced: 0,
      aggregatorImagePartsReceived: 0,
      imagesCounted: 0,
      rawMetadataImageAttachments: 0,
      sanitizedMetadataImageAttachments: 0,
      aggregatorMetadataImageAttachments: 0,
      totalRawImagePartsObserved: 0,
      totalSanitizedImageParts: 0,
      totalDeduplicatedImagesProduced: 0,
      totalAggregatorImagePartsReceived: 0,
      totalImagesAccepted: 0,
      imageBearingResponsesObserved: 0,
      imageBearingUniqueMessagesObserved: 0,
      totalRawMetadataImageAttachments: 0,
      totalSanitizedMetadataImageAttachments: 0,
      totalAggregatorMetadataImageAttachments: 0,
    };
  }

  function emptyState(conversationId, title) {
    return {
      conversationId,
      title,
      processedMessageIds: [],
      messagesCollected: 0,
      userMessages: 0,
      assistantMessages: 0,
      otherMessages: 0,
      estimatedTextTokens: 0,
      attachments: { images: 0, audio: 0, video: 0, files: 0 },
      attachmentTrace: emptyAttachmentTrace(),
      hasPreviousPage: null,
      hasNextPage: null,
      historyComplete: false,
      responsesCaptured: 0,
      updatedAt: null,
    };
  }

  function isValidState(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        typeof value.conversationId === "string" &&
        Array.isArray(value.processedMessageIds) &&
        value.attachments &&
        typeof value.attachments === "object",
    );
  }

  function mergePage(currentState, page) {
    if (!page || typeof page.conversationId !== "string" || !Array.isArray(page.items)) {
      throw new TypeError("Invalid conversation page summary");
    }
    const state =
      isValidState(currentState) && currentState.conversationId === page.conversationId
        ? JSON.parse(JSON.stringify(currentState))
        : emptyState(page.conversationId, "");

    if (typeof page.title === "string" && page.title.trim().length > 0) {
      state.title = page.title.slice(0, 500);
    }
    const receivedImageParts = page.items.reduce((total, item) =>
      total + (Number.isSafeInteger(item?.attachmentSources?.imageParts) && item.attachmentSources.imageParts > 0
        ? item.attachmentSources.imageParts
        : 0), 0);
    const receivedMetadataImages = page.items.reduce((total, item) =>
      total + (Number.isSafeInteger(item?.attachmentSources?.metadataImages) && item.attachmentSources.metadataImages > 0
        ? item.attachmentSources.metadataImages
        : 0), 0);
    let imagesCounted = 0;
    let imageBearingUniqueMessages = 0;
    const seen = new Set(state.processedMessageIds);
    for (const item of page.items) {
      if (!item || typeof item.id !== "string" || item.id.length === 0 || item.id.length > 256) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      state.processedMessageIds.push(item.id);
      state.messagesCollected += 1;

      const role = roles.includes(item.role) ? item.role : "other";
      if (role === "user") state.userMessages += 1;
      else if (role === "assistant") state.assistantMessages += 1;
      else state.otherMessages += 1;

      if (Number.isSafeInteger(item.textTokens) && item.textTokens > 0) {
        state.estimatedTextTokens += item.textTokens;
      }
      const itemImageParts = nonnegativeCount(item.attachmentSources?.imageParts);
      const itemMetadataImages = nonnegativeCount(item.attachmentSources?.metadataImages);
      const itemFinalImages = nonnegativeCount(item.attachments?.images);
      if (itemImageParts > 0 || itemMetadataImages > 0 || itemFinalImages > 0) {
        imageBearingUniqueMessages += 1;
      }
      for (const kind of attachmentKinds) {
        const count = item.attachments?.[kind];
        if (Number.isSafeInteger(count) && count > 0) {
          state.attachments[kind] += count;
          if (kind === "images") imagesCounted += count;
        }
      }
    }

    const pageTrace = page.attachmentTrace && typeof page.attachmentTrace === "object" ? page.attachmentTrace : {};
    const rawImagePartsDetected = nonnegativeCount(pageTrace.rawImagePartsDetected);
    const sanitizedImagePartsPreserved = nonnegativeCount(pageTrace.sanitizedImagePartsPreserved);
    const rawMetadataImageAttachments = nonnegativeCount(pageTrace.rawMetadataImageAttachments);
    const sanitizedMetadataImageAttachments = nonnegativeCount(pageTrace.sanitizedMetadataImageAttachments);
    const deduplicatedImagesProduced = Number.isSafeInteger(pageTrace.deduplicatedImagesProduced)
      ? nonnegativeCount(pageTrace.deduplicatedImagesProduced)
      : page.items.reduce((total, item) => addCounts(total, item?.attachments?.images), 0);
    const imageBearingResponse =
      rawImagePartsDetected > 0 || sanitizedImagePartsPreserved > 0 || receivedImageParts > 0 ||
      rawMetadataImageAttachments > 0 || sanitizedMetadataImageAttachments > 0 || receivedMetadataImages > 0 ||
      imagesCounted > 0;
    const previousTrace = state.attachmentTrace && typeof state.attachmentTrace === "object"
      ? state.attachmentTrace
      : emptyAttachmentTrace();
    state.attachmentTrace = {
      rawImagePartsDetected,
      sanitizedImagePartsPreserved,
      deduplicatedImagesProduced,
      aggregatorImagePartsReceived: receivedImageParts,
      imagesCounted,
      rawMetadataImageAttachments,
      sanitizedMetadataImageAttachments,
      aggregatorMetadataImageAttachments: receivedMetadataImages,
      totalRawImagePartsObserved: addCounts(previousTrace.totalRawImagePartsObserved, rawImagePartsDetected),
      totalSanitizedImageParts: addCounts(previousTrace.totalSanitizedImageParts, sanitizedImagePartsPreserved),
      totalDeduplicatedImagesProduced: addCounts(previousTrace.totalDeduplicatedImagesProduced, deduplicatedImagesProduced),
      totalAggregatorImagePartsReceived: addCounts(previousTrace.totalAggregatorImagePartsReceived, receivedImageParts),
      totalImagesAccepted: addCounts(previousTrace.totalImagesAccepted, imagesCounted),
      imageBearingResponsesObserved: addCounts(previousTrace.imageBearingResponsesObserved, imageBearingResponse ? 1 : 0),
      imageBearingUniqueMessagesObserved: addCounts(previousTrace.imageBearingUniqueMessagesObserved, imageBearingUniqueMessages),
      totalRawMetadataImageAttachments: addCounts(previousTrace.totalRawMetadataImageAttachments, rawMetadataImageAttachments),
      totalSanitizedMetadataImageAttachments: addCounts(previousTrace.totalSanitizedMetadataImageAttachments, sanitizedMetadataImageAttachments),
      totalAggregatorMetadataImageAttachments: addCounts(previousTrace.totalAggregatorMetadataImageAttachments, receivedMetadataImages),
    };

    if (typeof page.hasPreviousPage === "boolean") {
      if (page.hasPreviousPage === false) {
        state.hasPreviousPage = false;
        if (page.isPaginationResponse === true) state.historyComplete = true;
      } else if (state.hasPreviousPage !== false) {
        state.hasPreviousPage = true;
      }
    }
    if (typeof page.hasNextPage === "boolean") state.hasNextPage = page.hasNextPage;
    state.responsesCaptured = (Number.isSafeInteger(state.responsesCaptured) ? state.responsesCaptured : 0) + 1;
    state.updatedAt = Number.isFinite(page.capturedAt) ? page.capturedAt : Date.now();
    return state;
  }

  const api = { emptyState, isValidState, mergePage };
  globalThis.GptLimitsAggregator = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
