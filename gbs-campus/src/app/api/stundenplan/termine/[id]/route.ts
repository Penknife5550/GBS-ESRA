import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { pruefeZugriff } from "@/lib/berechtigung";
import { protokolliere } from "@/lib/audit";
import { erfolg, fehler } from "@/lib/api";
import { RECHT } from "@/lib/constants";
import { istDozent } from "@/lib/honorar-io";
import { dozentWechselSperre } from "@/lib/honorar-korrektur";

const putSchema = z.object({
  kurseinheitId: z.string().uuid().nullable().optional(),
  dozentId: z.string().uuid().nullable().optional(),
  thema: z.string().max(200).nullable().optional(),
});

/** Ordnet einem Termin ein Fach (Kurseinheit), einen Dozenten und/oder ein Thema zu. */
export async function PUT(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;
  const geprueft = putSchema.safeParse(await request.json().catch(() => null));
  if (!geprueft.success) return fehler("Ungültige Anfrage.", 400);

  const daten: { kurseinheitId?: string | null; dozentId?: string | null; thema?: string | null } = {};
  if (geprueft.data.kurseinheitId !== undefined) {
    // Nicht-null muss existieren, sonst gäbe der Fremdschlüssel einen 500.
    if (geprueft.data.kurseinheitId !== null) {
      const kurseinheit = await prisma.kurseinheit.findUnique({
        where: { id: geprueft.data.kurseinheitId },
        select: { id: true },
      });
      if (!kurseinheit) return fehler("Diese Kurseinheit gibt es nicht.", 400);
    }
    daten.kurseinheitId = geprueft.data.kurseinheitId;
  }
  if (geprueft.data.dozentId !== undefined) {
    // Nur eine Person mit der Rolle Dozent lässt sich zuordnen — sonst wäre die
    // Honorar-Übersicht eine Zuordnung an beliebige Konten.
    if (geprueft.data.dozentId !== null && !(await istDozent(geprueft.data.dozentId))) {
      return fehler("Diese Person ist kein Dozent.", 400);
    }
    daten.dozentId = geprueft.data.dozentId;
  }
  if (geprueft.data.thema !== undefined) {
    daten.thema = geprueft.data.thema?.trim() || null;
  }

  // Ein bereits abgerechneter Abend darf keinem anderen Dozenten zugeordnet
  // werden — dieselbe Sperre wie im DELETE (M11). Sonst bliebe der eingefrorene
  // Posten in der Abrechnung des bisherigen Dozenten; beim neuen zählte der Abend
  // als gehalten, ließe sich aber nie abrechnen (terminId ist @unique). Gesperrt
  // wird nur eine echte Änderung der Zuordnung (dozentWechselSperre): Die
  // Stundenplan-Seite schickt Fach und Dozent immer gemeinsam.
  //
  // Die anderen Felder bleiben frei: kurseinheitId ist honorar-neutral (der
  // Betrag hängt nur am Datum, das Fach steht eingefroren im Posten), thema
  // ebenso. `beginn` lässt sich über diese Route gar nicht ändern (fehlt im
  // Schema) — käme es hinzu, müsste es genauso gesperrt werden, weil Satz und
  // „gehalten“ am Datum hängen und der Posten das Datum eingefroren hat.
  //
  // Zeilensperre (FOR UPDATE) statt Prüfen-dann-Schreiben: Ein paralleles
  // Abrechnen legt seinen Posten mit Fremdschlüssel-Sperre auf diesen Termin an —
  // entweder wartet es auf uns (und seine Gegenprobe sieht den neuen Dozenten),
  // oder wir warten auf es und sehen danach den Posten. Die gesperrte Zeile kann
  // auch nicht mehr verschwinden, deshalb ist das update danach sicher.
  const ausgang = await prisma.$transaction(async (tx) => {
    const zeilen = await tx.$queryRaw<{ dozentId: string | null }[]>`
      SELECT "dozentId" FROM "unterrichtstermine" WHERE "id" = ${id} FOR UPDATE`;
    if (zeilen.length === 0) return { art: "fehlt" as const };

    if (daten.dozentId !== undefined) {
      const posten = await tx.honorarAbrechnungPosten.findUnique({
        where: { terminId: id },
        select: { abrechnung: { select: { status: true } } },
      });
      const sperre = dozentWechselSperre(zeilen[0].dozentId, daten.dozentId, posten?.abrechnung.status ?? null);
      if (sperre) return { art: "gesperrt" as const, meldung: sperre };
    }

    await tx.unterrichtstermin.update({ where: { id }, data: daten });
    return { art: "geaendert" as const };
  });
  if (ausgang.art === "fehlt") return fehler("Diesen Termin gibt es nicht.", 404);
  if (ausgang.art === "gesperrt") return fehler(ausgang.meldung, 409);

  await protokolliere({
    aktion: "STUNDENPLAN_TERMIN_GEAENDERT",
    objektTyp: "Unterrichtstermin",
    objektId: id,
    akteurId: benutzer.id,
    nachher: daten,
    headers: request.headers,
  });

  return erfolg({ ok: true });
}

/** Löscht einen Termin (samt seiner Anwesenheiten über Cascade). */
export async function DELETE(request: NextRequest, kontext: { params: Promise<{ id: string }> }) {
  const benutzer = await pruefeZugriff(RECHT.SEMESTER_VERWALTEN);
  if (benutzer instanceof Response) return benutzer;

  const { id } = await kontext.params;

  // Ein bereits abgerechneter Abend darf nicht gelöscht werden: die FK zum
  // Abrechnungsposten ist Restrict, ein DELETE liefe sonst in einen FK-Fehler
  // (500). Vorher sauber prüfen und mit 409 abweisen (kein Doppel-Honorar durch
  // Löschen und Neu-Anlegen).
  const abgerechnet = await prisma.honorarAbrechnungPosten.findUnique({
    where: { terminId: id },
    select: { id: true },
  });
  if (abgerechnet) {
    return fehler("Dieser Abend ist bereits abgerechnet und kann nicht gelöscht werden.", 409);
  }

  const geloescht = await prisma.unterrichtstermin.deleteMany({ where: { id } });
  if (geloescht.count === 0) return fehler("Diesen Termin gibt es nicht.", 404);

  await protokolliere({
    aktion: "STUNDENPLAN_TERMIN_GELOESCHT",
    objektTyp: "Unterrichtstermin",
    objektId: id,
    akteurId: benutzer.id,
    headers: request.headers,
  });

  return erfolg({ ok: true });
}
