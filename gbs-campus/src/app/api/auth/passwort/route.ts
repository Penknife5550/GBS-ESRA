import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { erfolg, fehler } from "@/lib/api";
import { protokolliere } from "@/lib/audit";
import { sitzungAnlegen } from "@/lib/session";
import { zahl } from "@/lib/einstellungen";
import { drosselUeberschritten } from "@/lib/magic-link";
import { ermittleRequestKontext } from "@/lib/request-kontext";
import { PASSWORT_MAX_LAENGE, passwortStimmt, verbrenneZeitWieEinePruefung } from "@/lib/passwort";
import { raeumeGelegentlichAuf } from "@/lib/aufraeumen";

/**
 * Beide Felder sind nach oben begrenzt, und das ist keine Kosmetik:
 *
 *  - 254 Zeichen ist die längste Adresse, die RFC 5321 zulässt. Ohne Grenze
 *    landete die gesamte Eingabe im Drosselschlüssel `PASSWORT:<adresse>` —
 *    und ab etwa 2700 Byte sprengt ein Schlüssel den Btree-Index auf
 *    `rate_limit`. Der Anmeldeversuch endete dann mit einem Serverfehler
 *    statt mit einer Abweisung, und die Drossel schriebe nichts mehr mit.
 *  - Das Passwort wird ohnehin nur bis PASSWORT_MAX_LAENGE akzeptiert. Ohne
 *    Grenze müsste scrypt vorher noch ein Megabyte durchrechnen.
 */
const schema = z.object({
  email: z.string().max(254),
  passwort: z.string().max(PASSWORT_MAX_LAENGE),
});

/** Eine Meldung für alle Fehlerfälle — siehe unten. */
const ABGELEHNT = "E-Mail-Adresse oder Passwort stimmt nicht.";

/**
 * Anmelden mit Passwort — der zweite Weg neben dem Anmeldelink.
 *
 * Drei Dinge sind hier wichtiger als Bequemlichkeit:
 *
 *  1. **Eine einzige Fehlermeldung.** „Unbekannte Adresse" und „falsches
 *     Passwort" sehen identisch aus. Sonst wäre der Endpunkt ein Verzeichnis
 *     aller Teilnehmer — und die Auskunft, wer eine Bibelschule besucht, ist
 *     eine Angabe zur Religionszugehörigkeit (Art. 9 DSGVO).
 *  2. **Gleiche Laufzeit.** Bei unbekannter Adresse wird trotzdem gerechnet.
 *     Ohne das verriete die Antwortzeit dasselbe wie eine unterschiedliche
 *     Meldung.
 *  3. **Gedrosselt je Adresse und je Anschluss.** Ein Passwort lässt sich
 *     durchprobieren, ein Magic-Link nicht. Die Grenze je Adresse hat einen
 *     eigenen Einstellungsschlüssel (AUTH_PASSWORT_MAX_VERSUCHE) und zählt nur
 *     Fehlversuche — eine gelungene Anmeldung räumt das Kontingent wieder ab.
 */
