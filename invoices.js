'use strict';

const DB_KEY = 'cashtop_invoices';
let allInvoices = readArray(DB_KEY);
let pendingDeleteInvoiceId = null;
let deleteInvoiceInProgress = false;
let batchInvoiceSequence = 0;
let batchInvoiceSaveInProgress = false;
const invoiceSession = window.Cashtop?.getSession?.() || {};
const invoiceSessionBranchId = invoiceSession.branchId || null;

function visibleInvoices() {
  if (!invoiceSessionBranchId) return allInvoices;
  return allInvoices.filter(invoice => String(invoice.branchId || '') === String(invoiceSessionBranchId));
}

window.addEventListener('load', () => { initializeInvoiceReportFilters(); refreshInvoices(); });
window.addEventListener('storage', event => {
  if (event.key && event.key.includes(DB_KEY)) refreshInvoices();
});
window.addEventListener('cashtop:remote-applied', event => { if (!event.detail?.key || event.detail.key === DB_KEY) refreshInvoices(); });
window.addEventListener('cashtop:data-changed', event => { if (event.detail?.key === DB_KEY) refreshInvoices(); });
window.addEventListener('cashtop:sync-complete', refreshInvoices);

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch (error) {
    console.error(`تعذر قراءة ${key}`, error);
    return fallback;
  }
}

function readArray(key) {
  const value = readJson(key, []);
  return Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
}

function notify(message, type = 'info') {
  if (window.Cashtop?.showToast) window.Cashtop.showToast(message, type);
  else alert(message);
}

