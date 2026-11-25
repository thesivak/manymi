import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const userPreferences = pgTable("user_preferences", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  activeCompanyId: text("active_company_id"),
  updatedAt: text("updated_at").notNull(),
});

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ico: text("ico").notNull().default(""),
  dic: text("dic").notNull().default(""),
  vatPayer: boolean("vat_payer").notNull().default(true),
  vatPeriod: text("vat_period").notNull().default("monthly"),
  street: text("street").notNull().default(""),
  city: text("city").notNull().default(""),
  zip: text("zip").notNull().default(""),
  country: text("country").notNull().default("Česká republika"),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  web: text("web").notNull().default(""),
  registryNote: text("registry_note").notNull().default(""),
  defaultDueDays: integer("default_due_days").notNull().default(14),
  defaultVatRate: integer("default_vat_rate").notNull().default(21),
  defaultCurrency: text("default_currency").notNull().default("CZK"),
  defaultRounding: boolean("default_rounding").notNull().default(false),
  defaultPriceType: text("default_price_type").notNull().default("without_vat"),
  defaultPrintLang: text("default_print_lang").notNull().default("cs"),
  defaultNoteBefore: text("default_note_before").notNull().default(""),
  defaultNoteAfter: text("default_note_after").notNull().default(""),
  accountantEmail: text("accountant_email").notNull().default(""),
  reminderEnabled: boolean("reminder_enabled").notNull().default(false),
  reminderDaysAfter: integer("reminder_days_after").notNull().default(7),
  thankYouEnabled: boolean("thank_you_enabled").notNull().default(false),
  emailTemplatesJson: text("email_templates_json").notNull().default("{}"),
  annualPlanMinor: bigint("annual_plan_minor", { mode: "number" })
    .notNull()
    .default(450000000),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const companyMemberships = pgTable(
  "company_memberships",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    role: text("role").notNull().default("owner"), // owner | accountant
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("company_memberships_company_user_idx").on(
      table.companyId,
      table.clerkUserId,
    ),
    index("company_memberships_user_idx").on(table.clerkUserId),
  ],
);

export const companyInvitations = pgTable(
  "company_invitations",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("accountant"),
    status: text("status").notNull().default("pending"), // pending | accepted
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("company_invitations_company_idx").on(table.companyId)],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    accountNumber: text("account_number").notNull(),
    bankCode: text("bank_code").notNull().default(""),
    iban: text("iban").notNull().default(""),
    swift: text("swift").notNull().default(""),
    currency: text("currency").notNull().default("CZK"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("bank_accounts_company_idx").on(table.companyId)],
);

