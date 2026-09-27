"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Aufnehmen oder Ablehnen — in der Anmeldeliste und auf der Detailseite.
 *
 * Nach der Entscheidung bleibt eine Meldung stehen, bis der Bediener die
 * Ansicht selbst aktualisiert. Vorher lud die Seite ohne Hinweise sofort neu:
 * Der Abschnitt verschwand ohne Erfolgsmeldung, und der Fokus lag im Nichts.
 */
export function Entscheidung({ anmeldungId, name }: { anmeldungId: string; name: string }) {
  const router = useRouter();
  const [modus, setModus] = useState<"bereit" | "ablehnen">("bereit");
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState(false);
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
   * Mit dem Aktualisieren verschwindet dieser Abschnitt (Liste und Detailseite
   * zeigen ihn nur bei EINGEREICHT) — samt dem Knopf, auf dem der Fokus liegt.
   * Er fiele auf die Seite zurück, und Vorlesesoftware sagte nichts. Deshalb
   * vorher auf die Seitenüberschrift: Sie bleibt beim Aktualisieren stehen.
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
    setLaeuft(true);
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
      setLaeuft(false);
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
          "Unter Verwaltung → Aktive dieses Semester lässt sich das nachholen.",
      );
    }

    // Mit dem Aktualisieren verschwindet dieser Abschnitt (in der Liste die
    // Karte, auf der Detailseite der Entscheidungsteil) — und mit ihm die
    // Meldung. Deshalb bleibt sie stehen, bis der Bediener selbst aktualisiert.
    // Die Knöpfe sind dann schon weg: Ein zweiter Klick, der eine zweite Mail
    // auslöst, ist nicht möglich.
    setLaeuft(false);
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
      <div className="mt-4">
        <p
          ref={ergebnisRef}
          role="status"
          tabIndex={-1}
          className={`rounded-lg px-3 py-2 text-sm outline-none ${ergebnis.warnung ? "bg-credo-gelb/15" : "bg-credo-gruen/15"}`}
        >
          {ergebnis.text}
        </p>
        <button
          type="button"
          onClick={aktualisieren}
          disabled={aktualisiert}
          className="mt-3 min-h-11 rounded-lg border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {aktualisiert ? "Wird aktualisiert …" : "Ansicht aktualisieren"}
        </button>
      </div>
    );
  }

  if (modus === "ablehnen") {
    return (
      <div className="mt-4 rounded-lg border border-border bg-muted p-4">
        <label htmlFor={`grund-${anmeldungId}`} className="mb-1.5 block text-sm font-medium">
          Grund der Ablehnung — nur intern, es geht keine automatische Mail raus
        </label>
        <textarea
          id={`grund-${anmeldungId}`}
          rows={3}
          value={grund}
          onChange={(e) => setGrund(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => entscheiden("ABLEHNEN")}
            disabled={laeuft || grund.trim().length === 0}
            className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {laeuft ? "Wird festgehalten …" : "Ablehnung festhalten"}
          </button>
          <button
            type="button"
            onClick={() => setModus("bereit")}
            className="min-h-11 rounded-lg border border-input px-4 py-2 text-sm font-medium"
          >
            Abbrechen
          </button>
        </div>
        {fehler && (
          <p role="alert" className="mt-2 rounded-lg bg-credo-rot/10 px-3 py-2 text-sm">
            {fehler}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => entscheiden("ANNEHMEN")}
        disabled={laeuft}
        className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird aufgenommen …" : "Aufnehmen"}
      </button>
      <button
        type="button"
        onClick={() => setModus("ablehnen")}
        disabled={laeuft}
        className="min-h-11 rounded-lg border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        Ablehnen
      </button>
      {fehler && (
        <p role="alert" className="w-full rounded-lg bg-credo-rot/10 px-3 py-2 text-sm">
          {fehler}
        </p>
      )}
    </div>
  );
}