function can(permission) {
  return window.Cashtop?.can?.(permission) !== false;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function money(value) {
  return (Number(value) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function invoiceItemUnitChain(item) {
  if (item?.isVariant) return [{ id: 'piece', name: item.pieceName || 'قطعة', factorToBase: 1 }];
  const chain = window.CashtopMulti?.normalizeProductChain?.(item) || [];
  return chain.length ? chain : [{ id: 'piece', name: item?.pieceName || 'قطعة', factorToBase: 1 }];
}

function invoiceItemSelectedUnit(item) {
  const chain = invoiceItemUnitChain(item);
  return chain.find(level => String(level.id) === String(item?.selectedUnit))
    || chain.find((_, index) => (item?.selectedUnit === 'piece' && index === 0) || (item?.selectedUnit === 'unit' && index === chain.length - 1))
    || chain[0];
}

function invoiceItemUnitName(item) {
  return invoiceItemSelectedUnit(item)?.name || item?.pieceName || 'قطعة';
}

function invoiceItemFactor(item) {
  return Math.max(0.000001, Number(invoiceItemSelectedUnit(item)?.factorToBase || 1));
}

function getSystemSettings() {
  return readJson('cashtop_settings', {});
}

function getPrinterSettings() {
  return {
    printType: 'thermal-80',
    printCopies: 1,
    showLogo: true,
    showFooterText: true,
    ...readJson('cashtop_printer_settings', {})
  };
}

function currencyLabel() {
  const currency = getSystemSettings().currency || 'شيكل';
  return ({ شيكل: '₪', دولار: '$', دينار: 'JD', ريال: 'SR' })[currency] || currency;
}

function refreshInvoices() {
  allInvoices = readArray(DB_KEY);
  const displayInvoices = visibleInvoices();
  if (document.getElementById('invoicePeriodFilter')) filterTable();
  else renderTable(displayInvoices);
  updateStats(displayInvoices);
}

function invoiceDateValue(invoice) {
  const date = new Date(invoice?.date || invoice?.createdAt || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function selectedInvoiceReportRange() {
  const mode = document.getElementById('invoicePeriodFilter')?.value || 'all';
  const now = new Date();
  if (mode === 'all') return { mode, from: null, to: null, label: 'كل الفواتير' };
  if (mode === 'daily') {
    return { mode, from: startOfDay(now), to: endOfDay(now), label: `اليوم ${now.toLocaleDateString('ar')}` };
  }
  if (mode === 'weekly') {
    const from = startOfDay(now);
    from.setDate(from.getDate() - from.getDay());
    const to = endOfDay(from);
    to.setDate(to.getDate() + 6);
    return { mode, from, to, label: `الأسبوع ${from.toLocaleDateString('ar')} - ${to.toLocaleDateString('ar')}` };
  }
  if (mode === 'monthly') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { mode, from, to, label: `الشهر ${from.toLocaleDateString('ar', { month: 'long', year: 'numeric' })}` };
  }
  if (mode === 'yearly') {
    const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { mode, from, to, label: `السنة ${now.getFullYear()}` };
  }
  const fromInput = document.getElementById('invoiceDateFrom')?.value || '';
  const toInput = document.getElementById('invoiceDateTo')?.value || '';
  const from = fromInput ? startOfDay(new Date(`${fromInput}T00:00:00`)) : null;
  const to = toInput ? endOfDay(new Date(`${toInput}T00:00:00`)) : null;
  const label = `من ${from ? from.toLocaleDateString('ar') : 'البداية'} إلى ${to ? to.toLocaleDateString('ar') : 'اليوم'}`;
  return { mode: 'custom', from, to, label };
}

function filterInvoicesBySelectedPeriod(source = visibleInvoices()) {
  const range = selectedInvoiceReportRange();
  return source.filter(invoice => {
    if (!range.from && !range.to) return true;
    const date = invoiceDateValue(invoice);
    if (!date) return false;
    if (range.from && date < range.from) return false;
    if (range.to && date > range.to) return false;
    return true;
  });
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initializeInvoiceReportFilters() {
  const iso = localDateInputValue(new Date());
  const from = document.getElementById('invoiceDateFrom');
  const to = document.getElementById('invoiceDateTo');
  if (from && !from.value) from.value = iso;
  if (to && !to.value) to.value = iso;
  handleInvoicePeriodChange(false);
}

function handleInvoicePeriodChange(runFilter = true) {
  const mode = document.getElementById('invoicePeriodFilter')?.value || 'all';
  document.querySelectorAll('.custom-invoice-range').forEach(element => {
    element.style.display = mode === 'custom' ? 'flex' : 'none';
  });
  const label = document.getElementById('invoiceReportPeriodLabel');
  if (label) label.textContent = selectedInvoiceReportRange().label;
  if (runFilter) filterTable();
}

function invoiceStatusText(invoice) {
  const debt = Number(invoice?.debt || 0);
  const paid = Number(invoice?.paid || 0);
  if (invoice?.status === 'draft') return 'معلقة';
  if (debt <= 0) return 'مدفوعة بالكامل';
  if (paid > 0) return 'مدفوعة جزئياً';
  return 'غير مدفوعة';
}

function reportInvoices() {
  return filterInvoicesBySelectedPeriod(visibleInvoices()).slice().sort((a, b) => (invoiceDateValue(b)?.getTime() || 0) - (invoiceDateValue(a)?.getTime() || 0));
}

function invoiceReportRowsHtml(invoices) {
  return invoices.map(invoice => `<tr>
    <td>#${escapeHtml(String(invoice.id || '').replace('INV_', ''))}</td>
    <td>${escapeHtml(invoice.customer || 'عميل نقدي')}</td>
    <td>${escapeHtml(invoice.paymentMethod || 'كاش')}</td>
    <td>${escapeHtml(invoiceStatusText(invoice))}</td>
    <td>${escapeHtml(invoice.user || 'مدير النظام')}</td>
    <td>${money(invoice.total)}</td>
    <td>${money(invoice.paid)}</td>
    <td>${money(invoice.debt)}</td>
    <td>${escapeHtml(invoiceDateValue(invoice)?.toLocaleString('en-GB') || '-')}</td>
  </tr>`).join('');
}

function invoiceReportHeaderHtml(range) {
  const settings = getSystemSettings();
  const logo = settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="شعار المحل" style="width:72px;height:72px;object-fit:contain">` : '';
  return `<div class="report-brand">${logo}<div><h1>${escapeHtml(settings.companyName || 'كاش توب')}</h1><div>تقرير فواتير المبيعات</div><small>${escapeHtml(range.label)}</small></div></div>`;
}

function invoiceReportSummary(invoices) {
  return invoices.reduce((acc, invoice) => {
    acc.total += Number(invoice.total || 0);
    acc.paid += Number(invoice.paid || 0);
    acc.debt += Number(invoice.debt || 0);
    return acc;
  }, { total: 0, paid: 0, debt: 0 });
}

function downloadInvoiceReportBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function exportInvoicesExcel() {
  const invoices = reportInvoices();
  if (!invoices.length) return notify('لا توجد فواتير ضمن الفترة المحددة للتصدير', 'warning');
  const range = selectedInvoiceReportRange();
  const summary = invoiceReportSummary(invoices);
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    body{font-family:Cairo,Arial,sans-serif;direction:rtl}.report-brand{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:18px;text-align:center}.report-brand h1{margin:0;font-size:22px}.report-brand small{display:block;margin-top:6px;color:#555}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #777;padding:7px;text-align:center}th{background:#e8eef7;font-weight:700}.summary td{font-weight:700;background:#f3f4f6}
  </style></head><body>${invoiceReportHeaderHtml(range)}<table><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>طريقة الدفع</th><th>الحالة</th><th>الموظف / المدير</th><th>الإجمالي</th><th>المدفوع</th><th>الدين</th><th>التاريخ</th></tr></thead><tbody>${invoiceReportRowsHtml(invoices)}<tr class="summary"><td colspan="5">الإجماليات (${invoices.length} فاتورة)</td><td>${money(summary.total)}</td><td>${money(summary.paid)}</td><td>${money(summary.debt)}</td><td>${escapeHtml(range.label)}</td></tr></tbody></table></body></html>`;
  const filename = `فواتير_المبيعات_${new Date().toISOString().slice(0, 10)}.xls`;
  downloadInvoiceReportBlob('﻿' + html, filename, 'application/vnd.ms-excel;charset=utf-8');
  notify('تم تجهيز ملف Excel لتفاصيل سجل الفواتير خلال الفترة المحددة', 'success');
}

async function exportInvoicesPdf() {
  const invoices = reportInvoices();
  if (!invoices.length) return notify('لا توجد فواتير ضمن الفترة المحددة للتصدير', 'warning');
  if (!window.CashtopExport?.exportHtmlPagesToPDF) return notify('وحدة تصدير PDF غير متاحة حالياً', 'error');
  const range = selectedInvoiceReportRange();
  const summary = invoiceReportSummary(invoices);
  const chunkSize = 22;
  const chunks = [];
  for (let i = 0; i < invoices.length; i += chunkSize) chunks.push(invoices.slice(i, i + chunkSize));
  const pages = chunks.map((chunk, index) => `<section dir="rtl" style="font-family:Cairo,Arial,sans-serif;padding:28px 34px;background:#fff;color:#111;min-height:100%;box-sizing:border-box">
    <style>.report-brand{display:flex;align-items:center;justify-content:center;gap:16px;text-align:center;margin-bottom:16px}.report-brand h1{margin:0;font-size:24px}.report-brand small{display:block;color:#64748b;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #cbd5e1;padding:7px 5px;text-align:center}th{background:#e2e8f0;font-weight:800}.report-footer{margin-top:14px;display:flex;justify-content:space-between;font-size:11px;color:#475569}.summary-box{display:flex;gap:14px;justify-content:center;margin:12px 0}.summary-box span{border:1px solid #94a3b8;border-radius:6px;padding:7px 12px;font-weight:700}</style>
    ${invoiceReportHeaderHtml(range)}
    ${index === 0 ? `<div class="summary-box"><span>عدد الفواتير: ${invoices.length}</span><span>الإجمالي: ${money(summary.total)}</span><span>المدفوع: ${money(summary.paid)}</span><span>الدين: ${money(summary.debt)}</span></div>` : ''}
    <table><thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>طريقة الدفع</th><th>الحالة</th><th>الموظف / المدير</th><th>الإجمالي</th><th>المدفوع</th><th>الدين</th><th>التاريخ</th></tr></thead><tbody>${invoiceReportRowsHtml(chunk)}</tbody></table>
    <div class="report-footer"><span>${escapeHtml(getSystemSettings().companyName || 'كاش توب')}</span><span>صفحة ${index + 1} من ${chunks.length}</span></div>
  </section>`);
  try {
    await window.CashtopExport.exportHtmlPagesToPDF(pages, `فواتير_المبيعات_${new Date().toISOString().slice(0, 10)}`, { orientation: 'landscape', format: 'a4', scale: 1.4 });
    notify('تم تنزيل تقرير PDF للفواتير خلال الفترة المحددة', 'success');
  } catch (error) {
    console.error(error);
    notify('تعذر إنشاء ملف PDF. تحقق من تحميل الشعار ومكتبات التصدير.', 'error');
  }
}

let invoiceStatsSequence = 0;
function updateStats(source = visibleInvoices()) {
  const sequence = ++invoiceStatsSequence;
  const todayStr = new Date().toLocaleDateString('en-GB');
  const fallback = () => source.reduce((acc, invoice) => {
    acc.totalSales += Number(invoice.total) || 0;
    acc.totalPaid += Number(invoice.paid) || 0;
    acc.totalDebt += Number(invoice.debt) || 0;
    if (new Date(invoice.date).toLocaleDateString('en-GB') === todayStr) acc.todayCount += 1;
    return acc;
  }, { totalSales: 0, totalPaid: 0, totalDebt: 0, todayCount: 0 });
  const apply = stats => {
    if (sequence !== invoiceStatsSequence) return;
    document.getElementById('stat-total-sales').innerText = money(stats.totalSales);
    document.getElementById('stat-total-paid').innerText = money(stats.totalPaid);
    document.getElementById('stat-total-debt').innerText = money(stats.totalDebt);
    document.getElementById('stat-today-count').innerText = stats.todayCount;
  };
  if (source.length >= 1000 && window.Cashtop?.runWorkerTask) {
    window.Cashtop.runWorkerTask('invoice-stats', { records: source, today: todayStr }, fallback).then(apply).catch(() => apply(fallback()));
  } else apply(fallback());
}

let invoiceRenderSequence = 0;
function renderTable(data) {
  const tbody = document.getElementById('invoices-tbody');
  if (!tbody) return;
  const source = Array.isArray(data) ? data : [];
  const sequence = ++invoiceRenderSequence;
  const fallbackSort = () => source.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const renderSorted = sorted => {
    if (sequence !== invoiceRenderSequence) return;
    const createRow = invoice => {
      const debt = Number(invoice.debt) || 0;
      const paid = Number(invoice.paid) || 0;
      const statusBadge = invoice.status === 'draft'
        ? '<span class="badge-partial">معلقة</span>'
        : debt <= 0 ? '<span class="badge-paid">مدفوعة بالكامل</span>'
        : paid > 0 ? '<span class="badge-partial">مدفوعة جزئياً</span>'
        : '<span class="badge-unpaid">غير مدفوعة</span>';
      const paymentIcon = invoice.paymentMethod === 'فيزا' ? '<i class="fa-solid fa-credit-card"></i>' : '<i class="fa-solid fa-money-bill-1"></i>';
      const safeId = escapeHtml(invoice.id);
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><a href="#" class="invoice-link" onclick="event.preventDefault(); openInvoiceModal('${safeId}')">#${escapeHtml(String(invoice.id).replace('INV_', ''))}</a></td>
        <td>${escapeHtml(invoice.customer || 'عميل نقدي')}</td>
        <td>${paymentIcon} ${escapeHtml(invoice.paymentMethod || 'كاش')}</td>
        <td>${statusBadge}</td>
        <td><span class="badge-user"><i class="fa-solid fa-user"></i> ${escapeHtml(invoice.user || 'مدير النظام')}</span></td>
        <td><strong>${money(invoice.total)}</strong></td>
        <td>${money(invoice.paid)}</td>
        <td style="${debt > 0 ? 'color:#dd4b39;font-weight:bold;' : ''}">${money(debt)}</td>
        <td dir="ltr">${new Date(invoice.date).toLocaleDateString('en-GB')}</td>
        <td><div class="actions-wrapper">
          <button class="action-btn btn-view" title="عرض" onclick="openInvoiceModal('${safeId}')"><i class="fa-solid fa-eye"></i></button>
          ${can('sales.edit') ? `<button class="action-btn btn-edit" title="تعديل" onclick="editInvoice('${safeId}')"><i class="fa-solid fa-pen-to-square"></i></button>` : ''}
          ${can('sales.print') ? `<button class="action-btn btn-print" title="طباعة حرارية" onclick="printInvoice('${safeId}')"><i class="fa-solid fa-print"></i></button>` : ''}
          ${can('sales.image') ? `<button class="action-btn btn-image" title="تنزيل صورة الفاتورة" onclick="downloadAsImage('${safeId}')"><i class="fa-solid fa-image"></i></button>` : ''}
          <button class="action-btn btn-whatsapp" title="إرسال الفاتورة عبر واتساب" onclick="sendInvoiceMessage('${safeId}','whatsapp')"><i class="fa-brands fa-whatsapp"></i></button><button class="action-btn btn-sms" title="إرسال الفاتورة عبر SMS" onclick="sendInvoiceMessage('${safeId}','sms')"><i class="fa-solid fa-comment-sms"></i></button>
          ${can('sales.delete') ? `<button class="action-btn btn-delete" title="حذف وعكس الحركة" onclick="deleteInvoice('${safeId}')"><i class="fa-solid fa-trash-can"></i></button>` : ''}
        </div></td>`;
      return row;
    };
    if (window.Cashtop?.renderVirtualRows) {
      window.Cashtop.renderVirtualRows(tbody, sorted, createRow, {
        chunkSize: 80, eagerLimit: 160, colspan: 10,
        emptyHtml: '<tr><td colspan="10" style="padding:20px;color:#999;text-align:center">لا توجد فواتير</td></tr>'
      });
    } else {
      tbody.innerHTML = '';
      sorted.forEach(invoice => tbody.appendChild(createRow(invoice)));
    }
  };
  if (source.length >= 1000 && window.Cashtop?.runWorkerTask) {
    window.Cashtop.runWorkerTask('sort-date-desc', { records: source, field: 'date' }, fallbackSort).then(renderSorted).catch(() => renderSorted(fallbackSort()));
  } else renderSorted(fallbackSort());
}

let invoiceSearchSequence = 0;
function filterTable() {
  const value = document.getElementById('searchInput').value.toLowerCase().trim();
  const source = filterInvoicesBySelectedPeriod(visibleInvoices());
  const periodLabel = document.getElementById('invoiceReportPeriodLabel');
  if (periodLabel) periodLabel.textContent = selectedInvoiceReportRange().label;
  const sequence = ++invoiceSearchSequence;
  const fallback = () => source.filter(invoice =>
    String(invoice.id).toLowerCase().includes(value) ||
    String(invoice.customer || '').toLowerCase().includes(value) ||
    String(invoice.user || '').toLowerCase().includes(value)
  );
  if (source.length < 800 || !window.Cashtop?.runWorkerTask) {
    renderTable(fallback());
    return;
  }
  window.Cashtop.runWorkerTask('filter-records', { records: source, query: value, fields: ['id', 'customer', 'user'] }, fallback)
    .then(filtered => { if (sequence === invoiceSearchSequence) renderTable(filtered); })
    .catch(() => { if (sequence === invoiceSearchSequence) renderTable(fallback()); });
}

function invoiceMarkup(invoice, options = {}) {
  const settings = getSystemSettings();
  const printer = getPrinterSettings();
  const compact = options.compact === true;
  const showLogo = options.showLogo !== false && printer.showLogo !== false && settings.logo;
  const currency = currencyLabel();
  const items = (invoice.items || []).map(item => {
    const variant = item.isVariant
      ? ` <small>(${escapeHtml(item.variantSize || '')}${item.variantColor ? ` - ${escapeHtml(item.variantColor)}` : ''})</small>`
      : '';
    const unit = invoiceItemUnitName(item);
    return `<tr>
      <td>${escapeHtml(item.name || 'صنف')}${variant}</td>
      <td>${escapeHtml(item.qty)} ${unit}</td>
      <td>${money(item.price)}</td>
      <td>${money((Number(item.qty) || 0) * (Number(item.price) || 0))}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4">لا توجد أصناف</td></tr>';

  return `<div class="invoice-receipt ${compact ? 'compact-receipt' : ''}">
    <div class="receipt-brand">
      ${showLogo ? `<img class="receipt-logo" style="display:block;margin:0 auto 8px;object-fit:contain;" src="${escapeHtml(settings.logo)}" alt="شعار الشركة">` : ''}
      <h2>${escapeHtml(settings.companyName || 'كاش توب')}</h2>
      <p>${escapeHtml(settings.address || '')}${settings.phone ? ` · ${escapeHtml(settings.phone)}` : ''}</p>
      <strong>فاتورة مبيعات #${escapeHtml(String(invoice.id).replace('INV_', ''))}</strong>
    </div>
    <div class="receipt-meta">
      <div class="receipt-meta-pair"><span><strong>التاريخ:</strong> <span dir="ltr">${new Date(invoice.date).toLocaleString('en-GB')}</span></span><span><strong>الكاشير:</strong> ${escapeHtml(invoice.user || 'مدير النظام')}</span></div>
      <div class="receipt-meta-pair"><span><strong>العميل:</strong> ${escapeHtml(invoice.customer || 'عميل نقدي')}</span><span><strong>الدفع:</strong> ${escapeHtml(invoice.paymentMethod || 'كاش')} ${invoice.accountName ? `· ${escapeHtml(invoice.accountName)}` : ''}</span></div>
      ${invoice.branchName ? `<div><strong>الفرع:</strong> ${escapeHtml(invoice.branchName)}</div>` : ''}
    </div>
    <table class="receipt-table">
      <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
      <tbody>${items}</tbody>
    </table>
    <div class="receipt-totals">
      ${(Number(invoice.discount) || 0) > 0 ? `<div class="receipt-total-row"><span>الخصم</span><strong>- ${money(invoice.discount)} ${currency}</strong></div>` : ''}
      ${(Number(invoice.tax) || 0) > 0 ? `<div class="receipt-total-row"><span>الضريبة</span><strong>${money(invoice.tax)} ${currency}</strong></div>` : ''}
      <div class="receipt-total-row final"><span>الإجمالي النهائي</span><strong>${money(invoice.total)} ${currency}</strong></div>
      <div class="receipt-total-row"><span>المدفوع</span><strong>${money(invoice.paid)} ${currency}</strong></div>
      <div class="receipt-total-row"><span>المتبقي</span><strong>${money(invoice.debt)} ${currency}</strong></div>
    </div>
    ${invoice.notes ? `<div class="receipt-notes"><strong>ملاحظات:</strong> ${escapeHtml(invoice.notes)}</div>` : ''}
    ${printer.showFooterText !== false ? '<div class="receipt-footer">شكراً لتعاملكم معنا · يرجى الاحتفاظ بالفاتورة</div>' : ''}
  </div>`;
}

function openInvoiceModal(id) {
  const invoice = allInvoices.find(item => String(item.id) === String(id));
  if (!invoice) return;
  document.getElementById('modal-inv-id').textContent = `تفاصيل فاتورة #${String(invoice.id).replace('INV_', '')}`;
  document.getElementById('invoice-capture-area').innerHTML = invoiceMarkup(invoice);
  document.getElementById('viewModal').classList.add('active');
}

function closeViewModal(event) {
  if (event.target.id === 'viewModal') event.currentTarget.classList.remove('active');
}

function editInvoice(id) {
  if (!can('sales.edit')) return notify('لا تملك صلاحية تعديل الفواتير', 'error');
  window.location.href = `cashier.html?edit=${encodeURIComponent(id)}`;
}

async function printInvoice(id) {
  if (!can('sales.print')) return notify('لا تملك صلاحية طباعة الفواتير', 'error');
  const invoice = allInvoices.find(item => String(item.id) === String(id));
  if (!invoice) return;
  if (!window.CashtopPrinter?.printInvoice) return notify('وحدة الطباعة الحرارية غير متاحة حالياً', 'error');
  try {
    const result = await window.CashtopPrinter.printInvoice(invoice);
    if (result?.mode === 'bluetooth') notify('تم إرسال الفاتورة مباشرة إلى طابعة Bluetooth', 'success');
  } catch (error) {
    console.error(error);
    notify(error?.message || 'تعذر بدء الطباعة', 'error');
  }
}

async function downloadAsImage(id) {
  if (!can('sales.image')) return notify('لا تملك صلاحية تنزيل صورة الفاتورة', 'error');
  const invoice = allInvoices.find(item => String(item.id) === String(id));
  if (!invoice) return;
  if (!window.CashtopInvoiceDocument) return notify('قالب صورة الفاتورة غير متاح حالياً', 'error');
  try {
    const markup = window.CashtopInvoiceDocument.buildSales(invoice);
    await window.CashtopInvoiceDocument.download(markup, `فاتورة_مبيعات_${String(id).replace(/[^\w\-\u0600-\u06FF]/g, '_')}.png`);
    notify('تم تنزيل صورة الفاتورة بالنموذج الرسمي', 'success');
  } catch (error) {
    console.error(error);
    notify('تعذر إنشاء صورة الفاتورة. تأكد من أن رابط الشعار يسمح بالتحميل.', 'error');
  }
}

function invoiceMessageTemplate() {
  return localStorage.getItem('cashtop_invoice_message_template') ||
    'مرحباً {name}، فاتورتك رقم {invoice} لدى {store}.\nالأصناف:\n{items}\nالإجمالي: {total}، المدفوع: {paid}، المتبقي: {balance}.';
}

function invoiceItemsText(invoice) {
  const currency = currencyLabel();
  return (invoice.items || []).map((item, index) => {
    const qty = Number(item.qty || 0);
    const lineTotal = qty * Number(item.price || 0);
    return `${index + 1}- ${item.name || 'صنف'} × ${Number(qty.toFixed(6))} = ${money(lineTotal)} ${currency}`;
  }).join('\n') || 'لا توجد أصناف';
}

function fillInvoiceMessage(invoice) {
  const settings = getSystemSettings();
  const replacements = {
    name: invoice.customer || 'العميل',
    phone: invoice.phone || '',
    store: settings.companyName || 'كاش توب',
    date: new Date(invoice.date || Date.now()).toLocaleDateString('ar'),
    invoice: String(invoice.id || '').replace('INV_', ''),
    total: `${money(invoice.total)} ${currencyLabel()}`,
    paid: `${money(invoice.paid)} ${currencyLabel()}`,
    balance: `${money(invoice.debt)} ${currencyLabel()}`,
    payment: invoice.paymentMethod || 'كاش',
    items: invoiceItemsText(invoice)
  };
  return invoiceMessageTemplate().replace(/\{(name|phone|store|date|invoice|total|paid|balance|payment|items)\}/g, (_, key) => replacements[key] ?? '');
}

function normalizeMessagePhone(phone) {
  let value = String(phone || '').trim().replace(/[^\d+]/g, '');
  if (value.startsWith('00')) value = value.slice(2);
  if (value.startsWith('+')) value = value.slice(1);
  return value;
}

function sendInvoiceMessage(id, channel) {
  const invoice = allInvoices.find(item => String(item.id) === String(id));
  if (!invoice) return;
  const phone = normalizeMessagePhone(invoice.phone);
  if (!phone) return notify('لا يوجد رقم جوال محفوظ لهذا العميل', 'error');
  const message = fillInvoiceMessage(invoice);
  if (channel === 'whatsapp') {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    return;
  }
  window.location.href = `sms:${phone}?body=${encodeURIComponent(message)}`;
}

function deleteInvoice(id) {
  if (!can('sales.delete')) return notify('لا تملك صلاحية حذف الفواتير', 'error');
  const invoice = allInvoices.find(item => String(item.id) === String(id));
  if (!invoice) return;
  pendingDeleteInvoiceId = invoice.id;
  document.getElementById('deleteInvoiceNumber').textContent = `#${String(invoice.id).replace('INV_', '')}`;
  document.getElementById('deleteModal').classList.add('active');
}

function hideDeleteModal() {
  pendingDeleteInvoiceId = null;
  document.getElementById('deleteModal').classList.remove('active');
}

function closeDeleteModal(event) {
  if (event.target.id === 'deleteModal') hideDeleteModal();
}

function confirmDeleteInvoice() {
  if (!pendingDeleteInvoiceId || !can('sales.delete') || deleteInvoiceInProgress) return;
  // نقرأ أحدث نسخة قبل العكس حتى لا نعمل على مصفوفة قديمة بعد مزامنة أو فتح
  // الصفحة في جهاز آخر.
  allInvoices = readArray(DB_KEY);
  const invoice = allInvoices.find(item => String(item.id) === String(pendingDeleteInvoiceId));
  if (!invoice) return hideDeleteModal();

  const snapshotKeys = [DB_KEY, 'cashtop_products', 'cashtop_customers', 'cashtop_funds_db', 'cashtop_sales_offers'];
  const snapshots = Object.fromEntries(snapshotKeys.map(key => [key, localStorage.getItem(key)]));
  const confirmButton = document.querySelector('#deleteModal .btn-confirm-delete');
  deleteInvoiceInProgress = true;
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.style.opacity = '.65';
    confirmButton.style.pointerEvents = 'none';
  }

  try {
    const reversed = reverseInvoiceMovements(invoice) || {};
    allInvoices = readArray(DB_KEY).filter(item => String(item.id) !== String(invoice.id));
    const changes = { [DB_KEY]: allInvoices };
    if (reversed.products) changes.cashtop_products = reversed.products;
    if (reversed.customers) changes.cashtop_customers = reversed.customers;
    if (reversed.funds) changes.cashtop_funds_db = reversed.funds;
    if (reversed.offersChanged) changes.cashtop_sales_offers = reversed.offers;
    if (window.Cashtop?.atomicSetItems) window.Cashtop.atomicSetItems(changes, { label: 'delete-sales-invoice' });
    else Object.entries(changes).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
    hideDeleteModal();
    refreshInvoices();
    notify('تم حذف الفاتورة وعكس حركة المخزون والحسابات', 'success');
  } catch (error) {
    console.error('تعذر عكس الفاتورة', error);
    snapshotKeys.forEach(key => {
      const value = snapshots[key];
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    allInvoices = readArray(DB_KEY);
    refreshInvoices();
    notify('تعذر حذف الفاتورة، وتم التراجع عن أي حركة جزئية لحماية المخزون والحسابات', 'error');
  } finally {
    deleteInvoiceInProgress = false;
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.style.opacity = '';
      confirmButton.style.pointerEvents = '';
    }
  }
}

function reverseInvoiceMovements(invoice) {
  if (invoice.status === 'draft') return;

  const products = readJson('cashtop_products', []);
  const branches = readJson('cashtop_branches', []);
  const branchId = invoice.branchId || null;
  const isMainBranch = !branchId || branches.find(branch => String(branch.id) === String(branchId))?.isMain === true ||
    (!branches.some(branch => branch.isMain === true) && String(branches[0]?.id || '') === String(branchId));

  (invoice.items || []).forEach(item => {
    if (item.isCustom) return;
    const product = products.find(entry => String(entry.id) === String(item.id));
    if (!product) return;
    const quantity = Number(item.qty) || 0;
    const pieces = quantity * invoiceItemFactor(item);

    if (item.isVariant && Array.isArray(product.variants)) {
      const variant = product.variants.find(entry =>
        String(entry.size) === String(item.variantSize) &&
        String(entry.color) === String(item.variantColor)
      );
      if (!variant) return;
      if (isMainBranch) {
        variant.qty = (Number(variant.qty) || 0) + quantity;
        product.stockPieces = (Number(product.stockPieces) || 0) + pieces;
      } else {
        if (!variant.branchStocks || typeof variant.branchStocks !== 'object') variant.branchStocks = {};
        variant.branchStocks[branchId] = (Number(variant.branchStocks[branchId]) || 0) + quantity;
      }
      return;
    }

    if (isMainBranch) {
      product.stockPieces = (Number(product.stockPieces) || 0) + pieces;
    } else {
      if (!product.branchStocks || typeof product.branchStocks !== 'object') product.branchStocks = {};
      product.branchStocks[branchId] = (Number(product.branchStocks[branchId]) || 0) + pieces;
    }
  });

  const customers = readJson('cashtop_customers', []);
  const customer = customers.find(entry => String(entry.id) === String(invoice.customerId)) ||
    customers.find(entry => entry.name === invoice.customer);
  if (customer && Number(invoice.debt) > 0) {
    customer.balance = (Number(customer.balance) || 0) - Number(invoice.debt);
    if (Array.isArray(customer.debtInvoices)) {
      customer.debtInvoices = customer.debtInvoices.filter(entry => String(entry?.invoiceId) !== String(invoice.id));
    }
  }

  const funds = readJson('cashtop_funds_db', { accounts: [], accountLogs: [] });
  if (!Array.isArray(funds.accounts)) funds.accounts = [];
  if (!Array.isArray(funds.accountLogs)) funds.accountLogs = [];
  const account = funds.accounts.find(entry => String(entry.id) === String(invoice.accountId)) ||
    (!invoice.accountId ? funds.accounts[0] : null);
  if (account && Number(invoice.paid) > 0) {
    const currencyCfg = window.CashtopMulti?.getCurrencyConfig?.() || { baseCurrencyId: 'ILS' };
    const accountCurrencyId = account.currencyId || invoice.accountCurrencyId || currencyCfg.baseCurrencyId;
    const reversalNative = Number.isFinite(Number(invoice.accountAmountNative))
      ? Number(invoice.accountAmountNative)
      : (window.CashtopMulti?.accountAmountFromBase?.(Number(invoice.paid), accountCurrencyId) ?? Number(invoice.paid));
    account.balance = (Number(account.balance) || 0) - reversalNative;
    funds.accountLogs.push({
      id: `LOG_DELETE_SALE_${invoice.id}_${Date.now()}`,
      sourceType: 'sale-delete',
      sourceId: invoice.id,
      accountId: account.id,
      date: new Date().toISOString(),
      type: 'سحب',
      amount: reversalNative,
      baseAmount: Number(invoice.paid),
      currencyId: accountCurrencyId,
      transactionAmount: Number(invoice.paidNative ?? invoice.paid),
      transactionCurrencyId: invoice.currencyId || currencyCfg.baseCurrencyId,
      notes: `عكس تحصيل فاتورة بيع محذوفة [${invoice.id}]`
    });
  }

  const offers = readJson('cashtop_sales_offers', []);
  let offersChanged = false;
  (invoice.offerIds || []).forEach(offerId => {
    const offer = offers.find(entry => String(entry.id) === String(offerId));
    if (offer) {
      offer.used = Math.max(0, Number(offer.used || 0) - 1);
      offersChanged = true;
    }
  });
  return { products, customers, funds, offers, offersChanged };
}

// =============================================================
// ترحيل مجموعة فواتير مبيعات — كل بطاقة تحفظ كفاتورة مستقلة
// =============================================================
const BATCH_DRAFT_VERSION = 2;
let batchInvoiceDraftTimer = null;
let batchInvoiceDraftRestoring = false;
let batchSuggestionListenersReady = false;

function batchNormalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar');
}

function batchNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function batchDisplayNumber(value) {
  const number = Number(value) || 0;
  return Number(number.toFixed(6)).toString();
}

function batchLocalDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function batchEffectiveBranchId() {
  if (window.Cashtop?.branchIdFromSession) return window.Cashtop.branchIdFromSession(invoiceSession);
  return invoiceSession.dataBranchId || invoiceSession.branchId || 'MAIN';
}

function batchBranchName(branchId = batchEffectiveBranchId()) {
  const branches = readArray('cashtop_branches');
  if (!branchId || String(branchId) === 'MAIN') {
    return branches.find(branch => branch.isMain === true)?.name || 'الفرع الرئيسي';
  }
  return branches.find(branch => String(branch.id) === String(branchId))?.name || 'الفرع';
}

function batchDraftStorageKey() {
  const companyId = invoiceSession.companyId || invoiceSession.companyKey || 'company';
  const branchId = batchEffectiveBranchId() || 'MAIN';
  return `cashtop_batch_sales_draft_v${BATCH_DRAFT_VERSION}_${encodeURIComponent(String(companyId))}_${encodeURIComponent(String(branchId))}`;
}

function batchReadFunds() {
  const funds = readJson('cashtop_funds_db', { accounts: [], accountLogs: [] });
  if (!Array.isArray(funds.accounts)) funds.accounts = [];
  if (!Array.isArray(funds.accountLogs)) funds.accountLogs = [];
  return funds;
}

function batchAccountOptions(selectedId = '') {
  const accounts = batchReadFunds().accounts.filter(account => account && typeof account === 'object');
  if (!accounts.length) return '<option value="">لا توجد صناديق مسجلة</option>';
  const effectiveSelected = selectedId !== '' && selectedId != null ? String(selectedId) : String(accounts[0].id);
  return accounts.map(account => {
    const selected = String(account.id) === effectiveSelected ? ' selected' : '';
    const balance = batchDisplayNumber(account.balance || 0);
    return `<option value="${escapeHtml(account.id)}"${selected}>${escapeHtml(account.name || 'صندوق')} — الرصيد ${escapeHtml(balance)}</option>`;
  }).join('');
}

function batchCloseSuggestionBoxes(except = null) {
  document.querySelectorAll('.batch-suggestions.active').forEach(box => {
    if (box !== except) box.classList.remove('active');
  });
}

function batchSuggestionTextMatch(values, query) {
  return values.some(value => batchNormalizeText(value).includes(query));
}

function batchRenderCustomerSuggestions(input) {
  const box = input?.closest('.batch-autocomplete')?.querySelector('.batch-suggestions');
  if (!box) return;
  const query = batchNormalizeText(input.value);
  if (!query) {
    box.innerHTML = '';
    box.classList.remove('active');
    return;
  }
  const customers = readArray('cashtop_customers')
    .filter(customer => batchSuggestionTextMatch([customer.name, customer.phone], query))
    .slice(0, 10);
  box.innerHTML = '';
  customers.forEach(customer => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'batch-suggestion-option';
    option.innerHTML = `<span><strong>${escapeHtml(customer.name || 'عميل')}</strong><small>${escapeHtml(customer.phone || 'بدون رقم جوال')}</small></span><i class="fa-solid fa-user-check"></i>`;
    option.addEventListener('pointerdown', event => event.preventDefault());
    option.addEventListener('click', () => selectBatchCustomerSuggestion(input, customer));
    box.appendChild(option);
  });
  if (!customers.length) {
    const empty = document.createElement('div');
    empty.className = 'batch-suggestion-empty';
    empty.textContent = 'لا يوجد عميل مطابق؛ سيُضاف الاسم كعميل جديد عند الترحيل.';
    box.appendChild(empty);
  }
  batchCloseSuggestionBoxes(box);
  box.classList.add('active');
}

function batchRenderProductSuggestions(input) {
  const box = input?.closest('.batch-autocomplete')?.querySelector('.batch-suggestions');
  if (!box) return;
  const query = batchNormalizeText(input.value);
  if (!query) {
    box.innerHTML = '';
    box.classList.remove('active');
    return;
  }
  const products = readArray('cashtop_products')
    .filter(product => batchSuggestionTextMatch([
      product.name,
      product.barcodePiece,
      product.barcode,
      product.unitBarcode
    ], query))
    .slice(0, 12);
  box.innerHTML = '';
  products.forEach(product => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'batch-suggestion-option';
    const code = product.barcodePiece || product.barcode || product.unitBarcode || 'بدون باركود';
    const stock = batchDisplayNumber(product.stockPieces || 0);
    option.innerHTML = `<span><strong>${escapeHtml(product.name || 'صنف')}</strong><small>${escapeHtml(code)} · المخزون ${escapeHtml(stock)}</small></span><i class="fa-solid fa-box"></i>`;
    option.addEventListener('pointerdown', event => event.preventDefault());
    option.addEventListener('click', () => selectBatchProductSuggestion(input, product));
    box.appendChild(option);
  });
  if (!products.length) {
    const empty = document.createElement('div');
    empty.className = 'batch-suggestion-empty';
    empty.textContent = 'الصنف غير موجود بالمخزون؛ سيُحفظ في الفاتورة كصنف حر دون خصم مخزون.';
    box.appendChild(empty);
  }
  batchCloseSuggestionBoxes(box);
  box.classList.add('active');
}

function showBatchCustomerSuggestions(input) {
  batchRenderCustomerSuggestions(input);
}

function showBatchProductSuggestions(input) {
  batchRenderProductSuggestions(input);
}

function selectBatchCustomerSuggestion(input, customer) {
  const card = input?.closest('.batch-invoice-card');
  if (!card) return;
  input.value = customer.name || '';
  input.dataset.customerId = customer.id != null ? String(customer.id) : '';
  const phoneInput = card.querySelector('.batch-customer-phone');
  if (phoneInput) phoneInput.value = customer.phone || '';
  batchCloseSuggestionBoxes();
  scheduleBatchDraftSave();
}

function selectBatchProductSuggestion(input, product) {
  const row = input?.closest('.batch-item-row');
  if (!row) return;
  input.value = product.name || '';
  input.dataset.productId = product.id != null ? String(product.id) : '';
  const priceInput = row.querySelector('.batch-item-price');
  if (priceInput) priceInput.value = batchDisplayNumber(product.pricePiece ?? product.price ?? 0);
  const barcodeInput = row.querySelector('.batch-product-barcode');
  if (barcodeInput) barcodeInput.value = product.barcodePiece || product.barcode || product.unitBarcode || '';
  batchCloseSuggestionBoxes();
  recalculateBatchInvoice(input);
}

function setupBatchSuggestionListeners() {
  if (batchSuggestionListenersReady) return;
  batchSuggestionListenersReady = true;
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.batch-autocomplete')) batchCloseSuggestionBoxes();
  });
  window.addEventListener('beforeunload', saveBatchDraftNow);
}

function refreshBatchSuggestions() {
  document.querySelectorAll('#batchInvoicesContainer .batch-account-select').forEach(select => {
    const selected = select.value;
    select.innerHTML = batchAccountOptions(selected);
  });
}

function batchSerializeDraft() {
  const cards = [...document.querySelectorAll('#batchInvoicesContainer .batch-invoice-card')];
  return {
    version: BATCH_DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
    invoices: cards.map(card => ({
      customerName: card.querySelector('.batch-customer-name')?.value || '',
      customerId: card.querySelector('.batch-customer-name')?.dataset?.customerId || '',
      phone: card.querySelector('.batch-customer-phone')?.value || '',
      date: card.querySelector('.batch-invoice-date')?.value || '',
      paid: card.querySelector('.batch-invoice-paid')?.value || '',
      accountId: card.querySelector('.batch-account-select')?.value || '',
      items: [...card.querySelectorAll('.batch-item-row')].map(row => ({
        name: row.querySelector('.batch-product-name')?.value || '',
        productId: row.querySelector('.batch-product-name')?.dataset?.productId || '',
        barcode: row.querySelector('.batch-product-barcode')?.value || '',
        qty: row.querySelector('.batch-item-qty')?.value || '',
        price: row.querySelector('.batch-item-price')?.value || ''
      }))
    }))
  };
}

function saveBatchDraftNow() {
  if (batchInvoiceDraftRestoring || batchInvoiceSaveInProgress) return;
  const container = document.getElementById('batchInvoicesContainer');
  if (!container || !container.children.length) return;
  try {
    localStorage.setItem(batchDraftStorageKey(), JSON.stringify(batchSerializeDraft()));
  } catch (error) {
    console.warn('تعذر حفظ مسودة ترحيل المبيعات', error);
  }
}

function scheduleBatchDraftSave() {
  if (batchInvoiceDraftRestoring || batchInvoiceSaveInProgress) return;
  clearTimeout(batchInvoiceDraftTimer);
  batchInvoiceDraftTimer = setTimeout(saveBatchDraftNow, 180);
}

function clearBatchDraft() {
  clearTimeout(batchInvoiceDraftTimer);
  batchInvoiceDraftTimer = null;
  try { localStorage.removeItem(batchDraftStorageKey()); } catch (_) {}
}

function restoreBatchDraft() {
  const container = document.getElementById('batchInvoicesContainer');
  if (!container || container.children.length) return false;
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(batchDraftStorageKey()) || 'null'); } catch (_) {}
  if (!draft || draft.version !== BATCH_DRAFT_VERSION || !Array.isArray(draft.invoices) || !draft.invoices.length) return false;
  batchInvoiceDraftRestoring = true;
  try {
    container.innerHTML = '';
    draft.invoices.forEach(invoice => addBatchInvoice(invoice, { scroll: false, persist: false }));
    updateBatchInvoiceNumbers();
    return true;
  } finally {
    batchInvoiceDraftRestoring = false;
  }
}

