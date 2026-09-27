import { redirect } from "next/navigation";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT, type RechtCode } from "@/lib/constants";
import { berlinerTag, datum, tagLang, uhrzeit } from "@/lib/datum";
import { bereichFuer } from "@/lib/navigation";
import { quoteHinweis, type QuoteModellA } from "@/lib/stundenplan";
import { ladeEigeneLeistungen } from "@/lib/leistung-io";
import { ladeEigeneZeugnisse } from "@/lib/zeugnis-io";
import { KalenderBlock, Ring, type AnzeigeTon } from "@/components/ui/anzeige";
import { LeererZustand } from "@/components/ui/hinweis";
import { Gruppe, Symbol, Zeile } from "@/components/ui/liste";
import { kurzThema, tagDatum, wochentag } from "./abend-text";
import { aktuellesSemester, ladeMeineSemester, type MeinAbend, type MeinSemester } from "./daten";
import { FrageKarte, type Frage } from "./frage-karte";
import { HandySeite, KARTE } from "./handy-seite";
import { MeineNotenAbschnitt } from "./meine-noten-abschnitt";
import { MeineZeugnisseAbschnitt } from "./meine-zeugnisse-abschnitt";

export const metadata = { title: "Übersicht" };
export const dynamic = "force-dynamic";

/**
 * Die Übersicht des Teilnehmers (Oberflächenplan 09/2026, Vorlage b2): eine
 * Frage statt zwölf Bildschirme — „Waren Sie am Dienstag da?“ mit zwei Knöpfen,
 * darunter die Anwesenheit als Ring mit einem Satz, der nächste Abend, Noten und
 * Zeugnisse. Alle Abende mit Selbstbestätigung stehen unter „Abende“, Kontakt,
 * Bank, E-Mail und Passwort unter „Ich“.
 *
 * Konten ohne eigene Ausbildung (Verwaltung, Dozenten) haben hier nichts zu
 * sehen — für sie ist „Ich“ die Seite mit den eigenen Daten.
 */
export default async function UebersichtSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) redirect("/anmelden");

  const jetzt = new Date();
  const [semester, notenGruppen, zeugnisse] = await Promise.all([
    ladeMeineSemester(benutzer.id, jetzt),
    ladeEigeneLeistungen(benutzer.id),
    ladeEigeneZeugnisse(benutzer.id),
  ]);

  const bereich = bereichFuer((recht: RechtCode) => hatRecht(benutzer, recht));
  if (bereich !== "teilnehmer" && semester.length === 0 && notenGruppen.length === 0 && zeugnisse.length === 0) {
    redirect("/meine-daten/ich");
  }

  const darfBearbeiten = hatRecht(benutzer, RECHT.PERSON_BEARBEITEN_EIGENE);
  const aktuell = aktuellesSemester(semester);
  const frage = darfBearbeiten ? offeneFrage(semester) : null;
  const naechste = naechsterTag(semester);

  return (
    <HandySeite ueber={aktuell?.bezeichnung} titel={`Hallo ${benutzer.vorname}`}>
      {/* Am Handy untereinander, am Rechner Anwesenheit und nächster Abend nebeneinander. */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <FrageKarte frage={frage} />

        {aktuell?.quote && <AnwesenheitKarte quote={aktuell.quote} />}

        {naechste.length > 0 && <NaechsterAbendKarte einheiten={naechste} />}

        {semester.length === 0 && (
          <div className="lg:col-span-2">
            <LeererZustand icon="kalender" titel="Noch kein Semester">
              Sobald Sie einem Semester zugeordnet sind, sehen Sie hier Ihre Abende und Ihre Anwesenheit.
            </LeererZustand>
          </div>
        )}

        {zeugnisse.length === 0 && aktuell && (
          <Gruppe className="lg:col-span-2">
            <Zeile symbol={<Symbol icon="zeugnis" />} titel={aktuell.teilnahmeform === "HOERER" ? "Teilnahmebescheinigung" : "Zeugnisse"}>
              <p className="text-[13px] text-muted-foreground">
                {aktuell.teilnahmeform === "HOERER"
                  ? `Sie gibt es nach dem ${aktuell.bezeichnung}`
                  : `Das erste gibt es nach dem ${aktuell.bezeichnung}`}
              </p>
            </Zeile>
          </Gruppe>
        )}
      </div>

      {notenGruppen.length > 0 && (
        <div className="mt-7">
          <MeineNotenAbschnitt gruppen={notenGruppen} />
        </div>
      )}

      {zeugnisse.length > 0 && (
        <div className="mt-7">
          <MeineZeugnisseAbschnitt
            zeugnisse={zeugnisse.map((z) => ({
              id: z.id,
              belegNr: z.belegNr,
              titel: z.titel,
              abschnitt: z.abschnitt,
              ausgestelltAm: datum(z.ausgestelltAm),
            }))}
          />
        </div>
      )}
    </HandySeite>
  );
}

