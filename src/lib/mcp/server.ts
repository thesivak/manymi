import crypto from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, ensureDatabaseReady } from "@/db";
import {
  apiKeys,
  bankAccounts,
  companies,
  contacts,
  invoiceItems,
  invoices,
  numberSequences,
  paymentAllocations,
  payments,
  type Company,
} from "@/db/schema";
import {
  addDaysIso,
  buildSpayd,
  czechAccountToIban,
  extractVariableSymbol,
  formatInvoiceNumber,
  todayIso,
} from "@/lib/domain/czech";
import { lookupAresByIco } from "@/lib/domain/ares";
import { deriveInvoiceStatus } from "@/lib/domain/invoice-status";
import { calculateInvoiceTotals, formatCzk, type VatMode } from "@/lib/domain/money";

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const randomPart = crypto.randomBytes(24).toString("base64url");
  const rawKey = `mnm_live_${randomPart}`;
  return {
    rawKey,
    keyPrefix: rawKey.slice(0, 16),
    keyHash: hashApiKey(rawKey),
  };
}

export async function authenticateMcpBearer(
  authHeader: string | null,
): Promise<{ company: Company; apiKeyId: string } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const rawKey = authHeader.slice("Bearer ".length).trim();
  if (!rawKey) return null;

  await ensureDatabaseReady();
  const hash = hashApiKey(rawKey);
  const rows = await db
    .select({
      keyId: apiKeys.id,
      company: companies,
    })
    .from(apiKeys)
    .innerJoin(companies, eq(apiKeys.companyId, companies.id))
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));

  const match = rows[0];
  if (!match) return null;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiKeys.id, match.keyId));

  return { company: match.company, apiKeyId: match.keyId };
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "get_dashboard_summary",
    description:
      "Vrátí finanční přehled aktivní firmy v Manymi: fakturaci za aktuální měsíc, neuhrazené pohledávky, faktury po splatnosti, celkový obrat za rok a informativní součet DPH na výstupu.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_invoices",
    description:
      "Vypíše vydané faktury a koncepty firmy. Umožňuje filtrovat podle stavu (draft, sent, partial, overdue, paid, cancelled) a hledat podle čísla, odběratele nebo IČO.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "draft", "sent", "partial", "overdue", "paid", "cancelled"],
          description: "Filtr stavu faktury (výchozí: all).",
        },
        search: {
          type: "string",
          description: "Textové hledání v čísle dokladu, názvu odběratele nebo IČO.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximální počet vrácených faktur (výchozí: 25).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_invoice",
    description:
      "Vrátí kompletní detail jedné faktury podle ID nebo čísla faktury (položky, součty, odběratel, SPAYD QR řetězec, historie úhrad a cesta k PDF).",
    inputSchema: {
      type: "object",
      properties: {
        invoiceId: { type: "string", description: "UUID faktury." },
        number: { type: "string", description: "Číslo faktury (např. 2026-0017)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_invoice",
    description:
      "Vytvoří novou fakturu (vystaví nebo uloží jako koncept) s automatickým číslováním z číselné řady, volitelným načtením odběratele z ARES podle IČO, výpočtem DPH a SPAYD QR kódem.",
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        action: {
          type: "string",
          enum: ["issue", "draft"],
          description: "issue = rovnou vystavit (výchozí), draft = uložit jako koncept.",
        },
        customerIco: {
          type: "string",
          description: "8místné české IČO odběratele — pokud není zadán název, údaje se načtou živě z ARES.",
        },
        customerName: {
          type: "string",
          description: "Název odběratele (povinný, pokud není zadáno platné customerIco).",
        },
        customerEmail: { type: "string" },
        dueDays: {
          type: "integer",
          minimum: 0,
          maximum: 365,
          description: "Splatnost ve dnech (výchozí dle nastavení firmy).",
        },
        vatMode: {
          type: "string",
          enum: ["standard", "reverse_charge", "non_vat"],
          description: "Režim DPH (výchozí dle nastavení firmy).",
        },
        discountPercent: { type: "integer", minimum: 0, maximum: 100 },
        roundToWhole: { type: "boolean" },
        noteAfter: { type: "string" },
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["description", "unitPriceCzk"],
            properties: {
              description: { type: "string" },
              quantity: { type: "number", description: "Množství (výchozí 1)." },
              unit: { type: "string", description: "Jednotka (výchozí ks)." },
              unitPriceCzk: { type: "number", description: "Jednotková cena bez DPH v Kč." },
              vatRate: { type: "integer", enum: [0, 12, 21], description: "Sazba DPH (výchozí 21)." },
            },
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "record_payment",
    description:
      "Zapíše plnou nebo částečnou úhradu k vystavené faktuře (podle invoiceId nebo čísla faktury).",
    inputSchema: {
      type: "object",
      required: ["amountCzk"],
      properties: {
        invoiceId: { type: "string" },
        number: { type: "string" },
        amountCzk: { type: "number", description: "Uhrazená částka v Kč (např. 12100.50)." },
        paidAt: { type: "string", description: "Datum úhrady YYYY-MM-DD (výchozí dnes)." },
        method: { type: "string", enum: ["bank_transfer", "cash", "card"] },
        note: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_contacts",
    description: "Vrátí adresář odběratelů firmy včetně jejich IČO, DIČ, adresy a celkového obratu.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Volitelné hledání podle názvu nebo IČO." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lookup_ares",
    description:
      "Ověří české IČO (modulo 11) a načte aktuální údaje subjektu z veřejného registru ARES MFČR.",
    inputSchema: {
      type: "object",
      required: ["ico"],
      properties: {
        ico: { type: "string", description: "8místné české IČO (např. 27082440)." },
      },
      additionalProperties: false,
    },
  },
];

export async function callMcpTool(
  company: Company,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await executeMcpTool(company, name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : "Chyba při vykonání MCP nástroje.",
        },
      ],
    };
  }
}

async function executeMcpTool(
  company: Company,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const today = todayIso();

  switch (name) {
    case "get_dashboard_summary": {
      const currentYear = today.slice(0, 4);
      const currentMonth = today.slice(0, 7);
      const rows = await db
        .select()
        .from(invoices)
        .where(eq(invoices.companyId, company.id));

      const issued = rows.filter((r) => r.status === "issued");
      const monthRows = issued.filter((r) => r.issueDate.startsWith(currentMonth));
      const yearRows = issued.filter((r) => r.issueDate.startsWith(`${currentYear}-`));

      let unpaidMinor = 0;
      let unpaidCount = 0;
      let overdueMinor = 0;
      let overdueCount = 0;

      for (const inv of issued) {
        const st = deriveInvoiceStatus(inv, today);
        if (st.remainingMinor > 0) {
          unpaidMinor += st.remainingMinor;
          unpaidCount += 1;
        }
        if (st.derived === "overdue") {
          overdueMinor += st.remainingMinor;
          overdueCount += 1;
        }
      }

      const monthMinor = monthRows.reduce((a, r) => a + r.totalMinor, 0);
      const monthVatMinor = monthRows.reduce((a, r) => a + r.vatTotalMinor, 0);
      const yearMinor = yearRows.reduce((a, r) => a + r.totalMinor, 0);

      return {
        company: { id: company.id, name: company.name, ico: company.ico, vatPayer: company.vatPayer },
        asOf: today,
        thisMonth: {
          count: monthRows.length,
          totalCzk: monthMinor / 100,
          formatted: formatCzk(monthMinor),
          vatOutputCzk: monthVatMinor / 100,
        },
        unpaid: { count: unpaidCount, totalCzk: unpaidMinor / 100, formatted: formatCzk(unpaidMinor) },
        overdue: { count: overdueCount, totalCzk: overdueMinor / 100, formatted: formatCzk(overdueMinor) },
        thisYear: { count: yearRows.length, totalCzk: yearMinor / 100, formatted: formatCzk(yearMinor) },
      };
    }

    case "list_invoices": {
      const statusFilter = typeof args.status === "string" ? args.status : "all";
      const search = typeof args.search === "string" ? args.search.trim().toLowerCase() : "";
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 25));

      const rows = await db
        .select()
        .from(invoices)
        .where(eq(invoices.companyId, company.id))
        .orderBy(desc(invoices.issueDate), desc(invoices.createdAt));

      const mapped = rows
        .map((inv) => {
          const customer = JSON.parse(inv.customerSnapshotJson) as { name?: string; ico?: string };
          const derived = deriveInvoiceStatus(inv, today);
          return {
            id: inv.id,
            number: inv.number,
            customerName: customer.name ?? "",
            customerIco: customer.ico ?? "",
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            totalCzk: inv.totalMinor / 100,
            paidCzk: inv.paidMinor / 100,
            remainingCzk: derived.remainingMinor / 100,
            currency: inv.currency,
            status: derived.derived,
            statusLabel: derived.label,
            dueSubtext: derived.dueSubtext,
            pdfPath: `/api/invoices/${inv.id}/pdf`,
          };
        })
        .filter((r) => {
          if (statusFilter !== "all" && r.status !== statusFilter) return false;
          if (!search) return true;
          return (
            r.number.toLowerCase().includes(search) ||
            r.customerName.toLowerCase().includes(search) ||
            r.customerIco.includes(search)
          );
        })
        .slice(0, limit);

      return { count: mapped.length, invoices: mapped };
    }

    case "get_invoice": {
      const invoiceId = typeof args.invoiceId === "string" ? args.invoiceId : "";
      const number = typeof args.number === "string" ? args.number.trim() : "";
      if (!invoiceId && !number) {
        throw new Error("Zadejte buď invoiceId, nebo number.");
      }

      const [inv] = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, company.id),
            invoiceId ? eq(invoices.id, invoiceId) : eq(invoices.number, number),
          ),
        );
      if (!inv) throw new Error("Faktura nebyla nalezena.");

      const [items, allocs] = await Promise.all([
        db
          .select()
          .from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, inv.id))
          .orderBy(asc(invoiceItems.position)),
        db
          .select({
            paymentId: payments.id,
            amountMinor: paymentAllocations.amountMinor,
            paidAt: payments.paidAt,
            method: payments.method,
            note: payments.note,
          })
          .from(paymentAllocations)
          .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
          .where(eq(paymentAllocations.invoiceId, inv.id)),
      ]);

      const derived = deriveInvoiceStatus(inv, today);
      return {
        id: inv.id,
        number: inv.number,
        status: derived.derived,
        statusLabel: derived.label,
        issueDate: inv.issueDate,
        duzp: inv.duzp,
        dueDate: inv.dueDate,
        variableSymbol: inv.variableSymbol,
        spaydString: inv.spaydString,
        subtotalCzk: inv.subtotalMinor / 100,
        vatTotalCzk: inv.vatTotalMinor / 100,
        totalCzk: inv.totalMinor / 100,
        paidCzk: inv.paidMinor / 100,
        remainingCzk: derived.remainingMinor / 100,
        currency: inv.currency,
        customer: JSON.parse(inv.customerSnapshotJson),
        bank: JSON.parse(inv.bankSnapshotJson),
        items: items.map((it) => ({
          description: it.description,
          quantity: it.quantityMilli / 1000,
          unit: it.unit,
          unitPriceCzk: it.unitPriceMinor / 100,
          vatRate: it.vatRate,
          subtotalCzk: it.subtotalMinor / 100,
        })),
        payments: allocs.map((a) => ({
          paymentId: a.paymentId,
          amountCzk: a.amountMinor / 100,
          paidAt: a.paidAt,
          method: a.method,
          note: a.note,
        })),
        pdfPath: `/api/invoices/${inv.id}/pdf`,
      };
    }

    case "create_invoice": {
      const rawItems = Array.isArray(args.items) ? args.items : [];
      if (rawItems.length === 0) {
        throw new Error("Zadejte alespoň jednu položku v poli items.");
      }

      const customerIco = typeof args.customerIco === "string" ? args.customerIco.trim() : "";
      let customer = {
        name: typeof args.customerName === "string" ? args.customerName.trim() : "",
        ico: customerIco,
        dic: "",
        vatPayer: false,
        street: "",
        city: "",
        zip: "",
        country: "Česká republika",
        email: typeof args.customerEmail === "string" ? args.customerEmail.trim() : "",
      };

      if (customerIco && !customer.name) {
        const ares = await lookupAresByIco(customerIco);
        customer = {
          name: ares.name,
          ico: ares.ico,
          dic: ares.dic,
          vatPayer: ares.vatPayer,
          street: ares.street,
          city: ares.city,
          zip: ares.zip,
          country: ares.country,
          email: customer.email,
        };
      }
      if (!customer.name) {
        throw new Error("Zadejte customerName nebo platné customerIco (pro načtení z ARES).");
      }

      const [accounts, seqs] = await Promise.all([
        db.select().from(bankAccounts).where(eq(bankAccounts.companyId, company.id)),
        db
          .select()
          .from(numberSequences)
          .where(and(eq(numberSequences.companyId, company.id), eq(numberSequences.docType, "invoice"))),
      ]);

      const bank = accounts.find((b) => b.isDefault) ?? accounts[0];
      const seq = seqs.find((s) => s.isDefault) ?? seqs[0];
      const year = Number(today.slice(0, 4));
      let number = `${year}-0001`;
      if (seq) {
        number = formatInvoiceNumber(seq.prefix, seq.year, seq.nextNumber, seq.padding);
        await db
          .update(numberSequences)
          .set({ nextNumber: seq.nextNumber + 1 })
          .where(eq(numberSequences.id, seq.id));
      }

      const dueDays =
        typeof args.dueDays === "number" ? args.dueDays : company.defaultDueDays;
      const dueDate = addDaysIso(today, dueDays);
      const vatMode: VatMode = !company.vatPayer
        ? "non_vat"
        : ((args.vatMode as VatMode) ?? "standard");
      const discountPercent = Math.min(100, Math.max(0, Number(args.discountPercent) || 0));
      const roundToWhole =
        typeof args.roundToWhole === "boolean" ? args.roundToWhole : company.defaultRounding;

      const normalizedItems = rawItems.map((raw) => {
        const it = raw as Record<string, unknown>;
        return {
          description: String(it.description ?? "").trim() || "Položka",
          quantityMilli: Math.max(1, Math.round((Number(it.quantity) || 1) * 1000)),
          unit: typeof it.unit === "string" && it.unit.trim() ? it.unit.trim() : "ks",
          unitPriceMinor: Math.max(0, Math.round((Number(it.unitPriceCzk) || 0) * 100)),
          vatRate:
            it.vatRate === 0 || it.vatRate === 12 || it.vatRate === 21
              ? it.vatRate
              : company.defaultVatRate,
        };
      });

      const totals = calculateInvoiceTotals({
        items: normalizedItems,
        vatMode,
        roundToWhole,
        discountPercent,
      });

      const iban = bank ? bank.iban || czechAccountToIban(bank.accountNumber, bank.bankCode) : "";
      const vs = extractVariableSymbol(number);
      const spayd =
        iban && totals.totalMinor > 0
          ? buildSpayd({
              iban,
              amountMinor: totals.totalMinor,
              currency: company.defaultCurrency || "CZK",
              dueDate,
              variableSymbol: vs,
              message: `Faktura ${number}`,
            })
          : "";

      const now = new Date().toISOString();
      const invoiceId = crypto.randomUUID();
      const status = args.action === "draft" ? "draft" : "issued";

      await db.insert(invoices).values({
        id: invoiceId,
        companyId: company.id,
        sequenceId: seq?.id ?? null,
        contactId: null,
        docType: "invoice",
        number,
        status,
        issueDate: today,
        duzp: today,
        dueDate,
        paymentMethod: "bank_transfer",
        variableSymbol: vs,
        constantSymbol: "0308",
        orderNumber: "",
        discountPercent,
        currency: company.defaultCurrency || "CZK",
        vatMode,
        roundToWhole,
        showQr: Boolean(iban),
        noteBefore: company.defaultNoteBefore,
        noteAfter:
          typeof args.noteAfter === "string"
            ? args.noteAfter
            : company.defaultNoteAfter || "Děkujeme za spolupráci.",
        supplierSnapshotJson: JSON.stringify({
          name: company.name,
          ico: company.ico,
          dic: company.dic,
          vatPayer: company.vatPayer,
          street: company.street,
          city: company.city,
          zip: company.zip,
          country: company.country,
          email: company.email,
          phone: company.phone,
          registryNote: company.registryNote,
        }),
        customerSnapshotJson: JSON.stringify(customer),
        bankSnapshotJson: JSON.stringify(
          bank
            ? {
                label: bank.label,
                accountNumber: bank.accountNumber,
                iban,
                swift: bank.swift,
              }
            : { label: "", accountNumber: "", iban: "", swift: "" },
        ),
        subtotalMinor: totals.subtotalMinor,
        vatTotalMinor: totals.vatTotalMinor,
        roundingMinor: totals.roundingMinor,
        totalMinor: totals.totalMinor,
        paidMinor: 0,
        spaydString: spayd,
        issuedAt: status === "issued" ? now : null,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });

      for (let i = 0; i < normalizedItems.length; i++) {
        const it = normalizedItems[i];
        const calc = totals.items[i];
        await db.insert(invoiceItems).values({
          id: crypto.randomUUID(),
          invoiceId,
          position: i,
          description: it.description,
          quantityMilli: it.quantityMilli,
          unit: it.unit,
          unitPriceMinor: it.unitPriceMinor,
          vatRate: calc.effectiveVatRate,
          subtotalMinor: calc.subtotalMinor,
          vatMinor: calc.vatMinor,
          totalMinor: calc.totalMinor,
        });
      }

      return {
        id: invoiceId,
        number,
        status,
        customerName: customer.name,
        dueDate,
        totalCzk: totals.totalMinor / 100,
        formattedTotal: formatCzk(totals.totalMinor),
        spaydString: spayd,
        pdfPath: `/api/invoices/${invoiceId}/pdf`,
      };
    }

    case "record_payment": {
      const invoiceId = typeof args.invoiceId === "string" ? args.invoiceId : "";
      const number = typeof args.number === "string" ? args.number.trim() : "";
      const amountMinor = Math.round((Number(args.amountCzk) || 0) * 100);
      if ((!invoiceId && !number) || amountMinor <= 0) {
        throw new Error("Zadejte invoiceId nebo number a kladnou částku amountCzk.");
      }

      const [inv] = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, company.id),
            invoiceId ? eq(invoices.id, invoiceId) : eq(invoices.number, number),
          ),
        );
      if (!inv) throw new Error("Faktura nebyla nalezena.");
      if (inv.status !== "issued") {
        throw new Error("Úhradu lze zapsat pouze k vystavené faktuře.");
      }

      const now = new Date().toISOString();
      const paidAt =
        typeof args.paidAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.paidAt)
          ? args.paidAt
          : today;
      const paymentId = crypto.randomUUID();
      await db.insert(payments).values({
        id: paymentId,
        companyId: company.id,
        amountMinor,
        currency: inv.currency,
        paidAt,
        method: typeof args.method === "string" ? args.method : "bank_transfer",
        variableSymbol: inv.variableSymbol,
        note: typeof args.note === "string" ? args.note : "Zapsáno přes MCP",
        createdAt: now,
      });
      await db.insert(paymentAllocations).values({
        id: crypto.randomUUID(),
        paymentId,
        invoiceId: inv.id,
        amountMinor,
        createdAt: now,
      });

      const allocs = await db
        .select({ amountMinor: paymentAllocations.amountMinor, paidAt: payments.paidAt })
        .from(paymentAllocations)
        .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
        .where(eq(paymentAllocations.invoiceId, inv.id));

      const paidMinor = allocs.reduce((a, x) => a + x.amountMinor, 0);
      const latestPaidAt = allocs.map((x) => x.paidAt).sort().at(-1) ?? paidAt;

      await db
        .update(invoices)
        .set({ paidMinor, paidAt: latestPaidAt, updatedAt: now })
        .where(eq(invoices.id, inv.id));

      const derived = deriveInvoiceStatus(
        { ...inv, paidMinor, paidAt: latestPaidAt },
        today,
      );

      return {
        ok: true,
        paymentId,
        invoiceNumber: inv.number,
        paidCzk: paidMinor / 100,
        remainingCzk: derived.remainingMinor / 100,
        status: derived.derived,
        statusLabel: derived.label,
      };
    }

    case "list_contacts": {
      const search = typeof args.search === "string" ? args.search.trim().toLowerCase() : "";
      const list = await db
        .select()
        .from(contacts)
        .where(eq(contacts.companyId, company.id))
        .orderBy(asc(contacts.name));

      const filtered = list
        .filter((c) => {
          if (!search) return true;
          return c.name.toLowerCase().includes(search) || c.ico.includes(search);
        })
        .map((c) => ({
          id: c.id,
          name: c.name,
          ico: c.ico,
          dic: c.dic,
          vatPayer: c.vatPayer,
          street: c.street,
          city: c.city,
          zip: c.zip,
          email: c.email,
        }));

      return { count: filtered.length, contacts: filtered };
    }

    case "lookup_ares": {
      const ico = typeof args.ico === "string" ? args.ico : "";
      return await lookupAresByIco(ico);
    }

    default:
      throw new Error(`Neznámý MCP nástroj: ${name}`);
  }
}

export async function handleMcpJsonRpc(
  company: Company,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const id = body.id ?? null;
  const method = typeof body.method === "string" ? body.method : "";
  const params = (body.params ?? {}) as Record<string, unknown>;

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "manymi-mcp",
          version: "1.0.0",
        },
      },
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: MCP_TOOLS },
    };
  }

  if (method === "tools/call") {
    const toolName = typeof params.name === "string" ? params.name : "";
    const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
    const result = await callMcpTool(company, toolName, toolArgs);
    return { jsonrpc: "2.0", id, result };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}
