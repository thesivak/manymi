import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __manymySql?: Sql;
  __manymySchemaInit?: Promise<void>;
};

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url || !url.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL není nastaveno na PostgreSQL (Supabase). Nastavte DATABASE_URL v .env.local.",
    );
  }
  // Prefer Supabase Transaction Pooler (6543) over Session Pooler (5432) on serverless
  // to avoid EMAXCONNSESSION (15-client limit in session mode).
  if (url.includes("pooler.supabase.com:5432/")) {
    return url.replace("pooler.supabase.com:5432/", "pooler.supabase.com:6543/");
  }
  return url;
}

function getSqlClient(): Sql {
  if (!globalForDb.__manymySql) {
    const url = getDatabaseUrl();
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    globalForDb.__manymySql = postgres(url, {
      prepare: false,
      ssl: isLocal ? false : "require",
      onnotice: () => {},
      max: process.env.VERCEL ? 2 : 5,
      idle_timeout: 10,
      max_lifetime: 300,
      connect_timeout: 15,
    });
  }
  return globalForDb.__manymySql;
}

export function getDb() {
  return drizzle(getSqlClient(), { schema });
}

export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

const BOOTSTRAP_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_preferences (
    clerk_user_id TEXT PRIMARY KEY NOT NULL,
    active_company_id TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    ico TEXT NOT NULL DEFAULT '',
    dic TEXT NOT NULL DEFAULT '',
    vat_payer BOOLEAN NOT NULL DEFAULT TRUE,
    vat_period TEXT NOT NULL DEFAULT 'monthly',
    street TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT 'Česká republika',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    web TEXT NOT NULL DEFAULT '',
    registry_note TEXT NOT NULL DEFAULT '',
    default_due_days INTEGER NOT NULL DEFAULT 14,
    default_vat_rate INTEGER NOT NULL DEFAULT 21,
    default_currency TEXT NOT NULL DEFAULT 'CZK',
    default_rounding BOOLEAN NOT NULL DEFAULT FALSE,
    default_price_type TEXT NOT NULL DEFAULT 'without_vat',
    default_print_lang TEXT NOT NULL DEFAULT 'cs',
    default_note_before TEXT NOT NULL DEFAULT '',
    default_note_after TEXT NOT NULL DEFAULT '',
    accountant_email TEXT NOT NULL DEFAULT '',
    reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_days_after INTEGER NOT NULL DEFAULT 7,
    thank_you_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    email_templates_json TEXT NOT NULL DEFAULT '{}',
    annual_plan_minor BIGINT NOT NULL DEFAULT 450000000,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_price_type TEXT NOT NULL DEFAULT 'without_vat'`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_print_lang TEXT NOT NULL DEFAULT 'cs'`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS accountant_email TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS reminder_days_after INTEGER NOT NULL DEFAULT 7`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS thank_you_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS email_templates_json TEXT NOT NULL DEFAULT '{}'`,
  `CREATE TABLE IF NOT EXISTS company_memberships (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    clerk_user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS company_memberships_company_user_idx ON company_memberships(company_id, clerk_user_id)`,
  `CREATE INDEX IF NOT EXISTS company_memberships_user_idx ON company_memberships(clerk_user_id)`,
  `CREATE TABLE IF NOT EXISTS company_invitations (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'accountant',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS company_invitations_company_idx ON company_invitations(company_id)`,
  `CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    account_number TEXT NOT NULL,
    bank_code TEXT NOT NULL DEFAULT '',
    iban TEXT NOT NULL DEFAULT '',
    swift TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'CZK',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bank_accounts_company_idx ON bank_accounts(company_id)`,
  `CREATE TABLE IF NOT EXISTS number_sequences (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL DEFAULT 'invoice',
    name TEXT NOT NULL,
    prefix TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    padding INTEGER NOT NULL DEFAULT 4,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS number_sequences_unique_idx ON number_sequences(company_id, doc_type, prefix, year)`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ico TEXT NOT NULL DEFAULT '',
    dic TEXT NOT NULL DEFAULT '',
    vat_payer BOOLEAN NOT NULL DEFAULT FALSE,
    street TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT 'Česká republika',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    web TEXT NOT NULL DEFAULT '',
    contact_person TEXT NOT NULL DEFAULT '',
    bank_account TEXT NOT NULL DEFAULT '',
    delivery_address TEXT NOT NULL DEFAULT '',
    default_due_days INTEGER,
    default_discount_percent INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    ares_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_person TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS bank_account TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS delivery_address TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS default_discount_percent INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS contacts_company_idx ON contacts(company_id)`,
  `CREATE INDEX IF NOT EXISTS contacts_ico_idx ON contacts(company_id, ico)`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sequence_id TEXT REFERENCES number_sequences(id) ON DELETE SET NULL,
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    doc_type TEXT NOT NULL DEFAULT 'invoice',
    number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    quote_status TEXT NOT NULL DEFAULT 'open',
    description TEXT NOT NULL DEFAULT '',
    issue_date TEXT NOT NULL,
    duzp TEXT NOT NULL,
    due_date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
    variable_symbol TEXT NOT NULL DEFAULT '',
    constant_symbol TEXT NOT NULL DEFAULT '',
    order_number TEXT NOT NULL DEFAULT '',
    discount_percent INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'CZK',
    exchange_rate_milli BIGINT NOT NULL DEFAULT 1000,
    print_language TEXT NOT NULL DEFAULT 'cs',
    price_type TEXT NOT NULL DEFAULT 'without_vat',
    vat_mode TEXT NOT NULL DEFAULT 'standard',
    round_to_whole BOOLEAN NOT NULL DEFAULT FALSE,
    show_qr BOOLEAN NOT NULL DEFAULT TRUE,
    note_before TEXT NOT NULL DEFAULT '',
    note_after TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    related_document_id TEXT,
    proforma_deduction_minor BIGINT NOT NULL DEFAULT 0,
    recurring_id TEXT,
    exported_at TEXT,
    supplier_snapshot_json TEXT NOT NULL,
    customer_snapshot_json TEXT NOT NULL,
    bank_snapshot_json TEXT NOT NULL,
    subtotal_minor BIGINT NOT NULL DEFAULT 0,
    vat_total_minor BIGINT NOT NULL DEFAULT 0,
    rounding_minor BIGINT NOT NULL DEFAULT 0,
    total_minor BIGINT NOT NULL DEFAULT 0,
    paid_minor BIGINT NOT NULL DEFAULT 0,
    spayd_string TEXT NOT NULL DEFAULT '',
    issued_at TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quote_status TEXT NOT NULL DEFAULT 'open'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate_milli BIGINT NOT NULL DEFAULT 1000`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS print_language TEXT NOT NULL DEFAULT 'cs'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS price_type TEXT NOT NULL DEFAULT 'without_vat'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS related_document_id TEXT`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS proforma_deduction_minor BIGINT NOT NULL DEFAULT 0`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recurring_id TEXT`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exported_at TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number_idx ON invoices(company_id, number)`,
  `CREATE INDEX IF NOT EXISTS invoices_company_issue_idx ON invoices(company_id, issue_date)`,
  `CREATE INDEX IF NOT EXISTS invoices_contact_idx ON invoices(contact_id)`,
  `CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY NOT NULL,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    quantity_milli BIGINT NOT NULL DEFAULT 1000,
    unit TEXT NOT NULL DEFAULT 'ks',
    unit_price_minor BIGINT NOT NULL DEFAULT 0,
    price_type TEXT NOT NULL DEFAULT 'without_vat',
    catalog_item_id TEXT,
    vat_rate INTEGER NOT NULL DEFAULT 21,
    subtotal_minor BIGINT NOT NULL DEFAULT 0,
    vat_minor BIGINT NOT NULL DEFAULT 0,
    total_minor BIGINT NOT NULL DEFAULT 0
  )`,
  `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS price_type TEXT NOT NULL DEFAULT 'without_vat'`,
  `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS catalog_item_id TEXT`,
  `CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON invoice_items(invoice_id)`,
  `CREATE TABLE IF NOT EXISTS document_attachments (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    owner_type TEXT NOT NULL DEFAULT 'invoice',
    owner_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_base64 TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS doc_attachments_owner_idx ON document_attachments(owner_type, owner_id)`,
  `CREATE TABLE IF NOT EXISTS invoice_templates (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'invoice',
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    customer_snapshot_json TEXT NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    due_days INTEGER NOT NULL DEFAULT 14,
    payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
    currency TEXT NOT NULL DEFAULT 'CZK',
    vat_mode TEXT NOT NULL DEFAULT 'standard',
    price_type TEXT NOT NULL DEFAULT 'without_vat',
    discount_percent INTEGER NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL DEFAULT '[]',
    note_before TEXT NOT NULL DEFAULT '',
    note_after TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS invoice_templates_company_idx ON invoice_templates(company_id)`,
  `CREATE TABLE IF NOT EXISTS recurring_invoices (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'invoice',
    contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    customer_snapshot_json TEXT NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    frequency TEXT NOT NULL DEFAULT 'monthly',
    interval_count INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    next_run_date TEXT NOT NULL,
    end_date TEXT,
    due_days INTEGER NOT NULL DEFAULT 14,
    currency TEXT NOT NULL DEFAULT 'CZK',
    vat_mode TEXT NOT NULL DEFAULT 'standard',
    discount_percent INTEGER NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL DEFAULT '[]',
    send_email BOOLEAN NOT NULL DEFAULT FALSE,
    send_to_accountant BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS recurring_invoices_company_idx ON recurring_invoices(company_id)`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS sequence_id TEXT`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS order_number TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS issue_last_day_of_month BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS end_mode TEXT NOT NULL DEFAULT 'never'`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS max_occurrences INTEGER`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS issued_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS duzp_mode TEXT NOT NULL DEFAULT 'issue_date'`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'bank_transfer'`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS bank_account_id TEXT`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS constant_symbol TEXT NOT NULL DEFAULT '0308'`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS price_type TEXT NOT NULL DEFAULT 'without_vat'`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS print_language TEXT NOT NULL DEFAULT 'cs'`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS note_before TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS note_after TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS internal_note TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS tags_json TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS send_copy_to_self BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE recurring_invoices ADD COLUMN IF NOT EXISTS send_to_other_emails TEXT NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS email_logs (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    document_id TEXT,
    document_number TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'invoice',
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    sent_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS email_logs_company_idx ON email_logs(company_id)`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL DEFAULT 'received_invoice',
    number TEXT NOT NULL,
    external_number TEXT NOT NULL DEFAULT '',
    supplier_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
    supplier_snapshot_json TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    received_date TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    duzp TEXT NOT NULL,
    due_date TEXT NOT NULL,
    variable_symbol TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
    currency TEXT NOT NULL DEFAULT 'CZK',
    vat_mode TEXT NOT NULL DEFAULT 'standard',
    subtotal_minor BIGINT NOT NULL DEFAULT 0,
    vat_total_minor BIGINT NOT NULL DEFAULT 0,
    total_minor BIGINT NOT NULL DEFAULT 0,
    paid_minor BIGINT NOT NULL DEFAULT 0,
    paid_at TEXT,
    items_json TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS purchases_company_idx ON purchases(company_id)`,
  `CREATE TABLE IF NOT EXISTS inbox_items (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    content_base64 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    extracted_json TEXT NOT NULL DEFAULT '{}',
    converted_purchase_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS inbox_items_company_idx ON inbox_items(company_id)`,
  `CREATE TABLE IF NOT EXISTS catalog_items (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    ean TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'ks',
    unit_price_minor BIGINT NOT NULL DEFAULT 0,
    price_type TEXT NOT NULL DEFAULT 'without_vat',
    vat_rate INTEGER NOT NULL DEFAULT 21,
    currency TEXT NOT NULL DEFAULT 'CZK',
    track_stock BOOLEAN NOT NULL DEFAULT FALSE,
    stock_quantity_milli BIGINT NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS catalog_items_company_idx ON catalog_items(company_id)`,
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    catalog_item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
    direction TEXT NOT NULL DEFAULT 'in',
    quantity_milli BIGINT NOT NULL,
    unit_price_minor BIGINT NOT NULL DEFAULT 0,
    source_doc_type TEXT NOT NULL DEFAULT 'manual',
    source_doc_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    moved_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS stock_movements_company_idx ON stock_movements(company_id)`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    direction TEXT NOT NULL DEFAULT 'in',
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CZK',
    paid_at TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'bank_transfer',
    variable_symbol TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in'`,
  `CREATE INDEX IF NOT EXISTS payments_company_idx ON payments(company_id)`,
  `CREATE TABLE IF NOT EXISTS payment_allocations (
    id TEXT PRIMARY KEY NOT NULL,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount_minor BIGINT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS payment_allocations_invoice_idx ON payment_allocations(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS payment_allocations_payment_idx ON payment_allocations(payment_id)`,
  `CREATE TABLE IF NOT EXISTS bank_transactions (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
    direction TEXT NOT NULL DEFAULT 'credit',
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CZK',
    booked_at TEXT NOT NULL,
    counterparty_name TEXT NOT NULL DEFAULT '',
    counterparty_account TEXT NOT NULL DEFAULT '',
    variable_symbol TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    match_status TEXT NOT NULL DEFAULT 'unmatched',
    matched_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    matched_purchase_id TEXT REFERENCES purchases(id) ON DELETE SET NULL,
    payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bank_transactions_company_idx ON bank_transactions(company_id)`,
  `CREATE TABLE IF NOT EXISTS cash_registers (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CZK',
    initial_balance_minor BIGINT NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS cash_registers_company_idx ON cash_registers(company_id)`,
  `CREATE TABLE IF NOT EXISTS cash_vouchers (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    cash_register_id TEXT NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'in',
    amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CZK',
    issued_at TEXT NOT NULL,
    counterparty_name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
    purchase_id TEXT REFERENCES purchases(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS cash_vouchers_company_idx ON cash_vouchers(company_id)`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash)`,
  `CREATE INDEX IF NOT EXISTS api_keys_company_idx ON api_keys(company_id)`,
];

const SCHEMA_VERSION = 3;

export function ensureDatabaseReady(): Promise<void> {
  if (!globalForDb.__manymySchemaInit) {
    globalForDb.__manymySchemaInit = (async () => {
      const sql = getSqlClient();
      // Fast path: check if schema is already at SCHEMA_VERSION without acquiring DDL locks
      try {
        const rows = await sql.unsafe(
          `SELECT version FROM manymy_schema_meta WHERE version = ${SCHEMA_VERSION} LIMIT 1`,
        );
        if (rows.length > 0) return;
      } catch {
        // Table doesn't exist yet — proceed to locked bootstrap
      }

      await sql.begin(async (tx) => {
        await tx.unsafe("SELECT pg_advisory_xact_lock(88421019)");
        await tx.unsafe(
          `CREATE TABLE IF NOT EXISTS manymy_schema_meta (
            version INTEGER PRIMARY KEY NOT NULL,
            applied_at TEXT NOT NULL
          )`,
        );
        const existing = await tx.unsafe(
          `SELECT version FROM manymy_schema_meta WHERE version = ${SCHEMA_VERSION} LIMIT 1`,
        );
        if (existing.length > 0) return;

        for (const stmt of BOOTSTRAP_STATEMENTS) {
          await tx.unsafe(stmt);
        }
        await tx.unsafe(
          `INSERT INTO manymy_schema_meta (version, applied_at) VALUES (${SCHEMA_VERSION}, $1) ON CONFLICT (version) DO NOTHING`,
          [new Date().toISOString()],
        );
      });
    })().catch((err) => {
      globalForDb.__manymySchemaInit = undefined;
      throw err;
    });
  }
  return globalForDb.__manymySchemaInit;
}
