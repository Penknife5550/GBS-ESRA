import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT, STATUS } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { anwesenheitsStand } from "@/lib/heute";
import { giltAlsBestanden } from "@/lib/leistung";
import { terminVergangen } from "@/lib/selbstbestaetigung";
import { teilnahmeformName } from "@/lib/semester";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { Icon } from "@/components/icons";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { Menue } from "@/components/ui/menue";
import { Inhalt } from "@/components/ui/seitenkopf";
import TeilnehmerSeite from "../teilnehmer/page";
import { PersonenKopf, personenAnsicht } from "./personen-kopf";
import { PersonenTabelle, type PersonenZeile } from "./personen-tabelle";

export const metadata = { title: "Personen" };
export const dynamic = "force-dynamic";

/** Mehr Treffer helfen niemandem — dann lieber genauer suchen oder filtern. */
const HOECHSTZAHL = 50;

type Parameter = { ansicht?: string; suche?: string; status?: string; form?: string; semester?: string };

/**
 * Personen (Oberflächenplan 09/2026): ein Bereich mit Umschalter statt zweier
 * fast gleicher Seiten. „Dieses Semester“ (Standard) ist die frühere Seite
 * „Aktive dieses Semester“ — sie liegt weiter unter /verwaltung/teilnehmer und
 * wird hier nur eingesetzt, damit beide Adressen dasselbe zeigen. Diese Datei
 * zeigt „Interessenten“ und „Alle“; in „Alle“ bleiben die bisherigen Filter
 * Status, Teilnahme und Semester als Auswahl, die sofort wirkt.
 */
