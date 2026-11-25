const DEFAULT_ALLOWED_EMAILS = ["mirek@sivak.ai"];

export function getAllowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS;
  if (!raw || !raw.trim()) {
    return DEFAULT_ALLOWED_EMAILS;
  }
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_EMAILS;
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return getAllowedEmails().includes(normalized);
}
