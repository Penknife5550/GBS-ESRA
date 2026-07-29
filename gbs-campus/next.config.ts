import type { NextConfig } from "next";

// Content-Security-Policy. Die übrigen Sicherheits-Header (HSTS, X-Frame-Options,
// nosniff, Referrer-Policy) setzt Traefik zentral; die CSP steht bewusst HIER in
// der Anwendung, weil nur sie weiß, was die Seiten wirklich brauchen — und weil
// sie sich so direkt am App-Container prüfen lässt (curl, Durchstich), nicht erst
// hinter dem Proxy.
//
// Die Anwendung lädt NICHTS von fremden Hosts: Montserrat kommt über `next/font`
// selbst ausgeliefert (siehe layout.tsx), es gibt keine CDN-Skripte. Deshalb ist
// `default-src 'self'` möglich. `'unsafe-inline'` bleibt für Skripte nötig, weil
// Next den Bootstrap inline einbettet; ein nonce-basiertes Verschärfen ist der
// nächste Schritt (bewusst nicht jetzt: es koppelt statische Seiten an dynamisches
// Rendern und ist vor dem Livegang das größere Risiko). `'unsafe-eval'` nur in der
// Entwicklung, sonst bräche das Hot-Reloading; das Produktions-Image kommt ohne aus.
const istEntwicklung = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${istEntwicklung ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;
