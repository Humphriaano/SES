import { CheckInEmailData } from '../services/checkInEmail.service';

// Values sourced from theme/ses-tokens.css — keep in sync with that file.
const CHARCOAL = '#252B2D'; // --ses-charcoal
const RED = '#D71D24'; // --ses-red — brand/interactive elements only (buttons, links)
const CREAM = '#FBFAF7';

// Clinical semantic colors — for the metric status tags (data), never brand
// red, so a "needs attention" tag can never be confused with a brand button.
const CLINICAL_NORMAL = '#16A34A'; // --clinical-normal
const CLINICAL_INFO_BG = '#E8F1F7'; // --ses-blue-tint
const CLINICAL_INFO_TEXT = '#206497'; // --ses-blue-deep
const CLINICAL_ABNORMAL_BG = '#FFF1F2'; // --clinical-abnormal-bg
const CLINICAL_ABNORMAL = '#BE123C'; // --clinical-abnormal

const TAG_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  improving: { bg: '#e8f5e9', text: CLINICAL_NORMAL, label: 'Improving' },
  stable: { bg: CLINICAL_INFO_BG, text: CLINICAL_INFO_TEXT, label: 'Stable' },
  'needs-attention': { bg: CLINICAL_ABNORMAL_BG, text: CLINICAL_ABNORMAL, label: 'Needs attention' },
};

function metricCardHtml(m: CheckInEmailData['metrics'][number]): string {
  const tag = TAG_COLORS[m.tag] ?? TAG_COLORS['stable']!;
  return `
    <td style="padding:6px;" width="33%">
      <div style="border:1px solid #e5e1d8;border-radius:12px;padding:14px;">
        <div style="font-size:11px;color:#8a8f98;text-transform:uppercase;letter-spacing:0.03em;">${m.label}</div>
        <div style="font-size:20px;font-weight:700;color:${CHARCOAL};margin:4px 0;">${m.value} <span style="font-size:12px;font-weight:400;color:#8a8f98;">${m.unit}</span></div>
        <span style="display:inline-block;background:${tag.bg};color:${tag.text};font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;">${tag.label}</span>
        <div style="font-size:12px;color:#666;margin-top:6px;">${m.changeText}</div>
      </div>
    </td>`;
}

export function checkInEmailTemplate(data: CheckInEmailData, portalUrl: string): { subject: string; html: string } {
  const month = new Date(data.generatedAt).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const subject = `Your ${month} check-in from SES Health`;

  const metricsRow = data.metrics.map(metricCardHtml).join('');

  const apptHtml = data.nextAppointment ? `
    <div style="border:1px solid #e5e1d8;border-radius:12px;padding:16px;margin-top:16px;">
      <div style="font-size:12px;color:#8a8f98;">Your next appointment</div>
      <div style="font-size:15px;font-weight:600;color:${CHARCOAL};margin-top:4px;">
        ${new Date(data.nextAppointment.scheduledAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false })}
        · ${data.nextAppointment.clinicName}
      </div>
      ${data.nextAppointment.status === 'SCHEDULED' ? `<a href="${portalUrl}/appointments" style="display:inline-block;margin-top:10px;background:${RED};color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:9px 18px;border-radius:8px;">Confirm appointment</a>` : ''}
    </div>` : '';

  const conditionsHtml = data.conditions.length > 0 ? `
    <div style="margin-top:20px;">
      ${data.conditions.map((c) => `
        <div style="margin-bottom:12px;">
          <div style="font-size:13px;font-weight:600;color:${CHARCOAL};">${c.plainName} <span style="font-weight:400;color:#8a8f98;">— ${c.patientStatus}</span></div>
          ${c.tip ? `<div style="font-size:12.5px;color:#555;margin-top:2px;">💡 ${c.tip}</div>` : ''}
          ${c.mythBuster ? `<div style="font-size:12.5px;color:#555;margin-top:2px;"><strong>Myth:</strong> ${c.mythBuster.myth} — <strong>Truth:</strong> ${c.mythBuster.truth}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:'Inter',Arial,sans-serif;color:${CHARCOAL};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td style="padding:0 8px 20px;"><span style="font-family:Georgia,'Fraunces',serif;font-size:20px;font-weight:700;">SES Health</span></td></tr>
        <tr><td style="background:#ffffff;border-radius:16px;padding:28px 24px;box-shadow:0 1px 3px rgba(37,43,45,0.08);">
          <h1 style="font-family:Georgia,'Fraunces',serif;font-size:19px;margin:0 0 6px;">Hi ${data.patient.name}, here's your ${month} check-in</h1>
          <p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 18px;">${data.focus}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${metricsRow}</tr></table>
          ${apptHtml}
          ${conditionsHtml}
          <a href="${portalUrl}" style="display:inline-block;margin-top:20px;background:${CHARCOAL};color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 20px;border-radius:8px;">View your full dashboard</a>
        </td></tr>
        <tr><td style="padding:20px 8px 0;font-size:12px;color:#8a8f98;">SES Health · Your monthly chronic-care check-in.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}
