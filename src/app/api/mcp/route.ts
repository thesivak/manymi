import { NextResponse } from "next/server";
import {
  authenticateMcpBearer,
  handleMcpJsonRpc,
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
} from "@/lib/mcp/server";

export async function GET() {
  return NextResponse.json({
    name: "manymi-mcp",
    version: "1.0.0",
    protocolVersion: MCP_PROTOCOL_VERSION,
    transport: "streamable-http",
    auth: "Authorization: Bearer <manymi_api_key>",
    tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
}

export async function POST(req: Request) {
  const auth = await authenticateMcpBearer(req.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message:
            "Chybí nebo je neplatný Bearer API klíč. Vygenerujte jej v Manymi → Nastavení → MCP & API.",
        },
      },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid JSON-RPC 2.0 request." },
      },
      { status: 400 },
    );
  }

  const response = await handleMcpJsonRpc(auth.company, body);
  if (response === null) {
    return new NextResponse(null, { status: 202 });
  }

  return NextResponse.json(response);
}
