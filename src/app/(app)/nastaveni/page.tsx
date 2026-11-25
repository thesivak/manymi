import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  apiKeys,
  bankAccounts,
  companyInvitations,
  numberSequences,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { MCP_TOOLS } from "@/lib/mcp/server";
import { SettingsClient } from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const sp = await searchParams;
  const allowedTabs = ["company", "bank", "sequences", "export", "companies", "mcp"] as const;
  const initialTab = allowedTabs.includes(sp.tab as (typeof allowedTabs)[number])
    ? (sp.tab as (typeof allowedTabs)[number])
    : "company";

  const [accounts, sequences, keys, invitations] = await Promise.all([
    db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, ctx.activeCompany.id))
      .orderBy(asc(bankAccounts.createdAt)),
    db
      .select()
      .from(numberSequences)
      .where(eq(numberSequences.companyId, ctx.activeCompany.id))
      .orderBy(asc(numberSequences.year)),
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.companyId, ctx.activeCompany.id), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt)),
    db
      .select()
      .from(companyInvitations)
      .where(eq(companyInvitations.companyId, ctx.activeCompany.id))
      .orderBy(desc(companyInvitations.createdAt)),
  ]);

  return (
    <SettingsClient
      key={ctx.activeCompany.id}
      initialTab={initialTab}
      company={ctx.activeCompany}
      companies={ctx.companies}
      bankAccounts={accounts}
      sequences={sequences}
      apiKeys={keys}
      invitations={invitations}
      mcpTools={MCP_TOOLS.map((t) => ({ name: t.name, description: t.description }))}
    />
  );
}
