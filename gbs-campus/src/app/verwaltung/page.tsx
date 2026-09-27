import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ladeAngemeldeten, hatRecht } from "@/lib/berechtigung";
import { RECHT, STATUS, TAG_MS } from "@/lib/constants";
import { tagLang, uhrzeit } from "@/lib/datum";
import { zahl } from "@/lib/einstellungen";
import {
  abendStand,
  abendText,
  anwesenheitsStand,
  anzahl,
  aufteilen,
  einheitVorbei,
  einladungEmpfohlenBis,
  erfassungsText,
  gefaehrdungText,
  gefaehrdungTitel,
  kalendertag,
  namensListe,
  naechsterAbend,
  tagMonat,
  ueberleitungFaellig,
  wartetSeit,
  zeitraumText,
  zuletztZeilen,
  type ZuletztEreignis,
} from "@/lib/heute";
import { offeneErfassung } from "@/lib/stundenplan";
import { terminVergangen } from "@/lib/selbstbestaetigung";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import type { IconName } from "@/components/icons";
import { KalenderBlock } from "@/components/ui/anzeige";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Abschnitt, Gruppe, Symbol, Zeile, type SymbolTon } from "@/components/ui/liste";

export const metadata = { title: "Heute" };
export const dynamic = "force-dynamic";

type Aufgabe = {
  schluessel: string;
  icon: IconName;
  ton: SymbolTon;
  titel: string;
  text: string;
  knopf: { text: string; href: string };
};

/** Aufgaben je Art, danach fasst eine Zeile den Rest zusammen. */
const HOECHSTENS_JE_ART = 2;

/** Anmeldungen anonymisierter Personen sind geschlossen (Code-Review 4, M7) — wie in der Liste. */
const ANMELDUNG_SICHTBAR: Prisma.AnmeldungWhereInput = {
  OR: [{ personId: null }, { person: { statusCode: { not: STATUS.ANONYMISIERT } } }],
};

/**
 * „Heute“ (Oberflächenplan 09/2026): statt einer Kachelwand die Frage „Was ist
 * heute zu tun?“ — Aufgaben mit dem passenden Knopf daneben, darunter der
 * nächste Unterricht, rechts der Stand des Semesters.
 *
 * Alles kommt aus Daten, die es schon gibt, und jede Aufgabe, Zahl und Zeile
 * wird nur geladen und gezeigt, wenn das Konto das Recht dazu hat — wie früher
 * die Kacheln. „Zuletzt“ liest das Protokoll (AUDIT_LESEN); Namen löst es nur für
 * Vorgänge auf, die das Konto auch sonst sehen darf.
 */
