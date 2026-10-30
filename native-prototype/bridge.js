(() => {
  if (location.origin !== 'https://chatgpt.com') return;
  let aggregate = null, timer = null, attempts = 0, lastEndpoint = '';
  const safeEndpoint = value => {
    if (typeof value !== 'string') return '';
    const path = value.split(/[?#]/, 1)[0];
    if (/^\/backend-api\/conversations\/[^/]+(?:\/messages)?\/?$/.test(path))
      return path.replace(/^\/backend-api\/conversations\/[^/]+/, '/backend-api/conversations/<id>');
    if (/^\/backend-api\/conversation\/[^/]+\/?$/.test(path))
      return path.replace(/^\/backend-api\/conversation\/[^/]+/, '/backend-api/conversation/<id>');
    return '';
  };
  const id = () => location.pathname.match(/\/(?:c)\/([^/]+)\/?$/)?.[1] || null;
  const emit = (status) => {
    const s = aggregate;
    // Explicit allowlist: no message IDs, content, pointers or diagnostic payloads cross into Swift.
    window.webkit.messageHandlers.summary.postMessage({
      status, title: s?.title || '', messages: s?.messagesCollected || 0,
      user: s?.userMessages || 0, assistant: s?.assistantMessages || 0, other: s?.otherMessages || 0,
      tokens: s?.estimatedTextTokens || 0, images: s?.attachments?.images || 0,
      audio: s?.attachments?.audio || 0, video: s?.attachments?.video || 0,
      files: s?.attachments?.files || 0,
      history: s?.historyComplete === true ? 'Complete' : s?.hasPreviousPage === true ? 'Partial' : 'Unknown',
      endpoint: lastEndpoint
    });
  };
  const stop = () => { clearInterval(timer); timer = null; };
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'gpt-limits-tool-capture-v1') return;
    if (event.data.hookStatus === 'installed') emit('Hook installed; waiting for conversation response');
    const page = event.data.summary;
    const endpoint = safeEndpoint(event.data.diagnostic?.candidatePath);
    if (endpoint) lastEndpoint = endpoint;
    if (!page || page.conversationId !== id() || !Array.isArray(page.items)) return;
    aggregate = GptLimitsAggregator.mergePage(aggregate, page);
    emit('Passive capture received');
    if (aggregate.historyComplete) stop();
  });
  // Prototype only: explicit Check chat enables bounded DOM scrolling; no requests are issued here.
  if (sessionStorage.getItem('gpt-limits-prototype-check') === id() && id()) {
    sessionStorage.removeItem('gpt-limits-prototype-check');
    const expected = id();
    timer = setInterval(() => {
      if (id() !== expected) { stop(); emit('Stopped: conversation changed'); return; }
      if (++attempts > 12) { stop(); emit('Check ended: safety timeout; completeness unconfirmed'); return; }
      if (aggregate?.historyComplete) { stop(); emit('Complete'); return; }
      const container = GptHistoryCollector.findScrollableContainer(document, window);
      if (container) { container.scrollTop = 0; emit('Checking: waiting for natural pagination'); }
    }, 5000);
  }
  window.addEventListener('pagehide', stop);
})();
