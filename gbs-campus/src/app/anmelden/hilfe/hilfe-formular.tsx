"use client";

import { useEffect, useRef, useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

type Felder = {
  vorname: string;
  nachname: string;
  bisherigeEmail: string;
  erreichbarEmail: string;
  erreichbarTelefon: string;
  nachricht: string;
};

const LEER: Felder = {
  vorname: "",
  nachname: "",
  bisherigeEmail: "",
  erreichbarEmail: "",
  erreichbarTelefon: "",
  nachricht: "",
};

export function HilfeFormular() {
  const [felder, setFelder] = useState<Felder>(LEER);
  const [zustand, setZustand] = useState<"bereit" | "laeuft" | "gesendet">("bereit");
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});
  const erfolgRef = useRef<HTMLParagraphElement>(null);

  // Nach dem Absenden verschwindet das ganze Formular. Ohne diesen Sprung steht
  // der Fokus auf einem Knopf, den es nicht mehr gibt — die Tastatur landet
  // wieder am Seitenanfang und Vorleseprogramme sagen nichts.
  useEffect(() => {
    if (zustand === "gesendet") erfolgRef.current?.focus();
  }, [zustand]);

  function aendere(feld: keyof Felder, wert: string) {
    setFelder((bisher) => ({ ...bisher, [feld]: wert }));
    setMeldung(null);
    setFeldFehler((bisher) => {
      if (!(feld in bisher)) return bisher;
      const neu = { ...bisher };
      delete neu[feld];
      return neu;
    });
  }

  async function absenden(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setZustand("laeuft");
    setMeldung(null);
    setFeldFehler({});

    const antwort = await sendeAnfrage<{ hinweis: string }>("/api/zugang-hilfe", {
      methode: "POST",
      rumpf: {
        vorname: felder.vorname,
        nachname: felder.nachname,
        bisherigeEmail: felder.bisherigeEmail || null,
        erreichbarEmail: felder.erreichbarEmail || null,
        erreichbarTelefon: felder.erreichbarTelefon || null,
        nachricht: felder.nachricht || null,
      },
    });

    if (!antwort.ok) {
      setZustand("bereit");
      setMeldung({ art: "fehler", text: antwort.meldung });
      const zuordnung: Record<string, string> = {};
      for (const detail of antwort.details ?? []) {
        if (detail.feld) zuordnung[detail.feld] = detail.meldung;
      }
      setFeldFehler(zuordnung);
      // Zum ersten beanstandeten Feld springen, statt den Blick suchen zu lassen.
      const erstes = Object.keys(zuordnung)[0];
      if (erstes) document.getElementById(erstes)?.focus();
      return;
    }

    setZustand("gesendet");
    setMeldung({ art: "ok", text: antwort.daten.hinweis });
  }

  if (zustand === "gesendet") {
    return (
      <p
        ref={erfolgRef}
        tabIndex={-1}
        role="status"
        className="mt-8 rounded-lg border border-border bg-credo-gruen/10 px-4 py-4 text-sm"
      >
        {meldung?.text}
      </p>
    );
  }

  return (
    <form onSubmit={absenden} className="mt-8 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Feld
          name="vorname"
          label="Vorname"
          pflicht
          autoComplete="given-name"
          wert={felder.vorname}
          fehler={feldFehler.vorname}
          onAendern={(w) => aendere("vorname", w)}
        />
        <Feld
          name="nachname"
          label="Nachname"
          pflicht
          autoComplete="family-name"
          wert={felder.nachname}
          fehler={feldFehler.nachname}
          onAendern={(w) => aendere("nachname", w)}
        />
      </div>

      <Feld
        name="bisherigeEmail"
        label="Bisher hinterlegte E-Mail-Adresse (falls bekannt)"
        typ="email"
        wert={felder.bisherigeEmail}
        fehler={feldFehler.bisherigeEmail}
        onAendern={(w) => aendere("bisherigeEmail", w)}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Feld
          name="erreichbarEmail"
          label="E-Mail-Adresse, die du erreichst"
          typ="email"
          autoComplete="email"
          wert={felder.erreichbarEmail}
          fehler={feldFehler.erreichbarEmail}
          onAendern={(w) => aendere("erreichbarEmail", w)}
        />
        <Feld
          name="erreichbarTelefon"
          label="oder Telefonnummer"
          typ="tel"
          autoComplete="tel"
          wert={felder.erreichbarTelefon}
          fehler={feldFehler.erreichbarTelefon}
          onAendern={(w) => aendere("erreichbarTelefon", w)}
        />
      </div>

      <div>
        <label htmlFor="nachricht" className="mb-1.5 block text-sm font-medium">
          Möchtest du uns etwas dazu sagen?
        </label>
        <textarea
          id="nachricht"
          rows={3}
          value={felder.nachricht}
          onChange={(e) => aendere("nachricht", e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={zustand !== "bereit"}
        className="min-h-11 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {zustand === "laeuft" ? "Wird gesendet …" : "Meldung abschicken"}
      </button>

      {meldung?.art === "fehler" && (
        <p role="alert" className="rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {meldung.text}
        </p>
      )}
    </form>
  );
}

function Feld({
  name,
  label,
  wert,
  onAendern,
  typ = "text",
  fehler,
  pflicht,
  autoComplete,
}: {
  name: string;
  label: string;
  wert: string;
  onAendern: (wert: string) => void;
  typ?: "text" | "email" | "tel";
  fehler?: string;
  pflicht?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={typ}
        value={wert}
        required={pflicht}
        aria-required={pflicht}
        autoComplete={autoComplete}
        onChange={(e) => onAendern(e.target.value)}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={fehler ? `${name}-fehler` : undefined}
        className="min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
      />
      {fehler && (
        <p id={`${name}-fehler`} className="mt-1 text-xs text-credo-rot">
          {fehler}
        </p>
      )}
    </div>
  );
}
