(function () {
  'use strict';
  if (!window.Cashtop) return;

  const SOURCE_KEYS = new Set([
    'cashtop_invoices', 'cashtop_purchases', 'cashtop_purchase_returns',
    'cashtop_expenses', 'cashtop_vouchers', 'cashtop_workers'
  ]);

  const parse = (key, fallback = []) => {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (_) { return fallback; }
  };
  const n = value => Number.parseFloat(value) || 0;
  const text = (value, fallback = '') => (value == null || value === '') ? fallback : String(value);

  function line(entryId, sourceType, sourceId, date, accountCode, accountName, debit, credit, description, extra = {}) {
    return {
      id: `${entryId}_${accountCode}_${Math.random().toString(36).slice(2, 7)}`,
      entryId,
      sourceType,
      sourceId,
      date: date || new Date().toISOString(),
      accountCode,
      accountName,
      debit: Number(n(debit).toFixed(2)),
      credit: Number(n(credit).toFixed(2)),
      description,
      ...extra
    };
  }

  function invoiceCost(invoice) {
    return (invoice.items || []).reduce((sum, item) => {
      const quantity = n(item.qty);
      const factor = window.CashtopMulti?.factorForUnit?.(item, item.selectedUnit)
        ?? (item.selectedUnit === 'unit' ? n(item.piecesPerUnit || 1) : 1);
      const pieces = quantity * Math.max(0.000001, n(factor) || 1);
      const costPerPiece = Number.isFinite(Number(item.costPerPiece))
        ? n(item.costPerPiece)
        : n(item.cost || item.costPrice || 0);
      return sum + pieces * costPerPiece;
    }, 0);
  }

  function buildJournal() {
    const journal = [];

    parse('cashtop_invoices').filter(inv => inv && inv.status !== 'draft').forEach(inv => {
      const id = text(inv.id, `INV_${Date.now()}`);
      const total = n(inv.total);
      const paid = Math.min(total, n(inv.paid));
      const debt = Math.max(0, n(inv.debt || (total - paid)));
      const date = inv.date;
      const customer = text(inv.customer, 'عميل نقدي');
      const cashCode = text(inv.accountId, 'ACC_CASH_MAIN');
      const cashName = text(inv.accountName, 'صندوق الكاش الرئيسي');
      const entryId = `JE_SALE_${id}`;
      if (paid) journal.push(line(entryId, 'sale', id, date, cashCode, cashName, paid, 0, `المبلغ المقبوض من فاتورة البيع ${id}`, { partyType: 'customer', partyName: customer }));
      if (debt) journal.push(line(entryId, 'sale', id, date, '1100', 'ذمم العملاء', debt, 0, `المبلغ الآجل من فاتورة البيع ${id}`, { partyType: 'customer', partyId: inv.customerId || null, partyName: customer }));
      if (total) journal.push(line(entryId, 'sale', id, date, '4100', 'إيرادات المبيعات', 0, total, `إثبات فاتورة البيع ${id}`, { partyType: 'customer', partyName: customer }));
      const cost = invoiceCost(inv);
      if (cost) {
        journal.push(line(`${entryId}_COGS`, 'sale-cost', id, date, '5100', 'تكلفة البضاعة المباعة', cost, 0, `تكلفة أصناف فاتورة البيع ${id}`));
        journal.push(line(`${entryId}_COGS`, 'sale-cost', id, date, '1200', 'المخزون', 0, cost, `إخراج مخزون فاتورة البيع ${id}`));
      }
    });

    parse('cashtop_purchases').forEach(inv => {
      const id = text(inv.id, `PUR_${Date.now()}`);
      const total = n(inv.total);
      const paid = Math.min(total, n(inv.paid));
      const debt = Math.max(0, n(inv.debt || (total - paid)));
      const date = inv.date;
      const supplier = text(inv.supplierName, 'مورد');
      const cashCode = text(inv.accountId, 'ACC_CASH_MAIN');
      const entryId = `JE_PUR_${id}`;
      if (total) journal.push(line(entryId, 'purchase', id, date, '1200', 'المخزون', total, 0, `إثبات فاتورة المشتريات ${id}`, { partyType: 'supplier', partyId: inv.supplierId || null, partyName: supplier }));
      if (paid) journal.push(line(entryId, 'purchase', id, date, cashCode, 'الصندوق / الحساب', 0, paid, `المبلغ المدفوع لفاتورة المشتريات ${id}`, { partyType: 'supplier', partyName: supplier }));
      if (debt) journal.push(line(entryId, 'purchase', id, date, '2100', 'ذمم الموردين', 0, debt, `المبلغ الآجل لفاتورة المشتريات ${id}`, { partyType: 'supplier', partyId: inv.supplierId || null, partyName: supplier }));
    });

    parse('cashtop_purchase_returns').forEach(ret => {
      const id = text(ret.id || ret.refNumber, `PRET_${Date.now()}`);
      const total = n(ret.total || ret.amount);
      const received = n(ret.received || ret.paid || ret.cashReceived);
      const due = Math.max(0, n(ret.debt || ret.due || (total - received)));
      const entryId = `JE_PRET_${id}`;
      if (received) journal.push(line(entryId, 'purchase-return', id, ret.date, text(ret.accountId, 'ACC_CASH_MAIN'), 'الصندوق / الحساب', received, 0, `نقدية مستردة من مرتجع المشتريات ${id}`));
      if (due) journal.push(line(entryId, 'purchase-return', id, ret.date, '2100', 'ذمم الموردين', due, 0, `تخفيض ذمة المورد بمرتجع ${id}`));
      if (total) journal.push(line(entryId, 'purchase-return', id, ret.date, '1200', 'المخزون', 0, total, `إخراج مخزون مرتجع المشتريات ${id}`));
    });

    parse('cashtop_expenses').forEach(exp => {
      const id = text(exp.id, `EXP_${Date.now()}`);
      const amount = n(exp.amount);
      if (!amount) return;
      const entryId = `JE_EXP_${id}`;
      journal.push(line(entryId, 'expense', id, exp.date, exp.sourceType === 'wastage' ? '5300' : '5200', text(exp.name, 'مصروف تشغيلي'), amount, 0, `إثبات المصروف ${text(exp.name, id)}`));
      if (exp.nonCash === true || exp.sourceType === 'wastage') {
        journal.push(line(entryId, 'expense', id, exp.date, '1200', 'المخزون', 0, amount, `إخراج مخزون هالك ${text(exp.name, id)}`));
      } else {
        journal.push(line(entryId, 'expense', id, exp.date, text(exp.accountId, 'ACC_CASH_MAIN'), 'الصندوق / الحساب', 0, amount, `صرف المصروف ${text(exp.name, id)}`));
      }
    });

    parse('cashtop_vouchers').forEach(v => {
      const id = text(v.id || v.refNumber, `V_${Date.now()}`);
      const amount = n(v.amount);
      if (!amount) return;
      const entryId = `JE_V_${id}`;
      const cashCode = text(v.accountId, 'ACC_CASH_MAIN');
      const partyName = text(v.relationName, 'جهة أخرى');
      let counterCode = '2990';
      let counterName = 'حسابات متنوعة';
      if (v.relationType === 'client') { counterCode = '1100'; counterName = 'ذمم العملاء'; }
      if (v.relationType === 'supplier') { counterCode = '2100'; counterName = 'ذمم الموردين'; }
      if (v.type === 'قبض') {
        journal.push(line(entryId, 'voucher', id, v.date, cashCode, 'الصندوق / الحساب', amount, 0, `سند قبض ${text(v.refNumber, id)} من ${partyName}`));
        journal.push(line(entryId, 'voucher', id, v.date, counterCode, counterName, 0, amount, `تسوية سند قبض مع ${partyName}`));
      } else {
        journal.push(line(entryId, 'voucher', id, v.date, counterCode, counterName, amount, 0, `تسوية سند صرف مع ${partyName}`));
        journal.push(line(entryId, 'voucher', id, v.date, cashCode, 'الصندوق / الحساب', 0, amount, `سند صرف ${text(v.refNumber, id)} إلى ${partyName}`));
      }
    });

    return journal.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  function validateBalanced(journal) {
    const totals = new Map();
    journal.forEach(item => {
      const current = totals.get(item.entryId) || { debit: 0, credit: 0 };
      current.debit += n(item.debit);
      current.credit += n(item.credit);
      totals.set(item.entryId, current);
    });
    const unbalanced = [];
    totals.forEach((totalsValue, entryId) => {
      const difference = Math.abs(totalsValue.debit - totalsValue.credit);
      if (difference > 0.01) unbalanced.push({ entryId, ...totalsValue, difference });
    });
    return unbalanced;
  }

  let rebuilding = false;
  function rebuild() {
    if (rebuilding) return;
    rebuilding = true;
    try {
      const journal = buildJournal();
      const unbalanced = validateBalanced(journal);
      localStorage.setItem('cashtop_journal', JSON.stringify(journal));
      window.Cashtop.accountingStatus = {
        updatedAt: new Date().toISOString(),
        entries: new Set(journal.map(row => row.entryId)).size,
        lines: journal.length,
        unbalanced
      };
      window.dispatchEvent(new CustomEvent('cashtop:journal-rebuilt', { detail: window.Cashtop.accountingStatus }));
      if (unbalanced.length) console.warn('[CASH TOP] قيود غير متوازنة:', unbalanced);
    } finally {
      rebuilding = false;
    }
  }

  window.Cashtop.rebuildJournal = rebuild;
  window.Cashtop.getJournal = () => parse('cashtop_journal');

  window.addEventListener('cashtop:data-changed', event => {
    if (SOURCE_KEYS.has(event.detail?.key)) setTimeout(rebuild, 30);
  });
  window.addEventListener('cashtop:remote-applied', event => {
    if (SOURCE_KEYS.has(event.detail?.key)) setTimeout(rebuild, 30);
  });
  document.addEventListener('DOMContentLoaded', rebuild, { once: true });
})();
