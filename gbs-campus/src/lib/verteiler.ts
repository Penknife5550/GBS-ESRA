/**
 * GBS Campus — Mails an eine Rollengruppe
 *
 * „Alle mit Rolle X anschreiben" stand dreimal im Code (neue Anmeldung,
 * geänderte Stammdaten, Meldung über das Hilfeformular), jedes Mal leicht
 * anders: einmal mit rohem Rollenstring statt Konstante, einmal ohne Vorlage,
 * einmal ohne `vorlageCode` im Versandprotokoll. Hier ist es einmal.
 *
 * **Der wichtigste Teil ist der leere Fall.** Gibt es niemanden mit der
 * gesuchten Rolle — beim ersten Aufsetzen etwa, oder wenn der Schulleiter-Zugang
 * auf einen Endzustand gesetzt wurde —, lief die Schleife bisher null Mal, es
 * entstand kein einziger Eintrag in `email_versand`, und der Absender bekam
 * trotzdem „ist bei der Schulleitung eingegangen" zu lesen. Bei einer Meldung
 * „ich komme nicht mehr ins Portal" ist das der Unterschied zwischen einem
 * Menschen, dem geholfen wird, und einem, der auf immer draußen bleibt. Deshalb
 * hinterlässt der leere Fall jetzt eine FEHLER-Zeile, die die Betriebsansicht
 * liest — nach dem Leitsatz „Was der Betrieb nicht sehen kann, ist kaputt".
 */

import { prisma } from "@/lib/db";
import { fuelleVorlage, sendeMail } from "@/lib/mailer";
import type { RolleCode } from "@/lib/constants";

export type VerteilerAuftrag = {
  /** An welche Rollen. Mehrere, wenn niemand warten soll, bis eine bestimmte Person am Schreibtisch sitzt. */
  rollen: RolleCode[];
  /** Vorlage aus `email_vorlagen` — damit der Text ohne Deploy änderbar bleibt. */
  vorlageCode: string;
  /** Platzhalter der Vorlage. */
  werte: Record<string, string>;
  /** Greift nur, wenn die Vorlage fehlt (frische Datenbank, Seed noch nicht gelaufen). */
  ersatzBetreff: string;
  ersatzText: string;
};

export type VerteilerErgebnis = {
  empfaenger: number;
  gesendet: number;
};

/**
 * Schickt eine Nachricht an alle Personen mit einer der Rollen, deren Status
 * automatische Mails zulässt.
 *
 * Wirft nie: Ein fehlgeschlagener Versand darf die bereits gespeicherte
 * fachliche Änderung nicht zurücknehmen. Der Aufrufer bekommt aber Zahlen
 * zurück und kann sie dem Bedienenden melden — genau das fehlte bisher.
 */
export async function sendeAnRollen(auftrag: VerteilerAuftrag): Promise<VerteilerErgebnis> {
  try {
    const [vorlage, empfaenger] = await Promise.all([
      prisma.emailVorlage.findUnique({ where: { code: auftrag.vorlageCode } }),
      prisma.person.findMany({
        where: {
          rollen: { some: { rolleCode: { in: auftrag.rollen } } },
          status: { automatikMails: true },
        },
        select: { id: true, email: true },
      }),
    ]);

    const betreff = fuelleVorlage(vorlage?.betreff ?? auftrag.ersatzBetreff, auftrag.werte);
    const text = fuelleVorlage(vorlage?.textMd ?? auftrag.ersatzText, auftrag.werte);

    if (empfaenger.length === 0) {
      await meldeAusfall(
        betreff,
        `Keine Person mit einer der Rollen ${auftrag.rollen.join(", ")} und eingeschalteten ` +
          "Automatik-Mails. Die Nachricht ging an niemanden.",
      );
      return { empfaenger: 0, gesendet: 0 };
    }

    // Parallel statt nacheinander: Der Transport hält drei Verbindungen offen,
    // und der Absender wartete bisher bei hakendem SMTP je Empfänger bis zu
    // 20 Sekunden vor einem Spinner.
    const ergebnisse = await Promise.all(
      empfaenger.map((ziel) =>
        sendeMail({ an: ziel.email, personId: ziel.id, vorlageCode: auftrag.vorlageCode, betreff, text }).catch(
          (fehler) => {
            console.error("[VERTEILER] Versand an", ziel.email, "fehlgeschlagen:", fehler);
            return { gesendet: false };
          },
        ),
      ),
    );

    const gesendet = ergebnisse.filter((e) => e.gesendet).length;
    if (gesendet === 0) {
      await meldeAusfall(betreff, `Zustellung an alle ${empfaenger.length} Empfänger fehlgeschlagen.`);
    }

    return { empfaenger: empfaenger.length, gesendet };
  } catch (fehler) {
    console.error("[VERTEILER] Verteiler fehlgeschlagen:", auftrag.vorlageCode, fehler);
    return { empfaenger: 0, gesendet: 0 };
  }
}

/**
 * Hinterlässt eine sichtbare Spur, wenn eine Nachricht niemanden erreicht hat.
 * Die Betriebsansicht liest `email_versand` — ohne diese Zeile wäre der Ausfall
 * unsichtbar.
 */
async function meldeAusfall(betreff: string, grund: string): Promise<void> {
  try {
    await prisma.emailVersand.create({
      data: { empfaenger: "(kein Empfänger)", betreff, status: "FEHLER", fehler: grund },
    });
  } catch (fehler) {
    console.error("[VERTEILER] Ausfall konnte nicht protokolliert werden:", grund, fehler);
  }
}
