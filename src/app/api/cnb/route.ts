import { NextResponse } from "next/server";
import { getCnbExchangeRates } from "@/lib/domain/cnb";

export async function GET() {
  const data = await getCnbExchangeRates();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
