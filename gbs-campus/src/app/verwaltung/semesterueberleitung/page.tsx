import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { datum } from "@/lib/datum";
import { zahl } from "@/lib/einstellungen";
import {
  abmeldegrundText,
  deutscherTag,
  erledigteStufenBeiEinladung,
  rueckmeldeFrist,
  rueckmeldeStand,
  semesterHatBegonnen,
  semesterZeitraum,
} from "@/lib/semester";
import { ladeNichtZugestellte, versandLaeuft } from "@/lib/ueberleitung";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { Badge } from "@/components/ui/badges";
import { UeberleitungStarten } from "./ueberleitung-starten";
import { WiederAufnehmenKnopf } from "./wieder-aufnehmen-knopf";
import { ZusageKnopf } from "./zusage-knopf";
import { Nachversand } from "./nachversand";

export const metadata = { title: "Semesterüberleitung" };
export const dynamic = "force-dynamic";

type PersonZeile = { teilnahmeId: string; name: string; istAktiv: boolean };
type AbgemeldetZeile = PersonZeile & { grund: string; am: string };
type SemesterStand = { bestaetigt: number; offen: PersonZeile[]; abgemeldet: AbgemeldetZeile[] };
/** Nachversand eines Semesters: läuft gerade ein Versand, und welche offenen Einladungen kamen nie an. */
type Zustellstand = { laeuft: boolean; nichtZugestellt: Set<string> };

