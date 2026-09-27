/**
 * GBS Campus — Middleware: Herkunftsprüfung für schreibende API-Anfragen
 *
 * Schützt alle Route Handler unter /api gegen CSRF. Regel und Begründung stehen
 * in lib/herkunft.ts. Der Matcher erfasst nur /api — Seiten laufen nicht durch
 * die Middleware.
 *
 * Laufzeit: bewusst die Standard-Laufzeit (Edge), nicht `runtime: "nodejs"`.
 * Nachgesehen in Next 15.5.22 (node_modules/next):
 *
 *  - APP_URL wird zur LAUFZEIT gelesen, nicht beim Build eingesetzt. Beim Build
 *    ersetzt Next in Edge-Code nur NEXT_PUBLIC_* und die `env` aus
 *    next.config (build/define-env.js). Die Edge-Sandbox von `next start` bzw.
 *    des standalone-Servers übernimmt process.env des laufenden Prozesses
 *    (server/web/sandbox/context.js, buildEnvironmentVariablesFrom). Das passt
 *    zum Dockerfile: Das Image wird ohne APP_URL gebaut und bekommt sie erst
 *    beim Start. Gelesen wird trotzdem erst in der Funktion, nicht beim Laden
 *    des Moduls.
 *  - Der Edge-Weg wartet, bis der Anfragerumpf für den Route Handler
 *    wiederhergestellt ist (server/web/sandbox/sandbox.js: `await …finalize()`).
 *    Der Node-Weg ruft `finalize()` in 15.5.22 ohne `await` auf
 *    (server/next-server.js). Jede schreibende Route liest ihren Rumpf mit
 *    request.json() — dort soll kein weniger erprobter Weg dazwischenkommen.
 *
 * Next puffert für die Middleware Anfragerümpfe bis 10 MB
 * (experimental.middlewareClientMaxBodySize). Die API nimmt nur kleine
 * JSON-Rümpfe an; ein künftiger Datei-Upload unter /api müsste das bedenken.
 */

import { NextResponse, type NextRequest } from "next/server";
import { fehler } from "@/lib/api";
import { pruefeHerkunft } from "@/lib/herkunft";

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");

  const entscheidung = pruefeHerkunft({
    methode: request.method,
    origin,
    secFetchSite,
    appUrl: process.env.APP_URL,
  });

  if (entscheidung.erlaubt) return NextResponse.next();

  // Für den Betrieb: Passt APP_URL nicht zur Adresse, unter der das Portal
  // tatsächlich geöffnet wird, scheitert jede Änderung — das soll im Log sofort
  // erkennbar sein. Geloggt werden nur Methode, Pfad und die beiden
  // Herkunfts-Header, keine Rümpfe und keine Cookies.
  console.warn(
    `[HERKUNFT] ${request.method} ${request.nextUrl.pathname} abgewiesen (${entscheidung.grund}):` +
      ` Origin=${JSON.stringify(origin)}, Sec-Fetch-Site=${JSON.stringify(secFetchSite)}`,
  );

  return fehler(
    "Diese Anfrage kam nicht von der Seite des Portals und wurde aus Sicherheitsgründen abgelehnt. " +
      "Bitte öffnen Sie das Portal direkt über seine Adresse und versuchen Sie es noch einmal.",
    403,
  );
}

export const config = {
  matcher: "/api/:path*",
};
