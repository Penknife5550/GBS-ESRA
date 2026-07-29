"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Termin = {
  id: string;
  text: string;
  kurseinheitId: string | null;
  kurseinheitTitel: string | null;
  dozentId: string | null;
  anwesenheitAnzahl: number;
};
type Teilnehmer = { teilnahmeId: string; name: string };
type Kurseinheit = { id: string; label: string };
type Dozent = { id: string; name: string };

const STATUS_OPTIONEN = [
  { wert: "", label: "— nicht erfasst —" },
  { wert: "ANWESEND", label: "anwesend" },
  { wert: "ENTSCHULDIGT", label: "entschuldigt" },
  { wert: "GEFEHLT", label: "gefehlt" },
  { wert: "NACHGEARBEITET", label: "nachgearbeitet" },
];

const selectKlasse =
  "min-h-10 rounded-lg border border-input bg-background px-3 py-1.5 text-sm";
const knopfKlasse =
  "min-h-10 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60";

export function StundenplanClient({
  semesters,
  gewaehltId,
  termine,
  teilnehmer,
  kurseinheiten,
  dozenten,
  anwesenheit,
}: {
  semesters: { id: string; bezeichnung: string }[];
  gewaehltId: string;
  termine: Termin[];
  teilnehmer: Teilnehmer[];
  kurseinheiten: Kurseinheit[];
  dozenten: Dozent[];
  anwesenheit: Record<string, Record<string, string>>;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [entwuerfe, setEntwuerfe] = useState<Record<string, string>>({});
  // Vorgemerkte Fach-/Dozentenwahl je Abend. Gespeichert wird erst per Knopf —
  // ein <select>, das schon bei onChange schreibt, löst bei Tastaturbedienung für
  // jeden durchgetippten Eintrag einen Speichervorgang aus (WCAG 3.2.2).
  const [fachEntwurf, setFachEntwurf] = useState<Record<string, string>>({});
  const [dozentEntwurf, setDozentEntwurf] = useState<Record<string, string>>({});

  function melde(art: "ok" | "fehler", text: string) {
    setMeldung({ art, text });
  }

  async function anlegen() {
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ angelegt: number; uebersprungen: number }>(
      "/api/stundenplan/termine/generieren",
      { methode: "POST", rumpf: { semesterId: gewaehltId } },
    );
    setLaeuft(false);
    if (!antwort.ok) return melde("fehler", antwort.meldung);
    melde(
      "ok",
      antwort.daten.angelegt === 0
        ? "Die Abende sind bereits angelegt."
        : `${antwort.daten.angelegt} Unterrichtsabende angelegt.`,
    );
    router.refresh();
  }

  // Aktueller Wert eines Abends: die Vormerkung, sonst der gespeicherte Stand.
  const fachWert = (t: Termin) => fachEntwurf[t.id] ?? t.kurseinheitId ?? "";
  const dozentWert = (t: Termin) => dozentEntwurf[t.id] ?? t.dozentId ?? "";
  const zuordnungGeaendert = (t: Termin) =>
    fachWert(t) !== (t.kurseinheitId ?? "") || dozentWert(t) !== (t.dozentId ?? "");

  async function zuordnungSpeichern(t: Termin) {
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage(`/api/stundenplan/termine/${t.id}`, {
      methode: "PUT",
      rumpf: { kurseinheitId: fachWert(t) || null, dozentId: dozentWert(t) || null },
    });
    setLaeuft(false);
    if (!antwort.ok) return melde("fehler", antwort.meldung);
    melde("ok", "Zuordnung gespeichert.");
    router.refresh();
  }

  async function terminLoeschen(terminId: string) {
    if (!window.confirm("Diesen Termin samt erfasster Anwesenheiten löschen?")) return;
    const antwort = await sendeAnfrage(`/api/stundenplan/termine/${terminId}`, { methode: "DELETE" });
    if (!antwort.ok) return melde("fehler", antwort.meldung);
    if (offen === terminId) setOffen(null);
    router.refresh();
  }

  function oeffneErfassen(terminId: string) {
    if (offen === terminId) {
      setOffen(null);
      return;
    }
    setEntwuerfe({ ...(anwesenheit[terminId] ?? {}) });
    setOffen(terminId);
  }

  async function anwesenheitSpeichern(terminId: string) {
    const eintraege = Object.entries(entwuerfe)
      .filter(([, status]) => status)
      .map(([teilnahmeId, status]) => ({ teilnahmeId, status }));
    if (eintraege.length === 0) {
      setOffen(null);
      return;
    }
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ gesetzt: number }>("/api/stundenplan/anwesenheit", {
      methode: "POST",
      rumpf: { terminId, eintraege },
    });
    setLaeuft(false);
    if (!antwort.ok) return melde("fehler", antwort.meldung);
    melde("ok", `Anwesenheit gespeichert (${antwort.daten.gesetzt}).`);
    setOffen(null);
    router.refresh();
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="semesterwahl" className="block text-sm font-medium">
            Semester
          </label>
          <select
            id="semesterwahl"
            value={gewaehltId}
            onChange={(e) => router.push(`/verwaltung/stundenplan?semester=${e.target.value}`)}
            className={`mt-1.5 w-full ${selectKlasse}`}
          >
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.bezeichnung}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={anlegen} disabled={laeuft} className={knopfKlasse}>
          {laeuft ? "Moment …" : "Dienstagabende anlegen"}
        </button>
      </div>

      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"}`}
        >
          {meldung.text}
        </p>
      )}

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Unterrichtsabende
      </h2>
      {termine.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Noch keine Abende angelegt. „Dienstagabende anlegen" erzeugt die zehn Termine ab Semesterbeginn.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {termine.map((t) => (
            <li key={t.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium">{t.text}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Fach für ${t.text}`}
                    value={fachWert(t)}
                    onChange={(e) => setFachEntwurf((v) => ({ ...v, [t.id]: e.target.value }))}
                    className={selectKlasse}
                  >
                    <option value="">— kein Fach —</option>
                    {kurseinheiten.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Dozent für ${t.text}`}
                    value={dozentWert(t)}
                    onChange={(e) => setDozentEntwurf((v) => ({ ...v, [t.id]: e.target.value }))}
                    className={selectKlasse}
                  >
                    <option value="">— kein Dozent —</option>
                    {dozenten.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {zuordnungGeaendert(t) && (
                    <button type="button" onClick={() => zuordnungSpeichern(t)} disabled={laeuft} className={knopfKlasse}>
                      {laeuft ? "Moment …" : "Speichern"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => oeffneErfassen(t.id)}
                    className="min-h-10 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary"
                  >
                    Anwesenheit ({t.anwesenheitAnzahl})
                  </button>
                  <button
                    type="button"
                    onClick={() => terminLoeschen(t.id)}
                    aria-label="Termin löschen"
                    className="min-h-10 rounded-lg border border-border px-2.5 py-1.5 text-sm text-muted-foreground hover:border-credo-rot hover:text-credo-rot"
                  >
                    ×
                  </button>
                </div>
              </div>

              {offen === t.id && (
                <div className="mt-4 border-t border-border pt-4">
                  {teilnehmer.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Keine aktiven Teilnehmer in diesem Semester.</p>
                  ) : (
                    <>
                      <ul className="space-y-2">
                        {teilnehmer.map((p) => (
                          <li key={p.teilnahmeId} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm">{p.name}</span>
                            <select
                              aria-label={`Anwesenheit ${p.name}`}
                              value={entwuerfe[p.teilnahmeId] ?? ""}
                              onChange={(e) =>
                                setEntwuerfe((v) => ({ ...v, [p.teilnahmeId]: e.target.value }))
                              }
                              className={selectKlasse}
                            >
                              {STATUS_OPTIONEN.map((o) => (
                                <option key={o.wert} value={o.wert}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => anwesenheitSpeichern(t.id)}
                        disabled={laeuft}
                        className={`mt-4 ${knopfKlasse}`}
                      >
                        {laeuft ? "Wird gespeichert …" : "Anwesenheit speichern"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
