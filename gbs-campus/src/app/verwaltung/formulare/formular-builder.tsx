"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Der Formular-Builder.
 *
 * Bewusst ohne Ziehen und Fallenlassen: Pfeiltasten zum Verschieben sind mit
 * Tastatur und Vorlesesoftware bedienbar (WCAG 2.1 AA) und funktionieren auch
 * auf dem Tablet, mit dem der Schulleiter arbeitet.
 */

export type FeldTypWert =
  | "TEXT" | "MEHRZEILIG" | "EMAIL" | "TELEFON" | "DATUM" | "ZAHL"
  | "AUSWAHL_EINFACH" | "AUSWAHL_MEHRFACH" | "JA_NEIN" | "IBAN" | "HINWEIS";

export type PersonFeldWert =
  | "NICHTS" | "VORNAME" | "NACHNAME" | "EMAIL" | "TELEFON" | "GEBURTSDATUM"
  | "STRASSE" | "PLZ" | "ORT" | "GEMEINDE" | "IBAN" | "KONTOINHABER" | "TEILNAHMEFORM";

export type Feld = {
  code: string;
  typ: FeldTypWert;
  label: string;
  hilfetext: string | null;
  platzhalter: string | null;
  pflicht: boolean;
  optionen: string[] | null;
  personFeld: PersonFeldWert;
  istArt9: boolean;
  /** Nur bei personFeld = TEILNAHMEFORM: welche Antwort Schüler bzw. Hörer bedeutet. */
  teilnahmeformZuordnung?: Record<string, "SCHUELER" | "HOERER"> | null;
};

export type Abschnitt = {
  titel: string;
  beschreibung: string | null;
  felder: Feld[];
};

const FELDTYPEN: { wert: FeldTypWert; name: string }[] = [
  { wert: "TEXT", name: "Text, einzeilig" },
  { wert: "MEHRZEILIG", name: "Text, mehrzeilig" },
  { wert: "EMAIL", name: "E-Mail-Adresse" },
  { wert: "TELEFON", name: "Telefonnummer" },
  { wert: "DATUM", name: "Datum" },
  { wert: "ZAHL", name: "Zahl" },
  { wert: "AUSWAHL_EINFACH", name: "Auswahl, eine Antwort" },
  { wert: "AUSWAHL_MEHRFACH", name: "Auswahl, mehrere Antworten" },
  { wert: "JA_NEIN", name: "Ja / Nein" },
  { wert: "IBAN", name: "IBAN" },
  { wert: "HINWEIS", name: "Hinweistext, keine Eingabe" },
];

const AKTENFELDER: { wert: PersonFeldWert; name: string }[] = [
  { wert: "NICHTS", name: "— nicht übernehmen —" },
  { wert: "VORNAME", name: "Vorname" },
  { wert: "NACHNAME", name: "Nachname" },
  { wert: "EMAIL", name: "E-Mail-Adresse" },
  { wert: "TELEFON", name: "Telefon" },
  { wert: "GEBURTSDATUM", name: "Geburtsdatum" },
  { wert: "STRASSE", name: "Straße" },
  { wert: "PLZ", name: "Postleitzahl" },
  { wert: "ORT", name: "Ort" },
  { wert: "GEMEINDE", name: "Gemeinde" },
  { wert: "KONTOINHABER", name: "Kontoinhaber" },
  { wert: "IBAN", name: "IBAN" },
  { wert: "TEILNAHMEFORM", name: "Teilnahmeform (Schüler / Hörer)" },
];

const MIT_OPTIONEN: FeldTypWert[] = ["AUSWAHL_EINFACH", "AUSWAHL_MEHRFACH"];

function verschiebe<T>(liste: T[], von: number, nach: number): T[] {
  if (nach < 0 || nach >= liste.length) return liste;
  const kopie = [...liste];
  const [eintrag] = kopie.splice(von, 1);
  kopie.splice(nach, 0, eintrag);
  return kopie;
}

