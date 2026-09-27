import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { alsTagText, deutscherTag, rueckmeldeFrist, rueckmeldeStand, semesterHatBegonnen } from "@/lib/semester";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { gruppiereAbende, kurzTitel } from "@/lib/abendplan";
import { einladungsZeitleiste, kalenderTagMonat, kurzZeitraum, ordneSemester } from "@/lib/semesterplan";
import { Hinweis, LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Abschnitt, Gruppe } from "@/components/ui/liste";
import { Seitenkopf } from "@/components/ui/seitenkopf";
import { StatusPunkt, type StatusTon } from "@/components/ui/status-punkt";
import { NeuesSemester, SemesterAktionen } from "./semester-aktionen";
import { SemesterUmschalter } from "./semester-umschalter";
import { Zeitleiste } from "./zeitleiste";

export const metadata = { title: "Semester" };
export const dynamic = "force-dynamic";

const WOCHENTAG = ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"];

type SemesterZeile = {
  id: string;
  bezeichnung: string;
  start: Date;
  ende: Date;
  istAktuell: boolean;
  lehrjahr: number | null;
  halbjahr: number | null;
};

/**
 * Semester (Oberflächenplan 09/2026): links die Semester — das laufende und das
 * nächste markiert —, rechts das gewählte (`?id=`) mit Rahmen und Fächern.
 * Darunter der Weg ins nächste Semester als Zeitleiste mit den echten Daten.
 * „Neues Semester“ und „Bearbeiten“ öffnen das Formular im Blatt.
 *
 * Genau ein Semester läuft. Es bestimmt, wen die Teilnehmerliste zeigt und
 * welchem Semester eine eingehende Anmeldung zugeordnet wird — außer ein anderes
 * Semester hat gerade ein offenes Anmeldefenster, dann gilt dieses.
 */
