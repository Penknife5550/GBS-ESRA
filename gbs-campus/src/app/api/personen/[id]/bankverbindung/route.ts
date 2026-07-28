import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { entschluesseln } from "@/lib/encryption";

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
 *  2. **Auf Anforderung, nicht nebenbei.** Die Liste zeigt nur die letzten vier
 *     Stellen. Der Klartext kommt erst über diesen Aufruf — er steht also nie
 *     beiläufig auf einem Bildschirm, den jemand von der Seite sieht.
 *  3. **Jeder Zugriff wird protokolliert**, mit Akteur, Zeitpunkt und IP. Das
 *     Audit-Log ist append-only; wer wann welche Bankverbindung eingesehen hat,
 *     lässt sich nachträglich nicht mehr entfernen.
 */
export async function GET(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht("BANKVERBINDUNG_LESEN");
  if (!benutzer) return keineBerechtigung();

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true, vorname: true, nachname: true, kontoinhaber: true, ibanVerschluesselt: true },
  });

  if (!person) return fehler("Diese Person gibt es nicht.", 404);
  if (!person.ibanVerschluesselt) {
    return fehler("Für diese Person ist keine Bankverbindung hinterlegt.", 404);
  }

  let iban: string;
  try {
    iban = entschluesseln(person.ibanVerschluesselt);
  } catch (ausnahme) {
    // Passiert, wenn der ENCRYPTION_KEY nicht zu den Daten passt — etwa nach
    // einem Restore mit dem falschen Schlüssel. Das muss laut auffallen, nicht
    // als leeres Feld erscheinen.
    console.error("[BANKVERBINDUNG] Entschlüsselung fehlgeschlagen für", person.id, ausnahme);
    return fehler(
      "Die Bankverbindung ist nicht lesbar. Vermutlich passt der Verschlüsselungsschlüssel nicht zu den Daten.",
      500,
    );
  }

  await protokolliere({
    aktion: "BANKVERBINDUNG_EINGESEHEN",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    nachher: { person: `${person.vorname} ${person.nachname}` },
    headers: request.headers,
  });

  return erfolg({ iban, kontoinhaber: person.kontoinhaber });
}
