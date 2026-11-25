import { NextResponse } from "next/server";
import { ensureDatabaseReady } from "@/db";
import { isClerkConfigured } from "@/lib/clerk-config";

export async function GET() {
  await ensureDatabaseReady();
  return NextResponse.json({
    ok: true,
    clerkConfigured: isClerkConfigured(),
    timestamp: new Date().toISOString(),
  });
}
