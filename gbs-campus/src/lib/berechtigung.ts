/**
 * GBS Campus — Rechteprüfung
 *
 * Die Rechte kommen aus der Datenbank (Rolle → RolleRecht → Recht), nicht aus
 * einer Konstante im Code. Sie werden bei jeder Anfrage frisch geladen: Wem man
 * gerade ein Recht entzogen hat, der verliert es sofort und nicht erst, wenn
 * sein Cookie abläuft.
 *
 * Diese Prüfung läuft ausschließlich auf dem Server. Was die Oberfläche
 * ausblendet, ist Bequemlichkeit — verlassen darf man sich nur hierauf.
 */

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { angemeldetePersonId } from "@/lib/session";
import { keineBerechtigung, nichtAngemeldet } from "@/lib/api";
import type { RechtCode } from "@/lib/constants";

export type AngemeldeteBenutzer = {
  id: string;
  vorname: string;
  nachname: string;
  email: string;
  rollen: string[];
  rechte: Set<string>;
};

/**
 * Spielraum beim Vergleich von Sitzung und Passwortänderung.
 *
 * Der Ausstellungszeitpunkt eines JWT (`iat`) steht in ganzen Sekunden und ist
 * abgerundet, `passwortGeaendertAm` dagegen ist millisekundengenau. Wer sein
 * Passwort um 10:00:04.700 Uhr ändert und dafür um 10:00:04.900 Uhr eine neue
 * Sitzung bekommt, hätte ohne Spielraum ein Token mit iat = 10:00:04.000 — also
 * scheinbar älter als die Änderung, und er wäre im selben Moment ausgesperrt,
 * in dem er sein Passwort gesetzt hat.
 *
 * Eine Sekunde reicht dafür genau aus und keine Millisekunde mehr: Mehr als
 * eine Sekunde kann die Abrundung nicht verschlucken. Der Preis ist, dass eine
 * Sitzung, die in derselben Sekunde wie die Passwortänderung ausgestellt wurde,
 * bestehen bleibt — das ist ein Fenster von unter einer Sekunde und praktisch
 * nicht zu treffen.
 */
const SITZUNG_SPIELRAUM_MS = 1000;

export async function ladeAngemeldeten(): Promise<AngemeldeteBenutzer | null> {
  const sitzung = await angemeldetePersonId();
  if (!sitzung) return null;

  // `include` ohne `select` liefert alle Spalten der Person — darunter
  // `passwortGeaendertAm`, das gleich unten gebraucht wird.
  const person = await prisma.person.findUnique({
    where: { id: sitzung.personId },
    include: { rollen: { include: { rolle: { include: { rechte: true } } } }, status: true },
  });
  if (!person) return null;

  // Wer das System verlassen hat, kommt auch mit gültigem Cookie nicht mehr
  // hinein. Sonst behielte ein ausgeschlossener Zugang bis zu zwölf Stunden
  // Zugriff.
  if (person.status.istTerminal) return null;

  // Widerruf: Jede Sitzung, die älter ist als die letzte Passwortänderung, wird
  // verworfen. Das ist der einzige Weg, ein einmal ausgestelltes JWT wieder
  // loszuwerden — es liegt beim Client und lässt sich nicht zurückholen.
  //
  // Der Fall, um den es geht: Jemand erlangt Zugriff auf ein Postfach, setzt
  // sich ein Passwort und meldet sich an. Der Betroffene bekommt den Hinweis
  // „für Ihr Konto wurde ein Passwort gesetzt", ändert es sofort — und ohne
  // diese Prüfung bliebe der Angreifer bis zum Ablauf seiner Sitzung
  // angemeldet, also bis zu zwölf Stunden. Die Reaktion des Betroffenen wäre
  // wirkungslos, obwohl er alles richtig gemacht hat.
  //
  // Auch das Entfernen des Passworts setzt `passwortGeaendertAm` — auch dann
  // sollen fremde Sitzungen enden.
  if (
    person.passwortGeaendertAm &&
    person.passwortGeaendertAm.getTime() >= sitzung.ausgestelltAm.getTime() + SITZUNG_SPIELRAUM_MS
  ) {
    return null;
  }

  const rechte = new Set<string>();
  for (const zuweisung of person.rollen) {
    for (const rolleRecht of zuweisung.rolle.rechte) {
      rechte.add(rolleRecht.rechtCode);
    }
  }

  return {
    id: person.id,
    vorname: person.vorname,
    nachname: person.nachname,
    email: person.email,
    rollen: person.rollen.map((z) => z.rolleCode),
    rechte,
  };
}

/**
 * Liefert den angemeldeten Benutzer, wenn er das Recht hat — sonst null.
 * Für Seiten, die in beiden Fällen zur Anmeldung umleiten. API-Routen nehmen
 * `pruefeZugriff`, weil sie „nicht angemeldet" und „nicht berechtigt"
 * unterscheiden müssen.
 *
 * `recht` ist als `RechtCode` typisiert: Ein vertippter Code wäre sonst kein
 * Compile-Fehler, sondern lautloser Rechteentzug (siehe constants.ts).
 */
export async function ladeMitRecht(recht: RechtCode): Promise<AngemeldeteBenutzer | null> {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) return null;
  return benutzer.rechte.has(recht) ? benutzer : null;
}

/**
 * Zugriffsprüfung für API-Routen: Liefert den Benutzer, wenn er angemeldet ist
 * und das Recht hat — sonst die fertige Fehlerantwort.
 *
 *  - 401 „nicht angemeldet": keine gültige Sitzung (abgelaufen, widerrufen oder
 *    Endzustand). Der Browser-Client meldet daraufhin, dass die Sitzung
 *    abgelaufen ist und die Eingaben stehen bleiben.
 *  - 403 „Keine Berechtigung.": angemeldet, aber ohne dieses Recht.
 *
 * Vorher lieferte `ladeMitRecht` für beides null, und jede Route antwortete mit
 * 403 — wer nach der Mittagspause auf „Speichern" drückte, las „Keine
 * Berechtigung." statt „bitte neu anmelden".
 *
 * Aufruf:
 *   const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
 *   if (benutzer instanceof Response) return benutzer;
 */
export async function pruefeZugriff(recht: RechtCode): Promise<AngemeldeteBenutzer | NextResponse> {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) return nichtAngemeldet();
  if (!benutzer.rechte.has(recht)) return keineBerechtigung();
  return benutzer;
}

export function hatRecht(benutzer: AngemeldeteBenutzer | null, recht: RechtCode): boolean {
  return benutzer?.rechte.has(recht) ?? false;
}