export const numberSequences = pgTable(
  "number_sequences",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull().default("invoice"), // invoice | proforma | tax_document | credit_note | quote | sales_receipt | received_invoice
    name: text("name").notNull(),
    prefix: text("prefix").notNull().default(""),
    year: integer("year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    padding: integer("padding").notNull().default(4),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("number_sequences_unique_idx").on(
      table.companyId,
      table.docType,
      table.prefix,
      table.year,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ico: text("ico").notNull().default(""),
    dic: text("dic").notNull().default(""),
    vatPayer: boolean("vat_payer").notNull().default(false),
    street: text("street").notNull().default(""),
    city: text("city").notNull().default(""),
    zip: text("zip").notNull().default(""),
    country: text("country").notNull().default("Česká republika"),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    web: text("web").notNull().default(""),
    contactPerson: text("contact_person").notNull().default(""),
    bankAccount: text("bank_account").notNull().default(""),
    deliveryAddress: text("delivery_address").notNull().default(""),
    defaultDueDays: integer("default_due_days"),
    defaultDiscountPercent: integer("default_discount_percent").notNull().default(0),
    note: text("note").notNull().default(""),
    aresVerifiedAt: text("ares_verified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("contacts_company_idx").on(table.companyId),
    index("contacts_ico_idx").on(table.companyId, table.ico),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sequenceId: text("sequence_id").references(() => numberSequences.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    docType: text("doc_type").notNull().default("invoice"), // invoice | proforma | tax_document | credit_note | quote | sales_receipt
    number: text("number").notNull(),
    status: text("status").notNull().default("draft"), // draft | issued | cancelled
    quoteStatus: text("quote_status").notNull().default("open"), // open | accepted | rejected | converted
    description: text("description").notNull().default(""),
    issueDate: text("issue_date").notNull(),
    duzp: text("duzp").notNull(),
    dueDate: text("due_date").notNull(),
    paymentMethod: text("payment_method").notNull().default("bank_transfer"),
    variableSymbol: text("variable_symbol").notNull().default(""),
    constantSymbol: text("constant_symbol").notNull().default(""),
    orderNumber: text("order_number").notNull().default(""),
    discountPercent: integer("discount_percent").notNull().default(0),
    currency: text("currency").notNull().default("CZK"),
    exchangeRateMilli: bigint("exchange_rate_milli", { mode: "number" })
      .notNull()
      .default(1000),
    printLanguage: text("print_language").notNull().default("cs"), // cs | en
    priceType: text("price_type").notNull().default("without_vat"), // without_vat | with_vat
    vatMode: text("vat_mode").notNull().default("standard"), // standard | reverse_charge | non_vat
    roundToWhole: boolean("round_to_whole").notNull().default(false),
    showQr: boolean("show_qr").notNull().default(true),
    noteBefore: text("note_before").notNull().default(""),
    noteAfter: text("note_after").notNull().default(""),
    tagsJson: text("tags_json").notNull().default("[]"),
    relatedDocumentId: text("related_document_id"),
    proformaDeductionMinor: bigint("proforma_deduction_minor", { mode: "number" })
      .notNull()
      .default(0),
    recurringId: text("recurring_id"),
    exportedAt: text("exported_at"),
    supplierSnapshotJson: text("supplier_snapshot_json").notNull(),
    customerSnapshotJson: text("customer_snapshot_json").notNull(),
    bankSnapshotJson: text("bank_snapshot_json").notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    vatTotalMinor: bigint("vat_total_minor", { mode: "number" }).notNull().default(0),
    roundingMinor: bigint("rounding_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
    spaydString: text("spayd_string").notNull().default(""),
    issuedAt: text("issued_at"),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoices_company_number_idx").on(table.companyId, table.number),
    index("invoices_company_issue_idx").on(table.companyId, table.issueDate),
    index("invoices_contact_idx").on(table.contactId),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    description: text("description").notNull(),
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull().default(1000),
    unit: text("unit").notNull().default("ks"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull().default(0),
    priceType: text("price_type").notNull().default("without_vat"),
    catalogItemId: text("catalog_item_id"),
    vatRate: integer("vat_rate").notNull().default(21),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    vatMinor: bigint("vat_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
  },
  (table) => [index("invoice_items_invoice_idx").on(table.invoiceId)],
);

export const documentAttachments = pgTable(
  "document_attachments",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ownerType: text("owner_type").notNull().default("invoice"), // invoice | purchase
    ownerId: text("owner_id").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentBase64: text("content_base64").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("doc_attachments_owner_idx").on(table.ownerType, table.ownerId)],
);

export const invoiceTemplates = pgTable(
  "invoice_templates",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    docType: text("doc_type").notNull().default("invoice"),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    customerSnapshotJson: text("customer_snapshot_json").notNull().default("{}"),
    description: text("description").notNull().default(""),
    dueDays: integer("due_days").notNull().default(14),
    paymentMethod: text("payment_method").notNull().default("bank_transfer"),
    currency: text("currency").notNull().default("CZK"),
    vatMode: text("vat_mode").notNull().default("standard"),
    priceType: text("price_type").notNull().default("without_vat"),
    discountPercent: integer("discount_percent").notNull().default(0),
    itemsJson: text("items_json").notNull().default("[]"),
    noteBefore: text("note_before").notNull().default(""),
    noteAfter: text("note_after").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("invoice_templates_company_idx").on(table.companyId)],
);

export const recurringInvoices = pgTable(
  "recurring_invoices",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    docType: text("doc_type").notNull().default("invoice"),
    sequenceId: text("sequence_id"),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    customerSnapshotJson: text("customer_snapshot_json").notNull().default("{}"),
    orderNumber: text("order_number").notNull().default(""),
    description: text("description").notNull().default(""),
    frequency: text("frequency").notNull().default("monthly"), // daily | weekly | monthly | quarterly | yearly
    intervalCount: integer("interval_count").notNull().default(1),
    startDate: text("start_date").notNull(),
    nextRunDate: text("next_run_date").notNull(),
    issueLastDayOfMonth: boolean("issue_last_day_of_month").notNull().default(false),
    endMode: text("end_mode").notNull().default("never"), // never | after_date | after_count
    endDate: text("end_date"),
    maxOccurrences: integer("max_occurrences"),
    issuedCount: integer("issued_count").notNull().default(0),
    duzpMode: text("duzp_mode").notNull().default("issue_date"), // issue_date | last_day_of_month
    dueDays: integer("due_days").notNull().default(14),
    paymentMethod: text("payment_method").notNull().default("bank_transfer"),
    bankAccountId: text("bank_account_id"),
    constantSymbol: text("constant_symbol").notNull().default("0308"),
    currency: text("currency").notNull().default("CZK"),
    vatMode: text("vat_mode").notNull().default("standard"),
    priceType: text("price_type").notNull().default("without_vat"),
    printLanguage: text("print_language").notNull().default("cs"),
    discountPercent: integer("discount_percent").notNull().default(0),
    itemsJson: text("items_json").notNull().default("[]"),
    noteBefore: text("note_before").notNull().default(""),
    noteAfter: text("note_after").notNull().default(""),
    internalNote: text("internal_note").notNull().default(""),
    tagsJson: text("tags_json").notNull().default("[]"),
    sendEmail: boolean("send_email").notNull().default(false),
    sendCopyToSelf: boolean("send_copy_to_self").notNull().default(false),
    sendToAccountant: boolean("send_to_accountant").notNull().default(false),
    sendToOtherEmails: text("send_to_other_emails").notNull().default(""),
    active: boolean("active").notNull().default(true),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("recurring_invoices_company_idx").on(table.companyId)],
);

export const emailLogs = pgTable(
  "email_logs",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: text("document_id"),
    documentNumber: text("document_number").notNull().default(""),
    kind: text("kind").notNull().default("invoice"), // invoice | reminder | thank_you | quote | accountant
    recipientEmail: text("recipient_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("sent"),
    sentAt: text("sent_at").notNull(),
  },
  (table) => [index("email_logs_company_idx").on(table.companyId)],
);

export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull().default("received_invoice"), // received_invoice | receipt
    number: text("number").notNull(),
    externalNumber: text("external_number").notNull().default(""),
    supplierId: text("supplier_id").references(() => contacts.id, { onDelete: "set null" }),
    supplierSnapshotJson: text("supplier_snapshot_json").notNull(),
    description: text("description").notNull().default(""),
    receivedDate: text("received_date").notNull(),
    issueDate: text("issue_date").notNull(),
    duzp: text("duzp").notNull(),
    dueDate: text("due_date").notNull(),
    variableSymbol: text("variable_symbol").notNull().default(""),
    paymentMethod: text("payment_method").notNull().default("bank_transfer"),
    currency: text("currency").notNull().default("CZK"),
    vatMode: text("vat_mode").notNull().default("standard"),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    vatTotalMinor: bigint("vat_total_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    paidMinor: bigint("paid_minor", { mode: "number" }).notNull().default(0),
    paidAt: text("paid_at"),
    itemsJson: text("items_json").notNull().default("[]"),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("purchases_company_idx").on(table.companyId)],
);

export const inboxItems = pgTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentBase64: text("content_base64").notNull(),
    status: text("status").notNull().default("pending"), // pending | processed
    extractedJson: text("extracted_json").notNull().default("{}"),
    convertedPurchaseId: text("converted_purchase_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("inbox_items_company_idx").on(table.companyId)],
);

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku").notNull().default(""),
    ean: text("ean").notNull().default(""),
    unit: text("unit").notNull().default("ks"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull().default(0),
    priceType: text("price_type").notNull().default("without_vat"),
    vatRate: integer("vat_rate").notNull().default(21),
    currency: text("currency").notNull().default("CZK"),
    trackStock: boolean("track_stock").notNull().default(false),
    stockQuantityMilli: bigint("stock_quantity_milli", { mode: "number" })
      .notNull()
      .default(0),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("catalog_items_company_idx").on(table.companyId)],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    catalogItemId: text("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    direction: text("direction").notNull().default("in"), // in | out
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull().default(0),
    sourceDocType: text("source_doc_type").notNull().default("manual"),
    sourceDocId: text("source_doc_id"),
    note: text("note").notNull().default(""),
    movedAt: text("moved_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("stock_movements_company_idx").on(table.companyId)],
);

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    direction: text("direction").notNull().default("in"), // in (sales) | out (purchases)
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("CZK"),
    paidAt: text("paid_at").notNull(),
    method: text("method").notNull().default("bank_transfer"),
    variableSymbol: text("variable_symbol").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("payments_company_idx").on(table.companyId)],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("payment_allocations_invoice_idx").on(table.invoiceId),
    index("payment_allocations_payment_idx").on(table.paymentId),
  ],
);

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    direction: text("direction").notNull().default("credit"), // credit | debit
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("CZK"),
    bookedAt: text("booked_at").notNull(),
    counterpartyName: text("counterparty_name").notNull().default(""),
    counterpartyAccount: text("counterparty_account").notNull().default(""),
    variableSymbol: text("variable_symbol").notNull().default(""),
    note: text("note").notNull().default(""),
    matchStatus: text("match_status").notNull().default("unmatched"), // unmatched | matched | ignored
    matchedInvoiceId: text("matched_invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    matchedPurchaseId: text("matched_purchase_id").references(() => purchases.id, {
      onDelete: "set null",
    }),
    paymentId: text("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("bank_transactions_company_idx").on(table.companyId)],
);

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("CZK"),
    initialBalanceMinor: bigint("initial_balance_minor", { mode: "number" })
      .notNull()
      .default(0),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("cash_registers_company_idx").on(table.companyId)],
);

export const cashVouchers = pgTable(
  "cash_vouchers",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    cashRegisterId: text("cash_register_id")
      .notNull()
      .references(() => cashRegisters.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    direction: text("direction").notNull().default("in"), // in | out
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("CZK"),
    issuedAt: text("issued_at").notNull(),
    counterpartyName: text("counterparty_name").notNull().default(""),
    description: text("description").notNull().default(""),
    invoiceId: text("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    purchaseId: text("purchase_id").references(() => purchases.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("cash_vouchers_company_idx").on(table.companyId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_hash_idx").on(table.keyHash),
    index("api_keys_company_idx").on(table.companyId),
  ],
);

export type Company = typeof companies.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type NumberSequence = typeof numberSequences.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type CashRegister = typeof cashRegisters.$inferSelect;
export type CashVoucher = typeof cashVouchers.$inferSelect;
export type RecurringInvoice = typeof recurringInvoices.$inferSelect;
export type InvoiceTemplate = typeof invoiceTemplates.$inferSelect;
export type EmailLog = typeof emailLogs.$inferSelect;
export type InboxItem = typeof inboxItems.$inferSelect;
