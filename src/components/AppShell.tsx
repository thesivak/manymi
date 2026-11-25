"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Building2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CompanySummary {
  id: string;
  name: string;
  ico: string;
  dic: string;
  vatPayer: boolean;
  vatPeriod: string;
}

interface AppShellProps {
  activeCompany: CompanySummary;
  companies: CompanySummary[];
  todayLabel: string;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/", label: "Přehled" },
  { href: "/faktury", label: "Prodej" },
  { href: "/nakup", label: "Nákup" },
  { href: "/cenik", label: "Ceník" },
  { href: "/finance", label: "Finance" },
  { href: "/kontakty", label: "Kontakty" },
];

export function AppShell({
  activeCompany,
  companies,
  todayLabel,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [, startTransition] = useTransition();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  async function handleSwitchCompany(companyId: string) {
    if (companyId === activeCompany.id) return;
    setSwitching(true);
    try {
      await fetch("/api/companies/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      startTransition(() => {
        if (pathname.startsWith("/faktury/") && pathname !== "/faktury/nova") {
          router.push("/faktury");
        }
        router.refresh();
      });
    } finally {
      setSwitching(false);
    }
  }

  const vatLabel = !activeCompany.vatPayer
    ? "neplátce DPH"
    : activeCompany.vatPeriod === "quarterly"
      ? "čtvrtletní plátce DPH"
      : "měsíční plátce DPH";

  const isOnboardingDashboard = pathname === "/" && !activeCompany.ico.trim();
  const isNewInvoicePage = pathname === "/faktury/nova";
  const hasOwnPrimaryCta =
    pathname === "/" ||
    pathname === "/nakup" ||
    pathname === "/cenik" ||
    pathname === "/finance" ||
    pathname === "/kontakty" ||
    pathname === "/nastaveni" ||
    (pathname.startsWith("/faktury/") && pathname !== "/faktury");

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-xs no-print">
        <div className="container flex min-h-16 items-center justify-between gap-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 text-foreground no-underline shrink-0"
            aria-label="Manymi — Přehled"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 2h11l5 5v15H4V2z" fill="#0B1220" />
              <path d="M15 2v5h5" fill="#FFFFFF" />
              <rect x="7" y="11" width="10" height="2" fill="#FFFFFF" />
              <rect x="7" y="15" width="6" height="2" fill="#FFFFFF" />
            </svg>
            <span className="brand__word">manymi</span>
          </Link>

          <nav className="mainnav" aria-label="Hlavní navigace">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                aria-current={isActive(item.href) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/nastaveni"
              prefetch={true}
              className={cn(
                "text-sm font-medium no-underline transition-colors",
                isActive("/nastaveni")
                  ? "text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive("/nastaveni") ? "page" : undefined}
            >
              Nastavení
            </Link>
            {!isNewInvoicePage && !isOnboardingDashboard && (
              <Button
                asChild
                variant={hasOwnPrimaryCta ? "outline" : "default"}
                size="sm"
                className="h-9 px-3.5"
              >
                <Link href="/faktury/nova" prefetch={true}>
                  <Plus className="size-3.5" />
                  Nová faktura
                </Link>
              </Button>
            )}
            <div className="clerk-mono-avatar">
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: {
                      width: "34px",
                      height: "34px",
                      borderRadius: "9999px",
                      border: "1px solid #D1D5DB",
                    },
                  },
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="border-b border-border bg-background no-print">
        <div className="container flex min-h-11 flex-wrap items-center justify-between gap-3 py-2 text-[13.5px]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {companies.length > 1 ? (
                <select
                  aria-label="Aktivní firma"
                  className="company-select"
                  value={activeCompany.id}
                  disabled={switching}
                  onChange={(e) => handleSwitchCompany(e.target.value)}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.ico ? ` (${c.ico})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <strong className="font-semibold">{activeCompany.name}</strong>
              )}
            </span>
            <span className="text-muted-foreground num">
              {[
                activeCompany.ico ? `IČO ${activeCompany.ico}` : "Firma zatím bez IČO",
                activeCompany.vatPayer && activeCompany.dic
                  ? `DIČ ${activeCompany.dic}`
                  : null,
                activeCompany.ico ? vatLabel : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <Link
              href="/nastaveni?tab=companies"
              prefetch={true}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Plus className="size-3" />
              Přidat firmu
            </Link>
          </div>
          <span className="text-muted-foreground">{todayLabel}</span>
        </div>
      </div>

      <main key={activeCompany.id}>{children}</main>

      <footer className="footer no-print">
        <div className="container footer__in">
          <span>Manymi · česká fakturace pro OSVČ a malé firmy</span>
          <span>ARES · SPAYD QR · A4 PDF</span>
        </div>
      </footer>
    </>
  );
}
