(() => {
  const previewData = window.__GIL_CONTENT_PREVIEW_DATA__ || {};
  const nativeFetch = window.fetch.bind(window);
  const jsonResponse = (payload, status) => new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );

  window.fetch = (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(
      request ? request.url : String(input),
      window.location.href,
    );
    const method = String(
      init.method || request?.method || "GET",
    ).toUpperCase();
    const isPreviewEndpoint = (
      url.origin === window.location.origin
      && url.pathname.startsWith("/api/content/")
    );

    if (!isPreviewEndpoint) return nativeFetch(input, init);
    if (method !== "GET") {
      return Promise.resolve(jsonResponse(
        {error: "GitHub Pages preview is read-only"},
        405,
      ));
    }
    if (!Object.prototype.hasOwnProperty.call(previewData, url.pathname)) {
      return Promise.resolve(jsonResponse(
        {error: `Preview endpoint not exported: ${url.pathname}`},
        404,
      ));
    }
    return Promise.resolve(jsonResponse(previewData[url.pathname], 200));
  };

  const metadata = window.__GIL_CONTENT_PREVIEW_META__ || {};
  const metaTarget = document.getElementById("pagesPreviewMeta");
  if (metaTarget) {
    const generated = metadata.generated_at
      ? new Date(metadata.generated_at).toLocaleString("zh-CN")
      : "未知时间";
    metaTarget.textContent = (
      `真实确定性流水线输出 · ${metadata.commit || "unknown"} · ${generated}`
    );
  }
})();
