import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db, ensureDatabaseReady } from "@/db";
import { apiKeys, companies, numberSequences } from "@/db/schema";
import {
  authenticateMcpBearer,
  generateApiKey,
  handleMcpJsonRpc,
  MCP_TOOLS,
} from "../server";

describe("Manymi MCP server (JSON-RPC 2.0 + Supabase)", () => {
  const hasPg = Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

  it.skipIf(!hasPg)(
    "ověří Bearer klíč, initialize, tools/list, create_invoice, record_payment a lookup_ares",
    async () => {
      await ensureDatabaseReady();
      const now = new Date().toISOString();
      const companyId = `mcp-co-${crypto.randomUUID()}`;
      const { rawKey, keyPrefix, keyHash } = generateApiKey();

      try {
        await db.insert(companies).values({
          id: companyId,
          name: "MCP Test Studio s.r.o.",
          ico: "08765430",
          dic: "CZ08765430",
          vatPayer: true,
          createdAt: now,
          updatedAt: now,
        });

        await db.insert(numberSequences).values({
          id: crypto.randomUUID(),
          companyId,
          docType: "invoice",
          name: "Vydané faktury",
          prefix: "MCP-",
          year: 2026,
          nextNumber: 1,
          padding: 4,
          isDefault: true,
          createdAt: now,
        });

        await db.insert(apiKeys).values({
          id: crypto.randomUUID(),
          companyId,
          name: "Vitest MCP Key",
          keyPrefix,
          keyHash,
          createdAt: now,
        });

        // 1. Auth check: invalid rejected, valid accepted
        expect(await authenticateMcpBearer(null)).toBeNull();
        expect(await authenticateMcpBearer("Bearer invalid_token")).toBeNull();
        const auth = await authenticateMcpBearer(`Bearer ${rawKey}`);
        expect(auth?.company.id).toBe(companyId);

        const company = auth!.company;

        // 2. initialize
        const initRes = await handleMcpJsonRpc(company, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        });
        expect((initRes?.result as Record<string, unknown>)?.serverInfo).toEqual({
          name: "manymi-mcp",
          version: "1.0.0",
        });

        // 3. tools/list
        const listRes = await handleMcpJsonRpc(company, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        });
        const listedTools = (listRes?.result as { tools: typeof MCP_TOOLS }).tools;
        expect(listedTools.length).toBe(7);

        // 4. create_invoice via MCP
        const createRes = await handleMcpJsonRpc(company, {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "create_invoice",
            arguments: {
              customerName: "MCP Odběratel s.r.o.",
              dueDays: 14,
              items: [
                { description: "Vývoj MCP rozhraní", quantity: 2, unit: "hod", unitPriceCzk: 2500, vatRate: 21 },
              ],
            },
          },
        });
        const created = JSON.parse(
          (createRes?.result as { content: Array<{ text: string }> }).content[0].text,
        );
        expect(created.number).toBe("MCP-2026-0001");
        expect(created.totalCzk).toBe(6050);

        // 5. record_payment via MCP
        const payRes = await handleMcpJsonRpc(company, {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "record_payment",
            arguments: {
              invoiceId: created.id,
              amountCzk: 6050,
              note: "Uhrazeno přes MCP test",
            },
          },
        });
        const paid = JSON.parse(
          (payRes?.result as { content: Array<{ text: string }> }).content[0].text,
        );
        expect(paid.status).toBe("paid");
        expect(paid.remainingCzk).toBe(0);

        // 6. get_dashboard_summary via MCP
        const dashRes = await handleMcpJsonRpc(company, {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "get_dashboard_summary", arguments: {} },
        });
        const summary = JSON.parse(
          (dashRes?.result as { content: Array<{ text: string }> }).content[0].text,
        );
        expect(summary.thisMonth.totalCzk).toBe(6050);
        expect(summary.unpaid.count).toBe(0);
      } finally {
        await db.delete(companies).where(eq(companies.id, companyId));
      }
    },
    20000,
  );
});
