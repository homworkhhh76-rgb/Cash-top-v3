'use strict';

function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ar').replace(/\s+/g, ' ');
}

self.onmessage = event => {
  const { id, type, payload } = event.data || {};
  try {
    let result = null;
    if (type === 'filter-records') {
      const records = Array.isArray(payload?.records) ? payload.records : [];
      const query = normalize(payload?.query);
      const fields = Array.isArray(payload?.fields) ? payload.fields : [];
      result = !query ? records : records.filter(record => fields.some(field => normalize(record?.[field]).includes(query)));
    } else if (type === 'sort-date-desc') {
      const records = Array.isArray(payload?.records) ? payload.records : [];
      const field = payload?.field || 'date';
      result = records.slice().sort((a, b) => new Date(b?.[field] || 0).getTime() - new Date(a?.[field] || 0).getTime());
    } else if (type === 'invoice-stats') {
      const records = Array.isArray(payload?.records) ? payload.records : [];
      const today = payload?.today || '';
      result = records.reduce((acc, invoice) => {
        acc.totalSales += Number(invoice?.total) || 0;
        acc.totalPaid += Number(invoice?.paid) || 0;
        acc.totalDebt += Number(invoice?.debt) || 0;
        if (today && new Date(invoice?.date || 0).toLocaleDateString('en-GB') === today) acc.todayCount += 1;
        return acc;
      }, { totalSales: 0, totalPaid: 0, totalDebt: 0, todayCount: 0 });
    } else if (type === 'build-search-index') {
      const records = Array.isArray(payload?.records) ? payload.records : [];
      const fields = Array.isArray(payload?.fields) ? payload.fields : [];
      result = records.map((record, index) => ({ index, text: fields.map(field => normalize(record?.[field])).join(' ') }));
    } else {
      throw new Error(`Unknown worker task: ${type}`);
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
