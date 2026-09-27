import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT, STATUS } from "@/lib/constants";
import { istNameGueltig } from "@/lib/benutzerverwaltung";
import { pruefeEigeneDaten } from "@/lib/eigene-daten";
import { geaenderteFeldnamen } from "@/lib/anonymisierung";

const schema = z.object({
  vorname: z.string(),
  nachname: z.string(),
  telefon: z.string().nullish(),
  strasse: z.string().nullish(),
  plz: z.string().nullish(),
  ort: z.string().nullish(),
});

/**
 * Ändert Name und Kontaktdaten einer FREMDEN Person (Recht PERSON_BEARBEITEN_ALLE
 * — Verwaltung/Schulleitung). Bewusst NICHT dabei: E-Mail (eigener Bestätigungsweg,
 * `/api/personen/[id]/email`), Bankverbindung (`/api/personen/[id]/bankverbindung`,
 * verschlüsselt), sowie Geburtsdatum, Gemeinde, Status und Teilnahmeform — die
 * hängen an der Aufnahmeentscheidung bzw. der Statusmaschine und laufen über
 * `/api/personen/[id]/ausbildungsdaten` und `/api/personen/[id]/status` (Recht
 * PERSON_STATUS_WECHSELN, nur die Schulleitung).
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_BEARBEITEN_ALLE);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;
  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const nameMeldungen = [];
  if (!istNameGueltig(geprueft.data.vorname)) nameMeldungen.push({ feld: "vorname", meldung: "Bitte einen Vornamen angeben (1 bis 80 Zeichen)." });
  if (!istNameGueltig(geprueft.data.nachname)) nameMeldungen.push({ feld: "nachname", meldung: "Bitte einen Nachnamen angeben (1 bis 80 Zeichen)." });

  // Kontaktfelder mit derselben Prüfung wie die Selbstpflege (Telefonmuster,
  // Längen). Bank- und IBAN-Felder werden bewusst nicht mitgeschickt.
  const kontakt = pruefeEigeneDaten({
    telefon: geprueft.data.telefon,
    strasse: geprueft.data.strasse,
    plz: geprueft.data.plz,
    ort: geprueft.data.ort,
  });
  // Erst die Kontaktprüfung (narrowt `kontakt` für die Werte unten), dann die
  // Namen — beide Fehlerlisten werden zusammen gemeldet.
  if (!kontakt.ok) return fehler("Bitte prüfen Sie die markierten Felder.", 400, [...nameMeldungen, ...kontakt.meldungen]);
  if (nameMeldungen.length > 0) return fehler("Bitte prüfen Sie die markierten Felder.", 400, nameMeldungen);

  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true, vorname: true, nachname: true, telefon: true, strasse: true, plz: true, ort: true, status: { select: { code: true } } },
  });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);
  if (person.status.code === STATUS.ANONYMISIERT) {
    return fehler("Eine anonymisierte Person lässt sich nicht bearbeiten.", 409);
  }

  const nachher = {
    vorname: geprueft.data.vorname.trim(),
    nachname: geprueft.data.nachname.trim(),
    telefon: kontakt.werte.telefon,
    strasse: kontakt.werte.strasse,
    plz: kontakt.werte.plz,
    ort: kontakt.werte.ort,
  };
  const vorher = { vorname: person.vorname, nachname: person.nachname, telefon: person.telefon, strasse: person.strasse, plz: person.plz, ort: person.ort };

  // Bedingt statt Prüfen-dann-Schreiben: Committet zwischen dem Lesen oben und
  // hier eine Anonymisierung, schrieben wir Name und Anschrift sonst in den
  // gerade gelöschten Datensatz zurück.
  const geschrieben = await prisma.person.updateMany({
    where: { id: person.id, statusCode: { not: STATUS.ANONYMISIERT } },
    data: nachher,
  });
  if (geschrieben.count !== 1) return fehler("Diese Person wurde gerade anonymisiert.", 409);

  await protokolliere({
    aktion: "PERSON_STAMMDATEN_GEAENDERT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    // Nur die Namen der geänderten Felder, nie die Werte (Code-Review 4, M6c):
    // Das Audit-Log ist unlöschbar, Name und Anschrift gehören in die Akte —
    // dort erfasst sie eine Anonymisierung, hier nicht mehr.
    nachher: { geaenderteFelder: geaenderteFeldnamen(vorher, nachher) },
    headers: request.headers,
  });

  return erfolg({ gespeichert: true });
}
