"use client";

import { Fragment, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { ANWESENHEIT_OPTIONEN } from "@/lib/stundenplan";
import type { EinheitStand } from "@/lib/abendplan";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { StatusPunkt } from "@/components/ui/status-punkt";

/** Eine Unterrichtseinheit (ein Termin) — so, wie die Seite sie aufbereitet. */
export type Einheit = {
  id: string;
  /** „Di., 15.09.2026, 19:00“ — für Rückfragen und Meldungen. */
  text: string;
  /** „Di., 15.09.“ — für den Titel des Blatts. */
  kurz: string;
  /** „19:00–20:30“. */
  zeit: string;
  fach: string | null;
  thema: string | null;
  kurseinheitId: string | null;
  dozentId: string | null;
  dozentName: string | null;
  anwesenheitAnzahl: number;
  /** Gesetzt, wenn die Einheit schon in einer Honorar-Abrechnung steht. */
  abrechnung: { id: string; status: string } | null;
  stand: EinheitStand;
};

export type AbendAnzeige = {
  tag: string;
  /** „Di, 15. September“. */
  titel: string;
  nummer: number;
  markierung: "heute" | "naechster" | null;
  /** „Zwei Wochen ohne Unterricht“ vor diesem Abend, sonst null. */
  pause: string | null;
  einheiten: Einheit[];
};

type Teilnehmer = { teilnahmeId: string; name: string };
type Kurseinheit = { id: string; label: string };
type Dozent = { id: string; name: string };

// Die Verwaltung setzt alle vier Zustände; Werte und Klartexte aus stundenplan.ts.
const STATUS_OPTIONEN = [{ wert: "", label: "— nicht erfasst —" }, ...ANWESENHEIT_OPTIONEN];

const feldKlasse = "h-11 w-full rounded-lg border border-input bg-background px-4 text-sm disabled:bg-muted disabled:text-muted-foreground lg:h-10";

/**
 * Hinweis an einer abgerechneten Einheit — dieselbe Grenze wie die Termin-Route
 * (`dozentWechselSperre`, 409): Der Dozent lässt sich nicht mehr wechseln und die
 * Einheit nicht löschen; Fach und Thema bleiben frei (honorar-neutral).
 */
function abrechnungsHinweis(status: string): string {
  return status === "OFFEN"
    ? "Abgerechnet (Abrechnung noch offen): Den Dozenten wechseln oder die Einheit löschen geht erst nach einem Storno der Abrechnung."
    : "In einer freigegebenen Abrechnung: Der Dozent lässt sich nicht mehr wechseln, die Einheit nicht löschen.";
}

/**
 * Der Stundenplan als Liste nach Abenden (Oberflächenplan 09/2026). Gelesen wird
 * er jede Woche, geändert selten: Die Liste zeigt den Stand, Bearbeiten und die
 * Anwesenheit öffnen sich im Blatt. Eine offene Erfassung trägt ihren Knopf
 * „Erfassen“ direkt in der Zeile.
 *
 * Alle Meldungen der Seite stehen oben in einer Box; Fehler beim Speichern
 * bleiben im Blatt, damit die Eingabe stehen bleibt.
 */
export function StundenplanClient({
  semesterId,
  semesterWahl,
  abende,
  teilnehmer,
  kurseinheiten,
  dozenten,
  anwesenheit,
  darfHonorar,
  children,
}: {
  semesterId: string;
  /** Die Semesterwahl im Seitenkopf (Links, serverseitig gezeichnet). */
  semesterWahl: ReactNode;
  abende: AbendAnzeige[];
  teilnehmer: Teilnehmer[];
  kurseinheiten: Kurseinheit[];
  dozenten: Dozent[];
  /** terminId → teilnahmeId → Status. */
  anwesenheit: Record<string, Record<string, string>>;
  /** Ob der Link zur Abrechnung angeboten wird (Recht HONORAR_ABRECHNEN). */
  darfHonorar: boolean;
  /** Unter der Liste, etwa die Anwesenheit je Teilnehmer. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [legtAn, setLegtAn] = useState(false);
  const [bearbeiten, setBearbeiten] = useState<string | null>(null);
  const [erfassen, setErfassen] = useState<Einheit | null>(null);
  const [entwuerfe, setEntwuerfe] = useState<Record<string, string>>({});
  const [speichert, setSpeichert] = useState(false);
  const [erfassMeldung, setErfassMeldung] = useState<Meldung | null>(null);
  const feldPraefix = useId();

  const einheiten = abende.flatMap((a) => a.einheiten);

  function oeffneErfassen(e: Einheit) {
    setBearbeiten(null);
    setErfassMeldung(null);
    setEntwuerfe({ ...(anwesenheit[e.id] ?? {}) });
    setErfassen(e);
  }

  // „Erfassen“ auf der Seite „Heute“ führt zu `#termin-<id>`: Dann öffnet sich
  // gleich die Erfassung dieser Einheit — einmal beim Laden, nicht nach jedem
  // Neuladen der Daten wieder.
  const sprungErledigt = useRef(false);
  useEffect(() => {
    if (sprungErledigt.current) return;
    sprungErledigt.current = true;
    const id = window.location.hash.startsWith("#termin-") ? window.location.hash.slice("#termin-".length) : null;
    const ziel = id ? abende.flatMap((a) => a.einheiten).find((e) => e.id === id) : undefined;
    if (!ziel) return;
    setEntwuerfe({ ...(anwesenheit[ziel.id] ?? {}) });
    setErfassen(ziel);
  }, [abende, anwesenheit]);

  function erledigt(text: string) {
    setMeldung({ art: "ok", text });
    setBearbeiten(null);
    router.refresh();
  }

  async function abendeAnlegen() {
    setLegtAn(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ angelegt: number; uebersprungen: number }>(
      "/api/stundenplan/termine/generieren",
      { methode: "POST", rumpf: { semesterId } },
    );
    setLegtAn(false);
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    setMeldung({
      art: "ok",
      text:
        antwort.daten.angelegt === 0
          ? "Die Abende sind bereits angelegt."
          : `${antwort.daten.angelegt} Unterrichtsabende angelegt.`,
    });
    router.refresh();
  }

  async function anwesenheitSpeichern() {
    if (!erfassen) return;
    const eintraege = Object.entries(entwuerfe)
      .filter(([, status]) => status)
      .map(([teilnahmeId, status]) => ({ teilnahmeId, status }));
    if (eintraege.length === 0) {
      setErfassen(null);
      return;
    }
    setSpeichert(true);
    setErfassMeldung(null);
    const antwort = await sendeAnfrage<{ gesetzt: number }>("/api/stundenplan/anwesenheit", {
      methode: "POST",
      rumpf: { terminId: erfassen.id, eintraege },
    });
    setSpeichert(false);
    if (!antwort.ok) return setErfassMeldung({ art: "fehler", text: antwort.meldung });
    setMeldung({ art: "ok", text: `Anwesenheit gespeichert (${antwort.daten.gesetzt}).` });
    setErfassen(null);
    router.refresh();
  }

  const erfasstImEntwurf = teilnehmer.filter((p) => entwuerfe[p.teilnahmeId]).length;

  return (
    <>
      <Seitenkopf
        titel="Unterricht"
        aktionen={
          <button type="button" onClick={abendeAnlegen} disabled={legtAn} className={knopf("sekundaer")}>
            <Icon name="kalender-plus" className="h-4 w-4" />
            {legtAn ? "Moment …" : "Abende anlegen"}
          </button>
        }
      >
        {semesterWahl}
      </Seitenkopf>

      <Inhalt className="lg:pt-3">
        <MeldungsBox meldung={meldung} className="mb-4" />

        {abende.length === 0 ? (
          <LeererZustand icon="kalender" titel="Noch keine Abende angelegt">
            „Abende anlegen“ oben rechts legt die zehn Dienstagabende ab Semesterbeginn an.
          </LeererZustand>
        ) : (
          <div>
            {abende.map((abend) => (
              <Fragment key={abend.tag}>
                {abend.pause && (
                  <p className="border-b border-linie py-2.5 text-[13px] text-muted-foreground lg:pl-[158px]">
                    {abend.pause}
                  </p>
                )}
                <section
                  aria-labelledby={`abend-${abend.tag}`}
                  className={`grid gap-x-2 gap-y-1 border-b border-linie py-3 lg:grid-cols-[150px_minmax(0,1fr)] ${
                    abend.markierung
                      ? "-mx-4 bg-credo-blau/5 px-4 shadow-[inset_3px_0_0_var(--color-credo-blau)] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
                      : ""
                  }`}
                >
                  <div className="flex items-baseline gap-3 lg:block lg:pt-2.5">
                    <h2 id={`abend-${abend.tag}`} className="text-sm font-semibold text-foreground">
                      {abend.titel}
                    </h2>
                    {abend.markierung ? (
                      <StatusPunkt ton="blau" className="font-medium">
                        {abend.markierung === "heute" ? "Heute" : "Nächster Abend"}
                      </StatusPunkt>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">{`Abend ${abend.nummer}`}</p>
                    )}
                  </div>
                  <ul className="divide-y divide-dashed divide-linie">
                    {abend.einheiten.map((e) => (
                      <EinheitZeile
                        key={e.id}
                        e={e}
                        onOeffnen={() => setBearbeiten(e.id)}
                        onErfassen={() => oeffneErfassen(e)}
                      />
                    ))}
                  </ul>
                </section>
              </Fragment>
            ))}
          </div>
        )}

        {children}
      </Inhalt>

      {/* Ein Blatt je Einheit: Es steht (geschlossen) mit im Dokument, damit
          auch der Weg zur Abrechnung einer abgerechneten Einheit auf der Seite
          liegt. */}
      {einheiten.map((e) => (
        <EinheitBlatt
          key={e.id}
          e={e}
          offen={bearbeiten === e.id}
          onSchliessen={() => setBearbeiten((jetzt) => (jetzt === e.id ? null : jetzt))}
          onErfassen={() => oeffneErfassen(e)}
          onErledigt={erledigt}
          kurseinheiten={kurseinheiten}
          dozenten={dozenten}
          darfHonorar={darfHonorar}
        />
      ))}

      <Blatt
        offen={erfassen !== null}
        onSchliessen={() => setErfassen(null)}
        titel={erfassen ? `${erfassen.kurz} · ${erfassen.fach ?? "Einheit"}` : "Anwesenheit"}
        fuss={
          erfassen && teilnehmer.length > 0 ? (
            <>
              <button type="button" onClick={() => setErfassen(null)} className={knopf("sekundaer")}>
                Abbrechen
              </button>
              <button type="button" onClick={anwesenheitSpeichern} disabled={speichert} className={knopf("primaer")}>
                {speichert ? "Wird gespeichert …" : "Anwesenheit speichern"}
              </button>
            </>
          ) : undefined
        }
      >
        {erfassen &&
          (teilnehmer.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine aktiven Teilnehmer in diesem Semester.</p>
          ) : (
            <>
              <p className="mb-3 text-[13px] text-muted-foreground">
                {[erfassen.zeit, erfassen.thema, `${teilnehmer.length} Teilnehmer · ${erfasstImEntwurf} erfasst`]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <ul className="divide-y divide-linie overflow-hidden rounded-xl border border-linie">
                {teilnehmer.map((p) => {
                  const feldId = `${feldPraefix}-${p.teilnahmeId}`;
                  return (
                    <li key={p.teilnahmeId} className="flex items-center gap-3 px-4 py-2">
                      <label htmlFor={feldId} className="min-w-0 flex-1 truncate text-sm">
                        {p.name}
                      </label>
                      <select
                        id={feldId}
                        value={entwuerfe[p.teilnahmeId] ?? ""}
                        onChange={(ereignis) =>
                          setEntwuerfe((vorher) => ({ ...vorher, [p.teilnahmeId]: ereignis.target.value }))
                        }
                        className="h-11 w-40 shrink-0 rounded-lg border border-input bg-background px-3 text-sm lg:h-9"
                      >
                        {STATUS_OPTIONEN.map((o) => (
                          <option key={o.wert} value={o.wert}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
              <MeldungsBox meldung={erfassMeldung} className="mt-3" />
            </>
          ))}
      </Blatt>
    </>
  );
}

/**
 * Eine Zeile: Uhrzeit, Fach · Thema, Dozent, Stand. Die ganze Zeile öffnet das
 * Blatt (der Knopf am Fach dehnt sich über die Zeile); „Erfassen“ liegt darüber
 * und bleibt ein eigener Knopf — keine verschachtelten Bedienelemente.
 */
function EinheitZeile({ e, onOeffnen, onErfassen }: { e: Einheit; onOeffnen: () => void; onErfassen: () => void }) {
  const titel = `${e.fach ?? "Ohne Fach"}${e.thema ? ` · ${e.thema}` : ""}`;
  return (
    <li
      id={`termin-${e.id}`}
      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5 hover:bg-muted/50 lg:min-h-12 lg:grid-cols-[96px_minmax(0,1fr)_150px_160px_74px] lg:py-2"
    >
      <span className="col-start-1 row-start-1 text-[13px] tabular-nums text-muted-foreground lg:text-sm">{e.zeit}</span>
      <div className="col-span-3 col-start-1 row-start-2 min-w-0 lg:col-span-1 lg:col-start-2 lg:row-start-1">
        <button
          type="button"
          onClick={onOeffnen}
          aria-haspopup="dialog"
          aria-label={`${titel}, ${e.text}`}
          className="text-left text-sm leading-snug outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary"
        >
          {e.fach ? (
            <span className="font-semibold text-foreground">{e.fach}</span>
          ) : (
            <span className="text-muted-foreground">Ohne Fach</span>
          )}
          {e.thema && <span className="text-muted-foreground">{` · ${e.thema}`}</span>}
        </button>
      </div>
      <div className="col-span-3 col-start-1 row-start-3 text-[13px] text-muted-foreground lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:text-sm">
        {e.dozentName ?? "ohne Dozent"}
        {e.abrechnung && <span className="block text-xs">abgerechnet</span>}
      </div>
      <div className="col-start-2 row-start-1 justify-self-end lg:col-start-4 lg:justify-self-start">
        <StatusPunkt ton={e.stand.ton}>{e.stand.text}</StatusPunkt>
      </div>
      <div className="col-start-3 row-start-1 flex justify-end lg:col-start-5">
        {e.stand.offen ? (
          <button
            type="button"
            onClick={onErfassen}
            aria-label={`Anwesenheit ${e.text} erfassen`}
            className={`relative z-10 ${knopf("sekundaer", "klein")}`}
          >
            Erfassen
          </button>
        ) : (
          <Icon name="weiter" className="h-4 w-4 text-dezent" />
        )}
      </div>
    </li>
  );
}

/** Bearbeiten einer Einheit: Fach, Dozent, Thema — und der Weg zur Anwesenheit und zum Löschen. */
function EinheitBlatt({
  e,
  offen,
  onSchliessen,
  onErfassen,
  onErledigt,
  kurseinheiten,
  dozenten,
  darfHonorar,
}: {
  e: Einheit;
  offen: boolean;
  onSchliessen: () => void;
  onErfassen: () => void;
  onErledigt: (text: string) => void;
  kurseinheiten: Kurseinheit[];
  dozenten: Dozent[];
  darfHonorar: boolean;
}) {
  const [fach, setFach] = useState(e.kurseinheitId ?? "");
  const [dozent, setDozent] = useState(e.dozentId ?? "");
  const [thema, setThema] = useState(e.thema ?? "");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const id = useId();

  // Beim Öffnen gilt der gespeicherte Stand — ein abgebrochener Entwurf bleibt nicht stehen.
  useEffect(() => {
    if (!offen) return;
    setFach(e.kurseinheitId ?? "");
    setDozent(e.dozentId ?? "");
    setThema(e.thema ?? "");
    setMeldung(null);
  }, [offen, e.kurseinheitId, e.dozentId, e.thema]);

  const geaendert = fach !== (e.kurseinheitId ?? "") || dozent !== (e.dozentId ?? "") || thema.trim() !== (e.thema ?? "");

  async function speichern(ereignis: FormEvent) {
    ereignis.preventDefault();
    if (!geaendert) return onSchliessen();
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage(`/api/stundenplan/termine/${e.id}`, {
      methode: "PUT",
      rumpf: { kurseinheitId: fach || null, dozentId: dozent || null, thema: thema.trim() || null },
    });
    setLaeuft(false);
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    onErledigt(`Die Einheit am ${e.text} ist gespeichert.`);
  }

  async function loeschen() {
    // Die Rückfrage nennt die Einheit und was mit ihr verloren geht.
    const anwesenheiten =
      e.anwesenheitAnzahl === 0
        ? "Für diese Einheit ist noch keine Anwesenheit erfasst."
        : `Dabei ${e.anwesenheitAnzahl === 1 ? "wird 1 erfasste Anwesenheit" : `werden ${e.anwesenheitAnzahl} erfasste Anwesenheiten`} mit gelöscht.`;
    if (!window.confirm(`Die Einheit am ${e.text} löschen?\n\n${anwesenheiten} Das lässt sich nicht rückgängig machen.`)) {
      return;
    }
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage(`/api/stundenplan/termine/${e.id}`, { methode: "DELETE" });
    setLaeuft(false);
    if (!antwort.ok) return setMeldung({ art: "fehler", text: antwort.meldung });
    onErledigt(`Die Einheit am ${e.text} ist gelöscht.`);
  }

  return (
    <Blatt
      offen={offen}
      onSchliessen={onSchliessen}
      titel={`${e.kurz} · ${e.zeit}`}
      fuss={
        <>
          {/* Schließen geht über das X, Escape oder daneben — so passen Löschen und
              Speichern am Handy in eine Reihe. */}
          {!e.abrechnung && (
            <button type="button" onClick={loeschen} disabled={laeuft} className={`mr-auto ${knopf("gefahr")}`}>
              Einheit löschen
            </button>
          )}
          <button type="submit" form={`${id}-form`} disabled={laeuft} className={knopf("primaer")}>
            {laeuft ? "Moment …" : "Speichern"}
          </button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={speichern} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-muted-foreground">Anwesenheit</p>
            <StatusPunkt ton={e.stand.ton}>{e.stand.text}</StatusPunkt>
          </div>
          <button type="button" onClick={onErfassen} className={knopf("sekundaer", "klein")}>
            Anwesenheit erfassen
          </button>
        </div>

        <div>
          <label htmlFor={`${id}-fach`} className="block text-sm font-medium">
            Fach
          </label>
          <select id={`${id}-fach`} value={fach} onChange={(ereignis) => setFach(ereignis.target.value)} className={`mt-1.5 ${feldKlasse}`}>
            <option value="">— kein Fach —</option>
            {kurseinheiten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-dozent`} className="block text-sm font-medium">
            Dozent
          </label>
          <select
            id={`${id}-dozent`}
            value={dozent}
            onChange={(ereignis) => setDozent(ereignis.target.value)}
            disabled={e.abrechnung !== null}
            aria-describedby={e.abrechnung ? `${id}-abrechnung` : undefined}
            className={`mt-1.5 ${feldKlasse}`}
          >
            <option value="">— kein Dozent —</option>
            {dozenten.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {e.abrechnung && (
            <p id={`${id}-abrechnung`} className="mt-1.5 text-xs text-muted-foreground">
              {abrechnungsHinweis(e.abrechnung.status)}
              {darfHonorar && (
                <>
                  {" "}
                  <Link
                    href={`/verwaltung/honorar/abrechnungen/${e.abrechnung.id}`}
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    Zur Abrechnung
                  </Link>
                </>
              )}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${id}-thema`} className="block text-sm font-medium">
            Thema
          </label>
          <input
            id={`${id}-thema`}
            type="text"
            value={thema}
            maxLength={200}
            onChange={(ereignis) => setThema(ereignis.target.value)}
            className={`mt-1.5 ${feldKlasse}`}
          />
        </div>

        <MeldungsBox meldung={meldung} />
      </form>
    </Blatt>
  );
}
