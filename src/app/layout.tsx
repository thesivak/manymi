import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/clerk-config";
import "@fontsource-variable/archivo";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manymi — fakturace",
  description:
    "Minimalistická česká online fakturace pro OSVČ a malé firmy. Vydané faktury, ARES, SPAYD QR platby a čistý A4 PDF export.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const content = (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );

  if (!isClerkConfigured()) {
    return content;
  }

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#0B1220",
          colorForeground: "#0B1220",
          colorMutedForeground: "#4B5563",
          colorBackground: "#FFFFFF",
          borderRadius: "3px",
          fontFamily: "var(--font-inter), Inter, sans-serif",
        },
        elements: {
          card: {
            boxShadow: "none",
            border: "1px solid #0B1220",
            borderRadius: "3px",
          },
          formButtonPrimary: {
            backgroundColor: "#0B1220",
            borderRadius: "3px",
            boxShadow: "none",
          },
        },
      }}
    >
      {content}
    </ClerkProvider>
  );
}