function openBatchInvoiceModal() {
  if (!can('sales.create')) return notify('لا تملك صلاحية إنشاء فواتير مبيعات', 'error');
  setupBatchSuggestionListeners();
  const container = document.getElementById('batchInvoicesContainer');
  const restored = restoreBatchDraft();
  if (container && !container.children.length) addBatchInvoice({}, { scroll: false, persist: false });
  refreshBatchSuggestions();
  document.getElementById('batchInvoiceModal')?.classList.add('active');
  document.body.style.overflow = 'hidden';
  if (restored) notify('تمت استعادة بيانات فواتير المبيعات غير المرحلة', 'info');
  setTimeout(() => container?.querySelector('.batch-customer-name')?.focus(), 60);
}

function hideBatchInvoiceModal(options = {}) {
  if (options.persist !== false) saveBatchDraftNow();
  batchCloseSuggestionBoxes();
  document.getElementById('batchInvoiceModal')?.classList.remove('active');
  document.body.style.overflow = '';
}

function closeBatchInvoiceModal(event) {
  if (event.target?.id === 'batchInvoiceModal' && !batchInvoiceSaveInProgress) hideBatchInvoiceModal();
}

function batchInvoiceTemplate(sequence, preset = {}) {
  const selectedAccountId = preset.accountId || '';
  return `<section class="batch-invoice-card" data-batch-invoice="${sequence}">
    <div class="batch-invoice-head">
      <div class="batch-invoice-title"><i class="fa-solid fa-file-invoice-dollar"></i><span>فاتورة مبيعات <b class="batch-invoice-number">1</b></span></div>
      <button type="button" class="batch-remove-invoice" onclick="removeBatchInvoice(this)"><i class="fa-solid fa-trash-can"></i><span>حذف الفاتورة</span></button>
    </div>
    <div class="batch-invoice-body">
      <div class="batch-two-grid">
        <div class="batch-field"><label>اسم العميل</label><div class="batch-autocomplete"><input class="batch-input batch-customer-name" type="text" autocomplete="off" placeholder="اكتب حرفاً لعرض الاقتراحات" value="${escapeHtml(preset.customerName || '')}" onfocus="showBatchCustomerSuggestions(this)" oninput="handleBatchCustomerInput(this)"><div class="batch-suggestions" role="listbox"></div></div></div>
        <div class="batch-field"><label>رقم الجوال</label><input class="batch-input batch-customer-phone" type="tel" inputmode="tel" placeholder="اختياري" value="${escapeHtml(preset.phone || '')}" oninput="scheduleBatchDraftSave()"></div>
        <div class="batch-field"><label>التاريخ</label><input class="batch-input batch-invoice-date" type="datetime-local" value="${escapeHtml(preset.date || batchLocalDateTimeValue())}" oninput="scheduleBatchDraftSave()"></div>
        <div class="batch-field"><label>الصندوق المحصل عليه</label><select class="batch-input batch-account-select" onchange="scheduleBatchDraftSave()">${batchAccountOptions(selectedAccountId)}</select></div>
        <div class="batch-field"><label>المدفوع من المبلغ</label><input class="batch-input batch-invoice-paid" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0" value="${escapeHtml(preset.paid || '')}" oninput="recalculateBatchInvoice(this)"></div>
        <div class="batch-field"><label>الإجمالي</label><input class="batch-input batch-invoice-total" type="text" value="0" readonly></div>
        <div class="batch-field"><label>الباقي كدين</label><input class="batch-input batch-invoice-debt" type="text" value="0" readonly></div>
        <div class="batch-field"><label>حالة الدفع</label><input class="batch-input batch-payment-status" type="text" value="غير مدفوعة" readonly></div>
      </div>
      <div class="batch-items-box">
        <div class="batch-items-head"><strong><i class="fa-solid fa-box-open"></i> الأصناف</strong><button type="button" class="batch-add-item" onclick="addBatchItem(this.closest('.batch-invoice-card'))"><i class="fa-solid fa-plus"></i> إضافة صنف</button></div>
        <div class="batch-items-list"></div>
      </div>
    </div>
  </section>`;
}

