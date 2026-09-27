"use client";

import { startTransition, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { ANWESENHEIT, ANWESENHEIT_OPTIONEN, anwesenheitName, istDozentStatusErlaubt } from "@/lib/stundenplan";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
import { Abschnitt, Gruppe } from "@/components/ui/liste";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { Menue } from "@/components/ui/menue";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { BLATT_GRUND } from "@/app/meine-daten/handy-seite";

/** Ein Abend in der Liste „Alle Abende“ (fertig formatiert vom Server). */
export type ErfassAbend = {
  id: string;
  /** „Di., 22.09.“ */
  tag: string;
  zeit: string;
  bis: string | null;
  fach: string | null;
  kurzThema: string | null;
  istVergangen: boolean;
  erfasst: number;
  gesamt: number;
};

export type ErfassGruppe = {
  /** Semester, z. B. „Herbstsemester 2026“. */
  titel: string;
  /** Aktive, zählende Teilnehmer des Semesters — die Zeilen der Erfassung. */
  teilnehmer: { teilnahmeId: string; name: string }[];
  abende: ErfassAbend[];
  /** terminId → teilnahmeId → gespeicherter Status (nur gehaltene Abende). */
  anwesenheit: Record<string, Record<string, string>>;
  /** terminId → Teilnahmen, deren Eintrag die Person selbst gesetzt hat. */
  selbst: Record<string, string[]>;
};

// Was der Dozent setzen darf: anwesend, gefehlt, nachgearbeitet — „entschuldigt“
// entscheidet die Schule. Da/Fehlt stehen als Umschalter in der Zeile,
// „nachgearbeitet“ im Menü der Zeile. Ein gesetzter Status lässt sich ändern,
// aber nicht wieder leeren (es gibt keinen Weg zurück auf „nicht erfasst“).
const OPTIONEN = ANWESENHEIT_OPTIONEN.filter((o) => istDozentStatusErlaubt(o.wert));
const DA = ANWESENHEIT.ANWESEND;
const FEHLT = ANWESENHEIT.GEFEHLT;
const UMSCHALTER = OPTIONEN.filter((o) => o.wert === DA || o.wert === FEHLT);
const IM_MENUE = OPTIONEN.filter((o) => o.wert !== DA && o.wert !== FEHLT);
const KURZ: Record<string, string> = { [DA]: "Da", [FEHLT]: "Fehlt" };

function grossAnfang(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StundenplanDozent({
  gruppen,
  darfErfassen,
  oben,
}: {
  gruppen: ErfassGruppe[];
  /** Nur mit ANWESENHEIT_ERFASSEN_EIGENE lässt sich ein Abend öffnen; die Liste
   * selbst sieht schon, wer EIGENE_TERMINE_LESEN hat. */
  darfErfassen: boolean;
  /** Die Karten „Offen“ und „Nächster Abend“ (vom Server gezeichnet). */
  oben?: ReactNode;
}) {
  const router = useRouter();
  // Der Abend im Blatt bleibt nach dem Schließen gesetzt: So bleibt das Blatt
  // stehen, und `dialog.close()` gibt den Fokus an den auslösenden Knopf zurück.
  const [blattId, setBlattId] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);
  // Ungespeicherte Eingaben je Abend (terminId → teilnahmeId → Status). Die
  // Anzeige nimmt den gespeicherten Stand und legt sie darüber. Schließen
  // verwirft nichts (ein versehentliches Wischen kostet keine Eingaben); die
  // Liste zeigt dann „nicht gesichert“.
  const [overlay, setOverlay] = useState<Record<string, Record<string, string>>>({});
  // Abende, bei denen „Alle als anwesend markieren“ ausgeschaltet wurde.
  const [ohneVorbelegung, setOhneVorbelegung] = useState<Record<string, boolean>>({});
  const [laeuft, setLaeuft] = useState(false);
  const [blattMeldung, setBlattMeldung] = useState<Meldung | null>(null);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  // Sprung aus der Karte „Offen“ (Anker `#termin-<id>`): das Blatt des Abends
  // öffnen — beim Laden (Link von außen) und bei jedem späteren Klick
  // (hashchange). Ob der Abend erfassbar ist, steht am Element (`data-erfassbar`).
  // Danach kommt der Anker wieder aus der Adresse, sonst änderte ein zweiter Klick
  // auf denselben Link das Fragment nicht und nichts ginge auf.
  useEffect(() => {
    function oeffneAusAnker() {
      const treffer = /^#termin-([\w-]+)$/.exec(window.location.hash);
      if (!treffer) return;
      const abend = document.getElementById(`termin-${treffer[1]}`);
      if (!abend) return;
      if (abend.dataset.erfassbar === "ja") {
        setBlattMeldung(null);
        setBlattId(treffer[1]);
        setOffen(true);
      }
      abend.scrollIntoView({ block: "center" });
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    oeffneAusAnker();
    window.addEventListener("hashchange", oeffneAusAnker);
    return () => window.removeEventListener("hashchange", oeffneAusAnker);
  }, []);

  // Mit JavaScript öffnet ein Klick auf „Jetzt erfassen“ das Blatt direkt, ohne
  // dass der Browser erst zum Abend in der Liste springt: Die Seite bleibt oben,
  // wo nach dem Sichern die Bestätigung steht. Ohne JavaScript bleibt der Sprung.
  useEffect(() => {
    function klick(ereignis: MouseEvent) {
      if (ereignis.defaultPrevented || ereignis.button !== 0 || ereignis.metaKey || ereignis.ctrlKey || ereignis.shiftKey) return;
      const anker = (ereignis.target as Element | null)?.closest('a[href^="#termin-"]');
      const terminId = anker?.getAttribute("href")?.slice("#termin-".length);
      if (!terminId || document.getElementById(`termin-${terminId}`)?.dataset.erfassbar !== "ja") return;
      ereignis.preventDefault();
      setBlattMeldung(null);
      setBlattId(terminId);
      setOffen(true);
    }
    document.addEventListener("click", klick);
    return () => document.removeEventListener("click", klick);
  }, []);

  function ungesichert(gruppe: ErfassGruppe, terminId: string): boolean {
    const gespeichert = gruppe.anwesenheit[terminId] ?? {};
    return Object.entries(overlay[terminId] ?? {}).some(([teilnahmeId, wert]) => wert !== gespeichert[teilnahmeId]);
  }
  const hatUngesichertes = gruppen.some((g) => g.abende.some((a) => ungesichert(g, a.id)));

  // Ungesicherte Eingaben nicht still verwerfen: Neuladen und Schließen des Tabs
  // fragen nach (wie bei der Notenmatrix).
  useEffect(() => {
    if (!hatUngesichertes) return;
    function warnen(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", warnen);
    return () => window.removeEventListener("beforeunload", warnen);
  }, [hatUngesichertes]);

  function oeffne(terminId: string) {
    setBlattMeldung(null);
    setBlattId(terminId);
    setOffen(true);
  }

  function setze(terminId: string, teilnahmeId: string, wert: string) {
    setBlattMeldung(null);
    setOverlay((o) => ({ ...o, [terminId]: { ...o[terminId], [teilnahmeId]: wert } }));
  }

  const aktiv = gruppen.flatMap((g) => g.abende.map((a) => ({ gruppe: g, abend: a }))).find((x) => x.abend.id === blattId);

  async function speichern(gruppe: ErfassGruppe, abend: ErfassAbend) {
    const gespeichert = gruppe.anwesenheit[abend.id] ?? {};
    const eingaben = overlay[abend.id] ?? {};
    const vorbelegen = !ohneVorbelegung[abend.id];
    // Gesendet wird nur, was sich ändert: berührte Zeilen und — solange der
    // Schalter an ist — alle ohne Eintrag als anwesend. Unveränderte Einträge
    // (etwa Selbsteinträge) bleiben samt ihrer Herkunft stehen.
    const eintraege = gruppe.teilnehmer.flatMap((t) => {
      const neu = eingaben[t.teilnahmeId] ?? (!gespeichert[t.teilnahmeId] && vorbelegen ? DA : undefined);
      return neu && neu !== gespeichert[t.teilnahmeId] ? [{ teilnahmeId: t.teilnahmeId, status: neu }] : [];
    });
    if (eintraege.length === 0) {
      setBlattMeldung({ art: "fehler", text: "Es gibt keine Änderung zum Speichern." });
      return;
    }
    setLaeuft(true);
    setBlattMeldung(null);
    const antwort = await sendeAnfrage<{ gesetzt: number }>("/api/dozent/anwesenheit", {
      methode: "POST",
      rumpf: { terminId: abend.id, eintraege },
    });
    setLaeuft(false);
    if (!antwort.ok) {
      setBlattMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    const n = antwort.daten.gesetzt;
    setMeldung({ art: "ok", text: `Anwesenheit vom ${abend.tag} gespeichert (${n} ${n === 1 ? "Eintrag" : "Einträge"}).` });
    setOffen(false);
    // Eingaben leeren und Server-Stand neu laden gemeinsam als Transition: Die
    // Liste hält den alten Stand, bis die frischen Zahlen da sind.
    startTransition(() => {
      setOverlay((o) => {
        const rest = { ...o };
        delete rest[abend.id];
        return rest;
      });
      setOhneVorbelegung((o) => {
        const rest = { ...o };
        delete rest[abend.id];
        return rest;
      });
      router.refresh();
    });
  }

  return (
    <div>
      <MeldungsBox meldung={meldung} className="mb-4" />
      {oben}

      {gruppen.map((gruppe) => (
        <section key={gruppe.titel} className="mt-7">
          <Abschnitt titel={gruppen.length === 1 ? "Alle Abende" : gruppe.titel} />
          <Gruppe>
            {gruppe.abende.map((abend) => {
              const kannErfassen = darfErfassen && abend.istVergangen;
              const inhalt = (
                <>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-foreground lg:text-sm">
                    {abend.tag} · {abend.kurzThema ?? abend.fach ?? "Unterricht"}
                  </span>
                  {!abend.istVergangen ? (
                    <span className="shrink-0 text-[13px] text-muted-foreground">geplant</span>
                  ) : ungesichert(gruppe, abend.id) ? (
                    <StatusPunkt ton="gelb">nicht gesichert</StatusPunkt>
                  ) : abend.gesamt === 0 ? (
                    <StatusPunkt ton="grau">keine Teilnehmer</StatusPunkt>
                  ) : (
                    <StatusPunkt ton={abend.erfasst === abend.gesamt ? "gruen" : "gelb"}>
                      {abend.erfasst} von {abend.gesamt}
                    </StatusPunkt>
                  )}
                </>
              );
              return kannErfassen ? (
                <button
                  key={abend.id}
                  type="button"
                  id={`termin-${abend.id}`}
                  data-erfassbar="ja"
                  onClick={() => oeffne(abend.id)}
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60"
                >
                  <span className="sr-only">Anwesenheit erfassen: </span>
                  {inhalt}
                  <Icon name="weiter" className="h-4 w-4 shrink-0 text-dezent" />
                </button>
              ) : (
                <div key={abend.id} id={`termin-${abend.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                  {inhalt}
                </div>
              );
            })}
          </Gruppe>
        </section>
      ))}

      {aktiv && (
        <ErfassBlatt
          offen={offen}
          gruppe={aktiv.gruppe}
          abend={aktiv.abend}
          eingaben={overlay[aktiv.abend.id] ?? {}}
          vorbelegen={!ohneVorbelegung[aktiv.abend.id]}
          laeuft={laeuft}
          meldung={blattMeldung}
          onSetzen={(teilnahmeId, wert) => setze(aktiv.abend.id, teilnahmeId, wert)}
          onVorbelegen={(an) => setOhneVorbelegung((o) => ({ ...o, [aktiv.abend.id]: !an }))}
          onSichern={() => speichern(aktiv.gruppe, aktiv.abend)}
          onSchliessen={() => setOffen(false)}
        />
      )}
    </div>
  );
}

function ErfassBlatt({
  offen,
  gruppe,
  abend,
  eingaben,
  vorbelegen,
  laeuft,
  meldung,
  onSetzen,
  onVorbelegen,
  onSichern,
  onSchliessen,
}: {
  offen: boolean;
  gruppe: ErfassGruppe;
  abend: ErfassAbend;
  eingaben: Record<string, string>;
  vorbelegen: boolean;
  laeuft: boolean;
  meldung: Meldung | null;
  onSetzen: (teilnahmeId: string, wert: string) => void;
  onVorbelegen: (an: boolean) => void;
  onSichern: () => void;
  onSchliessen: () => void;
}) {
  const gespeichert = gruppe.anwesenheit[abend.id] ?? {};
  const selbst = new Set(gruppe.selbst[abend.id] ?? []);
  const ohneEintrag = gruppe.teilnehmer.filter((t) => !gespeichert[t.teilnahmeId]).length;
  const wirksam = (teilnahmeId: string): string | null =>
    eingaben[teilnahmeId] ?? gespeichert[teilnahmeId] ?? (vorbelegen ? DA : null);

  const zaehle = (wert: string | null) => gruppe.teilnehmer.filter((t) => wirksam(t.teilnahmeId) === wert).length;
  const da = zaehle(DA);
  const fehlen = zaehle(FEHLT);
  const weitere = [
    ...IM_MENUE.map((o) => ({ n: zaehle(o.wert), text: o.label })),
    { n: zaehle(ANWESENHEIT.ENTSCHULDIGT), text: anwesenheitName(ANWESENHEIT.ENTSCHULDIGT) },
    { n: zaehle(null), text: "offen" },
  ].filter((w) => w.n > 0);
  const unterzeile = [abend.kurzThema, abend.bis ? `${abend.zeit} bis ${abend.bis}` : abend.zeit].filter(Boolean).join(" · ");

  return (
    <Blatt
      offen={offen}
      onSchliessen={onSchliessen}
      titel={`${abend.tag} · ${abend.fach ?? "Unterricht"}`}
      fuss={
        <button
          type="button"
          onClick={onSichern}
          disabled={laeuft || gruppe.teilnehmer.length === 0}
          className={`${knopf("primaer")} w-full sm:w-auto`}
        >
          {laeuft ? "Wird gespeichert …" : "Sichern"}
        </button>
      }
    >
      <div className={BLATT_GRUND}>
        <p className="mb-4 text-center text-[13px] text-muted-foreground">{unterzeile}</p>

        {gruppe.teilnehmer.length === 0 ? (
          <p className="text-sm text-muted-foreground">Für dieses Semester sind keine aktiven Teilnehmer eingetragen.</p>
        ) : (
          <>
            {ohneEintrag > 0 && (
              <Gruppe>
                <button
                  type="button"
                  role="switch"
                  aria-checked={vorbelegen}
                  onClick={() => onVorbelegen(!vorbelegen)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-foreground">Alle als anwesend markieren</span>
                    <span className="block text-[13px] text-muted-foreground">Danach nur noch die Fehlenden antippen</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${vorbelegen ? "bg-credo-gruen" : "bg-input"}`}
                  >
                    <span
                      className={`absolute top-0.5 h-[27px] w-[27px] rounded-full bg-background shadow-[0_2px_4px_rgb(0_0_0/0.18)] transition-[left] ${
                        vorbelegen ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>
              </Gruppe>
            )}

            <p className="mb-2 mt-5 px-1 text-[13px] text-muted-foreground">
              {`${gruppe.teilnehmer.length} Teilnehmer · `}
              <span className="font-semibold text-foreground">{`${da} da · ${fehlen} ${fehlen === 1 ? "fehlt" : "fehlen"}`}</span>
              {weitere.map((w) => ` · ${w.n} ${w.text}`).join("")}
            </p>

            <Gruppe>
              {gruppe.teilnehmer.map((t) => {
                const status = wirksam(t.teilnahmeId);
                const vermerk = [
                  selbst.has(t.teilnahmeId) ? "hat sich selbst eingetragen" : null,
                  status && status !== DA && status !== FEHLT ? anwesenheitName(status) : null,
                  status === null ? "noch offen" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={t.teilnahmeId} className="flex min-h-14 items-center gap-2 py-1.5 pl-4 pr-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] text-foreground">{t.name}</p>
                      {vermerk && <p className="text-[13px] leading-snug text-muted-foreground">{vermerk}</p>}
                    </div>
                    <div role="group" aria-label={`Anwesenheit von ${t.name}`} className="flex shrink-0 rounded-[10px] bg-feld p-0.5">
                      {UMSCHALTER.map((o) => {
                        const an = status === o.wert;
                        return (
                          <button
                            key={o.wert}
                            type="button"
                            aria-pressed={an}
                            onClick={() => onSetzen(t.teilnahmeId, o.wert)}
                            className={`h-10 min-w-11 rounded-lg px-2.5 text-sm font-medium ${
                              an
                                ? `bg-background shadow-[0_1px_2px_rgb(0_0_0/0.1)] ${o.wert === FEHLT ? "text-credo-rot" : "text-foreground"}`
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {KURZ[o.wert] ?? grossAnfang(o.label)}
                          </button>
                        );
                      })}
                    </div>
                    <Menue
                      label={`Weitere Möglichkeiten für ${t.name}`}
                      ausloeserKlasse="grid h-11 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                      punkte={IM_MENUE.map((o) => ({
                        text: grossAnfang(o.label),
                        icon: "bestaetigt" as const,
                        aktion: () => onSetzen(t.teilnahmeId, o.wert),
                        deaktiviert: status === o.wert,
                      }))}
                    />
                  </div>
                );
              })}
            </Gruppe>

            <MeldungsBox meldung={meldung} className="mt-3" />
          </>
        )}
      </div>
    </Blatt>
  );
}