export async function POST(request: NextRequest) {
  // Der Aufräumlauf hängt an den Anmeldewegen, weil es keinen Worker gibt. Er
  // stand bisher nur an der Anfrage nach einem Anmeldelink — wer sich immer mit
  // Passwort anmeldet, ließ `rate_limit` dadurch unbegrenzt wachsen. Läuft
  // höchstens stündlich und blockiert nicht.
  raeumeGelegentlichAuf();

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler(ABGELEHNT, 401);

  const email = geprueft.data.email.trim().toLowerCase();
  const { ipAdresse, userAgent } = ermittleRequestKontext(request.headers);

  const [maxVersuche, maxProIp, fensterMinuten] = await Promise.all([
    zahl("AUTH_PASSWORT_MAX_VERSUCHE"),
    zahl("AUTH_MAGIC_LINK_MAX_PRO_IP"),
    zahl("AUTH_DROSSEL_FENSTER_MINUTEN"),
  ]);

  // Ohne erkennbare Herkunft wird abgewiesen statt durchgelassen — dieselbe
  // Linie wie bei /api/anmeldung und /api/zugang-hilfe. Vorher stand hier
  // `ipAdresse != null && …`: Wer den Header unterdrückte, umging die
  // Anschlussdrossel vollständig und durfte beliebig viele Adressen mit
  // beliebig vielen Passwörtern durchprobieren.
  //
  // Der Anschluss wird zuerst geprüft, damit eine bereits gesperrte Herkunft
  // nicht noch das Kontingent fremder Adressen aufbraucht.
  const zuOft =
    !ipAdresse ||
    (await drosselUeberschritten(`PASSWORT_IP:${ipAdresse}`, maxProIp, fensterMinuten)) ||
    (await drosselUeberschritten(`PASSWORT:${email}`, maxVersuche, fensterMinuten));

  if (zuOft) {
    // Bewusst ohne `nachher`: Diesen Zweig kann ein Angreifer beliebig oft
    // auslösen, und das Audit-Log ist per Datenbank-Trigger auch für den
    // Administrator unlöschbar. Stünde die eingegebene Adresse darin, ließe
    // sich die Tabelle mit fremdem Text vollschreiben, den niemand mehr
    // entfernen kann. Dass gedrosselt wurde, ist mit Zeitpunkt, IP und
    // User-Agent hinreichend belegt.
    await protokolliere({
      aktion: "PASSWORT_ANMELDUNG_GEDROSSELT",
      objektTyp: "Person",
      quelle: "SYSTEM",
      ipAdresse,
      userAgent,
    });
    return fehler("Zu viele Versuche. Bitte später erneut versuchen oder einen Anmeldelink anfordern.", 429);
  }

  const person = await prisma.person.findUnique({ where: { email }, include: { status: true } });

  // Kein Konto, kein Passwort gesetzt oder Endzustand: alles derselbe Ausgang,
  // und alles nach derselben Rechenzeit.
  if (!person || !person.passwortHash || person.status.istTerminal) {
    await verbrenneZeitWieEinePruefung();
    await protokolliere({
      aktion: "PASSWORT_ANMELDUNG_FEHLGESCHLAGEN",
      objektTyp: "Person",
      objektId: person?.id ?? null,
      quelle: "SYSTEM",
      nachher: { email },
      ipAdresse,
      userAgent,
    });
    return fehler(ABGELEHNT, 401);
  }

  if (!(await passwortStimmt(geprueft.data.passwort, person.passwortHash))) {
    await protokolliere({
      aktion: "PASSWORT_ANMELDUNG_FEHLGESCHLAGEN",
      objektTyp: "Person",
      objektId: person.id,
      quelle: "SYSTEM",
      nachher: { email },
      ipAdresse,
      userAgent,
    });
    return fehler(ABGELEHNT, 401);
  }

  // Erfolgreiche Anmeldungen dürfen das Versuchskontingent nicht aufbrauchen:
  // `drosselUeberschritten` schreibt bei JEDEM Aufruf eine Zeile, also auch bei
  // richtigem Passwort. Wer sich vom Handy, vom Notebook und noch einmal vom
  // Rechner der Verwaltung anmeldet, hätte sich sonst nach wenigen richtigen
  // Eingaben selbst ausgesperrt — und zwar für ein volles Drosselfenster.
  //
  // Nur der Adressschlüssel wird geleert. Der Anschlussschlüssel bleibt stehen:
  // Er schützt davor, dass jemand viele verschiedene Konten durchprobiert, und
  // dürfte sich nicht durch eine einzige gelungene Anmeldung zurücksetzen
  // lassen — sonst genügte ein eigenes Konto, um die Anschlussgrenze
  // fortlaufend abzuräumen.
  await prisma.rateLimit.deleteMany({ where: { schluessel: `PASSWORT:${email}` } });

  await sitzungAnlegen(person.id);

  await protokolliere({
    aktion: "ANGEMELDET_MIT_PASSWORT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: person.id,
    headers: request.headers,
  });

  return erfolg({ angemeldet: true });
}
