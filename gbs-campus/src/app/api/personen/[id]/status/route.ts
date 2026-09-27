import { NextRequest } from "next/server";
import { z } from "zod";
import { AnmeldungStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { erfolg, fehler } from "@/lib/api";
import { RECHT, ROLLE, STATUS } from "@/lib/constants";
import { MELDUNG_LETZTER_ADMIN, waereLetzterAdmin } from "@/lib/benutzerverwaltung";
import { GRUND_MAX_LAENGE, pruefeStatuswechsel } from "@/lib/status";
import { wechsleStatus, zaehleAndereAdmins } from "@/lib/status-io";

const schema = z.object({
  nachCode: z.string().min(1).max(40),
  // Die Länge prüft `pruefeStatuswechsel` mit deutscher Meldung; hier nur eine
  // grobe Obergrenze gegen übergroße Rümpfe.
  grund: z.string().max(GRUND_MAX_LAENGE * 4).nullish(),
});

/**
 * Wechselt den Status einer Person von Hand (Code-Review 4, M9) — Recht
 * PERSON_STATUS_WECHSELN, laut Seed nur die Schulleitung. Damit greift der
 * „Not-Aus": VERSTORBEN, AUSGESCHLOSSEN und ABGEBROCHEN schalten Beitrag,
 * Automatik-Mails, Listen und den Zugang ab.
 *
 * Regeln (`status.ts`): kein Weg aus einem Endzustand (409), INTERESSENT und
 * ANONYMISIERT sind keine Ziele (400 — Anonymisieren hat seine eigene Route),
 * derselbe Status ist kein Wechsel (400), ein Grund ist Pflicht bei
 * ABGEBROCHEN/AUSGESCHLOSSEN/VERSTORBEN (400). Solange über eine eingereichte
 * Anmeldung nicht entschieden ist, gibt es keinen Wechsel von Hand (409) — er
 * ginge an der Aufnahme vorbei. Den letzten Administrator setzt niemand in einen
 * Endzustand (409, dieselbe Wache wie beim Rollenentzug). Geschrieben wird
 * bedingt auf den gelesenen Status (`wechsleStatus`); wer zeitgleich geändert
 * hat, bekommt 409.
 */
export async function POST(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_STATUS_WECHSELN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: { status: true, rollen: { select: { rolleCode: true } } },
  });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);

  // Den eigenen Status setzt niemand selbst: Ein Endzustand sperrte den
  // Handelnden sofort aus — und mit ihm womöglich die einzige Schulleitung.
  if (person.id === benutzer.id) {
    return fehler("Den eigenen Status können Sie hier nicht ändern.", 403);
  }

  const ziel = await prisma.teilnehmerStatus.findUnique({
    where: { code: geprueft.data.nachCode },
    select: { code: true, bezeichnung: true, istTerminal: true },
  });
  if (!ziel) return fehler("Diesen Status gibt es nicht.", 400);

  // Eine eingereichte Anmeldung gibt es nur bei Interessenten (jede Anmeldung
  // legt eine neue Person an); die Abfrage braucht es also nur dort.
  const offeneAnmeldung =
    person.statusCode === STATUS.INTERESSENT &&
    (await prisma.anmeldung.count({ where: { personId: person.id, status: AnmeldungStatus.EINGEREICHT } })) > 0;

  const regel = pruefeStatuswechsel({
    vonCode: person.statusCode,
    vonIstTerminal: person.status.istTerminal,
    nachCode: ziel.code,
    grund: geprueft.data.grund,
    offeneAnmeldung,
  });
  if (!regel.ok) return fehler(regel.meldung, regel.status);

  // Ein Endzustand sperrt das Konto (Sitzung verfällt, kein Weg zurück). Ist
  // es der letzte Administrator, käme danach niemand mehr an Konten und Rollen.
  const istAdmin = person.rollen.some((r) => r.rolleCode === ROLLE.ADMIN);
  if (
    istAdmin &&
    ziel.istTerminal &&
    waereLetzterAdmin({ istAdmin, verliertZugang: ziel.istTerminal, andereAdmins: await zaehleAndereAdmins(person.id) })
  ) {
    return fehler(MELDUNG_LETZTER_ADMIN, 409);
  }

  const ergebnis = await wechsleStatus({
    personId: person.id,
    vonCode: person.statusCode,
    nachCode: ziel.code,
    grund: regel.grund,
    akteurId: benutzer.id,
    headers: request.headers,
  });

  if (!ergebnis.ok) {
    if (ergebnis.grund === "status_unbekannt") return fehler("Diesen Status gibt es nicht.", 400);
    if (ergebnis.grund === "endzustand") {
      return fehler("Die Person steht in einem Endzustand — daraus führt kein Statuswechsel mehr heraus.", 409);
    }
    return fehler("Der Status dieser Person wurde gerade geändert. Bitte die Seite neu laden.", 409);
  }

  return erfolg({ status: ziel.code, bezeichnung: ziel.bezeichnung, endzustand: ziel.istTerminal });
}
