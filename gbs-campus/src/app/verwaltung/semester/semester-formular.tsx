"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

export type SemesterEingabefelder = {
  code: string;
  bezeichnung: string;
  start: string;
  ende: string;
  anmeldungVon: string;
  anmeldungBis: string;
};

const LEER: SemesterEingabefelder = {
  code: "",
  bezeichnung: "",
  start: "",
  ende: "",
  anmeldungVon: "",
  anmeldungBis: "",
};

type Eigenschaften = {
  /** Gesetzt beim Bearbeiten, leer beim Anlegen. */
  id?: string;
  vorbelegung?: SemesterEingabefelder;
  /** Nur beim Anlegen angeboten. */
  mitAktuellSchalter?: boolean;
  onAbbrechen?: () => void;
};

/**
 * Ein Formular für beide Fälle — Anlegen und Bearbeiten. Die Felder sind
 * dieselben, und zwei getrennte Formulare wären zwei Stellen, an denen eine
 * neue Angabe vergessen werden kann.
 */
export function SemesterFormular({ id, vorbelegung, mitAktuellSchalter, onAbbrechen }: Eigenschaften) {
  const router = useRouter();
  const [felder, setFelder] = useState<SemesterEingabefelder>(vorbelegung ?? LEER);
  const [alsAktuell, setAlsAktuell] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});

  // Das Anlegeformular steht immer im Dokument, und jedes aufgeklappte
  // Bearbeiten-Formular bringt dieselben Felder mit. Ohne eigenes Präfix trügen
  // sie alle dieselbe id: Ein Klick auf „Semesterbeginn" im Bearbeiten-Formular
  // setzte den Fokus ins Anlegeformular, und Vorleseprogramme lesen den
  // falschen Namen vor.
  const praefix = id ?? "neu";

  function aendere(feld: keyof SemesterEingabefelder, wert: string) {
    setFelder((bisher) => ({ ...bisher, [feld]: wert }));
    setMeldung(null);
    setFeldFehler((bisher) => {
      if (!(feld in bisher)) return bisher;
      const neu = { ...bisher };
      delete neu[feld];
      return neu;
    });
  }

  async function speichern(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setLaeuft(true);
    setMeldung(null);
    setFeldFehler({});

    const rumpf = {
      code: felder.code,
      bezeichnung: felder.bezeichnung,
      start: felder.start,
      ende: felder.ende,
      anmeldungVon: felder.anmeldungVon || null,
      anmeldungBis: felder.anmeldungBis || null,
      ...(id ? {} : { istAktuell: alsAktuell }),
    };

    const antwort = id
      ? await sendeAnfrage(`/api/semester/${id}`, { methode: "PUT", rumpf })
      : await sendeAnfrage("/api/semester", { methode: "POST", rumpf });

    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      const zuordnung: Record<string, string> = {};
      for (const detail of antwort.details ?? []) {
        if (detail.feld) zuordnung[detail.feld] = detail.meldung;
      }
      setFeldFehler(zuordnung);
      // Zum ersten beanstandeten Feld springen — sonst steht die Meldung unten
      // und der Blick bleibt oben im Formular.
      const erstes = Object.keys(zuordnung)[0];
      if (erstes) document.getElementById(`${praefix}-${erstes}`)?.focus();
      return;
    }

    if (!id) setFelder(LEER);
    setAlsAktuell(false);
    // Bewusst ohne automatisches Schließen: Sonst verschwindet die Bestätigung
    // im selben Moment, in dem sie erscheint.
    setMeldung({ art: "ok", text: id ? "Änderungen gespeichert." : "Semester angelegt." });
    router.refresh();
  }

  return (
    <form onSubmit={speichern} className="rounded-lg border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Feld
          praefix={praefix}
          name="code"
          label="Kürzel"
          hinweis="Kurz und eindeutig, z. B. 2026-H"
          wert={felder.code}
          fehler={feldFehler.code}
          onAendern={(wert) => aendere("code", wert)}
        />
        <Feld
          praefix={praefix}
          name="bezeichnung"
          label="Bezeichnung"
          hinweis="So steht es in Listen, z. B. Herbstsemester 2026"
          wert={felder.bezeichnung}
          fehler={feldFehler.bezeichnung}
          onAendern={(wert) => aendere("bezeichnung", wert)}
        />
        <Feld
          praefix={praefix}
          name="start"
          label="Semesterbeginn"
          typ="date"
          wert={felder.start}
          fehler={feldFehler.start}
          onAendern={(wert) => aendere("start", wert)}
        />
        <Feld
          praefix={praefix}
          name="ende"
          label="Semesterende"
          typ="date"
          wert={felder.ende}
          fehler={feldFehler.ende}
          onAendern={(wert) => aendere("ende", wert)}
        />
        <Feld
          praefix={praefix}
          name="anmeldungVon"
          label="Anmeldung ab (freiwillig)"
          typ="date"
          hinweis="Solange das Fenster offen ist, werden neue Anmeldungen diesem Semester zugeordnet."
          wert={felder.anmeldungVon}
          fehler={feldFehler.anmeldungVon}
          onAendern={(wert) => aendere("anmeldungVon", wert)}
        />
        <Feld
          praefix={praefix}
          name="anmeldungBis"
          label="Anmeldeschluss (freiwillig)"
          typ="date"
          wert={felder.anmeldungBis}
          fehler={feldFehler.anmeldungBis}
          onAendern={(wert) => aendere("anmeldungBis", wert)}
        />
      </div>

      {mitAktuellSchalter && (
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={alsAktuell}
            onChange={(e) => setAlsAktuell(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input"
          />
          <span>
            Als laufendes Semester setzen
            <span className="block text-muted-foreground">
              Das bisherige laufende Semester verliert die Markierung. Die Teilnehmerliste zeigt immer das
              laufende Semester.
            </span>
          </span>
        </label>
      )}

      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"
          }`}
        >
          {meldung.text}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={laeuft}
          className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {laeuft ? "Speichert …" : id ? "Änderungen speichern" : "Semester anlegen"}
        </button>
        {onAbbrechen && (
          <button
            type="button"
            onClick={onAbbrechen}
            disabled={laeuft}
            className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

function Feld({
  praefix,
  name,
  label,
  wert,
  onAendern,
  typ = "text",
  hinweis,
  fehler,
}: {
  praefix: string;
  name: string;
  label: string;
  wert: string;
  onAendern: (wert: string) => void;
  typ?: "text" | "date";
  hinweis?: string;
  fehler?: string;
}) {
  const feldId = `${praefix}-${name}`;
  const hinweisId = `${feldId}-hinweis`;

  return (
    <div>
      <label htmlFor={feldId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={feldId}
        name={name}
        type={typ}
        value={wert}
        onChange={(e) => onAendern(e.target.value)}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={hinweis || fehler ? hinweisId : undefined}
        className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
      />
      {(fehler || hinweis) && (
        <p id={hinweisId} className={`mt-1 text-xs ${fehler ? "text-credo-rot" : "text-muted-foreground"}`}>
          {fehler ?? hinweis}
        </p>
      )}
    </div>
  );
}
