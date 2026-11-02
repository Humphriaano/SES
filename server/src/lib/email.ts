const BREVO_API_KEY = process.env['BREVO_API_KEY'];
const EMAIL_FROM_ADDRESS = process.env['EMAIL_FROM_ADDRESS'] ?? 'no-reply@ses.local';
const EMAIL_FROM_NAME = process.env['EMAIL_FROM_NAME'] ?? 'SES Health';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends via Brevo's transactional email API when BREVO_API_KEY is configured.
 * Without it (local dev), logs the email to the console instead — magic
 * links and portal invitations still work, just via the server log rather
 * than an inbox. Throws on a non-2xx Brevo response so callers (and their
 * HTTP responses) reflect an actual send failure rather than reporting
 * success just because our own endpoint didn't throw.
 */
export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<void> {
  if (!BREVO_API_KEY) {
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.log('\n────────────────────────────────────────────');
    console.log(`[dev email] To: ${to}`);
    console.log(`[dev email] Subject: ${subject}`);
    if (links.length > 0) console.log(`[dev email] Link(s): ${links.join(', ')}`);
    console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    console.log('────────────────────────────────────────────\n');
    return;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: EMAIL_FROM_ADDRESS, name: EMAIL_FROM_NAME },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`[email] Brevo send to ${to} FAILED (${res.status}):`, body);
    throw new Error(`Brevo rejected the email (${res.status}): ${body?.message ?? 'unknown error'}`);
  }
  console.log(`[email] Brevo accepted send to ${to} — messageId: ${body?.messageId ?? 'unknown'}`);
}
