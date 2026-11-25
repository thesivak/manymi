import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { lookupAresByIco } from "@/lib/domain/ares";

export async function GET(
  _req: Request,
  context: { params: Promise<{ ico: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: "Nepřihlášený uživatel." }, { status: 401 });
  }

  const { ico } = await context.params;
  try {
    const subject = await lookupAresByIco(ico);
    return NextResponse.json(
      { data: subject },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Nepodařilo se načíst údaje z ARES.";
    const status = message.includes("8 číslic") || message.includes("kontrolní součet") ? 400 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