export default async function HeuteSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) redirect("/anmelden");

  // Rollen-Weiche wie bisher: reiner Dozent in seinen Bereich, reiner Teilnehmer
  // in die eigene Akte.
  if (hatRecht(benutzer, RECHT.EIGENE_TERMINE_LESEN) && !hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE)) {
    redirect("/dozent");
  }
  if (!hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE) && hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) {
    redirect("/meine-daten");
  }

  const jetzt = new Date();
  const kopf = (
    <>
      <p className="text-sm font-medium text-muted-foreground">{tagLang(jetzt)}</p>
      <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight">Heute</h1>
    </>
  );

  if (!hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE)) {
    return (
      <main className="px-4 pb-10 pt-6 sm:px-6 lg:px-10 lg:pt-8">
        {kopf}
        <div className="mt-6 max-w-xl">
          <LeererZustand icon="hinweis" titel="Noch kein Bereich freigeschaltet">
            Für Ihr Konto ist noch kein Verwaltungsbereich freigeschaltet.
          </LeererZustand>
        </div>
      </main>
    );
  }

  const darf = {
    anmeldungen: hatRecht(benutzer, RECHT.ANMELDUNG_LESEN),
    semester: hatRecht(benutzer, RECHT.SEMESTER_VERWALTEN),
    noten: hatRecht(benutzer, RECHT.NOTEN_VERWALTEN),
    system: hatRecht(benutzer, RECHT.SYSTEM_EINSTELLUNGEN),
    audit: hatRecht(benutzer, RECHT.AUDIT_LESEN),
    eigeneErfassung: hatRecht(benutzer, RECHT.ANWESENHEIT_ERFASSEN_EIGENE),
  };

  const aktuelles = await prisma.semester.findFirst({
    where: { istAktuell: true },
    select: { id: true, bezeichnung: true, start: true, ende: true },
  });

  // Die Teilnahmen sind dieselbe Menge wie die Teilnehmerliste (aktiv, für das
  // Semester nicht abgemeldet); Einheiten und Anwesenheit liefern Quote und
  // offene Erfassung aus EINER Abfrage je Tabelle.
  const [teilnahmen, termine, anwesenheiten, schwelle, offeneAnmeldungen, emailFehler, folge, ersteErinnerung, kommende] =
    await Promise.all([
      aktuelles
        ? prisma.teilnahme.findMany({
            where: { semesterId: aktuelles.id, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV },
            select: { id: true, teilnahmeform: true, person: { select: { id: true, vorname: true, nachname: true } } },
            orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
          })
        : Promise.resolve([]),
      aktuelles
        ? prisma.unterrichtstermin.findMany({
            where: { semesterId: aktuelles.id },
            orderBy: { beginn: "asc" },
            select: {
              id: true,
              beginn: true,
              ende: true,
              thema: true,
              dozentId: true,
              kurseinheit: { select: { titel: true, fach: { select: { bezeichnung: true } } } },
            },
          })
        : Promise.resolve([]),
      aktuelles
        ? prisma.anwesenheit.findMany({
            where: { termin: { semesterId: aktuelles.id, beginn: { lte: jetzt } } },
            select: { terminId: true, teilnahmeId: true, status: true, erfasstVonId: true },
          })
        : Promise.resolve([]),
      zahl("ANWESENHEIT_MINDEST_PROZENT"),
      darf.anmeldungen
        ? prisma.anmeldung.findMany({
            where: { status: "EINGEREICHT", ...ANMELDUNG_SICHTBAR },
            select: { id: true, eingereichtAm: true, person: { select: { vorname: true, nachname: true } } },
            orderBy: { eingereichtAm: "desc" },
          })
        : Promise.resolve([]),
      darf.system
        ? prisma.emailVersand.count({ where: { status: { in: ["FEHLER", "BOUNCE"] } } })
        : Promise.resolve(0),
      darf.semester && aktuelles
        ? prisma.semester.findFirst({
            where: { start: { gt: aktuelles.start } },
            orderBy: { start: "asc" },
            select: {
              bezeichnung: true,
              start: true,
              teilnahmen: { where: { eingeladenAm: { not: null } }, select: { bestaetigtAm: true } },
            },
          })
        : Promise.resolve(null),
      darf.semester ? zahl("SEMESTER_ERINNERUNG_1_TAGE") : Promise.resolve(14),
      darf.semester
        ? prisma.unterrichtstermin.findMany({
            where: { beginn: { gte: new Date(jetzt.getTime() - TAG_MS) } },
            orderBy: { beginn: "asc" },
            take: 12,
            select: {
              id: true,
              semesterId: true,
              beginn: true,
              ende: true,
              thema: true,
              dozent: { select: { vorname: true, nachname: true } },
              kurseinheit: { select: { titel: true, fach: { select: { bezeichnung: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);

  // --- Anwesenheit: Quote je Teilnahme (Modell A) und offene Erfassung ------
  const personVon = new Map(teilnahmen.map((t) => [t.id, t.person.id]));
  const vergangen = termine.filter((t) => terminVergangen(t.beginn, jetzt)).length;
  const statiJeTeilnahme = new Map<string, string[]>();
  const matrix: Record<string, Record<string, string>> = {};
  // Selbst eingetragen: die Person der Teilnahme hat den Eintrag gesetzt (Selbstbestätigung).
  const selbstJeTermin = new Map<string, number>();
  for (const a of anwesenheiten) {
    const person = personVon.get(a.teilnahmeId);
    if (!person) continue; // nur zählende Teilnahmen
    statiJeTeilnahme.set(a.teilnahmeId, [...(statiJeTeilnahme.get(a.teilnahmeId) ?? []), a.status]);
    (matrix[a.terminId] ??= {})[a.teilnahmeId] = a.status;
    if (a.erfasstVonId === person) selbstJeTermin.set(a.terminId, (selbstJeTermin.get(a.terminId) ?? 0) + 1);
  }
  const gefaehrdete = teilnahmen.flatMap((t) => {
    const stand = anwesenheitsStand(statiJeTeilnahme.get(t.id) ?? [], vergangen, termine.length, schwelle);
    return stand?.gefaehrdet ? [{ teilnahme: t, stand }] : [];
  });

  const offen = darf.semester && aktuelles
    ? offeneErfassung([
        {
          semesterBezeichnung: aktuelles.bezeichnung,
          teilnehmer: teilnahmen.map((t) => ({ teilnahmeId: t.id })),
          termine: termine
            .filter((t) => einheitVorbei(t.beginn, t.ende, jetzt))
            .map((t) => ({ id: t.id, text: "", fach: null, istVergangen: true })),
          anwesenheit: matrix,
        },
      ])
    : [];
  const terminVon = new Map(termine.map((t) => [t.id, t]));

  // --- Zu erledigen ---------------------------------------------------------
  const aufgaben: Aufgabe[] = [];

  if (offeneAnmeldungen.length > 0) {
    const namen = offeneAnmeldungen.map((a) => (a.person ? `${a.person.vorname} ${a.person.nachname}` : "Ohne Akte"));
    const aelteste = offeneAnmeldungen[offeneAnmeldungen.length - 1].eingereichtAm;
    const warten = aelteste ? wartetSeit(aelteste, jetzt) : null;
    aufgaben.push({
      schluessel: "anmeldungen",
      icon: "eingang",
      ton: "blau",
      titel: anzahl(offeneAnmeldungen.length, "neue Anmeldung", "neue Anmeldungen"),
      text: [namensListe(namen), warten && (offeneAnmeldungen.length === 1 ? warten : `die älteste ${warten}`)]
        .filter(Boolean)
        .join(" · "),
      knopf: { text: "Ansehen", href: "/verwaltung/anmeldungen" },
    });
  }

  const erfassung = aufteilen(offen, HOECHSTENS_JE_ART);
  for (const einheit of erfassung.einzeln) {
    const termin = terminVon.get(einheit.terminId);
    if (!termin) continue;
    // Eigene Einheiten erfasst der Dozent dort, wo er es immer tut; alle anderen im Stundenplan.
    const eigene = darf.eigeneErfassung && termin.dozentId === benutzer.id;
    aufgaben.push({
      schluessel: `erfassung-${einheit.terminId}`,
      icon: "erledigen",
      ton: "gelb",
      titel: `Anwesenheit vom ${tagMonat(termin.beginn)} fehlt noch`,
      text: [
        termin.kurseinheit?.fach.bezeichnung,
        termin.thema ?? termin.kurseinheit?.titel,
        erfassungsText(einheit.erfasst, einheit.gesamt, selbstJeTermin.get(einheit.terminId) ?? 0),
      ]
        .filter(Boolean)
        .join(" · "),
      knopf: { text: "Erfassen", href: eigene ? `/dozent#termin-${termin.id}` : `/verwaltung/stundenplan#termin-${termin.id}` },
    });
  }
  if (erfassung.rest.length > 0) {
    const tage = erfassung.rest.flatMap((e) => {
      const termin = terminVon.get(e.terminId);
      return termin ? [tagMonat(termin.beginn)] : [];
    });
    aufgaben.push({
      schluessel: "erfassung-rest",
      icon: "erledigen",
      ton: "gelb",
      titel: `Anwesenheit fehlt noch für ${anzahl(erfassung.rest.length, "weitere Einheit", "weitere Einheiten")}`,
      text: [...new Set(tage)].join(", "),
      knopf: { text: "Stundenplan", href: "/verwaltung/stundenplan" },
    });
  }

  const quote = aufteilen(gefaehrdete, HOECHSTENS_JE_ART);
  for (const { teilnahme, stand } of quote.einzeln) {
    aufgaben.push({
      schluessel: `quote-${teilnahme.id}`,
      icon: "hinweis",
      ton: "rot",
      titel: gefaehrdungTitel(`${teilnahme.person.vorname} ${teilnahme.person.nachname}`, stand),
      text: gefaehrdungText(stand),
      knopf: { text: "Akte öffnen", href: `/verwaltung/personen/${teilnahme.person.id}` },
    });
  }
  if (quote.rest.length > 0) {
    const rest = quote.rest;
    aufgaben.push({
      schluessel: "quote-rest",
      icon: "hinweis",
      ton: "rot",
      titel: `${anzahl(rest.length, "weitere Person", "weitere Personen")} mit knapper Anwesenheit`,
      text: namensListe(rest.map((g) => `${g.teilnahme.person.vorname} ${g.teilnahme.person.nachname}`)),
      knopf: { text: "Liste", href: "/verwaltung/personen" },
    });
  }

  const gestartet = (folge?.teilnahmen.length ?? 0) > 0;
  if (folge && ueberleitungFaellig({ start: folge.start, gestartet, jetzt, ersteErinnerungTage: ersteErinnerung })) {
    aufgaben.push({
      schluessel: "ueberleitung",
      icon: "ueberleitung",
      ton: "blau",
      titel: `Einladung ins ${folge.bezeichnung} starten`,
      text: `Beginnt am ${kalendertag(folge.start, true)} · am besten bis zum ${kalendertag(einladungEmpfohlenBis(folge.start, ersteErinnerung), false)} einladen`,
      knopf: { text: "Überleitung", href: "/verwaltung/semesterueberleitung" },
    });
  }

  if (emailFehler > 0) {
    aufgaben.push({
      schluessel: "email",
      icon: "hinweis",
      ton: "rot",
      titel: anzahl(emailFehler, "E-Mail nicht zugestellt", "E-Mails nicht zugestellt"),
      text: "Ohne Mail kommt, wer kein Passwort hat, nicht ins Portal.",
      knopf: { text: "Ansehen", href: "/verwaltung/betrieb" },
    });
  }

  if (!aktuelles && darf.semester) {
    aufgaben.push({
      schluessel: "semester",
      icon: "semester",
      ton: "neutral",
      titel: "Kein Semester läuft",
      text: "Legen Sie fest, welches Semester gerade läuft.",
      knopf: { text: "Semester", href: "/verwaltung/semester" },
    });
  }

  // --- Nächster Unterricht --------------------------------------------------
  const abend = naechsterAbend(kommende, jetzt);
  const abendSemester = abend[0]?.semesterId;
  const abendTeilnehmer = !abendSemester
    ? 0
    : abendSemester === aktuelles?.id
      ? teilnahmen.length
      : await prisma.teilnahme.count({ where: { semesterId: abendSemester, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV } });

  // --- Stand des Semesters --------------------------------------------------
  const abende = abendStand(termine, jetzt);
  const schueler = teilnahmen.filter((t) => t.teilnahmeform === "SCHUELER").length;
  const hoerer = teilnahmen.length - schueler;
  const letzterAbendVorbei = abende.letzterAbend !== null && terminVergangen(abende.letzterAbend, jetzt);

  const zuletzt = darf.audit ? await ladeZuletzt(darf, jetzt) : [];

  return (
    <main className="px-4 pb-10 pt-6 sm:px-6 lg:px-10 lg:pt-8">
      {kopf}
      <div className="mt-5 grid gap-x-9 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <Abschnitt titel="Zu erledigen" />
          {aufgaben.length === 0 ? (
            <LeererZustand icon="bestaetigt" titel="Nichts zu erledigen">
              Alles auf dem aktuellen Stand.
            </LeererZustand>
          ) : (
            <Gruppe>
              {aufgaben.map((aufgabe, i) => (
                // Knopf neben der Aufgabe, am Handy darunter — sonst bliebe dem Text kaum Platz.
                <div key={aufgabe.schluessel} className="flex min-h-[66px] items-start gap-3 px-4 py-3 sm:items-center">
                  <Symbol icon={aufgabe.icon} ton={aufgabe.ton} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{aufgabe.titel}</p>
                      <p className="text-[13px] text-muted-foreground">{aufgabe.text}</p>
                    </div>
                    <Link href={aufgabe.knopf.href} className={`${knopf(i === 0 ? "primaer" : "sekundaer")} w-fit shrink-0`}>
                      {aufgabe.knopf.text}
                    </Link>
                  </div>
                </div>
              ))}
            </Gruppe>
          )}

          {abend.length > 0 && (
            <>
              <Abschnitt titel="Nächster Unterricht" aktion={<Link href="/verwaltung/stundenplan">Stundenplan</Link>} />
              <Gruppe>
                <div className="flex items-start gap-4 px-4 py-4 sm:gap-5">
                  <KalenderBlock datum={abend[0].beginn} className="pt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="sr-only">{tagLang(abend[0].beginn)}</p>
                    <ul className="space-y-3">
                      {abend.map((t) => (
                        <li key={t.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2.5">
                          <span className="text-sm font-semibold tabular-nums text-foreground">{uhrzeit(t.beginn)}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-foreground">
                              {[t.kurseinheit?.fach.bezeichnung, t.thema ?? t.kurseinheit?.titel].filter(Boolean).join(" · ") ||
                                "Unterricht"}
                            </span>
                            <span className="block text-[13px] text-muted-foreground">
                              {[t.dozent ? `${t.dozent.vorname} ${t.dozent.nachname}` : null, t.ende ? `bis ${uhrzeit(t.ende)}` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[13px] text-muted-foreground sm:hidden">
                      {anzahl(abendTeilnehmer, "Teilnehmer", "Teilnehmer")}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-[13px] text-muted-foreground sm:block">
                    {anzahl(abendTeilnehmer, "Teilnehmer", "Teilnehmer")}
                  </span>
                </div>
              </Gruppe>
            </>
          )}
        </div>

        <aside className="mt-7 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
          {aktuelles && (
            <>
              <Abschnitt titel={aktuelles.bezeichnung} />
              <Gruppe>
                {darf.semester && (
                  <Zeile titel={abendText(abende)} untertitel={zeitraumText(aktuelles.start, aktuelles.ende, abende.wochentag)} />
                )}
                <Zeile
                  href="/verwaltung/personen"
                  titel={anzahl(teilnahmen.length, "Teilnehmer", "Teilnehmer")}
                  untertitel={
                    teilnahmen.length === 0
                      ? "noch niemand zugeordnet"
                      : [schueler > 0 ? `${schueler} Schüler` : null, hoerer > 0 ? `${hoerer} Hörer` : null].filter(Boolean).join(" · ")
                  }
                />
                {vergangen > 0 &&
                  (gefaehrdete.length > 0 ? (
                    <Zeile
                      href="/verwaltung/personen"
                      titel={`${anzahl(gefaehrdete.length, "Person", "Personen")} gefährdet`}
                      untertitel={`Anwesenheit, Ziel ${schwelle} %`}
                    />
                  ) : (
                    <Zeile titel="Niemand gefährdet" untertitel={`Anwesenheit, Ziel ${schwelle} %`} />
                  ))}
                {darf.noten && abende.letzterAbend && (
                  <Zeile
                    href={letzterAbendVorbei ? "/verwaltung/zeugnisse" : undefined}
                    titel="Noten und Zeugnisse"
                    untertitel={`${letzterAbendVorbei ? "seit" : "ab"} dem letzten Abend am ${tagMonat(abende.letzterAbend)}`}
                  />
                )}
              </Gruppe>
            </>
          )}

          {darf.semester && aktuelles && (
            <>
              <Abschnitt titel="Als Nächstes" />
              <Gruppe>
                {folge ? (
                  <Zeile href="/verwaltung/semesterueberleitung">
                    <p className="text-sm font-semibold text-foreground">{folge.bezeichnung}</p>
                    <p className="text-[13px] text-muted-foreground">
                      Beginnt am {kalendertag(folge.start, true)}.{" "}
                      {gestartet
                        ? `Eingeladen sind ${folge.teilnahmen.length}, zugesagt haben ${folge.teilnahmen.filter((t) => t.bestaetigtAm).length}.`
                        : `Die Einladung ins neue Semester am besten bis zum ${kalendertag(einladungEmpfohlenBis(folge.start, ersteErinnerung), false)} starten.`}
                    </p>
                  </Zeile>
                ) : (
                  <Zeile href="/verwaltung/semester" titel="Noch kein Folgesemester" untertitel="Semester anlegen" />
                )}
              </Gruppe>
            </>
          )}
        </aside>

        {zuletzt.length > 0 && (
          <section className="mt-7 min-w-0 lg:col-start-1 lg:row-start-2">
            <Abschnitt titel="Zuletzt" aktion={<Link href="/verwaltung/protokoll">Protokoll</Link>} />
            <Gruppe>
              {zuletzt.map((z, i) => (
                <div key={`${z.am.getTime()}-${i}`} className="flex min-h-10 items-baseline gap-4 px-4 py-2.5 text-[13px]">
                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{tagMonat(z.am)}</span>
                  <span className="min-w-0 text-foreground">{z.text}</span>
                </div>
              ))}
            </Gruppe>
          </section>
        )}
      </div>
    </main>
  );
}

/**
 * „Zuletzt“ aus dem Protokoll: wenige Vorgänge der letzten 30 Tage als Sätze.
 * Das Protokoll selbst nennt nur Kennungen; Namen löst diese Seite nur für
 * Vorgänge auf, die das Konto auch ohne Protokoll sehen darf (Entscheidungen
 * über Anmeldungen nur mit ANMELDUNG_LESEN, die Überleitung nur mit
 * SEMESTER_VERWALTEN). Anonymisierte Personen bleiben ungenannt und außen vor.
 */
async function ladeZuletzt(darf: { anmeldungen: boolean; semester: boolean }, jetzt: Date) {
  const aktionen = [
    ...(darf.anmeldungen ? ["ANMELDUNG_ANGENOMMEN", "ANMELDUNG_ABGELEHNT"] : []),
    "STATUS_GEWECHSELT",
    "ANWESENHEIT_SELBST_BESTAETIGT",
    "ANWESENHEIT_ERFASST",
    ...(darf.semester ? ["SEMESTER_UEBERLEITUNG_GESTARTET"] : []),
  ];
  const eintraege = await prisma.auditLog.findMany({
    where: { aktion: { in: aktionen }, erstelltAm: { gte: new Date(jetzt.getTime() - 30 * TAG_MS) } },
    orderBy: { erstelltAm: "desc" },
    take: 60,
    select: {
      aktion: true,
      objektId: true,
      akteurId: true,
      nachher: true,
      erstelltAm: true,
      akteur: { select: { vorname: true, nachname: true } },
    },
  });
  if (eintraege.length === 0) return [];

  const ids = (...arten: string[]) => [
    ...new Set(eintraege.filter((e) => arten.includes(e.aktion) && e.objektId).map((e) => e.objektId as string)),
  ];
  const [anmeldungen, personen, termine, semester, stati] = await Promise.all([
    prisma.anmeldung.findMany({
      where: { id: { in: ids("ANMELDUNG_ANGENOMMEN", "ANMELDUNG_ABGELEHNT") } },
      select: { id: true, person: { select: { vorname: true, nachname: true, statusCode: true } } },
    }),
    prisma.person.findMany({
      where: { id: { in: ids("STATUS_GEWECHSELT") } },
      select: { id: true, vorname: true, nachname: true, statusCode: true },
    }),
    prisma.unterrichtstermin.findMany({
      where: { id: { in: ids("ANWESENHEIT_SELBST_BESTAETIGT", "ANWESENHEIT_ERFASST") } },
      select: { id: true, beginn: true },
    }),
    prisma.semester.findMany({ where: { id: { in: ids("SEMESTER_UEBERLEITUNG_GESTARTET") } }, select: { id: true, bezeichnung: true } }),
    prisma.teilnehmerStatus.findMany({ select: { code: true, bezeichnung: true } }),
  ]);
  const anmeldungVon = new Map(anmeldungen.map((a) => [a.id, a.person]));
  const personVon = new Map(personen.map((p) => [p.id, p]));
  const terminVon = new Map(termine.map((t) => [t.id, t.beginn]));
  const semesterVon = new Map(semester.map((s) => [s.id, s.bezeichnung]));
  const statusName = new Map(stati.map((s) => [s.code, s.bezeichnung]));
  // Diese Wechsel sagt schon ein anderer Eintrag (Anmeldung, Aufnahme, Anonymisierung).
  const stillerWechsel = new Set<string>([STATUS.INTERESSENT, STATUS.ANGENOMMEN, STATUS.ANONYMISIERT]);

  const ereignisse: ZuletztEreignis[] = eintraege.flatMap((e): ZuletztEreignis[] => {
    const nachher = e.nachher && typeof e.nachher === "object" && !Array.isArray(e.nachher) ? (e.nachher as Record<string, unknown>) : {};
    const id = e.objektId ?? "";
    if (e.aktion === "ANMELDUNG_ANGENOMMEN" || e.aktion === "ANMELDUNG_ABGELEHNT") {
      const person = anmeldungVon.get(id);
      if (!person || person.statusCode === STATUS.ANONYMISIERT) return [];
      const name = `${person.vorname} ${person.nachname}`;
      return [{ art: e.aktion === "ANMELDUNG_ANGENOMMEN" ? "aufgenommen" : "abgelehnt", am: e.erstelltAm, name }];
    }
    if (e.aktion === "STATUS_GEWECHSELT") {
      const person = personVon.get(id);
      const neu = typeof nachher.status === "string" ? nachher.status : "";
      if (!person || person.statusCode === STATUS.ANONYMISIERT || !neu || stillerWechsel.has(neu)) return [];
      return [{ art: "status", am: e.erstelltAm, name: `${person.vorname} ${person.nachname}`, status: statusName.get(neu) ?? neu }];
    }
    if (e.aktion === "ANWESENHEIT_SELBST_BESTAETIGT" || e.aktion === "ANWESENHEIT_ERFASST") {
      const einheit = terminVon.get(id);
      if (!einheit) return [];
      if (e.aktion === "ANWESENHEIT_SELBST_BESTAETIGT") {
        return e.akteurId ? [{ art: "selbst", am: e.erstelltAm, person: e.akteurId, einheit }] : [];
      }
      return [{ art: "erfasst", am: e.erstelltAm, einheit, von: e.akteur ? `${e.akteur.vorname} ${e.akteur.nachname}` : null }];
    }
    const bezeichnung = semesterVon.get(id);
    return bezeichnung ? [{ art: "ueberleitung", am: e.erstelltAm, semester: bezeichnung }] : [];
  });

  return zuletztZeilen(ereignisse);
}