function addBatchInvoice(preset = {}, options = {}) {
  const container = document.getElementById('batchInvoicesContainer');
  if (!container) return;
  batchInvoiceSequence += 1;
  container.insertAdjacentHTML('beforeend', batchInvoiceTemplate(batchInvoiceSequence, preset));
  const card = container.lastElementChild;
  const customerInput = card?.querySelector('.batch-customer-name');
  if (customerInput && preset.customerId) customerInput.dataset.customerId = String(preset.customerId);
  const items = Array.isArray(preset.items) && preset.items.length ? preset.items : [{}];
  items.forEach(item => addBatchItem(card, item, { persist: false }));
  recalculateBatchInvoice(card, { persist: false });
  updateBatchInvoiceNumbers();
  if (options.scroll !== false) card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (options.persist !== false) scheduleBatchDraftSave();
}

function removeBatchInvoice(button) {
  const container = document.getElementById('batchInvoicesContainer');
  const card = button?.closest('.batch-invoice-card');
  if (!container || !card) return;
  if (container.children.length === 1) {
    card.querySelectorAll('input:not([readonly])').forEach(input => {
      input.value = input.classList.contains('batch-invoice-date') ? batchLocalDateTimeValue() : '';
      delete input.dataset.customerId;
      delete input.dataset.productId;
    });
    const account = card.querySelector('.batch-account-select');
    if (account && account.options.length) account.selectedIndex = 0;
    card.querySelector('.batch-items-list').innerHTML = '';
    addBatchItem(card, {}, { persist: false });
    recalculateBatchInvoice(card);
    return notify('تم تفريغ الفاتورة. يجب إبقاء بطاقة واحدة على الأقل.', 'info');
  }
  card.remove();
  updateBatchInvoiceNumbers();
  scheduleBatchDraftSave();
}