/**
 * Der jüngste gehaltene Unterrichtstag, an dem die Person einen Abend noch nicht
 * bestätigt hat und auch die Schule nichts erfasst hat — dort die erste Einheit.
 */
function offeneFrage(semester: MeinSemester[]): Frage | null {
  const offene = semester
    .flatMap((s) => s.abende)
    .filter((a) => a.istVergangen && a.status === null && a.darfBestaetigen)
    .sort((a, b) => a.beginn.getTime() - b.beginn.getTime());
  const juengster = offene.at(-1);
  if (!juengster) return null;
  const tag = berlinerTag(juengster.beginn);
  const abend = offene.find((a) => berlinerTag(a.beginn) === tag) ?? juengster;
  return {
    terminId: abend.id,
    frage: `Waren Sie am ${wochentag(abend.beginn)} da?`,
    zeile: [tagDatum(abend.beginn), uhrzeit(abend.beginn), abend.fach, kurzThema(abend.thema)].filter(Boolean).join(" · "),
  };
}

/** Alle Einheiten des nächsten Unterrichtstags (über alle eigenen Semester). */
function naechsterTag(semester: MeinSemester[]): MeinAbend[] {
  const kommende = semester
    .flatMap((s) => s.abende)
    .filter((a) => !a.istVergangen)
    .sort((a, b) => a.beginn.getTime() - b.beginn.getTime());
  if (kommende.length === 0) return [];
  const tag = berlinerTag(kommende[0].beginn);
  return kommende.filter((a) => berlinerTag(a.beginn) === tag);
}

/**
 * Titel, Satz und Farbe zur eigenen Quote (Modell A). Der Normalfall spricht wie
 * im Gespräch („Sie dürfen noch 4-mal fehlen.“); die Grenzfälle nehmen den
 * geprüften Klartext aus `quoteHinweis` (lib/stundenplan.ts).
 */
function anwesenheitStand(q: QuoteModellA): { titel: string; satz: string; ton: AnzeigeTon } {
  const besucht = `${q.teilgenommen} ${q.teilgenommen === 1 ? "Einheit" : "Einheiten"} besucht, ${q.benoetigt} ${
    q.benoetigt === 1 ? "ist" : "sind"
  } nötig.`;
  if (q.zustand === "ERFUELLT") return { titel: "Anwesenheit erfüllt", satz: `${besucht} ${quoteHinweis(q, "schueler")}`, ton: "gruen" };
  if (q.zustand === "NICHT_ERREICHBAR") {
    return { titel: "Anwesenheit nicht mehr erreichbar", satz: `${besucht} ${quoteHinweis(q, "schueler")}`, ton: "rot" };
  }
  if (q.darfNochFehlen <= 0) return { titel: "Anwesenheit knapp", satz: `${besucht} ${quoteHinweis(q, "schueler")}`, ton: "gelb" };
  return { titel: "Anwesenheit im Soll", satz: `${besucht} Sie dürfen noch ${q.darfNochFehlen}-mal fehlen.`, ton: "gruen" };
}

function AnwesenheitKarte({ quote }: { quote: QuoteModellA }) {
  const stand = anwesenheitStand(quote);
  return (
    <section aria-labelledby="anwesenheit-titel" className={`${KARTE} flex items-center gap-4`}>
      <Ring
        wert={quote.teilgenommen}
        max={quote.gesamt}
        ton={stand.ton}
        label={`Anwesenheit: ${quote.teilgenommen} von ${quote.gesamt} Einheiten besucht`}
      />
      <div className="min-w-0">
        <h2 id="anwesenheit-titel" className="text-base font-semibold text-foreground">
          {stand.titel}
        </h2>
        <p className="text-sm text-muted-foreground">{stand.satz}</p>
      </div>
    </section>
  );
}

function NaechsterAbendKarte({ einheiten }: { einheiten: MeinAbend[] }) {
  return (
    <section aria-labelledby="naechster-titel" className={`${KARTE} flex items-start gap-4`}>
      <KalenderBlock datum={einheiten[0].beginn} className="pt-0.5" />
      <div className="min-w-0">
        <h2 id="naechster-titel" className="text-[13px] font-medium text-muted-foreground">
          Nächster Abend<span className="sr-only">{`: ${tagLang(einheiten[0].beginn)}`}</span>
        </h2>
        {einheiten.map((e) => (
          <p key={e.id} className="mt-0.5 text-[15px] text-foreground">
            <span className="font-semibold">{uhrzeit(e.beginn)}</span>{" "}
            {[e.fach ?? "Unterricht", kurzThema(e.thema)].filter(Boolean).join(" · ")}
          </p>
        ))}
      </div>
    </section>
  );
}
