/**
 * Odesílání e-mailů (Resend REST API, pokud je nastaveno RESEND_API_KEY).
 * Pokud není nakonfigurován poštovní klíč, poctivě vrací status `queued_no_provider`
 * místo předstírání doručení.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  fromName?: string;
}

export interface SendEmailResult {
  delivered: boolean;
  status: "sent" | "queued_no_provider" | "failed";
  providerMessageId?: string;
  detail: string;
}

export async function sendTransactionalEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.MAIL_FROM?.trim() || "fakturace@manymi.cz";
  const from = input.fromName ? `${input.fromName} <${fromEmail}>` : fromEmail;

  if (!apiKey) {
    return {
      delivered: false,
      status: "queued_no_provider",
      detail:
        "E-mail byl uložen v historii komunikace (pro reálné doručení nastavte RESEND_API_KEY v .env.local).",
    };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return {
        delivered: false,
        status: "failed",
        detail: body.message || `Poštovní server vrátil HTTP ${res.status}.`,
      };
    }
    return {
      delivered: true,
      status: "sent",
      providerMessageId: body.id,
      detail: `E-mail byl odeslán na ${input.to}.`,
    };
  } catch (err) {
    return {
      delivered: false,
      status: "failed",
      detail: err instanceof Error ? err.message : "Chyba při komunikaci s poštovním serverem.",
    };
  }
}
