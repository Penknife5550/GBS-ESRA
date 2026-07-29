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
  istAnonym: boolean;
  rollen: string;
  rollenCodes: string[];
};

type Rolle = { code: string; bezeichnung: string };

export function PersonZeile({
  person,
  darfAendern,
  darfAuskunft,
  darfAnonymisieren,
  darfRollenVerwalten,
  alleRollen,
}: {
  person: PersonAnzeige;
  darfAendern: boolean;
  darfAuskunft: boolean;
  darfAnonymisieren: boolean;
  darfRollenVerwalten: boolean;
  alleRollen: Rolle[];
}) {
  const router = useRouter();
  const [modus, setModus] = useState<"ruhe" | "email" | "rollen">("ruhe");
  const [neueEmail, setNeueEmail] = useState("");
  const [gewaehlt, setGewaehlt] = useState<string[]>(person.rollenCodes);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

  const rollenGeaendert =
    gewaehlt.length !== person.rollenCodes.length ||
    [...gewaehlt].sort().join(",") !== [...person.rollenCodes].sort().join(",");

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

  async function auskunftSenden() {
    if (
      !confirm(
        `Eine Datenauskunft nach Art. 15 DSGVO für ${person.name} anstoßen?\n\n` +
          `An die hinterlegte Adresse ${person.email} geht ein persönlicher, 3 Tage gültiger Link, über den die Person ` +
          "ihre vollständigen Daten selbst als PDF herunterladen kann. Die Daten selbst werden NICHT per " +
          "E-Mail verschickt.",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ empfaenger: string; gesendet: boolean }>(
      `/api/personen/${person.id}/auskunft`,
      { methode: "POST" },
    );
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    setMeldung({
      art: "ok",
      text: antwort.daten.gesendet
        ? `Auskunft-Link an ${antwort.daten.empfaenger} verschickt. Der Link gilt 3 Tage.`
        : "Der Auskunft-Link konnte nicht zugestellt werden — siehe Verwaltung → Betrieb.",
    });
  }

  async function anonymisieren() {
    if (
      !confirm(
        `${person.name} wirklich unwiderruflich anonymisieren (Löschung nach Art. 17 DSGVO)?\n\n` +
          "Alle personenbezogenen Daten werden überschrieben: Name, E-Mail, Telefon, Adresse, " +
          "Geburtsdatum, Gemeinde, IBAN und die Anmelde-Antworten. Der Zugang erlischt.\n\n" +
          "Als Nachweis erhalten bleiben — ohne Personenbezug — das Protokoll und die Einwilligungen.\n\n" +
          "Das lässt sich NICHT rückgängig machen.",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<{ anmeldungen: number }>(`/api/personen/${person.id}/anonymisieren`, {
      methode: "POST",
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    setMeldung({ art: "ok", text: "Die Person wurde anonymisiert. Die personenbezogenen Daten sind gelöscht." });
    router.refresh();
  }

  function rolleUmschalten(code: string) {
    setMeldung(null);
    setGewaehlt((r) => (r.includes(code) ? r.filter((c) => c !== code) : [...r, code]));
  }

  async function rollenSpeichern() {
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ geaendert: boolean }>(`/api/personen/${person.id}/rollen`, {
      methode: "PUT",
      rumpf: { rollen: gewaehlt },
    });
    setLaeuft(false);
    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setModus("ruhe");
    setMeldung({ art: "ok", text: "Rollen gespeichert." });
    router.refresh();
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

      {darfAuskunft && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={auskunftSenden}
            disabled={laeuft}
            className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {laeuft ? "Läuft …" : "DSGVO-Auskunft senden"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Schickt der Person einen persönlichen Link, über den sie ihre gespeicherten Daten nach Art. 15
            DSGVO als PDF abrufen kann.
          </p>
        </div>
      )}

      {darfAnonymisieren && !person.istAnonym && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={anonymisieren}
            disabled={laeuft}
            className="min-h-11 rounded-lg border border-credo-rot/40 px-4 py-2 text-sm font-medium text-credo-rot hover:bg-credo-rot/5 disabled:opacity-60"
          >
            {laeuft ? "Läuft …" : "Anonymisieren (Art. 17 DSGVO)"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Löscht alle personenbezogenen Daten unwiderruflich. Protokoll und Einwilligungen bleiben ohne
            Personenbezug als Nachweis erhalten.
          </p>
        </div>
      )}

      {darfAnonymisieren && person.istAnonym && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          Diese Person ist anonymisiert (Art. 17 DSGVO). Die personenbezogenen Daten sind gelöscht.
        </p>
      )}

      {darfRollenVerwalten && !person.istAnonym && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => {
              setGewaehlt(person.rollenCodes);
              setModus(modus === "rollen" ? "ruhe" : "rollen");
              setMeldung(null);
            }}
            aria-expanded={modus === "rollen"}
            aria-controls={`rollen-${person.id}`}
            className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium"
          >
            {modus === "rollen" ? "Abbrechen" : "Rollen verwalten"}
          </button>

          {modus === "rollen" && (
            <div id={`rollen-${person.id}`} className="mt-3 rounded-lg border border-border bg-muted p-4">
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Rollen von {person.name}</legend>
                <div className="space-y-2">
                  {alleRollen.map((rolle) => (
                    <label key={rolle.code} className="flex items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={gewaehlt.includes(rolle.code)}
                        onChange={() => rolleUmschalten(rolle.code)}
                        className="h-4 w-4 rounded border-input"
                      />
                      {rolle.bezeichnung}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="mt-3 text-xs text-muted-foreground">
                Steuert, was das Konto darf. Der letzte Administrator lässt sich nicht entziehen — sonst
                käme niemand mehr an die Rollenverwaltung.
              </p>
              <button
                type="button"
                onClick={rollenSpeichern}
                disabled={laeuft || !rollenGeaendert}
                className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {laeuft ? "Wird gespeichert …" : "Rollen speichern"}
              </button>
            </div>
          )}
        </div>
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