export default async function SemesterSeite({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const jetzt = new Date();
  const semester = await prisma.semester.findMany({ orderBy: { start: "asc" } });
  const { laufend, naechstes, aktuelle, fruehere } = ordneSemester(semester, jetzt);
  const gewaehlt = semester.find((s) => s.id === sp.id) ?? laufend ?? aktuelle[0] ?? fruehere[0] ?? null;

  const kopf = (
    <Seitenkopf titel="Semester" aktionen={<NeuesSemester />}>
      <SemesterUmschalter aktiv="semester" />
    </Seitenkopf>
  );

  if (!gewaehlt) {
    return (
      <main>
        {kopf}
        <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <LeererZustand icon="ebenen" titel="Noch ist kein Semester angelegt">
            „Neues Semester“ oben rechts legt das erste an.
          </LeererZustand>
        </div>
      </main>
    );
  }

  // Ein Blick auf das gewählte Semester: Teilnehmer (für das Semester Abgemeldete
  // zählen nicht), Abende und Fächer.
  const [teilnahmen, termine, kurseinheiten] = await Promise.all([
    prisma.teilnahme.groupBy({
      by: ["teilnahmeform"],
      where: { semesterId: gewaehlt.id, ...TEILNAHME_ZAEHLT },
      _count: { _all: true },
    }),
    prisma.unterrichtstermin.findMany({
      where: { semesterId: gewaehlt.id },
      select: { beginn: true, kurseinheitId: true },
    }),
    prisma.kurseinheit.findMany({
      where: {
        aktiv: true,
        ...(gewaehlt.lehrjahr !== null && gewaehlt.halbjahr !== null
          ? { jahrgangsjahr: gewaehlt.lehrjahr, halbjahr: gewaehlt.halbjahr }
          : { termine: { some: { semesterId: gewaehlt.id } } }),
      },
      orderBy: { sortierung: "asc" },
      select: { id: true, titel: true, stunden: true, fach: { select: { bezeichnung: true } } },
    }),
  ]);

  const anzahl = (form: string) => teilnahmen.find((t) => t.teilnahmeform === form)?._count._all ?? 0;
  const teilnehmerGesamt = teilnahmen.reduce((summe, t) => summe + t._count._all, 0);
  const schueler = anzahl("SCHUELER");
  const hoerer = anzahl("HOERER");

  const abende = gruppiereAbende(termine, jetzt);
  const gehalten = abende.filter((a) => a.einheiten.some((e) => e.beginn.getTime() <= jetzt.getTime())).length;
  const wochentage = new Set(abende.map((a) => new Date(`${a.tag}T12:00:00Z`).getUTCDay()));
  const wochentag = wochentage.size === 1 ? WOCHENTAG[[...wochentage][0]] : null;

  const zustand = (s: SemesterZeile): { ton: StatusTon; text: string } | null => {
    if (s.istAktuell) return { ton: "gruen", text: "läuft" };
    if (s.id === naechstes?.id) return { ton: "blau", text: "als Nächstes" };
    return null;
  };
  const kopfZustand: { ton: StatusTon; text: string } = gewaehlt.istAktuell
    ? { ton: "gruen", text: abende.length > 0 ? `läuft · Abend ${gehalten} von ${abende.length}` : "läuft" }
    : gewaehlt.id === naechstes?.id
      ? { ton: "blau", text: `als Nächstes · beginnt am ${kalenderTagMonat(gewaehlt.start)}` }
      : semesterHatBegonnen(gewaehlt.start, jetzt)
        ? { ton: "grau", text: fruehere.some((s) => s.id === gewaehlt.id) ? "vorbei" : "begonnen" }
        : { ton: "grau", text: "geplant" };

  const anmeldung =
    gewaehlt.anmeldungVon || gewaehlt.anmeldungBis
      ? `${gewaehlt.anmeldungVon ? `ab ${deutscherTag(gewaehlt.anmeldungVon)}` : "jederzeit"} bis ${
          gewaehlt.anmeldungBis ? deutscherTag(gewaehlt.anmeldungBis) : "offen"
        }`
      : null;

  return (
    <main>
      {kopf}
      <div className="flex flex-col lg:grid lg:min-h-[calc(100dvh-64px)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav
          aria-label="Semester"
          className="order-2 border-t border-linie px-2.5 py-4 lg:order-none lg:border-r lg:border-t-0 lg:px-3"
        >
          <p className="px-3 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dezent lg:hidden">Alle Semester</p>
          <SemesterListe semester={aktuelle} gewaehltId={gewaehlt.id} zustand={zustand} />
          {fruehere.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dezent">
                Frühere
              </p>
              <SemesterListe semester={fruehere} gewaehltId={gewaehlt.id} zustand={zustand} />
            </>
          )}
        </nav>

        <section aria-labelledby="semester-titel" className="order-1 px-4 py-5 sm:px-6 lg:order-none lg:px-9 lg:py-7">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="semester-titel" className="text-2xl font-semibold tracking-tight text-foreground lg:text-[26px]">
                {gewaehlt.bezeichnung}
              </h2>
              <StatusPunkt ton={kopfZustand.ton}>{kopfZustand.text}</StatusPunkt>
            </div>
            <SemesterAktionen
              semester={{
                id: gewaehlt.id,
                bezeichnung: gewaehlt.bezeichnung,
                istAktuell: gewaehlt.istAktuell,
                felder: {
                  code: gewaehlt.code,
                  bezeichnung: gewaehlt.bezeichnung,
                  start: alsTagText(gewaehlt.start),
                  ende: alsTagText(gewaehlt.ende),
                  anmeldungVon: alsTagText(gewaehlt.anmeldungVon),
                  anmeldungBis: alsTagText(gewaehlt.anmeldungBis),
                  lehrjahr: gewaehlt.lehrjahr !== null ? String(gewaehlt.lehrjahr) : "",
                  halbjahr: gewaehlt.halbjahr !== null ? String(gewaehlt.halbjahr) : "",
                },
              }}
              bisherLaufend={laufend?.bezeichnung ?? null}
            />
          </div>

          {!laufend && (
            <Hinweis className="mt-4" titel="Zurzeit läuft kein Semester.">
              Solange das so ist, bleibt die Teilnehmerliste leer und neue Anmeldungen bekommen keinen Semesterbezug. Ein
              Semester setzen Sie über „…“ neben „Bearbeiten“ als laufend.
            </Hinweis>
          )}

          <div className="mt-4 grid gap-x-6 lg:grid-cols-2">
            <div>
              <Abschnitt titel="Rahmen" className="lg:mt-0" />
              <Gruppe>
                <Angabe label="Zeitraum">
                  {`${kurzZeitraum(gewaehlt.start, gewaehlt.ende)}${wochentag ? `, ${wochentag}` : ""}`}
                </Angabe>
                <Angabe label="Kursraster">
                  {gewaehlt.lehrjahr !== null && gewaehlt.halbjahr !== null
                    ? `Lehrjahr ${gewaehlt.lehrjahr} · ${gewaehlt.halbjahr === 1 ? "Herbst" : "Frühling"}`
                    : "nicht zugeordnet"}
                </Angabe>
                <Angabe label="Teilnehmer">
                  {teilnehmerGesamt === 0
                    ? "Noch niemand zugeordnet"
                    : `${teilnehmerGesamt} · ${[schueler > 0 ? `${schueler} Schüler` : null, hoerer > 0 ? `${hoerer} Hörer` : null]
                        .filter(Boolean)
                        .join(", ")}`}
                </Angabe>
                {anmeldung && <Angabe label="Anmeldung">{anmeldung}</Angabe>}
                <Angabe label="Kürzel">{gewaehlt.code}</Angabe>
              </Gruppe>
            </div>
            <div className="mt-7 lg:mt-0">
              <Abschnitt titel="Fächer" className="lg:mt-0" />
              {kurseinheiten.length === 0 ? (
                <p className="rounded-xl border border-dashed border-linie px-4 py-6 text-center text-sm text-muted-foreground">
                  {gewaehlt.lehrjahr === null ? "Keinem Platz im Kursraster zugeordnet." : "Für diesen Platz im Kursraster sind keine Fächer hinterlegt."}
                </p>
              ) : (
                <Gruppe>
                  {kurseinheiten.map((k) => (
                    <div key={k.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{k.fach.bezeichnung}</p>
                        {kurzTitel(k.fach.bezeichnung, k.titel) && (
                          <p className="text-[13px] text-muted-foreground">{kurzTitel(k.fach.bezeichnung, k.titel)}</p>
                        )}
                      </div>
                      {k.stunden !== null && (
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{`${k.stunden} Std.`}</span>
                      )}
                    </div>
                  ))}
                </Gruppe>
              )}
            </div>
          </div>

          {gewaehlt.istAktuell && <InsNaechsteSemester laufendId={gewaehlt.id} naechstes={naechstes} jetzt={jetzt} />}
        </section>
      </div>
    </main>
  );
}

/**
 * Beschriftung links, Wert daneben — wie `WertZeile`, aber mit der schmaleren
 * Beschriftung des Entwurfs (100 px statt 144 px): In der halb breiten Karte
 * „Rahmen“ bricht sonst schon „20 · 15 Schüler, 5 Hörer“ um.
 */
function Angabe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-col justify-center gap-0.5 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-start sm:gap-4">
      <span className="shrink-0 text-[13px] text-muted-foreground sm:w-24">{label}</span>
      <span className="min-w-0 text-sm text-foreground">{children}</span>
    </div>
  );
}

