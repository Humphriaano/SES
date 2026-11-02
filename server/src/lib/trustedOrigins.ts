// Origins considered trusted beyond the static CLIENT_URL/PORTAL_URL env
// vars, so the app stays reachable from a LAN IP or an ephemeral Cloudflare
// quick tunnel without needing to hand-edit env vars every time either one
// changes (tunnel hostnames are randomly generated per run).
const LAN_IP_ORIGIN = /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
const CLOUDFLARE_TUNNEL_ORIGIN = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

export function isTrustedOrigin(origin: string | undefined | null, staticAllowed: string[]): boolean {
  if (!origin) return false;
  if (staticAllowed.includes(origin)) return true;
  return LAN_IP_ORIGIN.test(origin) || CLOUDFLARE_TUNNEL_ORIGIN.test(origin);
}
