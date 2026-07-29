import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler, keineBerechtigung } from "@/lib/api";
import { RECHT, STATUS } from "@/lib/constants";
import { istNameGueltig } from "@/lib/benutzerverwaltung";
import { pruefeEigeneDaten } from "@/lib/eigene-daten";

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
 * hängen an der Aufnahmeentscheidung bzw. der Statusmaschine.
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.PERSON_BEARBEITEN_ALLE);
  if (!benutzer) return keineBerechtigung();

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
  if (!kontakt.ok) return fehler("Bitte prüfe die markierten Felder.", 400, [...nameMeldungen, ...kontakt.meldungen]);
  if (nameMeldungen.length > 0) return fehler("Bitte prüfe die markierten Felder.", 400, nameMeldungen);

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

  await prisma.person.update({ where: { id: person.id }, data: nachher });

  await protokolliere({
    aktion: "PERSON_STAMMDATEN_GEAENDERT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    vorher,
    nachher,
    headers: request.headers,
  });

  return erfolg({ gespeichert: true });
}