function SemesterListe({
  semester,
  gewaehltId,
  zustand,
}: {
  semester: SemesterZeile[];
  gewaehltId: string;
  zustand: (s: SemesterZeile) => { ton: StatusTon; text: string } | null;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {semester.map((s) => {
        const z = zustand(s);
        const aktiv = s.id === gewaehltId;
        return (
          <li key={s.id}>
            <Link
              href={`/verwaltung/semester?id=${s.id}`}
              aria-current={aktiv ? "page" : undefined}
              className={`block rounded-[10px] px-3 py-2.5 ${aktiv ? "bg-feld" : "hover:bg-muted"}`}
            >
              <span className={`block text-sm text-foreground ${z ? "font-semibold" : "font-medium"}`}>{s.bezeichnung}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
                {z && (
                  <>
                    <StatusPunkt ton={z.ton}>{z.text}</StatusPunkt>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                {`${kurzZeitraum(s.start, s.ende)}${!z && s.lehrjahr !== null ? ` · Lehrjahr ${s.lehrjahr}` : ""}`}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Der Weg ins nächste Semester: die Einladung als Zeitleiste mit den echten
 * Daten. Vor dem Start die Zahl der Empfänger, danach der Stand der
 * Rückmeldungen; gestartet wird auf der Seite der Semesterüberleitung (dort die
 * Rückfrage mit der Zahl).
 */
async function InsNaechsteSemester({
  laufendId,
  naechstes,
  jetzt,
}: {
  laufendId: string;
  naechstes: { id: string; bezeichnung: string; start: Date } | null;
  jetzt: Date;
}) {
  if (!naechstes) {
    return (
      <>
        <Abschnitt titel="Ins nächste Semester" />
        <Hinweis icon="kalender-plus">Es gibt noch kein nächstes Semester. „Neues Semester“ oben rechts legt es an.</Hinweis>
      </>
    );
  }
  if (semesterHatBegonnen(naechstes.start, jetzt)) {
    return (
      <>
        <Abschnitt titel="Ins nächste Semester" />
        <Hinweis>{`${naechstes.bezeichnung} hat bereits begonnen — eingeladen wird nur in ein Semester, das noch bevorsteht.`}</Hinweis>
      </>
    );
  }

  const [o1, o2, o3, jahrgang, imZiel] = await Promise.all([
    zahl("SEMESTER_ERINNERUNG_1_TAGE"),
    zahl("SEMESTER_ERINNERUNG_2_TAGE"),
    zahl("SEMESTER_ERINNERUNG_3_TAGE"),
    // Eingeladen wird der Jahrgang des laufenden Semesters (aktiv, nicht
    // abgemeldet) — ohne die, die im Ziel schon eine Teilnahme haben.
    prisma.teilnahme.findMany({
      where: { semesterId: laufendId, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV },
      select: { personId: true },
    }),
    prisma.teilnahme.findMany({
      where: { semesterId: naechstes.id },
      select: { personId: true, eingeladenAm: true, bestaetigtAm: true, abgemeldetAm: true },
    }),
  ]);
  const imZielIds = new Set(imZiel.map((t) => t.personId));
  const einzuladen = jahrgang.filter((t) => !imZielIds.has(t.personId)).length;
  const eingeladene = imZiel.filter((t) => t.eingeladenAm !== null);
  const eingeladenAm = eingeladene.reduce<Date | null>(
    (frueheste, t) => (t.eingeladenAm && (!frueheste || t.eingeladenAm < frueheste) ? t.eingeladenAm : frueheste),
    null,
  );
  const stand = { dabei: 0, offen: 0, abgemeldet: 0 };
  for (const t of eingeladene) {
    const s = rueckmeldeStand(t);
    if (s === "bestaetigt") stand.dabei++;
    else if (s === "offen") stand.offen++;
    else if (s === "abgemeldet") stand.abgemeldet++;
  }

  return (
    <>
      <Abschnitt titel="Ins nächste Semester" />
      <div className="rounded-xl border border-linie bg-card px-5 py-4">
        <p className="font-semibold text-foreground">{`Einladung ins ${naechstes.bezeichnung}`}</p>
        <p className="text-[13px] text-muted-foreground">
          {eingeladenAm
            ? `${eingeladene.length} eingeladen: ${stand.dabei} dabei · ${stand.offen} ohne Antwort · ${stand.abgemeldet} abgemeldet.` +
              (einzuladen > 0 ? ` ${einzuladen} ${einzuladen === 1 ? "ist" : "sind"} noch nicht eingeladen.` : "")
            : einzuladen > 0
              ? `Alle ${einzuladen} bekommen eine Mail mit „Ich bin dabei“ oder „Ich bin raus“.`
              : "Alle aus dem laufenden Semester haben dort schon eine Teilnahme."}
        </p>
        <div className="my-5">
          <Zeitleiste
            punkte={einladungsZeitleiste({ start: naechstes.start, offsetsTage: [o1, o2, o3], eingeladenAm, jetzt })}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link href="/verwaltung/semesterueberleitung" className={`shrink-0 ${knopf(eingeladenAm ? "sekundaer" : "primaer")}`}>
            {eingeladenAm ? "Rückmeldungen ansehen" : "Einladung vorbereiten …"}
          </Link>
          <p className="text-[13px] text-muted-foreground">
            {eingeladenAm
              ? `Wer bis ${deutscherTag(rueckmeldeFrist(naechstes.start))} nicht antwortet, ist ab Semesterbeginn abgemeldet und lässt sich einzeln wieder aufnehmen.`
              : "Vor dem Versand kommt eine Rückfrage mit der Zahl der Empfänger. Wer nicht antwortet, ist ab Semesterbeginn abgemeldet und lässt sich einzeln wieder aufnehmen."}
          </p>
        </div>
      </div>
    </>
  );
}
