"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

export type PersonAnzeige = {
  id: string;
  name: string;
  email: string;
  status: string;
  istTerminal: boolean;
  rollen: string;
};

export function PersonZeile({ person, darfAendern }: { person: PersonAnzeige; darfAendern: boolean }) {
  const router = useRouter();
  const [modus, setModus] = useState<"ruhe" | "email">("ruhe");
  const [neueEmail, setNeueEmail] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

  async function adresseAendern() {
    if (
      !confirm(
        `Die Anmeldeadresse von ${person.name} wirklich auf ${neueEmail.trim()} ändern?\n\n` +
          "Ab dann läuft der Zugang über diese Adresse. Ein gesetztes Passwort und alle offenen " +
          "Anmeldelinks werden dabei entwertet.\n\n" +
          "Bitte vorher sicherstellen, dass die Person wirklich die ist, für die sie sich ausgibt.",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ email: string; mailGesendet: boolean; passwortEntfernt: boolean }>(
      `/api/personen/${person.id}/email`,
      { methode: "PUT", rumpf: { email: neueEmail } },
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    setModus("ruhe");
    setNeueEmail("");
    setMeldung({
      art: "ok",
      text:
        (antwort.daten.mailGesendet
          ? "Adresse geändert. Alte und neue Adresse wurden benachrichtigt."
          : "Adresse geändert. Die Benachrichtigung konnte aber nicht zugestellt werden — siehe Verwaltung → Betrieb.") +
        (antwort.daten.passwortEntfernt ? " Ein gesetztes Passwort wurde dabei entfernt." : ""),
    });
    router.refresh();
  }

  async function anmeldelinkSchicken() {
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ empfaenger: string }>(`/api/personen/${person.id}/anmeldelink`, {
      methode: "POST",
    });
    setLaeuft(false);

    setMeldung(
      antwort.ok
        ? { art: "ok", text: `Anmeldelink an ${antwort.daten.empfaenger} verschickt.` }
        : { art: "fehler", text: antwort.meldung },
    );
  }

  return (
    <li className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{person.name}</p>
          <p className="break-all text-sm text-muted-foreground">{person.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {person.status}
            {person.rollen && ` · ${person.rollen}`}
          </p>
        </div>
      </div>

      {darfAendern && (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setModus(modus === "email" ? "ruhe" : "email")}
              aria-expanded={modus === "email"}
              aria-controls={`adresse-${person.id}`}
              className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium"
            >
              {modus === "email" ? "Abbrechen" : "Anmeldeadresse ändern"}
            </button>
            {/* Bei einem Endstatus wird kein Link mehr verschickt. Ein dauerhaft
                grauer Knopf sagt das niemandem — der Satz sagt es. */}
            {!person.istTerminal && (
              <button
                type="button"
                onClick={anmeldelinkSchicken}
                disabled={laeuft}
                className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {laeuft ? "Läuft …" : "Anmeldelink schicken"}
              </button>
            )}
          </div>

          {person.istTerminal && (
            <p className="mt-3 text-xs text-muted-foreground">
              Status „{person.status}" — für dieses Konto wird kein Anmeldelink verschickt.
            </p>
          )}
        </>
      )}

      {modus === "email" && (
        <div id={`adresse-${person.id}`} className="mt-4 rounded-lg border border-border bg-muted p-4">
          <label htmlFor={`email-${person.id}`} className="mb-1.5 block text-sm font-medium">
            Neue Anmeldeadresse
          </label>
          <input
            id={`email-${person.id}`}
            name="email"
            type="email"
            value={neueEmail}
            onChange={(e) => {
              setNeueEmail(e.target.value);
              setMeldung(null);
            }}
            className="min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Erst die Person erkennen — Anruf oder persönlich. Eine Meldung über das Hilfeformular allein
            reicht nicht: Dort kann jeder jeden Namen eintragen.
          </p>
          <button
            type="button"
            onClick={adresseAendern}
            disabled={laeuft || neueEmail.trim().length === 0}
            className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {laeuft ? "Wird geändert …" : "Adresse ändern"}
          </button>
        </div>
      )}

      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-3 break-all rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"
          }`}
        >
          {meldung.text}
        </p>
      )}
    </li>
  );
}
