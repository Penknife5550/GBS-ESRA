/**
 * GBS Campus — Daten für „Mein Unterricht“ (Dozent)
 *
 * Ergänzt `ladeEigeneDozentTermine` (lib/stundenplan-io.ts) um das, was die
 * Übersicht seit dem Oberflächenplan 09/2026 zeigt: Uhrzeit bis Ende, Thema des
 * Abends und welche Einträge die Teilnehmer selbst gesetzt haben („hat sich
 * selbst eingetragen“). Die Grenzen — nur eigene Abende, nur zählende
 * Teilnahmen aktiver Personen — kommen unverändert aus dem geprüften Lader; hier
 * wird nur auf dessen Ids nachgelesen.
 */

import { prisma } from "@/lib/db";
import { ladeEigeneDozentTermine } from "@/lib/stundenplan-io";
import { offeneErfassung } from "@/lib/stundenplan";
import { berlinerTag, tagKurz, uhrzeit } from "@/lib/datum";
import { kurzThema, tagMitName } from "@/app/meine-daten/abend-text";
import type { ErfassAbend, ErfassGruppe } from "./stundenplan-dozent";

/** Ein Abend für die Karten oben (Server), mit echtem Zeitpunkt für den Kalenderblock. */
export type KartenAbend = ErfassAbend & {
  beginn: Date;
  tagMitName: string;
  thema: string | null;
  teilnehmer: number;
  selbst: number;
};

export type DozentUebersicht = {
  /** Semester der Kopfzeile: das laufende, sonst das des nächsten Abends. */
  semester: string | null;
  gruppen: ErfassGruppe[];
  /** Der jüngste gehaltene Abend, dessen Anwesenheit noch nicht vollständig ist. */
  offen: KartenAbend | null;
  /** Weitere offene Abende — unter der Karte, jeder mit eigenem Sprung ins Blatt. */
  weitereOffen: { id: string; tag: string; tagMitName: string }[];
  /** Die eigenen Einheiten am nächsten Unterrichtstag. */
  naechste: KartenAbend[];
};

export async function ladeDozentUebersicht(dozentId: string, jetzt: Date): Promise<DozentUebersicht> {
  const roh = await ladeEigeneDozentTermine(dozentId, jetzt);
  if (roh.length === 0) return { semester: null, gruppen: [], offen: null, weitereOffen: [], naechste: [] };

  const alleIds = roh.flatMap((g) => g.termine.map((t) => t.id));
  const vergangeneIds = roh.flatMap((g) => g.termine.filter((t) => t.istVergangen).map((t) => t.id));
  const teilnahmeIds = roh.flatMap((g) => g.teilnehmer.map((t) => t.teilnahmeId));

  const [details, eintraege] = await Promise.all([
    prisma.unterrichtstermin.findMany({
      where: { id: { in: alleIds }, dozentId },
      select: { id: true, beginn: true, ende: true, thema: true, semester: { select: { istAktuell: true } } },
    }),
    // Nur für genau die Teilnahmen, die der Lader als Zeilen liefert: wer den
    // Eintrag gesetzt hat (Provenienz), damit Selbsteinträge vermerkt sind.
    vergangeneIds.length > 0 && teilnahmeIds.length > 0
      ? prisma.anwesenheit.findMany({
          where: { terminId: { in: vergangeneIds }, teilnahmeId: { in: teilnahmeIds } },
          select: { terminId: true, teilnahmeId: true, erfasstVonId: true, teilnahme: { select: { personId: true } } },
        })
      : Promise.resolve([]),
  ]);
  const detailVon = new Map(details.map((d) => [d.id, d]));
  const selbstVon = new Map<string, string[]>();
  for (const e of eintraege) {
    if (!e.erfasstVonId || e.erfasstVonId !== e.teilnahme.personId) continue;
    selbstVon.set(e.terminId, [...(selbstVon.get(e.terminId) ?? []), e.teilnahmeId]);
  }

  const kartenAbende: KartenAbend[] = [];
  const gruppen: (ErfassGruppe & { istAktuell: boolean })[] = roh.map((g) => {
    const abende = g.termine.flatMap((t) => {
      const d = detailVon.get(t.id);
      if (!d) return [];
      // Zähler und Nenner aus derselben Menge (aktive, zählende Teilnahmen) —
      // wie bisher in der Liste des Dozenten.
      const erfasst = g.teilnehmer.filter((tn) => g.anwesenheit[t.id]?.[tn.teilnahmeId]).length;
      const abend: KartenAbend = {
        id: t.id,
        tag: tagKurz(d.beginn),
        zeit: uhrzeit(d.beginn),
        bis: d.ende ? uhrzeit(d.ende) : null,
        fach: t.fach,
        kurzThema: kurzThema(d.thema),
        istVergangen: t.istVergangen,
        erfasst,
        gesamt: g.teilnehmer.length,
        beginn: d.beginn,
        tagMitName: tagMitName(d.beginn),
        thema: d.thema?.trim() || null,
        teilnehmer: g.teilnehmer.length,
        selbst: (selbstVon.get(t.id) ?? []).length,
      };
      kartenAbende.push(abend);
      return [abend];
    });
    return {
      titel: g.semesterBezeichnung,
      teilnehmer: g.teilnehmer,
      anwesenheit: g.anwesenheit,
      selbst: Object.fromEntries(g.termine.map((t) => [t.id, selbstVon.get(t.id) ?? []])),
      abende: abende.map(alsListenAbend),
      istAktuell: g.termine.some((t) => detailVon.get(t.id)?.semester.istAktuell),
    };
  });

  const nachZeit = (a: KartenAbend, b: KartenAbend) => a.beginn.getTime() - b.beginn.getTime();
  const kommende = kartenAbende.filter((a) => !a.istVergangen).sort(nachZeit);
  const naechsterTag = kommende.length > 0 ? berlinerTag(kommende[0].beginn) : null;
  const naechste = kommende.filter((a) => berlinerTag(a.beginn) === naechsterTag);

  // Offen ist, was die geprüfte Regel `offeneErfassung` sagt; gezeigt wird der
  // jüngste dieser Abende, die übrigen nur als Hinweis.
  const offeneIds = new Set(offeneErfassung(roh).map((o) => o.terminId));
  const offene = kartenAbende.filter((a) => offeneIds.has(a.id)).sort((a, b) => nachZeit(b, a));

  // Das laufende Semester zuerst, dann das des nächsten Abends, dann die übrigen.
  const kopf =
    gruppen.find((g) => g.istAktuell) ??
    gruppen.find((g) => naechste.length > 0 && g.abende.some((a) => a.id === naechste[0].id)) ??
    gruppen[0];
  const sortiert = [kopf, ...gruppen.filter((g) => g !== kopf)].map((g) => ({
    titel: g.titel,
    teilnehmer: g.teilnehmer,
    anwesenheit: g.anwesenheit,
    selbst: g.selbst,
    abende: g.abende,
  }));

  return {
    semester: kopf.titel,
    gruppen: sortiert,
    offen: offene[0] ?? null,
    weitereOffen: offene.slice(1).map((a) => ({ id: a.id, tag: a.tag, tagMitName: a.tagMitName })),
    naechste,
  };
}

/** Nur, was die Liste im Browser braucht (kein Date, keine Zähler der Karten). */
function alsListenAbend(a: KartenAbend): ErfassAbend {
  return {
    id: a.id,
    tag: a.tag,
    zeit: a.zeit,
    bis: a.bis,
    fach: a.fach,
    kurzThema: a.kurzThema,
    istVergangen: a.istVergangen,
    erfasst: a.erfasst,
    gesamt: a.gesamt,
  };
}
