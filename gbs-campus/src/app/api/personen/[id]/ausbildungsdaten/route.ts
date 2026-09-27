import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT, STATUS } from "@/lib/constants";
import { art9EinwilligungenWirksam } from "@/lib/anmeldung-antworten";
import { alsHeutigerTag } from "@/lib/semester";
import { pruefeAusbildungsdaten } from "@/lib/status";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";

// Ein fehlendes Feld bleibt unverändert, leer oder null leert es. Die
// eigentliche Prüfung (Datum, Länge, Einwilligung) steht in `status.ts`.
const schema = z.object({
  geburtsdatum: z.string().max(20).nullish(),
  gemeinde: z.string().max(500).nullish(),
  teilnahmeform: z.string().max(20).nullish(),
});

/**
 * Ändert die Ausbildungsdaten einer Person: Geburtsdatum, Gemeinde und
 * Teilnahmeform (Code-Review 4, M9). Gleiches Recht wie der Statuswechsel —
 * PERSON_STATUS_WECHSELN, nur die Schulleitung —, weil diese Angaben an der
 * Aufnahmeentscheidung hängen und auf jedem Zeugnis stehen.
 *
 * Die Teilnahmeform steht an der Person (Grundlage für künftige Aufnahmen) und
 * an jeder Teilnahme (Prüfungspflicht, Zeugnistyp). Geändert werden in einer
 * Transaktion die Person und ihre OFFENEN Teilnahmen: die des laufenden
 * Semesters und die schon angelegten für noch nicht begonnene Semester — die
 * Semesterüberleitung und eine Aufnahme für das nächste Semester legen sie vor
 * Semesterstart mit der bisherigen Form an. Vergangene Semester bleiben, wie
 * sie waren. Abgemeldete Teilnahmen desselben Zeitraums zählen für die Regel
 * nicht (`TEILNAHME_ZAEHLT` — sie verlangen keine festgelegte Form), gehen beim
 * Wechsel aber mit: Nimmt die Schulleitung eine solche Teilnahme wieder auf,
 * gilt sonst die alte Form.
 *
 * Ins Audit gehen nur die Namen der geänderten Felder, nie die Werte
 * (Code-Review 4, M6c) — Geburtsdatum und Gemeinde (Art. 9) überlebten dort
 * jede Anonymisierung.
 */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.PERSON_STATUS_WECHSELN);
  if (benutzer instanceof Response) return benutzer;

  const geprueft = schema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const { id } = await kontext.params;
  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true, statusCode: true, geburtsdatum: true, gemeinde: true, teilnahmeform: true },
  });
  if (!person) return fehler("Diese Person gibt es nicht.", 404);
  if (person.statusCode === STATUS.ANONYMISIERT) {
    return fehler("Eine anonymisierte Person lässt sich nicht bearbeiten.", 409);
  }

  // Kalendertag wie überall im Haus: aus der örtlichen Angabe (Europe/Berlin), in UTC gerechnet.
  const heute = alsHeutigerTag(new Date());
  // Der Zeitraum, für den ein Formwechsel mitgilt: das laufende und noch nicht begonnene Semester.
  const zeitraum = { OR: [{ istAktuell: true }, { start: { gt: heute } }] } satisfies Prisma.SemesterWhereInput;
  const [offeneTeilnahmen, abgemeldeteTeilnahmen, art9] = await Promise.all([
    prisma.teilnahme.findMany({
      where: { personId: person.id, ...TEILNAHME_ZAEHLT, semester: zeitraum },
      select: { id: true, teilnahmeform: true },
    }),
    // Nur für den Schreibweg, nicht für die Regel (siehe Kopf).
    prisma.teilnahme.findMany({
      where: { personId: person.id, abgemeldetAm: { not: null }, semester: zeitraum },
      select: { id: true, teilnahmeform: true },
    }),
    // Alle Art.-9-Texte: je Text zählt die jüngste Zeile (erteilt und
    // widerrufen sind je eigene Zeilen), alle müssen wirksam sein — dieselbe
    // Regel wie beim Speichern der Anmeldung (`art9Eingewilligt`).
    prisma.einwilligung.findMany({
      where: { personId: person.id, text: { istArt9: true } },
      select: { erteilt: true, zeitpunkt: true, text: { select: { code: true } } },
    }),
  ]);

  const ergebnis = pruefeAusbildungsdaten(
    geprueft.data,
    {
      geburtsdatum: person.geburtsdatum,
      gemeinde: person.gemeinde,
      teilnahmeform: person.teilnahmeform,
      teilnahmeformenOffen: offeneTeilnahmen.map((t) => t.teilnahmeform),
    },
    {
      heute,
      art9Eingewilligt: art9EinwilligungenWirksam(
        art9.map((e) => ({ erteilt: e.erteilt, zeitpunkt: e.zeitpunkt, code: e.text.code })),
      ),
    },
  );
  if (!ergebnis.ok) return fehler("Bitte prüfen Sie die markierten Felder.", ergebnis.status, ergebnis.meldungen);

  // Die gewählte Form (die Regel oben hat sie schon geprüft: Schüler, Hörer oder leer).
  const gewaehlteForm =
    geprueft.data.teilnahmeform === "SCHUELER" || geprueft.data.teilnahmeform === "HOERER" ? geprueft.data.teilnahmeform : null;
  // Tragen Person und alle zählenden Teilnahmen die gewählte Form schon, kann
  // trotzdem eine abgemeldete Teilnahme des Zeitraums abweichen (Altbestand,
  // Überleitung aus einer abweichenden Quellteilnahme). Die Oberfläche zeigt
  // dann schon die Zielform — es gäbe nichts zu klicken, und nach einer
  // Wiederaufnahme gälte die alte Form. Dann nur die abgemeldeten angleichen.
  const nurAbgemeldete =
    ergebnis.felder.length === 0 &&
    gewaehlteForm !== null &&
    abgemeldeteTeilnahmen.some((t) => t.teilnahmeform !== gewaehlteForm);
  if (ergebnis.felder.length === 0 && !nurAbgemeldete) {
    return erfolg({ gespeichert: true, geaendert: [] as string[], teilnahmenAngepasst: 0 });
  }
  const felder = nurAbgemeldete ? ["teilnahmeform"] : ergebnis.felder;

  // `ergebnis.teilnahmen` ist nur gesetzt, wenn eine ZÄHLENDE Teilnahme
  // abweicht. Ändert sich nur die Form der Person, können trotzdem abgemeldete
  // Teilnahmen des Zeitraums die alte Form tragen — dann gilt der Personenwert,
  // ohne Änderung an der Person die gewählte Form.
  const neueForm = ergebnis.teilnahmen ?? ergebnis.person.teilnahmeform ?? gewaehlteForm;
  const angepasst = await prisma.$transaction(async (tx) => {
    // Bedingt: Wer die Person zeitgleich anonymisiert hat, gewinnt. `data` ist
    // dabei NIE leer — weicht nur eine Teilnahme ab, ist `ergebnis.person` leer,
    // und ein leeres updateMany führt Prisma gar nicht aus (count 0, also ein
    // falsches „gerade anonymisiert"). `aktualisiertAm` hält die Bedingung und
    // die Zeilensperre deshalb in jedem Fall wirksam.
    const geaendert = await tx.person.updateMany({
      where: { id: person.id, statusCode: { not: STATUS.ANONYMISIERT } },
      data: { ...ergebnis.person, aktualisiertAm: new Date() },
    });
    if (geaendert.count !== 1) return null;
    if (!neueForm) return 0;
    const teilnahmen = await tx.teilnahme.updateMany({
      where: {
        id: { in: [...offeneTeilnahmen, ...abgemeldeteTeilnahmen].map((t) => t.id) },
        teilnahmeform: { not: neueForm },
      },
      data: { teilnahmeform: neueForm },
    });
    return teilnahmen.count;
  });
  if (angepasst === null) return fehler("Diese Person wurde gerade anonymisiert.", 409);

  await protokolliere({
    aktion: "PERSON_AUSBILDUNGSDATEN_GEAENDERT",
    objektTyp: "Person",
    objektId: person.id,
    akteurId: benutzer.id,
    nachher: { geaenderteFelder: felder, teilnahmenAngepasst: angepasst },
    headers: request.headers,
  });

  return erfolg({ gespeichert: true, geaendert: felder, teilnahmenAngepasst: angepasst });
}
