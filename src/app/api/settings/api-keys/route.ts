import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import { generateApiKey } from "@/lib/mcp/server";

const createKeySchema = z.object({
  name: z.string().trim().min(1, "Zadejte název klíče (např. Claude Desktop).").max(80),
});

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.companyId, ctx.activeCompany.id), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json({ data: keys });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Neplatný název klíče." },
      { status: 400 },
    );
  }

  const { rawKey, keyPrefix, keyHash } = generateApiKey();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(apiKeys).values({
    id,
    companyId: ctx.activeCompany.id,
    name: parsed.data.name,
    keyPrefix,
    keyHash,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: now,
  });

  return NextResponse.json(
    {
      id,
      name: parsed.data.name,
      keyPrefix,
      rawKey, // vráceno pouze jednou při vytvoření
      createdAt: now,
    },
    { status: 201 },
  );
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Chybí id klíče." }, { status: 400 });
  }

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.companyId, ctx.activeCompany.id)));

  return NextResponse.json({ ok: true });
}
