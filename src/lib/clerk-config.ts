export function isClerkConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const secret = process.env.CLERK_SECRET_KEY ?? "";
  return Boolean(
    pub.startsWith("pk_") &&
      secret.startsWith("sk_") &&
      pub.length > 10 &&
      secret.length > 10,
  );
}
