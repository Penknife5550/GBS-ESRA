"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Passwort setzen, ändern oder entfernen.
 *
 * Das bisherige Passwort wird nicht abgefragt — genau der Vergessensfall führt
 * hierher. Wer angemeldet ist, hat seinen Zugang bereits nachgewiesen. Die
 * Absicherung ist der Hinweis, der bei jeder Änderung an die hinterlegte
 * Adresse geht.
 */
export function PasswortAbschnitt({
  hatPasswort,
  mindestLaenge,
  gesetztAm,
}: {
  hatPasswort: boolean;
  mindestLaenge: number;
  gesetztAm: string | null;
}) {
  const router = useRouter();
  const [passwort, setPasswort] = useState("");
  const [wiederholung, setWiederholung] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "warnung" | "fehler"; text: string } | null>(null);

  const stimmtUeberein = passwort.length > 0 && passwort === wiederholung;

  async function speichern(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ gesetzt: boolean; neu: boolean; mailGesendet: boolean | null }>(
      "/api/meine-daten/passwort",
      { methode: "PUT", rumpf: { passwort } },
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      document.getElementById("neues-passwort")?.focus();
      return;
    }

    setPasswort("");
    setWiederholung("");

    const erledigt = antwort.daten.neu
      ? "Passwort gesetzt. Du kannst dich ab sofort auch ohne Anmeldelink anmelden."
      : "Passwort geändert.";

    // Der Hinweis an die hinterlegte Adresse ist die einzige Warnung, falls
    // jemand Fremdes das Passwort setzt. Bleibt er aus, muss das hier stehen.
    setMeldung(
      antwort.daten.mailGesendet === false
        ? {
            art: "warnung",
            text: `${erledigt} Der Sicherheitshinweis an deine E-Mail-Adresse konnte aber nicht zugestellt werden — die Änderung gilt trotzdem.`,
          }
        : { art: "ok", text: `${erledigt} Ein Hinweis ist an deine E-Mail-Adresse unterwegs.` },
    );
    router.refresh();
  }

  async function entfernen() {
    if (!confirm("Passwort wirklich entfernen? Danach kommst du nur noch über den Anmeldelink hinein.")) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ entfernt: boolean; mailGesendet: boolean | null }>(
      "/api/meine-daten/passwort",
      { methode: "DELETE" },
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    setMeldung(
      antwort.daten.mailGesendet === false
        ? {
            art: "warnung",
            text: "Passwort entfernt. Der Sicherheitshinweis an deine E-Mail-Adresse konnte aber nicht zugestellt werden. Der Anmeldelink bleibt dein Weg ins Portal.",
          }
        : { art: "ok", text: "Passwort entfernt. Der Anmeldelink bleibt dein Weg ins Portal." },
    );
    router.refresh();
  }

  return (
    <form onSubmit={speichern} className="rounded-lg border border-border bg-card p-5">
      <p className="max-w-prose text-sm text-muted-foreground">
        {hatPasswort
          ? `Du hast ein Passwort gesetzt${gesetztAm ? ` (zuletzt am ${gesetztAm})` : ""}. Damit kommst du auch dann hinein, wenn du gerade nicht an dein E-Mail-Postfach kommst.`
          : "Ein Passwort ist freiwillig. Es lohnt sich trotzdem: Ohne Passwort führt der einzige Weg ins Portal über dein E-Mail-Postfach — wer den Zugriff darauf verliert, kommt ohne Hilfe der Schulleitung nicht mehr hinein."}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="neues-passwort" className="block text-sm font-medium">
            {hatPasswort ? "Neues Passwort" : "Passwort"}
          </label>
          <input
            id="neues-passwort"
            name="neues-passwort"
            type="password"
            autoComplete="new-password"
            value={passwort}
            onChange={(e) => {
              setPasswort(e.target.value);
              setMeldung(null);
            }}
            aria-describedby="passwort-hinweis"
            className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
          />
          <p id="passwort-hinweis" className="mt-1 text-xs text-muted-foreground">
            Mindestens {mindestLaenge} Zeichen. Ein ganzer Satz ist leichter zu merken und sicherer als
            ein kurzes Kunstwort.
          </p>
        </div>

        <div>
          <label htmlFor="passwort-wiederholung" className="block text-sm font-medium">
            Wiederholung
          </label>
          <input
            id="passwort-wiederholung"
            name="passwort-wiederholung"
            type="password"
            autoComplete="new-password"
            value={wiederholung}
            onChange={(e) => {
              setWiederholung(e.target.value);
              setMeldung(null);
            }}
            aria-describedby="wiederholung-hinweis"
            className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
          />
          <p id="wiederholung-hinweis" className="mt-1 text-xs text-muted-foreground">
            {wiederholung.length > 0 && !stimmtUeberein
              ? "Die beiden Eingaben sind noch nicht gleich."
              : "Zur Sicherheit gegen Vertipper."}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={laeuft || !stimmtUeberein}
          className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {laeuft ? "Speichert …" : hatPasswort ? "Passwort ändern" : "Passwort setzen"}
        </button>

        {hatPasswort && (
          <button
            type="button"
            onClick={entfernen}
            disabled={laeuft}
            className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Passwort entfernen
          </button>
        )}
      </div>

      {/* Ein grauer Knopf ohne Begründung sieht aus wie ein Fehler im Portal. */}
      {!stimmtUeberein && (
        <p className="mt-2 max-w-prose text-xs text-muted-foreground">
          Der Knopf wird aktiv, sobald in beiden Feldern dasselbe Passwort steht — mindestens{" "}
          {mindestLaenge} Zeichen.
        </p>
      )}

      {meldung && (
        <p
          role={meldung.art === "fehler" ? "alert" : "status"}
          className={`mt-4 max-w-prose rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok"
              ? "bg-credo-gruen/10"
              : meldung.art === "warnung"
                ? "bg-credo-gelb/15"
                : "bg-credo-rot/10"
          }`}
        >
          {meldung.text}
        </p>
      )}
    </form>
  );
}
