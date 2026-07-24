(function () {
  'use strict';
  if (window.__CASHTOP_DOWNLOAD_FIX__) return;
  window.__CASHTOP_DOWNLOAD_FIX__ = true;

  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const isDownload = this.hasAttribute('download') || String(this.download || '').length > 0;
    if (!isDownload || this.isConnected || !document.body) {
      return nativeAnchorClick.call(this);
    }
    const oldStyle = this.getAttribute('style');
    this.style.position = 'fixed';
    this.style.left = '-99999px';
    this.style.top = '-99999px';
    this.style.width = '1px';
    this.style.height = '1px';
    this.style.opacity = '0';
    document.body.appendChild(this);
    try {
      return nativeAnchorClick.call(this);
    } finally {
      setTimeout(() => {
        try { this.remove(); } catch (_) {}
        if (oldStyle == null) this.removeAttribute('style'); else this.setAttribute('style', oldStyle);
      }, 1500);
    }
  };

  // بعض صفحات النظام تلغي Blob URL مباشرة بعد الضغط. أعطِ المتصفح وقتاً
  // كافياً لبدء التنزيل، خصوصاً داخل PWA وSafari/Android WebView.
  const nativeRevoke = URL.revokeObjectURL ? URL.revokeObjectURL.bind(URL) : null;
  if (nativeRevoke) {
    URL.revokeObjectURL = function (url) {
      setTimeout(() => {
        try { nativeRevoke(url); } catch (_) {}
      }, 5000);
    };
  }

  function saveBlob(blob, filename) {
    if (!(blob instanceof Blob)) blob = new Blob([blob]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `download_${Date.now()}`;
    a.rel = 'noopener';
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  function saveDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename || `download_${Date.now()}`;
    a.rel = 'noopener';
    a.click();
    return true;
  }

  window.CashtopDownloads = Object.assign(window.CashtopDownloads || {}, { saveBlob, saveDataUrl });
})();
