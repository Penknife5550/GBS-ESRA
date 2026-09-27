import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AnmeldungStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ladeMitRecht, hatRecht } from "@/lib/berechtigung";
import { RECHT, STATUS } from "@/lib/constants";
import { abmeldegrundText, alsHeutigerTag, alsTagText, deutscherTag, teilnahmeformName } from "@/lib/semester";
import { SYSTEM_GRUENDE, SYSTEM_GRUND, waehlbareZiele } from "@/lib/status";
import { datum, heuteBerlin } from "@/lib/datum";
import { art9EinwilligungenWirksam } from "@/lib/anmeldung-antworten";
import { ladeEigeneLeistungen, ladePersonNoten } from "@/lib/leistung-io";
import { ladeEigeneUnterrichtstermine, type EigeneTerminGruppe } from "@/lib/stundenplan-io";
import { ladeZeugnisseDerPerson } from "@/lib/zeugnis-io";
import { stornoRueckfrage, zeugnisStatusName } from "@/lib/zeugnis";
import { ZeugnisStorno } from "../../zeugnisse/zeugnis-storno";
import { Inhalt } from "@/components/ui/seitenkopf";
import { Abschnitt, Gruppe } from "@/components/ui/liste";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { NotenInline } from "@/components/personen/noten-inline";
import { AnwesenheitListe, type Einheit } from "@/components/personen/anwesenheit-liste";
import { PersonAktionen } from "@/components/personen/person-aktionen";
import { AkteKopf, Angabe, GruppenText, NotenZeilen, VerlaufListe } from "@/components/personen/akte-bausteine";
import { alterInJahren, zeugnisTon } from "@/components/personen/akte-anzeige";

export const metadata = { title: "Personenakte" };
export const dynamic = "force-dynamic";

/**
 * „abgemeldet (Grund)" zu einer Teilnahme der Semesterüberleitung — der Grund
 * im selben Wortlaut wie in der Überleitungsübersicht (`abmeldegrundText`).
 */
function abgemeldetText(grund: string | null): string {
  return grund ? `abgemeldet (${abmeldegrundText(grund)})` : "abgemeldet";
}

/**
 * Personenakte als Leseansicht (Oberflächenplan 09/2026): links das laufende
 * Semester mit Anwesenheit und Noten, rechts Kontakt, Ausbildung, Zeugnisse und
 * Verlauf. Bearbeitet wird im Blatt — über „Bearbeiten“ (Stammdaten), das Menü
 * „…“ (`PersonAktionen`) und „Noten eintragen“ (`NotenInline`).
 */
