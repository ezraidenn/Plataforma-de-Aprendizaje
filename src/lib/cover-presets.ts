/**
 * Portadas vectoriales (SVG) para login / dashboard. Isomórfico: se usan como
 * fondo CSS (`url("data:image/svg+xml,...")`) tanto en el servidor como en el
 * editor de identidad (miniaturas). Paleta v3: noche, índigo, cian.
 */

export type CoverPreset = { id: string; name: string; description: string; svg: string };

const W = 1600;
const H = 900;

function wrap(body: string, bg = "#0f172a"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;
}

export const COVER_PRESETS: CoverPreset[] = [
  {
    id: "aurora",
    name: "Aurora",
    description: "Degradado noche con halos índigo y cian",
    svg: wrap(`
      <defs>
        <radialGradient id="a" cx="80%" cy="10%" r="70%"><stop offset="0" stop-color="#6366f1" stop-opacity=".85"/><stop offset="1" stop-color="#6366f1" stop-opacity="0"/></radialGradient>
        <radialGradient id="b" cx="10%" cy="90%" r="60%"><stop offset="0" stop-color="#22d3ee" stop-opacity=".7"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <rect width="${W}" height="${H}" fill="url(#a)"/>
      <rect width="${W}" height="${H}" fill="url(#b)"/>`),
  },
  {
    id: "ondas",
    name: "Ondas",
    description: "Olas suaves en capas translúcidas",
    svg: wrap(`
      <path d="M0 620 C 300 520, 500 760, 800 640 S 1300 520, 1600 660 V900 H0Z" fill="#312e81" opacity=".9"/>
      <path d="M0 700 C 320 600, 520 840, 820 720 S 1320 600, 1600 740 V900 H0Z" fill="#4f46e5" opacity=".75"/>
      <path d="M0 790 C 340 700, 540 900, 840 800 S 1340 700, 1600 820 V900 H0Z" fill="#22d3ee" opacity=".55"/>`),
  },
  {
    id: "geometria",
    name: "Geometría",
    description: "Triángulos y rombos índigo sobre noche",
    svg: wrap(`
      <polygon points="0,0 520,0 0,420" fill="#1e1b4b"/>
      <polygon points="1600,900 1000,900 1600,420" fill="#312e81"/>
      <polygon points="1600,0 1600,360 1180,0" fill="#4f46e5" opacity=".8"/>
      <polygon points="0,900 0,560 420,900" fill="#4338ca" opacity=".9"/>
      <circle cx="1200" cy="300" r="140" fill="#22d3ee" opacity=".35"/>
      <circle cx="420" cy="640" r="90" fill="#818cf8" opacity=".4"/>`),
  },
  {
    id: "malla",
    name: "Malla",
    description: "Cuadrícula técnica con destello",
    svg: wrap(`
      <defs>
        <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="#818cf8" stroke-opacity=".18" stroke-width="1.5"/></pattern>
        <radialGradient id="glow" cx="70%" cy="30%" r="55%"><stop offset="0" stop-color="#4f46e5" stop-opacity=".9"/><stop offset="1" stop-color="#4f46e5" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
      <rect width="${W}" height="${H}" fill="url(#grid)"/>
      <circle cx="1120" cy="270" r="6" fill="#22d3ee"/><circle cx="400" cy="640" r="6" fill="#22d3ee"/><circle cx="760" cy="420" r="5" fill="#c7d2fe"/>`),
  },
  {
    id: "orbitas",
    name: "Órbitas",
    description: "Anillos concéntricos en cian y lavanda",
    svg: wrap(`
      <g fill="none" stroke-width="2">
        <circle cx="1250" cy="450" r="140" stroke="#22d3ee" stroke-opacity=".8"/>
        <circle cx="1250" cy="450" r="260" stroke="#818cf8" stroke-opacity=".5"/>
        <circle cx="1250" cy="450" r="400" stroke="#6366f1" stroke-opacity=".35"/>
        <circle cx="1250" cy="450" r="560" stroke="#4f46e5" stroke-opacity=".22"/>
        <circle cx="1250" cy="450" r="740" stroke="#312e81" stroke-opacity=".3"/>
      </g>
      <circle cx="1250" cy="450" r="26" fill="#22d3ee"/>
      <circle cx="1010" cy="300" r="10" fill="#c7d2fe"/>
      <circle cx="1500" cy="720" r="8" fill="#818cf8"/>`),
  },
  {
    id: "diagonal",
    name: "Diagonal",
    description: "Franjas diagonales con acento cian",
    svg: wrap(`
      <g transform="rotate(-18 800 450)">
        <rect x="-200" y="520" width="2000" height="120" fill="#312e81"/>
        <rect x="-200" y="660" width="2000" height="60" fill="#4f46e5" opacity=".9"/>
        <rect x="-200" y="740" width="2000" height="18" fill="#22d3ee" opacity=".9"/>
      </g>`),
  },
];

export function getCoverPreset(id: string | null | undefined): CoverPreset | null {
  if (!id) return null;
  return COVER_PRESETS.find((p) => p.id === id) ?? null;
}

/** Data URL lista para `background-image`. */
export function coverDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}`;
}
