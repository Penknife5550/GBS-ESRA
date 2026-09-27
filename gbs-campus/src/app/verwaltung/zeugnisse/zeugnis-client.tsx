"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { stornoRueckfrage } from "@/lib/zeugnis";
import { sammellaufMeldung, type SammellaufErgebnis } from "@/lib/zeugnis-sammellauf";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { Hinweis, LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { WertZeile } from "@/components/ui/liste";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { Menue } from "@/components/ui/menue";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { ZeugnisStorno } from "./zeugnis-storno";

type Zeugnis = { id: string; belegNr: string; version: number; ausgestelltAm: string };
/** Ohne gültiges Dokument: das zuletzt stornierte (der Sammellauf überspringt die Person). */
type Storniert = { id: string; belegNr: string; storniertAm: string };
type Zeile = {
  personId: string;
  name: string;
  initialen: string;
  teilnahmeformText: string;
  /** Roher Typ (SEMESTER/ABSCHLUSS/BESCHEINIGUNG) — für die Rückfrage vor dem Storno. */
  typ: string;
  /** Überschrift des Dokuments („Zeugnis“, „Teilnahmebescheinigung“) — für Rückfragen und Vorleser. */
  typLabel: string;
  /** Spalte „Art“: „Semesterzeugnis“, „Abschlusszeugnis“, „Teilnahmebescheinigung“. */
  art: string;
  /** Stand der Noten; null bei Hörern (sie werden nicht benotet). */
  noten: { bewertet: number; faecher: number } | null;
  zeugnis: Zeugnis | null;
  storniert: Storniert | null;
  /** Hörer ohne gültiges Dokument und ohne besuchten Abend: keine Bescheinigung. */
  ohneAnwesenheit: boolean;
};
/** Vom Server ermittelt: Rückfragetext mit konkreten Zahlen, Sperrgrund (oder
 * null), wie viele Dokumente der Lauf neu ausstellen würde und — wenn es nichts
 * auszustellen gibt — warum (`nichtsAuszustellenHinweis`). */
type Sammellauf = { rueckfrage: string; sperre: string | null; auszustellen: number; hinweis: string | null };

/** Der eine Hinweis über der Liste: was als Nächstes sinnvoll ist. */
export type NaechsterSchritt = { titel: string | null; text: string; notenEintragen: boolean };

function notenText(noten: NonNullable<Zeile["noten"]>): string {
  return `${noten.bewertet} von ${noten.faecher} ${noten.faecher === 1 ? "Fach" : "Fächern"}`;
}

function NotenStand({ noten }: { noten: Zeile["noten"] }) {
  if (noten === null) return <span className="text-muted-foreground">keine nötig</span>;
  if (noten.faecher === 0) return <StatusPunkt ton="grau">noch keine Fächer</StatusPunkt>;
  return <StatusPunkt ton={noten.bewertet >= noten.faecher ? "gruen" : "gelb"}>{notenText(noten)}</StatusPunkt>;
}

function DokumentStand({ z }: { z: Zeile }) {
  if (z.zeugnis) {
    return (
      <StatusPunkt ton="gruen">
        {`${z.zeugnis.version > 1 ? "neu ausgestellt" : "ausgestellt"} am ${z.zeugnis.ausgestelltAm}`}
      </StatusPunkt>
    );
  }
  if (z.storniert) {
    return (
      <span className="block">
        <StatusPunkt ton="rot">storniert</StatusPunkt>
        <span className="block text-xs text-muted-foreground">{`Beleg-Nr. ${z.storniert.belegNr} · storniert am ${z.storniert.storniertAm}`}</span>
      </span>
    );
  }
  if (z.ohneAnwesenheit) {
    return (
      <span className="block">
        <span className="block text-foreground">keine Bescheinigung</span>
        <span className="block text-xs text-muted-foreground">kein besuchter Abend in einem Fach erfasst</span>
      </span>
    );
  }
  return <span className="text-muted-foreground">noch nicht ausgestellt</span>;
}

/**
 * Zeugnisse eines Semesters (Oberflächenplan 09/2026): ein Stand je Person statt
 * zwanzig gleicher Knöpfe. Oben ein Hinweis, was als Nächstes dran ist, rechts
 * die eine Sammelaktion „Alle ausstellen …“ (mit der Rückfrage samt Zahlen vom
 * Server). Einzeln — Ausstellen, Neu ausstellen, Stornieren, PDF — geht es über
 * die Zeile im Blatt.
 */
export function ZeugnisClient({
  filter,
  artWahl,
  dms,
  gewaehltId,
  typ,
  schritt,
  zeilen,
  sammellauf,
  sammelDran,
}: {
  /** Semesterwahl und Umschalter „Noten · Zeugnisse“ (serverseitig gezeichnet). */
  filter: ReactNode;
  /** Umschalter Semesterzeugnis · Abschlusszeugnis. */
  artWahl: ReactNode;
  /** Nachversand der Archivkopien an das DMS. */
  dms: ReactNode;
  gewaehltId: string;
  typ: string;
  schritt: NaechsterSchritt | null;
  zeilen: Zeile[];
  sammellauf: Sammellauf;
  /** Letzter Abend vorbei und alle Noten da: Erst dann tritt „Alle ausstellen …“ hervor. */
  sammelDran: boolean;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [einzeln, setEinzeln] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [blattFehler, setBlattFehler] = useState<Meldung | null>(null);

  async function alleAusstellen() {
    // Der Sammellauf erzeugt offizielle, sofort sichtbare Dokumente, die sich nur
    // einzeln wieder zurückziehen lassen — deshalb die Rückfrage mit den Zahlen vom
    // Server.
    if (!window.confirm(sammellauf.rueckfrage)) return;
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<SammellaufErgebnis>("/api/zeugnisse/ausstellen", {
      methode: "POST",
      rumpf: { semesterId: gewaehltId, typ },
    });
    setLaeuft(false);
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    setMeldung(sammellaufMeldung(antwort.daten));
    router.refresh();
  }

  async function ausstellen(zeile: Zeile, neu: boolean) {
    if (
      neu &&
      !window.confirm(
        `Das Zeugnis ${zeile.zeugnis?.belegNr ?? ""} von ${zeile.name} wird durch eine neue Ausfertigung ersetzt. Frühere Ausdrucke werden damit ungültig. Fortfahren?`,
      )
    ) {
      return;
    }
    // Nach einem Storno ist die neue Ausstellung eine bewusste Einzelentscheidung.
    if (
      !neu &&
      zeile.storniert &&
      !window.confirm(
        `Für ${zeile.name} wurde Beleg ${zeile.storniert.belegNr} storniert. Jetzt ein neues Dokument ausstellen? Es ist sofort für die Person sichtbar.`,
      )
    ) {
      return;
    }
    setEinzeln(zeile.personId);
    setBlattFehler(null);
    const antwort = await sendeAnfrage<{ belegNr: string; version: number }>("/api/zeugnisse/ausstellen", {
      methode: "POST",
      rumpf: { semesterId: gewaehltId, typ, personId: zeile.personId },
    });
    setEinzeln(null);
    if (!antwort.ok) return setBlattFehler({ art: "fehler", text: antwort.meldung });
    setMeldung({ art: "ok", text: `Zeugnis ${antwort.daten.belegNr} ausgestellt (Ausfertigung ${antwort.daten.version}).` });
    setGewaehlt(null);
    router.refresh();
  }

  function oeffnen(personId: string) {
    setBlattFehler(null);
    setGewaehlt(personId);
  }

  const hatZeugnisse = zeilen.some((z) => z.zeugnis);
  const seriendruckHref = `/api/zeugnisse/seriendruck?semester=${gewaehltId}&typ=${typ}`;
  // Gesperrt (Abschluss außerhalb des letzten Rastersemesters) oder nichts mehr
  // offen: Der Knopf ist aus, den Grund nennt der Hinweis darüber (auch, wenn nur
  // noch Stornierte oder Hörer ohne besuchten Abend übrig sind — der Text kommt
  // vom Server).
  const sammelAus = sammellauf.sperre !== null || sammellauf.auszustellen === 0;
  const z = zeilen.find((zeile) => zeile.personId === gewaehlt) ?? null;

  return (
    <>
      <Seitenkopf
        titel="Noten & Zeugnisse"
        aktionen={
          <>
            <button
              type="button"
              onClick={alleAusstellen}
              disabled={laeuft || sammelAus}
              aria-describedby={sammelAus && schritt ? "zeugnis-sammel-hinweis" : undefined}
              className={knopf("sekundaer")}
            >
              <span className={sammelDran ? undefined : "text-muted-foreground"}>
                {laeuft ? "Moment …" : "Alle ausstellen …"}
              </span>
            </button>
            {/* Der Seriendruck erscheint erst, wenn es etwas zu drucken gibt — sonst
                führte der Aufruf auf eine rohe JSON-404-Antwort. */}
            {hatZeugnisse && (
              <Menue
                label="Weitere Aktionen"
                punkte={[
                  {
                    text: "Seriendruck (PDF)",
                    icon: "herunterladen",
                    aktion: () => window.location.assign(seriendruckHref),
                  },
                ]}
              />
            )}
          </>
        }
      >
        {filter}
      </Seitenkopf>

      <Inhalt>
        <div className="mb-4">{artWahl}</div>
        {dms}
        {schritt && (
          <div id="zeugnis-sammel-hinweis" className="mb-4">
            <Hinweis
              icon={sammellauf.sperre ? "hinweis" : "uhr"}
              titel={schritt.titel ?? undefined}
              aktion={
                schritt.notenEintragen ? (
                  <Link href={`/verwaltung/noten?semester=${gewaehltId}`} className={knopf("sekundaer")}>
                    Noten eintragen
                  </Link>
                ) : undefined
              }
            >
              {schritt.text}
            </Hinweis>
          </div>
        )}
        <MeldungsBox meldung={meldung} className="mb-4" />

        {zeilen.length === 0 ? (
          <LeererZustand icon="personen" titel="Keine Teilnehmer">
            Für dieses Semester sind keine aktiven Teilnehmer eingetragen.
          </LeererZustand>
        ) : (
          <>
            <div
              aria-hidden="true"
              className="hidden grid-cols-[32px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_16px] gap-x-4 border-b border-linie px-1 pb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dezent lg:grid"
            >
              <span className="col-span-2">Name</span>
              <span>Art</span>
              <span>Noten</span>
              <span>Dokument</span>
            </div>
            <ul aria-label="Teilnehmer und ihre Dokumente" className="divide-y divide-linie border-b border-linie">
              {zeilen.map((zeile) => (
                <li key={zeile.personId}>
                  <button
                    type="button"
                    onClick={() => oeffnen(zeile.personId)}
                    aria-haspopup="dialog"
                    className="grid w-full grid-cols-[32px_minmax(0,1fr)_16px] items-center gap-x-3 gap-y-0.5 px-1 py-2.5 text-left text-sm hover:bg-muted/50 lg:min-h-[42px] lg:grid-cols-[32px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_16px] lg:gap-x-4 lg:py-1"
                  >
                    <span
                      aria-hidden="true"
                      className="row-span-3 grid h-8 w-8 place-items-center rounded-full bg-feld text-[11px] font-semibold text-muted-foreground lg:row-span-1"
                    >
                      {zeile.initialen}
                    </span>
                    <span className="min-w-0 truncate font-medium text-foreground">{zeile.name}</span>
                    <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 text-[13px] text-muted-foreground lg:contents lg:text-sm">
                      <span className="lg:col-start-3 lg:row-start-1 lg:text-foreground">{zeile.art}</span>
                      <span className="lg:col-start-4 lg:row-start-1">
                        <NotenStand noten={zeile.noten} />
                      </span>
                    </span>
                    <span className="col-start-2 min-w-0 text-[13px] lg:col-start-5 lg:row-start-1 lg:text-sm">
                      <DokumentStand z={zeile} />
                    </span>
                    <Icon
                      name="weiter"
                      className="col-start-3 row-span-3 row-start-1 h-4 w-4 text-dezent lg:col-start-6 lg:row-span-1"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Inhalt>

      <Blatt
        offen={z !== null}
        onSchliessen={() => setGewaehlt(null)}
        titel={z ? z.name : "Zeugnis"}
        fuss={
          z ? (
            z.zeugnis ? (
              <>
                <a
                  href={`/api/zeugnisse/${z.zeugnis.id}/pdf`}
                  aria-label={`${z.typLabel} von ${z.name} als PDF herunterladen`}
                  className={knopf("sekundaer")}
                >
                  <Icon name="herunterladen" className="h-4 w-4" />
                  PDF
                </a>
                <button
                  type="button"
                  onClick={() => ausstellen(z, true)}
                  disabled={einzeln === z.personId}
                  aria-label={`${z.typLabel} von ${z.name} neu ausstellen (das bisherige wird ersetzt)`}
                  className={knopf("sekundaer")}
                >
                  {einzeln === z.personId ? "Moment …" : "Neu ausstellen"}
                </button>
              </>
            ) : (
              <>
                {z.storniert && (
                  <a
                    href={`/api/zeugnisse/${z.storniert.id}/pdf`}
                    aria-label={`Storniertes Dokument von ${z.name} als PDF herunterladen (mit Vermerk)`}
                    className={knopf("sekundaer")}
                  >
                    PDF (storniert)
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => ausstellen(z, false)}
                  disabled={einzeln === z.personId}
                  aria-label={`${z.typLabel} für ${z.name} ausstellen`}
                  className={knopf("primaer")}
                >
                  {einzeln === z.personId ? "Moment …" : "Ausstellen"}
                </button>
              </>
            )
          ) : undefined
        }
      >
        {z && (
          <div key={z.personId} className="flex flex-col gap-4">
            <div className="divide-y divide-linie overflow-hidden rounded-xl border border-linie">
              <WertZeile label="Art">{`${z.art} · ${z.teilnahmeformText}`}</WertZeile>
              <WertZeile label="Noten">
                {z.noten === null ? "keine nötig (Hörer werden nicht benotet)" : <NotenStand noten={z.noten} />}
              </WertZeile>
              <WertZeile label="Dokument">
                {z.zeugnis ? (
                  `Beleg-Nr. ${z.zeugnis.belegNr} · Ausfertigung ${z.zeugnis.version} · ausgestellt am ${z.zeugnis.ausgestelltAm}`
                ) : z.storniert ? (
                  `Beleg-Nr. ${z.storniert.belegNr} · storniert am ${z.storniert.storniertAm} — der Sammellauf stellt hier nichts neu aus`
                ) : (
                  "noch nicht ausgestellt"
                )}
              </WertZeile>
            </div>
            {z.ohneAnwesenheit && (
              <Hinweis>
                Kein besuchter Abend in einem Fach erfasst — ohne Anwesenheit keine Teilnahmebescheinigung.
              </Hinweis>
            )}
            {z.zeugnis && (
              <div className="flex flex-col items-start gap-2">
                <ZeugnisStorno
                  zeugnisId={z.zeugnis.id}
                  stornierbar
                  rueckfrage={stornoRueckfrage({ typ: z.typ, belegNr: z.zeugnis.belegNr, name: z.name })}
                  beschriftung={`${z.typLabel} von ${z.name} stornieren (ohne Ersatz)`}
                  onErledigt={(text) => {
                    setMeldung({ art: "ok", text });
                    setGewaehlt(null);
                  }}
                />
              </div>
            )}
            <MeldungsBox meldung={blattFehler} />
          </div>
        )}
      </Blatt>
    </>
  );
}
