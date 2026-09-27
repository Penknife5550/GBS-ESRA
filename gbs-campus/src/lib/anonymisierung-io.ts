/**
 * GBS Campus — Anonymisierung (DSGVO Art. 17): Datenbank
 *
 * „Anonymisieren statt Löschen": Der Datensatz bleibt (Audit-Log und
 * Einwilligungen sind append-only und dienen als Nachweis), aber jedes
 * personenbezogene Feld wird überschrieben. Die reine Werte-Logik liegt in
 * `anonymisierung.ts` (ohne DB testbar); hier ist die Transaktion.
 *
 * Code-Review 4 (M6/M7) hat gezeigt, wo die erste Fassung Reste stehen ließ:
 * Zeugnis-Snapshots, Mail-Betreffs an die Verwaltung, offene Anmeldungen,
 * Rollen und Drosselschlüssel mit der Adresse. Wer hier eine Tabelle ergänzt,
 * prüft sie gegen die Löschzusage.
 *
 * Sperrreihenfolge: erst die Zeilen, die an der Person hängen und die andere
 * Wege VOR der Personenzeile sperren (offene Anmeldungen: „Annehmen";
 * Adressänderungen: Bestätigungslink, Adresse durch die Verwaltung), dann die
 * Person selbst (`wechsleStatus`). In umgekehrter Reihenfolge warteten beide
 * Seiten aufeinander, und Postgres bräche eine davon als Deadlock ab.
 */

import { AnmeldungStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { protokolliere } from "@/lib/audit";
import { ROLLE, STATUS } from "@/lib/constants";
import { waereLetzterAdmin } from "@/lib/benutzerverwaltung";
import { SYSTEM_GRUENDE, SYSTEM_GRUND } from "@/lib/status";
import { wechsleStatus, zaehleAndereAdmins } from "@/lib/status-io";
import {
  ANONYM_PLATZHALTER,
  anonymePersonFelder,
  betreffSuchbegriffe,
  scrubbeAntworten,
  scrubbeZeugnisSnapshot,
} from "@/lib/anonymisierung";

export type AnonymErgebnis =
  | { status: "person_fehlt" }
  | { status: "schon_anonym" }
  | { status: "gleichzeitig" }
  | { status: "letzter_admin" }
  | { status: "ok"; anmeldungen: number; zeugnisse: number };

/** Abbruchsignal: Der Status wurde zwischen Lesen und Schreiben geändert (rollt zurück). */
class StatusGeaendert extends Error {}
/** Abbruchsignal: Die Person ist der letzte Administrator (rollt zurück). */
class LetzterAdmin extends Error {}

/**
 * Anonymisiert eine Person unwiderruflich. Erhalten bleiben (als Nachweis, ohne
 * Personenbezug): Audit-Log und Einwilligungen (beide append-only), Teilnahmen,
 * Anwesenheiten, Leistungen und die ausgestellten Zeugnisse (mit Beleg-Nr. und
 * Fächern, aber ohne Name, Geburtsdatum und Storno-Grund). Idempotent: eine bereits
 * anonymisierte Person wird nicht erneut angefasst. Den letzten Administrator
 * anonymisiert niemand (`letzter_admin`) — die Anonymisierung entzieht die
 * Rollen, danach käme niemand mehr an Konten und Rollen.
 */
export async function anonymisierePerson(
  personId: string,
  akteurId: string,
  headers: Headers,
): Promise<AnonymErgebnis> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      statusCode: true,
      vorname: true,
      nachname: true,
      email: true,
      rollen: { select: { rolleCode: true } },
    },
  });
  if (!person) return { status: "person_fehlt" };
  if (person.statusCode === STATUS.ANONYMISIERT) return { status: "schon_anonym" };

  const jetzt = new Date();
  const istAdmin = person.rollen.some((r) => r.rolleCode === ROLLE.ADMIN);
  // Betreffs, die den Namen oder die Adresse tragen — gleich, an wen die Mail
  // ging (siehe `betreffSuchbegriffe`).
  const betreffTreffer: Prisma.EmailVersandWhereInput[] = betreffSuchbegriffe(person).map((gruppe) => ({
    AND: gruppe.map((begriff) => ({ betreff: { contains: begriff, mode: "insensitive" as const } })),
  }));
  // Die Drosseln schreiben die Adresse kleingeschrieben in ihren Schlüssel
  // (`magic-link.ts`, `auth/passwort`); beide Schreibweisen, falls die Akte
  // eine andere trägt.
  const adressen = [...new Set([person.email, person.email.trim().toLowerCase()])];
  const drosselSchluessel = adressen.flatMap((adresse) => [`MAGIC_LINK:${adresse}`, `PASSWORT:${adresse}`]);

  let zahlen: { anmeldungen: number; zeugnisse: number; stornoGruende: number; abgeschlossen: number; rollen: number };
  try {
    zahlen = await prisma.$transaction(async (tx) => {
      // Zuerst, vor jedem Schreiben: Ist das der letzte Administrator? Gezählt
      // IN der Transaktion, wie beim Rollenentzug nur Konten ohne Endzustand.
      if (istAdmin) {
        const andereAdmins = await zaehleAndereAdmins(personId, tx);
        if (waereLetzterAdmin({ istAdmin, verliertZugang: true, andereAdmins })) throw new LetzterAdmin();
      }

      // Freitext-Gründe früherer Statuswechsel (von Hand, siehe `status.ts`)
      // können Personenbezug tragen. Die Gründe des Systems bleiben lesbar.
      await tx.statusWechsel.updateMany({
        where: { personId, grund: { not: null, notIn: SYSTEM_GRUENDE } },
        data: { grund: ANONYM_PLATZHALTER },
      });

      // Offene Anmeldungen schließen (M7) — VOR der Personenzeile, in derselben
      // Reihenfolge wie „Annehmen" (erst die Anmeldung, dann die Person). Sonst
      // stünde eine EINGEREICHTE Anmeldung weiter in der Arbeitsliste, und
      // „Annehmen" höbe den Endzustand wieder auf. Bewusst ohne Mail — die
      // Adresse ist ohnehin nicht mehr zustellbar.
      const abgeschlossen = await tx.anmeldung.updateMany({
        where: { personId, status: { in: [AnmeldungStatus.ENTWURF, AnmeldungStatus.EINGEREICHT] } },
        data: {
          status: AnmeldungStatus.ABGELEHNT,
          entschiedenAm: jetzt,
          entschiedenVonId: akteurId,
          ablehnungsgrund: ANONYM_PLATZHALTER,
          fortsetzenTokenHash: null,
          fortsetzenLaeuftAb: null,
        },
      });

      // Transiente Token-Datensätze mit E-Mail-Bezug entfernen — ebenfalls vor
      // der Personenzeile (Bestätigungslink und Adressänderung sperren erst
      // diese Zeilen, dann die Person).
      await tx.magicLink.deleteMany({ where: { personId } });
      await tx.emailAenderung.deleteMany({ where: { personId } });
      await tx.datenauskunft.deleteMany({ where: { personId } });

      // Status bedingt: Nur wer die Person noch im gelesenen Status antrifft,
      // anonymisiert. Eine zeitgleiche Aufnahme oder ein zweiter Klick bekommt
      // einen Konflikt statt eines halben Zustands. Ab hier ist die
      // Personenzeile bis zum Commit gesperrt — auch gegen eine zeitgleiche
      // Zeugnisausstellung (`zeugnis-io.ts` sperrt dieselbe Zeile).
      const wechsel = await wechsleStatus({
        tx,
        personId,
        vonCode: person.statusCode,
        nachCode: STATUS.ANONYMISIERT,
        grund: SYSTEM_GRUND.ANONYMISIERT,
        akteurId,
      });
      if (!wechsel.ok) throw new StatusGeaendert();

      // Ehepartner-Kopplung beidseitig lösen: die Gegenseite zeigt evtl. auf uns.
      await tx.person.updateMany({ where: { ehepartnerId: personId }, data: { ehepartnerId: null } });

      // Alle personenbezogenen Felder der Person überschreiben. passwortGeaendertAm
      // = jetzt beendet jede laufende Sitzung (siehe `anonymePersonFelder`).
      await tx.person.update({
        where: { id: personId },
        data: anonymePersonFelder(personId, jetzt) as Prisma.PersonUncheckedUpdateInput,
      });

      // Rollen entfernen: Ein anonymisiertes Konto ist niemandes Zugang mehr —
      // auch nicht als „Dozent" in Auswahllisten oder als Empfänger eines Verteilers.
      const rollen = await tx.personRolle.deleteMany({ where: { personId } });

      // Anmelde-Antworten überschreiben (Name, Adresse, IBAN, Art.-9-Angaben) und
      // den Freitext-Ablehnungsgrund leeren. Gelesen IN der Transaktion, nach dem
      // Statuswechsel — so fehlt keine, die kurz vorher entschieden wurde. Die
      // eben geschlossenen behalten den Platzhalter als Grund.
      const anmeldungen = await tx.anmeldung.findMany({
        where: { personId },
        select: { id: true, antworten: true, ablehnungsgrund: true },
      });
      for (const anmeldung of anmeldungen) {
        await tx.anmeldung.update({
          where: { id: anmeldung.id },
          data: {
            antworten: scrubbeAntworten((anmeldung.antworten ?? {}) as Record<string, unknown>),
            ablehnungsgrund: anmeldung.ablehnungsgrund === ANONYM_PLATZHALTER ? ANONYM_PLATZHALTER : null,
          },
        });
      }

      // Ausgestellte Zeugnisse bleiben als Nachweis (Fachentscheidung), aber
      // ohne Name und Geburtsdatum im eingefrorenen Snapshot — sonst lieferte
      // das PDF weiter Klarname plus belegte Bibelschulfächer (Art.-9-Bezug).
      const zeugnisse = await tx.zeugnis.findMany({ where: { personId }, select: { id: true, snapshot: true } });
      for (const zeugnis of zeugnisse) {
        await tx.zeugnis.update({
          where: { id: zeugnis.id },
          data: { snapshot: scrubbeZeugnisSnapshot(zeugnis.snapshot) as Prisma.InputJsonValue },
        });
      }

      // Der Grund eines Stornos ist Freitext der Schulleitung und kann
      // Personenbezug tragen („war gar nicht eingeschrieben, laut Ehefrau …").
      // Der Trigger lässt an ihm genau diesen Platzhalter zu (Migration
      // 20260928100000_zeugnis_storno). Eine Anweisung für alle Zeugnisse der
      // Person: Ein Storno sperrt wie diese Transaktion die Personenzeile, er ist
      // also entweder vorher committet (und hier erfasst) oder wird danach
      // abgelehnt (`stornoSperreFuerPerson`).
      const stornoGruende = await tx.zeugnis.updateMany({
        where: { personId, stornoGrund: { not: null } },
        data: { stornoGrund: ANONYM_PLATZHALTER },
      });

      // Bestätigungslinks der Semesterüberleitung liegen evtl. noch im alten
      // Postfach — ein Klick darauf soll für eine anonymisierte Person nichts mehr bewirken.
      await tx.teilnahme.updateMany({
        where: { personId, bestaetigungTokenHash: { not: null } },
        data: { bestaetigungTokenHash: null, bestaetigungLaeuftAb: null },
      });

      // Drosselzeilen tragen die Adresse im Klartext im Schlüssel und stünden
      // sonst bis zum nächsten Aufräumlauf.
      await tx.rateLimit.deleteMany({ where: { schluessel: { in: drosselSchluessel } } });

      // Versandprotokoll: Die Zeilen bleiben als Betriebsspur, ohne Personenbezug.
      //  - Fehlertext zuerst und unabhängig von der personId: Mailserver nennen
      //    die abgewiesene Adresse gern im Wortlaut, auch in Zeilen ohne
      //    Personenbezug (etwa ältere Eingangsbestätigungen der Anmeldung).
      //  - Empfängeradresse: an der Person hängende Zeilen UND Zeilen an ihre
      //    Adresse ohne Personenbezug.
      //  - Betreff: Verwaltungsmails mit dem Namen hängen an der personId der
      //    EMPFÄNGER und würden über die Person nie gefunden (M6b).
      // (Nur mit einer echten Adresse — ein leerer Suchbegriff träfe jede Zeile.)
      if (person.email.includes("@")) {
        await tx.emailVersand.updateMany({
          where: { fehler: { contains: person.email, mode: "insensitive" } },
          data: { fehler: ANONYM_PLATZHALTER },
        });
      }
      await tx.emailVersand.updateMany({
        where: { OR: [{ personId }, { empfaenger: { equals: person.email, mode: "insensitive" } }] },
        data: { empfaenger: ANONYM_PLATZHALTER },
      });
      if (betreffTreffer.length > 0) {
        await tx.emailVersand.updateMany({ where: { OR: betreffTreffer }, data: { betreff: ANONYM_PLATZHALTER } });
      }

      return {
        anmeldungen: anmeldungen.length,
        zeugnisse: zeugnisse.length,
        stornoGruende: stornoGruende.count,
        abgeschlossen: abgeschlossen.count,
        rollen: rollen.count,
      };
    });
  } catch (ausnahme) {
    if (ausnahme instanceof StatusGeaendert) return { status: "gleichzeitig" };
    if (ausnahme instanceof LetzterAdmin) return { status: "letzter_admin" };
    // P2034: Schreibkonflikt oder Deadlock mit einem zeitgleichen Vorgang an
    // derselben Person — Postgres hat diese Seite abgebrochen, nichts ist
    // geschrieben. Ein Konflikt, kein Serverfehler.
    if (ausnahme instanceof Prisma.PrismaClientKnownRequestError && ausnahme.code === "P2034") {
      return { status: "gleichzeitig" };
    }
    throw ausnahme;
  }

  await protokolliere({
    aktion: "PERSON_ANONYMISIERT",
    objektTyp: "Person",
    objektId: personId,
    akteurId,
    // BEWUSST ohne alte Werte: Das Audit-Log ist lesbar und append-only — die
    // alten personenbezogenen Daten gehören da nicht hinein, sonst wäre die
    // Anonymisierung dort wieder aufgehoben.
    vorher: { status: person.statusCode },
    nachher: {
      status: STATUS.ANONYMISIERT,
      anmeldungenGescrubbt: zahlen.anmeldungen,
      anmeldungenGeschlossen: zahlen.abgeschlossen,
      zeugnisseAnonymisiert: zahlen.zeugnisse,
      stornoGruendeAnonymisiert: zahlen.stornoGruende,
      rollenEntfernt: zahlen.rollen,
    },
    headers,
  });

  return { status: "ok", anmeldungen: zahlen.anmeldungen, zeugnisse: zahlen.zeugnisse };
}
