/**
 * GBS Campus — Sitzungen
 *
 * Wer einen gültigen Magic-Link einlöst oder sein Passwort richtig eingibt,
 * bekommt ein signiertes Cookie. Das Cookie trägt nur die Personen-ID und den
 * Ausstellungszeitpunkt — Rollen und Rechte werden bei jeder Anfrage frisch aus
 * der Datenbank gelesen. Sonst behielte jemand, dem man gerade Rechte entzogen
 * hat, sie bis zum Ablauf des Cookies.
 *
 * Der Ausstellungszeitpunkt ist der Widerrufsanker: Ein JWT lässt sich nicht
 * zurückrufen, aber `ladeAngemeldeten()` in lib/berechtigung.ts verwirft jede
 * Sitzung, die älter ist als die letzte Passwortänderung der Person. Ohne das
 * bliebe ein Angreifer nach dem Hinweis „für Ihr Konto wurde ein Passwort
 * gesetzt" noch bis zum Ablauf der Sitzung angemeldet — die Reaktion des
 * Betroffenen liefe ins Leere.
 */

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { zahl } from "@/lib/einstellungen";

// __Host- verlangt path=/, secure und KEIN domain-Attribut — damit kann keine
// Nachbar-Subdomain unter fes-credo.de ein Sitzungscookie fuer uns setzen.
// In der Entwicklung laeuft die App ohne TLS, dort ist der Praefix nicht erlaubt.
const COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-gbs_sitzung" : "gbs_sitzung";

// Gilt fuer das Setzen UND das Loeschen. Ein Set-Cookie fuer ein __Host-Cookie
// ohne `secure` verwirft der Browser komplett — auch den Loeschversuch. Deshalb
// stehen die Attribute nur hier und nicht zweimal von Hand.
const COOKIE_ATTRIBUTE = {
  httpOnly: true,
  sameSite: "lax",
  // In der Entwicklung laeuft die App ohne TLS — dort wuerde ein secure-Cookie
  // nie ankommen und niemand kaeme hinein.
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

function getSchluessel(): Uint8Array {
  const geheim = process.env.SESSION_SECRET;
  if (!geheim || geheim.length < 32) {
    throw new Error(
      "SESSION_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen). Erzeugen mit: openssl rand -hex 32",
    );
  }
  return new TextEncoder().encode(geheim);
}

/**
 * Legt eine Sitzung an. `setIssuedAt()` ist dabei nicht schmückendes Beiwerk,
 * sondern der Zeitstempel, an dem der Widerruf hängt (siehe Kopf der Datei).
 *
 * **Nach einer Passwortänderung muss diese Funktion erneut aufgerufen werden.**
 * Sonst sperrt sich aus, wer sein eigenes Passwort ändert: Die Änderung ist
 * dann neuer als sein Token, und die nächste Anfrage gilt als widerrufen.
 * `api/meine-daten/passwort` tut das im Anschluss an das Speichern.
 */
export async function sitzungAnlegen(personId: string): Promise<void> {
  const laufzeitStunden = await zahl("AUTH_SITZUNG_STUNDEN");

  const token = await new SignJWT({ sub: personId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${laufzeitStunden}h`)
    .sign(getSchluessel());

  const speicher = await cookies();
  speicher.set(COOKIE_NAME, token, {
    ...COOKIE_ATTRIBUTE,
    // Muss zur Laufzeit im Token passen: laeuft das Cookie spaeter ab als das
    // Token, sieht der Benutzer eine scheinbar gueltige Sitzung, die bei jeder
    // Anfrage abgewiesen wird.
    maxAge: laufzeitStunden * 60 * 60,
  });
}

/**
 * Beendet die Sitzung im Browser: leeres Cookie mit `maxAge: 0` und denselben
 * Attributen wie beim Setzen.
 *
 * Vor dem Review stand hier `speicher.delete(COOKIE_NAME)`. Next baut daraus
 * ein Set-Cookie nur mit Path und Expires, ohne `Secure`. Browser verwerfen
 * jedes Set-Cookie mit __Host-Praefix ohne `Secure` — auch den Loeschversuch.
 * In Produktion blieb die Sitzung nach dem Abmelden also bestehen, waehrend die
 * Route „abgemeldet" meldete. In der Entwicklung heisst das Cookie ohne
 * Praefix, dort fiel es nicht auf.
 */
export async function sitzungBeenden(): Promise<void> {
  const speicher = await cookies();
  speicher.set(COOKIE_NAME, "", { ...COOKIE_ATTRIBUTE, maxAge: 0 });
}

export type Sitzung = {
  personId: string;
  /** Zeitpunkt der Ausstellung (`iat`) — auf ganze Sekunden abgerundet. */
  ausgestelltAm: Date;
};

/**
 * Liefert die laufende Sitzung oder null.
 *
 * Gibt seit dem Review nicht mehr nur die ID zurück: Ohne den
 * Ausstellungszeitpunkt lässt sich nicht feststellen, ob die Sitzung älter ist
 * als die letzte Passwortänderung — und damit widerrufen. Diese Prüfung selbst
 * steht in `ladeAngemeldeten()`, wo die Person ohnehin geladen wird; hier gibt
 * es keinen Datenbankzugriff.
 */
export async function angemeldetePersonId(): Promise<Sitzung | null> {
  const speicher = await cookies();
  const token = speicher.get(COOKIE_NAME)?.value;
  if (!token) return null;

  // Bewusst VOR dem try: Ein fehlendes oder zu kurzes SESSION_SECRET ist ein
  // Konfigurationsfehler und muss laut scheitern. Innerhalb des try wurde er
  // vor dem Review verschluckt und war von einer abgelaufenen Sitzung nicht zu
  // unterscheiden — alle wurden ausgesperrt, ohne dass die Ursache sichtbar war.
  const schluessel = getSchluessel();

  try {
    const { payload } = await jwtVerify(token, schluessel, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;

    // Fehlt `iat`, lässt sich der Widerruf nicht prüfen — dann gilt die Sitzung
    // als ungültig statt als unbeschränkt gültig. `sitzungAnlegen()` setzt das
    // Feld immer; ein Token ohne iat kann nur aus einer fremden Quelle stammen.
    if (typeof payload.iat !== "number") return null;

    return { personId: payload.sub, ausgestelltAm: new Date(payload.iat * 1000) };
  } catch {
    // Abgelaufen oder manipuliert — beides bedeutet: nicht angemeldet.
    return null;
  }
}
