import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, purchases } from "@/db/schema";
import { getAuthContext } from "@/lib/auth";
import {
  czechMonthName,
  czechMonthShort,
  formatCzk,
  formatDateCz,
  formatShortDateCz,
  pluralCz,
} from "@/lib/domain/money";
import { deriveInvoiceStatus } from "@/lib/domain/invoice-status";
import { todayIso } from "@/lib/domain/czech";
import { StatusBadge } from "@/components/StatusBadge";
import { MonthlyRevenueChart, type MonthlyBarPoint } from "@/components/MonthlyRevenueChart";
import { CompanyOnboardingGuide } from "@/components/CompanyOnboardingGuide";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getAuthContext();
  if (!ctx) return null;

  const company = ctx.activeCompany;
  const today = todayIso();
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7)); // 1..12
  const currentDay = Number(today.slice(8, 10));
  const monthPrefix = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const prevMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
  const prevMonthPrefix = `${prevMonthDate.getUTCFullYear()}-${String(
    prevMonthDate.getUTCMonth() + 1,
  ).padStart(2, "0")}`;

  const [allInvoices, allPurchases] = await Promise.all([
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        vatTotalMinor: invoices.vatTotalMinor,
        paidMinor: invoices.paidMinor,
        customerSnapshotJson: invoices.customerSnapshotJson,
      })
      .from(invoices)
      .where(eq(invoices.companyId, company.id))
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt)),
    db
      .select({
        issueDate: purchases.issueDate,
        totalMinor: purchases.totalMinor,
        paidMinor: purchases.paidMinor,
      })
      .from(purchases)
      .where(eq(purchases.companyId, company.id)),
  ]);

  if (!company.ico.trim() && allInvoices.length === 0) {
    return <CompanyOnboardingGuide company={company} />;
  }

  const monthExpensesMinor = allPurchases
    .filter((p) => p.issueDate.startsWith(monthPrefix))
    .reduce((a, p) => a + p.totalMinor, 0);
  const unpaidPayablesMinor = allPurchases.reduce(
    (a, p) => a + Math.max(0, p.totalMinor - p.paidMinor),
    0,
  );

  const enriched = allInvoices.map((inv) => ({
    ...inv,
    customer: JSON.parse(inv.customerSnapshotJson) as { name: string; ico?: string },
    derived: deriveInvoiceStatus(inv, today),
  }));

  const activeIssued = enriched.filter((i) => i.status === "issued");

  const thisMonthIssued = activeIssued.filter((i) => i.issueDate.startsWith(monthPrefix));
  const prevMonthIssued = activeIssued.filter((i) => i.issueDate.startsWith(prevMonthPrefix));
  const thisYearIssued = activeIssued.filter((i) =>
    i.issueDate.startsWith(`${currentYear}-`),
  );

  const monthTotalMinor = thisMonthIssued.reduce((a, i) => a + i.totalMinor, 0);
  const monthVatOutputMinor = thisMonthIssued.reduce((a, i) => a + i.vatTotalMinor, 0);
  const prevMonthTotalMinor = prevMonthIssued.reduce((a, i) => a + i.totalMinor, 0);
  const yearTotalMinor = thisYearIssued.reduce((a, i) => a + i.totalMinor, 0);

  const unpaidInvoices = activeIssued.filter((i) => i.derived.remainingMinor > 0);
  const unpaidTotalMinor = unpaidInvoices.reduce((a, i) => a + i.derived.remainingMinor, 0);
  const overdueInvoices = activeIssued.filter((i) => i.derived.derived === "overdue");
  const overdueTotalMinor = overdueInvoices.reduce((a, i) => a + i.derived.remainingMinor, 0);

  const oldestOverdue = [...overdueInvoices].sort(
    (a, b) => b.derived.daysOverdue - a.derived.daysOverdue,
  )[0];
  const nextDueInvoice = [...unpaidInvoices]
    .filter((i) => i.derived.daysOverdue === 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  const uniqueCustomersThisMonth = new Set(
    thisMonthIssued.map((i) => i.customer.ico || i.customer.name),
  ).size;

  const monthPctChange =
    prevMonthTotalMinor > 0
      ? Math.round(((monthTotalMinor - prevMonthTotalMinor) / prevMonthTotalMinor) * 100)
      : null;

  const planMinor = Math.max(company.annualPlanMinor || 250000000, 100);
  const planRatio = Math.min(100, Math.round((yearTotalMinor / planMinor) * 100));
  const overdueShare =
    unpaidTotalMinor > 0 ? Math.round((overdueTotalMinor / unpaidTotalMinor) * 100) : 0;
  const monthMeterPct =
    prevMonthTotalMinor > 0
      ? Math.min(100, Math.round((monthTotalMinor / Math.max(prevMonthTotalMinor, monthTotalMinor)) * 100))
      : monthTotalMinor > 0
        ? 100
        : 0;
  const unpaidMeterPct =
    yearTotalMinor > 0
      ? Math.min(100, Math.round((unpaidTotalMinor / Math.max(monthTotalMinor, unpaidTotalMinor)) * 100))
      : 0;

  // Monthly chart points for currentYear
  const monthlyPoints: MonthlyBarPoint[] = Array.from({ length: 12 }, (_, idx) => {
    const mStr = `${currentYear}-${String(idx + 1).padStart(2, "0")}`;
    const rows = thisYearIssued.filter((i) => i.issueDate.startsWith(mStr));
    return {
      monthIndex: idx,
      shortLabel: czechMonthShort(idx),
      fullLabel: czechMonthName(idx),
      totalMinor: rows.reduce((a, r) => a + r.totalMinor, 0),
      count: rows.length,
      isFuture: idx + 1 > currentMonth,
      isCurrent: idx + 1 === currentMonth,
    };
  });

  const elapsedMonths = monthlyPoints.slice(0, currentMonth);
  const nonZeroElapsed = elapsedMonths.filter((m) => m.totalMinor > 0);
  const averageMinor =
    nonZeroElapsed.length > 0
      ? Math.round(
          nonZeroElapsed.reduce((a, m) => a + m.totalMinor, 0) / nonZeroElapsed.length,
        )
      : 0;

  const recentInvoices = enriched.slice(0, 6);
  const monthName = czechMonthName(currentMonth - 1);

  return (
    <div className="container">
      <section className="hero">
        <p className="eyebrow num">
          Přehled · {monthName.toLowerCase()} {currentYear} · stav k {formatShortDateCz(today)}
        </p>

        {allInvoices.length === 0 ? (
          <>
            <h1 className="display h-hero hero__title">
              Připraveno k fakturaci.
              <br />
              Zatím bez vystavených dokladů.
            </h1>
            <p className="lead hero__lead">
              Vystavte svou první fakturu s živým A4 náhledem, QR platbou a automatickým ověřením
              odběratele v ARES.
            </p>
            <div className="actions">
              <Button asChild size="lg">
                <Link href="/faktury/nova">Vystavit první fakturu</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="display h-hero hero__title num">
              {monthName}: {formatCzk(monthTotalMinor)} vyfakturováno.
              <br />
              {overdueTotalMinor > 0
                ? `${formatCzk(overdueTotalMinor)} je po splatnosti.`
                : "Všechny splatné faktury jsou v pořádku."}
            </h1>
            <p className="lead hero__lead">
              Za {currentDay} dní jste vystavili{" "}
              {pluralCz(thisMonthIssued.length, "fakturu", "faktury", "faktur")} pro{" "}
              {pluralCz(uniqueCustomersThisMonth, "odběratele", "odběratele", "odběratelů")}.{" "}
              {oldestOverdue
                ? `Po splatnosti ${
                    overdueInvoices.length >= 2 && overdueInvoices.length <= 4
                      ? "čekají"
                      : "čeká"
                  } ${pluralCz(overdueInvoices.length, "faktura", "faktury", "faktur")} — nejstarší ${pluralCz(
                    oldestOverdue.derived.daysOverdue,
                    "den",
                    "dny",
                    "dní",
                  )} (${oldestOverdue.customer.name}).`
                : "Žádná faktura není po splatnosti."}
            </p>
            <div className="actions">
              <Button asChild size="lg">
                <Link href="/faktury/nova">Vystavit fakturu</Link>
              </Button>
              {overdueInvoices.length > 0 ? (
                <Button asChild variant="link">
                  <Link href="/faktury?stav=overdue">
                    Zobrazit po splatnosti ({overdueInvoices.length})
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="link">
                  <Link href="/faktury">Přejít na faktury</Link>
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <Separator className="h-[1.5px] bg-foreground" />

      <section className="kpi-grid" aria-label="Klíčové ukazatele">
        <div className="kpi">
          <div className="kpi__label">Fakturováno tento měsíc</div>
          <div className="kpi__value num">
            {formatCzk(monthTotalMinor, { includeCurrency: false })}
            <span className="kpi__unit">Kč</span>
          </div>
          <div className="meter">
            <div className="meter__fill" style={{ width: `${monthMeterPct}%` }} />
          </div>
          <div className="kpi__meta num">
            {pluralCz(thisMonthIssued.length, "doklad", "doklady", "dokladů")}
            {monthPctChange !== null
              ? ` · ${monthPctChange >= 0 ? "+" : "\u2212"}${Math.abs(monthPctChange)}\u00A0% proti minulému měsíci`
              : ""}
          </div>
        </div>

        <div className="kpi">
          <div className="kpi__label">Čeká na úhradu</div>
          <div className="kpi__value num">
            {formatCzk(unpaidTotalMinor, { includeCurrency: false })}
            <span className="kpi__unit">Kč</span>
          </div>
          <div className="meter">
            <div className="meter__fill" style={{ width: `${unpaidMeterPct}%` }} />
          </div>
          <div className="kpi__meta num">
            {pluralCz(unpaidInvoices.length, "faktura", "faktury", "faktur")}
            {nextDueInvoice ? ` · nejbližší splatnost ${formatShortDateCz(nextDueInvoice.dueDate)}` : ""}
          </div>
        </div>

        <div className="kpi">
          <div className="kpi__label">
            <span className="dot dot--danger" aria-hidden="true" />
            Po splatnosti
          </div>
          <div className="kpi__value num">
            {formatCzk(overdueTotalMinor, { includeCurrency: false })}
            <span className="kpi__unit">Kč</span>
          </div>
          <div className="meter">
            <div className="meter__fill" style={{ width: `${overdueShare}%` }} />
          </div>
          <div className="kpi__meta num">
            {pluralCz(overdueInvoices.length, "faktura", "faktury", "faktur")} · {overdueShare} % neuhrazených
          </div>
        </div>

        <div className="kpi">
          <div className="kpi__label">Letos celkem</div>
          <div className="kpi__value num">
            {formatCzk(yearTotalMinor, { includeCurrency: false })}
            <span className="kpi__unit">Kč</span>
          </div>
          <div className="meter">
            <div className="meter__fill" style={{ width: `${planRatio}%` }} />
          </div>
          <div className="kpi__meta num">
            {planRatio} % ročního plánu {formatCzk(planMinor)}
          </div>
        </div>
      </section>

      <section className="section split">
        <div>
          <h2 className="display h2">
            Fakturace
            <br />
            po měsících
          </h2>
          <p className="text-2" style={{ marginTop: 16 }}>
            Částky včetně DPH podle data vystavení. Najetím na sloupec zobrazíte detail
            jednotlivého měsíce a počet vystavených dokladů.
          </p>

          {company.vatPayer ? (
            <Alert className="mt-6">
              <AlertTitle className="num">
                Bilance za {monthName.toLowerCase()}: {formatCzk(monthTotalMinor - monthExpensesMinor)}
              </AlertTitle>
              <AlertDescription className="num">
                Příjmy {formatCzk(monthTotalMinor)} · Náklady {formatCzk(monthExpensesMinor)} ·
                Neuhrazené závazky {formatCzk(unpaidPayablesMinor)} · Informativní DPH na výstupu{" "}
                {formatCzk(monthVatOutputMinor)}.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="mt-6">
              <AlertTitle>Režim neplátce DPH</AlertTitle>
              <AlertDescription>
                Firma je nastavena jako neplátce DPH. Vystavené faktury se generují bez vyčíslení
                daně s označením „Faktura“.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <MonthlyRevenueChart
          year={currentYear}
          points={monthlyPoints}
          averageMinor={averageMinor}
        />
      </section>

      <section className="section pt-6">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="h3">Poslední faktury</h2>
          <Button asChild variant="link">
            <Link href="/faktury">Zobrazit všechny faktury</Link>
          </Button>
        </div>

        {recentInvoices.length === 0 ? (
          <div className="rounded-[3px] border border-border bg-card p-8">
            <p className="text-sm text-muted-foreground">Zatím nemáte žádné faktury.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Odběratel</TableHead>
                <TableHead>Vystaveno</TableHead>
                <TableHead>Splatnost</TableHead>
                <TableHead className="text-right">Částka</TableHead>
                <TableHead>Stav</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentInvoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="num whitespace-nowrap">
                    <Link href={`/faktury/${inv.id}`} className="font-semibold hover:underline">
                      {inv.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/faktury/${inv.id}`} className="block font-semibold hover:underline">
                      {inv.customer.name}
                    </Link>
                    {inv.customer.ico && (
                      <span className="block text-xs text-muted-foreground num">
                        IČO {inv.customer.ico}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="num whitespace-nowrap">{formatDateCz(inv.issueDate)}</TableCell>
                  <TableCell className="num whitespace-nowrap">
                    {inv.status === "draft" ? "—" : formatDateCz(inv.dueDate)}
                    <span
                      className={`block text-xs ${
                        inv.derived.isDangerSubtext ? "font-medium text-destructive" : "text-muted-foreground"
                      }`}
                    >
                      {inv.derived.dueSubtext}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-bold num whitespace-nowrap">
                    {formatCzk(inv.totalMinor, { currency: inv.currency })}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={inv.derived.derived} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
