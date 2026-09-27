"use client";

import { useEffect, useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Abschnitt, Gruppe, Zeile } from "@/components/ui/liste";

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
      <p className="mt-8 rounded-xl bg-credo-rot/10 px-4 py-3 text-sm text-foreground">
        Der Link war unvollständig. Bitte öffnen Sie den Link aus der E-Mail vollständig, oder wenden Sie sich an
        die Schulverwaltung.
      </p>
    );
  }

  const istDabei = ergebnis?.status === "ok" || ergebnis?.status === "schon_bestaetigt";

  return (
    <div className="mt-6">
      {ergebnis ? (
        <>
          <p
            role="status"
            className={`rounded-xl px-4 py-3 text-[15px] leading-relaxed text-foreground ${istDabei ? "bg-credo-gruen/10" : "bg-muted"}`}
          >
            {meldungZu(ergebnis)}
          </p>

          {istDabei && ergebnis.faecher.length > 0 && (
            <div className="mt-7">
              <Abschnitt titel="Diese Fächer erwarten Sie" />
              <Gruppe>
                {ergebnis.faecher.map((fach) => (
                  <Zeile key={fach} titel={fach} />
                ))}
              </Gruppe>
            </div>
          )}

          <Hinweis icon="uhr" className="mt-7">
            Anders überlegt? Bis einschließlich <span className="font-semibold text-foreground">{ergebnis.frist}</span>{" "}
            können Sie Ihre Antwort hier ändern — ab dem ersten Semestertag ist die Rückmeldung geschlossen.
          </Hinweis>
          <button
            type="button"
            onClick={() => antworten(istDabei ? "raus" : "dabei")}
            disabled={laeuft !== null}
            className={`${knopf("sekundaer", "gross")} mt-3`}
          >
            {laeuft !== null ? "Wird gespeichert …" : istDabei ? "Doch absagen: Ich bin raus" : "Doch dabei: Ich bin dabei"}
          </button>
        </>
      ) : (
        <>
          <Hinweis icon="uhr">
            Bis zum Tag vor Semesterbeginn können Sie Ihre Antwort über denselben Link noch ändern; das genaue Datum
            steht in der E-Mail.
          </Hinweis>
          <div className="mt-6 grid gap-2.5">
            <button
              type="button"
              onClick={() => antworten("dabei")}
              disabled={laeuft !== null}
              className={knopf("primaer", "gross")}
            >
              {laeuft === "dabei" ? "Wird gespeichert …" : "Ja, ich bin dabei"}
            </button>
            <button
              type="button"
              onClick={() => antworten("raus")}
              disabled={laeuft !== null}
              className={knopf("sekundaer", "gross")}
            >
              {laeuft === "raus" ? "Wird gespeichert …" : "Nein, ich bin raus"}
            </button>
          </div>
        </>
      )}

      {fehler && (
        <p role="alert" className="mt-5 rounded-xl bg-credo-rot/10 px-4 py-3 text-sm text-foreground">
          {fehler}
        </p>
      )}
    </div>
  );
}
