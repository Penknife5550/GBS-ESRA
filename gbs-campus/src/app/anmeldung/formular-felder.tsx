"use client";

/**
 * GBS Campus — die Felder des öffentlichen Anmeldeformulars
 *
 * Große Felder für das Handy (16 px Schrift: das iPhone zoomt beim Tippen nicht
 * hinein), Auswahlfragen mit zwei oder drei kurzen Antworten als Umschalter,
 * längere Auswahlen als Liste mit großen Zeilen (Oberflächenplan 09/2026).
 * Die Bedienelemente bleiben dieselben wie vorher — Radios, Checkboxen,
 * Textfelder —, nur größer; Tastatur und Vorlesesoftware bedienen sie wie
 * gewohnt.
 */

import { useRef, useState, type ChangeEvent } from "react";
import { Hinweis } from "@/components/ui/hinweis";
import { FELD, FELD_TITEL } from "@/app/anmelden/oeffentlich";
import { istIbanGueltig } from "@/lib/pruefwerte";
import type { EinwilligungsAngebot, OeffentlichesFeld } from "./oeffentliches-formular";
import { einwilligungsId } from "./schritte";

/** Feldtypen, die als Gruppe mehrerer Bedienelemente dargestellt werden. */
const GRUPPENTYPEN = ["JA_NEIN", "AUSWAHL_EINFACH", "AUSWAHL_MEHRFACH"];

const JA_NEIN_OPTIONEN = [
  { wert: true, text: "Ja" },
  { wert: false, text: "Nein" },
];

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

/** Zwei oder drei kurze Antworten passen nebeneinander in einen Umschalter („Herr | Frau“). */
function passtInUmschalter(optionen: string[]): boolean {
  return optionen.length >= 2 && optionen.length <= 3 && optionen.every((o) => o.length <= 16);
}

/**
 * Das rote Sternchen für Pflichtangaben. Vorlesesoftware bekommt statt „Stern"
 * den Text „(Pflichtangabe)" — ein `aria-label` auf einem schlichten `span` wird
 * nicht vorgelesen. Wichtig vor allem bei Auswahlgruppen und Einwilligungen:
 * Dort sagt kein `required` am Textfeld, dass die Frage Pflicht ist.
 */
export function Pflichtstern() {
  return (
    <>
      <span className="ml-1 text-credo-rot" aria-hidden="true">
        *
      </span>
      <span className="sr-only"> (Pflichtangabe)</span>
    </>
  );
}

/**
 * Eine Einwilligung zum Anhaken — im ersten Art.-9-Schritt mit ganzem Text, in
 * der Übersicht am Ende eingeklappt („Text lesen“). Derselbe Zustand an beiden
 * Stellen. Der Text bleibt auch eingeklappt die Beschreibung des Hakens
 * (`aria-describedby` liest verborgene Elemente mit).
 */
export function EinwilligungsHaken({
  einwilligung,
  erteilt,
  onAendern,
  fehler,
  textEingeklappt = false,
}: {
  einwilligung: EinwilligungsAngebot;
  erteilt: boolean;
  onAendern: (an: boolean) => void;
  fehler?: string;
  textEingeklappt?: boolean;
}) {
  // Die Darstellung gilt ab dem ersten Zeichnen: Wer den Haken im Schritt
  // wieder entfernt, behält den Schalter „Text lesen“.
  const [mitSchalter] = useState(textEingeklappt);
  const [textOffen, setTextOffen] = useState(!textEingeklappt);
  const id = einwilligungsId(einwilligung.code);
  const textId = `${id}-text`;
  const fehlerId = `${id}-fehler`;

  return (
    <div className="flex gap-3.5">
      <input
        id={id}
        type="checkbox"
        className="mt-px h-[22px] w-[22px] shrink-0 cursor-pointer accent-primary"
        checked={erteilt}
        required={einwilligung.pflicht}
        aria-required={einwilligung.pflicht}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={fehler ? `${textId} ${fehlerId}` : textId}
        onChange={(ereignis) => onAendern(ereignis.target.checked)}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block cursor-pointer text-[15px] font-medium leading-snug text-foreground">
          {einwilligung.titel}
          {einwilligung.pflicht && <Pflichtstern />}
        </label>
        {mitSchalter && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {einwilligung.istArt9
              ? "Besonders geschützt (Art. 9 DSGVO)"
              : einwilligung.pflicht
                ? "Pflicht für die Anmeldung"
                : "Freiwillig"}
            {" · "}
            <button
              type="button"
              aria-expanded={textOffen}
              aria-controls={textId}
              onClick={() => setTextOffen((offen) => !offen)}
              className="inline-flex min-h-6 items-center font-medium text-primary underline-offset-2 hover:underline"
            >
              {textOffen ? "Text ausblenden" : "Text lesen"}
            </button>
          </p>
        )}
        <p id={textId} hidden={!textOffen} className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {einwilligung.text}
        </p>
        {fehler && (
          <p id={fehlerId} className="mt-1.5 text-[13px] text-credo-rot">
            {fehler}
          </p>
        )}
      </div>
    </div>
  );
}

