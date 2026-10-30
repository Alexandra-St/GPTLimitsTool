(() => {
  "use strict";
  if (!window.GptChatRescue || window.GptNativeRescue) return;
  let active = null;
  const send = (value) => {
    try { window.webkit.messageHandlers.nativeRescue.postMessage(value); } catch {}
  };
  const start = (operationId) => {
    if (active) return "already_running";
    if (typeof operationId !== "string") return "operation_id_not_string";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) return "operation_id_invalid_format";
    const operation = { id: operationId, cancelled: false };
    active = operation;
    send({ operationId, type: "started" });
    void window.GptChatRescue.collect({
      document, window,
      isCancelled: () => operation.cancelled,
      onProgress: (progress) => send({ operationId, type: "progress",
        capturedUniqueMessages: Number(progress.capturedUniqueMessages) || 0,
        step: Number(progress.step) || 0,
        elapsedMs: Number(progress.elapsedMs) || 0,
        scrollPercent: Number(progress.scrollPercent) || 0 }),
    }).then((result) => {
      if (active !== operation) return;
      const html = window.GptChatRescue.renderHTML(result);
      const text = window.GptChatRescue.renderText(result);
      send({ operationId, type: "finished", status: result.status, reason: result.reason || null,
        messageCount: result.messages?.length || 0, elapsedMs: result.elapsedMs || 0,
        restoreSuccess: result.restoreSuccess === true, generatedAt: result.generatedAt,
        mainFrame: window.top === window,
        chatgptDocument: String(window.location?.hostname || "").toLowerCase() === "chatgpt.com",
        domDiagnostics: result.domDiagnostics || null,
        html, text });
    }).catch(() => {
      if (active === operation) send({ operationId, type: "failed", status: "rescue_unsupported_layout", reason: "unexpected_ui_structure" });
    }).finally(() => { if (active === operation) active = null; });
    return "started";
  };
  const cancel = (operationId) => {
    if (!active || active.id !== operationId) return "not_running";
    active.cancelled = true;
    return "cancel_requested";
  };
  window.GptNativeRescue = { start, cancel };
})();