export function FormularBuilder({
  versionId,
  version,
  bearbeitbar,
  einleitungStart,
  abschnitteStart,
}: {
  versionId: string;
  version: number;
  bearbeitbar: boolean;
  einleitungStart: string;
  abschnitteStart: Abschnitt[];
}) {
  const router = useRouter();
  const [einleitung, setEinleitung] = useState(einleitungStart);
  const [abschnitte, setAbschnitte] = useState<Abschnitt[]>(abschnitteStart);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string; punkte?: string[] } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [vorschau, setVorschau] = useState(false);

  const anzahlFelder = useMemo(
    () => abschnitte.reduce((summe, a) => summe + a.felder.length, 0),
    [abschnitte],
  );

  function aendereAbschnitt(index: number, teil: Partial<Abschnitt>) {
    setAbschnitte((alt) => alt.map((a, i) => (i === index ? { ...a, ...teil } : a)));
  }

  function aendereFeld(abschnittIndex: number, feldIndex: number, teil: Partial<Feld>) {
    setAbschnitte((alt) =>
      alt.map((a, i) =>
        i !== abschnittIndex ? a : { ...a, felder: a.felder.map((f, j) => (j === feldIndex ? { ...f, ...teil } : f)) },
      ),
    );
  }

  function neuerFeldcode(): string {
    const vorhandene = new Set(abschnitte.flatMap((a) => a.felder.map((f) => f.code)));
    let nummer = 1;
    while (vorhandene.has(`feld_${nummer}`)) nummer++;
    return `feld_${nummer}`;
  }

  async function speichern() {
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ felder: number }>(`/api/formulare/${versionId}`, {
      methode: "PUT",
      rumpf: { einleitung: einleitung || null, abschnitte },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({
        art: "fehler",
        text: antwort.meldung,
        punkte: antwort.details?.map((d) => (d.feld ? `${d.feld}: ${d.meldung}` : d.meldung)),
      });
      return;
    }
    setMeldung({ art: "ok", text: `Entwurf gespeichert — ${antwort.daten.felder} Felder.` });
  }

  async function veroeffentlichen() {
    if (!confirm("Diese Fassung veröffentlichen? Danach lässt sie sich nicht mehr ändern, und neue Anmeldungen nutzen sie.")) {
      return;
    }
    setLaeuft(true);
    setMeldung(null);

    const gespeichert = await sendeAnfrage(`/api/formulare/${versionId}`, {
      methode: "PUT",
      rumpf: { einleitung: einleitung || null, abschnitte },
    });
    if (!gespeichert.ok) {
      setLaeuft(false);
      setMeldung({
        art: "fehler",
        text: gespeichert.meldung,
        punkte: gespeichert.details?.map((d) => (d.feld ? `${d.feld}: ${d.meldung}` : d.meldung)),
      });
      return;
    }

    const antwort = await sendeAnfrage(`/api/formulare/${versionId}/veroeffentlichen`, { methode: "POST" });

    if (!antwort.ok) {
      setLaeuft(false);
      setMeldung({
        art: "fehler",
        text: antwort.meldung,
        punkte: antwort.details?.map((d) => d.meldung),
      });
      return;
    }
    router.refresh();
    setLaeuft(false);
  }

  return (
    <div className="space-y-6">
      <header className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-6 pb-5 pt-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Anmeldeformular gestalten</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fassung {version} · {abschnitte.length} Abschnitte · {anzahlFelder} Felder
            {!bearbeitbar && " · veröffentlicht, nur lesbar"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setVorschau((v) => !v)}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium"
          >
            {vorschau ? "Bearbeiten" : "Vorschau"}
          </button>
          {bearbeitbar && (
            <>
              <button
                type="button"
                onClick={speichern}
                disabled={laeuft}
                className="rounded-lg border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
              >
                Entwurf speichern
              </button>
              <button
                type="button"
                onClick={veroeffentlichen}
                disabled={laeuft}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                Veröffentlichen
              </button>
            </>
          )}
        </div>
      </header>

      {meldung && (
        <div
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            meldung.art === "ok" ? "border-credo-gruen/40 bg-credo-gruen/5" : "border-credo-rot/40 bg-credo-rot/5"
          }`}
        >
          <p className="font-medium">{meldung.text}</p>
          {meldung.punkte && meldung.punkte.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {meldung.punkte.map((punkt) => (
                <li key={punkt}>{punkt}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {vorschau ? (
        <Vorschau einleitung={einleitung} abschnitte={abschnitte} />
      ) : (
        <>
          <section className="rounded-lg border border-border bg-card p-5">
            <label htmlFor="einleitung" className="mb-1.5 block text-sm font-medium">
              Einleitung über dem Formular
            </label>
            <textarea
              id="einleitung"
              rows={3}
              value={einleitung}
              disabled={!bearbeitbar}
              onChange={(e) => setEinleitung(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm disabled:opacity-60"
            />
          </section>

          {abschnitte.map((abschnitt, abschnittIndex) => (
            <section key={`${abschnittIndex}-${abschnitt.titel}`} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Abschnitt {abschnittIndex + 1}
                  </label>
                  <input
                    value={abschnitt.titel}
                    disabled={!bearbeitbar}
                    onChange={(e) => aendereAbschnitt(abschnittIndex, { titel: e.target.value })}
                    className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium disabled:opacity-60"
                  />
                  <input
                    value={abschnitt.beschreibung ?? ""}
                    disabled={!bearbeitbar}
                    placeholder="Erklärender Text unter der Überschrift (optional)"
                    onChange={(e) => aendereAbschnitt(abschnittIndex, { beschreibung: e.target.value || null })}
                    className="mt-2 w-full rounded-lg border border-input bg-background px-4 py-2 text-sm disabled:opacity-60"
                  />
                </div>
                {bearbeitbar && (
                  <div className="flex flex-col gap-1 pt-6">
                    <SchiebeKnopf
                      richtung="hoch"
                      titel="Abschnitt nach oben"
                      aus={abschnittIndex === 0}
                      onClick={() => setAbschnitte((alt) => verschiebe(alt, abschnittIndex, abschnittIndex - 1))}
                    />
                    <SchiebeKnopf
                      richtung="runter"
                      titel="Abschnitt nach unten"
                      aus={abschnittIndex === abschnitte.length - 1}
                      onClick={() => setAbschnitte((alt) => verschiebe(alt, abschnittIndex, abschnittIndex + 1))}
                    />
                    <button
                      type="button"
                      title="Abschnitt löschen"
                      onClick={() => {
                        if (confirm(`Abschnitt „${abschnitt.titel}“ mit ${abschnitt.felder.length} Feldern löschen?`)) {
                          setAbschnitte((alt) => alt.filter((_, i) => i !== abschnittIndex));
                        }
                      }}
                      className="mt-2 flex h-11 w-11 items-center justify-center rounded border border-input text-sm text-credo-rot"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-5 space-y-3">
                {abschnitt.felder.map((feld, feldIndex) => (
                  <FeldZeile
                    key={feld.code}
                    feld={feld}
                    bearbeitbar={bearbeitbar}
                    istErstes={feldIndex === 0}
                    istLetztes={feldIndex === abschnitt.felder.length - 1}
                    onAendern={(teil) => aendereFeld(abschnittIndex, feldIndex, teil)}
                    onVerschieben={(delta) =>
                      aendereAbschnitt(abschnittIndex, {
                        felder: verschiebe(abschnitt.felder, feldIndex, feldIndex + delta),
                      })
                    }
                    onLoeschen={() => {
                      // Rueckfrage wie beim Abschnitt: Der Loeschknopf sitzt
                      // direkt unter den Verschiebeknoepfen, und es gibt kein
                      // Rueckgaengig.
                      if (!confirm(`Frage „${feld.label}“ löschen?`)) return;
                      aendereAbschnitt(abschnittIndex, {
                        felder: abschnitt.felder.filter((_, j) => j !== feldIndex),
                      });
                    }}
                  />
                ))}
              </div>

              {bearbeitbar && (
                <button
                  type="button"
                  onClick={() =>
                    aendereAbschnitt(abschnittIndex, {
                      felder: [
                        ...abschnitt.felder,
                        {
                          code: neuerFeldcode(),
                          typ: "TEXT",
                          label: "Neue Frage",
                          hilfetext: null,
                          platzhalter: null,
                          pflicht: false,
                          optionen: null,
                          personFeld: "NICHTS",
                          istArt9: false,
                          teilnahmeformZuordnung: null,
                        },
                      ],
                    })
                  }
                  className="mt-4 rounded-lg border border-dashed border-input px-4 py-2 text-sm font-medium text-muted-foreground"
                >
                  + Frage hinzufügen
                </button>
              )}
            </section>
          ))}

          {bearbeitbar && (
            <button
              type="button"
              onClick={() =>
                setAbschnitte((alt) => [...alt, { titel: "Neuer Abschnitt", beschreibung: null, felder: [] }])
              }
              className="w-full rounded-lg border border-dashed border-input px-4 py-3 text-sm font-medium text-muted-foreground"
            >
              + Abschnitt hinzufügen
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SchiebeKnopf({
  richtung,
  titel,
  aus,
  onClick,
}: {
  richtung: "hoch" | "runter";
  titel: string;
  aus: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={titel}
      aria-label={titel}
      disabled={aus}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded border border-input text-sm disabled:opacity-30"
    >
      {richtung === "hoch" ? "↑" : "↓"}
    </button>
  );
}

/**
 * Eine Feldzeile im Builder.
 *
 * Jedes Bedienelement hat eine ID und eine damit verknüpfte Beschriftung.
 * Vorher hatten die sechs Beschriftungen je Zeile kein `htmlFor` und die
 * Eingaben weder `id` noch `aria-label` — Vorlesesoftware meldete bei rund
 * zwanzig Feldern nur „Eingabefeld, leer", der Builder war damit für diese
 * Nutzer nicht bedienbar.
 */
function FeldZeile({
  feld,
  bearbeitbar,
  istErstes,
  istLetztes,
  onAendern,
  onVerschieben,
  onLoeschen,
}: {
  feld: Feld;
  bearbeitbar: boolean;
  istErstes: boolean;
  istLetztes: boolean;
  onAendern: (teil: Partial<Feld>) => void;
  onVerschieben: (delta: number) => void;
  onLoeschen: () => void;
}) {
  const brauchtOptionen = MIT_OPTIONEN.includes(feld.typ);
  const istTeilnahmeform = feld.personFeld === "TEILNAHMEFORM";
  const basis = `builder-${feld.code}`;

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${basis}-label`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Beschriftung
            </label>
            <input
              id={`${basis}-label`}
              value={feld.label}
              disabled={!bearbeitbar}
              onChange={(e) => onAendern({ label: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor={`${basis}-typ`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Art der Frage
            </label>
            <select
              id={`${basis}-typ`}
              value={feld.typ}
              disabled={!bearbeitbar}
              onChange={(e) => {
                const typ = e.target.value as FeldTypWert;
                onAendern({
                  typ,
                  optionen: MIT_OPTIONEN.includes(typ) ? (feld.optionen ?? ["Antwort 1", "Antwort 2"]) : null,
                  ...(typ === "HINWEIS" ? { pflicht: false, personFeld: "NICHTS" as PersonFeldWert } : {}),
                });
              }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            >
              {FELDTYPEN.map((t) => (
                <option key={t.wert} value={t.wert}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`${basis}-akte`} className="mb-1 block text-xs font-medium text-muted-foreground">
              In die Akte übernehmen als
            </label>
            <select
              id={`${basis}-akte`}
              value={feld.personFeld}
              disabled={!bearbeitbar || feld.typ === "HINWEIS"}
              onChange={(e) => onAendern({ personFeld: e.target.value as PersonFeldWert })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            >
              {AKTENFELDER.map((f) => (
                <option key={f.wert} value={f.wert}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor={`${basis}-hilfe`} className="mb-1 block text-xs font-medium text-muted-foreground">
              Hilfetext (optional)
            </label>
            <input
              id={`${basis}-hilfe`}
              value={feld.hilfetext ?? ""}
              disabled={!bearbeitbar}
              onChange={(e) => onAendern({ hilfetext: e.target.value || null })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>

          {brauchtOptionen && (
            <div className="sm:col-span-2">
              <label htmlFor={`${basis}-optionen`} className="mb-1 block text-xs font-medium text-muted-foreground">
                Antwortmöglichkeiten — eine je Zeile, mindestens zwei
              </label>
              <textarea
                id={`${basis}-optionen`}
                rows={Math.max(2, (feld.optionen ?? []).length)}
                value={(feld.optionen ?? []).join("\n")}
                disabled={!bearbeitbar}
                onChange={(e) =>
                  onAendern({ optionen: e.target.value.split("\n").map((z) => z.trim()).filter(Boolean) })
                }
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              />
            </div>
          )}

          {istTeilnahmeform && (
            <fieldset className="sm:col-span-2 rounded border border-credo-blau/40 bg-credo-blau/5 p-3">
              <legend className="px-1 text-xs font-medium">Was bedeutet welche Antwort?</legend>
              <p className="mb-2 text-xs text-muted-foreground">
                Daran hängen Prüfungspflicht und Zeugnis. Früher wurde das aus dem Text geraten — „Gast-Schüler
                mit Prüfung“ ergab dabei Hörer. Deshalb bitte ausdrücklich zuordnen.
              </p>
              <div className="space-y-2">
                {(feld.optionen ?? []).map((option) => (
                  <div key={option} className="flex flex-wrap items-center gap-2 text-sm">
                    <label htmlFor={`${basis}-tf-${option}`} className="flex-1 min-w-40">
                      {option}
                    </label>
                    <select
                      id={`${basis}-tf-${option}`}
                      value={feld.teilnahmeformZuordnung?.[option] ?? ""}
                      disabled={!bearbeitbar}
                      onChange={(e) =>
                        onAendern({
                          teilnahmeformZuordnung: {
                            ...(feld.teilnahmeformZuordnung ?? {}),
                            [option]: e.target.value as "SCHUELER" | "HOERER",
                          },
                        })
                      }
                      className="rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
                    >
                      <option value="">— bitte wählen —</option>
                      <option value="SCHUELER">Schüler (mit Prüfung, mit Zeugnis)</option>
                      <option value="HOERER">Hörer (ohne Prüfung, ohne Zeugnis)</option>
                    </select>
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex flex-wrap items-center gap-5 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={feld.pflicht}
                disabled={!bearbeitbar || feld.typ === "HINWEIS"}
                onChange={(e) => onAendern({ pflicht: e.target.checked })}
              />
              Pflichtfeld
            </label>

            <label className="flex items-center gap-2 text-sm" title="Fragen zu Glaube, Gemeinde oder Gesundheit">
              <input
                type="checkbox"
                checked={feld.istArt9}
                disabled={!bearbeitbar || feld.typ === "HINWEIS"}
                onChange={(e) => onAendern({ istArt9: e.target.checked })}
              />
              Besonders geschützt (Art. 9 DSGVO)
            </label>

            <div className="ml-auto">
              <label htmlFor={`${basis}-code`} className="mr-2 text-xs text-muted-foreground">
                Schlüssel
              </label>
              <input
                id={`${basis}-code`}
                value={feld.code}
                disabled={!bearbeitbar}
                onChange={(e) => onAendern({ code: e.target.value })}
                title="Schlüssel in den gespeicherten Antworten — nur Kleinbuchstaben, Ziffern und Unterstriche"
                className="w-32 rounded border border-input bg-background px-2 py-1 font-mono text-xs disabled:opacity-60"
              />
            </div>
          </div>

          {feld.istArt9 && (
            <p className="sm:col-span-2 rounded border border-credo-gelb/50 bg-credo-gelb/10 px-3 py-2 text-xs">
              Diese Antwort wird nur gespeichert, wenn der Teilnehmer der Verarbeitung besonderer Daten gesondert
              zugestimmt hat — beim Absenden wie beim Zwischenspeichern. Ohne diese Zustimmung bleibt das Feld leer.
            </p>
          )}
        </div>

        {bearbeitbar && (
          <div className="flex flex-col gap-1">
            <SchiebeKnopf richtung="hoch" titel="Frage nach oben" aus={istErstes} onClick={() => onVerschieben(-1)} />
            <SchiebeKnopf richtung="runter" titel="Frage nach unten" aus={istLetztes} onClick={() => onVerschieben(1)} />
            <button
              type="button"
              title="Frage löschen"
              aria-label="Frage löschen"
              onClick={onLoeschen}
              className="mt-2 flex h-11 w-11 items-center justify-center rounded border border-input text-sm text-credo-rot"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Zeigt das Formular so, wie es der Anmeldende sehen wird. */
function Vorschau({ einleitung, abschnitte }: { einleitung: string; abschnitte: Abschnitt[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      {einleitung && <p className="mb-8 max-w-prose text-sm text-muted-foreground">{einleitung}</p>}

      {abschnitte.map((abschnitt, i) => (
        <section key={`${i}-${abschnitt.titel}`} className="mb-10">
          <h2 className="text-lg font-semibold">{abschnitt.titel}</h2>
          {abschnitt.beschreibung && <p className="mt-1 text-sm text-muted-foreground">{abschnitt.beschreibung}</p>}

          <div className="mt-5 space-y-5">
            {abschnitt.felder.map((feld, j) => (
              <div key={feld.code}>
                {feld.typ === "HINWEIS" ? (
                  <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">{feld.label}</p>
                ) : (
                  <>
                    <label className="mb-1.5 block text-sm font-medium">
                      {feld.label}
                      {feld.pflicht && <span className="ml-1 text-credo-rot">*</span>}
                    </label>
                    {feld.hilfetext && <p className="mb-1.5 text-xs text-muted-foreground">{feld.hilfetext}</p>}
                    <VorschauEingabe feld={feld} />
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function VorschauEingabe({ feld }: { feld: Feld }) {
  const stil = "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm";

  switch (feld.typ) {
    case "MEHRZEILIG":
      return <textarea rows={3} disabled className={stil} />;
    case "JA_NEIN":
      return (
        <div className="flex gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" disabled /> Ja
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" disabled /> Nein
          </label>
        </div>
      );
    case "AUSWAHL_EINFACH":
    case "AUSWAHL_MEHRFACH":
      return (
        <div className="space-y-1.5 text-sm">
          {(feld.optionen ?? []).map((option) => (
            <label key={option} className="flex items-center gap-2">
              <input type={feld.typ === "AUSWAHL_EINFACH" ? "radio" : "checkbox"} disabled /> {option}
            </label>
          ))}
        </div>
      );
    case "DATUM":
      return <input type="date" disabled className={stil} />;
    case "ZAHL":
      return <input type="number" disabled className={stil} />;
    default:
      return <input type="text" disabled placeholder={feld.platzhalter ?? ""} className={stil} />;
  }
}