/** IBAN in Vierergruppen: "DE89370400440532013000" → "DE89 3704 0044 …". */
function formatiereIban(roh: string): string {
  const bereinigt = roh.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return bereinigt.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Eigene Eingabe für die IBAN: gruppiert die Ziffern während des Tippens, prüft
 * die Prüfziffer live (dieselbe Regel wie der Server) und meldet das Ergebnis
 * ruhig zurück — mit Häkchen und Hinweis, sobald sie stimmt, rot erst, wenn das
 * Feld verlassen wurde. Ein Zahlendreher fällt so beim Ausfüllen auf, nicht
 * erst, wenn die Lastschrift Wochen später zurückkommt.
 *
 * Der Cursor bleibt beim Umformatieren an der richtigen Stelle: gezählt wird
 * über die echten Zeichen vor der Einfügemarke, die eingefügten Leerzeichen
 * verschieben ihn nicht.
 */
function IbanEingabe({
  id,
  text,
  pflicht,
  fehler,
  hilfeId,
  onAendern,
}: {
  id: string;
  text: string;
  pflicht: boolean;
  fehler?: string;
  hilfeId?: string;
  onAendern: (wert: unknown) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [beruehrt, setBeruehrt] = useState(false);

  const bereinigt = text.replace(/\s+/g, "");
  const gueltig = bereinigt.length >= 15 && istIbanGueltig(bereinigt);
  const serverFehler = Boolean(fehler);
  // Gültig hat Vorrang: sobald die Prüfziffer stimmt, ist der Zustand grün — auch wenn beim letzten
  // Absenden noch ein Serverfehler kam. Umgekehrt zeigt ein Serverfehler auch bei LEEREM Pflichtfeld
  // rot; sonst schluckt die Bedingung "length > 0" die Meldung, und der Nutzer sieht am IBAN-Feld
  // gar nichts, obwohl der Server es als Pflichtfeld abgewiesen hat.
  const liveFehler = !gueltig && (serverFehler || (beruehrt && bereinigt.length > 0));
  const statusId = `${id}-status`;
  const beschreibung = [hilfeId, liveFehler || gueltig ? statusId : undefined].filter(Boolean).join(" ") || undefined;

  function beiEingabe(e: ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    const echteVorCursor = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/[^A-Za-z0-9]/g, "").length;
    const formatiert = formatiereIban(el.value);
    onAendern(formatiert);
    requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      let pos = 0;
      let echte = 0;
      while (pos < formatiert.length && echte < echteVorCursor) {
        if (/[A-Za-z0-9]/.test(formatiert[pos])) echte += 1;
        pos += 1;
      }
      node.setSelectionRange(pos, pos);
    });
  }

  // Grün allein trägt den Zustand nicht (Rahmen und Grün auf Weiß liegen unter
  // 3:1): Häkchen und Hinweistext stehen in Textfarbe daneben.
  const rahmen = liveFehler ? "border-credo-rot" : gueltig ? "border-credo-gruen" : "border-input";

  return (
    <div>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder="DE00 0000 0000 0000 0000 00"
          required={pflicht}
          aria-required={pflicht}
          aria-invalid={liveFehler}
          aria-describedby={beschreibung}
          onChange={beiEingabe}
          onBlur={() => setBeruehrt(true)}
          className={`${FELD} h-12 pr-11 font-mono tracking-wider ${rahmen}`}
        />
        {gueltig && (
          <span
            className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-base font-semibold text-foreground"
            aria-hidden
          >
            ✓
          </span>
        )}
      </div>
      {gueltig ? (
        <p id={statusId} className="mt-1.5 inline-block rounded bg-credo-gruen/15 px-2 py-0.5 text-[13px] text-foreground">
          <span aria-hidden="true">✓ </span>
          IBAN geprüft — die Prüfziffer stimmt.
        </p>
      ) : liveFehler ? (
        <p id={statusId} className="mt-1.5 text-[13px] text-credo-rot" role="alert">
          {fehler ?? "Diese IBAN stimmt nicht. Bitte Länderkürzel und Ziffern prüfen."}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ein Umschalter aus Radios („Herr | Frau“, „Ja | Nein“): Die Radios sind nur
 * optisch versteckt — Pfeiltasten, Leertaste und Vorlesesoftware bedienen sie
 * wie eine gewöhnliche Radiogruppe, der Fokus erscheint am Segment.
 */
function Umschalter({
  name,
  optionen,
  wert,
  pflicht,
  fehler,
  onAendern,
}: {
  name: string;
  optionen: { wert: unknown; text: string }[];
  wert: unknown;
  pflicht: boolean;
  fehler: boolean;
  onAendern: (wert: unknown) => void;
}) {
  return (
    <div
      className={`grid auto-cols-fr grid-flow-col gap-0.5 rounded-xl bg-feld p-[3px] ${fehler ? "ring-1 ring-credo-rot" : ""}`}
    >
      {optionen.map((option) => (
        <label
          key={option.text}
          className="relative flex min-h-11 cursor-pointer items-center justify-center rounded-[9px] px-3 py-1.5 text-center text-[15px] font-medium leading-tight text-muted-foreground transition-colors hover:text-foreground has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            required={pflicht}
            checked={wert === option.wert}
            onChange={() => onAendern(option.wert)}
          />
          {option.text}
        </label>
      ))}
    </div>
  );
}

/**
 * Ein Feld.
 *
 * Auswahl- und Ja/Nein-Fragen werden als `fieldset` mit `legend` dargestellt.
 * Vorher zeigte ein `label htmlFor` auf eine ID, die es bei diesen Typen gar
 * nicht gab: Vorlesesoftware las nur die Antwortmöglichkeiten vor, nie die
 * Frage — auf dem Pflichtfeld „Wie möchten Sie teilnehmen?" also gar nichts
 * Verständliches. Und ein Klick auf die Beschriftung wählte nichts aus.
 */
export function Feld({
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
    return <Hinweis>{feld.label}</Hinweis>;
  }

  const id = `feld-${feld.code}`;
  const hilfeId = feld.hilfetext ? `${id}-hilfe` : undefined;
  const fehlerId = fehler ? `${id}-fehler` : undefined;
  const beschreibung = [hilfeId, fehlerId].filter(Boolean).join(" ") || undefined;
  const rahmen = fehler ? "border-credo-rot" : "border-input";
  const text = typeof wert === "string" ? wert : typeof wert === "number" ? String(wert) : "";

  const beschriftung = (
    <>
      {feld.label}
      {feld.pflicht && <Pflichtstern />}
    </>
  );

  const hilfe = feld.hilfetext ? (
    <p id={hilfeId} className="-mt-0.5 mb-2 text-[13px] leading-snug text-muted-foreground">
      {feld.hilfetext}
    </p>
  ) : null;

  const fehlermeldung = fehler ? (
    <p id={fehlerId} className="mt-1.5 text-[13px] text-credo-rot">
      {fehler}
    </p>
  ) : null;

  if (GRUPPENTYPEN.includes(feld.typ)) {
    const optionen = feld.optionen ?? [];
    const alsUmschalter = feld.typ === "JA_NEIN" || (feld.typ === "AUSWAHL_EINFACH" && passtInUmschalter(optionen));
    const gewaehlt = Array.isArray(wert) ? (wert as string[]) : [];

    return (
      // tabIndex am fieldset, damit der Sprung zum ersten Fehler auch bei
      // Auswahlfragen ein Ziel findet. `required` steht an jedem Radio der
      // Gruppe (gültiges HTML): So sagt Vorlesesoftware „erforderlich" auch an,
      // wenn der Fokus nicht auf dem ersten landet. Die Mehrfachauswahl hat kein
      // passendes Attribut — dort trägt die Legende „(Pflichtangabe)".
      <fieldset
        id={id}
        tabIndex={-1}
        aria-describedby={beschreibung}
        aria-invalid={Boolean(fehler)}
        className="min-w-0 border-0 p-0 outline-none"
      >
        <legend className={FELD_TITEL}>{beschriftung}</legend>
        {hilfe}

        {alsUmschalter ? (
          <Umschalter
            name={id}
            optionen={feld.typ === "JA_NEIN" ? JA_NEIN_OPTIONEN : optionen.map((o) => ({ wert: o, text: o }))}
            wert={wert}
            pflicht={feld.pflicht}
            fehler={Boolean(fehler)}
            onAendern={onAendern}
          />
        ) : (
          <div className={`divide-y divide-linie overflow-hidden rounded-xl border bg-background ${rahmen}`}>
            {optionen.map((option) => (
              <label
                key={option}
                className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5 text-[15px] leading-snug text-foreground"
              >
                {feld.typ === "AUSWAHL_MEHRFACH" ? (
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-primary"
                    checked={gewaehlt.includes(option)}
                    onChange={(e) =>
                      onAendern(e.target.checked ? [...gewaehlt, option] : gewaehlt.filter((g) => g !== option))
                    }
                  />
                ) : (
                  <input
                    type="radio"
                    name={id}
                    className="h-5 w-5 shrink-0 accent-primary"
                    required={feld.pflicht}
                    checked={wert === option}
                    onChange={() => onAendern(option)}
                  />
                )}
                {option}
              </label>
            ))}
          </div>
        )}

        {feld.typ === "AUSWAHL_EINFACH" && !feld.pflicht && wert !== undefined && wert !== null && (
          <button
            type="button"
            onClick={() => onAendern(null)}
            className="mt-1 inline-flex min-h-9 items-center text-[13px] text-muted-foreground underline underline-offset-2"
          >
            Auswahl aufheben
          </button>
        )}

        {fehlermeldung}
      </fieldset>
    );
  }

  return (
    <div>
      <label htmlFor={id} className={FELD_TITEL}>
        {beschriftung}
      </label>
      {hilfe}

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
          className={`${FELD} min-h-32 py-3 leading-relaxed ${rahmen}`}
        />
      ) : feld.typ === "IBAN" ? (
        <IbanEingabe
          id={id}
          text={text}
          pflicht={feld.pflicht}
          fehler={fehler}
          hilfeId={hilfeId}
          onAendern={onAendern}
        />
      ) : (
        <input
          id={id}
          type={
            feld.typ === "EMAIL"
              ? "email"
              : feld.typ === "TELEFON"
                ? "tel"
                : feld.typ === "DATUM"
                  ? "date"
                  : feld.typ === "ZAHL"
                    ? "number"
                    : "text"
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
          className={`${FELD} h-12 ${rahmen}`}
        />
      )}

      {/* Die IBAN-Eingabe meldet Fehler selbst (grün/rot), sonst doppelt es sich. */}
      {feld.typ !== "IBAN" && fehlermeldung}
    </div>
  );
}
