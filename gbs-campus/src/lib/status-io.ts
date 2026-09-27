/**
 * GBS Campus — Statuswechsel: Datenbank
 *
 * Der eine Weg, auf dem sich der Status einer Person ändert (Code-Review 4,
 * M9). Vorher stand „person.update + statusWechsel.create" viermal im Code —
 * Anmeldung, Aufnahme, Anlegen von Hand, Anonymisierung —, jedes Mal ohne
 * Bedingung: Wer zwischen Lesen und Schreiben den Status geändert hatte, wurde
 * still überschrieben. Genau so ließ sich eine anonymisierte Person über ihre
 * offene Anmeldung wieder „aufnehmen" (M7).
 *
 * Deshalb hier: bedingtes `updateMany` auf den erwarteten Ausgangsstatus und
 * die StatusWechsel-Zeile in derselben Transaktion. Die Regeln für einen
 * Wechsel von Hand stehen DB-frei in `status.ts`.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { ROLLE } from "@/lib/constants";
import { darfAusEndzustand } from "@/lib/status";

type Tx = Prisma.TransactionClient;

/**
 * Wie viele ANDERE Konten tragen die Rolle Administrator und kommen selbst noch
 * hinein (kein Endzustand)? Grundlage der Wache „letzter Administrator"
 * (`waereLetzterAdmin` in `benutzerverwaltung.ts`) — für Rollenentzug,
 * Statuswechsel in einen Endzustand und Anonymisierung dieselbe Zählung.
 */
export async function zaehleAndereAdmins(personId: string, db: Tx = prisma): Promise<number> {
  return db.personRolle.count({
    where: { rolleCode: ROLLE.ADMIN, personId: { not: personId }, person: { status: { istTerminal: false } } },
  });
}

export type WechselEingabe = {
  personId: string;
  /** Der Status, in dem der Aufrufer die Person angetroffen hat. Geschrieben wird nur, wenn er noch stimmt. */
  vonCode: string;
  nachCode: string;
  grund?: string | null;
  akteurId?: string | null;
  /** true, wenn ein Job statt eines Menschen den Wechsel auslöst. */
  automatisch?: boolean;
  headers?: Headers;
  /**
   * Läuft der Wechsel in der Transaktion des Aufrufers, schreibt der Aufrufer
   * das Audit nach dem Commit — `protokolliere` schreibt außerhalb der
   * Transaktion und stünde sonst auch bei einem Rollback im Protokoll. Die
   * bisherigen Aufrufer (Aufnahme, Anonymisierung) nennen den Personenstatus in
   * ihrem eigenen Eintrag ohnehin schon.
   */
  tx?: Tx;
};

export type WechselErgebnis =
  | { ok: true; vonCode: string; nachCode: string }
  | {
      ok: false;
      /**
       * gleichzeitig: Person fehlt oder steht nicht mehr im erwarteten Status;
       * endzustand: aus dem Ausgangsstatus führt kein Weg heraus;
       * status_unbekannt: den Zielstatus gibt es in der Tabelle nicht.
       */
      grund: "gleichzeitig" | "endzustand" | "status_unbekannt";
    };

/** Die eine Stelle, die eine StatusWechsel-Zeile schreibt. */
async function schreibeWechsel(
  tx: Tx,
  e: { personId: string; vonCode: string | null; nachCode: string; grund?: string | null; akteurId?: string | null; automatisch?: boolean },
): Promise<void> {
  await tx.statusWechsel.create({
    data: {
      personId: e.personId,
      vonCode: e.vonCode,
      nachCode: e.nachCode,
      grund: e.grund ?? null,
      ausgeloestVonId: e.akteurId ?? null,
      automatisch: e.automatisch ?? false,
    },
  });
}

async function wechsleInTransaktion(tx: Tx, e: WechselEingabe): Promise<WechselErgebnis> {
  const ziel = await tx.teilnehmerStatus.findUnique({ where: { code: e.nachCode }, select: { code: true } });
  if (!ziel) return { ok: false, grund: "status_unbekannt" };

  const von = await tx.teilnehmerStatus.findUnique({ where: { code: e.vonCode }, select: { istTerminal: true } });
  if (von?.istTerminal && !darfAusEndzustand(e.nachCode)) return { ok: false, grund: "endzustand" };

  // Die Bedingung steht IN der schreibenden Anweisung: Nur wer die Person noch
  // im gelesenen Status antrifft, gewinnt. Ein zweiter Tab, eine zeitgleiche
  // Anonymisierung oder Aufnahme bekommt count 0 statt eines stillen Überschreibens.
  const geaendert = await tx.person.updateMany({
    where: { id: e.personId, statusCode: e.vonCode },
    data: { statusCode: e.nachCode },
  });
  if (geaendert.count !== 1) return { ok: false, grund: "gleichzeitig" };

  await schreibeWechsel(tx, e);
  return { ok: true, vonCode: e.vonCode, nachCode: e.nachCode };
}

/**
 * Wechselt den Status einer Person — bedingt auf den erwarteten Ausgangsstatus,
 * mit StatusWechsel-Zeile in derselben Transaktion. Ohne `tx` öffnet die
 * Funktion eine eigene Transaktion und protokolliert danach STATUS_GEWECHSELT;
 * mit `tx` läuft sie in der des Aufrufers (siehe `WechselEingabe.tx`).
 *
 * Wirft nicht bei fachlichem Nein — der Aufrufer bekommt den Grund und
 * entscheidet (in einer fremden Transaktion typischerweise: werfen und damit
 * zurückrollen).
 */
export async function wechsleStatus(e: WechselEingabe): Promise<WechselErgebnis> {
  if (e.tx) return wechsleInTransaktion(e.tx, e);

  const ergebnis = await prisma.$transaction((tx) => wechsleInTransaktion(tx, e));
  if (ergebnis.ok) {
    await protokolliere({
      aktion: "STATUS_GEWECHSELT",
      objektTyp: "Person",
      objektId: e.personId,
      akteurId: e.akteurId ?? null,
      vorher: { status: e.vonCode },
      // Der Grund ist Freitext und kann Personenbezug tragen („verstorben laut
      // Mitteilung der Ehefrau …"). Er steht in `status_wechsel` (dort erfasst
      // ihn die Anonymisierung) — ins unlöschbare Protokoll gehört nur, DASS
      // einer angegeben wurde.
      nachher: { status: e.nachCode, grundAngegeben: Boolean(e.grund) },
      headers: e.headers,
    });
  }
  return ergebnis;
}

/**
 * Hält den ERSTEN Status einer Person fest, die der Aufrufer in derselben
 * Transaktion gerade mit genau diesem `statusCode` angelegt hat (Anmeldung →
 * INTERESSENT, Anlegen von Hand → AKTIV). Es gibt nichts bedingt umzuschreiben;
 * die Akte soll aber lückenlos zeigen, wie jemand in seinen Zustand kam.
 */
export async function erfasseErstenStatus(
  tx: Tx,
  e: { personId: string; nachCode: string; grund: string; akteurId?: string | null; automatisch?: boolean },
): Promise<void> {
  await schreibeWechsel(tx, { ...e, vonCode: null });
}