export default async function SemesterueberleitungSeite() {
  const benutzer = await ladeMitRecht(RECHT.SEMESTER_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  // Der Stand kommt aus den Zeitstempeln der Teilnahme (eingeladen / bestätigt /
  // abgemeldet), NICHT aus dem Token: Den löscht der Aufräumlauf eine Woche nach
  // Semesterstart, danach waren Unbeantwortete früher nicht mehr zu erkennen.
  const [semester, eingeladene, o1, o2, o3] = await Promise.all([
    prisma.semester.findMany({ orderBy: { start: "asc" } }),
    prisma.teilnahme.findMany({
      where: { OR: [{ eingeladenAm: { not: null } }, { abgemeldetAm: { not: null } }] },
      orderBy: [{ person: { nachname: "asc" } }, { person: { vorname: "asc" } }],
      select: {
        id: true,
        semesterId: true,
        eingeladenAm: true,
        bestaetigtAm: true,
        abgemeldetAm: true,
        abmeldeGrund: true,
        person: { select: { vorname: true, nachname: true, status: { select: { istAktiv: true } } } },
      },
    }),
    zahl("SEMESTER_ERINNERUNG_1_TAGE"),
    zahl("SEMESTER_ERINNERUNG_2_TAGE"),
    zahl("SEMESTER_ERINNERUNG_3_TAGE"),
  ]);

  const jetzt = new Date();
  const laufend = semester.find((s) => s.istAktuell);

  // Eingeladen wird nur in ein Semester, das noch bevorsteht — in einem
  // begonnenen wären die Links sofort abgelaufen.
  // `keineErinnerungMehr`: Alle Stichtage liegen heute oder früher — die
  // Einladung erledigt alle Stufen, eine nicht zugestellte wird nie wiederholt.
  const ziele = semester
    .filter((s) => s.id !== laufend?.id && !semesterHatBegonnen(s.start, jetzt))
    .map((s) => ({
      id: s.id,
      bezeichnung: s.bezeichnung,
      zeitraum: semesterZeitraum(s.start, s.ende),
      keineErinnerungMehr: erledigteStufenBeiEinladung(s.start, jetzt, [o1, o2, o3]).length === 3,
    }));

  const proSemester = new Map<string, SemesterStand>();
  for (const t of eingeladene) {
    const stand = rueckmeldeStand(t);
    const eintrag: SemesterStand = proSemester.get(t.semesterId) ?? { bestaetigt: 0, offen: [], abgemeldet: [] };
    const person: PersonZeile = {
      teilnahmeId: t.id,
      name: `${t.person.nachname}, ${t.person.vorname}`,
      istAktiv: t.person.status.istAktiv,
    };
    if (stand === "bestaetigt") eintrag.bestaetigt++;
    else if (stand === "offen") eintrag.offen.push(person);
    else if (stand === "abgemeldet") {
      eintrag.abgemeldet.push({ ...person, grund: abmeldegrundText(t.abmeldeGrund), am: datum(t.abgemeldetAm) });
    }
    proSemester.set(t.semesterId, eintrag);
  }

  // Semester, für die schon eingeladen wurde — der Stand der Rückmeldungen,
  // neuestes zuerst.
  const staende = semester
    .filter((s) => proSemester.has(s.id))
    .map((s) => ({
      id: s.id,
      bezeichnung: s.bezeichnung,
      zeitraum: semesterZeitraum(s.start, s.ende),
      begonnen: semesterHatBegonnen(s.start, jetzt),
      frist: deutscherTag(rueckmeldeFrist(s.start)),
      ...proSemester.get(s.id)!,
    }))
    .reverse();

  // Nicht zugestellte Einladungen — nur solange das Semester noch nicht begonnen
  // hat (danach lässt sich nicht mehr erneut senden). Dieselbe Abfrage wie der
  // Knopf (`ladeNichtZugestellte`). Während eines Versands fehlen die
  // GESENDET-Zeilen noch; dann zählt die Seite nicht, sondern sagt, dass
  // verschickt wird.
  const zustellung = new Map<string, Zustellstand>();
  await Promise.all(
    staende
      .filter((s) => !s.begonnen && s.offen.length > 0)
      .map(async (s) => {
        const laeuft = versandLaeuft(s.id);
        const nichtZugestellt = laeuft ? [] : await ladeNichtZugestellte(s.id);
        zustellung.set(s.id, { laeuft, nichtZugestellt: new Set(nichtZugestellt.map((t) => t.id)) });
      }),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Semesterüberleitung" />

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Semesterüberleitung</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Lädt den Jahrgang des laufenden Semesters ins Folgesemester ein: Jeder Teilnehmer bekommt eine
        Einladung mit einem persönlichen Link, über den er „Ich bin dabei" oder „Ich bin raus" sagt. Wer
        nicht antwortet, wird {o1}, {o2} und {o3} Tage vor Semesterstart automatisch erinnert. Starten Sie
        die Überleitung erst an oder nach einem dieser Stichtage, zählt die Einladung für diese Stichtage mit —
        am selben Tag geht nie eine zweite Mail hinterher.
      </p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Antworten ist bis einschließlich zum Tag vor Semesterbeginn möglich. Wer absagt oder bis dahin nicht
        antwortet, ist für das neue Semester abgemeldet und steht in keiner Liste dieses Semesters
        (Anwesenheit, Noten, Excel-Liste, Zeugnisse). Der Status der Person bleibt dabei unverändert.
        Einzelne Abgemeldete lassen sich unten wieder aufnehmen.
      </p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Kam eine Zusage am Telefon oder persönlich, tragen Sie sie unter „Noch ohne Antwort“ ein. Ist eine
        Einladung nie angekommen, können Sie sie bis zum Tag vor Semesterbeginn erneut senden.
      </p>

      {!laufend ? (
        <p className="mt-6 rounded-lg border border-border bg-credo-gelb/15 px-4 py-3 text-sm">
          Zurzeit ist kein Semester als laufend gesetzt. Die Überleitung geht immer vom laufenden
          Semester aus — bitte zuerst unter{" "}
          <Link href="/verwaltung/semester" className="underline underline-offset-2">
            Semester
          </Link>{" "}
          das aktuelle Semester festlegen.
        </p>
      ) : (
        <>
          <h2 className="mt-10 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Überleitung starten
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Aus dem laufenden Semester <span className="font-medium text-foreground">{laufend.bezeichnung}</span>{" "}
            in ein Folgesemester, das noch nicht begonnen hat. Ein zweiter Start lädt niemanden doppelt ein.
          </p>
          <div className="mt-4">
            <UeberleitungStarten ziele={ziele} laufend={laufend.bezeichnung} />
          </div>
        </>
      )}

      <h2 className="mt-12 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Stand der Rückmeldungen
      </h2>
      {staende.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Noch wurde für kein Semester eine Überleitung gestartet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {staende.map((s) => {
            const gesamt = s.bestaetigt + s.offen.length + s.abgemeldet.length;
            const zustand = zustellung.get(s.id);
            const nichtZugestellt = zustand?.nichtZugestellt.size ?? 0;
            return (
              <li key={s.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.bezeichnung}</span>
                  <span className="text-xs text-muted-foreground">{s.zeitraum}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 font-medium">
                    {gesamt} eingeladen
                  </span>
                  <span className="inline-flex rounded-full bg-credo-gruen/15 px-2.5 py-0.5 font-medium">
                    {s.bestaetigt} bestätigt
                  </span>
                  <span className="inline-flex rounded-full bg-credo-gelb/20 px-2.5 py-0.5 font-medium">
                    {s.offen.length} offen
                  </span>
                  <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 font-medium">
                    {s.abgemeldet.length} abgemeldet
                  </span>
                </div>

                {zustand && (zustand.laeuft || nichtZugestellt > 0) && (
                  <Nachversand
                    semesterId={s.id}
                    semester={s.bezeichnung}
                    anzahl={nichtZugestellt}
                    laeuft={zustand.laeuft}
                  />
                )}

                {s.offen.length > 0 && (
                  <details className="mt-4 text-sm" open={nichtZugestellt > 0}>
                    <summary className="cursor-pointer font-medium">
                      Noch ohne Antwort ({s.offen.length})
                    </summary>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {s.begonnen
                        ? "Das Semester hat begonnen — beim nächsten stündlichen Lauf werden sie als „keine Rückmeldung“ abgemeldet. Wer schon am Unterricht teilgenommen hat (Anwesenheit oder Note), gilt dann als bestätigt."
                        : `Antworten ist bis einschließlich ${s.frist} möglich — wer bis dahin nicht antwortet, wird zum Semesterstart automatisch abgemeldet. Hat jemand am Telefon oder persönlich zugesagt, tragen Sie die Zusage hier ein.`}
                    </p>
                    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                      {s.offen.map((p) => (
                        <li key={p.teilnahmeId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            {zustand?.nichtZugestellt.has(p.teilnahmeId) && (
                              <Badge ton="bg-credo-rot/12 text-foreground">nicht zugestellt</Badge>
                            )}
                          </div>
                          {p.istAktiv ? (
                            <ZusageKnopf teilnahmeId={p.teilnahmeId} name={p.name} semester={s.bezeichnung} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Person nicht aktiv</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {s.abgemeldet.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium">Abgemeldet</h3>
                    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                      {s.abgemeldet.map((p) => (
                        <li key={p.teilnahmeId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0 text-sm">
                            <span className="font-medium">{p.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {p.grund}
                              {p.am && ` · seit ${p.am}`}
                            </span>
                          </div>
                          {p.istAktiv ? (
                            <WiederAufnehmenKnopf teilnahmeId={p.teilnahmeId} name={p.name} semester={s.bezeichnung} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Person nicht aktiv</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
