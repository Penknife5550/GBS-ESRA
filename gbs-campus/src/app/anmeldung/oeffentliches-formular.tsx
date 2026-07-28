"use client";

import { useEffect, useRef, useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

export type OeffentlichesFeld = {
  code: string;
  typ: string;
  label: string;
  hilfetext: string | null;
  platzhalter: string | null;
  pflicht: boolean;
  optionen: string[] | null;
  istArt9: boolean;
  /** Aktenfeld-Zuordnung — steuert nur das Autofill des Browsers. */
  personFeld: string;
};

export type OeffentlicherAbschnitt = {
  titel: string;
  beschreibung: string | null;
  felder: OeffentlichesFeld[];
};

export type EinwilligungsAngebot = {
  code: string;
  titel: string;
  text: string;
  istArt9: boolean;
  pflicht: boolean;
};

type Antworten = Record<string, unknown>;

/** Feldtypen, die als Gruppe mehrerer Bedienelemente dargestellt werden. */
const GRUPPENTYPEN = ["JA_NEIN", "AUSWAHL_EINFACH", "AUSWAHL_MEHRFACH"];

/**
 * Autofill-Zuordnung. Ohne sie müssen auf dem Tablet sieben Felder von Hand
 * getippt werden, obwohl das Betriebssystem sie kennt — ein spürbarer Grund,
 * eine Anmeldung abzubrechen.
 */
const AUTOCOMPLETE: Record<string, string> = {
  VORNAME: "given-name",
  NACHNAME: "family-name",
  EMAIL: "email",
  TELEFON: "tel",
  GEBURTSDATUM: "bday",
  STRASSE: "street-address",
  PLZ: "postal-code",
  ORT: "address-level2",
  KONTOINHABER: "name",
};

export function OeffentlichesFormular({
  versionId,
  einleitung,
  abschnitte,
  einwilligungen,
  startAntworten,
  startToken,
}: {
  versionId: string;
  einleitung: string | null;
  abschnitte: OeffentlicherAbschnitt[];
  einwilligungen: EinwilligungsAngebot[];
  startAntworten: Antworten;
  startToken: string | null;
}) {
  const [antworten, setAntworten] = useState<Antworten>(startAntworten);
  const [erteilt, setErteilt] = useState<Set<string>>(new Set());
  const [token, setToken] = useState<string | null>(startToken);
  // Getrennte Zustände: Sonst wechselt der Absende-Knopf beim Zwischenspeichern
  // auf „Wird gesendet …", und der Nutzer glaubt, er hätte abgeschickt.
  const [sendet, setSendet] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [fertig, setFertig] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [consentFehler, setConsentFehler] = useState(false);

  const erfolgRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef<HTMLDivElement>(null);

  const art9Texte = einwilligungen.filter((e) => e.istArt9);
  // Wichtig: `every` auf einer leeren Liste ergibt `true`. Gibt es gar keinen
  // Art.-9-Text, gilt also nichts als gesperrt — das ist gewollt, aber nur, wenn
  // es auch wirklich keine solchen Fragen gibt.
  const art9Erteilt = art9Texte.length > 0 && art9Texte.every((e) => erteilt.has(e.code));

  useEffect(() => {
    if (fertig) erfolgRef.current?.focus();
  }, [fertig]);

  function setzeAntwort(code: string, wert: unknown) {
    setAntworten((alt) => ({ ...alt, [code]: wert }));
    setFeldFehler((alt) => {
      if (!(code in alt)) return alt;
      const neu = { ...alt };
      delete neu[code];
      return neu;
    });
  }

  async function zwischenspeichern() {
    setSpeichert(true);
    setFehler(null);

    const antwort = await sendeAnfrage<{ fortsetzenToken: string; laeuftAb: string }>("/api/anmeldung", {
      methode: "POST",
      rumpf: { aktion: "speichern", versionId, antworten, fortsetzenToken: token ?? undefined },
    });
    setSpeichert(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }

    setToken(antwort.daten.fortsetzenToken);
    const bis = new Date(antwort.daten.laeuftAb).toLocaleDateString("de-DE");
    setHinweis(
      `Zwischenstand gespeichert. Über den Link in der Adresszeile kommst du bis zum ${bis} hierher zurück — ` +
        "am besten als Lesezeichen ablegen. Angaben zu Glaube und Gemeinde werden erst beim Absenden gespeichert.",
    );

    const url = new URL(window.location.href);
    url.searchParams.set("fortsetzen", antwort.daten.fortsetzenToken);
    window.history.replaceState({}, "", url.toString());
  }

  async function absenden(ereignis: React.FormEvent) {
    ereignis.preventDefault();

    // Pflicht-Einwilligungen vorab prüfen: Der Server lehnt sie ohnehin ab, aber
    // ohne diese Prüfung erschiene nur eine allgemeine rote Box am Seitenende,
    // ohne Markierung und ohne Sprung — der häufigste Abbruchgrund bliebe
    // unerklärt.
    const fehlend = einwilligungen.filter((e) => e.pflicht && !erteilt.has(e.code));
    if (fehlend.length > 0) {
      setConsentFehler(true);
      setFehler(`Bitte stimme noch zu: ${fehlend.map((e) => e.titel).join(", ")}.`);
      consentRef.current?.scrollIntoView({ behavior: bewegungErlaubt() ? "smooth" : "auto", block: "center" });
      consentRef.current?.focus();
      return;
    }

    setSendet(true);
    setFehler(null);
    setConsentFehler(false);
    setFeldFehler({});

    const antwort = await sendeAnfrage<{ eingereicht: boolean }>("/api/anmeldung", {
      methode: "POST",
      rumpf: {
        aktion: "absenden",
        versionId,
        antworten,
        einwilligungen: [...erteilt],
        fortsetzenToken: token ?? undefined,
      },
    });
    setSendet(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      if (antwort.details && antwort.details.length > 0) {
        const zuordnung: Record<string, string> = {};
        for (const d of antwort.details) if (d.feld) zuordnung[d.feld] = d.meldung;
        setFeldFehler(zuordnung);

        const erstesFeld = antwort.details.find((d) => d.feld)?.feld;
        if (erstesFeld) {
          const ziel = document.getElementById(`feld-${erstesFeld}`);
          ziel?.scrollIntoView({ behavior: bewegungErlaubt() ? "smooth" : "auto", block: "center" });
          ziel?.focus();
        }
      }
      return;
    }

    setFertig(true);
  }

  if (fertig) {
    return (
      <div
        ref={erfolgRef}
        role="status"
        tabIndex={-1}
        className="rounded-lg border border-credo-gruen/40 bg-credo-gruen/5 p-8 outline-none"
      >
        <h2 className="text-xl font-semibold">Deine Anmeldung ist angekommen</h2>
        <p className="mt-3 max-w-prose text-sm">
          Wir haben dir eine Bestätigung per E-Mail geschickt. Die Schulleitung sieht sich deine Anmeldung an und
          meldet sich bei dir.
        </p>
      </div>
    );
  }

  const laeuft = sendet || speichert;

  return (
    <form onSubmit={absenden} noValidate>
      {einleitung && <p className="mb-6 max-w-prose text-muted-foreground">{einleitung}</p>}
      <p className="mb-10 text-sm text-muted-foreground">
        Mit <span className="text-credo-rot">*</span> gekennzeichnete Felder sind Pflichtangaben.
      </p>

      {abschnitte.map((abschnitt, i) => {
        const nurArt9 = abschnitt.felder.length > 0 && abschnitt.felder.every((f) => f.istArt9);
        if (nurArt9 && !art9Erteilt) {
          return (
            <section key={i} className="mb-10 rounded-lg border border-dashed border-border p-5">
              <h2 className="text-lg font-semibold text-muted-foreground">{abschnitt.titel}</h2>
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Diese Fragen erscheinen, sobald du der Verarbeitung von Angaben zu Glaube und
                Gemeindezugehörigkeit zugestimmt hast.{" "}
                <a href="#datenschutz" className="underline underline-offset-2">
                  Zur Zustimmung springen
                </a>
              </p>
            </section>
          );
        }

        return (
          <section key={i} className="mb-10" aria-live={nurArt9 ? "polite" : undefined}>
            <h2 className="text-lg font-semibold">{abschnitt.titel}</h2>
            {abschnitt.beschreibung && (
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">{abschnitt.beschreibung}</p>
            )}

            <div className="mt-5 space-y-6">
              {abschnitt.felder.map((feld) => (
                <Feld
                  key={feld.code}
                  feld={feld}
                  wert={antworten[feld.code]}
                  fehler={feldFehler[feld.code]}
                  onAendern={(wert) => setzeAntwort(feld.code, wert)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <section
        id="datenschutz"
        ref={consentRef}
        tabIndex={-1}
        className={`mb-10 rounded-lg border p-5 outline-none ${
          consentFehler ? "border-credo-rot bg-credo-rot/5" : "border-border bg-muted"
        }`}
      >
        <h2 className="text-lg font-semibold">Datenschutz</h2>
        <div className="mt-4 space-y-4">
          {einwilligungen.map((e) => (
            <label key={e.code} className="flex gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                checked={erteilt.has(e.code)}
                onChange={(ereignis) => {
                  setConsentFehler(false);
                  setErteilt((alt) => {
                    const neu = new Set(alt);
                    if (ereignis.target.checked) neu.add(e.code);
                    else neu.delete(e.code);
                    return neu;
                  });
                }}
              />
              <span>
                <span className="font-medium">
                  {e.titel}
                  {e.pflicht && <span className="ml-1 text-credo-rot">*</span>}
                </span>
                <span className="mt-1 block text-muted-foreground">{e.text}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {fehler && (
        <p role="alert" className="mb-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}
        </p>
      )}
      {hinweis && (
        <p role="status" className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          {hinweis}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={laeuft}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {sendet ? "Wird gesendet …" : "Anmeldung abschicken"}
        </button>
        <button
          type="button"
          onClick={zwischenspeichern}
          disabled={laeuft}
          className="rounded-lg border border-input px-5 py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {speichert ? "Wird gespeichert …" : "Später weitermachen"}
        </button>
      </div>
    </form>
  );
}

function bewegungErlaubt(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Ein Feld.
 *
 * Auswahl- und Ja/Nein-Fragen werden als `fieldset` mit `legend` dargestellt.
 * Vorher zeigte ein `label htmlFor` auf eine ID, die es bei diesen Typen gar
 * nicht gab: Vorlesesoftware las nur die Antwortmöglichkeiten vor, nie die
 * Frage — auf dem Pflichtfeld „Wie möchtest du teilnehmen?" also gar nichts
 * Verständliches. Und ein Klick auf die Beschriftung wählte nichts aus.
 */
function Feld({
  feld,
  wert,
  fehler,
  onAendern,
}: {
  feld: OeffentlichesFeld;
  wert: unknown;
  fehler?: string;
  onAendern: (wert: unknown) => void;
}) {
  if (feld.typ === "HINWEIS") {
    return <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">{feld.label}</p>;
  }

  const id = `feld-${feld.code}`;
  const hilfeId = feld.hilfetext ? `${id}-hilfe` : undefined;
  const fehlerId = fehler ? `${id}-fehler` : undefined;
  const beschreibung = [hilfeId, fehlerId].filter(Boolean).join(" ") || undefined;
  const stil = `w-full rounded-lg border bg-background px-4 py-2.5 text-sm ${
    fehler ? "border-credo-rot" : "border-input"
  }`;
  const text = typeof wert === "string" ? wert : typeof wert === "number" ? String(wert) : "";
  const istGruppe = GRUPPENTYPEN.includes(feld.typ);

  const beschriftung = (
    <>
      {feld.label}
      {feld.pflicht && (
        <span className="ml-1 text-credo-rot" aria-label="Pflichtangabe">
          *
        </span>
      )}
    </>
  );

  const hinweise = (
    <>
      {feld.hilfetext && (
        <p id={hilfeId} className="mb-1.5 text-xs text-muted-foreground">
          {feld.hilfetext}
        </p>
      )}
    </>
  );

  const fehlermeldung = fehler ? (
    <p id={fehlerId} role="alert" className="mt-1.5 text-xs text-credo-rot">
      {fehler}
    </p>
  ) : null;

  if (istGruppe) {
    return (
      // tabIndex am fieldset, damit der Sprung zum ersten Fehler auch bei
      // Auswahlfragen ein Ziel findet.
      <fieldset
        id={id}
        tabIndex={-1}
        aria-describedby={beschreibung}
        aria-invalid={Boolean(fehler)}
        className="border-0 p-0 outline-none"
      >
        <legend className="mb-1.5 block text-sm font-medium">{beschriftung}</legend>
        {hinweise}

        {feld.typ === "JA_NEIN" ? (
          <div className="flex gap-6 text-sm">
            {[
              { wert: true, name: "Ja" },
              { wert: false, name: "Nein" },
            ].map((o) => (
              <label key={o.name} className="flex items-center gap-2">
                <input type="radio" name={id} checked={wert === o.wert} onChange={() => onAendern(o.wert)} />
                {o.name}
              </label>
            ))}
          </div>
        ) : feld.typ === "AUSWAHL_EINFACH" ? (
          <div className="space-y-2 text-sm">
            {(feld.optionen ?? []).map((option) => (
              <label key={option} className="flex items-start gap-2">
                <input
                  type="radio"
                  name={id}
                  className="mt-1"
                  checked={wert === option}
                  onChange={() => onAendern(option)}
                />
                {option}
              </label>
            ))}
            {!feld.pflicht && wert !== undefined && wert !== null && (
              <button
                type="button"
                onClick={() => onAendern(null)}
                className="text-xs text-muted-foreground underline underline-offset-2"
              >
                Auswahl aufheben
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {(feld.optionen ?? []).map((option) => {
              const gewaehlt = Array.isArray(wert) ? (wert as string[]) : [];
              return (
                <label key={option} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={gewaehlt.includes(option)}
                    onChange={(e) =>
                      onAendern(e.target.checked ? [...gewaehlt, option] : gewaehlt.filter((g) => g !== option))
                    }
                  />
                  {option}
                </label>
              );
            })}
          </div>
        )}

        {fehlermeldung}
      </fieldset>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {beschriftung}
      </label>
      {hinweise}

      {feld.typ === "MEHRZEILIG" ? (
        <textarea
          id={id}
          rows={4}
          value={text}
          required={feld.pflicht}
          aria-required={feld.pflicht}
          aria-invalid={Boolean(fehler)}
          aria-describedby={beschreibung}
          onChange={(e) => onAendern(e.target.value)}
          className={stil}
        />
      ) : (
        <input
          id={id}
          type={
            feld.typ === "EMAIL" ? "email" : feld.typ === "TELEFON" ? "tel" : feld.typ === "DATUM" ? "date" : feld.typ === "ZAHL" ? "number" : "text"
          }
          inputMode={feld.personFeld === "PLZ" ? "numeric" : undefined}
          autoComplete={AUTOCOMPLETE[feld.personFeld]}
          value={text}
          placeholder={feld.platzhalter ?? ""}
          required={feld.pflicht}
          aria-required={feld.pflicht}
          aria-invalid={Boolean(fehler)}
          aria-describedby={beschreibung}
          onChange={(e) => onAendern(e.target.value)}
          className={stil}
        />
      )}

      {fehlermeldung}
    </div>
  );
}
