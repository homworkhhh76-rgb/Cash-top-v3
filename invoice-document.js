(function () {
  'use strict';

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function invoiceDocumentAmount(value){let enabled=false;try{enabled=JSON.parse(localStorage.getItem('cashtop_settings')||'{}').roundInvoicePrintTotals===true}catch(_){}const n=Number(value||0);return enabled?Math.round(n):n}
  function money(value) {
    return (Number(value) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function invoiceDocumentMoney(value) {
    let enabled = false;
    try { enabled = JSON.parse(localStorage.getItem('cashtop_settings') || '{}').roundInvoicePrintTotals === true; } catch (_) {}
    return enabled ? String(Math.round(Number(value) || 0)) : money(value);
  }

  function documentItemChain(item) {
    const chain = window.CashtopMulti?.normalizeProductChain?.(item) || [];
    return chain.length ? chain : [{ id: 'piece', name: item?.pieceName || 'قطعة', factorToBase: 1 }];
  }

  function documentItemUnit(item, purchase = false) {
    const chain = documentItemChain(item);
    const unitId = purchase ? (item?.selectedUnitId || (item?.addType === 'unit' ? chain[chain.length - 1]?.id : chain[0]?.id)) : item?.selectedUnit;
    return chain.find(level => String(level.id) === String(unitId))
      || chain.find((_, index) => (unitId === 'piece' && index === 0) || (unitId === 'unit' && index === chain.length - 1))
      || chain[0];
  }

  function currencySymbol() {
    const currency = readJson('cashtop_settings', {}).currency || 'شيكل';
    return ({ شيكل: '₪', دولار: '$', دينار: 'JD', ريال: 'SR' })[currency] || currency;
  }

  function dateParts(value) {
    const date = new Date(value || Date.now());
    const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
    return {
      date: safeDate.toLocaleDateString('en-CA'),
      time: safeDate.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }),
      printed: new Date().toLocaleString('ar')
    };
  }

  function companyInfo() {
    const settings = readJson('cashtop_settings', {});
    const printer = readJson('cashtop_printer_settings', {});
    return {
      name: settings.companyName || 'كاش توب',
      address: settings.address || '',
      phone: settings.phone || '',
      logo: printer.showLogo === false ? '' : (settings.logo || 'cashtop-logo.png'),
      branch: (window.Cashtop?.getSession?.() || {}).branchName || 'Main Branch'
    };
  }

  function resolveProductImage(productId) {
    const products = readJson('cashtop_products', []);
    const product = Array.isArray(products)
      ? products.find(item => String(item.id) === String(productId))
      : null;
    return product?.image || product?.imageUrl || product?.photo || '';
  }

  function documentStyles() {
    return `<style>
      .ct-doc-invoice{width:794px;min-height:1123px;background:#fff;color:#111;padding:42px 32px 28px;direction:rtl;font-family:Arial,Tahoma,sans-serif;font-size:12px;position:relative;box-sizing:border-box}
      .ct-doc-invoice *{box-sizing:border-box}
      .ct-doc-header{display:grid;grid-template-columns:185px 1fr 190px;align-items:start;gap:18px;min-height:122px}
      .ct-doc-company-box{background:#e9f4fc;text-align:center;font-weight:700;padding:14px 8px;margin-top:0;color:#1d3557}
      .ct-doc-brand{text-align:center;min-height:120px}
      .ct-doc-logo{display:block;width:68px;height:68px;object-fit:contain;margin:0 auto 7px}
      .ct-doc-company-name{font-weight:700;font-size:15px;color:#1f2937}
      .ct-doc-company-sub{font-size:10px;color:#64748b;margin-top:4px}
      .ct-doc-meta{width:100%;border-collapse:collapse;font-size:11px}
      .ct-doc-meta td{padding:6px 7px;border:0}
      .ct-doc-meta .label{background:#e9f4fc;color:#1d3557;font-weight:700;width:76px;text-align:center}
      .ct-doc-meta .value{text-align:right;font-weight:700;white-space:nowrap}
      .ct-doc-rule{border-top:1px solid #9ca3af;margin:4px 0 13px}
      .ct-doc-title{text-align:center;font-weight:700;font-size:15px;color:#1f3b5c;padding:7px 0;border-bottom:1px solid #9ca3af;margin-bottom:14px}
      .ct-doc-party{display:grid;grid-template-columns:1fr 125px;gap:0;margin-left:auto;margin-right:0;width:285px;min-height:52px}
      .ct-doc-party .party-value{padding:8px 12px;text-align:right}
      .ct-doc-party .party-label{background:#e9f4fc;color:#1d3557;font-weight:700;padding:8px;text-align:center}
      .ct-doc-phone{width:170px;background:#e9f4fc;color:#1d3557;font-weight:700;text-align:center;padding:7px;margin:20px auto 10px}
      .ct-doc-items{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}
      .ct-doc-items th,.ct-doc-items td{border:1px solid #6b7280;padding:7px 5px;text-align:center;vertical-align:middle;overflow-wrap:anywhere}
      .ct-doc-items th{background:#e9f4fc;color:#1d3557;font-weight:700}
      .ct-doc-items th:nth-child(1){width:34px}.ct-doc-items th:nth-child(2){width:auto}.ct-doc-items th:nth-child(3){width:72px}.ct-doc-items th:nth-child(4){width:72px}.ct-doc-items th:nth-child(5){width:80px}.ct-doc-items th:nth-child(6){width:92px}.ct-doc-items th:nth-child(7){width:135px}
      .ct-doc-product-image{width:36px;height:36px;object-fit:contain;display:block;margin:auto}
      .ct-doc-summary{display:grid;grid-template-columns:1fr 1fr;gap:68px;margin-top:15px;align-items:start}
      .ct-doc-summary-table{width:100%;border-collapse:collapse;font-size:11px}
      .ct-doc-summary-table td{padding:6px 8px}
      .ct-doc-summary-table .sum-label{font-weight:700;text-align:right}
      .ct-doc-summary-table .sum-value{background:#e9f4fc;text-align:center;font-weight:700;width:105px;color:#1d3557}
      .ct-doc-note-row{display:grid;grid-template-columns:1fr 102px;gap:0;margin-top:18px;border-bottom:1px solid #9ca3af;min-height:66px}
      .ct-doc-note-row .note-value{padding:10px 8px}
      .ct-doc-note-row .note-label{background:#e9f4fc;color:#1d3557;text-align:center;font-weight:700;padding:10px 5px;height:28px}
      .ct-doc-signature{margin-top:62px;margin-left:auto;margin-right:0;width:190px;text-align:center;color:#1f3b5c;font-weight:700;line-height:2.1}
      .ct-doc-print-date{position:absolute;bottom:25px;left:0;right:0;text-align:center;font-weight:700;font-size:10px}
    </style>`;
  }

  function headerHtml(meta, title, company) {
    const logo = company.logo
      ? `<img class="ct-doc-logo" src="${esc(company.logo)}" alt="الشعار">`
      : '<div style="height:75px"></div>';
    return `
      <div class="ct-doc-header">
        <div class="ct-doc-company-box">${esc(company.name)}</div>
        <div class="ct-doc-brand">${logo}<div class="ct-doc-company-name">${esc(company.name)}</div><div class="ct-doc-company-sub">${esc(company.address)}${company.phone ? ` · ${esc(company.phone)}` : ''}</div></div>
        <table class="ct-doc-meta">
          <tr><td class="label">التاريخ</td><td class="value">${esc(meta.date)}</td></tr>
          <tr><td class="label">التوقيت</td><td class="value">${esc(meta.time)}</td></tr>
          <tr><td class="label">رقم الفاتورة</td><td class="value">${esc(meta.invoiceNo)}</td></tr>
          <tr><td class="label">العملة</td><td class="value">${esc(meta.currency)}</td></tr>
        </table>
      </div>
      <div class="ct-doc-rule"></div>
      <div class="ct-doc-title">${esc(title)}</div>`;
  }

  function itemsTable(items, purchase = false) {
    const rows = (items || []).map((item, index) => {
      const selectedLevel = documentItemUnit(item, purchase);
      const factor = Math.max(0.000001, Number(selectedLevel?.factorToBase || item.purchaseUnitFactor || 1));
      const purchasePieces = Number(item.quantityPieces ?? item.stockPieces ?? item.qty ?? 0);
      const qty = purchase
        ? Number(item.purchaseQuantity ?? item.inputQty ?? (purchasePieces / factor))
        : Number(item.qty || 0);
      const fallbackUnitCost = Number(item.purchaseCost ?? item.cost ?? item.price ?? 0) * factor;
      const price = purchase
        ? Number(item.purchaseUnitCost ?? (Number(item.inputQty || 0) > 0 && Number(item.totalLineCost || 0) > 0 ? Number(item.totalLineCost) / Number(item.inputQty) : fallbackUnitCost))
        : Number(item.price || 0);
      const unit = purchase
        ? (item.selectedUnitName || selectedLevel?.name || item.pieceName || 'قطعة')
        : (selectedLevel?.name || item.pieceName || 'قطعة');
      const image = item.image || item.imageUrl || resolveProductImage(item.productId || item.id);
      const imageCell = image ? `<img class="ct-doc-product-image" src="${esc(image)}" alt="صورة المنتج">` : '';
      return `<tr>
        <td>${index + 1}</td><td style="text-align:right">${esc(item.name || 'صنف')}</td><td>${esc(Number(qty.toFixed(6)).toString())}</td><td>${esc(unit)}</td><td>${money(price)}</td><td>${money(qty * price)}</td><td>${imageCell}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="padding:22px">لا توجد أصناف</td></tr>';
    return `<table class="ct-doc-items"><thead><tr><th>م</th><th>اسم المادة</th><th>العدد</th><th>الوحدة</th><th>السعر</th><th>الإجمالي</th><th>صورة المنتج</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function summaryTable(rows) {
    return `<table class="ct-doc-summary-table">${rows.map(row => `<tr><td class="sum-label">${esc(row[0])}</td><td class="sum-value">${esc(row[1])}</td></tr>`).join('')}</table>`;
  }

  function buildSales(invoice) {
    const company = companyInfo();
    const parts = dateParts(invoice.date);
    const currency = currencySymbol();
    const customers = readJson('cashtop_customers', []);
    const customer = Array.isArray(customers)
      ? customers.find(item => String(item.id) === String(invoice.customerId)) || customers.find(item => item.name === invoice.customer)
      : null;
    const itemCount = (invoice.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const currentBalance = Number(customer?.balance || 0);
    const previousBalance = Math.max(0, currentBalance - Number(invoice.debt || 0));
    const paymentTitle = Number(invoice.debt || 0) > 0 ? 'بيع - آجل' : 'بيع - نقدي';
    return `<div class="ct-doc-invoice">
      ${documentStyles()}
      ${headerHtml({ ...parts, invoiceNo: String(invoice.id || '').replace('INV_', ''), currency }, paymentTitle, company)}
      <div class="ct-doc-party"><div class="party-value">${esc(invoice.customer || 'عميل نقدي')}</div><div class="party-label">السيد</div><div class="party-value">${esc(customer?.address || '')}</div><div class="party-label">العنوان</div></div>
      <div class="ct-doc-phone">رقم الموبايل${invoice.phone ? `: ${esc(invoice.phone)}` : ''}</div>
      ${itemsTable(invoice.items || [], false)}
      <div class="ct-doc-summary">
        ${summaryTable([
          ['مجموع الحساب', `${money(itemCount)}`],
          ['رصيده قبل الفاتورة', `${money(previousBalance)} ${currency}`],
          ['رصيده بعد الفاتورة', `${money(previousBalance + Number(invoice.debt || 0))} ${currency}`],
          ['رصيد الحساب الحالي', `${money(currentBalance)} ${currency}`]
        ])}
        ${summaryTable([
          ['مجموع الفاتورة', `${invoiceDocumentMoney(invoiceDocumentAmount(Number(invoice.total || 0) + Number(invoice.discount || 0) - Number(invoice.tax || 0)))} ${currency}`],
          ['دفعة نقدية', `${invoiceDocumentMoney(invoiceDocumentAmount(invoice.paid))} ${currency}`],
          ['الخصم/الإضافة', `${money(Number(invoice.tax || 0) - Number(invoice.discount || 0))} ${currency}`],
          ['صافي الفاتورة', `${invoiceDocumentMoney(invoiceDocumentAmount(invoice.total))} ${currency}`]
        ])}
      </div>
      <div class="ct-doc-note-row"><div class="note-value">${esc(invoice.notes || '')}</div><div class="note-label">ملاحظات</div></div>
      <div class="ct-doc-signature">${esc(company.name)}<br>${esc(invoice.branchName || company.branch)}<br>[ التوقيع ]</div>
      <div class="ct-doc-print-date">تاريخ الطباعة: ${esc(parts.printed)}</div>
    </div>`;
  }

  function buildPurchase(invoice) {
    const company = companyInfo();
    const parts = dateParts(invoice.date);
    const currency = currencySymbol();
    const suppliers = readJson('cashtop_suppliers', []);
    const supplier = Array.isArray(suppliers)
      ? suppliers.find(item => String(item.id) === String(invoice.supplierId)) || suppliers.find(item => item.name === invoice.supplierName)
      : null;
    const itemCount = (invoice.items || []).reduce((sum, item) => sum + Number(item.quantityPieces || item.qty || 0), 0);
    const paymentTitle = Number(invoice.debt || 0) > 0 ? 'مشتريات - آجل' : 'مشتريات - نقدي';
    return `<div class="ct-doc-invoice">
      ${documentStyles()}
      ${headerHtml({ ...parts, invoiceNo: String(invoice.id || ''), currency }, paymentTitle, company)}
      <div class="ct-doc-party"><div class="party-value">${esc(invoice.supplierName || 'مورد')}</div><div class="party-label">السيد</div><div class="party-value">${esc(supplier?.address || '')}</div><div class="party-label">العنوان</div></div>
      <div class="ct-doc-phone">رقم الموبايل${supplier?.phone ? `: ${esc(supplier.phone)}` : ''}</div>
      ${itemsTable(invoice.items || [], true)}
      <div class="ct-doc-summary">
        ${summaryTable([
          ['مجموع الكميات', `${money(itemCount)}`],
          ['عدد الأصناف', `${Number(invoice.itemsCount || (invoice.items || []).length)}`],
          ['المدفوع', `${invoiceDocumentMoney(invoiceDocumentAmount(invoice.paid))} ${currency}`],
          ['المتبقي للمورد', `${invoiceDocumentMoney(invoiceDocumentAmount(invoice.debt))} ${currency}`]
        ])}
        ${summaryTable([
          ['مجموع الفاتورة', `${invoiceDocumentMoney(invoiceDocumentAmount(invoice.subtotal ?? invoice.total))} ${currency}`],
          ['خصم المورد', `${money(invoice.discount)} ${currency}`],
          ['الضريبة/الإضافة', `${money(invoice.tax)} ${currency}`],
          ['صافي الفاتورة', `${invoiceDocumentMoney(invoiceDocumentAmount(invoice.total))} ${currency}`]
        ])}
      </div>
      <div class="ct-doc-note-row"><div class="note-value">${esc(invoice.notes || '')}</div><div class="note-label">ملاحظات</div></div>
      <div class="ct-doc-signature">${esc(company.name)}<br>${esc(company.branch)}<br>[ توقيع المستلم ]</div>
      <div class="ct-doc-print-date">تاريخ الطباعة: ${esc(parts.printed)}</div>
    </div>`;
  }

  async function waitForImages(root) {
    const images = Array.from(root.querySelectorAll('img'));
    await Promise.all(images.map(image => {
      if (image.complete) return image.decode ? image.decode().catch(() => {}) : Promise.resolve();
      return new Promise(resolve => {
        const done = () => resolve();
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
        setTimeout(done, 3500);
      });
    }));
  }

  async function download(markup, filename) {
    if (typeof html2canvas !== 'function') throw new Error('مكتبة إنشاء الصورة غير متاحة');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#fff;';
    host.innerHTML = markup;
    document.body.appendChild(host);
    try {
      await document.fonts?.ready;
      await waitForImages(host);
      const target = host.querySelector('.ct-doc-invoice');
      const canvas = await html2canvas(target, {
        scale: 2.4,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: false,
        logging: false,
        windowWidth: 900,
        windowHeight: 1300
      });
      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL('image/png', 1);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      host.remove();
    }
  }

  window.CashtopInvoiceDocument = Object.freeze({
    buildSales,
    buildPurchase,
    download,
    escapeHtml: esc,
    money
  });
})();
