import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documentAttachments, invoices } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";

const MAX_FILES = 5;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB (parita s iDoklad limitem 5 × 2 MB)

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const { id } = await context.params;

  const list = await db
    .select({
      id: documentAttachments.id,
      filename: documentAttachments.filename,
      mimeType: documentAttachments.mimeType,
      sizeBytes: documentAttachments.sizeBytes,
      createdAt: documentAttachments.createdAt,
    })
    .from(documentAttachments)
    .where(
      and(
        eq(documentAttachments.companyId, ctx.activeCompany.id),
        eq(documentAttachments.ownerType, "invoice"),
        eq(documentAttachments.ownerId, id),
      ),
    )
    .orderBy(desc(documentAttachments.createdAt));

  return NextResponse.json({ data: list });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const { id } = await context.params;

  const [inv] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.activeCompany.id)));
  if (!inv) return NextResponse.json({ error: "Doklad nenalezen." }, { status: 404 });

  const existing = await db
    .select({ id: documentAttachments.id })
    .from(documentAttachments)
    .where(
      and(
        eq(documentAttachments.companyId, ctx.activeCompany.id),
        eq(documentAttachments.ownerType, "invoice"),
        eq(documentAttachments.ownerId, id),
      ),
    );
  if (existing.length >= MAX_FILES) {
    return NextResponse.json(
      { error: `K dokladu lze přiložit nejvýše ${MAX_FILES} příloh.` },
      { status: 400 },
    );
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nebyl přiložen žádný soubor." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Maximální velikost jedné přílohy je 2 MB." },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const attId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.insert(documentAttachments).values({
    id: attId,
    companyId: ctx.activeCompany.id,
    ownerType: "invoice",
    ownerId: id,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    contentBase64: buf.toString("base64"),
    createdAt: now,
  });

  return NextResponse.json(
    { id: attId, filename: file.name, sizeBytes: file.size, createdAt: now },
    { status: 201 },
  );
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  const { id } = await context.params;
  const attId = new URL(req.url).searchParams.get("attachmentId");
  if (!attId) return NextResponse.json({ error: "Chybí attachmentId." }, { status: 400 });

  await db
    .delete(documentAttachments)
    .where(
      and(
        eq(documentAttachments.id, attId),
        eq(documentAttachments.ownerId, id),
        eq(documentAttachments.companyId, ctx.activeCompany.id),
      ),
    );
  return NextResponse.json({ ok: true });
}
