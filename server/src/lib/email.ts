import sgMail from '@sendgrid/mail';

const SENDGRID_API_KEY = process.env['SENDGRID_API_KEY'];
const EMAIL_FROM = process.env['EMAIL_FROM'] ?? 'SES Health <no-reply@ses.local>';

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

/**
 * Sends via SendGrid when SENDGRID_API_KEY is configured. Without it (local
 * dev), logs the email to the console instead — magic links and portal
 * invitations still work, just via the server log rather than an inbox.
 */
export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<void> {
  if (!SENDGRID_API_KEY) {
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.log('\n────────────────────────────────────────────');
    console.log(`[dev email] To: ${to}`);
    console.log(`[dev email] Subject: ${subject}`);
    if (links.length > 0) console.log(`[dev email] Link(s): ${links.join(', ')}`);
    console.log(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    console.log('────────────────────────────────────────────\n');
    return;
  }
  await sgMail.send({ to, from: EMAIL_FROM, subject, html });
}
