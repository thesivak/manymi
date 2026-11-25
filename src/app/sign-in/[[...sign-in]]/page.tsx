import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isClerkConfigured } from "@/lib/clerk-config";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const configured = isClerkConfigured();

  return (
    <main className="auth-wrap">
      <div style={{ marginBottom: 32 }}>
        <Link href="/" className="brand" style={{ marginBottom: 24 }}>
          <BrandMark />
          <span className="brand__word">manymi</span>
        </Link>
        <p className="eyebrow" style={{ marginTop: 20 }}>
          Přihlášení do fakturace
        </p>
        <h1 className="display h2">Vítejte zpět.</h1>
      </div>

      {configured ? (
        <SignIn
          routing="path"
          path="/sign-in"
          fallbackRedirectUrl="/"
          appearance={{
            elements: {
              footerAction: { display: "none" },
              footer: { display: "none" },
            },
          }}
        />
      ) : (
        <Alert>
          <AlertTitle>Chybí konfigurace Clerk v .env.local</AlertTitle>
          <AlertDescription>
            Nastavte <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> a{" "}
            <code>CLERK_SECRET_KEY</code> podle souboru <code>.env.example</code>{" "}
            a restartujte server.
          </AlertDescription>
        </Alert>
      )}
    </main>
  );
}

function BrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 2h11l5 5v15H4V2z" fill="#0B1220" />
      <path d="M15 2v5h5" fill="#F8F9FA" />
      <rect x="7" y="11" width="10" height="2" fill="#FFFFFF" />
      <rect x="7" y="15" width="6" height="2" fill="#FFFFFF" />
    </svg>
  );
}
