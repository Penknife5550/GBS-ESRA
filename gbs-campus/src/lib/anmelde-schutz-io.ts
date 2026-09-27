/**
 * GBS Campus — Schutz vor Massenanmeldungen: Datenbank-Teil
 *
 * Zählt angenommene Einreichungen und neue Zwischenstände über alle Anschlüsse
 * hinweg in `rate_limit` und warnt Schulleitung und Verwaltung, wenn die
 * Gesamtgrenze erreicht ist. Die Regeln selbst stehen DB-frei in
 * `anmelde-schutz.ts`.
 *
 * Warum reservieren statt nachträglich zählen: Zwei gleichzeitige
 * Einreichungen dürfen die Grenze nicht gemeinsam überschreiten. Das Zählen
 * und das Belegen eines Platzes geschehen deshalb unter einer Sperre in einer
 * Transaktion (dasselbe Muster wie `drosselUeberschritten`). Scheitert die
 * Einreichung danach fachlich (Pflichtfeld fehlt), gibt die Route den Platz
 * wieder frei — gezählt wird nur, was angenommen wurde.
 */

import { prisma } from "@/lib/db";
import { MAIL_VORLAGE, ROLLE, STUNDE_MS, TAG_MS } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { drosselUeberschritten } from "@/lib/magic-link";
import { sendeAnRollen } from "@/lib/verteiler";
import {
  SCHLUESSEL_WARNUNG,
  gesamtgrenzeErreicht,
  grenzeAlsText,
  type Fenster,
  type Grenzen,
  type Zaehlstand,
} from "@/lib/anmelde-schutz";

export async function ladeGesamtgrenzen(): Promise<Grenzen> {
  const [proStunde, proTag] = await Promise.all([
    zahl("ANMELDUNG_MAX_GESAMT_STUNDE"),
    zahl("ANMELDUNG_MAX_GESAMT_TAG"),
  ]);
  return { proStunde, proTag };
}

export async function zaehlstand(schluessel: string, jetzt: Date = new Date()): Promise<Zaehlstand> {
  const [letzteStunde, letzterTag] = await Promise.all([
    prisma.rateLimit.count({ where: { schluessel, zeitpunkt: { gte: new Date(jetzt.getTime() - STUNDE_MS) } } }),
    prisma.rateLimit.count({ where: { schluessel, zeitpunkt: { gte: new Date(jetzt.getTime() - TAG_MS) } } }),
  ]);
  return { letzteStunde, letzterTag };
}

/**
 * Neu angelegte Anmeldezeilen (Zwischenstände und direkt abgeschickte
 * Anmeldungen) — die Zählung für die Zwischenstand-Grenze. Bewusst nicht
 * atomar mit dem Anlegen, das in `speichereEntwurf` geschieht: Gleichzeitige
 * Anfragen können die Grenze um ihre Anzahl überschreiten. Für Zeilen ohne
 * Akte und ohne Mail genügt das.
 */
export async function zaehleNeueAnmeldezeilen(jetzt: Date = new Date()): Promise<Zaehlstand> {
  const [letzteStunde, letzterTag] = await Promise.all([
    prisma.anmeldung.count({ where: { erstelltAm: { gte: new Date(jetzt.getTime() - STUNDE_MS) } } }),
    prisma.anmeldung.count({ where: { erstelltAm: { gte: new Date(jetzt.getTime() - TAG_MS) } } }),
  ]);
  return { letzteStunde, letzterTag };
}

export type Reservierung = { platzId: string } | { fenster: Fenster };

/**
 * Belegt atomar einen Platz im Kontingent — oder meldet, welches Fenster voll
 * ist. Die Tageszählung reicht 24 Stunden zurück; der Aufräumlauf löscht
 * Drosselzeilen frühestens nach einem Tag (`AUFRAEUMEN_DROSSEL_TAGE` ≥ 1).
 */
export async function reserviereKontingent(schluessel: string, grenzen: Grenzen): Promise<Reservierung> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schluessel}, 0))`;
    const jetzt = Date.now();
    const letzteStunde = await tx.rateLimit.count({
      where: { schluessel, zeitpunkt: { gte: new Date(jetzt - STUNDE_MS) } },
    });
    const letzterTag = await tx.rateLimit.count({
      where: { schluessel, zeitpunkt: { gte: new Date(jetzt - TAG_MS) } },
    });
    const fenster = gesamtgrenzeErreicht({ letzteStunde, letzterTag }, grenzen);
    if (fenster) return { fenster };
    const platz = await tx.rateLimit.create({ data: { schluessel }, select: { id: true } });
    return { platzId: platz.id };
  });
}

/** Gibt einen reservierten Platz zurück. Wirft nie — schlimmstenfalls zählt ein Versuch mit. */
export async function gibKontingentFrei(platzId: string): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({ where: { id: platzId } });
  } catch (fehler) {
    console.error("[ANMELDESCHUTZ] Platz im Kontingent konnte nicht freigegeben werden:", fehler);
  }
}

/**
 * Warnt Schulleitung und Verwaltung — höchstens einmal pro Stunde, egal wie
 * viele Anfragen abgewiesen werden. Sonst würde ausgerechnet der Angriff, vor
 * dem die Grenze schützt, das Postfach der Schule fluten. Wirft nie.
 */
export async function warneBeiGesamtgrenze(fenster: Fenster, grenzen: Grenzen): Promise<void> {
  try {
    if (await drosselUeberschritten(SCHLUESSEL_WARNUNG, 1, 60)) return;
    const grenze = grenzeAlsText(fenster, grenzen);
    const link = `${process.env.APP_URL ?? ""}/verwaltung/anmeldungen`;
    await sendeAnRollen({
      rollen: [ROLLE.SCHULLEITER, ROLLE.VERWALTUNG],
      vorlageCode: MAIL_VORLAGE.ANMELDUNG_GEDROSSELT,
      werte: { grenze, link },
      ersatzBetreff: "Anmeldeformular: ungewöhnlich viele Anmeldungen",
      ersatzText:
        `Im öffentlichen Anmeldeformular ist die Obergrenze erreicht: ${grenze}. Weitere Anmeldungen ` +
        "werden vorerst abgewiesen; die Absender sehen den Hinweis, es später erneut zu versuchen.\n\n" +
        `Bitte prüfen Sie die zuletzt eingegangenen Anmeldungen: ${link}\n\n` +
        "Handelt es sich um echte Bewerbungen, können Sie die Grenze unter Verwaltung → Einstellungen " +
        "anheben. Diese Nachricht geht höchstens einmal pro Stunde hinaus.",
    });
  } catch (fehler) {
    console.error("[ANMELDESCHUTZ] Warnung an die Verwaltung gescheitert:", fehler);
  }
}