function updateBatchInvoiceNumbers() {
  const cards = [...document.querySelectorAll('#batchInvoicesContainer .batch-invoice-card')];
  cards.forEach((card, index) => {
    const label = card.querySelector('.batch-invoice-number');
    if (label) label.textContent = String(index + 1);
  });
  const summary = document.getElementById('batchInvoicesSummary');
  if (summary) summary.textContent = cards.length === 1 ? 'فاتورة واحدة جاهزة للترحيل' : `${cards.length} فواتير ستُحفظ بصورة منفصلة`;
}

function addBatchItem(card, preset = {}, options = {}) {
  if (!card) return;
  const list = card.querySelector('.batch-items-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'batch-item-row';
  row.innerHTML = `
    <div class="batch-field"><label>الصنف</label><div class="batch-autocomplete"><input class="batch-input batch-product-name" type="text" autocomplete="off" placeholder="اكتب حرفاً لعرض الاقتراحات" value="${escapeHtml(preset.name || '')}" onfocus="showBatchProductSuggestions(this)" oninput="handleBatchProductInput(this)"><div class="batch-suggestions" role="listbox"></div></div></div>
    <div class="batch-field"><label>الباركود</label><input class="batch-input batch-product-barcode" type="text" inputmode="none" autocomplete="off" placeholder="ضع المؤشر وامسح الباركود" value="${escapeHtml(preset.barcode || '')}" oninput="handleBatchBarcodeInput(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();handleBatchBarcodeInput(this,true)}"></div>
    <div class="batch-field"><label>الكمية</label><input class="batch-input batch-item-qty" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0" value="${escapeHtml(preset.qty || '')}" oninput="recalculateBatchInvoice(this)"></div>
    <div class="batch-field"><label>السعر</label><input class="batch-input batch-item-price" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0" value="${escapeHtml(preset.price || '')}" oninput="recalculateBatchInvoice(this)"></div>
    <div class="batch-field"><label>الإجمالي</label><input class="batch-input batch-item-total" type="text" value="0" readonly></div>
    <button type="button" class="batch-remove-item" title="حذف الصنف" onclick="removeBatchItem(this)"><i class="fa-solid fa-xmark"></i></button>`;
  list.appendChild(row);
  if (preset.productId) row.querySelector('.batch-product-name').dataset.productId = String(preset.productId);
  recalculateBatchInvoice(card, { persist: options.persist !== false });
}

function removeBatchItem(button) {
  const card = button?.closest('.batch-invoice-card');
  const list = button?.closest('.batch-items-list');
  if (!card || !list) return;
  if (list.children.length === 1) {
    list.firstElementChild.querySelectorAll('input:not([readonly])').forEach(input => {
      input.value = '';
      delete input.dataset.productId;
    });
  } else {
    button.closest('.batch-item-row')?.remove();
  }
  recalculateBatchInvoice(card);
}

function handleBatchCustomerInput(input) {
  const card = input?.closest('.batch-invoice-card');
  if (!card) return;
  const customers = readArray('cashtop_customers');
  const normalized = batchNormalizeText(input.value);
  const match = customers.find(customer => batchNormalizeText(customer.name) === normalized);
  input.dataset.customerId = match?.id ? String(match.id) : '';
  const phoneInput = card.querySelector('.batch-customer-phone');
  if (match && phoneInput) phoneInput.value = match.phone || '';
  batchRenderCustomerSuggestions(input);
  scheduleBatchDraftSave();
}

function handleBatchProductInput(input) {
  const row = input?.closest('.batch-item-row');
  if (!row) return;
  const products = readArray('cashtop_products');
  const normalized = batchNormalizeText(input.value);
  const match = products.find(product => batchNormalizeText(product.name) === normalized);
  input.dataset.productId = match?.id ? String(match.id) : '';
  const priceInput = row.querySelector('.batch-item-price');
  if (match && priceInput && !priceInput.value.trim()) {
    priceInput.value = batchDisplayNumber(match.pricePiece ?? match.price ?? 0);
  }
  batchRenderProductSuggestions(input);
  recalculateBatchInvoice(input);
}

function batchProductBarcodes(product) {
  const codes = [product?.barcodePiece, product?.pieceBarcode, product?.barcode, product?.unitBarcode, product?.barcodeInUnit]
    .filter(Boolean).map(value => String(value).trim());
  (product?.variants || []).forEach(variant => {
    if (variant?.barcode) codes.push(String(variant.barcode).trim());
  });
  return [...new Set(codes.filter(Boolean))];
}

function handleBatchBarcodeInput(input, force = false) {
  const row = input?.closest('.batch-item-row');
  if (!row) return false;
  const code = String(input.value || '').trim();
  if (!code) return false;
  const products = readArray('cashtop_products');
  const product = products.find(item => batchProductBarcodes(item).some(value => value === code));
  if (!product) {
    if (force) notify(`لم يتم العثور على منتج بالباركود ${code}`, 'warning');
    return false;
  }
  const nameInput = row.querySelector('.batch-product-name');
  const priceInput = row.querySelector('.batch-item-price');
  if (nameInput) {
    nameInput.value = product.name || '';
    nameInput.dataset.productId = product.id != null ? String(product.id) : '';
  }
  if (priceInput) priceInput.value = batchDisplayNumber(product.pricePiece ?? product.price ?? 0);
  recalculateBatchInvoice(input);
  row.querySelector('.batch-item-qty')?.focus();
  return true;
}

function recalculateBatchInvoice(source, options = {}) {
  const card = source?.classList?.contains('batch-invoice-card') ? source : source?.closest?.('.batch-invoice-card');
  if (!card) return;
  let total = 0;
  card.querySelectorAll('.batch-item-row').forEach(row => {
    const qty = batchNumber(row.querySelector('.batch-item-qty')?.value);
    const price = batchNumber(row.querySelector('.batch-item-price')?.value);
    const lineTotal = qty * price;
    total += lineTotal;
    const lineInput = row.querySelector('.batch-item-total');
    if (lineInput) lineInput.value = batchDisplayNumber(lineTotal);
  });
  const requestedPaid = batchNumber(card.querySelector('.batch-invoice-paid')?.value);
  const paid = Math.min(total, requestedPaid);
  const debt = Math.max(0, total - paid);
  const totalInput = card.querySelector('.batch-invoice-total');
  const debtInput = card.querySelector('.batch-invoice-debt');
  const statusInput = card.querySelector('.batch-payment-status');
  if (totalInput) totalInput.value = batchDisplayNumber(total);
  if (debtInput) debtInput.value = batchDisplayNumber(debt);
  if (statusInput) statusInput.value = total <= 0 ? 'غير مدفوعة' : debt <= 0 ? 'مدفوعة بالكامل' : paid > 0 ? 'مدفوعة جزئياً' : 'آجلة بالكامل';
  if (options.persist !== false) scheduleBatchDraftSave();
}

function batchFindProduct(products, itemInput) {
  const id = itemInput?.dataset?.productId;
  if (id) {
    const byId = products.find(product => String(product.id) === String(id));
    if (byId && batchNormalizeText(byId.name) === batchNormalizeText(itemInput.value)) return byId;
  }
  const barcode = itemInput?.closest('.batch-item-row')?.querySelector('.batch-product-barcode')?.value?.trim();
  if (barcode) {
    const byBarcode = products.find(product => batchProductBarcodes(product).some(value => value === barcode));
    if (byBarcode) return byBarcode;
  }
  const normalized = batchNormalizeText(itemInput?.value);
  return normalized ? products.find(product => batchNormalizeText(product.name) === normalized) : null;
}

function batchConsumeLots(product, quantity) {
  if (!Array.isArray(product?.inventoryLots) || quantity <= 0) return [];
  let remaining = quantity;
  const allocations = [];
  const lots = product.inventoryLots
    .filter(lot => Number(lot?.remainingPieces ?? lot?.quantityPieces ?? 0) > 0)
    .sort((a, b) => {
      const aExpiry = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      const bExpiry = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      return aExpiry - bExpiry || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
  lots.forEach(lot => {
    if (remaining <= 0) return;
    const available = Math.max(0, Number(lot.remainingPieces ?? lot.quantityPieces ?? 0));
    const used = Math.min(available, remaining);
    if (used <= 0) return;
    lot.remainingPieces = Math.max(0, available - used);
    allocations.push({ lotId: lot.id, quantityPieces: used, expiryDate: lot.expiryDate || '', batchNumber: lot.batchNumber || '' });
    remaining -= used;
  });
  return allocations;
}

function batchBuildItem(row, products, invoiceSeed) {
  const nameInput = row.querySelector('.batch-product-name');
  const rawName = nameInput?.value.trim() || '';
  const qty = batchNumber(row.querySelector('.batch-item-qty')?.value);
  const price = batchNumber(row.querySelector('.batch-item-price')?.value);
  if (!rawName && qty === 0 && price === 0) return null;

  const product = batchFindProduct(products, nameInput);
  const hasVariants = Boolean(product?.hasVariants || (Array.isArray(product?.variants) && product.variants.length));
  const availableStock = Math.max(0, Number(product?.stockPieces || 0));
  // الصنف غير الموجود أو غير المتوفر بكمية كافية يُحفظ كصنف حر في الفاتورة.
  // بذلك لا تفشل عملية الترحيل ولا يحدث خصم جزئي غير قابل للعكس.
  const canTrackStock = Boolean(product && !hasVariants && (qty <= 0 || qty <= availableStock + 1e-9));
  const item = {
    id: canTrackStock ? product.id : `CUSTOM_BATCH_${invoiceSeed}_${Math.random().toString(36).slice(2, 7)}`,
    sourceProductId: product?.id || null,
    name: rawName || product?.name || 'صنف',
    price,
    referencePrice: price,
    cost: canTrackStock ? Number(product.cost || 0) : 0,
    qty,
    selectedUnit: 'piece',
    unitName: product?.unitName || 'وحدة',
    pieceName: product?.pieceName || 'قطعة',
    piecesPerUnit: 1,
    isCustom: !canTrackStock,
    stockNotDeducted: !canTrackStock,
    isVariant: false
  };
  if (canTrackStock && qty > 0) {
    item.lotAllocations = batchConsumeLots(product, qty);
    product.stockPieces = Math.max(0, Number(product.stockPieces || 0) - qty);
  }
  return item;
}

function batchResolveCustomer(card, customers, debt, invoiceDate, invoiceId) {
  const nameInput = card.querySelector('.batch-customer-name');
  const phoneInput = card.querySelector('.batch-customer-phone');
  const enteredName = nameInput?.value.trim() || '';
  const phone = phoneInput?.value.trim() || '';

  if (!enteredName && debt <= 0) return { customer: null, name: 'عميل نقدي', phone };

  const effectiveName = enteredName || `عميل غير مسجل ${String(invoiceId).replace('INV_', '#')}`;
  let customer = null;
  const selectedId = nameInput?.dataset?.customerId;
  if (selectedId) customer = customers.find(entry => String(entry.id) === String(selectedId));
  if (!customer && enteredName) customer = customers.find(entry => batchNormalizeText(entry.name) === batchNormalizeText(enteredName));
  if (!customer) {
    customer = {
      id: `C_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: effectiveName,
      phone,
      group: 'retail',
      balance: 0,
      createdAt: new Date().toISOString()
    };
    customers.push(customer);
  } else if (phone) {
    customer.phone = phone;
  }
  if (debt > 0) customer.balance = (Number(customer.balance) || 0) + debt;
  customer.lastPurchaseAt = invoiceDate;
  return { customer, name: customer.name || effectiveName, phone: phone || customer.phone || '' };
}

function batchRecordCustomerDebt(customer, invoice, debt) {
  if (!customer || debt <= 0) return;
  if (!Array.isArray(customer.debtInvoices)) customer.debtInvoices = [];
  customer.debtInvoices = customer.debtInvoices.filter(entry => String(entry?.invoiceId) !== String(invoice.id));
  customer.debtInvoices.push({
    id: `CUSTOMER_DEBT_${invoice.id}`,
    invoiceId: invoice.id,
    date: invoice.date,
    total: invoice.total,
    paid: invoice.paid,
    amount: debt,
    remaining: debt,
    status: 'open',
    sourceType: 'sale'
  });
}

function batchCreateUniqueInvoiceId(existingIds, seed) {
  let next = Number(seed) || Date.now();
  let id = `INV_${next}`;
  while (existingIds.has(id)) {
    next += 1;
    id = `INV_${next}`;
  }
  existingIds.add(id);
  return id;
}

function setBatchSaveBusy(busy) {
  batchInvoiceSaveInProgress = Boolean(busy);
  const button = document.getElementById('saveBatchInvoicesButton');
  if (!button) return;
  button.disabled = Boolean(busy);
  button.innerHTML = busy
    ? '<i class="fa-solid fa-spinner fa-spin"></i> جاري الترحيل...'
    : '<i class="fa-solid fa-check-double"></i> ترحيل كل الفواتير';
}

function resetBatchInvoiceModal(options = {}) {
  const container = document.getElementById('batchInvoicesContainer');
  if (!container) return;
  batchInvoiceDraftRestoring = true;
  try {
    container.innerHTML = '';
    addBatchInvoice({}, { scroll: false, persist: false });
    refreshBatchSuggestions();
  } finally {
    batchInvoiceDraftRestoring = false;
  }
  if (options.keepDraft !== true) clearBatchDraft();
}

function saveBatchInvoices() {
  if (batchInvoiceSaveInProgress) return;
  if (!can('sales.create')) return notify('لا تملك صلاحية إنشاء فواتير مبيعات', 'error');
  const cards = [...document.querySelectorAll('#batchInvoicesContainer .batch-invoice-card')];
  if (!cards.length) return notify('أضف فاتورة واحدة على الأقل', 'error');

  cards.forEach(card => recalculateBatchInvoice(card, { persist: false }));
  const hasDebt = cards.some(card => batchNumber(card.querySelector('.batch-invoice-debt')?.value) > 0);
  if (hasDebt && !can('sales.credit')) return notify('لا تملك صلاحية تسجيل فواتير مبيعات آجلة أو ديون', 'error');

  const snapshotKeys = [DB_KEY, 'cashtop_products', 'cashtop_customers', 'cashtop_funds_db'];
  const snapshots = Object.fromEntries(snapshotKeys.map(key => [key, localStorage.getItem(key)]));
  setBatchSaveBusy(true);

  try {
    const invoices = readArray(DB_KEY);
    const products = readArray('cashtop_products');
    const customers = readArray('cashtop_customers');
    const funds = batchReadFunds();
    const existingIds = new Set(invoices.map(invoice => String(invoice.id)));
    const branchId = batchEffectiveBranchId();
    const branchName = batchBranchName(branchId);
    const userName = invoiceSession.displayName || invoiceSession.username || 'مستخدم';
    const baseSeed = Date.now();
    const created = [];

    cards.forEach((card, index) => {
      const dateValue = card.querySelector('.batch-invoice-date')?.value;
      const parsedDate = dateValue ? new Date(dateValue) : new Date(baseSeed + index);
      const invoiceDate = Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date(baseSeed + index).toISOString();
      const id = batchCreateUniqueInvoiceId(existingIds, baseSeed + index);
      const items = [...card.querySelectorAll('.batch-item-row')]
        .map(row => batchBuildItem(row, products, id))
        .filter(Boolean);
      const total = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
      const requestedPaid = batchNumber(card.querySelector('.batch-invoice-paid')?.value);
      const paid = Math.min(total, requestedPaid);
      const debt = Math.max(0, total - paid);
      const accountId = card.querySelector('.batch-account-select')?.value || '';
      const account = funds.accounts.find(entry => String(entry.id) === String(accountId)) || null;
      if (paid > 0 && !account) throw new Error(`اختر الصندوق الذي استلم مبلغ الفاتورة رقم ${index + 1}`);
      const customerInfo = batchResolveCustomer(card, customers, debt, invoiceDate, id);

      const invoice = {
        id,
        status: 'issued',
        date: invoiceDate,
        customer: customerInfo.name,
        customerId: customerInfo.customer?.id || null,
        phone: customerInfo.phone,
        accountId: account?.id || null,
        accountName: account?.name || '',
        paymentMethod: debt > 0 && paid > 0 ? 'دفع جزئي' : debt > 0 ? 'آجل' : 'كاش',
        user: userName,
        branchId,
        branchName,
        items,
        subtotal: total,
        discount: 0,
        manualDiscount: 0,
        offerDiscount: 0,
        offerIds: [],
        tax: 0,
        taxSettings: {},
        total,
        paid,
        debt,
        notes: 'فاتورة مرحلة من سجل المبيعات'
      };

      batchRecordCustomerDebt(customerInfo.customer, invoice, debt);
      if (account && paid > 0) {
        const currencyCfg = window.CashtopMulti?.getCurrencyConfig?.() || { baseCurrencyId: 'ILS' };
        const settlement = window.CashtopMulti?.settleToAccount?.(paid, currencyCfg.baseCurrencyId, account)
          || { accountAmount: paid, accountCurrencyId: account.currencyId || currencyCfg.baseCurrencyId, baseAmount: paid };
        account.balance = (Number(account.balance) || 0) + Number(settlement.accountAmount || 0);
        invoice.accountCurrencyId = settlement.accountCurrencyId;
        invoice.accountAmountNative = Number(settlement.accountAmount || 0);
        invoice.currencyId = currencyCfg.baseCurrencyId;
        invoice.paidNative = paid;
        funds.accountLogs.push({
          id: `LOG_SALE_${id}_${baseSeed + index}`,
          sourceType: 'sale',
          sourceId: id,
          accountId: account.id,
          date: invoiceDate,
          type: 'إيداع',
          amount: Number(settlement.accountAmount || 0),
          baseAmount: paid,
          currencyId: settlement.accountCurrencyId,
          transactionAmount: paid,
          transactionCurrencyId: currencyCfg.baseCurrencyId,
          notes: `تحصيل فاتورة بيع مرحلة [${id}] من [${customerInfo.name}]`
        });
      }
      invoices.push(invoice);
      created.push(invoice);
    });

    const batchChanges = {
      cashtop_products: products,
      cashtop_customers: customers,
      cashtop_funds_db: funds,
      [DB_KEY]: invoices
    };
    if (window.Cashtop?.atomicSetItems) window.Cashtop.atomicSetItems(batchChanges, { label: 'batch-sales-invoices' });
    else Object.entries(batchChanges).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));

    clearBatchDraft();
    allInvoices = readArray(DB_KEY);
    refreshInvoices();
    resetBatchInvoiceModal();
    hideBatchInvoiceModal({ persist: false });
    clearBatchDraft();
    notify(`تم ترحيل ${created.length} فاتورة مبيعات؛ كل دفعة أضيفت للصندوق المختار وكل دين رُبط بفاتورته على العميل`, 'success');
    window.CashtopFirebaseSync?.scheduleSync?.(100);
  } catch (error) {
    console.error('تعذر ترحيل فواتير المبيعات', error);
    snapshotKeys.forEach(key => {
      const value = snapshots[key];
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
    refreshInvoices();
    saveBatchDraftNow();
    notify(error?.message || 'تعذر ترحيل الفواتير، وتم التراجع عن العملية لحماية البيانات', 'error');
  } finally {
    setBatchSaveBusy(false);
  }
}

