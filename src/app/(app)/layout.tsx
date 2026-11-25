import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { AppShell } from "@/components/AppShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getAuthContext } from "@/lib/auth";
import { isClerkConfigured } from "@/lib/clerk-config";
import { formatLongTodayCz } from "@/lib/domain/money";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isClerkConfigured()) {
    redirect("/sign-in");
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    const { userId } = await auth();
    if (userId) {
      return (
        <main className="auth-wrap">
          <Alert>
            <AlertTitle>Přístup omezen</AlertTitle>
            <AlertDescription className="mb-4">
              Tato instalace Manymi je momentálně vyhrazena pouze pro povolený účet.
            </AlertDescription>
            <SignOutButton redirectUrl="/sign-in">
              <Button type="button">Odhlásit se</Button>
            </SignOutButton>
          </Alert>
        </main>
      );
    }
    redirect("/sign-in");
  }

  return (
    <AppShell
      activeCompany={ctx.activeCompany}
      companies={ctx.companies}
      todayLabel={formatLongTodayCz()}
    >
      {children}
    </AppShell>
  );
}
