// One-off icon generator: rasterizes the SES Health brand mark (charcoal
// square, brand-red pulse line) into the PNG sizes/variants the manifest
// needs. Run with `node scripts/generate-icons.mjs` after changing the mark;
// not part of the app's runtime build. Colors sourced from theme/ses-tokens.css.
import sharp from 'sharp';
import { mkdirSync } from 'fs';

const NAVY = '#252B2D'; // --ses-charcoal
const ORANGE = '#D71D24'; // --ses-red
const CREAM = '#FBFAF7';

mkdirSync('public/icons', { recursive: true });

// contentScale controls how much of the canvas the pulse mark occupies —
// maskable icons need extra padding since OS masks crop toward the edges.
function markSvg(size, contentScale) {
  const c = size / 2;
  const r = size * 0.5;
  const strokeW = size * 0.045 * (1 / contentScale);
  const scale = contentScale;
  // A simple heartbeat/pulse line, drawn centered then scaled+translated.
  const pulse = `M ${-0.34 * size} 0
    L ${-0.16 * size} 0
    L ${-0.10 * size} ${-0.14 * size}
    L ${-0.02 * size} ${0.16 * size}
    L ${0.06 * size} ${-0.10 * size}
    L ${0.12 * size} 0
    L ${0.34 * size} 0`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r * 0.22}" fill="${NAVY}"/>
    <g transform="translate(${c} ${c}) scale(${scale})">
      <path d="${pulse}" fill="none" stroke="${CREAM}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${0.30 * size}" cy="${-0.30 * size}" r="${size * 0.05}" fill="${ORANGE}"/>
    </g>
  </svg>`;
}

async function render(size, contentScale, outPath) {
  await sharp(Buffer.from(markSvg(size, contentScale))).png().toFile(outPath);
  console.log('wrote', outPath);
}

await render(192, 1.0, 'public/icons/icon-192.png');
await render(512, 1.0, 'public/icons/icon-512.png');
// Maskable variants keep content within the ~80% safe zone.
await render(192, 0.7, 'public/icons/icon-maskable-192.png');
await render(512, 0.7, 'public/icons/icon-maskable-512.png');
// Apple touch icon (no transparency, square corners handled by iOS itself).
await render(180, 1.0, 'public/icons/apple-touch-icon.png');
// Favicon-sized.
await render(32, 1.0, 'public/icons/favicon-32.png');
