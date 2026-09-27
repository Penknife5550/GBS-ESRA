import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { entschluesseln } from "@/lib/encryption";

/**
 * Keine Antwort dieser Route darf in einem Cache landen — die Erfolgsantwort
 * trägt die IBAN im Klartext (wie Export, Auskunft und Zeugnis-PDF).
 */
function ohneCache(antwort: NextResponse): NextResponse {
  antwort.headers.set("Cache-Control", "no-store");
  return antwort;
}

/**
 * Gibt die Bankverbindung einer Person im Klartext heraus — für den Einzug des
 * Semesterbeitrags durch die Verwaltung.
 *
 * Drei Dinge machen das vertretbar:
 *
 *  1. **Eigenes Recht.** `BANKVERBINDUNG_LESEN` ist bewusst getrennt von
 *     `FINANZ_DATEN_LESEN`. Der Schulleiter sieht den Beitragsstatus, die IBAN
 *     sieht nur, wer sie zum Arbeiten braucht (Datenminimierung, Art. 5 Abs. 1
 *     lit. c DSGVO).
 *  2. **Auf Anforderung, nicht nebenbei.** Die Listen zeigen nur „hinterlegt" —
 *     keine einzige Stelle der IBAN. Der Klartext kommt erst über diesen Aufruf —
 *     er steht also nie beiläufig auf einem Bildschirm, den jemand von der Seite
 *     sieht.
 *  3. **Jeder Zugriff wird protokolliert**, mit Akteur, Zeitpunkt und IP. Das
 *     Audit-Log ist append-only; wer wann welche Bankverbindung eingesehen hat,
 *     lässt sich nachträglich nicht mehr entfernen.
 *
 * Bewusst POST, obwohl nur gelesen wird (Code-Review 4): Ein GET schickte der
 * Browser mit dem Sitzungs-Cookie auch bei einer Navigation von einer fremden
 * Seite — ein präparierter Link erzeugte so im Namen des Angemeldeten den
 * unlöschbaren Eintrag BANKVERBINDUNG_EINGESEHEN. Für POST greift die
 * Herkunftsprüfung der Middleware. Keine Antwort wird zwischengespeichert.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.BANKVERBINDUNG_LESEN);
  if (benutzer instanceof Response) return ohneCache(benutzer);

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true, kontoinhaber: true, ibanVerschluesselt: true },
  });

  if (!person) return ohneCache(fehler("Diese Person gibt es nicht.", 404));
  if (!person.ibanVerschluesselt) {
    return ohneCache(fehler("Für diese Person ist keine Bankverbindung hinterlegt.", 404));
  }

  let iban: string;
  try {
    iban = entschluesseln(person.ibanVerschluesselt);
  } catch (ausnahme) {
    // Passiert, wenn der ENCRYPTION_KEY nicht zu den Daten passt — etwa nach
    // einem Restore mit dem falschen Schlüssel. Das muss laut auffallen, nicht
    // als leeres Feld erscheinen.
    console.error("[BANKVERBINDUNG] Entschlüsselung fehlgeschlagen für", person.id, ausnahme);
    return ohneCache(
      fehler(
        "Die Bankverbindung ist nicht lesbar. Vermutlich passt der Verschlüsselungsschlüssel nicht zu den Daten.",
        500,
      ),
    );
  }

  await protokolliere({
    aktion: "BANKVERBINDUNG_EINGESEHEN",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    // Ohne Namen: Die Person steht über objektId fest, und ein Name im
    // unlöschbaren Protokoll überlebte jede Anonymisierung (Code-Review 4, M6c).
    headers: request.headers,
  });

  return ohneCache(erfolg({ iban, kontoinhaber: person.kontoinhaber }));
}
