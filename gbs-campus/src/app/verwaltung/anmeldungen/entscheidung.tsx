"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";

/**
 * „Aufnehmen“ und „Ablehnen …“ oben in der gewählten Anmeldung (Oberflächenplan
 * 09/2026): Aufnehmen fragt wie bisher nach (die Bestätigung geht sofort per
 * Mail raus), der Grund einer Ablehnung steht im Blatt.
 *
 * Nach der Entscheidung bleibt eine Meldung stehen, bis der Bediener die
 * Ansicht selbst aktualisiert. Vorher lud die Seite ohne Hinweise sofort neu:
 * Der Abschnitt verschwand ohne Erfolgsmeldung, und der Fokus lag im Nichts.
 */
export function Entscheidung({ anmeldungId, name }: { anmeldungId: string; name: string }) {
  const router = useRouter();
  const [ablehnen, setAblehnen] = useState(false);
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState<"ANNEHMEN" | "ABLEHNEN" | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Die Meldung nach der Entscheidung — sie muss stehen bleiben. Vorher stand
  // ein Teil davon in `alert()`, ein Fenster, das mit einem Klick verschwindet
  // und danach nirgends mehr nachlesbar ist.
  const [ergebnis, setErgebnis] = useState<{ text: string; warnung: boolean } | null>(null);
  const [aktualisiert, starteAktualisierung] = useTransition();
  const ergebnisRef = useRef<HTMLParagraphElement>(null);

  // Die Knöpfe, auf denen der Fokus lag, sind jetzt weg — er geht auf die Meldung.
  useEffect(() => {
    if (ergebnis) ergebnisRef.current?.focus();
  }, [ergebnis]);

  /**
   * Mit dem Aktualisieren verschwinden die Knöpfe (die Seite zeigt sie nur bei
   * EINGEREICHT) — samt dem, auf dem der Fokus liegt. Er fiele auf die Seite
   * zurück, und Vorlesesoftware sagte nichts. Deshalb vorher auf die
   * Überschrift der Anmeldung: Sie bleibt beim Aktualisieren stehen.
   */
  function aktualisieren() {
    const ueberschrift = document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("h1");
    if (ueberschrift) {
      ueberschrift.tabIndex = -1;
      ueberschrift.focus();
    }
    starteAktualisierung(() => router.refresh());
  }

  async function entscheiden(entscheidung: "ANNEHMEN" | "ABLEHNEN") {
    if (entscheidung === "ANNEHMEN" && !confirm(`${name} aufnehmen? Die Aufnahmebestätigung geht sofort per E-Mail raus.`)) {
      return;
    }
    setLaeuft(entscheidung);
    setFehler(null);

    const antwort = await sendeAnfrage<{
      entschieden: boolean;
      mailGesendet: boolean | null;
      semesterZugeordnet: boolean | null;
      ermaessigungGesetzt: boolean | null;
    }>(
      `/api/anmeldungen/${anmeldungId}/entscheiden`,
      { methode: "POST", rumpf: entscheidung === "ANNEHMEN" ? { entscheidung } : { entscheidung, grund } },
    );

    if (!antwort.ok) {
      setLaeuft(null);
      setFehler(antwort.meldung);
      return;
    }

    const angenommen = entscheidung === "ANNEHMEN";
    const hinweise: string[] = [];

    // Der Schulleiter erfaehrt, wenn die Bestaetigung nicht rausging — sonst
    // haelt er jemanden fuer informiert, bei dem nie etwas ankam.
    if (antwort.daten.mailGesendet === false) {
      hinweise.push(
        `${name} wurde aufgenommen. Die Bestätigungsmail konnte aber nicht zugestellt werden — ` +
          "bitte persönlich Bescheid geben. Einzelheiten unter Verwaltung → Betrieb.",
      );
    }

    // Eine gesetzte Ehepartner-Ermäßigung ist eine finanzielle Änderung (halber
    // Beitrag) — der Bediener soll sie schwarz auf weiß sehen und einen falsch
    // angehakten Ehepartner-Haken bemerken können, statt dass sie unsichtbar
    // gesetzt wird.
    if (antwort.daten.ermaessigungGesetzt === true) {
      hinweise.push(
        `${name} wurde aufgenommen. Weil die Anmeldung eine gemeinsame Anmeldung mit dem Ehepartner ` +
          "angibt, wurde die Ehepartner-Ermäßigung (50 % Semesterbeitrag) am Konto vermerkt.",
      );
    }

    // Ohne Semester oder ohne Teilnahmeform entsteht keine Teilnahme — die
    // Person stünde dann auf keiner Liste. Das darf nicht stillschweigend
    // passieren.
    if (antwort.daten.semesterZugeordnet === false) {
      hinweise.push(
        `${name} konnte keinem Semester zugeordnet werden. ` +
          "Entweder ist kein Semester als laufend gesetzt oder es fehlt die Teilnahmeform. " +
          "Unter Personen → Dieses Semester lässt sich das nachholen.",
      );
    }

    // Die Knöpfe sind jetzt weg: Ein zweiter Klick, der eine zweite Mail
    // auslöst, ist nicht möglich. Die Meldung bleibt bis zum Aktualisieren.
    setLaeuft(null);
    setAblehnen(false);
    setErgebnis({
      text:
        hinweise.length > 0
          ? hinweise.join(" ")
          : angenommen
            ? `${name} ist aufgenommen.`
            : `Die Ablehnung für ${name} ist festgehalten.`,
      warnung: hinweise.length > 0,
    });
  }

  if (ergebnis) {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
        <p
          ref={ergebnisRef}
          role="status"
          tabIndex={-1}
          className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none lg:max-w-xl ${ergebnis.warnung ? "bg-credo-gelb/15" : "bg-credo-gruen/15"}`}
        >
          {ergebnis.text}
        </p>
        <button type="button" onClick={aktualisieren} disabled={aktualisiert} className={knopf("sekundaer")}>
          {aktualisiert ? "Wird aktualisiert …" : "Ansicht aktualisieren"}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full lg:w-auto">
      <div className="grid grid-cols-2 gap-2 lg:flex">
        <button
          type="button"
          onClick={() => {
            setFehler(null);
            setAblehnen(true);
          }}
          disabled={laeuft !== null}
          className={knopf("sekundaer")}
        >
          Ablehnen …
        </button>
        <button type="button" onClick={() => entscheiden("ANNEHMEN")} disabled={laeuft !== null} className={knopf("primaer")}>
          <Icon name="haken" className="h-4 w-4" />
          {laeuft === "ANNEHMEN" ? "Wird aufgenommen …" : "Aufnehmen"}
        </button>
      </div>
      {fehler && !ablehnen && (
        <p role="alert" className="mt-2 rounded-lg bg-credo-rot/10 px-3 py-2 text-sm lg:max-w-md">
          {fehler}
        </p>
      )}

      <Blatt
        offen={ablehnen}
        onSchliessen={() => setAblehnen(false)}
        titel={`Anmeldung von ${name} ablehnen`}
        fuss={
          <>
            <button type="button" onClick={() => setAblehnen(false)} className={knopf("sekundaer")}>
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => entscheiden("ABLEHNEN")}
              disabled={laeuft !== null || grund.trim().length === 0}
              className={knopf("primaer")}
            >
              {laeuft === "ABLEHNEN" ? "Wird festgehalten …" : "Ablehnung festhalten"}
            </button>
          </>
        }
      >
        <label htmlFor={`grund-${anmeldungId}`} className="mb-1.5 block text-sm font-medium">
          Grund der Ablehnung
        </label>
        <textarea
          id={`grund-${anmeldungId}`}
          rows={4}
          value={grund}
          onChange={(e) => setGrund(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
        <p className="mt-2 text-xs text-muted-foreground">Nur intern — es geht keine automatische Mail raus.</p>
        {fehler && ablehnen && (
          <p role="alert" className="mt-3 rounded-lg bg-credo-rot/10 px-3 py-2 text-sm">
            {fehler}
          </p>
        )}
      </Blatt>
    </div>
  );
}
