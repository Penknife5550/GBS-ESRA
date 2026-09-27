"use client";

import { useEffect, useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Liest den Token aus dem URL-FRAGMENT (#token=…) und schickt die Antwort
 * „Ich bin dabei" oder „Ich bin raus" per POST.
 *
 * Aus dem Fragment und nicht aus dem Query-String — wie beim Anmelde- und
 * Auskunftslink: Das Fragment schickt der Browser nicht an den Server, es landet
 * in keinem Zugriffslog, und ein Link-Scanner löst den Token nicht vorab ein.
 *
 * Beide Antworten sind idempotent; bis einschließlich zum Tag vor Semesterbeginn
 * lässt sich die Antwort über denselben Link ändern (ab dem Starttag ist die
 * Rückmeldung geschlossen). Das genaue Datum liefert die Route mit der ersten
 * Antwort (`frist`). „Ich bin raus" fragt vorher nach — die Absage nimmt die
 * Person aus allen Listen des Semesters.
 */
type Antwort = "dabei" | "raus";
type Ergebnis = {
  status: "ok" | "schon_bestaetigt" | "abgemeldet" | "schon_abgemeldet";
  semester: string;
  vorname: string;
  faecher: string[];
  /** Letzter Tag für eine Änderung („TT.MM.JJJJ"). */
  frist: string;
};

function meldungZu(ergebnis: Ergebnis): string {
  switch (ergebnis.status) {
    case "ok":
      return `Schön, dass Sie dabei sind, ${ergebnis.vorname}! Ihre Teilnahme am ${ergebnis.semester} ist bestätigt.`;
    case "schon_bestaetigt":
      return `Ihre Teilnahme am ${ergebnis.semester} war schon bestätigt — schön, dass Sie dabei sind, ${ergebnis.vorname}.`;
    case "abgemeldet":
      return `Danke für Ihre Rückmeldung, ${ergebnis.vorname}. Sie sind für das ${ergebnis.semester} abgemeldet.`;
    case "schon_abgemeldet":
      return `Sie waren für das ${ergebnis.semester} schon abgemeldet, ${ergebnis.vorname}.`;
  }
}

export function DabeiBestaetigen() {
  const [token, setToken] = useState<string | null>(null);
  const [bereit, setBereit] = useState(false);
  const [laeuft, setLaeuft] = useState<Antwort | null>(null);
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const wert = new URLSearchParams(hash).get("token");
    setToken(wert && /^[0-9a-f-]{36}$/i.test(wert) ? wert : null);
    setBereit(true);
  }, []);

  async function antworten(antwort: Antwort) {
    if (!token || laeuft) return;
    // Vor der ersten Antwort kennt die Seite das Datum noch nicht (der Token
    // geht erst mit der Antwort an den Server) — dann die allgemeine Regel.
    const bisWann = ergebnis ? `Bis einschließlich ${ergebnis.frist}` : "Bis zum Tag vor Semesterbeginn";
    if (
      antwort === "raus" &&
      !window.confirm(
        "Wirklich absagen?\n\nSie werden für das kommende Semester abgemeldet und stehen in keiner Liste dieses " +
          `Semesters. ${bisWann} können Sie über denselben Link noch „Ich bin dabei“ sagen.`,
      )
    ) {
      return;
    }

    setLaeuft(antwort);
    setFehler(null);

    const ergebnisAntwort = await sendeAnfrage<Ergebnis>("/api/ueberleitung/bestaetigen", {
      methode: "POST",
      rumpf: { token, antwort },
    });
    setLaeuft(null);

    if (!ergebnisAntwort.ok) {
      setFehler(ergebnisAntwort.meldung);
      return;
    }
    setErgebnis(ergebnisAntwort.daten);
  }

  // Vor dem Auslesen des Fragments nichts anzeigen — verhindert ein Aufblitzen
  // der „unvollständig"-Meldung, bevor der Token gelesen ist.
  if (!bereit) return null;

  if (!token) {
    return (
      <p className="mt-8 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
        Der Link war unvollständig. Bitte öffnen Sie den Link aus der E-Mail vollständig, oder wenden Sie sich an
        die Schulverwaltung.
      </p>
    );
  }

  const istDabei = ergebnis?.status === "ok" || ergebnis?.status === "schon_bestaetigt";

  return (
    <div className="mt-8">
      {ergebnis ? (
        <>
          <p
            role="status"
            className={`rounded-lg px-4 py-3 text-sm ${istDabei ? "bg-credo-gruen/10" : "border border-border bg-muted"}`}
          >
            {meldungZu(ergebnis)}
          </p>

          {istDabei && ergebnis.faecher.length > 0 && (
            <div className="mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Diese Fächer erwarten Sie
              </h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {ergebnis.faecher.map((fach) => (
                  <li key={fach} className="rounded-lg border border-border bg-card px-3 py-2">
                    {fach}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-6 text-xs text-muted-foreground">
            Anders überlegt? Bis einschließlich {ergebnis.frist} können Sie Ihre Antwort hier ändern — ab dem
            ersten Semestertag ist die Rückmeldung geschlossen.
          </p>
          <button
            type="button"
            onClick={() => antworten(istDabei ? "raus" : "dabei")}
            disabled={laeuft !== null}
            className="mt-2 min-h-11 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {laeuft !== null ? "Wird gespeichert …" : istDabei ? "Doch absagen: Ich bin raus" : "Doch dabei: Ich bin dabei"}
          </button>
        </>
      ) : (
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => antworten("dabei")}
            disabled={laeuft !== null}
            className="min-h-11 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {laeuft === "dabei" ? "Wird gespeichert …" : "Ja, ich bin dabei"}
          </button>
          <button
            type="button"
            onClick={() => antworten("raus")}
            disabled={laeuft !== null}
            className="min-h-11 w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium disabled:opacity-60"
          >
            {laeuft === "raus" ? "Wird gespeichert …" : "Nein, ich bin raus"}
          </button>
        </div>
      )}

      {fehler && (
        <p role="alert" className="mt-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}
        </p>
      )}
    </div>
  );
}
