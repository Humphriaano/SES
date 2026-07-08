// Values sourced from theme/ses-tokens.css — keep in sync with that file.
const CHARCOAL = '#252B2D'; // --ses-charcoal
const RED = '#D71D24'; // --ses-red
const CREAM = '#FBFAF7';

function shell(bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:${CREAM};font-family:'Inter',Arial,sans-serif;color:${CHARCOAL};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
            <tr>
              <td style="padding:0 8px 20px;">
                <span style="font-family:Georgia,'Fraunces',serif;font-size:20px;font-weight:700;color:${CHARCOAL};">SES Health</span>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 1px 3px rgba(37,43,45,0.08);">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 8px 0;font-size:12px;color:#8a8f98;">
                SES Health · This is an automated message about your care.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;margin-top:8px;">${label}</a>`;
}

export function magicLinkEmail(opts: { firstName: string; url: string; purpose: 'login' | 'invitation' }): { subject: string; html: string } {
  const isInvite = opts.purpose === 'invitation';
  const subject = isInvite ? 'You’re invited to the SES Health portal' : 'Your SES Health sign-in link';
  const intro = isInvite
    ? `Hi ${opts.firstName}, your care team has set up access to the SES Health patient portal — a simple place to check your numbers, upcoming appointments, and monthly tips between visits.`
    : `Hi ${opts.firstName}, here's your one-tap sign-in link for SES Health.`;
  const html = shell(`
    <h1 style="font-family:Georgia,'Fraunces',serif;font-size:20px;margin:0 0 12px;">${isInvite ? 'Welcome to your health portal' : 'Sign in to SES Health'}</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#333;">${intro}</p>
    ${button(isInvite ? 'Set up your portal' : 'Sign in', opts.url)}
    <p style="font-size:12px;line-height:1.6;margin:24px 0 0;color:#8a8f98;">This link works once and expires in 15 minutes. If you didn't request it, you can safely ignore this email.</p>
  `);
  return { subject, html };
}

export function appointmentReminderEmail(opts: { firstName: string; dateLabel: string; clinicName: string; url: string }): { subject: string; html: string } {
  const subject = 'Reminder: your upcoming appointment';
  const html = shell(`
    <h1 style="font-family:Georgia,'Fraunces',serif;font-size:20px;margin:0 0 12px;">See you soon, ${opts.firstName}</h1>
    <p style="font-size:14px;line-height:1.6;margin:0 0 12px;color:#333;">You have an appointment coming up:</p>
    <p style="font-size:15px;font-weight:600;margin:0 0 20px;">${opts.dateLabel} · ${opts.clinicName}</p>
    ${button('Confirm appointment', opts.url)}
  `);
  return { subject, html };
}