export default async function PersonenSeite({ searchParams }: { searchParams: Promise<Parameter> }) {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE)) redirect("/anmelden");

  const roh = await searchParams;
  const ansicht = personenAnsicht(roh.ansicht);
  if (ansicht === "semester") return <TeilnehmerSeite searchParams={searchParams} />;

  // Noten sind eine pädagogische Sicht — nur mit NOTEN_VERWALTEN, nicht für
  // Verwaltung oder Administrator (die tragen zwar PERSON_LESEN_ALLE).
  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_VERWALTEN);
  const begriff = roh.suche?.trim() ?? "";
  const alle = ansicht === "alle";
  const statusFilter = alle && roh.status && (Object.values(STATUS) as string[]).includes(roh.status) ? roh.status : "";
  const formFilter = alle && (roh.form === "SCHUELER" || roh.form === "HOERER") ? roh.form : "";

  const [alleSemester, statusListe, schwelle] = await Promise.all([
    prisma.semester.findMany({ select: { id: true, bezeichnung: true, istAktuell: true }, orderBy: { start: "desc" } }),
    prisma.teilnehmerStatus.findMany({ select: { code: true, bezeichnung: true }, orderBy: { sortierung: "asc" } }),
    zahl("ANWESENHEIT_MINDEST_PROZENT"),
  ]);
  const aktuelles = alleSemester.find((s) => s.istAktuell) ?? null;
  // Worauf sich Teilnahme und Anwesenheit beziehen: das laufende Semester, in
  // „Alle“ wählbar (auch „alle Semester“ — dann ohne Semesterspalten).
  const semesterModusAlle = alle && roh.semester === "alle";
  const gewaehltesSemester = semesterModusAlle
    ? null
    : (alle && roh.semester && alleSemester.find((s) => s.id === roh.semester)) || aktuelles;
  const effektivSemesterId = gewaehltesSemester?.id ?? null;

  const bedingungen: Prisma.PersonWhereInput[] = [];
  if (ansicht === "interessenten") bedingungen.push({ statusCode: STATUS.INTERESSENT });
  if (begriff) {
    bedingungen.push({
      OR: [
        { vorname: { contains: begriff, mode: "insensitive" } },
        { nachname: { contains: begriff, mode: "insensitive" } },
        { email: { contains: begriff, mode: "insensitive" } },
      ],
    });
  }
  if (statusFilter) bedingungen.push({ status: { code: statusFilter } });
  if (formFilter) {
    // Nur zählende Teilnahmen: Wer für das Semester abgemeldet ist, ist dort
    // weder Schüler noch Hörer.
    bedingungen.push({
      teilnahmen: {
        some: effektivSemesterId
          ? { semesterId: effektivSemesterId, teilnahmeform: formFilter, ...TEILNAHME_ZAEHLT }
          : { teilnahmeform: formFilter, ...TEILNAHME_ZAEHLT },
      },
    });
  }

  // Die Teilnahme des gewählten Semesters immer mitladen (leer, wenn keine
  // besteht) — ohne gewähltes Semester matcht der leere Scope nichts. Eine für
  // das Semester abgemeldete Teilnahme zählt nicht (wie „nicht eingeschrieben“).
  const semesterScope = effektivSemesterId ?? "";
  const jetzt = new Date();
  const [personen, gesamtTermine, vergangeneTermine] = await Promise.all([
    prisma.person.findMany({
      where: bedingungen.length ? { AND: bedingungen } : undefined,
      select: {
        id: true,
        vorname: true,
        nachname: true,
        ort: true,
        teilnahmeform: true,
        status: { select: { code: true, bezeichnung: true } },
        teilnahmen: {
          where: { semesterId: semesterScope, ...TEILNAHME_ZAEHLT },
          select: {
            teilnahmeform: true,
            anwesenheiten: { select: { status: true, termin: { select: { beginn: true } } } },
            leistungen: { select: { ergebnis: true } },
          },
        },
      },
      orderBy: [{ nachname: "asc" }, { vorname: "asc" }],
      take: HOECHSTZAHL,
    }),
    effektivSemesterId ? prisma.unterrichtstermin.count({ where: { semesterId: effektivSemesterId } }) : Promise.resolve(0),
    effektivSemesterId
      ? prisma.unterrichtstermin.count({ where: { semesterId: effektivSemesterId, beginn: { lte: jetzt } } })
      : Promise.resolve(0),
  ]);

  // Anwesenheit wie in der Akte (Modell A): nur vergangene Einheiten zählen,
  // künftige bleiben offen — `anwesenheitsStand` sagt „im Soll“, „2× entschuldigt“
  // oder „3× gefehlt“ und färbt nach dem verbleibenden Puffer.
  const zeilen: PersonenZeile[] = personen.map((p) => {
    const t = p.teilnahmen[0];
    const stati = t ? t.anwesenheiten.filter((a) => terminVergangen(a.termin.beginn, jetzt)).map((a) => a.status) : [];
    const stand = t ? anwesenheitsStand(stati, vergangeneTermine, gesamtTermine, schwelle) : null;
    return {
      id: p.id,
      vorname: p.vorname,
      nachname: p.nachname,
      // Interessenten haben noch keine Teilnahme — dann die gewünschte Teilnahmeform.
      teilnahme: teilnahmeformName(t?.teilnahmeform ?? (ansicht === "interessenten" ? p.teilnahmeform : null)),
      ort: p.ort,
      anwesenheit: stand ? { text: stand.text, ton: stand.ton } : null,
      status: p.status,
      noten:
        darfNoten && t && t.leistungen.length > 0
          ? { bestanden: t.leistungen.filter((l) => giltAlsBestanden(l.ergebnis)).length, gesamt: t.leistungen.length }
          : null,
    };
  });

  const adresse = (aenderung: Partial<Parameter>) => {
    const p = new URLSearchParams();
    const werte = { ansicht, suche: begriff, status: statusFilter, form: formFilter, semester: roh.semester ?? "", ...aenderung };
    for (const [schluessel, wert] of Object.entries(werte)) if (wert) p.set(schluessel, wert);
    return `/verwaltung/personen?${p.toString()}`;
  };
  const filterKlasse = `${knopf("leise", "klein")} px-2`;
  const gefiltert = Boolean(begriff || statusFilter || formFilter || (alle && roh.semester));

  return (
    <main>
      <PersonenKopf
        ansicht={ansicht}
        suche={begriff}
        semesterId={aktuelles?.id ?? null}
        excelHref={null}
        darfAnlegen={hatRecht(benutzer, RECHT.BENUTZER_VERWALTEN)}
      />
      <Inhalt>
        {(alle || begriff) && (
          <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-[13px] text-muted-foreground">
            {alle && (
              <>
                <Menue
                  label="Status wählen"
                  ausrichtung="links"
                  ausloeserKlasse={filterKlasse}
                  ausloeser={
                    <>
                      Status: {statusListe.find((s) => s.code === statusFilter)?.bezeichnung ?? "alle"}
                      <Icon name="aufklappen" className="h-4 w-4" />
                    </>
                  }
                  punkte={[
                    { text: "Alle", href: adresse({ status: "" }), icon: statusFilter ? undefined : "haken" },
                    ...statusListe.map((s) => ({
                      text: s.bezeichnung,
                      href: adresse({ status: s.code }),
                      icon: s.code === statusFilter ? ("haken" as const) : undefined,
                    })),
                  ]}
                />
                <Menue
                  label="Teilnahme wählen"
                  ausrichtung="links"
                  ausloeserKlasse={filterKlasse}
                  ausloeser={
                    <>
                      Teilnahme: {formFilter ? teilnahmeformName(formFilter) : "alle"}
                      <Icon name="aufklappen" className="h-4 w-4" />
                    </>
                  }
                  punkte={[
                    { text: "Alle", href: adresse({ form: "" }), icon: formFilter ? undefined : "haken" },
                    { text: "Schüler", href: adresse({ form: "SCHUELER" }), icon: formFilter === "SCHUELER" ? "haken" : undefined },
                    { text: "Hörer", href: adresse({ form: "HOERER" }), icon: formFilter === "HOERER" ? "haken" : undefined },
                  ]}
                />
                <Menue
                  label="Semester wählen"
                  ausrichtung="links"
                  ausloeserKlasse={filterKlasse}
                  ausloeser={
                    <>
                      Semester: {semesterModusAlle ? "alle" : (gewaehltesSemester?.bezeichnung ?? "keines")}
                      <Icon name="aufklappen" className="h-4 w-4" />
                    </>
                  }
                  punkte={[
                    ...alleSemester.map((s) => ({
                      text: s.istAktuell ? `${s.bezeichnung} · läuft` : s.bezeichnung,
                      href: adresse({ semester: s.istAktuell ? "" : s.id }),
                      icon: !semesterModusAlle && s.id === effektivSemesterId ? ("haken" as const) : undefined,
                    })),
                    { text: "Alle Semester", href: adresse({ semester: "alle" }), icon: semesterModusAlle ? "haken" : undefined, trenner: true },
                  ]}
                />
              </>
            )}
            {gefiltert && (
              <span className="ml-auto flex items-center gap-3">
                <span>
                  {zeilen.length === HOECHSTZAHL ? `Die ersten ${HOECHSTZAHL} Treffer` : `${zeilen.length} Treffer`}
                  {begriff && <> für „{begriff}“</>}
                </span>
                <Link
                  href={begriff ? adresse({ suche: "" }) : `/verwaltung/personen?ansicht=${ansicht}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {begriff ? "Suche aufheben" : "Filter aufheben"}
                  <LadeHinweis className="ml-1.5" />
                </Link>
              </span>
            )}
          </div>
        )}

        {zeilen.length === 0 ? (
          <LeererZustand icon="personen" titel={gefiltert ? "Niemand gefunden" : ansicht === "interessenten" ? "Keine Interessenten" : "Noch niemand angelegt"}>
            {gefiltert ? "Zu dieser Auswahl gibt es keine Person." : ansicht === "interessenten" ? "Wer sich anmeldet, steht hier bis zur Entscheidung." : null}
          </LeererZustand>
        ) : (
          <>
            <PersonenTabelle
              zeilen={zeilen}
              mitNoten={zeilen.some((z) => z.noten !== null)}
              beschriftung={ansicht === "interessenten" ? "Interessenten" : "Alle Personen"}
            />
            {zeilen.length === HOECHSTZAHL && (
              <p className="mt-3 text-[13px] text-muted-foreground">
                Die ersten {HOECHSTZAHL} Personen — wer fehlt, ist über die Suche zu finden.
              </p>
            )}
          </>
        )}
      </Inhalt>
    </main>
  );
}
