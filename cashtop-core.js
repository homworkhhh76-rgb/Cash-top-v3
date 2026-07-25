(function () {
  'use strict';

  const FILE = decodeURIComponent((location.pathname.split('/').pop() || '').replace(/\+/g, ' '));
  const EXCLUDED = new Set(['صفحة تسجيل الدخول.html', 'index.html', 'offline.html']);
  const IS_APP_PAGE = !EXCLUDED.has(FILE);
  const APP_NAME = 'كاش توب 2';
  let deferredInstallPrompt = null;
  let appInstalled = window.matchMedia?.('(display-mode: standalone)')?.matches === true;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    window.dispatchEvent(new CustomEvent('cashtop:pwa-ready'));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    appInstalled = true;
    window.dispatchEvent(new CustomEvent('cashtop:pwa-installed'));
  });
  const RAW = {
    get: Storage.prototype.getItem,
    set: Storage.prototype.setItem,
    remove: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
    key: Storage.prototype.key
  };

  const GLOBAL_KEYS = new Set([
    'cashtop_session',
    'cashtop_remembered_key',
    'cashtop_remembered_user',
    'cashtop_device_id',
    'cashtop_admin_licenses',
    'cashtop_admin_users',
    'cashtop_superadmin_session',
    'cashtop_last_firebase_user',
    'cashtop_firebase_enabled',
    'cashtop_tenant_bindings'
  ]);

  const ALIASES = {
    cashtop_funds_db_v4: 'cashtop_funds_db',
    cashtop_clients: 'cashtop_customers',
    cashtop_purchase_invoices: 'cashtop_purchases'
  };

  const DATA_KEYS = [
    'cashtop_products', 'cashtop_materials', 'cashtop_material_purchases', 'cashtop_customers', 'cashtop_customer_groups',
    'cashtop_suppliers', 'cashtop_supplier_movements', 'cashtop_invoices',
    'cashtop_purchases', 'cashtop_purchase_returns', 'cashtop_expenses',
    'cashtop_expense_types', 'cashtop_funds_db', 'cashtop_vouchers',
    'cashtop_units', 'cashtop_stores', 'cashtop_transfer_history',
    'cashtop_branches', 'cashtop_branch_transfer_history', 'cashtop_employees',
    'cashtop_company_access',
    'cashtop_workers', 'cashtop_sales_agents', 'cashtop_agent_movements',
    'cashtop_settings', 'cashtop_db', 'cashtop_printer_settings', 'cashtop_barcode_settings', 'cashtop_invoice_design',
    'cashtop_sms_template', 'cashtop_invoice_message_template', 'cashtop_journal', 'cashtop_audit_log',
    'cashtop_sales_offers', 'cashtop_tax_settings',
    'cashtop_notification_settings', 'cashtop_manufacturing_recipes', 'cashtop_manufacturing_orders',
    'cashtop_wastage', 'cashtop_archive_index', 'cashtop_salary_payments'
  ];

  const PERMISSION_GROUPS = [
    { id: 'pages', title: 'صلاحيات الصفحات والأقسام', permissions: [
      ['dashboard.view', 'عرض لوحة التحكم'], ['pos.access', 'فتح الكاشير ونقطة البيع'],
      ['sales.invoices.view', 'عرض فواتير المبيعات'], ['purchases.view', 'عرض فواتير المشتريات'],
      ['purchaseReturns.view', 'عرض مرتجع المشتريات'], ['products.view', 'عرض المنتجات'], ['materials.view', 'عرض الأصناف الخام'],
      ['warehouses.view', 'عرض المخازن'], ['branches.view', 'عرض الفروع'], ['units.view', 'عرض الوحدات'],
      ['shortages.view', 'عرض نواقص المخزون'], ['barcode.view', 'فتح مولد الباركود'],
      ['customers.view', 'عرض العملاء'], ['customerGroups.view', 'عرض مجموعات العملاء'],
      ['suppliers.view', 'عرض الموردين'], ['agents.view', 'عرض المناديب'],
      ['accounts.view', 'عرض الحسابات والصناديق'], ['journal.view', 'عرض دفتر القيود'],
      ['vouchers.view', 'عرض سندات القبض والصرف'], ['expenses.view', 'عرض المصاريف'],
      ['reports.view', 'عرض التقارير'], ['employees.view', 'عرض الموظفين'], ['workers.view', 'عرض العمال والأجور'],
      ['manufacturing.view', 'عرض إدارة التصنيع'], ['offers.view', 'عرض عروض المبيعات'],
      ['notifications.view', 'عرض الإشعارات'], ['settings.system', 'فتح إعدادات النظام'],
      ['settings.printer', 'فتح إعدادات الطابعة'], ['settings.tax', 'فتح إعدادات الضريبة'],
      ['settings.storage', 'فتح التخزين والأرشفة'], ['backup.manage', 'فتح النسخ الاحتياطي والاستعادة']
    ]},
    { id: 'sales', title: 'صلاحيات المبيعات والكاشير', permissions: [
      ['sales.create', 'إنشاء وحفظ فاتورة بيع'], ['sales.edit', 'تعديل فاتورة بيع وعكس حركتها'],
      ['sales.delete', 'حذف فاتورة بيع وعكس المخزون والحسابات'], ['sales.print', 'طباعة الفواتير'],
      ['sales.image', 'تنزيل الفاتورة كصورة'], ['sales.discount', 'تطبيق الخصم على المبيعات'],
      ['sales.changePrice', 'تعديل سعر الصنف في الكاشير'], ['sales.credit', 'تسجيل مبيعات آجلة وديون'],
      ['sales.hold', 'تعليق واسترجاع الفواتير'], ['sales.clearCart', 'تفريغ سلة الكاشير']
    ]},
    { id: 'purchases', title: 'صلاحيات المشتريات والموردين', permissions: [
      ['purchases.create', 'إنشاء فاتورة مشتريات متعددة المنتجات'], ['purchases.edit', 'تعديل فاتورة مشتريات'],
      ['purchases.delete', 'حذف فاتورة مشتريات وعكسها'], ['purchases.export', 'تصدير فواتير المشتريات'],
      ['purchases.discount', 'تطبيق خصم المشتريات'],
      ['purchaseReturns.create', 'إنشاء مرتجع مشتريات'], ['purchaseReturns.edit', 'تعديل مرتجع مشتريات'],
      ['purchaseReturns.delete', 'حذف مرتجع مشتريات'], ['purchaseReturns.export', 'تصدير مرتجعات المشتريات'],
      ['suppliers.create', 'إضافة مورد'], ['suppliers.edit', 'تعديل الموردين'],
      ['suppliers.delete', 'حذف الموردين'], ['suppliers.balance', 'إضافة دفعات وديون للموردين'],
      ['suppliers.export', 'تصدير بيانات الموردين']
    ]},
    { id: 'inventory', title: 'صلاحيات المنتجات والمخزون', permissions: [
      ['products.create', 'إضافة منتج'], ['products.edit', 'تعديل المنتجات'], ['products.delete', 'حذف المنتجات'],
      ['products.export', 'تصدير المنتجات'], ['materials.view', 'عرض الأصناف الخام'], ['materials.manage', 'إضافة وتعديل وتوريد الأصناف الخام'], ['materials.export', 'تصدير الأصناف الخام'], ['inventory.adjust', 'تعديل كميات المخزون'],
      ['inventory.transfer', 'نقل بين الفروع والمخازن (الموظف ينقل من فرعه فقط)'],
      ['inventory.importExport', 'استيراد وتصدير بيانات المخزون'],
      ['warehouses.manage', 'إضافة وتعديل وحذف المخازن'], ['branches.manage', 'إضافة وتعديل وحذف الفروع'],
      ['units.manage', 'إضافة وتعديل وحذف الوحدات'], ['shortages.supply', 'توريد ومعالجة نواقص المخزون'],
      ['barcode.manage', 'إنشاء وطباعة وتنزيل ملصقات الباركود']
    ]},
    { id: 'customers', title: 'صلاحيات العملاء', permissions: [
      ['customers.create', 'إضافة عميل'], ['customers.edit', 'تعديل العملاء'], ['customers.delete', 'حذف العملاء'],
      ['customers.balance', 'تعديل أرصدة وديون العملاء'], ['customers.export', 'تصدير وطباعة بيانات العملاء'],
      ['customerGroups.manage', 'إدارة مجموعات وتسعير العملاء']
    ]},
    { id: 'finance', title: 'الصلاحيات المالية والمحاسبية', permissions: [
      ['accounts.manage', 'إضافة وتعديل وحذف الصناديق والحسابات'],
      ['finance.transactions', 'إضافة التحويلات والحركات المالية'],
      ['finance.deleteTransactions', 'حذف وعكس الحركات المالية'], ['finance.export', 'تصدير الحسابات والحركات'],
      ['expenses.manage', 'إضافة وتعديل وحذف المصاريف وأنواعها'], ['expenses.export', 'تصدير المصاريف'],
      ['vouchers.manage', 'إضافة وتعديل وحذف السندات'], ['vouchers.export', 'طباعة وتصدير السندات'],
      ['journal.manage', 'إدارة القيود المحاسبية'], ['journal.export', 'تصدير دفتر القيود'],
      ['reports.export', 'تصدير التقارير'], ['reports.send', 'إرسال التقارير عبر قنوات المشاركة']
    ]},
    { id: 'staff', title: 'صلاحيات الموظفين والإدارة', permissions: [
      ['employees.manage', 'إضافة وتعديل وحذف وتعطيل الموظفين'], ['employees.export', 'تصدير بيانات الموظفين'],
      ['permissions.manage', 'تعديل صلاحيات الموظفين'],
      ['workers.manage', 'إضافة وتعديل وحذف العمال'], ['workers.payments', 'صرف رواتب ودفعات وديون العمال'],
      ['workers.export', 'تصدير بيانات العمال'], ['agents.manage', 'إضافة وتعديل وحذف المناديب'],
      ['agents.stock', 'تحميل واسترجاع مخزون المناديب'], ['agents.settle', 'تسوية مبيعات المناديب'],
      ['agents.payments', 'دفعات وحسابات المناديب'], ['agents.export', 'تصدير بيانات وحركات المناديب'],
      ['manufacturing.manage', 'إدارة الوصفات وأوامر التصنيع']
    ]},
    { id: 'system', title: 'صلاحيات النظام الحساسة', permissions: [
      ['settings.edit', 'تعديل إعدادات النظام والشركة وكلمة المرور'], ['settings.sms', 'تعديل قالب رسائل العملاء'],
      ['printer.edit', 'تعديل إعدادات الطابعة والفاتورة'], ['tax.edit', 'تعديل إعدادات الضريبة'],
      ['storage.manage', 'إدارة التخزين والأرشفة'], ['offers.manage', 'إدارة عروض المبيعات'],
      ['notifications.manage', 'إدارة إعدادات الإشعارات'], ['sync.run', 'تشغيل المزامنة اليدوية'],
      ['backup.exportImport', 'تصدير واستيراد نسخة احتياطية'], ['app.install', 'تثبيت تطبيق الويب']
    ]}
  ];

  const PAGE_PERMISSIONS = {
    'لوحة التحكم.html': 'dashboard.view', 'cashier.html': 'pos.access', 'invoices.html': 'sales.invoices.view',
    'المشتريات.html': 'purchases.view', 'مرجع المشتريات.html': 'purchaseReturns.view', 'products.html': 'products.view', 'materials.html': 'materials.view',
    'warehouses.html': 'warehouses.view', 'branches.html': ['branches.view', 'inventory.transfer'], 'units.html': 'units.view',
    'shortages.html': 'shortages.view', 'barcode-generator.html': 'barcode.view', 'customers.html': 'customers.view',
    'customer-groups.html': 'customerGroups.view', 'suppliers.html': 'suppliers.view', 'المناديب.html': 'agents.view',
    'accounts.html': 'accounts.view', 'journal.html': 'journal.view', 'sands.html': 'vouchers.view',
    'المصاريف.html': 'expenses.view', 'التقارير.html': 'reports.view', 'الموظفين.html': 'employees.view',
    'العمال والاجور.html': 'workers.view', 'ادارة التصنيع.html': 'manufacturing.view', 'sales-offers.html': 'offers.view',
    'notifications.html': 'notifications.view', 'setting.html': 'settings.system', 'printer-settings.html': 'settings.printer',
    'tax-settings.html': 'settings.tax', 'storage-settings.html': 'settings.storage',
    'استيراد وتصدير ل كل قسم.html': 'backup.manage'
  };

  // Action-level permissions are applied to existing and dynamically-created
  // controls. This supplements page access with granular create/edit/delete/
  // payment/transfer/export restrictions without changing page business logic.
  const ACTION_PERMISSION_MAP = {
    'accounts.html': {
      openAddAccountModal: 'accounts.manage', editAccount: 'accounts.manage', saveAccount: 'accounts.manage',
      confirmDeleteAccount: 'accounts.manage', executeDelete: 'accounts.manage',
      handleTransfer: 'finance.transactions',
      exportAllAccountsExcel: 'finance.export', exportAllAccountsPDF: 'finance.export',
      exportAccountExcel: 'finance.export', exportAccountPDF: 'finance.export'
    },
    'barcode-generator.html': {
      addCurrentToLabelsGrid: 'barcode.manage', triggerPrint: 'barcode.manage',
      downloadPreviewAsImage: 'barcode.manage', clearPreviewZone: 'barcode.manage'
    },
    'branches.html': {
      openTransferModal: 'inventory.transfer', openTransferVariantModal: 'inventory.transfer',
      processTransfer: 'inventory.transfer', addProdToTransferCart: 'inventory.transfer', addVariantToTransfer: 'inventory.transfer',
      openEditBranchModal: 'branches.manage', openDeleteBranchModal: 'branches.manage',
      saveBranch: 'branches.manage', saveEditedBranch: 'branches.manage', saveManager: 'branches.manage',
      toggleBranchStatus: 'branches.manage', confirmDeleteBranch: 'branches.manage',
      exportHistoryExcel: 'products.export', exportHistoryPdf: 'products.export'
    },
    'cashier.html': {
      holdInvoice: 'sales.hold', openSuspendedModal: 'sales.hold', clearBasket: 'sales.clearCart',
      applyDiscountValue: 'sales.discount', handleQuickProductSubmit: 'products.create'
    },
    'customer-groups.html': {
      openGroupModal: 'customerGroups.manage', saveGroupData: 'customerGroups.manage',
      selectAllCustomers: 'customerGroups.manage', triggerPrint: 'customers.export'
    },
    'customers.html': {
      editCustomer: 'customers.edit', deleteCustomer: 'customers.delete',
      exportTableToExcel: 'customers.export', exportTableToPDF: 'customers.export',
      exportTableToImage: 'customers.export', exportRowPDF: 'customers.export', exportRowImage: 'customers.export'
    },
    'notifications.html': { openSettings: 'notifications.manage', saveSettings: 'notifications.manage', payEmployeeSalary: 'employees.manage' },
    'printer-settings.html': { savePrinterSettings: 'printer.edit', saveBarcodeSettings: 'printer.edit' },
    'products.html': {
      openProductModal: 'products.create', stageCurrentProduct: 'products.create', saveFinalPurchase: 'products.create',
      addVariantRow: 'products.create', editProduct: 'products.edit', editStagedItem: 'products.edit',
      deleteProduct: 'products.delete', deleteStagedItem: 'products.delete',
      openAdvancedTransferModal: 'inventory.transfer', openTransferVariantSelector: 'inventory.transfer',
      confirmTransferAction: 'inventory.transfer', addProdToTransfer: 'inventory.transfer', addVariantToTransferById: 'inventory.transfer',
      exportExcel: 'products.export', exportPDF: 'products.export', exportImage: 'products.export',
      exportTransferExcel: 'products.export', exportTransferPDF: 'products.export', exportTransferImage: 'products.export'
    },
    'materials.html': {
      openMaterialModal: 'materials.manage', saveMaterialPurchase: 'materials.manage', editMaterial: 'materials.manage', deleteMaterial: 'materials.manage',
      exportMaterialsExcel: 'materials.export', exportMaterialsPDF: 'materials.export'
    },
    'sales-offers.html': {
      'offerPage.openModal': 'offers.manage', 'offerPage.save': 'offers.manage', 'offerPage.edit': 'offers.manage',
      'offerPage.remove': 'offers.manage', 'offerPage.exportAll': 'reports.export', 'offerPage.exportOne': 'reports.export'
    },
    'sands.html': {
      openVoucherModal: 'vouchers.manage', saveVoucher: 'vouchers.manage', editVoucher: 'vouchers.manage',
      confirmDelete: 'vouchers.manage', executeDelete: 'vouchers.manage',
      exportAllVouchersExcel: 'vouchers.export', exportAllVouchersPDF: 'vouchers.export',
      exportAllVouchersImage: 'vouchers.export', exportVoucherPDF: 'vouchers.export',
      exportVoucherImage: 'vouchers.export', printVoucher: 'vouchers.export'
    },
    'setting.html': {
      saveSystemSettings: 'settings.edit', openPasswordModal: 'settings.edit',
      handlePasswordChange: 'settings.edit', saveSmsSettings: 'settings.sms', insertVariable: 'settings.sms'
    },
    'shortages.html': {
      openOrderModal: 'shortages.supply', openProductModal: 'products.create',
      handleQuickSupply: 'shortages.supply', saveQuickProduct: 'products.create'
    },
    'storage-settings.html': { runCompaction: 'storage.manage', saveStorage: 'storage.manage' },
    'suppliers.html': {
      openAddSupplierModal: 'suppliers.create', editSupplier: 'suppliers.edit', saveSupplier: ['suppliers.create', 'suppliers.edit'],
      executePayment: 'suppliers.balance', executeManualDebt: 'suppliers.balance',
      confirmDelete: 'suppliers.delete', executeDelete: 'suppliers.delete',
      exportAllSuppliersExcel: 'suppliers.export', exportAllSuppliersPDF: 'suppliers.export',
      exportIndividualPDF: 'suppliers.export', exportIndividualExcel: 'suppliers.export'
    },
    'tax-settings.html': { saveTax: 'tax.edit' },
    'units.html': { openModal: 'units.manage', saveUnit: 'units.manage', editUnit: 'units.manage', deleteUnit: 'units.manage' },
    'warehouses.html': {
      openTransferModal: 'inventory.transfer', openTransferVariantModal: 'inventory.transfer', processTransfer: 'inventory.transfer',
      addProdToTransferCart: 'inventory.transfer', addVariantToTransfer: 'inventory.transfer',
      saveStockAdjustment: 'inventory.adjust', openEditModal: 'inventory.adjust', openDeleteModal: 'inventory.adjust',
      confirmDeleteProduct: 'inventory.adjust', saveNewStore: 'warehouses.manage',
      exportHistoryExcel: 'products.export', exportHistoryPdf: 'products.export',
      openExportModal: 'products.export', executeExport: 'products.export', exportToExcel: 'products.export', exportToPdf: 'products.export'
    },
    'ادارة التصنيع.html': {
      openRecipe: 'manufacturing.manage', openProduction: 'manufacturing.manage', saveRecipe: 'manufacturing.manage',
      addIngredient: 'manufacturing.manage', executeProduction: 'manufacturing.manage'
    },
    'استيراد وتصدير ل كل قسم.html': {
      triggerFullBackup: 'backup.exportImport', triggerFullRestore: 'backup.exportImport', handleFullRestore: 'backup.exportImport',
      exportSection: 'backup.exportImport', importSection: 'backup.exportImport', handleSectionImport: 'backup.exportImport'
    },
    'التقارير.html': { exportExcel: 'reports.export', exportPDF: 'reports.export', sendReport: 'reports.send' },
    'العمال والاجور.html': {
      openAddModal: 'workers.manage', openEditWorker: 'workers.manage', openDeleteWorker: 'workers.manage',
      saveWorker: ['workers.manage'], confirmDeleteWorker: 'workers.manage',
      openPayWorker: 'workers.payments', openDebtWorker: 'workers.payments',
      executePayment: 'workers.payments', executeDebt: 'workers.payments',
      exportToExcel: 'workers.export', exportToPDF: 'workers.export'
    },
    'المشتريات.html': {
      addNewProductRow: 'purchases.create', savePurchaseInvoice: 'purchases.create',
      openEditModal: 'purchases.edit', saveEditInvoice: 'purchases.edit',
      openDeleteModal: 'purchases.delete', confirmDeleteInvoice: 'purchases.delete',
      exportExcel: 'purchases.export', exportPDF: 'purchases.export'
    },
    'المصاريف.html': {
      openExpenseModal: 'expenses.manage', openEditExpense: 'expenses.manage', openTypeModal: 'expenses.manage',
      saveExpense: 'expenses.manage', saveExpenseType: 'expenses.manage',
      openDeleteExpenseModal: 'expenses.manage', executeDeleteExpense: 'expenses.manage',
      exportExcel: 'expenses.export', exportPDF: 'expenses.export'
    },
    'المناديب.html': {
      openAgentModal: 'agents.manage', saveAgent: 'agents.manage', openDeleteAgentModal: 'agents.manage',
      confirmDeleteAgent: 'agents.manage', openStockLoadModal: 'agents.stock', processLoadAction: 'agents.stock',
      openSettleModal: 'agents.settle', processSettlement: 'agents.settle',
      openPayModal: 'agents.payments', openPayRepModal: 'agents.payments', processPayment: 'agents.payments', processPayRep: 'agents.payments',
      exportMainExcel: 'agents.export', exportMainPDF: 'agents.export',
      exportAgentHistoryExcel: 'agents.export', exportAgentHistoryPDF: 'agents.export'
    },
    'الموظفين.html': {
      openAddModal: 'employees.manage', openEditModal: 'employees.manage', openDeleteModal: 'employees.manage',
      saveEmployee: 'employees.manage', confirmDelete: 'employees.manage', toggleEmployeeStatus: 'employees.manage',
      setAllPermissions: 'permissions.manage', exportToExcel: 'employees.export', exportToPDF: 'employees.export'
    },
    'مرجع المشتريات.html': {
      addNewProductRow: 'purchaseReturns.create', savePurchaseReturn: 'purchaseReturns.create',
      openEditReturn: 'purchaseReturns.edit', saveEditReturn: 'purchaseReturns.edit',
      openDeleteReturn: 'purchaseReturns.delete', confirmDeleteReturn: 'purchaseReturns.delete',
      exportExcel: 'purchaseReturns.export', exportPDF: 'purchaseReturns.export'
    }
  };

  const ACTION_SELECTOR_RULES = {
    'customers.html': [
      ['#openCustomerModalBtn', 'customers.create'],
      ['#customerForm', ['customers.create', 'customers.edit']]
    ],
    'warehouses.html': [['form[onsubmit*="saveNewStore"]', 'warehouses.manage']],
    'setting.html': [
      ['form[onsubmit*="saveSystemSettings"]', 'settings.edit'],
      ['form[onsubmit*="saveSmsSettings"]', 'settings.sms']
    ]
  };

  const LEGACY_PERMISSION_MAP = {
    dashboard: ['dashboard.view'],
    pos: ['pos.access', 'sales.create', 'sales.edit', 'sales.delete', 'sales.print', 'sales.image', 'sales.discount', 'sales.changePrice', 'sales.credit', 'sales.hold', 'sales.clearCart'],
    products: ['products.view', 'materials.view', 'warehouses.view', 'branches.view', 'units.view', 'shortages.view', 'barcode.view', 'products.create', 'products.edit', 'products.delete', 'products.export', 'materials.manage', 'materials.export', 'inventory.adjust', 'inventory.transfer', 'inventory.importExport', 'warehouses.manage', 'branches.manage', 'units.manage', 'shortages.supply', 'barcode.manage'],
    customers: ['customers.view', 'customerGroups.view', 'sales.invoices.view', 'customers.create', 'customers.edit', 'customers.delete', 'customers.balance', 'customers.export', 'customerGroups.manage'],
    suppliers: ['suppliers.view', 'purchases.view', 'purchaseReturns.view', 'purchases.create', 'purchases.edit', 'purchases.delete', 'purchases.export', 'purchases.discount', 'purchaseReturns.create', 'purchaseReturns.edit', 'purchaseReturns.delete', 'purchaseReturns.export', 'suppliers.create', 'suppliers.edit', 'suppliers.delete', 'suppliers.balance', 'suppliers.export'],
    funds: ['accounts.view', 'journal.view', 'vouchers.view', 'expenses.view', 'accounts.manage', 'finance.transactions', 'finance.deleteTransactions', 'finance.export', 'expenses.manage', 'expenses.export', 'vouchers.manage', 'vouchers.export', 'journal.manage', 'journal.export'],
    reports: ['reports.view', 'reports.export', 'reports.send'],
    settings: ['employees.view', 'workers.view', 'agents.view', 'manufacturing.view', 'offers.view', 'notifications.view', 'settings.system', 'settings.printer', 'settings.tax', 'settings.storage', 'backup.manage', 'employees.manage', 'employees.export', 'permissions.manage', 'workers.manage', 'workers.payments', 'workers.export', 'agents.manage', 'agents.stock', 'agents.settle', 'agents.payments', 'agents.export', 'manufacturing.manage', 'settings.edit', 'settings.sms', 'printer.edit', 'tax.edit', 'storage.manage', 'offers.manage', 'notifications.manage', 'sync.run', 'backup.exportImport', 'app.install']
  };

  function normalizePermissions(input) {
    const source = input && typeof input === 'object' ? input : {};
    const normalized = {};
    Object.entries(source).forEach(([key, value]) => {
      if (key.includes('.')) normalized[key] = value === true;
      else if (LEGACY_PERMISSION_MAP[key] && value === true) LEGACY_PERMISSION_MAP[key].forEach(permission => { normalized[permission] = true; });
    });
    return normalized;
  }

  function can(permission, session = getSession()) {
    if (!permission) return true;
    if (!session) return false;
    if (['admin', 'owner', 'superadmin'].includes(String(session.role || '').toLowerCase())) return true;
    const normalized = normalizePermissions(session.permissions);
    if (Object.keys(normalized).length === 0) {
      return String(session.role || '').toLowerCase() !== 'employee';
    }
    return normalized[permission] === true;
  }

  const NON_ARRAY_DEFAULTS = {
    cashtop_funds_db: { version: 5, accounts: [], accountLogs: [] },
    cashtop_settings: {},
    cashtop_db: {},
    cashtop_invoice_design: {},
    cashtop_company_access: {},
    cashtop_printer_settings: {},
    cashtop_barcode_settings: {},
    cashtop_sms_template: '',
    cashtop_invoice_message_template: 'مرحباً {name}، فاتورتك رقم {invoice} لدى {store}. الأصناف:\n{items}\nالإجمالي: {total}، المدفوع: {paid}، المتبقي: {balance}.',
    cashtop_tax_settings: { enabled: false, salesRate: 0, purchaseRate: 0, salesBearer: 'customer', purchaseBearer: 'business', pricesIncludeTax: false },
    cashtop_notification_settings: { lowStockThreshold: 5, debtOverdueDays: 30, inactiveCustomerDays: 45, expiryWarningDays: 30, enabled: false, dailySummaryEnabled: true },
    cashtop_archive_index: { lastCompactionAt: 0, archivedCounts: {} }
  };

  /*
   * IndexedDB هو طبقة التخزين المحلية المتينة والكبيرة. localStorage يبقى
   * كـ hot cache متزامن حتى لا نكسر الصفحات القديمة التي تتوقع getItem فوراً،
   * بينما كل بيانات الشركة والـ meta وطابور المزامنة تُنسخ أيضاً إلى IndexedDB.
   * عند امتلاء localStorage تبقى القيمة في الذاكرة + IndexedDB بدلاً من فشل الحفظ.
   */
  const DURABLE_LOCAL_DB = 'cashtop-local-durable-v2';
  const DURABLE_LOCAL_STORE = 'kv';
  const durableMemory = new Map();
  let durableDbPromise = null;
  let durableWriteChain = Promise.resolve();
  let durableReadyPromise = Promise.resolve({ restored: 0 });

  function isDurableLocalKey(key) {
    return typeof key === 'string' && (
      key.startsWith('cashtop_data::') ||
      key.startsWith('cashtop_meta::') ||
      key.startsWith('ct_sync_queue::') ||
      key.startsWith('cashtop_tx::')
    );
  }

  function isQuotaError(error) {
    return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      /quota|storage.*full|exceeded/i.test(String(error?.message || ''));
  }

  function openDurableLocalDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (durableDbPromise) return durableDbPromise;
    durableDbPromise = new Promise(resolve => {
      try {
        const request = indexedDB.open(DURABLE_LOCAL_DB, 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DURABLE_LOCAL_STORE)) {
            db.createObjectStore(DURABLE_LOCAL_STORE, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => console.warn('[CASH TOP 2] durable local DB upgrade is blocked by another tab.');
      } catch (_) { resolve(null); }
    });
    return durableDbPromise;
  }

  async function persistDurableLocalKey(key, value) {
    if (!isDurableLocalKey(key)) return false;
    const db = await openDurableLocalDb();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(DURABLE_LOCAL_STORE, 'readwrite');
        tx.objectStore(DURABLE_LOCAL_STORE).put({ key, value: String(value), savedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  async function deleteDurableLocalKey(key) {
    if (!isDurableLocalKey(key)) return false;
    const db = await openDurableLocalDb();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(DURABLE_LOCAL_STORE, 'readwrite');
        tx.objectStore(DURABLE_LOCAL_STORE).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  function scheduleDurablePersist(key, value) {
    if (!isDurableLocalKey(key)) return;
    durableWriteChain = durableWriteChain
      .catch(() => false)
      .then(() => persistDurableLocalKey(key, value))
      .catch(() => false);
  }

  function scheduleDurableDelete(key) {
    if (!isDurableLocalKey(key)) return;
    durableWriteChain = durableWriteChain
      .catch(() => false)
      .then(() => deleteDurableLocalKey(key))
      .catch(() => false);
  }

  function rawGet(key) {
    if (durableMemory.has(key)) return durableMemory.get(key);
    return RAW.get.call(localStorage, key);
  }

  function rawSet(key, value) {
    const stringValue = String(value);
    let storedInLocalStorage = true;
    try {
      RAW.set.call(localStorage, key, stringValue);
      durableMemory.delete(key);
    } catch (error) {
      if (!isDurableLocalKey(key) || !isQuotaError(error)) throw error;
      storedInLocalStorage = false;
      durableMemory.set(key, stringValue);
      window.dispatchEvent(new CustomEvent('cashtop:local-storage-pressure', { detail: { key } }));
    }
    scheduleDurablePersist(key, stringValue);
    return storedInLocalStorage;
  }

  function rawRemove(key) {
    durableMemory.delete(key);
    try { RAW.remove.call(localStorage, key); } catch (_) {}
    scheduleDurableDelete(key);
  }

  async function restoreDurableCompanyData() {
    const db = await openDurableLocalDb();
    if (!db) return { restored: 0 };
    const tenant = encodeURIComponent(tenantIdFromSession());
    const dataPrefix = `cashtop_data::${tenant}::`;
    const metaPrefix = `cashtop_meta::${tenant}::`;
    const prefixes = [dataPrefix, metaPrefix, `ct_sync_queue::${tenant}`, `cashtop_tx::${tenant}::`];
    const records = await new Promise(resolve => {
      try {
        const tx = db.transaction(DURABLE_LOCAL_STORE, 'readonly');
        const request = tx.objectStore(DURABLE_LOCAL_STORE).getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
      } catch (_) { resolve([]); }
    });
    const recordMap = new Map(records.map(record => [String(record?.key || ''), record]));
    let restored = 0;
    const restoredDatasets = new Set();

    const writeRestored = (key, value) => {
      try {
        RAW.set.call(localStorage, key, value);
        durableMemory.delete(key);
      } catch (error) {
        if (!isQuotaError(error)) return false;
        durableMemory.set(key, value);
      }
      return true;
    };

    // البيانات أولاً، مع السماح لـ IndexedDB باستبدال القيم الفارغة التي أنشأها seed.
    for (const record of records) {
      const key = String(record?.key || '');
      if (!key.startsWith(dataPrefix)) continue;
      const dataset = key.slice(dataPrefix.length);
      const currentRaw = rawGet(key);
      const currentMeta = safeJson(rawGet(`${metaPrefix}${dataset}`), {}) || {};
      const durableMeta = safeJson(recordMap.get(`${metaPrefix}${dataset}`)?.value, {}) || {};
      const shouldRestore = currentRaw === null || currentMeta.seeded === true || Number(currentMeta.updatedAt || 0) <= 0 ||
        Number(durableMeta.updatedAt || 0) > Number(currentMeta.updatedAt || 0);
      if (!shouldRestore) continue;
      if (writeRestored(key, String(record?.value ?? ''))) {
        restored += 1;
        restoredDatasets.add(dataset);
      }
    }

    // ثم الـ meta والطابور والمعاملات غير المكتملة.
    for (const record of records) {
      const key = String(record?.key || '');
      if (!prefixes.some(prefix => key.startsWith(prefix)) || key.startsWith(dataPrefix)) continue;
      const current = rawGet(key);
      let shouldRestore = current === null;
      if (key.startsWith(metaPrefix)) {
        const currentMeta = safeJson(current, {}) || {};
        const durableMeta = safeJson(record?.value, {}) || {};
        shouldRestore = shouldRestore || currentMeta.seeded === true || Number(currentMeta.updatedAt || 0) <= 0 ||
          Number(durableMeta.updatedAt || 0) > Number(currentMeta.updatedAt || 0);
      }
      if (!shouldRestore) continue;
      if (writeRestored(key, String(record?.value ?? ''))) restored += 1;
    }

    if (restored) {
      restoredDatasets.forEach(key => {
        dispatchLogicalStorageEvents(key, null, rawGet(namespaceKey(key)));
        window.dispatchEvent(new CustomEvent('cashtop:remote-applied', { detail: { key, source: 'indexeddb-restore' } }));
      });
      window.dispatchEvent(new CustomEvent('cashtop:durable-restored', { detail: { restored, datasets: [...restoredDatasets] } }));
    }
    return { restored, datasets: [...restoredDatasets] };
  }

  function safeJson(value, fallback = null) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function normalizeArrayValue(value, fallback = []) {
    let parsed = value;
    // Firebase login/bootstrap data can arrive as an encoded JSON string, a
    // normal array, or an object keyed by numeric/Firebase ids. Normalize all
    // three shapes so callers never fail on .find/.filter/.map.
    for (let i = 0; i < 2 && typeof parsed === 'string'; i += 1) {
      const decoded = safeJson(parsed, null);
      if (decoded === null) break;
      parsed = decoded;
    }
    if (Array.isArray(parsed)) return parsed.filter(item => item != null);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([key, item]) => {
        if (item && typeof item === 'object' && !Array.isArray(item) && item.id == null && !/^\d+$/.test(key)) {
          return { ...item, id: key };
        }
        return item;
      }).filter(item => item != null);
    }
    return Array.isArray(fallback) ? [...fallback] : [];
  }
  function canonicalKey(key) { return ALIASES[key] || key; }
  const TAB_SESSION_KEY = 'cashtop_tab_session_v2';
  function sessionTenantId(session) {
    return session && (session.tenantId || session.companyId || session.companyKey)
      ? String(session.tenantId || session.companyId || session.companyKey)
      : '';
  }
  function getSession() {
    try {
      const tabSession = safeJson(sessionStorage.getItem(TAB_SESSION_KEY), null);
      if (tabSession) return tabSession;
    } catch (_) {}
    const globalSession = safeJson(rawGet('cashtop_session'), null);
    if (globalSession) {
      try { sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(globalSession)); } catch (_) {}
    }
    return globalSession;
  }
  function persistSession(session, forceGlobal = false) {
    if (!session) return;
    try { sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
    const globalSession = safeJson(rawGet('cashtop_session'), null);
    if (forceGlobal || !globalSession || sessionTenantId(globalSession) === sessionTenantId(session)) {
      rawSet('cashtop_session', JSON.stringify(session));
    }
  }
  function tenantIdFromSession() {
    const session = getSession();
    return session && (session.tenantId || session.companyId || session.companyKey)
      ? String(session.tenantId || session.companyId || session.companyKey)
      : 'unassigned';
  }
  // companyIdFromSession بقي للاسم القديم، لكن القيمة الآن هي معرّف المستأجر الثابت.
  // هذا يمنع أن يتغير مسار التخزين عند تغيير مفتاح الشركة أو إعادة استخدام مفتاح قديم.
  function companyIdFromSession() { return tenantIdFromSession(); }
  function namespaceKey(key, companyId = tenantIdFromSession()) {
    return `cashtop_data::${encodeURIComponent(companyId)}::${canonicalKey(key)}`;
  }
  function metaKey(key, companyId = tenantIdFromSession()) {
    return `cashtop_meta::${encodeURIComponent(companyId)}::${canonicalKey(key)}`;
  }
  function isManagedKey(key) {
    return typeof key === 'string' && key.startsWith('cashtop_') && !GLOBAL_KEYS.has(key) &&
      !key.startsWith('cashtop_data::') && !key.startsWith('cashtop_meta::');
  }
  function getDeviceId() {
    let id = rawGet('cashtop_device_id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      rawSet('cashtop_device_id', id);
    }
    return id;
  }


  function syncQueueKey() {
    return `ct_sync_queue::${encodeURIComponent(companyIdFromSession())}`;
  }

  const SYNC_QUEUE_DB = 'cashtop-sync-queue-v1';
  const SYNC_QUEUE_STORE = 'queues';
  let syncQueueBackupChain = Promise.resolve();

  function openSyncQueueDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise(resolve => {
      try {
        const request = indexedDB.open(SYNC_QUEUE_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) db.createObjectStore(SYNC_QUEUE_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function backupSyncQueue(queue) {
    const db = await openSyncQueueDb();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
        tx.objectStore(SYNC_QUEUE_STORE).put(Array.isArray(queue) ? queue : [], syncQueueKey());
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      } catch (_) { try { db.close(); } catch (_) {} resolve(false); }
    });
  }

  async function restoreSyncQueueBackup() {
    const db = await openSyncQueueDb();
    if (!db) return [];
    const restored = await new Promise(resolve => {
      try {
        const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly');
        const request = tx.objectStore(SYNC_QUEUE_STORE).get(syncQueueKey());
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
        tx.oncomplete = () => db.close();
      } catch (_) { try { db.close(); } catch (_) {} resolve([]); }
    });
    if (!getSyncQueue().length && restored.length) {
      rawSet(syncQueueKey(), JSON.stringify(restored.slice(-1200)));
      updateSyncBadge();
      window.dispatchEvent(new CustomEvent('cashtop:sync-queue-restored', { detail: { count: restored.length } }));
    }
    return restored;
  }


  async function readSyncQueueBackupByKey(queueKey) {
    const db = await openSyncQueueDb();
    if (!db) return [];
    return new Promise(resolve => {
      try {
        const tx = db.transaction(SYNC_QUEUE_STORE, 'readonly');
        const request = tx.objectStore(SYNC_QUEUE_STORE).get(queueKey);
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
        tx.oncomplete = () => db.close();
      } catch (_) { try { db.close(); } catch (_) {} resolve([]); }
    });
  }

  async function deleteSyncQueueBackupByKey(queueKey) {
    const db = await openSyncQueueDb();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
        tx.objectStore(SYNC_QUEUE_STORE).delete(queueKey);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      } catch (_) { try { db.close(); } catch (_) {} resolve(false); }
    });
  }

  function legacySyncQueueCandidateKeys() {
    const currentTenant = String(companyIdFromSession());
    const current = syncQueueKey();
    const identifiers = new Set();
    const session = getSession() || {};
    [session.tenantId, session.companyId, session.licenseId, session.companyKey].forEach(value => {
      if (value !== undefined && value !== null && String(value).trim()) identifiers.add(String(value));
    });

    const bindings = safeJson(rawGet('cashtop_tenant_bindings'), {}) || {};
    Object.entries(bindings).forEach(([key, tenant]) => {
      if (String(tenant) === currentTenant && String(key).trim()) identifiers.add(String(key));
    });

    const licenses = normalizeAdminRecords(rawGet('cashtop_admin_licenses'), ['key', 'tenantId', 'companyId']);
    licenses.forEach(item => {
      const tenant = String(item?.tenantId || item?.companyId || item?.id || '');
      if (tenant !== currentTenant) return;
      [item.key, item.id, item.tenantId, item.companyId].forEach(value => {
        if (value !== undefined && value !== null && String(value).trim()) identifiers.add(String(value));
      });
    });

    // نكتشف أيضاً مساحة قديمة مرتبطة صراحةً بنفس tenantId من بيانات الوصول.
    for (let i = 0; i < localStorage.length; i += 1) {
      const candidateQueueKey = RAW.key.call(localStorage, i);
      if (!candidateQueueKey?.startsWith('ct_sync_queue::') || candidateQueueKey === current) continue;
      const encodedId = candidateQueueKey.slice('ct_sync_queue::'.length);
      let legacyId = '';
      try { legacyId = decodeURIComponent(encodedId); } catch (_) { legacyId = encodedId; }
      const accessRaw = rawGet(`cashtop_data::${encodedId}::cashtop_company_access`);
      const access = safeJson(accessRaw, {}) || {};
      if (String(access.tenantId || access.companyId || '') === currentTenant) identifiers.add(legacyId);
    }

    return [...identifiers]
      .map(value => `ct_sync_queue::${encodeURIComponent(value)}`)
      .filter(key => key !== current);
  }

  async function migrateLegacySyncQueues() {
    const candidates = legacySyncQueueCandidateKeys();
    if (!candidates.length) return { migrated: 0, sources: 0 };
    let migrated = 0;
    let sources = 0;

    for (const queueKey of candidates) {
      const encodedLegacyId = queueKey.slice('ct_sync_queue::'.length);
      let legacyTenantId = '';
      try { legacyTenantId = decodeURIComponent(encodedLegacyId); } catch (_) { legacyTenantId = encodedLegacyId; }
      const fromStorage = safeJson(rawGet(queueKey), []);
      const fromBackup = await readSyncQueueBackupByKey(queueKey);
      const combined = [
        ...(Array.isArray(fromStorage) ? fromStorage : []),
        ...(Array.isArray(fromBackup) ? fromBackup : [])
      ];
      if (!combined.length) continue;
      sources += 1;
      const seen = new Set();
      for (const item of combined) {
        if (!item?.key || !DATA_KEYS.includes(canonicalKey(item.key))) continue;
        const canonical = canonicalKey(item.key);
        const fingerprint = `${item.id || ''}|${item.key}|${item.createdAt || ''}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        // إذا كان الطابور القديم تابعاً لمساحة key قديمة، ننقل قيمة dataset المعلقة
        // إلى مساحة tenant الحالية قبل رفعها. لا نستبدل نسخة محلية أحدث.
        if (legacyTenantId && legacyTenantId !== companyIdFromSession()) {
          const oldDataKey = namespaceKey(canonical, legacyTenantId);
          const oldMetaKey = metaKey(canonical, legacyTenantId);
          const oldRaw = rawGet(oldDataKey);
          const oldMeta = safeJson(rawGet(oldMetaKey), {}) || {};
          const currentRaw = rawGet(namespaceKey(canonical));
          const currentMeta = safeJson(rawGet(metaKey(canonical)), {}) || {};
          if (oldRaw !== null && (currentRaw === null || Number(oldMeta.updatedAt || 0) >= Number(currentMeta.updatedAt || 0))) {
            rawSet(namespaceKey(canonical), oldRaw);
            rawSet(metaKey(canonical), JSON.stringify({ ...oldMeta, migratedFromTenant: legacyTenantId, migratedAt: Date.now() }));
          }
        }

        enqueueSyncOperation(canonical, {
          touchedIds: item.touchedIds || [],
          deletedIds: item.deletedIds || [],
          touchedFields: item.touchedFields || [],
          deletedFields: item.deletedFields || [],
          nestedArrayChanges: item.nestedArrayChanges || {},
          deletedDataset: item.deletedDataset === true,
          forceReplace: item.forceReplace === true
        });
        migrated += 1;
      }
      // بعد نسخها إلى الطابور الحالي وحفظه في IndexedDB نحذف النسخة القديمة
      // حتى لا تعود العملية نفسها في كل دخول.
      rawRemove(queueKey);
      await deleteSyncQueueBackupByKey(queueKey);
    }

    if (migrated) {
      await backupSyncQueue(getSyncQueue()).catch(() => false);
      window.dispatchEvent(new CustomEvent('cashtop:sync-queue-restored', { detail: { count: getSyncQueue().length, migrated, sources } }));
    }
    return { migrated, sources };
  }

  function getSyncQueue() {
    const queue = safeJson(rawGet(syncQueueKey()), []);
    return Array.isArray(queue) ? queue : [];
  }

  function writeSyncQueue(queue) {
    const normalized = Array.isArray(queue) ? queue.slice(-1200) : [];
    rawSet(syncQueueKey(), JSON.stringify(normalized));
    syncQueueBackupChain = syncQueueBackupChain.then(() => backupSyncQueue(normalized)).catch(() => false);
    updateSyncBadge();
    window.dispatchEvent(new CustomEvent('cashtop:sync-queue-changed', { detail: { count: normalized.length } }));
    return normalized;
  }

  function recordIdentity(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    for (const field of ['id', '_id', 'uuid', 'code', 'key', 'barcode']) {
      const value = item[field];
      if (value !== undefined && value !== null && String(value).trim()) return `${field}:${String(value).trim()}`;
    }
    return '';
  }

  function describeManagedChange(oldValue, newValue) {
    const before = safeJson(oldValue, null);
    const after = safeJson(newValue, null);
    const detail = { touchedIds: [], deletedIds: [], touchedFields: [], deletedFields: [], nestedArrayChanges: {} };
    if (Array.isArray(before) && Array.isArray(after)) {
      const beforeMap = new Map(before.map(item => [recordIdentity(item), item]).filter(([id]) => id));
      const afterMap = new Map(after.map(item => [recordIdentity(item), item]).filter(([id]) => id));
      if (beforeMap.size || afterMap.size) {
        for (const [id, item] of afterMap) {
          if (!beforeMap.has(id) || JSON.stringify(beforeMap.get(id)) !== JSON.stringify(item)) detail.touchedIds.push(id);
        }
        for (const id of beforeMap.keys()) if (!afterMap.has(id)) detail.deletedIds.push(id);
      }
    } else if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(after, key)) {
          detail.deletedFields.push(key);
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(before, key) || JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
          detail.touchedFields.push(key);
          if (Array.isArray(before[key]) && Array.isArray(after[key])) {
            const beforeMap = new Map(before[key].map(item => [recordIdentity(item), item]).filter(([id]) => id));
            const afterMap = new Map(after[key].map(item => [recordIdentity(item), item]).filter(([id]) => id));
            if (beforeMap.size || afterMap.size) {
              const touchedIds = [];
              const deletedIds = [];
              for (const [id, item] of afterMap) {
                if (!beforeMap.has(id) || JSON.stringify(beforeMap.get(id)) !== JSON.stringify(item)) touchedIds.push(id);
              }
              for (const id of beforeMap.keys()) if (!afterMap.has(id)) deletedIds.push(id);
              detail.nestedArrayChanges[key] = { touchedIds, deletedIds };
            }
          }
        }
      }
    }
    return detail;
  }

  function enqueueSyncOperation(key, change = {}) {
    const canonical = canonicalKey(key);
    const queue = getSyncQueue();
    const mergeUnique = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
    // عملية واحدة لكل dataset، مع الاحتفاظ بتفاصيل السجلات/الحقول المتغيرة
    // حتى يمكن دمج تعديلات جهازين بدلاً من استبدال المجموعة كاملة.
    const existing = queue.find(item => item.key === canonical);
    if (existing) {
      existing.createdAt = Date.now();
      existing.deviceId = getDeviceId();
      existing.page = FILE;
      const touchedNow = new Set(change.touchedIds || []);
      const deletedNow = new Set(change.deletedIds || []);
      const touchedFieldsNow = new Set(change.touchedFields || []);
      const deletedFieldsNow = new Set(change.deletedFields || []);
      existing.touchedIds = mergeUnique((existing.touchedIds || []).filter(id => !deletedNow.has(id)), [...touchedNow]);
      existing.deletedIds = mergeUnique((existing.deletedIds || []).filter(id => !touchedNow.has(id)), [...deletedNow]);
      existing.touchedFields = mergeUnique((existing.touchedFields || []).filter(field => !deletedFieldsNow.has(field)), [...touchedFieldsNow]);
      existing.deletedFields = mergeUnique((existing.deletedFields || []).filter(field => !touchedFieldsNow.has(field)), [...deletedFieldsNow]);
      existing.nestedArrayChanges = existing.nestedArrayChanges && typeof existing.nestedArrayChanges === 'object' ? existing.nestedArrayChanges : {};
      Object.entries(change.nestedArrayChanges || {}).forEach(([field, delta]) => {
        const previous = existing.nestedArrayChanges[field] || { touchedIds: [], deletedIds: [] };
        const nestedTouchedNow = new Set(delta?.touchedIds || []);
        const nestedDeletedNow = new Set(delta?.deletedIds || []);
        existing.nestedArrayChanges[field] = {
          touchedIds: mergeUnique((previous.touchedIds || []).filter(id => !nestedDeletedNow.has(id)), [...nestedTouchedNow]),
          deletedIds: mergeUnique((previous.deletedIds || []).filter(id => !nestedTouchedNow.has(id)), [...nestedDeletedNow])
        };
      });
      for (const field of deletedFieldsNow) delete existing.nestedArrayChanges[field];
      if (Object.prototype.hasOwnProperty.call(change, 'deletedDataset')) existing.deletedDataset = change.deletedDataset === true;
      if (change.forceReplace === true) existing.forceReplace = true;
      writeSyncQueue(queue);
      return existing.id;
    }
    const operation = {
      id: crypto.randomUUID ? crypto.randomUUID() : `SYNC_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      key: canonical,
      createdAt: Date.now(),
      deviceId: getDeviceId(),
      page: FILE,
      touchedIds: mergeUnique([], change.touchedIds),
      deletedIds: mergeUnique([], change.deletedIds),
      touchedFields: mergeUnique([], change.touchedFields),
      deletedFields: mergeUnique([], change.deletedFields),
      nestedArrayChanges: JSON.parse(JSON.stringify(change.nestedArrayChanges || {})),
      deletedDataset: change.deletedDataset === true,
      forceReplace: change.forceReplace === true
    };
    queue.push(operation);
    writeSyncQueue(queue);
    return operation.id;
  }

  function completeSyncOperation(operationId) {
    if (!operationId) return getSyncQueue().length;
    const queue = getSyncQueue();
    const index = queue.findIndex(item => item.id === operationId);
    if (index >= 0) queue.splice(index, 1);
    writeSyncQueue(queue);
    return queue.length;
  }

  function clearSyncQueue() {
    return writeSyncQueue([]);
  }

  function updateSyncBadge() {
    const count = getSyncQueue().length;
    const button = document.getElementById('ctSyncButton');
    const badge = document.getElementById('ctSyncBadge');
    if (badge) {
      badge.textContent = count > 999 ? '999+' : String(count);
      badge.hidden = count === 0;
    }
    if (button) button.title = count ? `عمليات بانتظار المزامنة: ${count}` : 'البيانات متزامنة';
    return count;
  }


  let lastSyncProgressDetail = { active: false, done: true };
  function setSyncProgress(detail = {}) {
    lastSyncProgressDetail = { ...lastSyncProgressDetail, ...detail };
    const button = document.getElementById('ctSyncButton');
    const track = document.getElementById('ctSyncProgress');
    const bar = document.getElementById('ctSyncProgressBar');
    if (!track || !bar) return;
    const active = detail.active !== false && detail.done !== true;
    const total = Math.max(0, Number(detail.total || 0));
    const current = Math.max(0, Number(detail.current || 0));
    const percent = total > 0 ? Math.max(3, Math.min(100, (current / total) * 100)) : 28;
    track.hidden = !active;
    track.classList.toggle('ct-sync-progress-indeterminate', active && total <= 0);
    if (total > 0) bar.style.width = `${percent}%`;
    else bar.style.width = '28%';
    if (button) {
      button.classList.toggle('ct-syncing', active);
      if (detail.label) button.title = String(detail.label);
    }
    if (!active) {
      bar.style.width = detail.success === false ? '0%' : '100%';
      window.setTimeout(() => {
        if (track) track.hidden = true;
        if (button) button.classList.remove('ct-syncing');
      }, 320);
    }
  }

  function setRecordsPulling(active, detail = {}) {
    document.body?.classList.toggle('ct-records-pulling', Boolean(active));
    if (document.body) {
      document.body.dataset.ctPullDataset = active ? String(detail.key || detail.dataset || '') : '';
    }
  }

  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('cashtop-app') : null;
  let suppressEvents = false;

  function appendAudit(key, oldValue, newValue, actionOverride) {
    const canonical = canonicalKey(key);
    if (canonical === 'cashtop_audit_log') return;
    const session = getSession() || {};
    const auditNs = namespaceKey('cashtop_audit_log');
    const list = safeJson(rawGet(auditNs), []) || [];
    const oldParsed = safeJson(oldValue, oldValue);
    const newParsed = safeJson(newValue, newValue);
    let action = actionOverride || 'update';
    if (Array.isArray(oldParsed) && Array.isArray(newParsed)) {
      if (newParsed.length > oldParsed.length) action = 'create';
      else if (newParsed.length < oldParsed.length) action = 'delete';
    } else if (oldValue == null && newValue != null) action = 'create';
    else if (newValue == null) action = 'delete';
    const entityInfo = auditEntityInfo(oldParsed, newParsed, action);

    list.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `AUD_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      tenantId: session.tenantId || session.companyId || session.companyKey || null,
      companyId: session.tenantId || session.companyId || session.companyKey || null,
      branchId: branchIdFromSession(session),
      userId: session.uid || session.username || null,
      username: session.displayName || session.name || session.username || 'غير معروف',
      role: session.role || 'user',
      page: FILE,
      dataset: canonical,
      action,
      entityId: entityInfo.entityId,
      entityName: entityInfo.entityName,
      details: entityInfo.details,
      oldSummary: summarizeValue(oldParsed),
      newSummary: summarizeValue(newParsed),
      deviceId: getDeviceId()
    });
    // Keep only a small recent cache locally. Full history is uploaded as
    // append-only day-sharded records by firebase-sync.js, so large audit logs
    // never become one giant localStorage/Firebase dataset.
    if (list.length > 100) list.splice(0, list.length - 100);
    const record = list[list.length - 1];
    rawSet(auditNs, JSON.stringify(list));
    const pendingKey = auditPendingStorageKey();
    const pending = safeJson(rawGet(pendingKey), []) || [];
    pending.push(record);
    // Small synchronous fallback/recent queue. The durable offline queue is
    // IndexedDB so months of audit activity do not fill localStorage or RAM.
    if (pending.length > 100) pending.splice(0, pending.length - 100);
    rawSet(pendingKey, JSON.stringify(pending));
    const signalAuditPending = () => window.dispatchEvent(new CustomEvent('cashtop:audit-pending', { detail: { id: record.id } }));
    auditQueuePut(record).then(() => pruneAuditQueueCompany(100)).then(signalAuditPending).catch(signalAuditPending);
  }

  function auditPendingStorageKey() {
    return `ct_audit_pending::${encodeURIComponent(companyIdFromSession())}`;
  }

  function getAuditPending() {
    return normalizeArrayValue(rawGet(auditPendingStorageKey()), []).slice(-100);
  }

  function completeAuditPending(ids = []) {
    const set = new Set((ids || []).map(String));
    if (!set.size) return 0;
    const pending = getAuditPending();
    const remaining = pending.filter(item => !set.has(String(item?.id || '')));
    rawSet(auditPendingStorageKey(), JSON.stringify(remaining));
    return pending.length - remaining.length;
  }

  function getRecentAuditCache() {
    return normalizeArrayValue(rawGet(namespaceKey('cashtop_audit_log')), []).slice(-100);
  }

  const AUDIT_QUEUE_DB = 'cashtop-audit-queue-v1';
  const AUDIT_QUEUE_STORE = 'pending';
  let auditDbPromise = null;
  function openAuditQueueDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('INDEXEDDB_UNAVAILABLE'));
    if (auditDbPromise) return auditDbPromise;
    auditDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(AUDIT_QUEUE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.objectStoreNames.contains(AUDIT_QUEUE_STORE)
          ? req.transaction.objectStore(AUDIT_QUEUE_STORE)
          : db.createObjectStore(AUDIT_QUEUE_STORE, { keyPath: 'id' });
        if (!store.indexNames.contains('companyId')) store.createIndex('companyId', 'companyId', { unique: false });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('AUDIT_DB_OPEN_FAILED'));
      req.onblocked = () => reject(new Error('AUDIT_DB_BLOCKED'));
    }).catch(error => { auditDbPromise = null; throw error; });
    return auditDbPromise;
  }

  async function auditQueuePut(record) {
    if (!record?.id) return false;
    const db = await openAuditQueueDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIT_QUEUE_STORE, 'readwrite');
      tx.objectStore(AUDIT_QUEUE_STORE).put({ ...record, companyId: String(record.companyId || companyIdFromSession()) });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('AUDIT_DB_PUT_FAILED'));
      tx.onabort = () => reject(tx.error || new Error('AUDIT_DB_PUT_ABORTED'));
    });
  }

  async function pruneAuditQueueCompany(limit = 100) {
    if (!('indexedDB' in window)) return 0;
    try {
      const db = await openAuditQueueDb();
      const companyId = String(companyIdFromSession());
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIT_QUEUE_STORE, 'readonly');
        const index = tx.objectStore(AUDIT_QUEUE_STORE).index('companyId');
        const req = index.openCursor(IDBKeyRange.only(companyId));
        const out = [];
        req.onsuccess = () => { const c=req.result; if(!c) return resolve(out); out.push(c.value); c.continue(); };
        req.onerror = () => reject(req.error || new Error('AUDIT_DB_READ_FAILED'));
      });
      rows.sort((a,b)=>normalizeDateValue(b.timestamp)-normalizeDateValue(a.timestamp));
      const remove = rows.slice(Math.max(0, Number(limit)||100)).map(x=>String(x.id||'')).filter(Boolean);
      if (!remove.length) return 0;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIT_QUEUE_STORE, 'readwrite');
        const store = tx.objectStore(AUDIT_QUEUE_STORE);
        remove.forEach(id=>store.delete(id));
        tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error || new Error('AUDIT_DB_PRUNE_FAILED'));
      });
      return remove.length;
    } catch (_) { return 0; }
  }

  async function getAuditPendingAsync(limit = 0) {
    const fallback = getAuditPending();
    try {
      const db = await openAuditQueueDb();
      const companyId = String(companyIdFromSession());
      const max = Math.max(0, Number(limit || 0));
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIT_QUEUE_STORE, 'readonly');
        const index = tx.objectStore(AUDIT_QUEUE_STORE).index('companyId');
        const req = index.openCursor(IDBKeyRange.only(companyId));
        const out = [];
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor || (max && out.length >= max)) return resolve(out);
          out.push(cursor.value);
          cursor.continue();
        };
        req.onerror = () => reject(req.error || new Error('AUDIT_DB_READ_FAILED'));
      });
      const map = new Map();
      [...rows, ...fallback].forEach(item => item?.id && map.set(String(item.id), item));
      const merged = [...map.values()].sort((a,b) => normalizeDateValue(a.timestamp) - normalizeDateValue(b.timestamp));
      return max ? merged.slice(0, max) : merged;
    } catch (_) {
      return limit ? fallback.slice(0, Number(limit)) : fallback;
    }
  }

  async function completeAuditPendingAsync(ids) {
    const set = new Set((ids || []).map(String));
    if (!set.size) return 0;
    completeAuditPending([...set]);
    try {
      const db = await openAuditQueueDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIT_QUEUE_STORE, 'readwrite');
        const store = tx.objectStore(AUDIT_QUEUE_STORE);
        set.forEach(id => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('AUDIT_DB_DELETE_FAILED'));
      });
    } catch (_) {}
    return set.size;
  }

  async function getAuditPendingCountAsync() {
    try {
      const db = await openAuditQueueDb();
      const companyId = String(companyIdFromSession());
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(AUDIT_QUEUE_STORE, 'readonly');
        const req = tx.objectStore(AUDIT_QUEUE_STORE).index('companyId').count(IDBKeyRange.only(companyId));
        req.onsuccess = () => resolve(Number(req.result || 0));
        req.onerror = () => reject(req.error || new Error('AUDIT_DB_COUNT_FAILED'));
      });
    } catch (_) { return getAuditPending().length; }
  }

  function summarizeValue(value) {
    if (Array.isArray(value)) return { type: 'array', count: value.length };
    if (value && typeof value === 'object') return { type: 'object', keys: Object.keys(value).slice(0, 30) };
    if (typeof value === 'string') return value.slice(0, 180);
    return value;
  }

  function auditEntityInfo(oldValue, newValue, action) {
    const idOf = item => item && typeof item === 'object' ? String(item.id ?? item._id ?? item.uid ?? item.refNumber ?? item.number ?? '') : '';
    const nameOf = item => item && typeof item === 'object'
      ? String(item.name ?? item.title ?? item.employeeName ?? item.customer ?? item.supplierName ?? item.productName ?? item.refNumber ?? item.id ?? '')
      : '';
    let before = null, after = null;
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      if (newValue.length > oldValue.length) {
        const ids = new Set(oldValue.map(idOf).filter(Boolean));
        after = newValue.find(item => { const id = idOf(item); return id && !ids.has(id); }) || newValue[newValue.length - 1] || null;
      } else if (newValue.length < oldValue.length) {
        const ids = new Set(newValue.map(idOf).filter(Boolean));
        before = oldValue.find(item => { const id = idOf(item); return id && !ids.has(id); }) || oldValue[oldValue.length - 1] || null;
      } else {
        const limit = Math.min(oldValue.length, newValue.length);
        for (let i = 0; i < limit; i += 1) {
          const a = oldValue[i], b = newValue[i];
          if (idOf(a) !== idOf(b) || JSON.stringify(a) !== JSON.stringify(b)) { before = a; after = b; break; }
        }
      }
    } else if (oldValue && typeof oldValue === 'object' && newValue && typeof newValue === 'object') {
      before = oldValue; after = newValue;
    } else if (action === 'create') after = newValue;
    else if (action === 'delete') before = oldValue;
    const entity = after || before;
    const entityId = idOf(entity);
    const entityName = nameOf(entity);
    const details = [entityName, entityId && entityId !== entityName ? `#${entityId}` : ''].filter(Boolean).join(' ');
    return { entityId: entityId || null, entityName: entityName || null, details: details || null };
  }

  function dispatchLogicalStorageEvents(key, oldValue, newValue) {
    const canonical = canonicalKey(key);
    const logicalKeys = [canonical, ...Object.keys(ALIASES).filter(alias => ALIASES[alias] === canonical)];
    logicalKeys.forEach(logicalKey => {
      try {
        window.dispatchEvent(new StorageEvent('storage', {
          key: logicalKey,
          oldValue: oldValue == null ? null : String(oldValue),
          newValue: newValue == null ? null : String(newValue),
          url: location.href,
          storageArea: localStorage
        }));
      } catch (_) {
        const event = new Event('storage');
        Object.defineProperties(event, {
          key: { value: logicalKey }, oldValue: { value: oldValue }, newValue: { value: newValue },
          url: { value: location.href }, storageArea: { value: localStorage }
        });
        window.dispatchEvent(event);
      }
    });
  }

  function emitDataChange(key, oldValue, value, source = 'local', operationId = null) {
    if (suppressEvents) return;
    const detail = {
      key: canonicalKey(key),
      oldValue,
      value,
      companyId: companyIdFromSession(),
      updatedAt: Date.now(),
      source,
      deviceId: getDeviceId(),
      operationId
    };
    window.dispatchEvent(new CustomEvent('cashtop:data-changed', { detail }));
    if (detail.key === 'cashtop_funds_db') window.dispatchEvent(new CustomEvent('cashtop:funds-changed', { detail }));
    if (channel) channel.postMessage({ type: 'data-change', ...detail });
  }

  function canClaimLegacyUnscopedData(tenantId) {
    const ownerKey = 'ct_legacy_data_owner_tenant_v2';
    const currentOwner = rawGet(ownerKey);
    if (currentOwner) return currentOwner === String(tenantId);

    // إذا كانت هناك مساحة بيانات لشركة أخرى فلا ننقل أي مفاتيح قديمة غير معزولة
    // إلى الشركة الحالية. هذا هو أهم حاجز لمنع ظهور بيانات مفتاح سابق داخل مفتاح جديد.
    const encodedCurrent = encodeURIComponent(String(tenantId));
    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = RAW.key.call(localStorage, i);
      if (!storageKey || !storageKey.startsWith('cashtop_data::')) continue;
      const remainder = storageKey.slice('cashtop_data::'.length);
      const encodedTenant = remainder.split('::')[0];
      if (encodedTenant && encodedTenant !== encodedCurrent) return false;
    }
    rawSet(ownerKey, String(tenantId));
    return true;
  }

  function migrateLegacyValue(key) {
    const canonical = canonicalKey(key);
    const tenantId = tenantIdFromSession();
    const ns = namespaceKey(canonical, tenantId);
    let current = rawGet(ns);
    if (current !== null) return current;

    const candidates = [canonical, ...Object.keys(ALIASES).filter(k => ALIASES[k] === canonical)];
    const hasLegacy = candidates.some(candidate => rawGet(candidate) !== null);
    if (!hasLegacy || !canClaimLegacyUnscopedData(tenantId)) return null;

    for (const candidate of candidates) {
      const legacy = rawGet(candidate);
      if (legacy !== null) {
        rawSet(ns, legacy);
        rawSet(metaKey(canonical, tenantId), JSON.stringify({ updatedAt: Date.now(), revision: 1, migratedFrom: candidate, tenantId }));
        candidates.forEach(rawRemove);
        return legacy;
      }
    }
    return null;
  }


  const BRANCH_SCOPED_ARRAY_KEYS = new Set([
    'cashtop_customers', 'cashtop_customer_groups', 'cashtop_suppliers', 'cashtop_supplier_movements',
    'cashtop_invoices', 'cashtop_purchases', 'cashtop_purchase_returns', 'cashtop_expenses',
    'cashtop_expense_types', 'cashtop_vouchers', 'cashtop_stores', 'cashtop_transfer_history',
    'cashtop_workers', 'cashtop_sales_agents', 'cashtop_agent_movements', 'cashtop_journal',
    'cashtop_audit_log', 'cashtop_sales_offers', 'cashtop_manufacturing_recipes',
    'cashtop_manufacturing_orders', 'cashtop_wastage'
  ]);
  const BRANCH_SCOPED_OBJECT_KEYS = new Set(['cashtop_funds_db']);

  function isCompanyAdminRole(role) {
    return ['admin', 'owner', 'company-admin'].includes(String(role || '').toLowerCase());
  }

  function deepClone(value) {
    if (value == null) return value;
    try { return structuredClone(value); } catch (_) {
      try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }
  }

  function fullDatasetValue(key, fallback = null, companyId = companyIdFromSession()) {
    const raw = rawGet(namespaceKey(canonicalKey(key), companyId));
    if (raw == null) return fallback;
    return safeJson(raw, fallback);
  }

  function branchIdFromSession(session = getSession()) {
    session = session || {};
    if (session.dataBranchId) return String(session.dataBranchId);
    const role = String(session.role || '').toLowerCase();
    if (isCompanyAdminRole(role)) return 'MAIN';
    const recordId = session.branchRecordId || session.branchId;
    if (!recordId) return 'MAIN';
    const companyId = session.tenantId || session.companyId || session.companyKey || companyIdFromSession();
    const branches = normalizeArrayValue(fullDatasetValue('cashtop_branches', [], companyId), []);
    const branch = branches.find(item => String(item.id) === String(recordId));
    return branch?.isMain === true ? 'MAIN' : String(recordId);
  }

  function recordBranchId(record) {
    const value = record && (record.dataBranchId || record.branchId);
    return value == null || value === '' ? 'MAIN' : String(value);
  }

  const branchStoreScopeCache = new Map();
  function storeIdsForBranch(branchId, companyId = companyIdFromSession()) {
    const branch = String(branchId || 'MAIN');
    const rawStores = rawGet(namespaceKey('cashtop_stores', companyId)) || '[]';
    const cacheKey = `${companyId}::${branch}`;
    const cached = branchStoreScopeCache.get(cacheKey);
    if (cached && cached.raw === rawStores) return cached.ids;
    const stores = normalizeArrayValue(safeJson(rawStores, []), []);
    const ids = new Set(stores.filter(store => recordBranchId(store) === branch).map(store => String(store.id || '')).filter(Boolean));
    branchStoreScopeCache.set(cacheKey, { raw: rawStores, ids });
    return ids;
  }

  function filterStockMapForStores(stockMap, storeIds) {
    const source = stockMap && typeof stockMap === 'object' ? stockMap : {};
    const result = {};
    storeIds.forEach(id => {
      if (Object.prototype.hasOwnProperty.call(source, id)) result[id] = Math.max(0, Number(source[id] || 0));
    });
    return result;
  }

  function mergeStockMapForStores(oldMap, incomingMap, storeIds) {
    const result = deepClone(oldMap && typeof oldMap === 'object' ? oldMap : {}) || {};
    const source = incomingMap && typeof incomingMap === 'object' ? incomingMap : {};
    storeIds.forEach(id => {
      if (Object.prototype.hasOwnProperty.call(source, id)) result[id] = Math.max(0, Number(source[id] || 0));
      else delete result[id];
    });
    return result;
  }

  function sameBranch(record, branchId = branchIdFromSession()) {
    return recordBranchId(record) === String(branchId || 'MAIN');
  }

  function productVisibleInBranch(product, branchId) {
    if (!product || typeof product !== 'object') return false;
    const branch = String(branchId || 'MAIN');
    const catalog = product.branchCatalog && typeof product.branchCatalog === 'object' ? product.branchCatalog : {};
    if (branch === 'MAIN') {
      if (catalog.MAIN === true || String(product.ownerBranchId || 'MAIN') === 'MAIN') return true;
      if (!Object.keys(catalog).length && product.ownerBranchId == null) return true; // legacy product
      return Number(product.stockPieces || 0) !== 0 || Array.isArray(product.inventoryLots) && product.inventoryLots.length > 0;
    }
    if (catalog[branch] === true || String(product.ownerBranchId || '') === branch) return true;
    if (product.branchStocks && Object.prototype.hasOwnProperty.call(product.branchStocks, branch)) return true;
    if (product.branchInventoryLots && Array.isArray(product.branchInventoryLots[branch])) return true;
    const scopedStores = storeIdsForBranch(branch);
    if ([...scopedStores].some(id => Number(product.storeStocks?.[id] || 0) > 0)) return true;
    return Array.isArray(product.variants) && product.variants.some(v =>
      (v?.branchStocks && Object.prototype.hasOwnProperty.call(v.branchStocks, branch)) ||
      [...scopedStores].some(id => Number(v?.storeStocks?.[id] || 0) > 0)
    );
  }

  function projectProductForBranch(product, branchId) {
    const branch = String(branchId || 'MAIN');
    const clone = deepClone(product) || {};
    const scopedStores = storeIdsForBranch(branch);
    clone.__ctDataBranchId = branch;
    clone.storeStocks = filterStockMapForStores(product.storeStocks, scopedStores);
    if (branch === 'MAIN') {
      clone.inventoryLots = normalizeArrayValue(product.inventoryLots || [], []).filter(lot => recordBranchId(lot) === 'MAIN');
      if (Array.isArray(clone.variants)) clone.variants.forEach((variant, index) => {
        variant.qty = Number(product.variants?.[index]?.qty || 0);
        variant.storeStocks = filterStockMapForStores(product.variants?.[index]?.storeStocks, scopedStores);
      });
      return clone;
    }
    clone.stockPieces = Math.max(0, Number(product.branchStocks?.[branch] || 0));
    clone.inventoryLots = deepClone(product.branchInventoryLots?.[branch] || normalizeArrayValue(product.inventoryLots || [], []).filter(lot => recordBranchId(lot) === branch)) || [];
    if (Array.isArray(clone.variants)) {
      clone.variants.forEach((variant, index) => {
        const original = product.variants?.[index] || variant;
        variant.qty = Math.max(0, Number(original.branchStocks?.[branch] || 0));
        variant.storeStocks = filterStockMapForStores(original.storeStocks, scopedStores);
      });
    }
    return clone;
  }

  function projectProducts(rawValue) {
    const branch = branchIdFromSession();
    return JSON.stringify(normalizeArrayValue(rawValue, []).filter(product => productVisibleInBranch(product, branch)).map(product => projectProductForBranch(product, branch)));
  }

  function variantIdentity(variant, index) {
    return String(variant?.id || variant?.barcode || `${variant?.size || ''}::${variant?.color || ''}::${index}`);
  }

  function mergeProductForBranch(existing, incoming, branchId) {
    const branch = String(branchId || 'MAIN');
    const source = deepClone(incoming) || {};
    delete source.__ctDataBranchId;
    let target = existing ? deepClone(existing) : {};
    const preserved = {
      stockPieces: Number(target.stockPieces || 0),
      inventoryLots: deepClone(target.inventoryLots || []),
      branchStocks: deepClone(target.branchStocks || {}),
      branchInventoryLots: deepClone(target.branchInventoryLots || {}),
      branchCatalog: deepClone(target.branchCatalog || {}),
      storeStocks: deepClone(target.storeStocks || {}),
      variants: deepClone(target.variants || [])
    };
    const skip = new Set(['stockPieces','inventoryLots','branchStocks','branchInventoryLots','branchCatalog','storeStocks','variants','__ctDataBranchId']);
    Object.entries(source).forEach(([key, value]) => { if (!skip.has(key)) target[key] = deepClone(value); });
    target.id = target.id || source.id || `P_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    target.branchStocks = preserved.branchStocks || {};
    target.branchInventoryLots = preserved.branchInventoryLots || {};
    target.branchCatalog = preserved.branchCatalog || {};
    const scopedStores = storeIdsForBranch(branch);
    target.storeStocks = mergeStockMapForStores(preserved.storeStocks, source.storeStocks, scopedStores);
    const oldVariants = preserved.variants || [];
    const oldById = new Map(oldVariants.map((v,i) => [variantIdentity(v,i), v]));
    target.variants = normalizeArrayValue(source.variants || [], []).map((variant, index) => {
      const old = oldById.get(variantIdentity(variant,index)) || oldVariants[index] || {};
      const merged = { ...deepClone(old), ...deepClone(variant) };
      merged.branchStocks = deepClone(old.branchStocks || variant.branchStocks || {});
      merged.storeStocks = mergeStockMapForStores(old.storeStocks || {}, variant.storeStocks || {}, scopedStores);
      if (branch === 'MAIN') merged.qty = Math.max(0, Number(variant.qty || 0));
      else {
        merged.qty = Math.max(0, Number(old.qty || 0));
        merged.branchStocks[branch] = Math.max(0, Number(variant.qty || 0));
      }
      return merged;
    });
    if (branch === 'MAIN') {
      target.stockPieces = Math.max(0, Number(source.stockPieces || 0));
      target.inventoryLots = normalizeArrayValue(source.inventoryLots || [], []).map(lot => ({ ...deepClone(lot), branchId: 'MAIN' }));
      target.branchCatalog.MAIN = true;
      target.ownerBranchId = target.ownerBranchId || 'MAIN';
    } else {
      target.stockPieces = preserved.stockPieces;
      target.inventoryLots = preserved.inventoryLots;
      target.branchStocks[branch] = Math.max(0, Number(source.stockPieces || 0));
      target.branchInventoryLots[branch] = normalizeArrayValue(source.inventoryLots || [], []).map(lot => ({ ...deepClone(lot), branchId: branch }));
      target.branchCatalog[branch] = true;
      target.ownerBranchId = target.ownerBranchId || branch;
    }
    return target;
  }

  function productHasAnyBranch(product) {
    if (Number(product.stockPieces || 0) > 0 || product.branchCatalog?.MAIN === true) return true;
    if (Object.values(product.branchStocks || {}).some(value => Number(value || 0) > 0)) return true;
    if (Object.values(product.storeStocks || {}).some(value => Number(value || 0) > 0)) return true;
    if (Object.values(product.branchCatalog || {}).some(Boolean)) return true;
    return Array.isArray(product.variants) && product.variants.some(v =>
      Number(v.qty || 0) > 0 ||
      Object.values(v.branchStocks || {}).some(value => Number(value || 0) > 0) ||
      Object.values(v.storeStocks || {}).some(value => Number(value || 0) > 0)
    );
  }

  function mergeProducts(rawOld, incomingValue) {
    const branch = branchIdFromSession();
    const full = normalizeArrayValue(rawOld, []);
    const incoming = normalizeArrayValue(incomingValue, []);
    const incomingIds = new Set(incoming.map(p => String(p.id)));
    const byId = new Map(full.map(p => [String(p.id), p]));
    incoming.forEach(item => byId.set(String(item.id), mergeProductForBranch(byId.get(String(item.id)), item, branch)));
    for (const product of full) {
      if (!productVisibleInBranch(product, branch) || incomingIds.has(String(product.id))) continue;
      const target = byId.get(String(product.id));
      const scopedStores = storeIdsForBranch(branch);
      if (branch === 'MAIN') {
        target.stockPieces = 0; target.inventoryLots = [];
        if (target.branchCatalog) delete target.branchCatalog.MAIN;
        scopedStores.forEach(id => { if (target.storeStocks) delete target.storeStocks[id]; });
        (target.variants || []).forEach(v => {
          v.qty = 0;
          scopedStores.forEach(id => { if (v.storeStocks) delete v.storeStocks[id]; });
        });
      } else {
        if (target.branchStocks) delete target.branchStocks[branch];
        if (target.branchInventoryLots) delete target.branchInventoryLots[branch];
        if (target.branchCatalog) delete target.branchCatalog[branch];
        scopedStores.forEach(id => { if (target.storeStocks) delete target.storeStocks[id]; });
        (target.variants || []).forEach(v => {
          if (v.branchStocks) delete v.branchStocks[branch];
          scopedStores.forEach(id => { if (v.storeStocks) delete v.storeStocks[id]; });
        });
      }
      if (!productHasAnyBranch(target)) byId.delete(String(product.id));
    }
    return JSON.stringify([...byId.values()]);
  }

  function projectBranchArray(rawValue) {
    const branch = branchIdFromSession();
    return JSON.stringify(normalizeArrayValue(rawValue, []).filter(item => sameBranch(item, branch)));
  }

  function recordIdentity(record, index) {
    return String(record?.id || record?.invoiceId || record?.code || record?.number || `IDX_${index}`);
  }

  function mergeBranchArray(rawOld, incomingValue) {
    const branch = branchIdFromSession();
    const old = normalizeArrayValue(rawOld, []);
    const incoming = normalizeArrayValue(incomingValue, []).map(item => ({ ...deepClone(item), branchId: branch }));
    const keep = old.filter(item => !sameBranch(item, branch));
    return JSON.stringify([...keep, ...incoming]);
  }

  function projectFunds(rawValue) {
    const branch = branchIdFromSession();
    const db = safeJson(rawValue, {}) || {};
    return JSON.stringify({
      ...db,
      accounts: normalizeArrayValue(db.accounts || [], []).filter(item => sameBranch(item, branch)),
      accountLogs: normalizeArrayValue(db.accountLogs || [], []).filter(item => sameBranch(item, branch))
    });
  }

  function mergeFunds(rawOld, incomingValue) {
    const branch = branchIdFromSession();
    const old = safeJson(rawOld, {}) || {};
    const incoming = safeJson(incomingValue, {}) || {};
    return JSON.stringify({
      ...old, ...incoming,
      accounts: [
        ...normalizeArrayValue(old.accounts || [], []).filter(item => !sameBranch(item, branch)),
        ...normalizeArrayValue(incoming.accounts || [], []).map(item => ({ ...deepClone(item), branchId: branch }))
      ],
      accountLogs: [
        ...normalizeArrayValue(old.accountLogs || [], []).filter(item => !sameBranch(item, branch)),
        ...normalizeArrayValue(incoming.accountLogs || [], []).map(item => ({ ...deepClone(item), branchId: branch }))
      ]
    });
  }

  function getCompanyAccess() {
    return fullDatasetValue('cashtop_company_access', {}) || {};
  }

  const PLUS_LIMITS = Object.freeze({ products:200, suppliers:50, branches:2, storesPerBranch:2, employeesPerBranch:3, invoicesDailyPerBranch:200, expensesDailyCompany:20, customersDailyCompany:100, purchasesDailyCompany:10 });
  function currentPlan() {
    const session = getSession() || {};
    const access = getCompanyAccess();
    return String(access.plan || session.plan || 'pro').toLowerCase() === 'plus' ? 'plus' : 'pro';
  }
  function dateKey(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function isTodayRecord(record) { return dateKey(record?.date || record?.createdAt || record?.timestamp || record?.updatedAt) === dateKey(Date.now()); }
  function countBranch(array, branch) { return normalizeArrayValue(array, []).filter(item => sameBranch(item, branch)).length; }
  function quotaViolation(canonical, oldRaw, newRaw) {
    if (currentPlan() !== 'plus') return '';
    const branch = branchIdFromSession();
    const oldVal = safeJson(oldRaw, canonical === 'cashtop_funds_db' ? {} : []);
    const newVal = safeJson(newRaw, canonical === 'cashtop_funds_db' ? {} : []);
    const grewPast = (oldCount, newCount, limit, label) => newCount > limit && newCount > oldCount ? `وصلت خطة Plus إلى حد ${label} (${limit}).` : '';
    if (canonical === 'cashtop_products') return grewPast(countBranchProducts(oldVal, branch), countBranchProducts(newVal, branch), PLUS_LIMITS.products, 'المنتجات لكل فرع');
    if (canonical === 'cashtop_suppliers') return grewPast(countBranch(oldVal, branch), countBranch(newVal, branch), PLUS_LIMITS.suppliers, 'الموردين لكل فرع');
    if (canonical === 'cashtop_branches') return grewPast(normalizeArrayValue(oldVal, []).length, normalizeArrayValue(newVal, []).length, PLUS_LIMITS.branches, 'الفروع');
    if (canonical === 'cashtop_stores') return grewPast(countBranch(oldVal, branch), countBranch(newVal, branch), PLUS_LIMITS.storesPerBranch, 'المخازن لكل فرع');
    if (canonical === 'cashtop_employees') {
      const oldCounts = employeeCounts(oldVal), newCounts = employeeCounts(newVal);
      for (const [bid,count] of Object.entries(newCounts)) if (count > PLUS_LIMITS.employeesPerBranch && count > Number(oldCounts[bid] || 0)) return `وصلت خطة Plus إلى حد الموظفين للفرع (${PLUS_LIMITS.employeesPerBranch}).`;
    }
    if (canonical === 'cashtop_invoices') return grewPast(todayBranchCount(oldVal, branch), todayBranchCount(newVal, branch), PLUS_LIMITS.invoicesDailyPerBranch, 'فواتير البيع اليومية للفرع');
    if (canonical === 'cashtop_expenses') return grewPast(todayCount(oldVal), todayCount(newVal), PLUS_LIMITS.expensesDailyCompany, 'المصروفات اليومية للشركة');
    if (canonical === 'cashtop_customers') return grewPast(todayCount(oldVal), todayCount(newVal), PLUS_LIMITS.customersDailyCompany, 'العملاء الجدد يومياً للشركة');
    if (canonical === 'cashtop_purchases') return grewPast(todayCount(oldVal), todayCount(newVal), PLUS_LIMITS.purchasesDailyCompany, 'فواتير المشتريات اليومية للشركة');
    return '';
  }
  function countBranchProducts(products, branch) { return normalizeArrayValue(products, []).filter(p => productVisibleInBranch(p, branch)).length; }
  function employeeCounts(items) { const out={}; normalizeArrayValue(items, []).forEach(item => { const bid=String(item.branchId||'MAIN'); out[bid]=(out[bid]||0)+1; }); return out; }
  function todayCount(items) { return normalizeArrayValue(items, []).filter(isTodayRecord).length; }
  function todayBranchCount(items, branch) { return normalizeArrayValue(items, []).filter(item => sameBranch(item, branch) && isTodayRecord(item)).length; }

  /*
   * Revision 43: every record list is exposed newest-first at the storage API
   * boundary. This makes legacy pages, desktop tables and mobile cards agree
   * without duplicating sorting logic in every screen. The stored dataset stays
   * tenant-scoped; sorting only affects the projected value returned to a page.
   */
  function parseRecordDateValue(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1e11 ? value : 0;
    }
    const text = String(value).trim();
    if (!text) return 0;
    if (/^\d{12,}$/.test(text)) return Number(text);
    const ar = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T،,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (ar) {
      const [, d, m, y, hh='0', mm='0', ss='0'] = ar;
      const time = new Date(Number(y), Number(m)-1, Number(d), Number(hh), Number(mm), Number(ss)).getTime();
      return Number.isFinite(time) ? time : 0;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function recordNewestEpoch(record) {
    if (!record || typeof record !== 'object') return 0;
    const fields = [
      'createdAt','created_at','createdDate','created_date','timestamp','timeStamp',
      'updatedAt','updated_at','date','invoiceDate','purchaseDate','paymentDate',
      'movementDate','transactionDate','orderDate','addedAt','savedAt'
    ];
    for (const field of fields) {
      const value = parseRecordDateValue(record[field]);
      if (value) return value;
    }
    for (const field of ['id','invoiceId','reference','number','code']) {
      const match = String(record[field] ?? '').match(/(\d{12,})/);
      if (match) return Number(match[1]) || 0;
    }
    return 0;
  }

  function sortNewestFirstRecords(input) {
    const list = normalizeArrayValue(input, []);
    return list.map((record, index) => ({ record, index, epoch: recordNewestEpoch(record) }))
      .sort((a, b) => (b.epoch - a.epoch) || (b.index - a.index))
      .map(item => item.record);
  }

  function transformManagedRead(canonical, rawValue) {
    if (rawValue == null) return rawValue;
    if (canonical === 'cashtop_products') {
      const projected = safeJson(projectProducts(safeJson(rawValue, [])), []);
      return JSON.stringify(sortNewestFirstRecords(projected));
    }
    if (BRANCH_SCOPED_ARRAY_KEYS.has(canonical)) {
      const projected = safeJson(projectBranchArray(safeJson(rawValue, [])), []);
      return JSON.stringify(sortNewestFirstRecords(projected));
    }
    if (BRANCH_SCOPED_OBJECT_KEYS.has(canonical)) return projectFunds(rawValue);
    const parsed = safeJson(rawValue, null);
    if (Array.isArray(parsed)) return JSON.stringify(sortNewestFirstRecords(parsed));
    return rawValue;
  }

  function transformManagedWrite(canonical, oldRaw, value) {
    if (canonical === 'cashtop_products') return mergeProducts(safeJson(oldRaw, []), safeJson(value, []));
    if (BRANCH_SCOPED_ARRAY_KEYS.has(canonical)) return mergeBranchArray(safeJson(oldRaw, []), safeJson(value, []));
    if (BRANCH_SCOPED_OBJECT_KEYS.has(canonical)) return mergeFunds(oldRaw, value);
    return String(value);
  }

  function getRawCompanyDataset(key) {
    return rawGet(namespaceKey(canonicalKey(key)));
  }

  // كتابة مجموعة الشركة الكاملة دون إسقاطها على فرع الجلسة الحالية.
  // تستخدمها العمليات العابرة للفروع (مثل النقل من مخزن في فرع إلى مخزن في فرع آخر).
  function setRawCompanyDataset(key, value, options = {}) {
    const canonical = canonicalKey(key);
    if (!isManagedKey(canonical)) throw new Error('مجموعة البيانات غير مدارة');
    const ns = namespaceKey(canonical);
    const oldValue = rawGet(ns);
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (oldValue === stringValue) return { changed: false, operationId: null };
    rawSet(ns, stringValue);
    const previousMeta = safeJson(rawGet(metaKey(canonical)), {}) || {};
    rawSet(metaKey(canonical), JSON.stringify({
      updatedAt: Date.now(),
      revision: Number(previousMeta.revision || 0) + 1,
      deviceId: getDeviceId(),
      page: FILE,
      fullDatasetWrite: true
    }));
    if (options.audit !== false) appendAudit(canonical, oldValue, stringValue, options.action);
    const operationId = options.enqueue === false ? null : enqueueSyncOperation(canonical);
    emitDataChange(canonical, oldValue, stringValue, 'local-full', operationId);
    return { changed: true, operationId };
  }


  /* ============================================================
   * Performance + atomic data layer
   * ============================================================ */
  const pendingVirtualRenders = new WeakMap();

  function debounce(fn, wait = 300) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      const ctx = this;
      timer = setTimeout(() => fn.apply(ctx, args), Math.max(0, Number(wait) || 0));
    };
  }

  function runWhenIdle(callback, timeout = 700) {
    if (typeof requestIdleCallback === 'function') return requestIdleCallback(callback, { timeout });
    return setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0);
  }

  function cancelWhenIdle(id) {
    if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id);
    else clearTimeout(id);
  }

  /**
   * Lazy table renderer: only the first chunk is inserted initially. More rows
   * are appended when the user approaches the sentinel. This is intentionally
   * shared by products, invoices and any other large record table.
   */
  function renderVirtualRows(tbody, records, rowFactory, options = {}) {
    if (!tbody || typeof rowFactory !== 'function') return { rendered: 0, total: 0 };
    const previous = pendingVirtualRenders.get(tbody);
    if (previous?.observer) previous.observer.disconnect();
    if (previous?.idleId) cancelWhenIdle(previous.idleId);
    if (previous?.scrollCleanup) previous.scrollCleanup();

    const list = Array.isArray(records) ? records : [];
    const chunkSize = Math.max(25, Number(options.chunkSize || 100));
    const eagerLimit = Math.max(chunkSize, Number(options.eagerLimit || 180));
    const colspan = Math.max(1, Number(options.colspan || tbody.closest('table')?.querySelectorAll('thead th').length || 1));
    const token = { cancelled: false, observer: null, idleId: null, scrollCleanup: null };
    pendingVirtualRenders.set(tbody, token);
    tbody.innerHTML = '';

    if (!list.length) {
      if (options.emptyHtml) tbody.innerHTML = options.emptyHtml;
      return { rendered: 0, total: 0 };
    }

    /* For genuinely large tables keep only a moving DOM window. Rows above and
       below the visible area are replaced by lightweight spacer rows, then are
       recreated when the user scrolls back. This prevents long-running POS
       sessions and multi-year logs from exhausting mobile RAM. */
    const windowThreshold = Math.max(300, Number(options.windowThreshold || 500));
    if (typeof IntersectionObserver === 'function' && list.length > windowThreshold) {
      const rowHeight = Math.max(32, Number(options.rowHeight || 48));
      const windowSize = Math.max(120, Number(options.windowSize || 260));
      const shiftSize = Math.max(40, Math.min(windowSize - 40, Number(options.shiftSize || Math.floor(windowSize / 2))));
      let start = 0;
      let end = Math.min(list.length, windowSize);
      let topSentinel = null;
      let bottomSentinel = null;
      let shifting = false;

      const spacer = (height, cls) => {
        const tr = document.createElement('tr');
        tr.className = `ct-virtual-spacer ${cls}`;
        const td = document.createElement('td');
        td.colSpan = colspan;
        td.style.cssText = `height:${Math.max(0, height)}px;padding:0!important;border:0!important;line-height:0!important;`;
        tr.appendChild(td);
        return tr;
      };
      const sentinel = cls => {
        const tr = document.createElement('tr');
        tr.className = `ct-virtual-window-sentinel ${cls}`;
        tr.innerHTML = `<td colspan="${colspan}" style="height:1px;padding:0!important;border:0!important;line-height:0!important"></td>`;
        return tr;
      };
      const observeEdges = () => {
        token.observer?.disconnect();
        if (topSentinel) token.observer?.observe(topSentinel);
        if (bottomSentinel) token.observer?.observe(bottomSentinel);
      };
      const renderWindow = () => {
        if (token.cancelled) return;
        const fragment = document.createDocumentFragment();
        if (start > 0) {
          fragment.appendChild(spacer(start * rowHeight, 'ct-virtual-spacer-top'));
          topSentinel = sentinel('ct-virtual-window-top');
          fragment.appendChild(topSentinel);
        } else topSentinel = null;
        for (let index = start; index < end; index += 1) {
          const row = rowFactory(list[index], index);
          if (!row) continue;
          try { row.style.contentVisibility = 'auto'; row.style.containIntrinsicSize = `${rowHeight}px`; } catch (_) {}
          fragment.appendChild(row);
        }
        if (end < list.length) {
          bottomSentinel = sentinel('ct-virtual-window-bottom');
          fragment.appendChild(bottomSentinel);
          fragment.appendChild(spacer((list.length - end) * rowHeight, 'ct-virtual-spacer-bottom'));
        } else bottomSentinel = null;
        tbody.replaceChildren(fragment);
        options.onProgress?.({ rendered: end - start, total: list.length, start, end, windowed: true });
        requestAnimationFrame(observeEdges);
      };
      token.observer = new IntersectionObserver(entries => {
        if (shifting || token.cancelled) return;
        const topHit = entries.some(entry => entry.isIntersecting && entry.target === topSentinel);
        const bottomHit = entries.some(entry => entry.isIntersecting && entry.target === bottomSentinel);
        if (!topHit && !bottomHit) return;
        shifting = true;
        if (bottomHit && end < list.length) {
          const nextStart = Math.min(Math.max(0, list.length - windowSize), start + shiftSize);
          start = nextStart;
          end = Math.min(list.length, start + windowSize);
        } else if (topHit && start > 0) {
          start = Math.max(0, start - shiftSize);
          end = Math.min(list.length, start + windowSize);
        }
        renderWindow();
        requestAnimationFrame(() => { shifting = false; });
      }, { root: null, rootMargin: '900px 0px' });

      // Direct scrollbar jumps can skip the edge sentinels. Recenter the DOM
      // window from the actual viewport offset so even jumping to year 10 of a
      // huge log renders only the nearby rows instead of a blank spacer.
      let scrollRoot = window;
      let scrollRaf = 0;
      const findScrollRoot = () => {
        let node = tbody.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
          try {
            const style = getComputedStyle(node);
            if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 8) return node;
          } catch (_) {}
          node = node.parentElement;
        }
        return window;
      };
      const recenterFromViewport = () => {
        scrollRaf = 0;
        if (token.cancelled || !tbody.isConnected) return;
        const bodyRect = tbody.getBoundingClientRect();
        const viewportTop = scrollRoot === window ? 0 : scrollRoot.getBoundingClientRect().top;
        const visibleOffset = Math.max(0, viewportTop - bodyRect.top);
        const targetIndex = Math.max(0, Math.min(list.length - 1, Math.floor(visibleOffset / rowHeight)));
        const desiredStart = Math.max(0, Math.min(Math.max(0, list.length - windowSize), targetIndex - Math.floor(windowSize * .25)));
        if (Math.abs(desiredStart - start) < Math.max(20, Math.floor(shiftSize / 3))) return;
        start = desiredStart;
        end = Math.min(list.length, start + windowSize);
        renderWindow();
      };
      const onScroll = () => {
        if (!scrollRaf) scrollRaf = requestAnimationFrame(recenterFromViewport);
      };
      const attachScroll = () => {
        scrollRoot = findScrollRoot();
        window.addEventListener('scroll', onScroll, { passive: true });
        if (scrollRoot !== window) scrollRoot.addEventListener('scroll', onScroll, { passive: true });
        token.scrollCleanup = () => {
          token.cancelled = true;
          if (scrollRaf) cancelAnimationFrame(scrollRaf);
          window.removeEventListener('scroll', onScroll);
          if (scrollRoot !== window) scrollRoot.removeEventListener('scroll', onScroll);
        };
      };
      renderWindow();
      requestAnimationFrame(attachScroll);
      return { rendered: end - start, total: list.length, windowed: true };
    }

    let cursor = 0;
    let sentinel = null;
    const appendChunk = () => {
      if (token.cancelled || cursor >= list.length) return;
      const fragment = document.createDocumentFragment();
      const end = Math.min(list.length, cursor + chunkSize);
      for (; cursor < end; cursor += 1) {
        const row = rowFactory(list[cursor], cursor);
        if (row) {
          try { row.style.contentVisibility = 'auto'; row.style.containIntrinsicSize = '44px'; } catch (_) {}
          fragment.appendChild(row);
        }
      }
      if (sentinel?.isConnected) sentinel.remove();
      tbody.appendChild(fragment);
      if (cursor < list.length) {
        sentinel = document.createElement('tr');
        sentinel.className = 'ct-lazy-table-sentinel';
        sentinel.innerHTML = `<td colspan="${colspan}" style="height:1px;padding:0;border:0"></td>`;
        tbody.appendChild(sentinel);
        if (token.observer) token.observer.observe(sentinel);
      } else if (token.observer) {
        token.observer.disconnect();
      }
      options.onProgress?.({ rendered: cursor, total: list.length });
    };

    if (typeof IntersectionObserver === 'function' && list.length > eagerLimit) {
      token.observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          token.observer.disconnect();
          token.idleId = runWhenIdle(() => {
            appendChunk();
            if (sentinel && cursor < list.length) token.observer.observe(sentinel);
          }, 250);
        }
      }, { rootMargin: '700px 0px' });
    }

    appendChunk();
    if (list.length <= eagerLimit) {
      while (cursor < list.length) appendChunk();
    } else if (!token.observer) {
      const pump = () => {
        if (cursor >= list.length || token.cancelled) return;
        appendChunk();
        token.idleId = runWhenIdle(pump, 500);
      };
      token.idleId = runWhenIdle(pump, 500);
    }
    return { rendered: cursor, total: list.length };
  }

  let sharedWorker = null;
  let workerSequence = 0;
  const workerPending = new Map();
  function getSharedWorker() {
    if (sharedWorker || typeof Worker !== 'function') return sharedWorker;
    try {
      sharedWorker = new Worker('cashtop-worker.js?v=1');
      sharedWorker.onmessage = event => {
        const { id, result, error } = event.data || {};
        const pending = workerPending.get(id);
        if (!pending) return;
        workerPending.delete(id);
        if (error) pending.reject(new Error(error)); else pending.resolve(result);
      };
      sharedWorker.onerror = error => console.warn('[CASH TOP 2] worker:', error);
    } catch (_) { sharedWorker = null; }
    return sharedWorker;
  }

  function runWorkerTask(type, payload, fallback) {
    const worker = getSharedWorker();
    if (!worker) return Promise.resolve().then(() => typeof fallback === 'function' ? fallback() : null);
    return new Promise((resolve, reject) => {
      const id = `W_${Date.now()}_${++workerSequence}`;
      workerPending.set(id, { resolve, reject });
      try { worker.postMessage({ id, type, payload }); }
      catch (error) { workerPending.delete(id); Promise.resolve().then(() => typeof fallback === 'function' ? fallback() : null).then(resolve, reject); }
    });
  }

  async function queryRecords(datasetKey, options = {}) {
    const canonical = canonicalKey(datasetKey);
    const parsed = safeJson(localStorage.getItem(canonical), []);
    let records = Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
    const query = String(options.query || '').trim();
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const offset = Math.max(0, Number(options.offset || 0));
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 100)));

    if (query && fields.length) {
      const filterFallback = () => {
        const q = query.toLocaleLowerCase('ar');
        return records.filter(record => fields.some(field => String(record?.[field] ?? '').toLocaleLowerCase('ar').includes(q)));
      };
      records = records.length >= 800
        ? await runWorkerTask('filter-records', { records, query, fields }, filterFallback)
        : filterFallback();
    }

    if (typeof options.predicate === 'function') records = records.filter(options.predicate);
    if (options.sortBy) {
      const field = String(options.sortBy);
      const direction = String(options.sortDir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
      if (field === 'date' && direction === -1 && records.length >= 800) {
        records = await runWorkerTask('sort-date-desc', { records, field }, () => records.slice().sort((a, b) => new Date(b?.[field] || 0) - new Date(a?.[field] || 0)));
      } else {
        records = records.slice().sort((a, b) => {
          const av = a?.[field]; const bv = b?.[field];
          if (typeof av === 'number' || typeof bv === 'number') return (Number(av || 0) - Number(bv || 0)) * direction;
          return String(av ?? '').localeCompare(String(bv ?? ''), 'ar', { numeric: true }) * direction;
        });
      }
    }

    const total = records.length;
    return { items: records.slice(offset, offset + limit), total, offset, limit, hasMore: offset + limit < total };
  }

  function atomicTransactionPrefix() {
    return `cashtop_tx::${encodeURIComponent(companyIdFromSession())}::`;
  }

  function atomicSetItems(changes, options = {}) {
    const source = changes && typeof changes === 'object' ? changes : {};
    const entries = [];
    Object.entries(source).forEach(([key, value]) => {
      if (!isManagedKey(key)) return;
      const canonical = canonicalKey(key);
      const ns = namespaceKey(canonical);
      const oldValue = rawGet(ns);
      const inputValue = typeof value === 'string' ? value : JSON.stringify(value);
      const newValue = transformManagedWrite(canonical, oldValue, inputValue);
      if (oldValue === newValue) return;
      const violation = quotaViolation(canonical, oldValue, newValue);
      if (violation) { const error = new Error(violation); error.code = 'CASHTOP_PLAN_LIMIT'; throw error; }
      entries.push({
        key: canonical, ns, oldValue, newValue,
        metaNs: metaKey(canonical), oldMeta: rawGet(metaKey(canonical))
      });
    });
    if (!entries.length) return { changed: false, transactionId: null, keys: [] };

    const transactionId = crypto.randomUUID ? crypto.randomUUID() : `TX_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const txKey = `${atomicTransactionPrefix()}${transactionId}`;
    const queueBefore = rawGet(syncQueueKey());
    const now = Date.now();
    const journal = {
      id: transactionId,
      state: 'prepared',
      label: String(options.label || 'atomic-update'),
      createdAt: now,
      entries: entries.map(entry => ({ key: entry.key, ns: entry.ns, metaNs: entry.metaNs, oldValue: entry.oldValue, newValue: entry.newValue, oldMeta: entry.oldMeta }))
    };
    rawSet(txKey, JSON.stringify(journal));

    try {
      entries.forEach((entry, index) => {
        rawSet(entry.ns, entry.newValue);
        const previousMeta = safeJson(entry.oldMeta, {}) || {};
        rawSet(entry.metaNs, JSON.stringify({
          updatedAt: now + index,
          revision: Number(previousMeta.revision || 0) + 1,
          deviceId: getDeviceId(),
          page: FILE,
          transactionId,
          transactionLabel: journal.label
        }));
      });
      rawSet(txKey, JSON.stringify({ ...journal, state: 'data-written', writtenAt: Date.now() }));
      const operationIds = {};
      entries.forEach(entry => { operationIds[entry.key] = enqueueSyncOperation(entry.key); });
      rawSet(txKey, JSON.stringify({ ...journal, state: 'committed', committedAt: Date.now() }));
      entries.forEach(entry => {
        try { if (options.audit !== false) appendAudit(entry.key, entry.oldValue, entry.newValue, options.action); } catch (_) {}
      });
      rawRemove(txKey);
      entries.forEach(entry => emitDataChange(entry.key, entry.oldValue, entry.newValue, 'local-transaction', operationIds[entry.key]));
      window.dispatchEvent(new CustomEvent('cashtop:transaction-committed', { detail: { transactionId, keys: entries.map(entry => entry.key), label: journal.label } }));
      return { changed: true, transactionId, keys: entries.map(entry => entry.key) };
    } catch (error) {
      entries.forEach(entry => {
        if (entry.oldValue == null) rawRemove(entry.ns); else rawSet(entry.ns, entry.oldValue);
        if (entry.oldMeta == null) rawRemove(entry.metaNs); else rawSet(entry.metaNs, entry.oldMeta);
      });
      if (queueBefore == null) rawRemove(syncQueueKey()); else rawSet(syncQueueKey(), queueBefore);
      rawRemove(txKey);
      throw error;
    }
  }

  function recoverAtomicTransactions() {
    const prefix = atomicTransactionPrefix();
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = RAW.key.call(localStorage, i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach(txKey => {
      const tx = safeJson(rawGet(txKey), null);
      if (!tx || !Array.isArray(tx.entries)) { rawRemove(txKey); return; }
      try {
        /* Roll forward: after a crash, completing every dataset is safer than
           leaving invoice/stock/account data partially applied. */
        tx.entries.forEach((entry, index) => {
          if (!entry?.ns || !entry?.key) return;
          rawSet(entry.ns, entry.newValue);
          const previousMeta = safeJson(entry.oldMeta, {}) || {};
          rawSet(entry.metaNs || metaKey(entry.key), JSON.stringify({
            updatedAt: Date.now() + index,
            revision: Number(previousMeta.revision || 0) + 1,
            deviceId: getDeviceId(), page: FILE,
            transactionId: tx.id || '', recovered: true
          }));
          enqueueSyncOperation(entry.key);
        });
      } catch (error) {
        console.error('[CASH TOP 2] atomic transaction recovery:', error);
        return;
      }
      rawRemove(txKey);
    });
  }

  function installGlobalPerformanceGuards() {
    if (document.getElementById('ctPerformanceGuards')) return;
    /* Browser-level lazy painting for every record table and off-screen card. */
    const style = document.createElement('style');
    style.id = 'ctPerformanceGuards';
    style.textContent = 'tbody tr{content-visibility:auto;contain-intrinsic-size:auto 44px}.ct-lazy-table-sentinel,.ct-virtual-spacer,.ct-virtual-window-sentinel,.modal-overlay.active,.ct-modal.open{content-visibility:visible!important;contain:none!important}.ct-is-scrolling *{animation-play-state:paused!important}.ct-is-scrolling .ct-sidebar,.ct-is-scrolling .ct-bottom-nav,.ct-is-scrolling .ct-topbar{animation-play-state:running!important}';
    document.head.appendChild(style);

    // لا ننفذ أكثر من تحديث DOM واحد لكل إطار؛ requestAnimationFrame يتبع 60/90/120Hz تلقائياً.
    let scrollFrame = 0;
    let scrollStopTimer = 0;
    const onScroll = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        document.body?.classList.add('ct-is-scrolling');
      });
      clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(() => document.body?.classList.remove('ct-is-scrolling'), 90);
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('touchmove', onScroll, { passive: true });

    /* Convert common inline search handlers to a short debounced listener. */
    document.querySelectorAll('input[type="text"],input[type="search"],input:not([type])').forEach(input => {
      const attr = input.getAttribute('oninput') || '';
      const match = attr.trim().match(/^([A-Za-z_$][\w$]*)\(\)\s*;?$/);
      if (!match) return;
      const searchSignature = [input.id, input.name, input.className, input.getAttribute('placeholder')].join(' ');
      if (!/filter|search/i.test(match[1]) && !/search|بحث|ابحث/i.test(searchSignature)) return;
      const fnName = match[1];
      const fn = window[fnName];
      if (typeof fn !== 'function') return;
      input.removeAttribute('oninput');
      input.addEventListener('input', debounce(() => window[fnName]?.(), 80));
      input.dataset.ctDebounced = 'true';
    });
  }

  function patchStorage() {
    if (window.__CASHTOP_STORAGE_PATCHED__) return;
    window.__CASHTOP_STORAGE_PATCHED__ = true;

    Storage.prototype.getItem = function (key) {
      if (this !== localStorage || !isManagedKey(key)) return RAW.get.call(this, key);
      const canonical = canonicalKey(key);
      return transformManagedRead(canonical, migrateLegacyValue(canonical));
    };

    Storage.prototype.setItem = function (key, value) {
      if (this !== localStorage || !isManagedKey(key)) return RAW.set.call(this, key, value);
      const canonical = canonicalKey(key);
      const ns = namespaceKey(canonical);
      const oldValue = rawGet(ns);
      const stringValue = transformManagedWrite(canonical, oldValue, value);
      if (oldValue === stringValue) return;
      const violation = quotaViolation(canonical, oldValue, stringValue);
      if (violation) {
        showToast(violation, 'error', 5200);
        const error = new Error(violation); error.code = 'CASHTOP_PLAN_LIMIT'; throw error;
      }
      rawSet(ns, stringValue);
      const previousMeta = safeJson(rawGet(metaKey(canonical)), {}) || {};
      rawSet(metaKey(canonical), JSON.stringify({
        updatedAt: Date.now(), revision: Number(previousMeta.revision || 0) + 1,
        deviceId: getDeviceId(), page: FILE
      }));
      appendAudit(canonical, oldValue, stringValue);
      const operationId = enqueueSyncOperation(canonical, { ...describeManagedChange(oldValue, stringValue), deletedDataset: false });
      emitDataChange(canonical, oldValue, stringValue, 'local', operationId);
    };

    Storage.prototype.removeItem = function (key) {
      if (this !== localStorage || !isManagedKey(key)) return RAW.remove.call(this, key);
      const canonical = canonicalKey(key);
      const ns = namespaceKey(canonical);
      const oldValue = rawGet(ns);
      if (canonical === 'cashtop_products' || BRANCH_SCOPED_ARRAY_KEYS.has(canonical) || BRANCH_SCOPED_OBJECT_KEYS.has(canonical)) {
        this.setItem(canonical, canonical === 'cashtop_funds_db' ? JSON.stringify({accounts:[],accountLogs:[]}) : '[]');
        return;
      }
      rawRemove(ns); rawRemove(metaKey(canonical));
      appendAudit(canonical, oldValue, null, 'delete');
      const operationId = enqueueSyncOperation(canonical, { ...describeManagedChange(oldValue, null), deletedDataset: true });
      emitDataChange(canonical, oldValue, null, 'local', operationId);
    };
  }

  function seedCompanyStorage() {
    DATA_KEYS.forEach(key => {
      const canonical = canonicalKey(key);
      const ns = namespaceKey(canonical);
      if (rawGet(ns) === null) {
        const value = Object.prototype.hasOwnProperty.call(NON_ARRAY_DEFAULTS, canonical)
          ? NON_ARRAY_DEFAULTS[canonical]
          : [];
        rawSet(ns, JSON.stringify(value));
        rawSet(metaKey(canonical), JSON.stringify({ updatedAt: 0, revision: 0, seeded: true }));
      }
    });
  }

  const DEFAULT_MAIN_BRANCH_NAME = 'الفرع الرئيسي';
  const DEFAULT_CASH_ACCOUNT_NAME = 'صندوق الكاش';

  function ensureSystemDefaults() {
    // الفرع الرئيسي سجل شركة واحد ثابت. نحافظ على نفس الفرع الرئيسي القديم إن وجد
    // ونضعه أول القائمة حتى يبقى MAIN متوافقاً مع كل الصفحات القديمة والجديدة.
    let branches = normalizeArrayValue(safeJson(localStorage.getItem('cashtop_branches'), []), []);
    let main = branches.find(item => item && item.isMain === true) || branches[0] || null;
    let branchesChanged = false;
    if (!main) {
      main = {
        id: 'BR-01', name: DEFAULT_MAIN_BRANCH_NAME, address: '',
        manager: '', managerUsername: '', managerPassword: '', managerActive: false,
        status: 'نشط', allowTransfer: false, isMain: true, isDefault: true, locked: true
      };
      branches = [main];
      branchesChanged = true;
    } else {
      const originalIndex = branches.indexOf(main);
      if (originalIndex > 0) {
        branches.splice(originalIndex, 1);
        branches.unshift(main);
        branchesChanged = true;
      }
      branches.forEach((branch, index) => {
        const shouldBeMain = index === 0;
        if (Boolean(branch.isMain) !== shouldBeMain) { branch.isMain = shouldBeMain; branchesChanged = true; }
      });
      if (main.name !== DEFAULT_MAIN_BRANCH_NAME) { main.name = DEFAULT_MAIN_BRANCH_NAME; branchesChanged = true; }
      if (main.status !== 'نشط') { main.status = 'نشط'; branchesChanged = true; }
      if (main.isDefault !== true) { main.isDefault = true; branchesChanged = true; }
      if (main.locked !== true) { main.locked = true; branchesChanged = true; }
    }
    if (branchesChanged) localStorage.setItem('cashtop_branches', JSON.stringify(branches));

    // كل فرع يملك قاعدة صناديق مستقلة. لذلك نضمن صندوق كاش ثابتاً للفرع الحالي.
    const funds = safeJson(localStorage.getItem('cashtop_funds_db'), {}) || {};
    funds.accounts = normalizeArrayValue(funds.accounts || [], []);
    funds.accountLogs = normalizeArrayValue(funds.accountLogs || [], []);
    let defaultCash = funds.accounts.find(account => account?.isDefaultCash === true)
      || funds.accounts.find(account => ['صندوق الكاش', 'صندوق الكاش الرئيسي'].includes(String(account?.name || '').trim()));
    let fundsChanged = false;
    if (!defaultCash) {
      defaultCash = {
        id: 1000000001, name: DEFAULT_CASH_ACCOUNT_NAME, type: 'كاش', balance: 0,
        notes: 'الصندوق الافتراضي للنظام', isDefaultCash: true, locked: true
      };
      // تجنب أي تعارض نادر مع رقم قديم.
      while (funds.accounts.some(account => String(account?.id) === String(defaultCash.id))) defaultCash.id += 1;
      funds.accounts.unshift(defaultCash);
      fundsChanged = true;
    } else {
      if (defaultCash.name !== DEFAULT_CASH_ACCOUNT_NAME) { defaultCash.name = DEFAULT_CASH_ACCOUNT_NAME; fundsChanged = true; }
      if (defaultCash.type !== 'كاش') { defaultCash.type = 'كاش'; fundsChanged = true; }
      if (defaultCash.isDefaultCash !== true) { defaultCash.isDefaultCash = true; fundsChanged = true; }
      if (defaultCash.locked !== true) { defaultCash.locked = true; fundsChanged = true; }
    }
    if (fundsChanged) localStorage.setItem('cashtop_funds_db', JSON.stringify(funds));

    // اجعل جلسة مدير الشركة تشير صراحةً إلى الفرع الرئيسي كي لا يظهر "فرع غير معروف".
    const session = getSession();
    if (session && isCompanyAdminRole(session.role)) {
      const next = { ...session, branchId: 'MAIN', dataBranchId: 'MAIN', branchRecordId: main.id, branchName: DEFAULT_MAIN_BRANCH_NAME };
      if (JSON.stringify(next) !== JSON.stringify(session)) persistSession(next);
    }
  }


  const DATA_RESET_VERSION = 'original-zero-embedded-v1';

  function resetCompanyDataOnce() {
    const companyId = companyIdFromSession();
    const marker = `ct_data_reset::${encodeURIComponent(companyId)}::${DATA_RESET_VERSION}`;
    if (rawGet(marker) === 'done') return;

    const canonicalKeys = Array.from(new Set(DATA_KEYS.map(canonicalKey)));
    canonicalKeys.forEach(key => {
      rawRemove(namespaceKey(key, companyId));
      rawRemove(metaKey(key, companyId));
      rawRemove(key);
      Object.keys(ALIASES).filter(alias => ALIASES[alias] === key).forEach(rawRemove);
    });

    // Clear old company namespaces from earlier builds for this company only.
    const encoded = encodeURIComponent(companyId);
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = RAW.key.call(localStorage, i);
      if (key && (key.startsWith(`cashtop_data::${encoded}::`) || key.startsWith(`cashtop_meta::${encoded}::`))) {
        toDelete.push(key);
      }
    }
    toDelete.forEach(rawRemove);
    rawSet(marker, 'done');
  }

  function normalizeAdminRecords(value, signatureKeys = []) {
    let parsed = value;
    for (let i = 0; i < 3 && typeof parsed === 'string'; i += 1) {
      const decoded = safeJson(parsed, null);
      if (decoded === null) break;
      parsed = decoded;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
        Object.prototype.hasOwnProperty.call(parsed, 'value') &&
        (parsed.valueEncoding || Object.prototype.hasOwnProperty.call(parsed, 'deleted') || Object.prototype.hasOwnProperty.call(parsed, 'updatedAt'))) {
      if (parsed.deleted === true) return [];
      return normalizeAdminRecords(parsed.value, signatureKeys);
    }
    if (Array.isArray(parsed)) return parsed.filter(item => item && typeof item === 'object');
    if (parsed && typeof parsed === 'object') {
      if (signatureKeys.some(key => Object.prototype.hasOwnProperty.call(parsed, key))) return [parsed];
      return Object.entries(parsed).map(([key, item]) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        return item.id == null && !/^\d+$/.test(key) ? { ...item, id: key } : item;
      }).filter(Boolean);
    }
    return [];
  }

  function bootstrapCompanyAccess() {
    const session = getSession() || {};
    const role = String(session.role || '').toLowerCase();
    if (!['admin', 'owner', 'company-admin'].includes(role)) return;

    const current = safeJson(localStorage.getItem('cashtop_company_access'), {}) || {};
    const licenses = normalizeAdminRecords(rawGet('cashtop_admin_licenses'), ['key', 'tenantId', 'companyId', 'companyName', 'plan', 'status']);
    const users = normalizeAdminRecords(rawGet('cashtop_admin_users'), ['username', 'companyKey', 'tenantId', 'companyId', 'role']);
    const companyKey = String(session.companyKey || current.companyKey || '').trim().toUpperCase();
    const license = licenses.find(item => String(item.key || '').trim().toUpperCase() === companyKey) || {};
    const localUser = users.find(item =>
      String(item.companyKey || '').trim().toUpperCase() === companyKey &&
      String(item.username || '').toLowerCase() === String(session.username || '').toLowerCase()
    ) || {};

    const manager = {
      ...(current.manager || {}),
      id: session.uid || localUser.id || current.manager?.id || `ADMIN_${Date.now()}`,
      username: session.username || localUser.username || current.manager?.username || 'admin',
      displayName: session.displayName || localUser.displayName || current.manager?.displayName || 'مدير الشركة',
      role: 'admin',
      active: localUser.active !== false && current.manager?.active !== false
    };
    // لا نستبدل كلمة مرور سحابية موجودة بقيمة فارغة.
    if (localUser.password) manager.password = localUser.password;

    const comparableCurrent = { ...current };
    delete comparableCurrent.updatedAt;
    const comparableNext = {
      ...comparableCurrent,
      companyKey: companyKey || current.companyKey || '',
      tenantId: session.tenantId || session.companyId || license.tenantId || license.companyId || current.tenantId || current.companyId || '',
      companyId: session.tenantId || session.companyId || license.tenantId || license.companyId || current.tenantId || current.companyId || '',
      companyName: session.companyName || license.companyName || current.companyName || '',
      status: license.status || current.status || 'active',
      startAt: license.startAt || current.startAt || '',
      endAt: license.endAt || session.licenseEnd || current.endAt || '',
      manager
    };
    if (JSON.stringify(comparableCurrent) !== JSON.stringify(comparableNext)) {
      localStorage.setItem('cashtop_company_access', JSON.stringify({ ...comparableNext, updatedAt: Date.now() }));
    }
  }

  function validateSessionLocal(session) {
    if (!session) return { ok: false, reason: 'missing' };
    const companyId = String(session.tenantId || session.companyId || session.companyKey || 'unassigned');
    const access = safeJson(rawGet(namespaceKey('cashtop_company_access', companyId)), {}) || {};
    const accessTenantId = String(access.tenantId || access.companyId || companyId);
    const sessionKey = String(session.companyKey || '').trim().toUpperCase();
    const accessKey = String(access.companyKey || '').trim().toUpperCase();
    if (Object.keys(access).length && accessTenantId !== companyId) return { ok: false, reason: 'tenant-mismatch' };
    if (sessionKey && accessKey && sessionKey !== accessKey) return { ok: false, reason: 'tenant-mismatch' };
    session.tenantId = companyId;
    session.companyId = companyId;
    if (access.status && access.status !== 'active') return { ok: false, reason: 'stopped' };
    if (access.deleted === true) return { ok: false, reason: 'deleted' };
    const accessEnd = access.endAt ? new Date(access.endAt).getTime() : 0;
    if (accessEnd && Number.isFinite(accessEnd) && Date.now() >= accessEnd) return { ok: false, reason: 'expired' };
    if (session.status && session.status !== 'active') return { ok: false, reason: 'stopped' };
    const end = session.licenseEnd ? new Date(session.licenseEnd).getTime() : null;
    if (end && Number.isFinite(end) && Date.now() >= end) return { ok: false, reason: 'expired' };

    session.companyName = access.companyName || session.companyName;
    session.status = access.status || session.status || 'active';
    session.licenseStart = access.startAt || session.licenseStart || '';
    session.licenseEnd = access.endAt || session.licenseEnd || '';
    session.plan = access.plan || session.plan || 'pro';
    session.entitlementVersion = access.authVersion || access.updatedAt || session.entitlementVersion || 0;

    const role = String(session.role || '').toLowerCase();
    if (role === 'employee' || String(session.uid || '').startsWith('EMP_')) {
      const employees = normalizeArrayValue(rawGet(namespaceKey('cashtop_employees', companyId)), []);
      const employee = employees.find(item => String(item.id) === String(session.uid)) ||
        employees.find(item => String(item.username || '').toLowerCase() === String(session.username || '').toLowerCase());
      if (!employee || employee.status !== 'active') return { ok: false, reason: 'user-disabled' };
      session.displayName = employee.name || session.displayName;
      session.permissions = normalizePermissions(employee.permissions || {});
      session.branchRecordId = employee.branchId || null;
      const branches = normalizeArrayValue(rawGet(namespaceKey('cashtop_branches', companyId)), []);
      const employeeBranch = branches.find(item => String(item.id) === String(employee.branchId));
      if (!employeeBranch || employeeBranch.status === 'مجمد') return { ok: false, reason: 'user-disabled' };
      session.branchId = employeeBranch.isMain === true ? 'MAIN' : employeeBranch.id;
      session.dataBranchId = session.branchId;
      session.branchName = employeeBranch.name || employee.branchName || '';
      session.authVersion = employee.authVersion || employee.updatedAt || 0;
    } else if (['branch-admin', 'branch_manager', 'manager'].includes(role)) {
      const branches = normalizeArrayValue(rawGet(namespaceKey('cashtop_branches', companyId)), []);
      const lookup = session.branchRecordId || session.branchId;
      const branch = branches.find(item => String(item.id) === String(lookup)) ||
        branches.find(item => String(item.managerUsername || '').toLowerCase() === String(session.username || '').toLowerCase());
      if (!branch || branch.status === 'مجمد' || branch.managerActive === false || !branch.managerUsername) return { ok: false, reason: 'user-disabled' };
      session.branchRecordId = branch.id;
      session.branchId = branch.isMain === true ? 'MAIN' : branch.id;
      session.dataBranchId = session.branchId;
      session.branchName = branch.name || session.branchName;
      session.displayName = branch.manager || session.displayName;
      session.permissions = normalizePermissions(branch.managerPermissions || {});
      // توافق مع الإصدارات القديمة: مفتاح السماح بالنقل لمدير الفرع يفعّل صلاحية النقل الدقيقة.
      if (branch.allowTransfer === true) session.permissions['inventory.transfer'] = true;
      session.authVersion = branch.managerAuthVersion || branch.updatedAt || 0;
    } else if (isCompanyAdminRole(role)) {
      if (access.manager && (access.manager.active === false || (session.username && access.manager.username && String(access.manager.username).toLowerCase() !== String(session.username).toLowerCase()))) {
        return { ok: false, reason: 'user-disabled' };
      }
      session.branchId = 'MAIN'; session.dataBranchId = 'MAIN';
      session.permissions = session.permissions || {};
    }
    persistSession(session);
    return { ok: true, session };
  }

  function redirectToLogin(reason) {
    const params = new URLSearchParams();
    if (reason) params.set('reason', reason);
    const target = `صفحة تسجيل الدخول.html${params.toString() ? `?${params}` : ''}`;
    if (!location.pathname.endsWith(encodeURI('صفحة تسجيل الدخول.html'))) location.replace(target);
  }

  async function logout(reason) {
    // العمليات المعلقة تخص الشركة لا جلسة التبويب؛ نحفظ نسخة IndexedDB قبل
    // تسجيل الخروج حتى تبقى جاهزة للمزامنة عند الدخول مجدداً أو عودة الإنترنت.
    try { await backupSyncQueue(getSyncQueue()); } catch (_) {}
    try {
      if (window.CashtopFirebase && typeof window.CashtopFirebase.signOut === 'function') {
        await window.CashtopFirebase.signOut();
      }
    } catch (_) { /* local session is still cleared */ }
    const companyId = companyIdFromSession();
    const currentSession = getSession();
    try {
      sessionStorage.removeItem(`ct_firebase_state::${encodeURIComponent(companyId)}`);
      sessionStorage.removeItem(TAB_SESSION_KEY);
    } catch (_) {}
    const globalSession = safeJson(rawGet('cashtop_session'), null);
    if (!globalSession || sessionTenantId(globalSession) === sessionTenantId(currentSession)) rawRemove('cashtop_session');
    redirectToLogin(reason || 'logout');
  }

  function ensureAuthenticated() {
    if (!IS_APP_PAGE) return true;
    const result = validateSessionLocal(getSession());
    if (!result.ok) {
      redirectToLogin(result.reason);
      return false;
    }
    return true;
  }

  function isStandaloneDisplayMode() {
    return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  }

  function normalizeViewportMeta() {
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }
    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content';
  }

  function syncInstalledViewportMetrics() {
    const viewport = window.visualViewport;
    const height = Math.max(320, Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0));
    if (height) document.documentElement.style.setProperty('--ct-visual-viewport-height', `${height}px`);
  }

  async function keepPortraitOrientation() {
    if (!isStandaloneDisplayMode() || !screen.orientation || typeof screen.orientation.lock !== 'function') return false;
    try {
      await screen.orientation.lock('portrait');
      return true;
    } catch (_) {
      return false;
    }
  }

  function installViewportGuards() {
    normalizeViewportMeta();
    const refresh = () => {
      syncInstalledViewportMetrics();
      requestAnimationFrame(syncInstalledViewportMetrics);
      setTimeout(syncInstalledViewportMetrics, 80);
      setTimeout(syncInstalledViewportMetrics, 320);
    };
    refresh();
    window.addEventListener('resize', refresh, { passive: true });
    window.addEventListener('pageshow', refresh, { passive: true });
    window.addEventListener('orientationchange', () => { refresh(); keepPortraitOrientation(); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); keepPortraitOrientation(); } }, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', refresh, { passive: true });
    }
    keepPortraitOrientation();
  }

  function addCoreAssets() {
    document.documentElement.classList.add('ct-app-page', 'ct-shell-ready');
    installViewportGuards();
    if (!document.querySelector('link[href="cashtop-core.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'cashtop-core.css';
      document.head.appendChild(link);
    }
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = 'manifest.webmanifest';
      document.head.appendChild(manifest);
    }
    const theme = document.querySelector('meta[name="theme-color"]') || document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#605ca8';
    if (!theme.parentNode) document.head.appendChild(theme);
    let favicon = document.querySelector('link[rel~="icon"]');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.href = 'icon-192.png';
    if (FILE === 'cashier.html') document.documentElement.classList.add('ct-cashier-page');
  }

  const PAGE_TITLES = {
    'لوحة التحكم.html': 'لوحة التحكم', 'cashier.html': 'نقطة البيع والكاشير',
    'products.html': 'المنتجات والمخزون', 'materials.html': 'الأصناف الخام', 'invoices.html': 'فواتير المبيعات',
    'المشتريات.html': 'فواتير المشتريات', 'مرجع المشتريات.html': 'مرتجع المشتريات',
    'customers.html': 'العملاء', 'customer-groups.html': 'مجموعات العملاء',
    'suppliers.html': 'الموردون', 'accounts.html': 'الحسابات والصناديق',
    'sands.html': 'سندات القبض والصرف', 'journal.html': 'دفتر القيود المحاسبية', 'المصاريف.html': 'المصاريف',
    'warehouses.html': 'المخازن', 'branches.html': 'الفروع', 'units.html': 'الوحدات',
    'shortages.html': 'نواقص المخزون', 'barcode-generator.html': 'مولد الباركود',
    'المناديب.html': 'المناديب', 'الموظفين.html': 'الموظفون',
    'العمال والاجور.html': 'العمال والأجور', 'التقارير.html': 'التقارير',
    'setting.html': 'إعدادات النظام', 'printer-settings.html': 'إعدادات الطابعة',
    'sales-offers.html': 'عروض المبيعات',
    'tax-settings.html': 'إعدادات الضريبة', 'notifications.html': 'الإشعارات',
    'storage-settings.html': 'إدارة التخزين والأرشفة',
    'ادارة التصنيع.html': 'إدارة التصنيع', 'استيراد وتصدير ل كل قسم.html': 'النسخ الاحتياطي والاستعادة'
  };

  function mountShell() {
    const body = document.body;
    if (!body) return;
    const host = document.getElementById('ctPageHost');
    const shell = document.querySelector('.ct-app-shell');
    if (!host || !shell) {
      console.error('[CASH TOP] الهيكل المدمج غير موجود داخل الصفحة:', FILE);
      return;
    }
    document.documentElement.classList.add('ct-shell-ready');
    hydrateShell();
  }

  function ensureBottomNavigation() {
    document.querySelectorAll('.ct-bottom-nav').forEach(nav => {
      nav.innerHTML = `
        <a href="لوحة التحكم.html"><i class="fa-solid fa-house"></i><span>الرئيسية</span></a>
        <a href="cashier.html"><i class="fa-solid fa-cash-register"></i><span>الكاشير</span></a>
        <a href="products.html"><i class="fa-solid fa-box-open"></i><span>المنتجات</span></a>
        <a href="customers.html"><i class="fa-solid fa-users"></i><span>العملاء</span></a>
        <a href="invoices.html"><i class="fa-solid fa-file-invoice"></i><span>الفواتير</span></a>`;
    });
  }

  function rebuildSidebarMenu() {
    const nav = document.querySelector('.ct-sidebar-nav');
    if (!nav) return;
    const backupLink = (section) => [`استيراد وتصدير ل كل قسم.html?section=${encodeURIComponent(section)}`, 'نسخ واستيراد القسم'];
    const groups = [
      ['fa-house','الرئيسية', [['لوحة التحكم.html','لوحة التحكم']]],
      ['fa-cash-register','المبيعات', [['cashier.html','الكاشير'],['invoices.html','فواتير المبيعات'],['sales-offers.html','عروض المبيعات'],backupLink('sales')]],
      ['fa-cart-shopping','المشتريات', [['المشتريات.html','فواتير المشتريات'],['مرجع المشتريات.html','مرتجع المشتريات'],['suppliers.html','الموردون'],backupLink('purchases')]],
      ['fa-boxes-stacked','المخزون والفروع', [['products.html','المنتجات'],['materials.html','الأصناف'],['warehouses.html','المخازن'],['branches.html','الفروع'],['units.html','الوحدات'],['shortages.html','النواقص'],['barcode-generator.html','الباركود'],backupLink('inventory')]],
      ['fa-industry','التصنيع', [['ادارة التصنيع.html','إدارة التصنيع'],backupLink('manufacturing')]],
      ['fa-handshake','العملاء والعلاقات', [['customers.html','العملاء'],['customer-groups.html','مجموعات العملاء'],['المناديب.html','المناديب'],backupLink('relationships')]],
      ['fa-calculator','المالية والمحاسبة', [['accounts.html','الصناديق والحسابات'],['sands.html','سندات القبض والصرف'],['journal.html','دفتر القيود'],['المصاريف.html','المصاريف'],backupLink('finance')]],
      ['fa-users-gear','الموارد البشرية', [['الموظفين.html','الموظفون'],['العمال والاجور.html','العمال والأجور'],backupLink('hr')]],
      ['fa-chart-line','التقارير والمتابعة', [['التقارير.html','التقارير'],['notifications.html','الإشعارات'],backupLink('reports')]],
      ['fa-gears','النظام والإعدادات', [['tax-settings.html','إعدادات الضريبة'],['storage-settings.html','التخزين والأرشفة'],['استيراد وتصدير ل كل قسم.html','النسخ الاحتياطي الشامل'],['setting.html','إعدادات النظام'],['printer-settings.html','إعدادات الطابعة'],backupLink('settings')]]
    ];
    nav.innerHTML = groups.map(([icon,title,links], index) => {
      if (index === 0) return links.map(([href,label]) => `<a class="ct-menu-link" href="${href}"><i class="fa-solid ${icon}"></i><span>${label}</span></a>`).join('');
      return `<details class="ct-menu-group"><summary><i class="fa-solid ${icon}"></i><span>${title}</span><i class="fa-solid fa-chevron-down ct-menu-arrow"></i></summary><div class="ct-submenu">${links.map(([href,label])=>`<a href="${href}">${label}</a>`).join('')}</div></details>`;
    }).join('');
    nav.querySelectorAll('.ct-menu-group').forEach(group => group.addEventListener('toggle', () => {
      if (!group.open) return;
      nav.querySelectorAll('.ct-menu-group[open]').forEach(other => { if (other !== group) other.open = false; });
    }));
  }

  function linkedPageInfo(link) {
    try {
      const url = new URL(link.getAttribute('href') || '', location.href);
      return {
        file: decodeURIComponent(url.pathname.split('/').pop() || ''),
        section: url.searchParams.get('section') || ''
      };
    } catch (_) {
      const href = decodeURIComponent((link.getAttribute('href') || '').split('/').pop() || '');
      const [file, query = ''] = href.split('?');
      return { file, section: new URLSearchParams(query).get('section') || '' };
    }
  }

  function normalizeShellLabels() {
    document.querySelectorAll('.ct-sidebar-logout, .ct-logout-top').forEach(button => button.remove());
    rebuildSidebarMenu();
  }

  function restrictSettingsForBasicUser(session) {
    if (FILE !== 'setting.html' || isCompanyAdminRole(session?.role) || can('settings.system', session)) return;
    const host = document.getElementById('ctPageHost');
    if (!host || host.dataset.logoutOnly === 'true') return;
    host.dataset.logoutOnly = 'true';
    host.innerHTML = `<div style="max-width:520px;margin:45px auto;background:#fff;border-top:4px solid #605ca8;border-radius:10px;padding:24px;text-align:center;box-shadow:0 8px 25px rgba(15,23,42,.08)"><i class="fa-solid fa-right-from-bracket" style="font-size:38px;color:#605ca8"></i><h2 style="font-size:18px;margin:14px 0 6px">إعدادات الحساب</h2><p style="font-size:12px;color:#64748b;line-height:1.8">لا يملك هذا الحساب صلاحية إعدادات النظام. الإجراء المتاح هو تسجيل الخروج فقط.</p><button type="button" data-ct-action="logout" style="border:0;background:#dd4b39;color:#fff;border-radius:7px;padding:11px 24px;font:700 13px Cairo;cursor:pointer"><i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج</button></div>`;
  }

  function firstAllowedPage(session = getSession()) {
    return Object.keys(PAGE_PERMISSIONS).find(file => permissionAllowed(PAGE_PERMISSIONS[file], session)) || 'setting.html';
  }

  function enforceCurrentPageAccess(session = getSession()) {
    if (FILE === 'setting.html') return true;
    const required = PAGE_PERMISSIONS[FILE];
    if (!required || permissionAllowed(required, session)) return true;
    const fallback = firstAllowedPage(session);
    if (fallback && fallback !== FILE) {
      location.replace(fallback);
      return false;
    }
    logout('permission-denied');
    return false;
  }

  function permissionAllowed(requirement, session = getSession()) {
    if (Array.isArray(requirement)) return requirement.some(permission => can(permission, session));
    return can(requirement, session);
  }

  function serializePermissionRequirement(requirement) {
    return Array.isArray(requirement) ? requirement.join(',') : String(requirement || '');
  }

  function readPermissionRequirement(element) {
    if (!element) return null;
    const any = element.dataset?.ctPermissionAny;
    if (any) return any.split(',').map(item => item.trim()).filter(Boolean);
    return element.dataset?.ctPermission || null;
  }


  /* ============================================================
   * Revision 53 — resilient modal drafts + instant broadcast popup
   * ============================================================ */
  function modalDraftStorageKey(modal) {
    const id = modal?.id || 'anonymous-modal';
    const session = getSession() || {};
    return `ct_modal_draft::${encodeURIComponent(companyIdFromSession())}::${encodeURIComponent(session.uid || session.username || 'user')}::${encodeURIComponent(FILE)}::${encodeURIComponent(id)}`;
  }

  function modalDraftRoot(node) {
    const element = node instanceof Element ? node : null;
    if (!element) return null;
    return element.closest('.modal-overlay') || element.closest('.ct-modal') || element.closest('.modal');
  }

  function modalIsOpen(modal) {
    if (!modal || !modal.isConnected) return false;
    if (modal.getAttribute('aria-hidden') === 'true') return false;
    if (modal.classList.contains('active') || modal.classList.contains('open') || modal.classList.contains('show')) return true;
    if (modal.style?.display && modal.style.display !== 'none') return true;
    try { return modal.getClientRects().length > 0 && getComputedStyle(modal).visibility !== 'hidden'; } catch (_) { return false; }
  }

  function modalControls(modal) {
    return [...(modal?.querySelectorAll?.('input,select,textarea') || [])].filter(control => {
      const type = String(control.type || '').toLowerCase();
      return !['file','password','submit','button','reset','image'].includes(type) && control.dataset.ctNoDraft !== 'true';
    });
  }

  function modalControlKey(control, index) {
    return control.id ? `id:${control.id}` : control.name ? `name:${control.name}` : `idx:${index}`;
  }

  function captureModalDraft(modal) {
    if (!modal || modal.dataset.ctNoDraft === 'true' || modal.dataset.ctDraftCancelled === 'true' || !modalIsOpen(modal)) return;
    const values = {};
    modalControls(modal).forEach((control, index) => {
      const key = modalControlKey(control, index);
      if (control.type === 'checkbox' || control.type === 'radio') values[key] = { checked: control.checked, value: control.value };
      else values[key] = { value: control.value };
    });
    rawSet(modalDraftStorageKey(modal), JSON.stringify({ savedAt: Date.now(), values }));
  }

  function restoreModalDraft(modal) {
    if (!modal || modal.dataset.ctNoDraft === 'true') return false;
    const draft = safeJson(rawGet(modalDraftStorageKey(modal)), null);
    if (!draft?.values) return false;
    let changed = false;
    modalControls(modal).forEach((control, index) => {
      const item = draft.values[modalControlKey(control, index)];
      if (!item) return;
      if (control.type === 'checkbox' || control.type === 'radio') control.checked = Boolean(item.checked);
      else if (item.value != null) control.value = item.value;
      changed = true;
      try { control.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    });
    return changed;
  }

  function clearModalDraft(modal) {
    if (!modal) return;
    rawRemove(modalDraftStorageKey(modal));
  }

  function markModalDraftSaveAttempt(modal) {
    if (!modal) return;
    modal.dataset.ctDraftSavePending = 'true';
    // Local saves in CASH TOP close immediately. If validation failed and the
    // dialog stayed open, cancel the pending-save marker so an accidental close
    // still preserves the draft as requested.
    setTimeout(() => {
      if (modalIsOpen(modal)) modal.dataset.ctDraftSavePending = 'false';
    }, 600);
  }

  function installModalDraftPersistence() {
    if (document.documentElement.dataset.ctModalDrafts === 'true') return;
    document.documentElement.dataset.ctModalDrafts = 'true';
    const selector = '.modal-overlay,.ct-modal,.modal';
    const save = debounce(modal => captureModalDraft(modal), 90);
    document.addEventListener('input', event => {
      const modal = modalDraftRoot(event.target);
      if (modal && modalIsOpen(modal)) save(modal);
    }, true);
    document.addEventListener('change', event => {
      const modal = modalDraftRoot(event.target);
      if (modal && modalIsOpen(modal)) save(modal);
    }, true);
    document.addEventListener('submit', event => {
      const modal = modalDraftRoot(event.target);
      if (modal) markModalDraftSaveAttempt(modal);
    }, true);
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('button,[role="button"],a');
      const modal = modalDraftRoot(button);
      if (!button || !modal) return;
      const text = String(button.textContent || '').trim();
      if (button.classList.contains('btn-cancel') || button.classList.contains('btn-action-cancel') || /^إلغاء(?:\s|$)/.test(text)) {
        clearModalDraft(modal);
        modal.dataset.ctDraftCancelled = 'true';
        return;
      }
      if (/حفظ|تأكيد|تنفيذ|إصدار|اعتماد/.test(text)) markModalDraftSaveAttempt(modal);
      else captureModalDraft(modal); // X/close buttons: persist synchronously before legacy close handlers run.
    }, true);
    document.addEventListener('pointerdown', event => {
      const modal = modalDraftRoot(event.target);
      if (modal && event.target === modal) captureModalDraft(modal);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll(selector).forEach(item => {
        const modal = modalDraftRoot(item);
        if (modal && modalIsOpen(modal)) captureModalDraft(modal);
      });
    }, true);

    const observer = new MutationObserver(mutations => {
      const modals = new Set();
      mutations.forEach(mutation => {
        const target = mutation.target instanceof Element ? mutation.target : null;
        const modal = modalDraftRoot(target);
        if (modal) modals.add(modal);
      });
      modals.forEach(modal => {
        const open = modalIsOpen(modal);
        const was = modal.dataset.ctDraftWasOpen === 'true';
        if (open && !was) {
          modal.dataset.ctDraftWasOpen = 'true';
          modal.dataset.ctDraftCancelled = 'false';
          setTimeout(() => restoreModalDraft(modal), 0);
          setTimeout(() => restoreModalDraft(modal), 120);
          setTimeout(() => restoreModalDraft(modal), 400);
        } else if (!open && was) {
          modal.dataset.ctDraftWasOpen = 'false';
          if (modal.dataset.ctDraftSavePending === 'true' || modal.dataset.ctDraftCancelled === 'true') clearModalDraft(modal);
          modal.dataset.ctDraftSavePending = 'false';
        }
      });
    });
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
  }

  function isManagerSession(session = getSession()) {
    const role = String(session?.role || '').toLowerCase();
    return ['admin','owner','superadmin','manager','branch-admin','branch_manager'].includes(role);
  }

  function migrateNotificationDefaultsV54() {
    const markerKey = `ct_notification_defaults_v54::${companyIdFromSession()}`;
    if (rawGet(markerKey) === '1') return;
    const system = safeJson(localStorage.getItem('cashtop_settings'), {}) || {};
    const notif = safeJson(localStorage.getItem('cashtop_notification_settings'), {}) || {};
    if (system.notificationsEnabled === undefined) system.notificationsEnabled = false;
    if (system.dailyProfitNotificationEnabled === undefined) system.dailyProfitNotificationEnabled = true;
    notif.enabled = system.notificationsEnabled === true;
    if (notif.dailySummaryEnabled === undefined) notif.dailySummaryEnabled = system.dailyProfitNotificationEnabled !== false;
    localStorage.setItem('cashtop_settings', JSON.stringify(system));
    localStorage.setItem('cashtop_notification_settings', JSON.stringify(notif));
    rawSet(markerKey, '1');
  }

  function getNotificationSettings() {
    const system = safeJson(localStorage.getItem('cashtop_settings'), {}) || {};
    return Object.assign({ lowStockThreshold: 5, debtOverdueDays: 30, inactiveCustomerDays: 45, expiryWarningDays: 30, enabled: false, dailySummaryEnabled: true },
      safeJson(localStorage.getItem('cashtop_notification_settings'), {}) || {},
      system.notificationsEnabled !== undefined ? { enabled: system.notificationsEnabled === true } : {},
      system.dailyProfitNotificationEnabled !== undefined ? { dailySummaryEnabled: system.dailyProfitNotificationEnabled !== false } : {});
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) return { ok:false, reason:'unsupported' };
    try {
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') return { ok:false, reason:permission };
      try { await window.CashtopPush?.ensureSubscription?.(); } catch (_) {}
      return { ok:true, permission };
    } catch (error) { return { ok:false, reason:error?.message || 'error' }; }
  }


  function notificationBrandIcon() {
    const settings = safeJson(localStorage.getItem('cashtop_settings'), {}) || {};
    return String(settings.logo || '').trim() || 'app-icon.png';
  }

  async function showSystemNotification(title, options = {}) {
    const cfg = getNotificationSettings();
    if (cfg.enabled !== true || !isManagerSession()) return false;
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const payload = {
      title: String(title || 'كاش توب'),
      body: String(options.body || ''),
      icon: options.icon || notificationBrandIcon(),
      badge: options.badge || options.icon || notificationBrandIcon(),
      image: options.image || '',
      tag: options.tag || `ct-${Date.now()}`,
      renotify: options.renotify === true,
      url: options.url || 'notifications.html',
      data: { ...(options.data || {}), url: options.url || options.data?.url || 'notifications.html' }
    };
    try {
      const registration = await navigator.serviceWorker?.ready;
      if (registration?.active) {
        registration.active.postMessage({ type:'SHOW_NOTIFICATION', payload });
        return true;
      }
      if (registration?.showNotification) { await registration.showNotification(payload.title, payload); return true; }
    } catch (_) {}
    try { new Notification(payload.title, payload); return true; } catch (_) { return false; }
  }

  function invoiceDisplayTotal(invoice) {
    return Number(invoice?.finalTotal ?? invoice?.grandTotal ?? invoice?.total ?? invoice?.netTotal ?? invoice?.subtotal ?? 0) || 0;
  }

  function invoiceProfit(invoice) {
    const direct = Number(invoice?.netProfit ?? invoice?.totalProfit ?? invoice?.profit);
    if (Number.isFinite(direct)) return direct;
    return normalizeArrayValue(invoice?.items, []).reduce((sum,item)=>{
      const qty=Number(item?.quantityPieces ?? item?.quantity ?? item?.qty ?? 0)||0;
      const price=Number(item?.unitPrice ?? item?.price ?? 0)||0;
      const cost=Number(item?.costPerPiece ?? item?.cost ?? 0)||0;
      return sum + ((price-cost)*qty);
    },0);
  }

  function todaySalesSummary() {
    const dayKey = new Date().toISOString().slice(0,10);
    const invoices = normalizeArrayValue(localStorage.getItem('cashtop_invoices'), []).filter(inv => inv && inv.status !== 'draft' && String(inv.date || inv.createdAt || '').slice(0,10) === dayKey);
    const sales = invoices.reduce((s,inv)=>s+invoiceDisplayTotal(inv),0);
    const profit = invoices.reduce((s,inv)=>s+invoiceProfit(inv),0);
    const currencyCfg = window.CashtopMulti?.getCurrencyConfig?.() || { base:{symbol:'₪',code:'ILS'} };
    const symbol = currencyCfg.base?.symbol || currencyCfg.base?.code || '₪';
    return { dayKey, count: invoices.length, sales, profit, symbol };
  }

  async function showTodayProfitNotification(force = false) {
    const cfg = getNotificationSettings();
    if (cfg.enabled !== true || !isManagerSession()) return false;
    const s = todaySalesSummary();
    const key = `ct_daily_profit_notified::${companyIdFromSession()}::${s.dayKey}`;
    if (!force && rawGet(key) === '1') return false;
    const ok = await showSystemNotification('مبيعات اليوم والأرباح', {
      body: `المبيعات: ${s.sales.toFixed(2)} ${s.symbol} — الأرباح: ${s.profit.toFixed(2)} ${s.symbol} — عدد الفواتير: ${s.count}`,
      tag: `daily-profit-${companyIdFromSession()}-${s.dayKey}`,
      url: 'التقارير.html',
      data: { type:'daily-profit', day:s.dayKey }
    });
    if (ok) rawSet(key,'1');
    return ok;
  }

  function syncNotificationSummaryToServiceWorker() {
    if (!navigator.serviceWorker?.ready || !isManagerSession()) return;
    const cfg=getNotificationSettings(), summary=todaySalesSummary();
    navigator.serviceWorker.ready.then(reg=>{
      reg.active?.postMessage?.({type:'CASHTOP_NOTIFICATION_META', payload:{
        enabled:cfg.enabled===true, dailySummaryEnabled:cfg.dailySummaryEnabled!==false,
        role:'manager', summary, companyId:companyIdFromSession(), icon:notificationBrandIcon(), updatedAt:Date.now()
      }});
      if (cfg.enabled===true && reg.periodicSync?.register) reg.periodicSync.register('cashtop-daily-summary',{minInterval:60*60*1000}).catch(()=>null);
    }).catch(()=>null);
  }

  function installManagerNotificationSystem() {
    if (document.documentElement.dataset.ctManagerNotificationsInstalled === 'true') return;
    document.documentElement.dataset.ctManagerNotificationsInstalled = 'true';
    if (!isManagerSession()) return;
    let invoiceIds = new Set(normalizeArrayValue(localStorage.getItem('cashtop_invoices'), []).map(x=>String(x?.id||'')).filter(Boolean));
    let smartSeen = new Set(normalizeArrayValue(rawGet(`ct_smart_notification_seen::${companyIdFromSession()}`), []).map(String));
    const persistSmartSeen=()=>rawSet(`ct_smart_notification_seen::${companyIdFromSession()}`,JSON.stringify([...smartSeen].slice(-300)));
    const scanInvoices = () => {
      if (getNotificationSettings().enabled !== true) return;
      const list=normalizeArrayValue(localStorage.getItem('cashtop_invoices'), []);
      const fresh=list.filter(x=>x?.id && !invoiceIds.has(String(x.id)) && x.status!=='draft');
      list.forEach(x=>x?.id&&invoiceIds.add(String(x.id)));
      fresh.slice(-5).forEach(inv=>{
        const customer=inv.customerName||inv.customer||inv.clientName||'عميل نقدي';
        const who=inv.employeeName||inv.createdByName||inv.createdBy||inv.cashierName||inv.user||'مستخدم النظام';
        const currencyCfg=window.CashtopMulti?.getCurrencyConfig?.()||{base:{symbol:'₪',code:'ILS'}}; const symbol=currencyCfg.base?.symbol||currencyCfg.base?.code||'₪';
        showSystemNotification(`فاتورة جديدة - ${customer}`,{body:`المبلغ الإجمالي: ${invoiceDisplayTotal(inv).toFixed(2)} ${symbol} — بواسطة: ${who}`,tag:`invoice-${inv.id}`,url:'invoices.html',data:{type:'invoice',invoiceId:inv.id}});
      });
    };
    const scanSmart = () => {
      if (getNotificationSettings().enabled !== true) return;
      const current = getSmartNotifications();
      const activeIds = new Set(current.map(item=>String(item.id)));
      smartSeen = new Set([...smartSeen].filter(id=>activeIds.has(String(id))));
      current.forEach(item=>{
        if (smartSeen.has(String(item.id))) return;
        smartSeen.add(String(item.id));
        showSystemNotification(item.title,{body:item.message,tag:`smart-${item.id}`,url:item.href||'notifications.html',data:{type:item.type,id:item.id}});
      });
      persistSmartSeen();
    };
    const dailyTick=()=>{ const now=new Date(), cfg=getNotificationSettings(); if(cfg.enabled===true&&cfg.dailySummaryEnabled!==false&&now.getHours()===23) showTodayProfitNotification(false); syncNotificationSummaryToServiceWorker(); };
    const onData=event=>{const key=event?.detail?.key||''; if(['cashtop_products','cashtop_customers','cashtop_invoices','cashtop_employees','cashtop_workers','cashtop_salary_payments'].includes(key))scanSmart(); if(['cashtop_invoices','cashtop_settings','cashtop_notification_settings'].includes(key))syncNotificationSummaryToServiceWorker();};
    window.addEventListener('cashtop:data-changed',onData); window.addEventListener('cashtop:remote-applied',onData); window.addEventListener('cashtop:external-change',onData);
    setTimeout(()=>{scanSmart();syncNotificationSummaryToServiceWorker();},700);
    setInterval(dailyTick,60*1000);
  }

  function assignPermissionRequirement(element, requirement) {
    if (!element || !requirement) return;
    if (Array.isArray(requirement)) {
      element.dataset.ctPermissionAny = serializePermissionRequirement(requirement);
      delete element.dataset.ctPermission;
    } else {
      element.dataset.ctPermission = requirement;
      delete element.dataset.ctPermissionAny;
    }
  }

  function applyActionPermissions(root = document) {
    const map = ACTION_PERMISSION_MAP[FILE] || {};
    const candidates = [
      ...(root.matches?.('[onclick], [onsubmit], [onchange]') ? [root] : []),
      ...(root.querySelectorAll?.('[onclick], [onsubmit], [onchange]') || [])
    ];
    candidates.forEach(element => {
      const source = ['onclick', 'onsubmit', 'onchange']
        .map(attribute => element.getAttribute(attribute) || '')
        .join(' ');
      if (!source) return;
      for (const [handler, requirement] of Object.entries(map)) {
        if (source.includes(`${handler}(`)) {
          assignPermissionRequirement(element, requirement);
          break;
        }
      }
    });
    (ACTION_SELECTOR_RULES[FILE] || []).forEach(([selector, requirement]) => {
      try {
        const selected = [
          ...(root.matches?.(selector) ? [root] : []),
          ...(root.querySelectorAll?.(selector) || [])
        ];
        selected.forEach(element => assignPermissionRequirement(element, requirement));
      } catch (error) {
        console.warn('[CASH TOP] Invalid permission selector:', selector, error);
      }
    });
  }

  function guardRestrictedAction(event) {
    const target = event.target instanceof Element ? event.target : null;
    const restricted = target?.closest?.('[data-ct-permission], [data-ct-permission-any]');
    if (!restricted) return;
    const requirement = readPermissionRequirement(restricted);
    if (permissionAllowed(requirement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast('لا تملك الصلاحية المطلوبة لتنفيذ هذا الإجراء.', 'error');
  }

  function applyPermissionVisibility(root = document) {
    const session = getSession() || {};
    root.querySelectorAll?.('.ct-sidebar a[href], .ct-bottom-nav a[href]').forEach(link => {
      const { file } = linkedPageInfo(link);
      const required = PAGE_PERMISSIONS[file];
      const managerOnly = new Set(['العمال والاجور.html']);
      const blockedForEmployee = session.role === 'employee' && managerOnly.has(file);
      link.hidden = blockedForEmployee || (file === 'setting.html' ? false : Boolean(required && !permissionAllowed(required, session)));
    });
    root.querySelectorAll?.('[data-ct-permission], [data-ct-permission-any]').forEach(element => {
      const allowed = permissionAllowed(readPermissionRequirement(element), session);
      element.hidden = !allowed;
      if ('disabled' in element) element.disabled = !allowed;
    });
    document.querySelectorAll('.ct-menu-group').forEach(group => {
      const visibleLinks = [...group.querySelectorAll('a[href]')].some(link => !link.hidden);
      group.hidden = !visibleLinks;
    });
  }

  function getSystemSettings() {
    return safeJson(localStorage.getItem('cashtop_settings'), {}) || {};
  }

  function getProfitRate() {
    const rate = Number(getSystemSettings().profitRate || 0);
    return Number.isFinite(rate) ? Math.max(0, rate) : 0;
  }

  function salePriceFromCost(cost, rate = getProfitRate()) {
    const value = Math.max(0, Number(cost || 0));
    const percent = Math.max(0, Number(rate || 0));
    return value * (1 + percent / 100);
  }

  function applySystemBranding() {
    const session = getSession() || {};
    const settings = getSystemSettings();
    const companyName = String(settings.companyName || session.companyName || session.companyKey || APP_NAME).trim();
    const logo = String(settings.logo || '').trim();
    const address = String(settings.address || '').trim();
    const phone = String(settings.phone || '').trim();
    setText('ctCompanyTitle', [companyName, address, phone].filter(Boolean).join(' · ') || 'نظام المحاسبة والمخزون');
    setText('ctSidebarCompany', companyName || APP_NAME);
    document.querySelectorAll('.ct-sidebar-brand img, .ct-topbar-logo').forEach(image => {
      if (logo) image.src = logo;
      image.alt = companyName || APP_NAME;
      image.title = [companyName, address, phone].filter(Boolean).join(' - ');
    });
    document.documentElement.dataset.companyName = companyName;
    window.dispatchEvent(new CustomEvent('cashtop:branding-applied', { detail: { companyName, logo, address, phone } }));
    return { companyName, logo, address, phone };
  }

  function hydrateShell() {
    const session = getSession() || {};
    if (!enforceCurrentPageAccess(session)) return;
    ensureBottomNavigation();
    normalizeShellLabels();
    applyActionPermissions();
    applyPermissionVisibility();
    restrictSettingsForBasicUser(session);
    renderSubscriptionPanel(session);
    const pageTitle = PAGE_TITLES[FILE] || document.title || APP_NAME;
    document.title = `${pageTitle} - ${APP_NAME}`;
    setText('ctPageTitle', pageTitle);
    setText('ctCurrentUser', session.displayName || session.username || 'مستخدم');
    applySystemBranding();

    const current = FILE;
    const currentSection = current === 'استيراد وتصدير ل كل قسم.html' ? (new URLSearchParams(location.search).get('section') || '') : '';
    document.querySelectorAll('.ct-sidebar a[href], .ct-bottom-nav a[href]').forEach(link => {
      const target = linkedPageInfo(link);
      const sectionMatches = current !== 'استيراد وتصدير ل كل قسم.html' || target.section === currentSection;
      if (target.file === current && sectionMatches) {
        link.classList.add('active');
        const details = link.closest('details');
        if (details) details.open = true;
      }
    });

    document.addEventListener('click', handleShellClick);
    document.addEventListener('click', guardRestrictedAction, true);
    document.addEventListener('submit', guardRestrictedAction, true);
    document.addEventListener('change', guardRestrictedAction, true);
    mountHeaderActions();
    upgradeShellIconsToSvg();
    enhanceAllSelects();
    updateNetworkStatus();
    updateNotificationBadge();
    displayLicenseWarning(session);
    compactCompletedData(false).catch(console.warn);
    let permissionRefreshFrame = 0;
    const pendingMutationRoots = new Set();
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (!record.addedNodes?.length) continue;
        // Process only the subtree that actually changed. Re-scanning the whole
        // document on every modal/table render caused visible UI stalls.
        if (record.target?.nodeType === 1) pendingMutationRoots.add(record.target);
      }
      if (!pendingMutationRoots.size || permissionRefreshFrame) return;
      permissionRefreshFrame = requestAnimationFrame(() => {
        permissionRefreshFrame = 0;
        const roots = [...pendingMutationRoots];
        pendingMutationRoots.clear();
        for (const root of roots) {
          applyActionPermissions(root);
          enhanceAllSelects(root);
          applyPermissionVisibility(root);
        }
      });
    });
    observer.observe(document.getElementById('ctPageHost') || document.body, { childList: true, subtree: true });
    window.addEventListener('cashtop:data-changed', updateNotificationBadge);
  }


  function renderSubscriptionPanel(session = getSession()) {
    if (FILE !== 'setting.html' || document.getElementById('ctSubscriptionPanel')) return;
    const access = getCompanyAccess();
    const plan = String(access.plan || session?.plan || 'pro').toLowerCase();
    const host = document.getElementById('ctPageHost');
    if (!host) return;
    const panel = document.createElement('section');
    panel.id = 'ctSubscriptionPanel';
    panel.className = 'ct-subscription-panel';
    panel.innerHTML = `<style>.ct-subscription-panel{background:#fff;border:1px solid #e2e8f0;border-top:4px solid #605ca8;border-radius:9px;padding:15px;margin:0 0 16px;font-family:Cairo}.ct-plan-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.ct-plan-head strong{font-size:14px}.ct-plan-badge{padding:5px 12px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:11px;font-weight:800}.ct-plan-description{margin-top:10px;color:#64748b;font-size:11px;line-height:1.8}</style><div class="ct-plan-head"><strong><i class="fa-solid fa-crown"></i> خطة الشركة</strong><span class="ct-plan-badge">${plan === 'plus' ? 'Plus' : 'Pro'}</span></div><div class="ct-plan-description">تُدار الخطة مركزياً من لوحة المشرف، وتُحدّث على جميع الأجهزة من Firestore.</div>`;
    host.prepend(panel);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function handleShellClick(event) {
    const actionEl = event.target.closest('[data-ct-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.ctAction;
    if (action === 'open-sidebar') toggleSidebar(true);
    if (action === 'close-sidebar') toggleSidebar(false);
    if (action === 'logout') logout('logout');
    if (action === 'sync') {
      if (!can('sync.run')) return showToast('لا تملك صلاحية تشغيل المزامنة اليدوية.', 'error');
      syncNow();
    }
    if (action === 'install-app') installPwa();
  }

  function toggleSidebar(open) {
    document.getElementById('ctSidebar')?.classList.toggle('open', open);
    document.getElementById('ctSidebarOverlay')?.classList.toggle('open', open);
  }

  function updateNetworkStatus() {
    const status = document.getElementById('ctNetStatus');
    if (!status) return;
    const backendState = window.CashtopFirebase?.getState?.() || {};
    const backendRecentlyReachable = backendState.backendReachable === true && Date.now() - Number(backendState.backendReachableAt || 0) < 120000;
    const online = navigator.onLine !== false || backendRecentlyReachable;
    status.classList.toggle('offline', !online);
    const span = status.querySelector('span');
    if (span) span.textContent = online ? 'متصل' : 'غير متصل';
    status.title = online ? 'متصل بالإنترنت' : 'يتم الحفظ محلياً وسيتم التزامن لاحقاً';
    updateSyncBadge();
  }

  function displayLicenseWarning(session) {
    if (!session || !session.licenseEnd) return;
    const remaining = new Date(session.licenseEnd).getTime() - Date.now();
    const days = Math.ceil(remaining / 86400000);
    if (days > 7 || days < 0) return;
    const banner = document.createElement('div');
    banner.className = 'ct-license-banner';
    banner.textContent = 'تنبيه: راجع حالة الاشتراك من الإعدادات.';
    document.body.appendChild(banner);
  }

  function showToast(message, type = 'info', duration = 3200) {
    let wrap = document.querySelector('.ct-core-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'ct-core-toast-wrap';
      document.body.appendChild(wrap);
    }
    const toast = document.createElement('div');
    toast.className = `ct-core-toast ${type}`;
    toast.textContent = message;
    wrap.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  async function installPwa() {
    if (!can('app.install')) {
      showToast('لا تملك صلاحية تثبيت التطبيق.', 'error');
      return { installed: false, denied: true };
    }
    if (appInstalled || window.matchMedia?.('(display-mode: standalone)')?.matches) {
      showToast('التطبيق مثبت بالفعل على هذا الجهاز.', 'success');
      return { installed: true, alreadyInstalled: true };
    }
    if (!deferredInstallPrompt) {
      showToast('نافذة التثبيت غير متاحة الآن. افتح الموقع عبر Chrome ثم اختر «تثبيت التطبيق» من قائمة المتصفح.', 'info', 5200);
      return { installed: false, unavailable: true };
    }
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') showToast('تم بدء تثبيت التطبيق.', 'success');
    else showToast('تم إلغاء تثبيت التطبيق.', 'info');
    return { installed: choice?.outcome === 'accepted', outcome: choice?.outcome || 'dismissed' };
  }

  let cloudSyncRuntimePromise = null;

  function ensureCloudSyncRuntime() {
    if (window.CashtopFirebase && typeof window.CashtopFirebase.syncAll === 'function') {
      return Promise.resolve(true);
    }
    const cfg = window.CASHTOP_FIREBASE || {};
    if (!cfg.enabled || !cfg.config?.databaseURL) return Promise.resolve(false);
    if (cloudSyncRuntimePromise) return cloudSyncRuntimePromise;

    cloudSyncRuntimePromise = new Promise(resolve => {
      const existing = document.querySelector('script[data-ct-sync-runtime="classic"]');
      if (existing) {
        const started = Date.now();
        const wait = () => {
          if (window.CashtopFirebase?.syncAll) return resolve(true);
          if (Date.now() - started > 5000) return resolve(false);
          setTimeout(wait, 80);
        };
        wait();
        return;
      }
      const script = document.createElement('script');
      script.src = 'firebase-sync.js?v=65';
      script.async = true;
      script.dataset.ctSyncRuntime = 'classic';
      script.onload = () => resolve(Boolean(window.CashtopFirebase?.syncAll));
      script.onerror = () => resolve(false);
      (document.head || document.documentElement).appendChild(script);
    }).finally(() => {
      if (!window.CashtopFirebase?.syncAll) cloudSyncRuntimePromise = null;
    });
    return cloudSyncRuntimePromise;
  }

  async function syncNow(options = {}) {
    const manual = options.manual !== false;
    if (manual && !can('sync.run')) {
      showToast('لا تملك صلاحية تشغيل المزامنة اليدوية.', 'error');
      return { processed: 0, denied: true };
    }
    const button = document.getElementById('ctSyncButton');
    const animationStartedAt = performance.now();
    const finishAnimation = (minimumMs = 900) => {
      if (!manual) return;
      const elapsed = performance.now() - animationStartedAt;
      window.setTimeout(() => button?.classList.remove('ct-syncing'), Math.max(0, minimumMs - elapsed));
    };
    if (manual) button?.classList.add('ct-syncing');
    window.dispatchEvent(new CustomEvent('cashtop:sync-request', { detail: { manual } }));
    // navigator.onLine مؤشر تقريبي فقط وقد يكون خاطئاً على بعض الشبكات/VPN.
    // نحاول خادم قاعدة البيانات فعلياً ونقرر النتيجة من استجابة الطلب نفسه.
    try {
      if (!(window.CashtopFirebase && typeof window.CashtopFirebase.syncAll === 'function')) {
        await ensureCloudSyncRuntime();
      }
      if (window.CashtopFirebase && typeof window.CashtopFirebase.syncAll === 'function') {
        const result = await window.CashtopFirebase.syncAll({ manual, forceCheck: true });
        if (manual) {
          const processed = Number(result?.processed || 0);
          const pulled = Number(result?.pulled || 0);
          const remaining = Number(result?.remaining || 0);
          const failed = Number(result?.failed || 0);
          if (result?.offline || result?.networkDeferred) {
            showToast(result?.message || 'تعذر وصول هذه المحاولة إلى خادم المزامنة. البيانات محفوظة محلياً وستتم إعادة المحاولة تلقائياً.', 'warning');
          } else if (failed > 0 || remaining > 0 || result?.partial) {
            if (processed > 0 || pulled > 0) {
              showToast(`تمت مزامنة العمليات الجاهزة، وبقي ${remaining} قيد الانتظار لإعادة المحاولة تلقائياً.`, 'warning');
            } else {
              showToast(`تعذر مزامنة ${remaining || failed} عملية حالياً. ستبقى محفوظة محلياً وتُعاد المحاولة تلقائياً.`, 'warning');
            }
          } else if (processed > 0 || pulled > 0) {
            showToast('تمت المزامنة', 'success');
          } else {
            showToast('لا توجد عمليات معلقة؛ البيانات متزامنة.', 'success');
          }
        }
        return result;
      }
      if (manual) showToast(location.protocol === 'file:' ? 'تعذر تشغيل وحدة المزامنة من فتح الملف المباشر. أعد فتح هذه النسخة؛ تم تحويل وحدة المزامنة إلى وضع متوافق مع file://.' : 'البيانات محفوظة محلياً. تعذر تحميل وحدة المزامنة السحابية حالياً.', 'info');
      return { processed: 0, unavailable: true };
    } catch (error) {
      console.error(error);
      const rawMessage = String(error?.message || '');
      const networkLike = error?.name === 'TypeError' || /failed to fetch|networkerror|network request failed|load failed|مهلة الاتصال|تعذر الاتصال|خادم المزامنة|قاعدة البيانات/i.test(rawMessage);
      if (manual) showToast(networkLike
        ? (rawMessage || 'تعذر وصول هذه المحاولة إلى خادم المزامنة. البيانات محفوظة محلياً وستتم إعادة المحاولة تلقائياً.')
        : (rawMessage || 'تعذرت المزامنة الآن، وستتم إعادة المحاولة تلقائياً.'), networkLike ? 'warning' : 'error');
      return { processed: 0, error: true, networkDeferred: networkLike };
    } finally {
      updateSyncBadge();
      finishAnimation(1050);
    }
  }

  function getAllCompanyData() {
    const session = getSession() || {};
    const datasets = {};
    DATA_KEYS.forEach(key => {
      const rawValue = getRawCompanyDataset(key);
      datasets[key] = {
        exists: rawValue !== null,
        value: rawValue,
        valueEncoding: 'local-storage-raw-v1'
      };
    });
    return {
      format: 'cashtop-backup-v4',
      exportedAt: new Date().toISOString(),
      tenantId: session.tenantId || session.companyId || session.companyKey,
      companyId: session.tenantId || session.companyId || session.companyKey,
      companyKey: session.companyKey || '',
      companyName: session.companyName,
      datasets
    };
  }

  function exportBackup() {
    const backup = getAllCompanyData();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CASH_TOP_${backup.companyName || backup.companyId || 'company'}_${new Date().toISOString().slice(0, 10)}.backup.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم إنشاء النسخة الاحتياطية بنجاح.', 'success');
  }

  function isBackupImportEnabled() {
    const access = getCompanyAccess();
    return access?.backupImportEnabled === true;
  }

  async function syncImportedData(keys = []) {
    const importedKeys = [...new Set((Array.isArray(keys) ? keys : []).map(canonicalKey).filter(key => DATA_KEYS.includes(key)))];
    importedKeys.forEach(key => enqueueSyncOperation(key, { forceReplace: true }));

    // قد تكون صفحة الاستيراد فُتحت من كاش قديم قبل اكتمال تحميل وحدة المزامنة.
    // نحمّل الوحدة صراحةً ثم ننتظر أي دورة جارية بدلاً من ترك النسخة في الطابور بلا محاولة فورية.
    if (!window.CashtopFirebase?.syncAll) {
      try { await ensureCloudSyncRuntime(); } catch (_) {}
    }
    if (!window.CashtopFirebase?.syncAll) return { unavailable: true, remaining: getSyncQueue().length };

    window.dispatchEvent(new CustomEvent('cashtop:sync-progress', {
      detail: { active: true, current: 0, total: Math.max(1, importedKeys.length), label: 'جاري رفع النسخة الاحتياطية إلى قاعدة البيانات...' }
    }));

    let result = null;
    try {
      // الاستيراد عملية استبدال مقصودة؛ نكرر حتى تنتهي كل المجموعات أو يتضح أن الشبكة غير متاحة.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        result = await window.CashtopFirebase.syncAll({
          manual: true,
          forceCheck: true,
          importSync: true,
          forceRetry: true
        });
        const remaining = Number(result?.remaining ?? getSyncQueue().length);
        if (remaining === 0) break;
        if (result?.networkDeferred || navigator.onLine === false) break;
        // busy يعني أن دورة أخرى سبقتنا؛ ننتظرها ثم نحاول الاستيراد مرة أخرى.
        await new Promise(resolve => setTimeout(resolve, (result?.busy ? 320 : 240) + attempt * 140));
      }
      return result || { remaining: getSyncQueue().length };
    } catch (error) {
      console.warn('[CASH TOP] restore sync:', error);
      return { error: true, remaining: getSyncQueue().length, message: String(error?.message || error) };
    } finally {
      window.dispatchEvent(new CustomEvent('cashtop:sync-progress', {
        detail: {
          active: false, done: true, success: getSyncQueue().length === 0,
          current: Math.max(0, importedKeys.length - getSyncQueue().length),
          total: Math.max(1, importedKeys.length),
          label: getSyncQueue().length ? 'بقيت عمليات معلقة وستُرفع تلقائياً' : 'اكتملت مزامنة النسخة الاحتياطية'
        }
      }));
    }
  }

  async function importBackupFile(file) {
    if (!isBackupImportEnabled()) throw new Error('استيراد النسخ مقفل لهذا المفتاح. افتحه من لوحة المشرف أولاً.');
    const text = await file.text();
    const backup = safeJson(text, null);
    if (!backup || !['cashtop-backup-v2', 'cashtop-backup-v3', 'cashtop-backup-v4'].includes(backup.format) || !backup.datasets) throw new Error('صيغة النسخة الاحتياطية غير صحيحة');
    const session = getSession() || {};
    const currentCompany = String(session.tenantId || session.companyId || session.companyKey || '');
    const backupTenant = String(backup.tenantId || backup.companyId || '');
    const crossCompanyImport = Boolean(backupTenant && currentCompany && backupTenant !== currentCompany);

    // يسمح بالاستيراد من أي شركة، لكن تُزرع البيانات داخل مسار الشركة المفتوحة حالياً.
    // هوية الشركة الحالية واشتراكها ومديرها تبقى محمية أدناه ولا تؤخذ من ملف النسخة.
    const importedKeys = [];
    const currentAccess = getCompanyAccess() || {};
    const protectedAccessFields = [
      'tenantId', 'companyId', 'companyKey', 'companyName', 'status', 'plan', 'startAt', 'endAt',
      'durationUnit', 'durationQuantity', 'backupImportEnabled', 'authVersion', 'deleted', 'manager'
    ];

    // التخزين المحلي أولاً؛ ثم نُجبر كل dataset مستورد على الرفع إلى القاعدة.
    Object.entries(backup.datasets).forEach(([key, entry]) => {
      if (!isManagedKey(key)) return;
      const canonical = canonicalKey(key);
      const exactRaw = entry && typeof entry === 'object' && entry.valueEncoding === 'local-storage-raw-v1';
      if (exactRaw && entry.exists === false) {
        if (canonical === 'cashtop_company_access') {
          setRawCompanyDataset(canonical, JSON.stringify(currentAccess), { action: 'backup-import', enqueue: false });
          enqueueSyncOperation(canonical, { forceReplace: true });
        } else {
          const oldValue = getRawCompanyDataset(canonical);
          rawRemove(namespaceKey(canonical));
          rawSet(metaKey(canonical), JSON.stringify({ updatedAt: Date.now(), revision: 1, deviceId: getDeviceId(), page: FILE, deleted: true }));
          enqueueSyncOperation(canonical, { deletedDataset: true, forceReplace: true });
          emitDataChange(canonical, oldValue, null, 'backup-import');
        }
        importedKeys.push(canonical);
        return;
      }
      let storageValue = exactRaw
        ? String(entry.value ?? '')
        : (typeof entry === 'string' && ['cashtop_sms_template', 'cashtop_invoice_message_template'].includes(canonical)
          ? entry
          : JSON.stringify(entry));

      // لا نسمح لنسخة قديمة أن تعيد مفتاحاً/حالةً/مديراً قديماً وتُعطّل الحساب.
      if (canonical === 'cashtop_company_access') {
        const importedAccess = safeJson(storageValue, {}) || {};
        const mergedAccess = { ...importedAccess };
        protectedAccessFields.forEach(field => {
          if (Object.prototype.hasOwnProperty.call(currentAccess, field)) mergedAccess[field] = currentAccess[field];
        });
        mergedAccess.tenantId = session.tenantId || session.companyId || currentAccess.tenantId || currentAccess.companyId || '';
        mergedAccess.companyId = mergedAccess.tenantId;
        mergedAccess.companyKey = session.companyKey || currentAccess.companyKey || '';
        mergedAccess.backupImportEnabled = currentAccess.backupImportEnabled === true;
        storageValue = JSON.stringify(mergedAccess);
      }

      // النسخة الكاملة تُكتب على مستوى الشركة كلها، لا على فرع الجلسة فقط.
      setRawCompanyDataset(canonical, storageValue, { action: 'backup-import', enqueue: false });
      enqueueSyncOperation(canonical, { forceReplace: true });
      importedKeys.push(canonical);
    });
    if (!importedKeys.length) throw new Error('لا تحتوي النسخة على بيانات متوافقة قابلة للاستيراد.');
    showToast(crossCompanyImport
      ? 'تم نقل بيانات النسخة من الشركة الأخرى إلى الشركة الحالية محلياً، ويجري رفعها الآن إلى قاعدة البيانات.'
      : 'تمت الاستعادة محلياً، ويجري رفعها الآن إلى قاعدة البيانات.', 'success');
    const syncResult = await syncImportedData(importedKeys);
    if (Number(syncResult?.remaining || getSyncQueue().length) === 0) {
      showToast('تمت مزامنة النسخة الاحتياطية بالكامل مع قاعدة البيانات.', 'success');
    } else if (getSyncQueue().length) {
      showToast(`تم حفظ النسخة محلياً وبقي ${getSyncQueue().length} عملية للمزامنة التلقائية.`, 'warning');
    }
    setTimeout(() => location.reload(), 850);
    return { imported: importedKeys.length, crossCompanyImport, syncResult, remaining: getSyncQueue().length };
  }

  function containsDeviceLocalImage(value) {
    return typeof value === 'string' && (/^(?:data:image\/|blob:)/i.test(value.trim()) || /(?:data:image\/[^;]+;base64,|blob:)/i.test(value));
  }

  function localImageRecordId(value) {
    if (!value || typeof value !== 'object') return '';
    return String(value.id ?? value.productId ?? value.uuid ?? value.code ?? value.barcode ?? value.key ?? '').trim();
  }

  /*
   * الصور المختارة من الجهاز تبقى خاصة بهذا الجهاز. عند وصول نسخة بعيدة
   * ندمج البيانات العادية، لكننا لا نستبدل أي data:image أو blob محفوظ محلياً.
   * روابط http/https تبقى ضمن البيانات العادية ولذلك تتزامن بين الأجهزة.
   */
  function preserveDeviceLocalImages(remoteValue, localValue) {
    if (containsDeviceLocalImage(localValue)) return localValue;
    if (Array.isArray(remoteValue)) {
      const localRows = Array.isArray(localValue) ? localValue : [];
      const localById = new Map(localRows.map(item => [localImageRecordId(item), item]).filter(([id]) => id));
      return remoteValue.map((item, index) => {
        const id = localImageRecordId(item);
        const localItem = (id && localById.get(id)) ?? localRows[index];
        return preserveDeviceLocalImages(item, localItem);
      });
    }
    if (remoteValue && typeof remoteValue === 'object') {
      const localObject = localValue && typeof localValue === 'object' && !Array.isArray(localValue) ? localValue : {};
      const output = { ...remoteValue };
      for (const [field, localField] of Object.entries(localObject)) {
        if (containsDeviceLocalImage(localField)) output[field] = localField;
        else if (localField && typeof localField === 'object') {
          const merged = preserveDeviceLocalImages(remoteValue[field], localField);
          if (merged !== undefined) output[field] = merged;
        }
      }
      return output;
    }
    return remoteValue;
  }

  function applyRemoteDataset(key, value, meta) {
    const canonical = canonicalKey(key);
    const ns = namespaceKey(canonical);
    const incomingRaw = typeof value === 'string' ? value : JSON.stringify(value);
    const localRaw = rawGet(ns);
    let finalRaw = incomingRaw;
    const incomingParsed = safeJson(incomingRaw, undefined);
    const localParsed = safeJson(localRaw, undefined);
    if (incomingParsed !== undefined && localParsed !== undefined) {
      const merged = preserveDeviceLocalImages(incomingParsed, localParsed);
      finalRaw = typeof merged === 'string' ? merged : JSON.stringify(merged);
    } else if (containsDeviceLocalImage(localRaw)) {
      finalRaw = localRaw;
    }
    suppressEvents = true;
    try {
      rawSet(ns, finalRaw);
      rawSet(metaKey(canonical), JSON.stringify(meta || { updatedAt: Date.now(), source: 'remote' }));
    } finally {
      suppressEvents = false;
    }
    dispatchLogicalStorageEvents(canonical, localRaw, finalRaw);
    window.dispatchEvent(new CustomEvent('cashtop:remote-applied', { detail: { key: canonical, localImagesPreserved: finalRaw !== incomingRaw } }));
  }


  function normalizeDateValue(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function getTaxSettings() {
    return Object.assign({
      enabled: false, salesRate: 0, purchaseRate: 0,
      salesBearer: 'customer', purchaseBearer: 'business', pricesIncludeTax: false
    }, safeJson(localStorage.getItem('cashtop_tax_settings'), {}) || {});
  }

  function calculateTax(amount, kind = 'sales') {
    const cfg = getTaxSettings();
    const base = Math.max(0, Number(amount) || 0);
    const rate = Math.max(0, Number(kind === 'purchase' ? cfg.purchaseRate : cfg.salesRate) || 0);
    const enabled = Boolean(cfg.enabled && rate > 0);
    const bearer = kind === 'purchase' ? cfg.purchaseBearer : cfg.salesBearer;
    const charged = kind === 'sales' ? bearer === 'customer' : bearer === 'business';
    if (!enabled) return { enabled: false, rate, tax: 0, bearer, charged: false, included: false, total: base };
    const included = Boolean(cfg.pricesIncludeTax);
    const tax = included ? base * rate / (100 + rate) : base * rate / 100;
    const total = included ? base : base + (charged ? tax : 0);
    return { enabled, rate, tax, bearer, charged, included, total };
  }

  function getSmartNotifications() {
    if (!isManagerSession()) return [];
    const cfg = getNotificationSettings();
    const currencyCfg = window.CashtopMulti?.getCurrencyConfig?.() || { base: { symbol: '₪', code: 'ILS' } };
    const baseCurrencySymbol = currencyCfg.base?.symbol || currencyCfg.base?.code || '₪';
    if (cfg.enabled === false) return [];
    const now = Date.now();
    const day = 86400000;
    const products = normalizeArrayValue(localStorage.getItem('cashtop_products'), []);
    const customers = normalizeArrayValue(localStorage.getItem('cashtop_customers'), []);
    const invoices = normalizeArrayValue(localStorage.getItem('cashtop_invoices'), []);
    const out = [];

    products.forEach(product => {
      const stock = Number(product.stockPieces ?? product.stock ?? 0) || 0;
      if (stock <= Number(cfg.lowStockThreshold || 0)) {
        out.push({
          id: `stock_${product.id}`, type: 'stock', severity: stock <= 0 ? 'danger' : 'warning',
          title: stock <= 0 ? 'نفاد مخزون' : 'مخزون منخفض',
          message: `${product.name || 'منتج'}: المتوفر ${stock} ${product.pieceName || 'قطعة'}`,
          href: 'products.html', date: now
        });
      }

      const expiryWarningDays = Math.max(1, Number(cfg.expiryWarningDays || 30));
      const lots = normalizeArrayValue(product.inventoryLots || [], []);
      lots.forEach(lot => {
        const remaining = Math.max(0, Number(lot.remainingPieces ?? lot.quantityPieces ?? 0));
        const expiryTime = normalizeDateValue(lot.expiryDate);
        if (!remaining || !expiryTime) return;
        const daysLeft = Math.ceil((expiryTime - now) / day);
        if (daysLeft < 0) {
          out.push({
            id: `expired_${product.id}_${lot.id || lot.expiryDate}`, type: 'expiry', severity: 'danger',
            title: 'منتج منتهي الصلاحية',
            message: `${product.name || 'منتج'}: كمية ${remaining} انتهت بتاريخ ${lot.expiryDate}`,
            href: 'notifications.html', date: expiryTime, productId: product.id, lotId: lot.id || ''
          });
        } else if (daysLeft <= expiryWarningDays) {
          out.push({
            id: `expiring_${product.id}_${lot.id || lot.expiryDate}`, type: 'expiry', severity: 'warning',
            title: 'منتج أوشك على انتهاء الصلاحية',
            message: `${product.name || 'منتج'}: كمية ${remaining} تنتهي خلال ${daysLeft} يوم`,
            href: 'notifications.html', date: expiryTime, productId: product.id, lotId: lot.id || ''
          });
        }
      });
    });

    customers.forEach(customer => {
      const balance = Number(customer.balance || 0);
      const customerInvoices = invoices.filter(inv => inv.status !== 'draft' &&
        (String(inv.customerId || '') === String(customer.id || '') || inv.customer === customer.name));
      const lastInvoice = customerInvoices.slice().sort((a, b) => normalizeDateValue(b.date) - normalizeDateValue(a.date))[0];
      const oldestDebt = customerInvoices.filter(inv => Number(inv.debt || 0) > 0)
        .sort((a, b) => normalizeDateValue(a.date) - normalizeDateValue(b.date))[0];
      if (balance > 0 && oldestDebt && now - normalizeDateValue(oldestDebt.date) >= Number(cfg.debtOverdueDays || 30) * day) {
        out.push({
          id: `debt_${customer.id}`, type: 'debt', severity: 'danger', title: 'تأخر في سداد الدين',
          message: `${customer.name}: رصيد مستحق ${balance.toFixed(2)} ${baseCurrencySymbol} منذ أكثر من ${cfg.debtOverdueDays} يوماً`,
          href: 'customers.html', date: normalizeDateValue(oldestDebt.date)
        });
      }
      const lastDate = normalizeDateValue(lastInvoice?.date || customer.lastPurchaseAt || customer.lastPurchaseDate || customer.createdAt);
      if (lastDate && now - lastDate >= Number(cfg.inactiveCustomerDays || 45) * day) {
        out.push({
          id: `inactive_${customer.id}`, type: 'inactive', severity: 'info', title: 'عميل لم يشترِ منذ فترة',
          message: `${customer.name}: لم تُسجل له عملية شراء منذ ${Math.floor((now - lastDate) / day)} يوماً`,
          href: 'customers.html', date: lastDate
        });
      }
    });

    const employees = normalizeArrayValue(localStorage.getItem('cashtop_employees'), []);
    const salaryPayments = normalizeArrayValue(localStorage.getItem('cashtop_salary_payments'), []);
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    employees.filter(employee => employee.status === 'active' && Number(employee.salary || 0) > 0).forEach(employee => {
      const salaryDay = Math.min(31, Math.max(1, Number(employee.salaryDay || 1)));
      const dueDate = new Date(today.getFullYear(), today.getMonth(), salaryDay);
      const startDate = employee.salaryStartDate ? new Date(`${employee.salaryStartDate}T00:00:00`) : null;
      const startedBeforeThisDueDate = !startDate || !Number.isFinite(startDate.getTime()) || startDate <= dueDate;
      const alreadyPaid = salaryPayments.some(payment => String(payment.employeeId) === String(employee.id) && payment.salaryMonth === monthKey && payment.status !== 'reversed');
      if (today >= dueDate && startedBeforeThisDueDate && !alreadyPaid) {
        out.push({
          id: `salary_${employee.id}_${monthKey}`, type: 'salary', severity: 'warning', title: 'راتب موظف مستحق',
          message: `${employee.name || 'موظف'}: راتب ${Number(employee.salary).toFixed(3).replace(/\.?0+$/, '')} ${baseCurrencySymbol} مستحق للصرف`,
          href: 'notifications.html', date: now, employeeId: employee.id, salaryMonth: monthKey,
          amount: Number(employee.salary), accountId: employee.salaryAccountId || ''
        });
      }
    });
    const currentRole = String((getSession() || {}).role || '').toLowerCase();
    if (currentRole !== 'employee') {
      const workers = normalizeArrayValue(localStorage.getItem('cashtop_workers'), []);
      const todayKey = new Date().toISOString().slice(0,10);
      workers.forEach(worker => {
        const type = String(worker.salaryType || '');
        const amount = Math.max(0, Number(worker.salaryAmount || 0));
        if (!amount || !['monthly','weekly','daily'].includes(type)) return;
        let due = false, dueKey = '';
        if (type === 'monthly') {
          const payDay = Math.min(31, Math.max(1, Number(worker.payDay || 1)));
          const currentMonth = todayKey.slice(0,7);
          const lastMonth = String(worker.lastPaidAt || '').slice(0,7);
          due = today.getDate() >= payDay && lastMonth !== currentMonth;
          dueKey = currentMonth;
        } else {
          const target = String(worker.payDateRaw || '');
          due = Boolean(target && target <= todayKey);
          dueKey = target;
        }
        if (!due) return;
        out.push({ id:`worker_salary_${worker.id}_${dueKey}`, type:'workerSalary', severity:'warning', title:'أجر عامل مستحق', message:`${worker.name || 'عامل'}: ${amount.toFixed(3).replace(/\.?0+$/,'')} ${baseCurrencySymbol} مستحق للقبض`, href:'notifications.html', date:now, workerId:worker.id, amount, accountId:worker.vaultId || '' });
      });
    }

    return out.sort((a, b) => (a.severity === 'danger' ? -1 : 0) - (b.severity === 'danger' ? -1 : 0));
  }

  function mountHeaderActions() {
    const actions = document.querySelector('.ct-topbar-actions');
    if (!actions || actions.querySelector('.ct-notification-button')) return;
    const quick = document.createElement('div');
    quick.className = 'ct-quick-actions';
    quick.innerHTML = `
      <a href="customers.html" class="ct-quick-button"><i class="fa-solid fa-user-plus"></i><span>إضافة عميل</span></a>
      <a href="cashier.html" class="ct-quick-button"><i class="fa-solid fa-file-invoice"></i><span>فاتورة</span></a>
      <a href="invoices.html" class="ct-quick-button"><i class="fa-solid fa-file-lines"></i><span>الفواتير</span></a>`;
    actions.insertBefore(quick, actions.firstChild);
    const showManagerBell = isManagerSession();
    const bell = document.createElement('a');
    bell.href = 'notifications.html';
    bell.className = 'ct-icon-button ct-notification-button';
    bell.title = 'الإشعارات';
    bell.innerHTML = '<i class="fa-solid fa-bell"></i><span class="ct-icon-badge" id="ctNotificationBadge">0</span>';
    const sync = document.getElementById('ctSyncButton');
    if (sync && !sync.querySelector('#ctSyncBadge')) {
      const syncBadge = document.createElement('span');
      syncBadge.className = 'ct-sync-badge';
      syncBadge.id = 'ctSyncBadge';
      sync.appendChild(syncBadge);
    }
    if (sync && !sync.querySelector('#ctSyncProgress')) {
      const progress = document.createElement('span');
      progress.className = 'ct-sync-progress';
      progress.id = 'ctSyncProgress';
      progress.hidden = true;
      progress.innerHTML = '<span class="ct-sync-progress-bar" id="ctSyncProgressBar"></span>';
      sync.appendChild(progress);
      if (lastSyncProgressDetail.active && lastSyncProgressDetail.done !== true) setSyncProgress(lastSyncProgressDetail);
    }
    if (showManagerBell) {
      if (sync) sync.insertAdjacentElement('afterend', bell);
      else actions.insertBefore(bell, actions.firstChild);
      updateNotificationBadge();
    }
    updateSyncBadge();
  }

  function updateNotificationBadge() {
    const badge = document.getElementById('ctNotificationBadge');
    if (!badge) return;
    const count = getSmartNotifications().length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
  }

  function injectSvgSprite() {
    if (document.getElementById('ctSvgSprite')) return;
    const wrap = document.createElement('div');
    wrap.id = 'ctSvgSprite';
    wrap.hidden = true;
    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
      <symbol id="cti-home" viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8"/></symbol>
      <symbol id="cti-menu" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
      <symbol id="cti-box" viewBox="0 0 24 24"><path d="m4 7 8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" fill="none" stroke="currentColor" stroke-width="1.7"/></symbol>
      <symbol id="cti-users" viewBox="0 0 24 24"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-1a3 3 0 1 0 0-6M2 21v-3c0-3 2.5-5 6-5s6 2 6 5v3m2-8c3.2.2 6 2 6 5v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></symbol>
      <symbol id="cti-receipt" viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></symbol>
      <symbol id="cti-wallet" viewBox="0 0 24 24"><path d="M4 6h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3h12M16 11h5v4h-5a2 2 0 0 1 0-4Z" fill="none" stroke="currentColor" stroke-width="1.7"/></symbol>
      <symbol id="cti-settings" viewBox="0 0 24 24"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.2 13.4c.1-.5.1-1 0-1.5l2-1.5-2-3.5-2.4 1a8 8 0 0 0-1.3-.8L15.2 4h-4l-.4 2.6c-.5.2-.9.5-1.3.8l-2.4-1-2 3.5 2 1.5a8 8 0 0 0 0 1.5l-2 1.5 2 3.5 2.4-1c.4.3.8.6 1.3.8l.4 2.6h4l.4-2.6c.5-.2.9-.5 1.3-.8l2.4 1 2-3.5-2.1-1.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></symbol>
      <symbol id="cti-cash" viewBox="0 0 24 24"><path d="M3 7h18v12H3zM7 11h4v4H7zm8 1h3M5 4h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
      <symbol id="cti-chevron" viewBox="0 0 24 24"><path d="m7 9 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
      <symbol id="cti-sync" viewBox="0 0 24 24"><path d="M7.2 18.5h10.3a4 4 0 0 0 .7-7.9A6.2 6.2 0 0 0 6.4 8.4 5.1 5.1 0 0 0 7.2 18.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="m9 12 3-3 3 3m-3-3v7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
      <symbol id="cti-bell" viewBox="0 0 24 24"><path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></symbol>
      <symbol id="cti-user" viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM3 22a9 9 0 0 1 18 0" fill="none" stroke="currentColor" stroke-width="1.8"/></symbol>
      <symbol id="cti-logout" viewBox="0 0 24 24"><path d="M10 4H4v16h6M14 8l4 4-4 4m4-4H8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    </svg>`;
    document.body.appendChild(wrap);
  }

  function upgradeShellIconsToSvg() {
    injectSvgSprite();
    const map = {
      'fa-house':'home','fa-bars':'menu','fa-boxes-stacked':'box','fa-box-open':'box','fa-cubes':'box',
      'fa-file-invoice-dollar':'receipt','fa-file-invoice':'receipt','fa-file-lines':'receipt',
      'fa-users':'users','fa-users-gear':'users','fa-user-plus':'users','fa-wallet':'wallet',
      'fa-sliders':'settings','fa-cash-register':'cash','fa-chevron-down':'chevron',
      'fa-rotate':'sync','fa-bell':'bell','fa-user-shield':'user','fa-right-from-bracket':'logout'
    };
    document.querySelectorAll('.ct-sidebar i, .ct-topbar i, .ct-bottom-nav i').forEach(icon => {
      const cls = [...icon.classList].find(c => map[c]);
      if (!cls) return;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('ct-svg-icon');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#cti-${map[cls]}`);
      svg.appendChild(use);
      icon.replaceWith(svg);
    });
  }

  function openArchiveDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('cashtop-archive-v1', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: 'archiveKey' });
          store.createIndex('companyDataset', 'companyDataset', { unique: false });
          store.createIndex('date', 'date', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function archiveRecords(dataset, records) {
    if (!records?.length || !('indexedDB' in window)) return 0;
    const db = await openArchiveDb();
    const tx = db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    const companyId = companyIdFromSession();
    records.forEach((record, index) => {
      const id = record.id || record.refId || `${normalizeDateValue(record.date)}_${index}`;
      store.put({
        archiveKey: `${companyId}::${dataset}::${id}`,
        companyDataset: `${companyId}::${dataset}`,
        companyId, dataset, id, date: normalizeDateValue(record.date || record.createdAt || record.updatedAt),
        record, archivedAt: Date.now()
      });
    });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    return records.length;
  }

  async function readArchivedRecords(dataset) {
    if (!('indexedDB' in window)) return [];
    const db = await openArchiveDb();
    const tx = db.transaction('records', 'readonly');
    const index = tx.objectStore('records').index('companyDataset');
    const request = index.getAll(`${companyIdFromSession()}::${dataset}`);
    const rows = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.map(row => row.record);
  }

  async function compactCompletedData(force = false) {
    const indexData = safeJson(localStorage.getItem('cashtop_archive_index'), {}) || {};
    const last = Number(indexData.lastCompactionAt || 0);
    if (!force && Date.now() - last < 6 * 60 * 60 * 1000) return { skipped: true };
    const settings = Object.assign({ invoiceLimit: 1200, historyLimit: 1500, completedAgeDays: 365 },
      safeJson(localStorage.getItem('cashtop_settings'), {})?.storage || {});
    const ageDays = Math.max(7, Number(settings.completedAgeDays || 365));
    const cutoff = Date.now() - ageDays * 86400000;
    const policies = [
      ['cashtop_invoices', Math.max(100, Number(settings.invoiceLimit || 1200)), item => item.status !== 'draft'],
      ['cashtop_purchases', Math.max(100, Number(settings.invoiceLimit || 1200)), () => true],
      ['cashtop_transfer_history', Math.max(100, Number(settings.historyLimit || 1500)), () => true],
      ['cashtop_branch_transfer_history', Math.max(100, Number(settings.historyLimit || 1500)), () => true],
      ['cashtop_manufacturing_orders', Math.max(100, Number(settings.historyLimit || 1500)), item => item.status === 'completed' || !item.status]
    ];
    const archivedCounts = Object.assign({}, indexData.archivedCounts || {});
    const runCounts = {};
    for (const [key, limit, completed] of policies) {
      const list = safeJson(localStorage.getItem(key), []) || [];
      if (!Array.isArray(list) || !list.length) continue;
      const sortedCompleted = list.filter(completed).slice().sort((a, b) => normalizeDateValue(a.date || a.createdAt) - normalizeDateValue(b.date || b.createdAt));
      const candidates = [];
      const selected = new Set();
      sortedCompleted.forEach(item => {
        const time = normalizeDateValue(item.date || item.createdAt || item.updatedAt);
        if (time > 0 && time < cutoff) { candidates.push(item); selected.add(item); }
      });
      const projectedLength = list.length - candidates.length;
      const overflow = Math.max(0, projectedLength - limit);
      if (overflow) {
        sortedCompleted.filter(item => !selected.has(item)).slice(0, overflow).forEach(item => {
          candidates.push(item); selected.add(item);
        });
      }
      if (!candidates.length) continue;
      await archiveRecords(key, candidates);
      const kept = list.filter(item => !selected.has(item));
      localStorage.setItem(key, JSON.stringify(kept));
      archivedCounts[key] = Number(archivedCounts[key] || 0) + candidates.length;
      runCounts[key] = candidates.length;
    }
    const audit = safeJson(localStorage.getItem('cashtop_audit_log'), []) || [];
    if (audit.length > 100) localStorage.setItem('cashtop_audit_log', JSON.stringify(audit.slice(-100)));
    const result = { lastCompactionAt: Date.now(), archivedCounts, lastRunCounts: runCounts };
    localStorage.setItem('cashtop_archive_index', JSON.stringify(result));
    return result;
  }

  let ctActiveSelect = null;
  let ctSelectPopover = null;
  let ctSelectBackdrop = null;

  function closeModernSelect(restoreFocus = false) {
    const select = ctActiveSelect;
    ctSelectPopover?.remove();
    ctSelectBackdrop?.remove();
    // WebView may discard a JS reference while leaving the fixed backdrop in DOM.
    // Remove any orphaned select layer so it can never block the page controls.
    document.querySelectorAll('.ct-select-popover, .ct-select-backdrop').forEach(element => element.remove());
    ctSelectPopover = null;
    ctSelectBackdrop = null;
    ctActiveSelect = null;
    document.querySelectorAll('.ct-select-is-open').forEach(element => element.classList.remove('ct-select-is-open'));
    if (restoreFocus && select && document.contains(select)) {
      try { select.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  function closeTransientUi(options = {}) {
    closeModernSelect(false);
    if (options.closeSidebar !== false) toggleSidebar(false);
    document.documentElement.classList.remove('ct-ui-locked');
    document.body?.classList.remove('ct-ui-locked');
  }

  function selectBoundaryPosition(popover, select) {
    if (!popover || !select || window.matchMedia('(max-width: 600px)').matches) return;
    const rect = select.getBoundingClientRect();
    const margin = 8;
    const width = Math.max(220, Math.min(420, rect.width));
    popover.style.width = `${width}px`;
    const measuredHeight = Math.min(popover.scrollHeight, 420);
    let top = rect.bottom + 6;
    if (top + measuredHeight > window.innerHeight - margin && rect.top > measuredHeight + margin) {
      top = rect.top - measuredHeight - 6;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - measuredHeight - margin));
    let left = rect.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function dispatchSelectChange(select) {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function openModernSelect(select) {
    if (!select || select.disabled || select.dataset.nativeSelect === 'true') return;
    if (ctActiveSelect === select) { closeModernSelect(true); return; }
    closeModernSelect(false);
    ctActiveSelect = select;
    select.classList.add('ct-select-is-open');

    const backdrop = document.createElement('div');
    backdrop.className = 'ct-select-backdrop';
    backdrop.addEventListener('pointerdown', event => { event.preventDefault(); closeModernSelect(true); });

    const popover = document.createElement('div');
    popover.className = 'ct-select-popover';
    popover.setAttribute('role', 'listbox');
    popover.setAttribute('aria-multiselectable', select.multiple ? 'true' : 'false');
    popover.addEventListener('pointerdown', event => event.stopPropagation());

    const optionsHost = document.createElement('div');
    optionsHost.className = 'ct-select-options';
    const optionCount = [...select.options].filter(option => !option.hidden).length;
    let searchInput = null;

    if (optionCount > 8) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'ct-select-search-wrap';
      searchInput = document.createElement('input');
      searchInput.className = 'ct-select-search';
      searchInput.type = 'search';
      searchInput.placeholder = 'ابحث داخل القائمة...';
      searchInput.autocomplete = 'off';
      searchWrap.appendChild(searchInput);
      popover.appendChild(searchWrap);
    }

    function renderOptions(query = '') {
      const normalized = String(query || '').trim().toLocaleLowerCase('ar');
      optionsHost.innerHTML = '';
      let visible = 0;
      let lastGroup = null;
      [...select.options].forEach((option, index) => {
        if (option.hidden) return;
        const label = (option.textContent || '').trim();
        if (normalized && !label.toLocaleLowerCase('ar').includes(normalized)) return;
        const group = option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '';
        if (group && group !== lastGroup) {
          const groupEl = document.createElement('div');
          groupEl.className = 'ct-select-group';
          groupEl.textContent = group;
          optionsHost.appendChild(groupEl);
          lastGroup = group;
        } else if (!group) {
          lastGroup = null;
        }
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `ct-select-option${option.selected ? ' is-selected' : ''}`;
        row.disabled = option.disabled;
        row.dataset.optionIndex = String(index);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', option.selected ? 'true' : 'false');
        const text = document.createElement('span');
        text.textContent = label || '—';
        const check = document.createElement('span');
        check.className = 'ct-select-check';
        check.textContent = option.selected ? '✓' : '';
        row.append(text, check);
        row.addEventListener('click', () => {
          if (option.disabled) return;
          if (select.multiple) {
            option.selected = !option.selected;
            dispatchSelectChange(select);
            renderOptions(searchInput?.value || '');
          } else {
            select.selectedIndex = index;
            closeModernSelect(false);
            dispatchSelectChange(select);
            select.focus({ preventScroll: true });
          }
        });
        optionsHost.appendChild(row);
        visible += 1;
      });
      if (!visible) {
        const empty = document.createElement('div');
        empty.className = 'ct-select-empty';
        empty.textContent = 'لا توجد خيارات مطابقة';
        optionsHost.appendChild(empty);
      }
    }

    renderOptions();
    popover.appendChild(optionsHost);
    if (select.multiple) {
      const footer = document.createElement('div');
      footer.className = 'ct-select-footer';
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'ct-select-done';
      done.textContent = 'تم';
      done.addEventListener('click', () => closeModernSelect(true));
      footer.appendChild(done);
      popover.appendChild(footer);
    }
    searchInput?.addEventListener('input', () => renderOptions(searchInput.value));

    document.body.append(backdrop, popover);
    ctSelectBackdrop = backdrop;
    ctSelectPopover = popover;
    selectBoundaryPosition(popover, select);
    requestAnimationFrame(() => searchInput?.focus({ preventScroll: true }));
  }

  function enhanceAllSelects(root = document) {
    const selects = [
      ...(root?.matches?.('select:not([data-ct-enhanced])') ? [root] : []),
      ...(root?.querySelectorAll?.('select:not([data-ct-enhanced])') || [])
    ];
    selects.forEach(select => {
      select.dataset.ctEnhanced = 'true';
      select.style.touchAction = 'pan-y';
      let gesture = null;
      let ignoreClickUntil = 0;
      select.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        if (event.pointerType === 'mouse') event.preventDefault();
        gesture = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          startedAt: performance.now(),
          moved: false
        };
      });
      select.addEventListener('pointermove', event => {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 9) gesture.moved = true;
      }, { passive: true });
      select.addEventListener('pointercancel', event => {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        gesture = null;
        ignoreClickUntil = performance.now() + 650;
      });
      select.addEventListener('pointerup', event => {
        if (!gesture || event.pointerId !== gesture.pointerId) return;
        const current = gesture;
        gesture = null;
        ignoreClickUntil = performance.now() + 650;
        const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
        const intentionalTap = !current.moved && distance <= 9 && (performance.now() - current.startedAt) < 900;
        if (!intentionalTap) return;
        event.preventDefault();
        event.stopPropagation();
        openModernSelect(select);
      });
      select.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (performance.now() < ignoreClickUntil) return;
        openModernSelect(select);
      });
      select.addEventListener('keydown', event => {
        if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          openModernSelect(select);
        } else if (event.key === 'Escape') {
          closeModernSelect(true);
        }
      });
    });
    if (!document.documentElement.dataset.ctSelectEvents) {
      document.documentElement.dataset.ctSelectEvents = 'true';
      let selectPositionFrame = 0;
      const scheduleSelectPosition = () => {
        if (!ctActiveSelect || selectPositionFrame) return;
        selectPositionFrame = requestAnimationFrame(() => {
          selectPositionFrame = 0;
          selectBoundaryPosition(ctSelectPopover, ctActiveSelect);
        });
      };
      window.addEventListener('resize', scheduleSelectPosition, { passive: true });
      window.addEventListener('scroll', scheduleSelectPosition, { capture: true, passive: true });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && ctActiveSelect) closeModernSelect(true);
      });
    }
  }

  window.Cashtop = Object.assign(window.Cashtop || {}, {
    FILE,
    DATA_KEYS: [...DATA_KEYS],
    aliases: { ...ALIASES },
    getSession,
    persistSession,
    tenantIdFromSession,
    logout,
    showToast,
    syncNow,
    installPwa,
    can,
    normalizePermissions,
    PERMISSION_GROUPS,
    PAGE_PERMISSIONS,
    ACTION_PERMISSION_MAP,
    applyActionPermissions,
    applyPermissionVisibility,
    toggleSidebar,
    closeTransientUi,
    rawGet,
    rawSet,
    getRawCompanyDataset,
    setRawCompanyDataset,
    ensureSystemDefaults,
    DEFAULT_MAIN_BRANCH_NAME,
    DEFAULT_CASH_ACCOUNT_NAME,
    branchIdFromSession,
    currentPlan,
    PLUS_LIMITS,
    namespaceKey,
    metaKey,
    safeJson,
    normalizeArray: normalizeArrayValue,
    getAllCompanyData,
    exportBackup,
    importBackupFile,
    isBackupImportEnabled,
    syncImportedData,
    applyRemoteDataset,
    validateSessionLocal,
    getTaxSettings, calculateTax, getSmartNotifications, updateNotificationBadge,
    archiveRecords, readArchivedRecords, compactCompletedData,
    getSyncQueue, enqueueSyncOperation, completeSyncOperation, clearSyncQueue, updateSyncBadge, restoreSyncQueueBackup, migrateLegacySyncQueues,
    setSyncProgress, restoreDurableCompanyData,
    getSystemSettings, getProfitRate, salePriceFromCost, applySystemBranding, recordIdentity, sortNewestFirstRecords,
    debounce, runWhenIdle, renderVirtualRows, runWorkerTask, queryRecords, atomicSetItems, recoverAtomicTransactions,
    captureModalDraft, restoreModalDraft, clearModalDraft, getAuditPending, getAuditPendingAsync, getAuditPendingCountAsync, completeAuditPending, completeAuditPendingAsync, getRecentAuditCache,
    getNotificationSettings, requestNotificationPermission, showSystemNotification,
    notificationBrandIcon, showTodayProfitNotification, todaySalesSummary
  });

  if (IS_APP_PAGE) {
    addCoreAssets();
    patchStorage();
    if (ensureAuthenticated()) { recoverAtomicTransactions(); seedCompanyStorage(); bootstrapCompanyAccess(); ensureSystemDefaults(); }

    window.addEventListener('online', () => { updateNetworkStatus(); syncNow({ manual: false }); });
    window.addEventListener('cashtop:sync-queue-changed', updateSyncBadge);
    window.addEventListener('cashtop:sync-queue-restored', () => { syncNow({ manual: false }); });
    window.addEventListener('cashtop:data-changed', event => { if (event.detail?.key === 'cashtop_settings') applySystemBranding(); });
    window.addEventListener('offline', updateNetworkStatus);
    durableReadyPromise = restoreDurableCompanyData().catch(() => ({ restored: 0 }));
    window.Cashtop.localReady = durableReadyPromise;
    durableReadyPromise
      .then(() => restoreSyncQueueBackup().catch(() => []))
      .then(() => migrateLegacySyncQueues().catch(() => ({ migrated: 0 })))
      .then(() => {
        updateSyncBadge();
        if (getSyncQueue().length) syncNow({ manual: false });
      })
      .catch(() => null);
    window.addEventListener('cashtop:sync-progress', event => setSyncProgress(event.detail || {}));
    window.addEventListener('cashtop:pull-start', event => setRecordsPulling(true, event.detail || {}));
    window.addEventListener('cashtop:pull-end', event => setRecordsPulling(false, event.detail || {}));
    window.addEventListener('cashtop:local-storage-pressure', () => {
      showToast('تم تحويل التخزين تلقائياً إلى قاعدة IndexedDB المحلية الكبيرة للحفاظ على البيانات.', 'info', 4200);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeTransientUi();
    });
    window.addEventListener('pageshow', () => closeTransientUi(), { passive: true });
    document.addEventListener('DOMContentLoaded', () => {
      migrateNotificationDefaultsV54();
      mountShell();
      installModalDraftPersistence();
      installManagerNotificationSystem();
      setTimeout(installGlobalPerformanceGuards, 0);
    }, { once: true });

    const refreshSessionAccess = () => {
      const before = getSession() || {};
      const result = validateSessionLocal(before);
      if (!result.ok) { logout(result.reason); return; }
      const after = getSession() || {};
      if (JSON.stringify(before.permissions || {}) !== JSON.stringify(after.permissions || {}) || before.authVersion !== after.authVersion || before.plan !== after.plan) {
        applyPermissionVisibility();
        applyActionPermissions();
        if (!enforceCurrentPageAccess(after)) return;
        window.dispatchEvent(new CustomEvent('cashtop:session-updated', { detail: after }));
      }
    };
    setInterval(refreshSessionAccess, 4000);
    window.addEventListener('cashtop:remote-applied', event => {
      if (['cashtop_employees','cashtop_branches','cashtop_company_access'].includes(event.detail?.key)) refreshSessionAccess();
      if (event.detail?.key === 'cashtop_settings') applySystemBranding();
    });

    if (channel) {
      channel.addEventListener('message', event => {
        const data = event.data || {};
        if (data.type === 'license-change') {
          const result = validateSessionLocal(getSession());
          if (!result.ok) logout(result.reason);
        }
        if (data.type === 'data-change' && data.deviceId !== getDeviceId() && data.companyId === companyIdFromSession()) {
          dispatchLogicalStorageEvents(data.key, data.oldValue, data.value);
          window.dispatchEvent(new CustomEvent('cashtop:external-change', { detail: data }));
        }
      });
    }

    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      const requestPersistentStorage = async () => {
        try {
          const already = typeof navigator.storage.persisted === 'function'
            ? await navigator.storage.persisted()
            : false;
          const granted = already || await navigator.storage.persist();
          rawSet('ct_storage_persistence_v1', JSON.stringify({ granted: Boolean(granted), checkedAt: Date.now() }));
          return granted;
        } catch (_) {
          rawSet('ct_storage_persistence_v1', JSON.stringify({ granted: false, checkedAt: Date.now() }));
          return false;
        }
      };
      requestPersistentStorage();
      /* بعض المتصفحات لا تمنح التخزين الدائم إلا بعد تفاعل واضح من المستخدم. */
      document.addEventListener('pointerdown', requestPersistentStorage, { once: true, passive: true });
    }
    // بعض متصفحات Android تمنع <script type="module"> عند فتح التطبيق من file://.
    // نحاول هنا تشغيل وحدة المزامنة كـ classic script بعد اكتمال تحميل الصفحة،
    // وهذا يصلح أيضاً الصفحات القديمة التي قد تكون ما زالت محفوظة في كاش سابق.
    setTimeout(() => ensureCloudSyncRuntime().catch(() => false), 120);

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      (async () => {
        try {
          const registration = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
          // لا نفحص الشبكة عند فتح كل صفحة. فحص تحديث الـ SW مرة كل 30 دقيقة يكفي،
          // بينما التنقل نفسه يبقى Cache First فورياً على الجوال واللابتوب.
          const now = Date.now();
          const lastUpdateCheck = Number(rawGet('ct_sw_update_checked_at') || 0);
          if (now - lastUpdateCheck > 30 * 60 * 1000) {
            rawSet('ct_sw_update_checked_at', String(now));
            registration.update().catch(() => null);
          }
          const ready = await navigator.serviceWorker.ready;
          if (!sessionStorage.getItem('ct_sw_cache_verified_session')) {
            sessionStorage.setItem('ct_sw_cache_verified_session', '1');
            ready.active?.postMessage?.({ type: 'VERIFY_CACHE' });
            ready.active?.postMessage?.({ type: 'WARM_CACHE' });
          }
        } catch (err) {
          console.warn('[CASH TOP 2] SW:', err);
        }
      })();
    }
  }
})();
