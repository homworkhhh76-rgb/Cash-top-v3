(function () {
  'use strict';

  const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const scriptPromises = new Map();

  function cleanText(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function safeFileName(value) {
    return cleanText(value || 'تقرير')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 140) || 'تقرير';
  }

  function normalizeOrientation(value) {
    return /^(l|landscape)$/i.test(String(value || '')) ? 'landscape' : 'portrait';
  }

  function ensureScript(src, readyCheck) {
    if (readyCheck()) return Promise.resolve();
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const promise = new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find(script => script.src === src);
      if (existing) {
        if (readyCheck()) return resolve();
        existing.addEventListener('load', () => readyCheck() ? resolve() : reject(new Error(`تعذر تهيئة المكتبة: ${src}`)), { once: true });
        existing.addEventListener('error', () => reject(new Error(`تعذر تحميل المكتبة: ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => readyCheck() ? resolve() : reject(new Error(`تعذر تهيئة المكتبة: ${src}`));
      script.onerror = () => reject(new Error(`تعذر تحميل المكتبة: ${src}`));
      document.head.appendChild(script);
    });
    scriptPromises.set(src, promise);
    return promise;
  }

  async function ensurePdfLibraries() {
    await ensureScript(HTML2CANVAS_URL, () => typeof window.html2canvas === 'function');
    await ensureScript(JSPDF_URL, () => Boolean(window.jspdf?.jsPDF));
  }

  async function waitForFonts() {
    if (!document.fonts?.ready) return;
    await Promise.race([
      document.fonts.ready.catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 1200))
    ]);
  }

  function pagePixelSize(orientation) {
    return orientation === 'landscape'
      ? { width: 1123, height: 794 }
      : { width: 794, height: 1123 };
  }

  function createRenderHost(width) {
    const host = document.createElement('div');
    host.className = 'ct-fast-export-render-host';
    host.style.cssText = [
      'position:fixed',
      'left:-120000px',
      'top:0',
      'z-index:-2147483647',
      `width:${Math.max(320, width)}px`,
      'background:#ffffff',
      'direction:rtl',
      "font-family:'Cairo',Tahoma,Arial,sans-serif",
      'pointer-events:none',
      'opacity:1'
    ].join(';');
    document.body.appendChild(host);
    return host;
  }

  function removeInteractiveUi(root) {
    root.querySelectorAll([
      '.actions-wrapper', '.export-group', '.history-export-actions', '.modal-close',
      '[data-no-export]', 'button', 'input', 'select', 'textarea'
    ].join(',')).forEach(node => node.remove());
  }

  function forceVisible(root) {
    root.removeAttribute?.('hidden');
    root.style.setProperty('display', 'block', 'important');
    root.style.setProperty('visibility', 'visible', 'important');
    root.style.setProperty('opacity', '1', 'important');
    root.style.setProperty('position', 'static', 'important');
    root.style.setProperty('left', 'auto', 'important');
    root.style.setProperty('right', 'auto', 'important');
    root.style.setProperty('top', 'auto', 'important');
    root.style.setProperty('bottom', 'auto', 'important');
    root.style.setProperty('transform', 'none', 'important');
    root.style.setProperty('z-index', 'auto', 'important');
    root.style.setProperty('max-height', 'none', 'important');
    root.style.setProperty('overflow', 'visible', 'important');
  }

  async function renderCanvas(element, options = {}) {
    await ensurePdfLibraries();
    await waitForFonts();
    const width = Math.max(320, Math.ceil(element.scrollWidth || element.getBoundingClientRect().width || options.width || 794));
    const height = Math.max(200, Math.ceil(element.scrollHeight || element.getBoundingClientRect().height || options.height || 1123));
    const scale = Number(options.scale) || Math.min(2, Math.max(1.55, Number(window.devicePixelRatio) || 1));
    return window.html2canvas(element, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: 4000,
      removeContainer: true,
      width,
      height,
      windowWidth: Math.max(width, options.windowWidth || width),
      windowHeight: Math.max(height, options.windowHeight || height),
      scrollX: 0,
      scrollY: 0
    });
  }

  function createPdf(orientation, format = 'a4') {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation, unit: 'mm', format, compress: true });
  }

  function addCanvasToPdf(doc, canvas, options = {}) {
    const margin = Number.isFinite(options.margin) ? options.margin : 4;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const drawWidth = pageWidth - margin * 2;
    const drawHeight = pageHeight - margin * 2;
    const pixelsPerPage = Math.max(1, Math.floor(canvas.width * drawHeight / drawWidth));
    let sourceY = 0;
    let pageIndex = 0;

    while (sourceY < canvas.height) {
      const sliceHeight = Math.min(pixelsPerPage, canvas.height - sourceY);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const ctx = slice.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      const imageData = slice.toDataURL('image/jpeg', options.jpegQuality || 0.93);
      const imageHeightMm = sliceHeight * drawWidth / canvas.width;
      if (pageIndex > 0) doc.addPage();
      doc.addImage(imageData, 'JPEG', margin, margin, drawWidth, imageHeightMm, undefined, 'FAST');
      sourceY += sliceHeight;
      pageIndex += 1;
    }
    return pageIndex;
  }

  function savePdf(doc, filename) {
    const finalName = safeFileName(filename || 'تقرير');
    doc.save(finalName.toLowerCase().endsWith('.pdf') ? finalName : `${finalName}.pdf`);
    return doc;
  }

  function buildTablePage(config, chunk, pageNumber, pageCount, orientation) {
    const px = pagePixelSize(orientation);
    const title = escapeHtml(config.title || 'تقرير كاش توب');
    const subtitle = escapeHtml(config.subtitle || '');
    const columns = (config.columns || []).map(column => `<th>${escapeHtml(cleanText(typeof column === 'object' ? (column.header ?? column.title ?? column.label ?? '') : column))}</th>`).join('');
    const rows = (chunk || []).map(row => {
      const cells = (Array.isArray(row) ? row : [row]).map(value => `<td>${escapeHtml(cleanText(value)) || '-'}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('') || `<tr><td colspan="${Math.max(1, (config.columns || []).length)}">لا توجد بيانات</td></tr>`;
    const fontSize = Number(config.fontSize) || ((config.columns || []).length > 8 ? 10 : 12);

    return `
      <section style="width:${px.width}px;min-height:${px.height}px;background:#fff;color:#1f2937;direction:rtl;padding:${orientation === 'landscape' ? 28 : 36}px;box-sizing:border-box;font-family:'Cairo',Tahoma,Arial,sans-serif;">
        <div style="text-align:right;border-bottom:3px solid #1f2937;padding-bottom:12px;margin-bottom:14px;">
          <div style="font-size:22px;font-weight:800;line-height:1.4;color:#111827;">${title}</div>
          ${subtitle ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;line-height:1.7;">${subtitle}</div>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;table-layout:${(config.columns || []).length > 7 ? 'fixed' : 'auto'};font-size:${fontSize}px;direction:rtl;">
          <thead><tr>${columns}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="display:flex;justify-content:space-between;gap:12px;margin-top:14px;padding-top:8px;border-top:1px solid #d1d5db;color:#6b7280;font-size:9px;direction:rtl;">
          <span>كاش توب 2</span><span>صفحة ${pageNumber} من ${pageCount}</span><span>${escapeHtml(new Date().toLocaleString('en-GB'))}</span>
        </div>
        <style>
          .ct-fast-export-render-host th{background:#1f2937;color:#fff;border:1px solid #111827;padding:7px 5px;text-align:center;vertical-align:middle;font-weight:700;overflow-wrap:anywhere}
          .ct-fast-export-render-host td{border:1px solid #d8dde5;padding:6px 5px;text-align:center;vertical-align:middle;overflow-wrap:anywhere;white-space:normal;line-height:1.55}
          .ct-fast-export-render-host tbody tr:nth-child(even) td{background:#f8fafc}
        </style>
      </section>`;
  }

  async function exportDataTablePDF(config = {}) {
    await ensurePdfLibraries();
    const orientation = normalizeOrientation(config.orientation || ((config.columns?.length || 0) > 6 ? 'landscape' : 'portrait'));
    const rows = Array.isArray(config.rows) ? config.rows : [];
    const columnCount = Math.max(1, (config.columns || []).length);
    const perPage = Number(config.rowsPerPage) || (orientation === 'landscape' ? (columnCount > 8 ? 15 : 20) : (columnCount > 6 ? 17 : 24));
    const chunks = [];
    if (!rows.length) chunks.push([]);
    for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));

    const px = pagePixelSize(orientation);
    const doc = createPdf(orientation, config.format || 'a4');
    let pageWritten = false;

    for (let i = 0; i < chunks.length; i += 1) {
      const host = createRenderHost(px.width);
      try {
        host.innerHTML = buildTablePage(config, chunks[i], i + 1, chunks.length, orientation);
        const page = host.firstElementChild;
        const canvas = await renderCanvas(page, { width: px.width, height: px.height, scale: config.scale });
        if (pageWritten) doc.addPage();
        const margin = 3;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const availableW = pageWidth - margin * 2;
        const availableH = pageHeight - margin * 2;
        const ratio = Math.min(availableW / canvas.width, availableH / canvas.height);
        const w = canvas.width * ratio;
        const h = canvas.height * ratio;
        const x = (pageWidth - w) / 2;
        const y = (pageHeight - h) / 2;
        doc.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', x, y, w, h, undefined, 'FAST');
        pageWritten = true;
      } finally {
        host.remove();
      }
    }

    return savePdf(doc, config.filename || config.title || 'تقرير');
  }

  async function exportElementTablesToPDF(elementOrSelector, filename, options = {}) {
    await ensurePdfLibraries();
    const source = typeof elementOrSelector === 'string' ? document.querySelector(elementOrSelector) : elementOrSelector;
    if (!source) throw new Error('عنصر التصدير غير موجود');
    const orientation = normalizeOrientation(options.orientation || (source.scrollWidth > 850 ? 'landscape' : 'portrait'));
    const px = pagePixelSize(orientation);
    const host = createRenderHost(px.width);
    try {
      const clone = source.cloneNode(true);
      forceVisible(clone);
      removeInteractiveUi(clone);
      clone.style.setProperty('width', `${px.width}px`, 'important');
      clone.style.setProperty('max-width', 'none', 'important');
      clone.style.setProperty('min-height', '0', 'important');
      clone.style.setProperty('box-sizing', 'border-box', 'important');
      clone.style.setProperty('background', '#ffffff', 'important');
      host.appendChild(clone);
      const canvas = await renderCanvas(clone, { width: px.width, scale: options.scale });
      const doc = createPdf(orientation, options.format || 'a4');
      addCanvasToPdf(doc, canvas, { margin: options.margin, jpegQuality: 0.93 });
      return savePdf(doc, filename || options.title || 'تقرير');
    } finally {
      host.remove();
    }
  }

  async function exportHtmlPagesToPDF(pageHtmlList, filename, options = {}) {
    await ensurePdfLibraries();
    const pages = Array.isArray(pageHtmlList) ? pageHtmlList.filter(Boolean) : [];
    if (!pages.length) throw new Error('لا توجد صفحات للتصدير');
    const orientation = normalizeOrientation(options.orientation || 'portrait');
    const px = pagePixelSize(orientation);
    const doc = createPdf(orientation, options.format || 'a4');

    for (let i = 0; i < pages.length; i += 1) {
      const host = createRenderHost(px.width);
      try {
        host.innerHTML = pages[i];
        const page = host.firstElementChild || host;
        forceVisible(page);
        removeInteractiveUi(page);
        page.style.setProperty('width', `${px.width}px`, 'important');
        page.style.setProperty('min-height', `${px.height}px`, 'important');
        page.style.setProperty('box-sizing', 'border-box', 'important');
        page.style.setProperty('background', '#ffffff', 'important');
        const canvas = await renderCanvas(page, { width: px.width, height: px.height, scale: options.scale });
        if (i > 0) doc.addPage();
        const margin = 3;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const availableW = pageWidth - margin * 2;
        const availableH = pageHeight - margin * 2;
        const ratio = Math.min(availableW / canvas.width, availableH / canvas.height);
        const w = canvas.width * ratio;
        const h = canvas.height * ratio;
        doc.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h, undefined, 'FAST');
      } finally {
        host.remove();
      }
    }

    return savePdf(doc, filename || options.title || 'تقرير');
  }

  // إبقاء واجهة التوافق فقط. لا يتم اعتراض XLSX.writeFile أو تعديل المصنف؛
  // التنزيل يبقى مباشراً مثل آلية ملف "جديد 2" لتقليل زمن إنشاء Excel.
  function enhanceWorkbook(workbook) { return workbook; }
  function installExcelEnhancer() { return false; }

  window.CashtopExport = Object.freeze({
    cleanText,
    safeFileName,
    exportDataTablePDF,
    exportElementTablesToPDF,
    exportHtmlPagesToPDF,
    enhanceWorkbook,
    installExcelEnhancer
  });
})();
