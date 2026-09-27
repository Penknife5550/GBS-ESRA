"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { sendeAnfrage } from "@/lib/api-client";

const TOKEN_MUSTER = /^[0-9a-f-]{36}$/i;

/**
 * Liest den Token aus dem URL-FRAGMENT (#token=…) — wie beim Anmelde-,
 * Auskunfts- und Dabei-Link: Das Fragment schickt der Browser nicht an den
 * Server, der Token landet also in keinem Zugriffslog.
 *
 * Übergang: Bis Code-Review 4 stand der Token als `?token=…` in der Adresse.
 * Solche Links aus bereits verschickten Mails gelten bis zu ihrem Ablauf weiter.
 * Der Token wird dann gelesen und per `history.replaceState` aus dem
 * Query-String ins Fragment verschoben — ein Neuladen schickt ihn so nicht noch
 * einmal an den Server.
 */
function leseToken(): string | null {
  const ausFragment = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  if (ausFragment && TOKEN_MUSTER.test(ausFragment)) return ausFragment;

  const ausAdresse = new URLSearchParams(window.location.search).get("token");
  if (ausAdresse && TOKEN_MUSTER.test(ausAdresse)) {
    window.history.replaceState(null, "", `${window.location.pathname}#token=${ausAdresse}`);
    return ausAdresse;
  }
  return null;
}

/**
 * Ein Klick, ein POST. Dasselbe Muster wie beim Anmeldelink: Ein GET würde von
 * Link-Scannern in Mail-Sicherheitslösungen abgerufen und der Token wäre
 * verbraucht, bevor der Empfänger überhaupt klickt.
 */
export function EmailBestaetigen() {
  const [token, setToken] = useState<string | null>(null);
  const [bereit, setBereit] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [neueAdresse, setNeueAdresse] = useState<string | null>(null);
  const erfolgRef = useRef<HTMLParagraphElement>(null);

  // Mit dem Erfolg verschwindet der Knopf — und mit ihm der Fokus. Ohne diesen
  // Sprung landet die Tastatur wieder ganz oben und Vorleseprogramme sagen
  // nichts.
  useEffect(() => {
    if (neueAdresse) erfolgRef.current?.focus();
  }, [neueAdresse]);

  useEffect(() => {
    setToken(leseToken());
    setBereit(true);
  }, []);

  async function bestaetigen() {
    if (!token) return;
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<{ bestaetigt: boolean; email: string }>(
      "/api/meine-daten/email/bestaetigen",
      { methode: "POST", rumpf: { token } },
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }
    setNeueAdresse(antwort.daten.email);
  }

  // Vor dem Auslesen des Fragments nichts anzeigen — verhindert ein Aufblitzen
  // der „unvollständig"-Meldung, bevor der Token gelesen ist.
  if (!bereit) return null;

  // Ohne Token gilt der Einleitungssatz („Danach läuft dein Zugang …“) nicht —
  // eigene Überschrift statt eines Widerspruchs auf derselben Seite.
  if (!token) {
    return (
      <div className="mt-8">
        <h2 className="text-lg font-semibold">Der Link war unvollständig</h2>
        <p className="mt-3 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          Bitte öffne den Link aus der E-Mail vollständig, oder beantrage die Änderung im Portal unter „Meine Daten“
          noch einmal.
        </p>
      </div>
    );
  }

  if (neueAdresse) {
    return (
      <div className="mt-8">
        <p
          ref={erfolgRef}
          tabIndex={-1}
          role="status"
          className="rounded-lg bg-credo-gruen/10 px-4 py-3 text-sm"
        >
          Deine E-Mail-Adresse ist jetzt <span className="font-medium break-all">{neueAdresse}</span>. Ab
          sofort läuft dein Zugang zum Portal über diese Adresse.
        </p>
        <Link
          href="/anmelden"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Zur Anmeldung
        </Link>
      </div>
    );
  }

  return (
    <>
      <p className="mt-3 text-sm text-muted-foreground">
        Danach läuft dein Zugang zum Portal über diese Adresse. Bis zu diesem Klick gilt die bisherige.
      </p>
      <button
        type="button"
        onClick={bestaetigen}
        disabled={laeuft}
        className="mt-8 min-h-11 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird bestätigt …" : "Neue Adresse bestätigen"}
      </button>

      {fehler && (
        <p role="alert" className="mt-6 rounded-lg border border-credo-rot/40 bg-credo-rot/5 px-4 py-3 text-sm">
          {fehler}
        </p>
      )}
    </>
  );
}