export default async function PersonDetailSeite({ params }: { params: Promise<{ id: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.PERSON_LESEN_ALLE);
  if (!benutzer) redirect("/anmelden");

  const { id } = await params;

  const darfAendern = hatRecht(benutzer, RECHT.PERSON_BEARBEITEN_ALLE);
  const darfAuskunft = hatRecht(benutzer, RECHT.PERSON_EXPORTIEREN);
  const darfAnonymisieren = hatRecht(benutzer, RECHT.PERSON_ANONYMISIEREN);
  const darfRollen = hatRecht(benutzer, RECHT.BENUTZER_VERWALTEN);
  // Noten/Zeugnisse sind eine pädagogische Sicht — bewusst nur mit NOTEN_VERWALTEN
  // (Schulleitung), NICHT für Verwaltung/Administrator, die zwar PERSON_LESEN_ALLE
  // tragen. Es gibt kein separates „Noten-Lesen"-Recht; NOTEN_VERWALTEN ist die Grenze.
  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_VERWALTEN);
  // Status und Ausbildungsdaten (Geburtsdatum, Gemeinde, Teilnahmeform) — nur
  // die Schulleitung (Code-Review 4, M9).
  const darfStatus = hatRecht(benutzer, RECHT.PERSON_STATUS_WECHSELN);
  // Der Hinweis auf eine offene Anmeldung führt dorthin — nur wer sie lesen darf.
  const darfAnmeldungen = hatRecht(benutzer, RECHT.ANMELDUNG_LESEN);

  // Beide Abfragen sind unabhängig voneinander — gebündelt statt nacheinander.
  const [person, aktuellesSemester] = await Promise.all([
    prisma.person.findUnique({
      where: { id },
      include: {
        status: true,
        ermaessigung: true,
        rollen: { select: { rolle: { select: { code: true } } } },
        teilnahmen: { include: { semester: true }, orderBy: { semester: { start: "desc" } } },
        // Der Verlauf rechts: jeder Statuswechsel, jüngster zuerst.
        statusWechsel: {
          orderBy: { erstelltAm: "desc" },
          select: {
            id: true,
            vonCode: true,
            grund: true,
            erstelltAm: true,
            von: { select: { bezeichnung: true } },
            nach: { select: { bezeichnung: true } },
            ausgeloestVon: { select: { vorname: true, nachname: true } },
          },
        },
      },
    }),
    prisma.semester.findFirst({
      where: { istAktuell: true },
      select: { id: true, bezeichnung: true },
    }),
  ]);
  if (!person) notFound();

  const istAnonym = person.status.code === STATUS.ANONYMISIERT;
  const aktuelleTeilnahme = aktuellesSemester
    ? person.teilnahmen.find((t) => t.semesterId === aktuellesSemester.id) ?? null
    : null;
  // Eine abgemeldete Teilnahme zählt nicht (Semesterüberleitung) — für den
  // Block „Ausbildungsdaten & Status" gilt sie nicht als laufend.
  const zaehlendeTeilnahme = aktuelleTeilnahme && !aktuelleTeilnahme.abgemeldetAm ? aktuelleTeilnahme : null;
  // Kopf und Teilnahmeform nach derselben Regel wie der Editor
  // „Ausbildungsdaten“: nie aus einer abgemeldeten Teilnahme.
  const anzeigeForm =
    zaehlendeTeilnahme?.teilnahmeform ??
    person.teilnahmen.find((t) => !t.abgemeldetAm)?.teilnahmeform ??
    person.teilnahmeform;
  // Die Teilnahmen, für die ein Wechsel der Teilnahmeform mitgilt: die des
  // laufenden Semesters und schon angelegte für noch nicht begonnene Semester —
  // dieselbe Auswahl wie `/api/personen/[id]/ausbildungsdaten`. Abgemeldete
  // gehen mit (sonst gälte nach einer Wiederaufnahme die alte Form) und werden
  // als solche benannt.
  const heute = alsHeutigerTag(new Date());
  const offeneSemester = person.teilnahmen
    .filter((t) => t.semesterId === aktuellesSemester?.id || t.semester.start.getTime() > heute.getTime())
    .map((t) => (t.abgemeldetAm ? `${t.semester.bezeichnung} (abgemeldet)` : t.semester.bezeichnung))
    .reverse();

  const zeigeAusbildung = darfStatus && !istAnonym;
  // Den eigenen Status lehnt die Statusroute ab (403) — dann gibt es keine Auswahl.
  const eigeneAkte = person.id === benutzer.id;
  // Noten nur für Personen, die noch benotet werden: nicht im Endzustand und
  // nicht anonymisiert (der Schreibweg nimmt dafür ohnehin nichts an).
  const zeigeNotenEditor = darfNoten && Boolean(aktuellesSemester) && !person.status.istTerminal;
  // Ein Zeitpunkt für Anwesenheit und Termindetails — sonst könnte eine gerade
  // beginnende Einheit in der einen Abfrage fehlen und in der anderen nicht.
  const jetzt = new Date();
  const semesterIds = person.teilnahmen.map((t) => t.semesterId);
  const [leistungGruppen, anwesenheitGruppen, zeugnisse, personNoten, alleRollen, statusListe, art9, offeneAnmeldung, termine] =
    await Promise.all([
      darfNoten ? ladeEigeneLeistungen(person.id) : Promise.resolve([]),
      ladeEigeneUnterrichtstermine(person.id, jetzt),
      darfNoten ? ladeZeugnisseDerPerson(person.id) : Promise.resolve([]),
      zeigeNotenEditor && aktuellesSemester ? ladePersonNoten(person.id, aktuellesSemester.id) : Promise.resolve(null),
      darfRollen
        ? prisma.rolle.findMany({ select: { code: true, bezeichnung: true }, orderBy: { sortierung: "asc" } })
        : Promise.resolve([] as { code: string; bezeichnung: string }[]),
      zeigeAusbildung && !eigeneAkte
        ? prisma.teilnehmerStatus.findMany({
            select: { code: true, bezeichnung: true, istTerminal: true, istAktiv: true },
            orderBy: { sortierung: "asc" },
          })
        : Promise.resolve([] as { code: string; bezeichnung: string; istTerminal: boolean; istAktiv: boolean }[]),
      // Alle Art.-9-Texte (je Text gilt die jüngste Zeile, alle müssen wirksam
      // sein) — dieselbe Regel wie die Anmeldungsansicht und die Route.
      zeigeAusbildung
        ? prisma.einwilligung.findMany({
            where: { personId: person.id, text: { istArt9: true } },
            select: { erteilt: true, zeitpunkt: true, text: { select: { code: true } } },
          })
        : Promise.resolve([] as { erteilt: boolean; zeitpunkt: Date; text: { code: string } }[]),
      // Eine eingereichte, noch nicht entschiedene Anmeldung: Hinweis oben und —
      // solange die Person Interessent ist — kein Statuswechsel von Hand (siehe
      // `pruefeStatuswechsel`).
      zeigeAusbildung || darfAnmeldungen
        ? prisma.anmeldung.findFirst({
            where: { personId: person.id, status: AnmeldungStatus.EINGEREICHT },
            orderBy: { eingereichtAm: "desc" },
            select: { id: true, eingereichtAm: true },
          })
        : Promise.resolve(null),
      // Fach und Thema der vergangenen Einheiten — nur für die Anzeige; Stand und
      // Quote kommen unverändert aus `ladeEigeneUnterrichtstermine`.
      semesterIds.length > 0
        ? prisma.unterrichtstermin.findMany({
            where: { semesterId: { in: semesterIds }, beginn: { lte: jetzt } },
            select: {
              id: true,
              beginn: true,
              thema: true,
              kurseinheit: { select: { fach: { select: { bezeichnung: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);
  const anmeldungOffen = person.statusCode === STATUS.INTERESSENT && offeneAnmeldung !== null;

  // Read-only Notenverlauf: das laufende Semester weglassen (steht schon als Editor).
  const verlaufGruppen = personNoten
    ? leistungGruppen.filter((g) => g.semesterBezeichnung !== personNoten.semesterBezeichnung)
    : leistungGruppen;

  const terminDetails = new Map(termine.map((t) => [t.id, t]));
  const einheitenVon = (gruppe: EigeneTerminGruppe): Einheit[] =>
    gruppe.termine.map((t) => {
      const d = terminDetails.get(t.id);
      return {
        id: t.id,
        beginn: d?.beginn ?? null,
        ersatzText: t.text,
        titel: [d?.kurseinheit?.fach.bezeichnung ?? t.kurstitel, d?.thema].filter(Boolean).join(" · ") || "Unterricht",
        status: t.status,
        // Einen erfassten Abend darf der Teilnehmer nur ändern, wenn er ihn selbst
        // gesetzt hat (`darfSelbstSetzen`) — genau das heißt hier „selbst bestätigt“.
        selbst: t.status !== null && t.darfBestaetigen,
      };
    });
  const aktuelleGruppe = zaehlendeTeilnahme
    ? anwesenheitGruppen.find((g) => g.teilnahmeId === zaehlendeTeilnahme.id)
    : undefined;
  const fruehereGruppen = anwesenheitGruppen.filter((g) => g !== aktuelleGruppe);

  const name = `${person.vorname} ${person.nachname}`;
  const adresse = [person.strasse, [person.plz, person.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const alter = person.geburtsdatum ? alterInJahren(person.geburtsdatum, heuteBerlin()) : null;
  const zeigeAusbildungAngaben =
    person.teilnahmen.length > 0 ||
    Boolean(person.teilnahmeform || person.geburtsdatum || person.gemeinde || person.ibanVerschluesselt || person.ermaessigung);
  const zeigeNoten = darfNoten && (aktuelleTeilnahme !== null || leistungGruppen.length > 0);

  return (
    <main>
      <PersonAktionen
        person={{
          id: person.id,
          name,
          vorname: person.vorname,
          nachname: person.nachname,
          // Adress-/Kontaktfelder nur übergeben, wenn sie bearbeitet werden dürfen —
          // sonst landen sie unnötig im Client-Bundle (z. B. für einen Admin, der
          // nur Rollen darf).
          telefon: darfAendern ? person.telefon ?? "" : "",
          strasse: darfAendern ? person.strasse ?? "" : "",
          plz: darfAendern ? person.plz ?? "" : "",
          ort: darfAendern ? person.ort ?? "" : "",
          email: person.email,
          status: person.status.bezeichnung,
          istTerminal: person.status.istTerminal,
          istAnonym,
          rollenCodes: person.rollen.map((r) => r.rolle.code),
        }}
        darfAendern={darfAendern}
        darfAuskunft={darfAuskunft}
        darfAnonymisieren={darfAnonymisieren}
        darfRollenVerwalten={darfRollen}
        alleRollen={alleRollen}
        istEigeneAkte={eigeneAkte}
        ausbildung={
          zeigeAusbildung
            ? {
                personId: person.id,
                name,
                status: {
                  code: person.status.code,
                  bezeichnung: person.status.bezeichnung,
                  istTerminal: person.status.istTerminal,
                  istAktiv: person.status.istAktiv,
                },
                ziele: eigeneAkte ? [] : waehlbareZiele(statusListe, person.statusCode, person.status.istTerminal, anmeldungOffen),
                eigeneAkte,
                offeneAnmeldung: anmeldungOffen,
                daten: {
                  geburtsdatum: alsTagText(person.geburtsdatum),
                  gemeinde: person.gemeinde ?? "",
                  teilnahmeform: zaehlendeTeilnahme?.teilnahmeform ?? person.teilnahmeform ?? "",
                },
                offeneSemester,
                laufendesSemester: zaehlendeTeilnahme && aktuellesSemester ? aktuellesSemester.bezeichnung : null,
                art9Eingewilligt: art9EinwilligungenWirksam(
                  art9.map((e) => ({ erteilt: e.erteilt, zeitpunkt: e.zeitpunkt, code: e.text.code })),
                ),
              }
            : null
        }
      />

      <Inhalt className="max-w-6xl">
        <AkteKopf
          vorname={person.vorname}
          nachname={person.nachname}
          status={{ code: person.status.code, bezeichnung: person.status.bezeichnung }}
          teilnahmeform={teilnahmeformName(anzeigeForm)}
          // Ein Zeitpunkt, kein Kalendertag: in Europe/Berlin formatieren (`deutscherTag`
          // rechnet in UTC und zeigte nachts angelegte Personen mit dem Vortag).
          seit={datum(person.erstelltAm)}
          email={person.email}
        />

        {(istAnonym || (person.status.istTerminal && darfAendern) || (offeneAnmeldung && darfAnmeldungen)) && (
          <div className="mt-5 space-y-2">
            {istAnonym ? (
              <Hinweis>Diese Person ist anonymisiert (Art. 17 DSGVO). Die personenbezogenen Daten sind gelöscht.</Hinweis>
            ) : (
              person.status.istTerminal &&
              darfAendern && (
                <Hinweis>
                  Status „{person.status.bezeichnung}“ — für dieses Konto wird kein Anmeldelink verschickt.
                </Hinweis>
              )
            )}
            {offeneAnmeldung && darfAnmeldungen && (
              <Hinweis
                icon="anmeldungen"
                aktion={
                  <Link href={`/verwaltung/anmeldungen/${offeneAnmeldung.id}`} className={knopf("sekundaer", "klein")}>
                    Anmeldung öffnen
                  </Link>
                }
              >
                {offeneAnmeldung.eingereichtAm
                  ? `Die Anmeldung vom ${datum(offeneAnmeldung.eingereichtAm)} ist noch nicht entschieden.`
                  : "Eine eingereichte Anmeldung ist noch nicht entschieden."}
              </Hinweis>
            )}
          </div>
        )}

        <div className="mt-7 grid gap-x-7 gap-y-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <Abschnitt titel={aktuellesSemester?.bezeichnung ?? "Semester"} />
            {!aktuellesSemester ? (
              <GruppenText>Es ist kein Semester als laufend gesetzt.</GruppenText>
            ) : !aktuelleTeilnahme ? (
              <GruppenText>In diesem Semester nicht eingeschrieben.</GruppenText>
            ) : aktuelleTeilnahme.abgemeldetAm ? (
              // Eine abgemeldete Teilnahme (Semesterüberleitung) zählt nicht — sie
              // erscheint deshalb nicht als laufend, sondern mit ihrem Grund.
              <GruppenText>Für dieses Semester {abgemeldetText(aktuelleTeilnahme.abmeldeGrund)}.</GruppenText>
            ) : aktuelleGruppe ? (
              <AnwesenheitListe quote={aktuelleGruppe.quote} einheiten={einheitenVon(aktuelleGruppe)} />
            ) : (
              <GruppenText>Noch keine Unterrichtseinheit vorbei.</GruppenText>
            )}

            {/* Noten — nur mit NOTEN_VERWALTEN (Schulleitung) */}
            {zeigeNoten && (
              <>
                <Abschnitt
                  titel="Noten"
                  aktion={
                    personNoten ? (
                      <NotenInline
                        semesterId={personNoten.semesterId}
                        teilnahmeId={personNoten.teilnahmeId}
                        kurseinheiten={personNoten.kurseinheiten}
                        titel={`Noten · ${personNoten.semesterBezeichnung}`}
                      />
                    ) : undefined
                  }
                />
                {personNoten ? (
                  personNoten.kurseinheiten.length > 0 ? (
                    <NotenZeilen
                      zeilen={personNoten.kurseinheiten.map((k) => ({
                        schluessel: k.kurseinheitId,
                        fach: k.fach,
                        titel: k.titel,
                        wert: k.wert,
                      }))}
                    />
                  ) : (
                    <GruppenText>Für das laufende Semester sind noch keine Fächer (Kurseinheiten) hinterlegt.</GruppenText>
                  )
                ) : (
                  <GruppenText>
                    {person.status.istTerminal
                      ? `Status „${person.status.bezeichnung}“ — für diese Person werden keine Noten mehr erfasst.`
                      : !aktuellesSemester
                        ? "Es ist kein Semester als laufend gesetzt."
                        : aktuelleTeilnahme?.abgemeldetAm
                          ? `Diese Person ist für das laufende Semester ${abgemeldetText(aktuelleTeilnahme.abmeldeGrund)} — ` +
                            "eine abgemeldete Teilnahme wird nicht benotet."
                          : aktuelleTeilnahme?.teilnahmeform === "HOERER"
                            ? "Diese Person nimmt im laufenden Semester als Hörer teil — Hörer werden nicht benotet."
                            : "Diese Person ist im laufenden Semester nicht eingeschrieben — hier gibt es nichts zu benoten."}
                  </GruppenText>
                )}
              </>
            )}

            {/* Frühere Semester: Anwesenheit (eingeklappt) und Noten, nur zum Nachlesen. */}
            {fruehereGruppen.map((g) => (
              <Fragment key={g.teilnahmeId}>
                <Abschnitt titel={g.semesterBezeichnung} />
                <AnwesenheitListe quote={g.quote} einheiten={einheitenVon(g)} eingeklappt />
              </Fragment>
            ))}
            {darfNoten &&
              verlaufGruppen.map((g) => (
                <Fragment key={g.semesterBezeichnung}>
                  <Abschnitt titel={`Noten · ${g.semesterBezeichnung}`} />
                  <NotenZeilen
                    zeilen={g.leistungen.map((l) => ({
                      schluessel: `${l.fach}·${l.titel}`,
                      fach: l.fach,
                      titel: l.titel,
                      wert: { ergebnis: l.ergebnis, punkte: l.punkte, note: l.note },
                    }))}
                  />
                </Fragment>
              ))}
          </div>

          <aside className="min-w-0" aria-label="Angaben zur Person">
            <Abschnitt titel="Kontakt" />
            <Gruppe>
              {person.telefon && <Angabe label="Telefon">{person.telefon}</Angabe>}
              {adresse && <Angabe label="Adresse">{adresse}</Angabe>}
              {!person.telefon && !adresse && (
                <p className="px-4 py-3.5 text-sm text-muted-foreground">Kein Telefon und keine Adresse hinterlegt.</p>
              )}
            </Gruppe>

            {zeigeAusbildungAngaben && (
              <>
                <Abschnitt titel="Ausbildung" />
                <Gruppe>
                  <Angabe label="Geburtsdatum" leise={!person.geburtsdatum}>
                    {person.geburtsdatum
                      ? `${deutscherTag(person.geburtsdatum)}${alter !== null ? ` · ${alter} Jahre` : ""}`
                      : "nicht hinterlegt"}
                  </Angabe>
                  <Angabe label="Gemeinde" leise={!person.gemeinde}>
                    {person.gemeinde || "nicht hinterlegt"}
                  </Angabe>
                  <Angabe label="Bankverbindung" leise={!person.ibanVerschluesselt}>
                    {person.ibanVerschluesselt ? "hinterlegt" : "nicht hinterlegt"}
                  </Angabe>
                  {person.ermaessigung && <Angabe label="Ermäßigung">{person.ermaessigung.bezeichnung}</Angabe>}
                </Gruppe>
              </>
            )}

            {/* Zeugnisse — wie Noten nur mit NOTEN_VERWALTEN. Alle Stände (gültig,
                ersetzt, storniert); stornieren lässt sich nur ein gültiges einer nicht
                anonymisierten Person (die Route prüft beides selbst). Die
                Storno-Komponente steht in jeder Zeile (stabiler key), damit ihre
                Meldung das Neuladen übersteht. */}
            {darfNoten && zeugnisse.length > 0 && (
              <>
                <Abschnitt titel="Zeugnisse & Bescheinigungen" />
                <Gruppe>
                  <ul className="divide-y divide-linie">
                    {zeugnisse.map((z) => (
                      <li key={z.id} className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{z.titel}</p>
                        <p className="text-[13px] text-muted-foreground">{z.abschnitt}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                          <StatusPunkt ton={zeugnisTon(z.status)}>{zeugnisStatusName(z.status)}</StatusPunkt>
                          <span>
                            Beleg-Nr. {z.belegNr} · {datum(z.ausgestelltAm)}
                            {z.status === "STORNIERT" && ` · storniert am ${datum(z.storniertAm)}`}
                          </span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <a
                            href={`/api/zeugnisse/${z.id}/pdf`}
                            aria-label={`${z.titel} (${z.abschnitt}, Beleg-Nr. ${z.belegNr}) als PDF öffnen`}
                            className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary"
                          >
                            {z.status === "GUELTIG" ? "PDF öffnen" : "PDF (ungültig)"}
                          </a>
                          <ZeugnisStorno
                            zeugnisId={z.id}
                            stornierbar={z.status === "GUELTIG" && !istAnonym}
                            rueckfrage={stornoRueckfrage({ typ: z.typ, belegNr: z.belegNr, name })}
                            beschriftung={`${z.titel} (${z.abschnitt}) stornieren (ohne Ersatz)`}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </Gruppe>
              </>
            )}

            {person.statusWechsel.length > 0 && (
              <>
                <Abschnitt titel="Verlauf" />
                <VerlaufListe
                  eintraege={person.statusWechsel.map((s) => ({
                    id: s.id,
                    von: s.vonCode ? s.von?.bezeichnung ?? s.vonCode : null,
                    nach: s.nach.bezeichnung,
                    datum: datum(s.erstelltAm),
                    akteur: s.ausgeloestVon ? `${s.ausgeloestVon.vorname} ${s.ausgeloestVon.nachname}` : null,
                    // „Angelegt als …“ sagt schon, was „Von der Verwaltung angelegt“ sagte.
                    // Freitext-Gründe der Schulleitung („verstorben laut Mitteilung …“)
                    // sehen nur Konten, die den Status auch ändern dürfen; die festen
                    // Systemgründe (SYSTEM_GRUENDE) enthalten nichts Persönliches.
                    grund:
                      s.vonCode === null && s.grund === SYSTEM_GRUND.VON_HAND_ANGELEGT
                        ? null
                        : darfStatus || (s.grund !== null && SYSTEM_GRUENDE.includes(s.grund))
                          ? s.grund
                          : null,
                  }))}
                />
              </>
            )}
          </aside>
        </div>
      </Inhalt>
    </main>
  );
}
