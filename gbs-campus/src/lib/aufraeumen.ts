/**
 * GBS Campus — Aufräumlauf
 *
 * Das Schema behauptete einen solchen Lauf, es gab ihn aber nicht: `rate_limit`,
 * `magic_links` und abgelaufene Anmeldeentwürfe wuchsen unbegrenzt. Bei den
 * Entwürfen ist das nicht nur eine Platzfrage — sie enthalten personenbezogene
 * Angaben, und Art. 5 Abs. 1 lit. e DSGVO verlangt, sie nicht länger als nötig
 * aufzubewahren.
 *
 * Läuft ohne Worker: Der Aufruf hängt an der Anmeldeanforderung, die ohnehin
 * selten genug ist. Mit Release 0.2 wandert er in den Cron des Workers.
 *
 * Jeder Lauf hinterlässt einen Audit-Eintrag `AUFRAEUMEN_GELAUFEN`, den die
 * Betriebsansicht als „zuletzt aufgeräumt" liest. Vorher war der einzige
 * Fehlerkanal ein `console.error` — bei Bus-Faktor 1 heißt das: Der einzige
 * Löschmechanismus für personenbezogene Entwürfe hätte monatelang tot sein
 * können, ohne dass es jemandem auffällt.
 */

import { prisma } from "@/lib/db";
import { AnmeldungStatus } from "@prisma/client";
import { MINUTE_MS, TAG_MS } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { protokolliere } from "@/lib/audit";

export type AufraeumErgebnis = {
  drosselzeilen: number;
  magicLinks: number;
  entwuerfe: number;
  emailAenderungen: number;
  datenauskuenfte: number;
};

export async function raeumeAuf(): Promise<AufraeumErgebnis> {
  const jetzt = Date.now();

  // Die Fristen sind Regler und keine Codekonstanten: Wie lange
  // personenbezogene Spuren stehen bleiben, ist eine Frage der
  // Datenschutzerklärung und nicht des nächsten Deploys. `zahl()` fällt bei
  // jedem Problem auf den Standard zurück (1 bzw. 7 Tage).
  const [drosselTage, tokenTage] = await Promise.all([
    zahl("AUFRAEUMEN_DROSSEL_TAGE"),
    zahl("AUFRAEUMEN_TOKEN_TAGE"),
  ]);

  const drosselGrenze = new Date(jetzt - drosselTage * TAG_MS);
  // Dieselbe Frist für Anmeldelinks und Adressänderungen — beides sind
  // eingelöste oder abgelaufene Einmal-Token, die nur noch der
  // Nachvollziehbarkeit dienen.
  const tokenGrenze = new Date(jetzt - tokenTage * TAG_MS);

  const [drossel, links, entwuerfe, emailAenderungen, datenauskuenfte] = await Promise.all([
    prisma.rateLimit.deleteMany({ where: { zeitpunkt: { lt: drosselGrenze } } }),
    prisma.magicLink.deleteMany({ where: { laeuftAb: { lt: tokenGrenze } } }),
    // Abgelaufene Entwürfe sind nicht mehr aufrufbar — sie liegen sonst für
    // immer da, samt der darin gespeicherten Angaben.
    prisma.anmeldung.deleteMany({
      where: { status: AnmeldungStatus.ENTWURF, fortsetzenLaeuftAb: { lt: new Date(jetzt) } },
    }),
    // Eine nicht bestätigte Adressänderung enthält eine E-Mail-Adresse und
    // gehört nicht dauerhaft in die Datenbank.
    prisma.emailAenderung.deleteMany({ where: { laeuftAb: { lt: tokenGrenze } } }),
    // Abgelaufene Auskunfts-Token: dieselbe Frist wie die übrigen Einmal-Token.
    // Sie verweisen auf eine Person und dienen nach Ablauf nur noch der
    // Nachvollziehbarkeit — der Nachweis, DASS eine Auskunft erteilt wurde,
    // steht ohnehin unabhängig im append-only Audit-Log.
    prisma.datenauskunft.deleteMany({ where: { laeuftAb: { lt: tokenGrenze } } }),
  ]);

  const ergebnis: AufraeumErgebnis = {
    drosselzeilen: drossel.count,
    magicLinks: links.count,
    entwuerfe: entwuerfe.count,
    emailAenderungen: emailAenderungen.count,
    datenauskuenfte: datenauskuenfte.count,
  };

  // Auch der Lauf, der nichts gefunden hat, wird festgehalten. Genau das ist
  // die Aussage, die der Betrieb braucht: nicht „es wurde gelöscht", sondern
  // „der Lauf lebt noch". `protokolliere` wirft nie.
  await protokolliere({
    aktion: "AUFRAEUMEN_GELAUFEN",
    objektTyp: "System",
    quelle: "SYSTEM",
    nachher: { ...ergebnis, drosselTage, tokenTage },
  });

  return ergebnis;
}

const STUNDE_MS = 60 * MINUTE_MS;

/** Zeitpunkt des letzten ERFOLGREICH begonnenen Laufs. */
let zuletzt = 0;

/**
 * Räumt höchstens einmal pro Stunde auf und niemals blockierend.
 * Ein Fehler hier darf die auslösende Anfrage nicht beeinträchtigen.
 */
export function raeumeGelegentlichAuf(): void {
  const jetzt = Date.now();
  if (jetzt - zuletzt < STUNDE_MS) return;

  // Sofort gesetzt, damit zwei gleichzeitige Anfragen nicht zwei Läufe starten
  // — bei einem Fehler aber zurückgenommen. Sonst hätte ein einziger
  // fehlgeschlagener Lauf die nächste Stunde blockiert, und beim seltenen
  // Auslöser (eine Anmeldeanforderung) wären das schnell Tage.
  const vorheriger = zuletzt;
  zuletzt = jetzt;

  void raeumeAuf()
    .then((e) => {
      if (e.drosselzeilen + e.magicLinks + e.entwuerfe + e.emailAenderungen + e.datenauskuenfte > 0) {
        console.log("[AUFRAEUMEN]", e);
      }
    })
    .catch((fehler) => {
      zuletzt = vorheriger;
      console.error("[AUFRAEUMEN] fehlgeschlagen:", fehler);
    });
}
