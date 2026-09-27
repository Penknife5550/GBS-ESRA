/**
 * GBS Campus — Herkunftsprüfung für schreibende API-Anfragen (CSRF-Schutz)
 *
 * Vor dem Review gab es keine: Das Sitzungscookie ist `SameSite=Lax`, und das
 * hält nur fremde *Sites* ab. Alle Hosts unter fes-credo.de gelten aber als
 * dieselbe Site. Ein Skript auf irgendeiner Nachbar-Subdomain (übernommene
 * Subdomain, XSS in einer anderen Anwendung) konnte im Namen eines angemeldeten
 * Opfers POSTen — etwa eine E-Mail-Änderung beantragen und so das Konto
 * übernehmen. `request.json()` prüft keinen Content-Type, es genügte also ein
 * „simple request" (text/plain, no-cors) ganz ohne CORS-Preflight.
 *
 * Die Regel (angewendet in src/middleware.ts auf /api/*):
 *
 *  - GET, HEAD und OPTIONS sind frei — sie verändern nichts.
 *  - Jede andere Methode: Schickt der Browser `Origin`, muss der Wert exakt der
 *    Herkunft aus APP_URL entsprechen. Schickt er `Sec-Fetch-Site`, muss der
 *    Wert `same-origin` oder `none` sein. Beide Header setzt der Browser
 *    selbst, eine Seite kann sie nicht fälschen.
 *  - Fehlen beide Header, geht die Anfrage durch. CSRF setzt einen Browser
 *    voraus, und Browser schicken bei POST, PUT, PATCH und DELETE immer
 *    `Origin`. Ohne beide Header kommen curl, der Cron-Zeitgeber und der
 *    Durchstich — keiner davon trägt ein fremdes Sitzungscookie mit sich.
 *
 * Verglichen wird exakt als Zeichenkette. Browser schreiben `Origin` immer in
 * derselben Form: Schema und Host klein, Standardport weggelassen, kein Pfad.
 * In genau diese Form bringt `new URL(APP_URL).origin` die Konfiguration — so
 * stören dort weder ein abschließender Schrägstrich noch ein Pfad noch
 * Großschreibung. Alles, was davon abweicht (anderes Schema, anderer Port,
 * `null`), ist fremd.
 *
 * Voraussetzung im Betrieb: Die Referrer-Policy darf nicht `no-referrer`
 * lauten. Dann schicken Browser auch bei eigenen POSTs `Origin: null`, und jede
 * Änderung würde abgewiesen. Traefik setzt `strict-origin-when-cross-origin`.
 *
 * Ohne Datenbank und ohne Next-Import, damit scripts/pruefe-herkunft.ts die
 * Regel direkt prüfen kann.
 */

const FREIE_METHODEN = new Set(["GET", "HEAD", "OPTIONS"]);

// `same-site` bleibt bewusst draußen: Genau das ist die Nachbar-Subdomain.
// `none` heißt, die Anfrage hat der Mensch selbst ausgelöst (Adresszeile,
// Lesezeichen) — keine fremde Seite war beteiligt.
const ERLAUBTE_FETCH_SITES = new Set(["same-origin", "none"]);

export type HerkunftsAnfrage = {
  methode: string;
  /** Wert des Headers `Origin`, null wenn er fehlt. */
  origin: string | null;
  /** Wert des Headers `Sec-Fetch-Site`, null wenn er fehlt. */
  secFetchSite: string | null;
  /** Rohwert der Umgebungsvariable APP_URL. */
  appUrl: string | undefined;
};

export type HerkunftsEntscheidung =
  | { erlaubt: true }
  | { erlaubt: false; grund: "fremder-origin" | "fremde-fetch-site" | "app-url-ungueltig" };

/**
 * Die Herkunft, unter der Browser das Portal öffnen — aus APP_URL, in der Form,
 * in der Browser den Header `Origin` schreiben. Null, wenn APP_URL fehlt oder
 * keine http(s)-Adresse ist.
 */
export function erwarteterOrigin(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin;
}

export function pruefeHerkunft(anfrage: HerkunftsAnfrage): HerkunftsEntscheidung {
  // Bewusst ohne toUpperCase: Node nimmt ohnehin nur großgeschriebene Methoden
  // an, und eine unbekannte Schreibweise wird geprüft statt durchgewunken.
  if (FREIE_METHODEN.has(anfrage.methode)) return { erlaubt: true };

  if (anfrage.origin !== null) {
    const erwartet = erwarteterOrigin(anfrage.appUrl);
    // Ohne gültige APP_URL lässt sich nichts vergleichen — dann abweisen statt
    // durchlassen. Der Startprüfer (lib/konfiguration.ts) verhindert das im
    // Normalfall schon vor der ersten Anfrage.
    if (erwartet === null) return { erlaubt: false, grund: "app-url-ungueltig" };
    if (anfrage.origin !== erwartet) return { erlaubt: false, grund: "fremder-origin" };
  }

  // Auch bei passendem Origin geprüft: Ein Browser, der beide Header schickt,
  // muss in beiden „eigene Seite" sagen. Bei echten eigenen Anfragen ist das
  // immer so.
  if (anfrage.secFetchSite !== null && !ERLAUBTE_FETCH_SITES.has(anfrage.secFetchSite)) {
    return { erlaubt: false, grund: "fremde-fetch-site" };
  }

  return { erlaubt: true };
}
