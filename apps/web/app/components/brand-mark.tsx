// Logomark do Oráculo: orbe/íris dourado com a gema facetada (◆) no centro.
// Idêntico ao favicon (app/icon.svg) — fonte única da identidade. Inline para
// escalar sem requisição e herdar o tamanho do container.
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className ?? "brand-mark"}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="oraculoGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f9d071" />
            <stop offset="1" stopColor="#e3a93a" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="12" fill="#0e131c" />
        <circle cx="24" cy="24" r="14.4" fill="none" stroke="url(#oraculoGold)" strokeWidth="3.1" />
        <path d="M24 15 L32.6 24 L24 33 L15.4 24 Z" fill="url(#oraculoGold)" />
        <path d="M24 15 L24 33 L15.4 24 Z" fill="#ffffff" opacity="0.16" />
        <path d="M24 15 L32.6 24 L24 24 Z" fill="#7a5410" opacity="0.28" />
      </svg>
    </span>
  );
}
