/**
 * GBS Campus — Stundenplan & Anwesenheit: Datenbank-Operationen
 *
 * Der IO-Teil zu `stundenplan.ts` (dort die DB-freie Kernlogik): die
 * Dienstagabende eines Semesters anlegen, die Anwesenheit erfassen und die
 * Quoten-Übersicht laden.
 */

import { Anwesenheitsstatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { zahl } from "@/lib/einstellungen";
import { anwesenheitsquote, dienstagstermine, terminText } from "@/lib/stundenplan";
import { darfSelbstSetzen, istSelbstStatusErlaubt, terminVergangen, type SelbstStatus } from "@/lib/selbstbestaetigung";

export type GenerierErgebnis = { fehler: "semester_fehlt" } | { angelegt: number; uebersprungen: number };

/**
 * Legt die `anzahl` Dienstagabende eines Semesters an (ab dem Semesterbeginn,
 * wöchentlich). Idempotent: bereits vorhandene Abende (gleicher Zeitpunkt) werden
 * übersprungen — ein zweiter Aufruf legt nichts doppelt an und rührt bestehende
 * Anwesenheiten nicht an.
 */
export async function generiereDienstagstermine(
  semesterId: string,
  anzahl: number,
  akteurId: string,
  headers: Headers,
): Promise<GenerierErgebnis> {
  const semester = await prisma.semester.findUnique({
    where: { id: semesterId },
    select: { id: true, code: true, start: true },
  });
  if (!semester) return { fehler: "semester_fehlt" };

  const gewuenscht = dienstagstermine(semester.start, anzahl);
  const vorhanden = new Set(
    (await prisma.unterrichtstermin.findMany({ where: { semesterId }, select: { beginn: true } })).map((t) =>
      t.beginn.getTime(),
    ),
  );
  const neu = gewuenscht.filter((d) => !vorhanden.has(d.getTime()));

  if (neu.length > 0) {
    const bisher = vorhanden.size;
    await prisma.unterrichtstermin.createMany({
      data: neu.map((beginn, i) => ({ semesterId, beginn, reihenfolge: bisher + i })),
    });
  }

  await protokolliere({
    aktion: "STUNDENPLAN_TERMINE_GENERIERT",
    objektTyp: "Semester",
    objektId: semesterId,
    akteurId,
    nachher: { code: semester.code, angelegt: neu.length },
    headers,
  });

  return { angelegt: neu.length, uebersprungen: gewuenscht.length - neu.length };
}

export type AnwesenheitEintrag = { teilnahmeId: string; status: Anwesenheitsstatus };
export type ErfassErgebnis = { fehler: "termin_fehlt" } | { gesetzt: number };

/**
 * Erfasst die Anwesenheit für einen Termin, mehrere Teilnehmer auf einmal.
 * Upsert je (Termin, Teilnahme) — idempotent und ohne Doppelzeilen. Nur
 * Teilnahmen desselben Semesters werden angenommen (kein Eintrag für eine
 * fremde Teilnahme).
 */
export async function erfasseAnwesenheit(
  terminId: string,
  eintraege: AnwesenheitEintrag[],
  akteurId: string,
  headers: Headers,
): Promise<ErfassErgebnis> {
  const termin = await prisma.unterrichtstermin.findUnique({
    where: { id: terminId },
    select: { id: true, semesterId: true },
  });
  if (!termin) return { fehler: "termin_fehlt" };

  const gueltig = new Set(
    (await prisma.teilnahme.findMany({ where: { semesterId: termin.semesterId }, select: { id: true } })).map(
      (t) => t.id,
    ),
  );

  let gesetzt = 0;
  for (const eintrag of eintraege) {
    if (!gueltig.has(eintrag.teilnahmeId)) continue;
    await prisma.anwesenheit.upsert({
      where: { terminId_teilnahmeId: { terminId, teilnahmeId: eintrag.teilnahmeId } },
      update: { status: eintrag.status, erfasstVonId: akteurId },
      create: { terminId, teilnahmeId: eintrag.teilnahmeId, status: eintrag.status, erfasstVonId: akteurId },
    });
    gesetzt++;
  }

  await protokolliere({
    aktion: "ANWESENHEIT_ERFASST",
    objektTyp: "Unterrichtstermin",
    objektId: terminId,
    akteurId,
    nachher: { gesetzt },
    headers,
  });

  return { gesetzt };
}

/**
 * Quoten-Übersicht eines Semesters: je aktivem Teilnehmer die Anwesenheitsquote
 * über die erfassten Termine. Die Schwelle kommt aus der Einstellung.
 */
export async function ladeAnwesenheitsUebersicht(semesterId: string) {
  const schwelle = await zahl("ANWESENHEIT_MINDEST_PROZENT");
  const gesamtTermine = await prisma.unterrichtstermin.count({ where: { semesterId } });

  const teilnahmen = await prisma.teilnahme.findMany({
    where: { semesterId, person: { status: { istAktiv: true } } },
    select: {
      id: true,
      person: { select: { vorname: true, nachname: true } },
      anwesenheiten: { select: { status: true } },
    },
    orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
  });

  return {
    schwelle,
    gesamtTermine,
    zeilen: teilnahmen.map((t) => ({
      teilnahmeId: t.id,
      name: `${t.person.nachname}, ${t.person.vorname}`,
      quote: anwesenheitsquote(
        t.anwesenheiten.map((a) => a.status),
        schwelle,
      ),
    })),
  };
}

// =============================================================================
// Selbstbestätigung — der Teilnehmer meldet sich selbst anwesend/nachgearbeitet
// =============================================================================

export type EigenerTermin = {
  id: string;
  text: string;
  fach: string | null;
  status: Anwesenheitsstatus | null;
  /** Ob der Teilnehmer diesen Abend selbst (neu) bestätigen/ändern darf. Ist er
   * false, hat die Verwaltung den Abend erfasst — für den Teilnehmer read-only. */
  darfBestaetigen: boolean;
};

export type EigeneTerminGruppe = {
  semesterBezeichnung: string;
  teilnahmeId: string;
  termine: EigenerTermin[];
};

/**
 * Die vergangenen Unterrichtsabende der eigenen Teilnahmen mit dem jeweils
 * erfassten Status — für die Selbstbestätigung in `/meine-daten`. Zukünftige
 * Abende bleiben außen vor (man bestätigt keine Anwesenheit im Voraus).
 * Gruppiert nach Semester (neuestes zuerst); Semester ohne vergangene Abende
 * fallen weg.
 */
export async function ladeEigeneUnterrichtstermine(personId: string, jetzt: Date): Promise<EigeneTerminGruppe[]> {
  const teilnahmen = await prisma.teilnahme.findMany({
    where: { personId },
    select: { id: true, semesterId: true, semester: { select: { bezeichnung: true, start: true } } },
    orderBy: { semester: { start: "desc" } },
  });
  if (teilnahmen.length === 0) return [];

  const semesterIds = teilnahmen.map((t) => t.semesterId);
  const teilnahmeIds = teilnahmen.map((t) => t.id);

  const termine = await prisma.unterrichtstermin.findMany({
    where: { semesterId: { in: semesterIds }, beginn: { lte: jetzt } },
    orderBy: { beginn: "asc" },
    select: { id: true, semesterId: true, beginn: true, kurseinheit: { select: { titel: true } } },
  });
  if (termine.length === 0) return [];

  // Anwesenheiten nur der eigenen Teilnahmen zu diesen Abenden. Da jeder Abend zu
  // genau einem Semester gehört und die Person je Semester höchstens eine
  // Teilnahme hat, ist die Zuordnung Termin → eigener Eintrag eindeutig.
  const anwesenheiten = await prisma.anwesenheit.findMany({
    where: { terminId: { in: termine.map((t) => t.id) }, teilnahmeId: { in: teilnahmeIds } },
    select: { terminId: true, status: true, erfasstVonId: true },
  });
  const proTermin = new Map(anwesenheiten.map((a) => [a.terminId, a]));

  const gruppen: EigeneTerminGruppe[] = teilnahmen.map((t) => ({
    semesterBezeichnung: t.semester.bezeichnung,
    teilnahmeId: t.id,
    termine: termine
      .filter((termin) => termin.semesterId === t.semesterId)
      .map((termin) => {
        const eintrag = proTermin.get(termin.id) ?? null;
        return {
          id: termin.id,
          text: terminText(termin.beginn),
          fach: termin.kurseinheit?.titel ?? null,
          status: eintrag?.status ?? null,
          darfBestaetigen: darfSelbstSetzen(eintrag, personId),
        };
      }),
  }));

  // Semester ohne vergangene Abende zeigen wir nicht.
  return gruppen.filter((g) => g.termine.length > 0);
}

export type SelbstBestaetigErgebnis =
  | { fehler: "status_ungueltig" | "termin_fehlt" | "nicht_eingeschrieben" | "zukunft" | "fremd_erfasst" }
  | { ok: true; status: SelbstStatus };

/**
 * Selbstbestätigung eines einzelnen Abends durch den Teilnehmer. Prüft die drei
 * Regeln aus `selbstbestaetigung.ts` (erlaubter Status, Abend liegt in der
 * Vergangenheit, kein fremder Eintrag) und setzt die Anwesenheit per Upsert —
 * mit `erfasstVonId = personId`, damit später erkennbar bleibt, dass der Eintrag
 * vom Teilnehmer stammt.
 */
export async function bestaetigeEigeneAnwesenheit(
  personId: string,
  terminId: string,
  status: string,
  headers: Headers,
): Promise<SelbstBestaetigErgebnis> {
  if (!istSelbstStatusErlaubt(status)) return { fehler: "status_ungueltig" };

  const termin = await prisma.unterrichtstermin.findUnique({
    where: { id: terminId },
    select: { id: true, semesterId: true, beginn: true },
  });
  if (!termin) return { fehler: "termin_fehlt" };
  if (!terminVergangen(termin.beginn, new Date())) return { fehler: "zukunft" };

  const teilnahme = await prisma.teilnahme.findUnique({
    where: { personId_semesterId: { personId, semesterId: termin.semesterId } },
    select: { id: true },
  });
  if (!teilnahme) return { fehler: "nicht_eingeschrieben" };

  const vorhanden = await prisma.anwesenheit.findUnique({
    where: { terminId_teilnahmeId: { terminId, teilnahmeId: teilnahme.id } },
    select: { erfasstVonId: true },
  });
  if (!darfSelbstSetzen(vorhanden, personId)) return { fehler: "fremd_erfasst" };

  // Bedingter Write statt eines Upserts: Der Update-Zweig darf NUR die eigene
  // Zeile treffen (`erfasstVonId = personId`). Sonst gäbe es zwischen der Prüfung
  // oben und dem Schreiben ein Zeitfenster, in dem die Verwaltung parallel einen
  // Eintrag setzt — ein bedingungsloses Upsert würde ihn überschreiben und dem
  // Teilnehmer zuschreiben und so die Schreibsperre (Regel 3) unterlaufen.
  // Trifft der Update nichts, wird eingefügt; entstand in der Lücke doch ein
  // fremder Eintrag, läuft der Insert in die Unique-Verletzung (P2002) und wird
  // als fremd_erfasst gemeldet — der fremde Eintrag bleibt unangetastet.
  const aktualisiert = await prisma.anwesenheit.updateMany({
    where: { terminId, teilnahmeId: teilnahme.id, erfasstVonId: personId },
    data: { status },
  });
  if (aktualisiert.count === 0) {
    try {
      await prisma.anwesenheit.create({
        data: { terminId, teilnahmeId: teilnahme.id, status, erfasstVonId: personId },
      });
    } catch (ausnahme) {
      if (!(ausnahme instanceof Prisma.PrismaClientKnownRequestError)) throw ausnahme;

      // Termin oder Teilnahme wurde in der Lücke gelöscht (Fremdschlüssel greift
      // ins Leere) — dann gibt es diesen Abend nicht mehr, sauberes 404 statt 500.
      if (ausnahme.code === "P2003" || ausnahme.code === "P2025") return { fehler: "termin_fehlt" };

      // Unique-Verletzung: in der Lücke ist doch eine Zeile entstanden. Stammt sie
      // von der Verwaltung, bleibt sie gesperrt (fremd_erfasst). Ein paralleler
      // Doppelklick des Teilnehmers selbst (zwei Tabs) darf dagegen durchgehen —
      // sonst meldete er fälschlich „die Schule hat erfasst", obwohl es sein
      // eigener Eintrag ist; sein Status wird dann noch gesetzt.
      if (ausnahme.code === "P2002") {
        const jetztVorhanden = await prisma.anwesenheit.findUnique({
          where: { terminId_teilnahmeId: { terminId, teilnahmeId: teilnahme.id } },
          select: { erfasstVonId: true },
        });
        if (!darfSelbstSetzen(jetztVorhanden, personId)) return { fehler: "fremd_erfasst" };
        await prisma.anwesenheit.updateMany({
          where: { terminId, teilnahmeId: teilnahme.id, erfasstVonId: personId },
          data: { status },
        });
      } else {
        throw ausnahme;
      }
    }
  }

  await protokolliere({
    aktion: "ANWESENHEIT_SELBST_BESTAETIGT",
    objektTyp: "Unterrichtstermin",
    objektId: terminId,
    akteurId: personId,
    nachher: { status },
    headers,
  });

  return { ok: true, status };
}
