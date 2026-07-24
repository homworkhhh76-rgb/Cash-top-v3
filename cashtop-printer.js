'use strict';

(function () {
  const PRINTER_KEY = 'cashtop_printer_settings';
  const SETTINGS_KEY = 'cashtop_settings';
  const CUSTOM_DESIGN_KEY = 'cashtop_invoice_design';
  const DEFAULTS = {
    printType: 'thermal-80',
    printCopies: 1,
    showLogo: true,
    showBarcode: true,
    showFooterText: true,
    autoPrint: true,
    bluetoothEnabled: false,
    bluetoothTransport: '',
    bluetoothDeviceId: '',
    bluetoothDeviceName: '',
    serialBaudRate: 9600
  };

  const BLE_CANDIDATES = [
    { service: '0000ffe0-0000-1000-8000-00805f9b34fb', characteristic: '0000ffe1-0000-1000-8000-00805f9b34fb' },
    { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', characteristic: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' },
    { service: '0000ff00-0000-1000-8000-00805f9b34fb', characteristic: '0000ff02-0000-1000-8000-00805f9b34fb' },
    { service: '0000ae30-0000-1000-8000-00805f9b34fb', characteristic: '0000ae01-0000-1000-8000-00805f9b34fb' },
    { service: '000018f0-0000-1000-8000-00805f9b34fb', characteristic: '00002af1-0000-1000-8000-00805f9b34fb' }
  ];
  const BLE_SERVICES = [...new Set(BLE_CANDIDATES.map(item => item.service))];

  let bleDevice = null;
  let bleCharacteristic = null;
  let serialPort = null;
  let libraryPromise = null;

  function safeJson(raw, fallback = {}) {
    try { return JSON.parse(raw || '') || fallback; } catch (_) { return fallback; }
  }

  function getPrinterSettings() {
    return { ...DEFAULTS, ...safeJson(localStorage.getItem(PRINTER_KEY), {}) };
  }

  function getSystemSettings() {
    return safeJson(localStorage.getItem(SETTINGS_KEY), {});
  }

  function savePrinterPatch(patch) {
    const next = { ...getPrinterSettings(), ...(patch || {}) };
    localStorage.setItem(PRINTER_KEY, JSON.stringify(next));
    return next;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function invoicePrintRoundingEnabled(){try{return JSON.parse(localStorage.getItem('cashtop_settings')||'{}').roundInvoicePrintTotals===true}catch(_){return false}}
  function printAmount(value){const n=number(value);return invoicePrintRoundingEnabled()?Math.round(n):n}
  function printMoney(value){return invoicePrintRoundingEnabled()?String(Math.round(number(value))):money(value)}
  function money(value) {
    return number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function currencyLabel(settings) {
    const currency = settings.currency || 'شيكل';
    return ({ شيكل: '₪', دولار: '$', دينار: 'JD', ريال: 'SR' })[currency] || currency;
  }

  function invoiceNumber(invoice) {
    return String(invoice?.id || invoice?.invoiceNo || invoice?.number || Date.now()).replace(/^INV_/, '');
  }

  function itemUnit(item) {
    const chain = window.CashtopMulti?.normalizeProductChain?.(item) || [];
    const selected = chain.find(level => String(level.id) === String(item?.selectedUnit))
      || chain.find((_, index) => (item?.selectedUnit === 'piece' && index === 0) || (item?.selectedUnit === 'unit' && index === chain.length - 1));
    if (selected?.name) return selected.name;
    if (item?.selectedUnit === 'unit') return item.unitName || 'وحدة';
    return item?.pieceName || 'حبة';
  }

  function receiptCss(type) {
    const is58 = type === 'thermal-58';
    const isA4 = type === 'paper-a4';
    const width = is58 ? '58mm' : isA4 ? '190mm' : '80mm';
    const padding = is58 ? '0.6mm 2mm 1.4mm' : isA4 ? '7mm 10mm' : '0.8mm 2.5mm 1.8mm';
    return `
      *{box-sizing:border-box;font-family:'Cairo',Arial,Tahoma,sans-serif}
      html,body{margin:0;padding:0;background:#fff;color:#000}
      .ct-print-receipt{
        background:#fff;color:#000;width:${width};max-width:${width};padding:${padding};
        direction:rtl;margin:0 auto;position:relative;font-size:${isA4 ? '12px' : is58 ? '8.5px' : '10px'};
        line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact
      }
      .ct-print-receipt .receipt-header{text-align:center;margin:0 0 3px}
      .ct-print-receipt .receipt-logo{max-width:62px;max-height:46px;object-fit:contain;filter:grayscale(100%) contrast(200%);margin:0 auto 2px;display:block}
      .ct-print-receipt .store-name{font-size:17px;line-height:1.15;font-weight:900;margin:0}
      .ct-print-receipt .dashed-line{border-top:1px dashed #000;margin:5px 0;width:100%}
      .ct-print-receipt .info-grid{
        display:grid;grid-template-columns:auto minmax(0,1fr) auto minmax(0,1fr);gap:3px 6px;
        font-size:9.5px;font-weight:600;margin:0;align-items:center
      }
      .ct-print-receipt .info-label{font-weight:500;color:#222;white-space:nowrap}
      .ct-print-receipt .info-value{font-weight:700;text-align:right;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ct-print-receipt .receipt-table{
        width:100%;border-collapse:collapse;margin:0;font-weight:700;
        font-size:9.5px;table-layout:fixed
      }
      .ct-print-receipt .receipt-table th{padding:3px 0}
      .ct-print-receipt .receipt-table td{padding:2px 0;font-weight:600;overflow:hidden;text-overflow:ellipsis}
      .ct-print-receipt .receipt-table th,.ct-print-receipt .receipt-table td{text-align:center;line-height:1.2}
      .ct-print-receipt .receipt-table th:first-child,.ct-print-receipt .receipt-table td:first-child{text-align:right}
      .ct-print-receipt .receipt-table th:last-child,.ct-print-receipt .receipt-table td:last-child{text-align:left}
      .ct-print-receipt .receipt-table .item-name{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:0}
      .ct-print-receipt .totals-horizontal-box{
        display:flex;justify-content:space-between;border:1.5px solid #000;border-radius:5px;
        padding:4px 2px;margin:6px 0;background:#fff
      }
      .ct-print-receipt .total-col{
        flex:1;display:flex;flex-direction:column;align-items:center;border-left:1px dashed #777;min-width:0
      }
      .ct-print-receipt .total-col:last-child{border-left:none}
      .ct-print-receipt .total-label{font-size:8.5px;font-weight:700;margin-bottom:1px;color:#222;white-space:nowrap}
      .ct-print-receipt .total-val{font-size:10px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;max-width:100%}
      .ct-print-receipt .receipt-footer{text-align:center;margin-top:3px;font-weight:600}
      .ct-print-receipt .terms{font-size:8px;margin-top:2px;line-height:1.35;font-weight:600}
      .ct-print-receipt .barcode-container{text-align:center;margin-top:4px}
      .ct-print-receipt .barcode-container svg{max-width:100%;height:25px}
      .ct-print-receipt .barcode-fallback{font-family:monospace;font-size:9px;letter-spacing:1px;font-weight:700}
      ${is58 ? `
        .ct-print-receipt .receipt-logo{max-width:50px;max-height:38px}
        .ct-print-receipt .store-name{font-size:14px}
        .ct-print-receipt .info-grid{gap:2px 4px;font-size:7.3px}
        .ct-print-receipt .receipt-table{font-size:7px}
        .ct-print-receipt .receipt-table th{padding:2px 0}
        .ct-print-receipt .receipt-table td{padding:1.5px 0}
        .ct-print-receipt .totals-horizontal-box{padding:3px 1px;margin:5px 0}
        .ct-print-receipt .total-label{font-size:6.7px}
        .ct-print-receipt .total-val{font-size:7.6px}
        .ct-print-receipt .terms{font-size:6.5px}
        .ct-print-receipt .barcode-container svg{height:21px}
      ` : ''}
      ${isA4 ? `
        .ct-print-receipt .receipt-logo{max-width:90px;max-height:72px}
        .ct-print-receipt .store-name{font-size:22px}
        .ct-print-receipt .info-grid{font-size:11px;gap:4px 8px}
        .ct-print-receipt .receipt-table{font-size:10.5px}
        .ct-print-receipt .total-label{font-size:10px}
        .ct-print-receipt .total-val{font-size:12px}
      ` : ''}
    `;
  }


  function customDesignCss(type) {
    const is58 = type === 'thermal-58';
    const isA4 = type === 'paper-a4';
    const width = is58 ? '58mm' : isA4 ? '190mm' : '80mm';
    return `
      *{box-sizing:border-box;font-family:'Cairo',Arial,Tahoma,sans-serif;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
      html,body{margin:0;padding:0;background:#fff!important;color:#000}
      .ct-custom-receipt{position:relative;width:${width};max-width:${width};min-height:120px;margin:0 auto;background:#fff!important;color:#000;overflow:visible;direction:rtl}
      .ct-custom-receipt .draggable-item{position:absolute;min-width:30px;min-height:20px;user-select:none}
      .ct-custom-receipt .draggable-item .content{width:100%;height:100%;padding:2px;border:1px solid transparent;word-wrap:break-word;overflow-wrap:anywhere;box-sizing:border-box;background-color:transparent}
      .ct-custom-receipt .type-line .content{border-bottom:2px solid #000!important;height:0!important;min-height:0!important;padding:0;margin-top:10px}
      .ct-custom-receipt .type-box .content{border:2px solid #000!important}
      .ct-custom-receipt .type-circle .content{border:2px solid #000!important;border-radius:50%}
      .ct-custom-receipt .receipt-table{width:100%;border-collapse:collapse;font-size:inherit;text-align:center;table-layout:fixed}
      .ct-custom-receipt .receipt-table th,.ct-custom-receipt .receipt-table td{border-bottom:1px dashed #000;padding:4px 2px;min-width:20px;overflow-wrap:anywhere;background:transparent!important;color:inherit!important}
      .ct-custom-receipt .receipt-table th:first-child,.ct-custom-receipt .receipt-table td:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ct-custom-receipt .resizer,.ct-custom-receipt .delete-btn{display:none!important}
      .ct-custom-receipt img{max-width:100%;object-fit:contain}
      @media print{html,body{background:#fff!important}.ct-custom-receipt{box-shadow:none!important;border:none!important;background:#fff!important}.ct-custom-receipt *{visibility:visible!important}}
    `;
  }

  function buildCustomReceiptMarkup(invoice, printer, settings) {
    const design = safeJson(localStorage.getItem(CUSTOM_DESIGN_KEY), null);
    if (!design || !design.receiptHTML) return null;
    const type = ['thermal-58', 'thermal-80', 'paper-a4'].includes(printer.printType) ? printer.printType : (design.paperSize || 'thermal-80');
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    const subtotal = Number.isFinite(Number(invoice?.subtotal)) ? number(invoice.subtotal) : items.reduce((sum, item) => sum + number(item.qty) * number(item.price), 0);
    const total = number(invoice?.total ?? subtotal);
    const paid = number(invoice?.paid);
    const remaining = Math.max(0, number(invoice?.debt ?? (total - paid)));
    const displaySubtotal=printAmount(subtotal), displayTotal=printAmount(total), displayPaid=printAmount(paid), displayRemaining=printAmount(remaining);
    const date = new Date(invoice?.date || Date.now());
    const firstItem = items[0] || {};
    const firstQty = number(firstItem.qty), firstPrice = number(firstItem.price);
    const values = {
      company_name: settings.companyName || 'كاش توب',
      customer_name: invoice?.customer || 'عميل نقدي',
      customer_phone: invoice?.phone || '-',
      invoice_no: invoiceNumber(invoice),
      date: Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB') : '-',
      time: Number.isFinite(date.getTime()) ? date.toLocaleTimeString('en-GB', { hour12: false }) : '-',
      cashier_name: invoice?.user || 'مستخدم',
      branch_name: invoice?.branchName || settings.branchName || 'الفرع الرئيسي',
      payment_method: invoice?.paymentMethod || invoice?.accountName || 'كاش',
      item_name: firstItem.name || 'صنف',
      item_unit: itemUnit(firstItem),
      item_qty: Number(firstQty.toFixed(6)),
      item_price: money(firstPrice),
      item_total: money(firstQty * firstPrice),
      items_count: items.length,
      subtotal: printMoney(displaySubtotal),
      discount: money(invoice?.discount || 0),
      tax: money(invoice?.tax || 0),
      total: printMoney(displayTotal),
      paid: printMoney(displayPaid),
      remaining: printMoney(displayRemaining),
      notes: invoice?.notes || ''
    };

    const holder = document.createElement('div');
    holder.innerHTML = `<div class="ct-custom-receipt ${type}">${design.receiptHTML}</div>`;
    const receipt = holder.firstElementChild;
    const baseHeight = Math.max(120, parseFloat(design.receiptHeight) || 720);
    receipt.style.height = baseHeight + 'px';

    const logoEl = receipt.querySelector('.type-image[data-role="logo"]');
    if (logoEl) {
      if (printer.showLogo === false || !settings.logo) logoEl.remove();
      else {
        const c = logoEl.querySelector('.content');
        if (c) c.style.backgroundImage = `url("${String(settings.logo).replace(/"/g, '&quot;')}")`;
      }
    }

    const tableEl = receipt.querySelector('.type-table[data-role="items"]') || receipt.querySelector('.type-table');
    let extraHeight = 0;
    if (tableEl) {
      tableEl.dataset.role = 'items';
      const tbody = tableEl.querySelector('tbody');
      const oldRows = tbody ? Math.max(1, tbody.querySelectorAll('tr').length - 1) : 1;
      if (tbody) {
        tbody.innerHTML = `<tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الاجمالي</th></tr>` + (items.map(item => {
          const qty = number(item.qty), price = number(item.price);
          return `<tr><td>${escapeHtml(item.name || 'صنف')}</td><td>${escapeHtml(itemUnit(item))}</td><td>${escapeHtml(Number(qty.toFixed(6)))}</td><td>${money(price)}</td><td>${money(qty * price)}</td></tr>`;
        }).join('') || '<tr><td colspan="5">لا توجد أصناف</td></tr>');
      }
      const newRows = Math.max(1, items.length);
      extraHeight = Math.max(0, newRows - oldRows) * 27;
      const tableTop = parseFloat(tableEl.style.top) || 0;
      if (extraHeight > 0) {
        receipt.querySelectorAll('.draggable-item').forEach(el => {
          if (el === tableEl) return;
          const top = parseFloat(el.style.top);
          if (Number.isFinite(top) && top > tableTop + 45) el.style.top = (top + extraHeight) + 'px';
        });
      }
    }

    let html = receipt.innerHTML;
    Object.entries(values).forEach(([key, value]) => {
      const safe = key === 'notes' ? escapeHtml(value).replace(/\n/g, '<br>') : escapeHtml(value);
      html = html.replace(new RegExp(`{{${key}}}`, 'g'), safe);
    });
    receipt.innerHTML = html;

    let maxBottom = baseHeight + extraHeight;
    receipt.querySelectorAll('.draggable-item').forEach(el => {
      const top = parseFloat(el.style.top) || 0;
      const height = parseFloat(el.style.height) || (el.matches('.type-table') ? 55 + Math.max(1, items.length) * 27 : 35);
      maxBottom = Math.max(maxBottom, top + height + 25);
    });
    receipt.style.height = Math.ceil(maxBottom) + 'px';

    return { type, css: customDesignCss(type), html: receipt.outerHTML };
  }


  function buildReceiptMarkup(invoice, options = {}) {
    const printer = { ...getPrinterSettings(), ...(options.printer || {}) };
    const settings = { ...getSystemSettings(), ...(options.settings || {}) };
    if (options.ignoreCustomDesign !== true) {
      const custom = buildCustomReceiptMarkup(invoice, printer, settings);
      if (custom) return custom;
    }
    const type = ['thermal-58', 'thermal-80', 'paper-a4'].includes(printer.printType) ? printer.printType : 'thermal-80';
    const items = Array.isArray(invoice?.items) ? invoice.items : [];
    const subtotal = Number.isFinite(Number(invoice?.subtotal)) ? number(invoice.subtotal) : items.reduce((sum, item) => sum + number(item.qty) * number(item.price), 0);
    const total = number(invoice?.total ?? subtotal);
    const paid = number(invoice?.paid);
    const remaining = Math.max(0, number(invoice?.debt ?? (total - paid)));
    const displaySubtotal=printAmount(subtotal), displayTotal=printAmount(total), displayPaid=printAmount(paid), displayRemaining=printAmount(remaining);
    const currency = currencyLabel(settings);
    const date = new Date(invoice?.date || Date.now());
    const dateText = Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB') : '-';
    const timeText = Number.isFinite(date.getTime()) ? date.toLocaleTimeString('en-GB', { hour12: false }) : '-';
    const logo = printer.showLogo !== false && settings.logo
      ? `<img class="receipt-logo" src="${escapeHtml(settings.logo)}" alt="الشعار">`
      : '';
    const rows = items.map(item => {
      const qty = number(item.qty);
      const price = number(item.price);
      return `<tr><td class="item-name" title="${escapeHtml(item.name || 'صنف')}" style="width:35%">${escapeHtml(item.name || 'صنف')}</td><td style="width:15%">${escapeHtml(itemUnit(item))}</td><td style="width:15%">${escapeHtml(Number(qty.toFixed(6)))}</td><td style="width:17%">${money(price)}</td><td style="width:18%">${money(qty * price)}</td></tr>`;
    }).join('') || '<tr><td colspan="5">لا توجد أصناف</td></tr>';
    const barcode = printer.showBarcode !== false
      ? `<div class="barcode-container"><svg class="ct-invoice-barcode" data-code="${escapeHtml(invoiceNumber(invoice))}"></svg></div>`
      : '';
    const footer = printer.showFooterText !== false
      ? '<div class="terms">البضاعة المباعة لا ترد ولا تستبدل إلا حسب الشروط والأحكام. شكراً لزيارتكم!</div>'
      : '';
    return {
      type,
      css: receiptCss(type),
      html: `<div class="ct-print-receipt ${type}">
        <div class="receipt-header">${logo}<p class="store-name">${escapeHtml(settings.companyName || 'كاش توب')}</p></div>
        <div class="dashed-line"></div>
        <div class="info-grid">
          <span class="info-label">رقم العملية:</span><span class="info-value">${escapeHtml(invoiceNumber(invoice))}</span><span class="info-label">التاريخ:</span><span class="info-value">${escapeHtml(dateText)}</span>
          <span class="info-label">الوقت:</span><span class="info-value">${escapeHtml(timeText)}</span><span class="info-label">العميل:</span><span class="info-value">${escapeHtml(invoice?.customer || 'عميل نقدي')}</span>
          <span class="info-label">الجوال:</span><span class="info-value">${escapeHtml(invoice?.phone || '-')}</span><span></span><span></span>
        </div>
        <div class="dashed-line"></div>
        <table class="receipt-table"><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="dashed-line"></div>
        <div class="totals-horizontal-box">
          <div class="total-col"><span class="total-label">الإجمالي</span><span class="total-val">${printMoney(displaySubtotal)} ${escapeHtml(currency)}</span></div>
          <div class="total-col"><span class="total-label">الصافي</span><span class="total-val">${printMoney(displayTotal)} ${escapeHtml(currency)}</span></div>
          <div class="total-col"><span class="total-label">المدفوع</span><span class="total-val">${printMoney(displayPaid)} ${escapeHtml(currency)}</span></div>
          <div class="total-col"><span class="total-label">المتبقي</span><span class="total-val">${printMoney(displayRemaining)} ${escapeHtml(currency)}</span></div>
        </div>
        <div class="receipt-footer">${footer}${barcode}</div>
      </div>`
    };
  }

  function loadScriptOnce(src, test) {
    if (test()) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src === src);
      if (existing) {
        existing.addEventListener('load', () => resolve(test()), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve(test());
      script.onerror = () => reject(new Error(`تعذر تحميل مكتبة الطباعة: ${src}`));
      document.head.appendChild(script);
    });
  }

  function ensureLibraries() {
    if (!libraryPromise) {
      libraryPromise = Promise.all([
        loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => typeof window.html2canvas === 'function'),
        loadScriptOnce('https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js', () => typeof window.JsBarcode === 'function')
      ]).catch(error => {
        libraryPromise = null;
        throw error;
      });
    }
    return libraryPromise;
  }

  async function createReceiptElement(invoice, options = {}) {
    await ensureLibraries();
    const built = buildReceiptMarkup(invoice, options);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;z-index:-1;background:#fff;pointer-events:none;';
    const style = document.createElement('style');
    style.textContent = built.css;
    host.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = built.html;
    host.appendChild(wrap);
    document.body.appendChild(host);
    const receipt = host.querySelector('.ct-print-receipt');
    const barcode = receipt?.querySelector('.ct-invoice-barcode');
    if (barcode && typeof window.JsBarcode === 'function') {
      try {
        window.JsBarcode(barcode, barcode.dataset.code || invoiceNumber(invoice), {
          format: 'CODE128', width: built.type === 'thermal-58' ? 1.15 : 1.5, height: built.type === 'thermal-58' ? 26 : 34,
          displayValue: true, margin: 0, fontSize: built.type === 'thermal-58' ? 8 : 10
        });
      } catch (_) { barcode.closest('.barcode-container')?.remove(); }
    }
    try { await document.fonts?.ready; } catch (_) {}
    await Promise.all([...receipt.querySelectorAll('img')].map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
      img.onload = resolve; img.onerror = resolve; setTimeout(resolve, 2500);
    })));
    return { host, receipt, type: built.type };
  }

  function dotsForType(type) {
    if (type === 'thermal-58') return 384;
    if (type === 'thermal-80') return 576;
    return 1240;
  }

  async function renderInvoiceCanvas(invoice, options = {}) {
    const created = await createReceiptElement(invoice, options);
    try {
      const source = await window.html2canvas(created.receipt, { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const targetWidth = dotsForType(created.type);
      const targetHeight = Math.max(1, Math.round(source.height * targetWidth / source.width));
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetWidth, targetHeight);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
      return { canvas, type: created.type };
    } finally {
      created.host.remove();
    }
  }

  function concatUint8Arrays(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }

  function canvasToEscPosRaster(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const width = canvas.width;
    const height = canvas.height;
    const bytesPerRow = Math.ceil(width / 8);
    const bandHeight = 256;
    const parts = [new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0x00])];
    for (let startY = 0; startY < height; startY += bandHeight) {
      const currentHeight = Math.min(bandHeight, height - startY);
      const raster = new Uint8Array(bytesPerRow * currentHeight);
      for (let y = 0; y < currentHeight; y += 1) {
        const sourceY = startY + y;
        for (let x = 0; x < width; x += 1) {
          const i = (sourceY * width + x) * 4;
          const luminance = (image.data[i] * 0.299) + (image.data[i + 1] * 0.587) + (image.data[i + 2] * 0.114);
          if (image.data[i + 3] > 80 && luminance < 190) raster[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
        }
      }
      const xL = bytesPerRow & 0xff; const xH = (bytesPerRow >> 8) & 0xff;
      const yL = currentHeight & 0xff; const yH = (currentHeight >> 8) & 0xff;
      parts.push(new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]));
      parts.push(raster);
    }
    parts.push(new Uint8Array([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x41, 0x10]));
    return concatUint8Arrays(parts);
  }

  async function findWritableBleCharacteristic(server) {
    for (const candidate of BLE_CANDIDATES) {
      try {
        const service = await server.getPrimaryService(candidate.service);
        const characteristic = await service.getCharacteristic(candidate.characteristic);
        if (characteristic?.properties?.write || characteristic?.properties?.writeWithoutResponse) return characteristic;
      } catch (_) {}
    }
    try {
      const services = await server.getPrimaryServices();
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          const writable = characteristics.find(item => item.properties?.writeWithoutResponse || item.properties?.write);
          if (writable) return writable;
        } catch (_) {}
      }
    } catch (_) {}
    throw new Error('تم الاتصال بالطابعة، لكن قناة الإرسال الخاصة بها غير مدعومة عبر Web Bluetooth.');
  }

  async function connectSelectedDevice(device) {
    if (!device) throw new Error('لم يتم اختيار طابعة Bluetooth.');
    if (!device.gatt) throw new Error('هذه الطابعة لا تدعم اتصال BLE المتاح للمتصفح.');
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const characteristic = await findWritableBleCharacteristic(server);
    bleDevice = device;
    bleCharacteristic = characteristic;
    savePrinterPatch({
      bluetoothTransport: 'ble',
      bluetoothDeviceId: device.id || '',
      bluetoothDeviceName: device.name || 'Bluetooth Printer'
    });
    device.addEventListener?.('gattserverdisconnected', () => { bleCharacteristic = null; });
    return { id: device.id || '', name: device.name || 'Bluetooth Printer', connected: true, transport: 'ble' };
  }

  async function connectSerialBluetooth(options = {}) {
    if (!navigator.serial) throw new Error('Web Serial غير متاح في هذا المتصفح.');
    const printer = getPrinterSettings();
    if (serialPort?.writable) return { id: 'serial', name: printer.bluetoothDeviceName || 'Bluetooth/Serial Printer', connected: true, transport: 'serial' };

    let port = null;
    if (typeof navigator.serial.getPorts === 'function') {
      try {
        const ports = await navigator.serial.getPorts();
        if (ports.length) port = ports[0];
      } catch (_) {}
    }
    if (!port && options.prompt !== false) port = await navigator.serial.requestPort();
    if (!port) throw new Error('طابعة Bluetooth/Serial المحفوظة غير متاحة. أعد ربطها من إعدادات الطابعة.');

    if (!port.writable) await port.open({ baudRate: Number(printer.serialBaudRate) || 9600 });
    serialPort = port;
    const info = typeof port.getInfo === 'function' ? port.getInfo() : {};
    const label = info.usbVendorId ? `Bluetooth/Serial ${info.usbVendorId}:${info.usbProductId || ''}` : 'Bluetooth/Serial Printer';
    savePrinterPatch({ bluetoothTransport: 'serial', bluetoothDeviceName: label });
    return { id: 'serial', name: label, connected: true, transport: 'serial' };
  }

  async function connectBluetooth(options = {}) {
    const printer = getPrinterSettings();
    if (printer.bluetoothTransport === 'serial' && navigator.serial) {
      try { return await connectSerialBluetooth(options); } catch (error) { if (options.prompt === false) throw error; }
    }
    if (bleDevice?.gatt?.connected && bleCharacteristic) return { id: bleDevice.id || '', name: bleDevice.name || '', connected: true, transport: 'ble' };

    let bleError = null;
    if (navigator.bluetooth) {
      if (typeof navigator.bluetooth.getDevices === 'function' && printer.bluetoothDeviceId) {
        try {
          const devices = await navigator.bluetooth.getDevices();
          const remembered = devices.find(device => String(device.id) === String(printer.bluetoothDeviceId));
          if (remembered) return await connectSelectedDevice(remembered);
        } catch (_) {}
      }
      if (options.prompt !== false) {
        try {
          const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
          return await connectSelectedDevice(device);
        } catch (error) { bleError = error; }
      }
    }

    // كثير من الطابعات الحرارية القديمة تعمل Bluetooth Classic كمنفذ COM على Windows.
    // Web Bluetooth لا يراها، لذلك نستخدم Web Serial كمسار مباشر احتياطي عند توفره.
    if (navigator.serial) {
      try { return await connectSerialBluetooth(options); } catch (serialError) {
        if (!bleError) bleError = serialError;
      }
    }

    if (bleError) throw bleError;
    if (options.prompt === false) throw new Error('طابعة Bluetooth المحفوظة غير متاحة حالياً. أعد ربطها من إعدادات الطابعة.');
    throw new Error('الاتصال المباشر بـ Bluetooth غير متاح في هذا المتصفح أو الجهاز. استخدم Chrome/Edge المتوافق أو طباعة النظام.');
  }

  async function disconnectBluetooth() {
    try { if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect(); } catch (_) {}
    try { if (serialPort?.readable || serialPort?.writable) await serialPort.close(); } catch (_) {}
    bleCharacteristic = null;
    bleDevice = null;
    serialPort = null;
    return true;
  }

  async function writeBleChunk(characteristic, chunk) {
    if (characteristic.properties?.writeWithoutResponse && characteristic.writeValueWithoutResponse) return characteristic.writeValueWithoutResponse(chunk);
    if (characteristic.writeValueWithResponse) return characteristic.writeValueWithResponse(chunk);
    if (characteristic.writeValue) return characteristic.writeValue(chunk);
    throw new Error('خاصية Bluetooth لا تسمح بإرسال بيانات الطباعة.');
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function printUsb(invoice, options = {}) {
    const printer = { ...getPrinterSettings(), ...(options.printer || {}) };
    if (printer.printType === 'paper-a4') throw new Error('الطباعة الحرارية USB المباشرة مخصصة لمقاسات 58/80 ملم.');
    if (!navigator.usb) throw new Error('WebUSB غير متاح في هذا المتصفح أو يحتاج تشغيل التطبيق عبر HTTPS/localhost.');

    const { canvas } = await renderInvoiceCanvas(invoice, { ...options, printer });
    const data = canvasToEscPosRaster(canvas);
    const copies = Math.min(10, Math.max(1, parseInt(printer.printCopies, 10) || 1));

    const device = options.device || await navigator.usb.requestDevice({ filters: [] });
    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    let interfaceNumber = null;
    let endpointNumber = null;
    let alternateSetting = null;
    for (const iface of device.configuration.interfaces) {
      for (const alternate of iface.alternates) {
        const outEndpoint = alternate.endpoints.find(ep => ep.direction === 'out');
        if (outEndpoint) {
          interfaceNumber = iface.interfaceNumber;
          endpointNumber = outEndpoint.endpointNumber;
          alternateSetting = alternate.alternateSetting;
          break;
        }
      }
      if (interfaceNumber !== null) break;
    }
    if (interfaceNumber === null || endpointNumber === null) {
      throw new Error('تم اختيار جهاز USB لكن لم يتم العثور على منفذ إرسال للطابعة.');
    }

    await device.claimInterface(interfaceNumber);
    if (alternateSetting !== null) {
      try { await device.selectAlternateInterface(interfaceNumber, alternateSetting); } catch (_) {}
    }

    for (let copy = 0; copy < copies; copy += 1) {
      for (let offset = 0; offset < data.length; offset += 16384) {
        const result = await device.transferOut(endpointNumber, data.slice(offset, Math.min(offset + 16384, data.length)));
        if (result?.status && result.status !== 'ok') throw new Error('فشل إرسال بيانات الطباعة عبر USB.');
      }
    }
    return { ok: true, mode: 'usb', copies };
  }

  async function printSerial(invoice, options = {}) {
    const printer = { ...getPrinterSettings(), ...(options.printer || {}) };
    if (printer.printType === 'paper-a4') throw new Error('الطباعة الحرارية المباشرة مخصصة لمقاسات 58/80 ملم.');
    const connection = serialPort?.writable
      ? { transport: 'serial' }
      : await connectSerialBluetooth({ prompt: options.prompt !== false });
    if (connection.transport !== 'serial' || !serialPort?.writable) throw new Error('تعذر فتح منفذ طابعة Bluetooth/Serial.');
    const { canvas } = await renderInvoiceCanvas(invoice, { ...options, printer });
    const data = canvasToEscPosRaster(canvas);
    const copies = Math.min(10, Math.max(1, parseInt(printer.printCopies, 10) || 1));
    const writer = serialPort.writable.getWriter();
    try {
      for (let copy = 0; copy < copies; copy += 1) {
        for (let offset = 0; offset < data.length; offset += 8192) {
          await writer.write(data.slice(offset, Math.min(offset + 8192, data.length)));
        }
      }
    } finally {
      writer.releaseLock();
    }
    return { ok: true, mode: 'bluetooth-serial', copies };
  }

  async function printBluetooth(invoice, options = {}) {
    const printer = { ...getPrinterSettings(), ...(options.printer || {}) };
    if (printer.printType === 'paper-a4') throw new Error('طباعة Bluetooth المباشرة مخصصة للمقاسات الحرارية.');
    const connection = await connectBluetooth({ prompt: options.prompt !== false });
    if (connection.transport === 'serial') return printSerial(invoice, { ...options, printer, prompt: false });
    const characteristic = bleCharacteristic;
    if (!characteristic) throw new Error('تعذر فتح قناة الطباعة عبر Bluetooth.');
    const { canvas } = await renderInvoiceCanvas(invoice, { ...options, printer });
    const data = canvasToEscPosRaster(canvas);
    const copies = Math.min(10, Math.max(1, parseInt(printer.printCopies, 10) || 1));
    for (let copy = 0; copy < copies; copy += 1) {
      const bleChunkSize = Math.max(20, Math.min(64, Number(printer.bluetoothChunkSize) || 20));
      for (let offset = 0; offset < data.length; offset += bleChunkSize) {
        await writeBleChunk(characteristic, data.slice(offset, Math.min(offset + bleChunkSize, data.length)));
        await sleep(characteristic.properties?.writeWithoutResponse ? 12 : 6);
      }
    }
    return { ok: true, mode: 'bluetooth', copies };
  }

  async function tryNativePrintBridge(invoice, options = {}) {
    const printer = { ...getPrinterSettings(), ...(options.printer || {}) };
    if (printer.printType === 'paper-a4') return false;
    const hasBridge = Boolean(
      (window.AndroidThermalPrinter && typeof window.AndroidThermalPrinter.printBase64 === 'function') ||
      (window.Android && typeof window.Android.printBase64 === 'function') ||
      window.webkit?.messageHandlers?.thermalPrinter ||
      (window.chrome?.webview && typeof window.chrome.webview.postMessage === 'function')
    );
    if (!hasBridge) return false;
    const { canvas, type } = await renderInvoiceCanvas(invoice, { ...options, printer });
    const payload = { type: 'thermal-print', invoiceNo: invoiceNumber(invoice), widthDots: dotsForType(type), imageDataUrl: canvas.toDataURL('image/png') };
    if (window.AndroidThermalPrinter && typeof window.AndroidThermalPrinter.printBase64 === 'function') { window.AndroidThermalPrinter.printBase64(payload.imageDataUrl, String(payload.widthDots)); return true; }
    if (window.Android && typeof window.Android.printBase64 === 'function') { window.Android.printBase64(payload.imageDataUrl, String(payload.widthDots)); return true; }
    if (window.webkit?.messageHandlers?.thermalPrinter) { window.webkit.messageHandlers.thermalPrinter.postMessage(payload); return true; }
    if (window.chrome?.webview && typeof window.chrome.webview.postMessage === 'function') { window.chrome.webview.postMessage(payload); return true; }
    return false;
  }

  async function waitForFrameReady(frame) {
    const doc = frame.contentDocument;
    try { await doc.fonts?.ready; } catch (_) {}
    const images = [...doc.images];
    await Promise.all(images.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      if (typeof img.decode === 'function') return img.decode().catch(() => {});
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 2500);
      });
    }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await sleep(120);
  }

  function createPrintFrame() {
    let frame = document.getElementById('ctUniversalPrintFrame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'ctUniversalPrintFrame';
      frame.setAttribute('title', 'معاينة طباعة الفاتورة');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;border:0;pointer-events:none;z-index:-2147483647;background:#fff;';
      document.body.appendChild(frame);
    }
    return frame;
  }

  async function renderBarcodeInDocument(doc, type, code) {
    const barcodes = [...doc.querySelectorAll('.ct-invoice-barcode')];
    if (!barcodes.length) return;
    try {
      await ensureLibraries();
      for (const barcode of barcodes) {
        window.JsBarcode(barcode, code, {
          format: 'CODE128',
          width: type === 'thermal-58' ? 1.15 : 1.5,
          height: type === 'thermal-58' ? 26 : 34,
          displayValue: true,
          margin: 0,
          fontSize: type === 'thermal-58' ? 8 : 10
        });
      }
    } catch (error) {
      console.warn('[CASH TOP] barcode library unavailable for system print:', error);
      for (const barcode of barcodes) {
        const fallback = doc.createElement('div');
        fallback.className = 'barcode-fallback';
        fallback.textContent = code;
        barcode.replaceWith(fallback);
      }
    }
  }

  function printPageCss(type, thermalHeightMm, copies) {
    const isA4 = type === 'paper-a4';
    if (isA4) {
      return `
        @page{size:A4 portrait;margin:10mm}
        html,body{margin:0!important;padding:0!important;background:#fff!important}
        body{direction:rtl}
        .ct-print-copy{width:190mm;min-height:277mm;margin:0 auto;display:flex;align-items:flex-start;justify-content:center;page-break-after:always;break-after:page}
        .ct-print-copy:last-child{page-break-after:auto;break-after:auto}
        .ct-print-receipt{box-shadow:none!important}
      `;
    }
    const sizeMm = type === 'thermal-58' ? 58 : 80;
    const heightMm = Math.max(20, Math.ceil(Number(thermalHeightMm) || 20));
    return `
      @page{size:${sizeMm}mm ${heightMm}mm;margin:0}
      html,body{width:${sizeMm}mm!important;margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}
      body{direction:rtl}
      .ct-print-copy{display:block;width:${sizeMm}mm;margin:0;padding:0;page-break-after:always;break-after:page}
      .ct-print-copy:last-child{page-break-after:auto;break-after:auto}
      .ct-print-receipt{width:${sizeMm}mm!important;max-width:${sizeMm}mm!important;margin:0!important;box-shadow:none!important}
    `;
  }

  async function systemPrint(invoice, options = {}) {
    const printer = { ...getPrinterSettings(), ...(options.printer || {}) };
    const built = buildReceiptMarkup(invoice, { ...options, printer });
    const type = built.type;
    const copies = Math.min(10, Math.max(1, parseInt(printer.printCopies, 10) || 1));
    const frame = createPrintFrame();
    const doc = frame.contentDocument || frame.contentWindow.document;
    const copyHtml = Array.from({ length: copies }, () => `<section class="ct-print-copy">${built.html}</section>`).join('');

    doc.open();
    doc.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>فاتورة ${escapeHtml(invoiceNumber(invoice))}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap"><style>${built.css}</style><style id="ctPagePrintStyle"></style></head><body>${copyHtml}</body></html>`);
    doc.close();

    await renderBarcodeInDocument(doc, type, invoiceNumber(invoice));
    await waitForFrameReady(frame);

    let thermalHeightMm = 0;
    if (type !== 'paper-a4') {
      const receipt = doc.querySelector('.ct-print-receipt');
      const pxHeight = Math.max(receipt?.scrollHeight || 0, receipt?.getBoundingClientRect?.().height || 0);
      thermalHeightMm = Math.max(20, Math.ceil(pxHeight * 25.4 / 96) + 2);
    }
    let pageStyle = doc.getElementById('ctPagePrintStyle');
    if (!pageStyle) {
      pageStyle = doc.createElement('style');
      pageStyle.id = 'ctPagePrintStyle';
      doc.head.appendChild(pageStyle);
    }
    pageStyle.textContent = printPageCss(type, thermalHeightMm, copies);

    await waitForFrameReady(frame);
    const printWindow = frame.contentWindow;
    printWindow.focus();
    printWindow.print();
    return { ok: true, mode: 'system', copies };
  }

  async function printInvoice(invoice, options = {}) {
    const printer = { ...getPrinterSettings(), ...(options.printer || {}) };
    if (printer.printType === 'paper-a4') return systemPrint(invoice, { ...options, printer });

    try {
      if (await tryNativePrintBridge(invoice, { ...options, printer })) return { ok: true, mode: 'native' };
    } catch (error) { console.warn('[CASH TOP] native printer bridge:', error); }

    if (printer.bluetoothEnabled === true) {
      try {
        // First reconnect silently to the previously authorised printer. If the browser
        // cannot restore it, ask once for the printer instead of silently skipping Bluetooth.
        try { return await printBluetooth(invoice, { ...options, printer, prompt: false }); }
        catch (_) { return await printBluetooth(invoice, { ...options, printer, prompt: true }); }
      } catch (error) {
        console.warn('[CASH TOP] Bluetooth printer unavailable:', error);
        if (options.bluetoothFallback === false) throw error;
      }
    }
    return systemPrint(invoice, { ...options, printer });
  }


  async function printReceiptData(invoice, options = {}) {
    return printInvoice(invoice, options);
  }

  window.CashtopPrinter = {
    DEFAULTS,
    getSettings: getPrinterSettings,
    saveSettings: savePrinterPatch,
    buildReceiptMarkup,
    renderInvoiceCanvas,
    printInvoice,
    printReceiptData,
    systemPrint,
    printBluetooth,
    printSerial,
    printUsb,
    connectBluetooth,
    connectSerialBluetooth,
    disconnectBluetooth,
    getBluetoothState: () => ({
      connected: Boolean((bleDevice?.gatt?.connected && bleCharacteristic) || serialPort?.writable),
      transport: bleDevice?.gatt?.connected && bleCharacteristic ? 'ble' : (serialPort?.writable ? 'serial' : getPrinterSettings().bluetoothTransport || ''),
      id: bleDevice?.id || getPrinterSettings().bluetoothDeviceId || '',
      name: bleDevice?.name || getPrinterSettings().bluetoothDeviceName || ''
    })
  };
})();
