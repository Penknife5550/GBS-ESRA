import type { ReactNode } from "react";
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
import { einladungsZeitleiste } from "@/lib/semesterplan";
import { PERSON_ZAEHLT_AKTIV, TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { ladeNichtZugestellte, versandLaeuft } from "@/lib/ueberleitung";
import { Hinweis, LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Abschnitt } from "@/components/ui/liste";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { StatusPunkt } from "@/components/ui/status-punkt";
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

/**
 * Semesterüberleitung (unter „Semester“): Der Jahrgang des laufenden Semesters
 * wird ins Folgesemester eingeladen — jeder bekommt einen persönlichen Link für
 * „Ich bin dabei“ oder „Ich bin raus“, wer nicht antwortet, wird vor Beginn
 * erinnert und ist ab Semesterbeginn abgemeldet. Oberflächenplan 09/2026: der
 * Ablauf als Zeitleiste mit den echten Daten, der Stand der Rückmeldungen als
 * Zahlen, darunter die Listen, in denen etwas zu tun ist (nicht zugestellt, ohne
 * Antwort, abgemeldet). Statt langer Erklärungen stehen kurze Hinweise dort, wo
 * gehandelt wird.
 */
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

  // Wen die Überleitung einladen würde: der Jahrgang des laufenden Semesters
  // (aktiv, nicht abgemeldet) ohne die, die im Ziel schon eine Teilnahme haben.
  const zielIds = semester.filter((s) => s.id !== laufend?.id && !semesterHatBegonnen(s.start, jetzt)).map((s) => s.id);
  const [jahrgang, imZiel] = laufend
    ? await Promise.all([
        prisma.teilnahme.findMany({
          where: { semesterId: laufend.id, ...TEILNAHME_ZAEHLT, person: PERSON_ZAEHLT_AKTIV },
          select: { personId: true },
        }),
        prisma.teilnahme.findMany({ where: { semesterId: { in: zielIds } }, select: { semesterId: true, personId: true } }),
      ])
    : [[], []];
  const fruehesteEinladung = new Map<string, Date>();
  for (const t of eingeladene) {
    const bisher = fruehesteEinladung.get(t.semesterId);
    if (t.eingeladenAm && (!bisher || t.eingeladenAm < bisher)) fruehesteEinladung.set(t.semesterId, t.eingeladenAm);
  }

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
      einzuladen: jahrgang.filter((j) => !imZiel.some((t) => t.semesterId === s.id && t.personId === j.personId)).length,
      zeitleiste: einladungsZeitleiste({
        start: s.start,
        offsetsTage: [o1, o2, o3],
        eingeladenAm: fruehesteEinladung.get(s.id) ?? null,
        jetzt,
      }),
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
    <main>
      <Seitenkopf titel="Semesterüberleitung" zurueck={{ href: "/verwaltung/semester", text: "Semester" }} />
      <Inhalt breite="mittel">
        {!laufend ? (
          <Hinweis
            titel="Zurzeit läuft kein Semester."
            aktion={
              <Link href="/verwaltung/semester" className={knopf("sekundaer")}>
                Zu den Semestern
              </Link>
            }
          >
            Die Überleitung geht immer vom laufenden Semester aus — bitte zuerst das aktuelle Semester festlegen.
          </Hinweis>
        ) : (
          <UeberleitungStarten ziele={ziele} laufend={laufend.bezeichnung} />
        )}

        <Abschnitt titel="Stand der Rückmeldungen" className="mt-9" />
        {staende.length === 0 ? (
          <LeererZustand icon="senden" titel="Noch keine Einladung verschickt">
            Noch wurde für kein Semester eine Überleitung gestartet.
          </LeererZustand>
        ) : (
          <div className="flex flex-col gap-6">
            {staende.map((s) => {
              const gesamt = s.bestaetigt + s.offen.length + s.abgemeldet.length;
              const zustand = zustellung.get(s.id);
              const nichtZugestellt = zustand?.nichtZugestellt.size ?? 0;
              const ohneZustellung = s.offen.filter((p) => zustand?.nichtZugestellt.has(p.teilnahmeId));
              const ohneAntwort = s.offen.filter((p) => !ohneZustellung.includes(p));
              return (
                <section key={s.id} aria-labelledby={`stand-${s.id}`} className="overflow-hidden rounded-xl border border-linie bg-card">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-linie px-5 py-3">
                    <h3 id={`stand-${s.id}`} className="text-[15px] font-semibold text-foreground">
                      {s.bezeichnung}
                    </h3>
                    <span className="text-[13px] text-muted-foreground">{s.zeitraum}</span>
                  </div>
                  <dl className="grid grid-cols-2 border-b border-linie sm:grid-cols-4">
                    {[
                      { wort: "eingeladen", zahl: gesamt },
                      { wort: "dabei", zahl: s.bestaetigt },
                      { wort: "ohne Antwort", zahl: s.offen.length },
                      { wort: "abgemeldet", zahl: s.abgemeldet.length },
                    ].map((k, i) => (
                      <div
                        key={k.wort}
                        className={`flex flex-col-reverse px-5 py-3 ${i % 2 === 1 ? "border-l border-linie" : ""} ${i > 1 ? "border-t border-linie sm:border-t-0 sm:border-l" : ""}`}
                      >
                        <dt className="text-[13px] text-muted-foreground">{k.wort}</dt>
                        <dd className="text-2xl font-semibold tabular-nums text-foreground">{k.zahl}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="flex flex-col gap-6 px-5 py-4 empty:hidden">
                    {zustand && (zustand.laeuft || nichtZugestellt > 0) && (
                      <div>
                        <Nachversand semesterId={s.id} semester={s.bezeichnung} anzahl={nichtZugestellt} laeuft={zustand.laeuft} />
                        {ohneZustellung.length > 0 && (
                          <PersonenListe
                            personen={ohneZustellung}
                            nichtZugestellt
                            aktion={(p) => <ZusageKnopf teilnahmeId={p.teilnahmeId} name={p.name} semester={s.bezeichnung} />}
                          />
                        )}
                      </div>
                    )}

                    {ohneAntwort.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">{`Noch ohne Antwort (${ohneAntwort.length})`}</h4>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          {s.begonnen
                            ? "Das Semester hat begonnen — beim nächsten stündlichen Lauf werden sie als „keine Rückmeldung“ abgemeldet. Wer schon am Unterricht teilgenommen hat (Anwesenheit oder Note), gilt dann als bestätigt."
                            : `Antworten ist bis einschließlich ${s.frist} möglich, danach sind sie abgemeldet. Eine Zusage am Telefon tragen Sie hier ein.`}
                        </p>
                        <PersonenListe
                          personen={ohneAntwort}
                          aktion={(p) => <ZusageKnopf teilnahmeId={p.teilnahmeId} name={p.name} semester={s.bezeichnung} />}
                        />
                      </div>
                    )}

                    {s.abgemeldet.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">{`Abgemeldet (${s.abgemeldet.length})`}</h4>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">
                          Sie stehen in keiner Liste dieses Semesters (Anwesenheit, Noten, Excel-Liste, Zeugnisse); der Status der
                          Person bleibt, wie er ist.
                        </p>
                        <PersonenListe
                          personen={s.abgemeldet}
                          untertitel={(p) => `${p.grund}${p.am ? ` · seit ${p.am}` : ""}`}
                          aktion={(p) => <WiederAufnehmenKnopf teilnahmeId={p.teilnahmeId} name={p.name} semester={s.bezeichnung} />}
                        />
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Inhalt>
    </main>
  );
}

/** Personen mit dem, was bei ihnen zu tun ist — nur aktive Personen bekommen den Knopf. */
function PersonenListe<T extends PersonZeile>({
  personen,
  aktion,
  untertitel,
  nichtZugestellt = false,
}: {
  personen: T[];
  aktion: (p: T) => ReactNode;
  untertitel?: (p: T) => string;
  nichtZugestellt?: boolean;
}) {
  return (
    <ul className="mt-2 divide-y divide-linie overflow-hidden rounded-xl border border-linie">
      {personen.map((p) => (
        <li key={p.teilnahmeId} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{p.name}</p>
            {untertitel && <p className="text-[13px] text-muted-foreground">{untertitel(p)}</p>}
            {nichtZugestellt && <StatusPunkt ton="rot">nicht zugestellt</StatusPunkt>}
          </div>
          {p.istAktiv ? aktion(p) : <span className="text-[13px] text-muted-foreground">Person nicht aktiv</span>}
        </li>
      ))}
    </ul>
  );
}
