import { validateIco } from "./czech";

export interface AresSubjectResult {
  ico: string;
  name: string;
  dic: string;
  vatPayer: boolean;
  street: string;
  city: string;
  zip: string;
  country: string;
  verifiedAt: string;
}

interface CacheEntry {
  data: AresSubjectResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const aresCache = new Map<string, CacheEntry>();

function formatZip(psc: number | string | undefined): string {
  if (!psc) return "";
  const digits = String(psc).replace(/\D/g, "");
  if (digits.length === 5) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return digits;
}

function buildStreetFromAres(sidlo: Record<string, unknown> | undefined): string {
  if (!sidlo) return "";
  const ulice = typeof sidlo.nazevUlice === "string" ? sidlo.nazevUlice : "";
  const castObce = typeof sidlo.nazevCastiObce === "string" ? sidlo.nazevCastiObce : "";
  const cisloDomovni = sidlo.cisloDomovni != null ? String(sidlo.cisloDomovni) : "";
  const cisloOrientacni =
    sidlo.cisloOrientacni != null
      ? `${sidlo.cisloOrientacni}${typeof sidlo.cisloOrientacniPismeno === "string" ? sidlo.cisloOrientacniPismeno : ""}`
      : "";

  const numberPart =
    cisloDomovni && cisloOrientacni
      ? `${cisloDomovni}/${cisloOrientacni}`
      : cisloDomovni || cisloOrientacni;

  if (ulice && numberPart) return `${ulice} ${numberPart}`;
  if (ulice) return ulice;
  if (castObce && numberPart) return `${castObce} ${numberPart}`;

  if (typeof sidlo.textovaAdresa === "string") {
    return sidlo.textovaAdresa.split(",")[0]?.trim() ?? "";
  }
  return "";
}

export async function lookupAresByIco(rawIco: string): Promise<AresSubjectResult> {
  const check = validateIco(rawIco);
  if (!check.valid) {
    throw new Error(check.error ?? "Neplatné IČO.");
  }

  const ico = check.normalized;
  const cached = aresCache.get(ico);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (res.status === 404) {
      throw new Error(`Subjekt s IČO ${ico} jsme v ARES nenašli. Vyplňte údaje ručně.`);
    }
    if (!res.ok) {
      throw new Error(`ARES momentálně neodpovídá (HTTP ${res.status}). Zkuste to za chvíli.`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const sidlo = (body.sidlo ?? {}) as Record<string, unknown>;
    const dic = typeof body.dic === "string" ? body.dic.trim() : "";
    const registrace = (body.seznamRegistraci ?? {}) as Record<string, unknown>;
    const dphReg = typeof registrace.stavZdrojeDph === "string" ? registrace.stavZdrojeDph : "";
    const vatPayer = dphReg === "AKTIVNI" || Boolean(dic);

    const result: AresSubjectResult = {
      ico,
      name: typeof body.obchodniJmeno === "string" ? body.obchodniJmeno.trim() : "",
      dic,
      vatPayer,
      street: buildStreetFromAres(sidlo),
      city: typeof sidlo.nazevObce === "string" ? sidlo.nazevObce.trim() : "",
      zip: formatZip(sidlo.psc as number | string | undefined),
      country:
        typeof sidlo.nazevStatu === "string" && sidlo.nazevStatu.trim()
          ? sidlo.nazevStatu.trim()
          : "Česká republika",
      verifiedAt: new Date().toISOString(),
    };

    aresCache.set(ico, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Spojení s ARES vypršelo. Zkuste to znovu nebo vyplňte údaje ručně.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
