"use client";

/**
 * GBS Campus — Verwaltungs-Aktionen auf der Personen-Detailakte
 *
 * Bündelt die Aktionen, die vorher in der aufklappbaren Listenzeile
 * (`person-zeile.tsx`) saßen: Anmeldeadresse ändern, Stammdaten bearbeiten,
 * Anmeldelink schicken, DSGVO-Auskunft anstoßen, anonymisieren und Rollen
 * verwalten. Dieselben APIs, dasselbe `sendeAnfrage`+`router.refresh()`-Muster,
 * dieselben Bestätigungsdialoge — nur jetzt an EINEM Ort (der Akte) statt in jeder
 * Listenzeile.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Rolle = { code: string; bezeichnung: string };

export type PersonAktionenDaten = {
  id: string;
  name: string;
  vorname: string;
  nachname: string;
  telefon: string;
  strasse: string;
  plz: string;
  ort: string;
  email: string;
  status: string;
  istTerminal: boolean;
  istAnonym: boolean;
  rollenCodes: string[];
};

export function PersonAktionen({
  person,
  darfAendern,
  darfAuskunft,
  darfAnonymisieren,
  darfRollenVerwalten,
  alleRollen,
}: {
  person: PersonAktionenDaten;
  darfAendern: boolean;
  darfAuskunft: boolean;
  darfAnonymisieren: boolean;
  darfRollenVerwalten: boolean;
  alleRollen: Rolle[];
}) {
  const router = useRouter();
  const [modus, setModus] = useState<"ruhe" | "email" | "rollen" | "stammdaten">("ruhe");
  const [neueEmail, setNeueEmail] = useState("");
  const [gewaehlt, setGewaehlt] = useState<string[]>(person.rollenCodes);
  const [stamm, setStamm] = useState({
    vorname: person.vorname,
    nachname: person.nachname,
    telefon: person.telefon,
    strasse: person.strasse,
    plz: person.plz,
    ort: person.ort,
  });
  // Welche Aktion gerade läuft (oder null). Ein gemeinsames Flag ließe sonst alle
  // Buttons zugleich „Läuft …" zeigen; so ist nur der aktive betroffen, und die
  // Umschalter werden währenddessen gesperrt.
  const [laeuft, setLaeuft] = useState<null | "email" | "link" | "auskunft" | "anonym" | "rollen" | "stammdaten">(null);
  const beschaeftigt = laeuft !== null;
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
    setLaeuft("email");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ email: string; mailGesendet: boolean; passwortEntfernt: boolean }>(
      `/api/personen/${person.id}/email`,
      { methode: "PUT", rumpf: { email: neueEmail } },
    );
    setLaeuft(null);
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
    setLaeuft("link");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ empfaenger: string }>(`/api/personen/${person.id}/anmeldelink`, {
      methode: "POST",
    });
    setLaeuft(null);
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
    setLaeuft("auskunft");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ empfaenger: string; gesendet: boolean }>(
      `/api/personen/${person.id}/auskunft`,
      { methode: "POST" },
    );
    setLaeuft(null);
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
    setLaeuft("anonym");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ anmeldungen: number }>(`/api/personen/${person.id}/anonymisieren`, {
      methode: "POST",
    });
    setLaeuft(null);
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
    setLaeuft("rollen");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ geaendert: boolean }>(`/api/personen/${person.id}/rollen`, {
      methode: "PUT",
      rumpf: { rollen: gewaehlt },
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setModus("ruhe");
    setMeldung({ art: "ok", text: "Rollen gespeichert." });
    router.refresh();
  }

  async function stammdatenSpeichern() {
    setLaeuft("stammdaten");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ gespeichert: boolean }>(`/api/personen/${person.id}/stammdaten`, {
      methode: "PUT",
      rumpf: stamm,
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setModus("ruhe");
    setMeldung({ art: "ok", text: "Stammdaten gespeichert." });
    router.refresh();
  }

  const knopf = "min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium";
  const primaer = "min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60";

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Verwaltung dieser Person</h2>

      <div className="mt-3 flex flex-wrap gap-3">
        {darfAendern && (
          <button
            type="button"
            onClick={() => {
              setModus(modus === "email" ? "ruhe" : "email");
              setMeldung(null);
            }}
            aria-expanded={modus === "email"}
            aria-controls={`adresse-${person.id}`}
            disabled={beschaeftigt}
            className={`${knopf} disabled:opacity-60`}
          >
            {modus === "email" ? "Abbrechen" : "Anmeldeadresse ändern"}
          </button>
        )}
        {darfAendern && !person.istAnonym && (
          <button
            type="button"
            onClick={() => {
              setStamm({
                vorname: person.vorname,
                nachname: person.nachname,
                telefon: person.telefon,
                strasse: person.strasse,
                plz: person.plz,
                ort: person.ort,
              });
              setModus(modus === "stammdaten" ? "ruhe" : "stammdaten");
              setMeldung(null);
            }}
            aria-expanded={modus === "stammdaten"}
            aria-controls={`stammdaten-${person.id}`}
            disabled={beschaeftigt}
            className={`${knopf} disabled:opacity-60`}
          >
            {modus === "stammdaten" ? "Abbrechen" : "Stammdaten bearbeiten"}
          </button>
        )}
        {darfAendern && !person.istTerminal && (
          <button type="button" onClick={anmeldelinkSchicken} disabled={beschaeftigt} className={primaer}>
            {laeuft === "link" ? "Läuft …" : "Anmeldelink schicken"}
          </button>
        )}
        {darfAuskunft && (
          <button type="button" onClick={auskunftSenden} disabled={beschaeftigt} className={`${knopf} disabled:opacity-60`}>
            {laeuft === "auskunft" ? "Läuft …" : "DSGVO-Auskunft senden"}
          </button>
        )}
        {darfRollenVerwalten && !person.istAnonym && (
          <button
            type="button"
            onClick={() => {
              setGewaehlt(person.rollenCodes);
              setModus(modus === "rollen" ? "ruhe" : "rollen");
              setMeldung(null);
            }}
            aria-expanded={modus === "rollen"}
            aria-controls={`rollen-${person.id}`}
            disabled={beschaeftigt}
            className={`${knopf} disabled:opacity-60`}
          >
            {modus === "rollen" ? "Abbrechen" : "Rollen verwalten"}
          </button>
        )}
        {darfAnonymisieren && !person.istAnonym && (
          <button
            type="button"
            onClick={anonymisieren}
            disabled={beschaeftigt}
            className="min-h-11 rounded-lg border border-credo-rot/40 px-4 py-2 text-sm font-medium text-credo-rot hover:bg-credo-rot/5 disabled:opacity-60"
          >
            {laeuft === "anonym" ? "Läuft …" : "Anonymisieren (Art. 17 DSGVO)"}
          </button>
        )}
      </div>

      {person.istTerminal && darfAendern && (
        <p className="mt-3 text-xs text-muted-foreground">
          Status „{person.status}" — für dieses Konto wird kein Anmeldelink verschickt.
        </p>
      )}
      {person.istAnonym && (
        <p className="mt-3 text-xs text-muted-foreground">
          Diese Person ist anonymisiert (Art. 17 DSGVO). Die personenbezogenen Daten sind gelöscht.
        </p>
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
            disabled={beschaeftigt || neueEmail.trim().length === 0}
            className={`mt-3 ${primaer}`}
          >
            {laeuft === "email" ? "Wird geändert …" : "Adresse ändern"}
          </button>
        </div>
      )}

      {modus === "stammdaten" && (
        <div id={`stammdaten-${person.id}`} className="mt-4 rounded-lg border border-border bg-muted p-4">
          <p className="mb-3 text-sm font-medium">Stammdaten von {person.name}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["vorname", "Vorname"],
                ["nachname", "Nachname"],
                ["telefon", "Telefon"],
                ["strasse", "Straße"],
                ["plz", "PLZ"],
                ["ort", "Ort"],
              ] as const
            ).map(([feld, label]) => (
              <div key={feld}>
                <label htmlFor={`${feld}-${person.id}`} className="mb-1.5 block text-sm font-medium">
                  {label}
                </label>
                <input
                  id={`${feld}-${person.id}`}
                  value={stamm[feld]}
                  onChange={(e) => {
                    setStamm((s) => ({ ...s, [feld]: e.target.value }));
                    setMeldung(null);
                  }}
                  className="min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            E-Mail-Adresse und Bankverbindung laufen über eigene Wege; Geburtsdatum, Gemeinde und Status
            ändert die Schulleitung an anderer Stelle.
          </p>
          <button
            type="button"
            onClick={stammdatenSpeichern}
            disabled={beschaeftigt || stamm.vorname.trim() === "" || stamm.nachname.trim() === ""}
            className={`mt-3 ${primaer}`}
          >
            {laeuft === "stammdaten" ? "Wird gespeichert …" : "Stammdaten speichern"}
          </button>
        </div>
      )}

      {modus === "rollen" && darfRollenVerwalten && (
        <div id={`rollen-${person.id}`} className="mt-4 rounded-lg border border-border bg-muted p-4">
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
            Steuert, was das Konto darf. Der letzte Administrator lässt sich nicht entziehen — sonst käme
            niemand mehr an die Rollenverwaltung.
          </p>
          <button type="button" onClick={rollenSpeichern} disabled={beschaeftigt || !rollenGeaendert} className={`mt-3 ${primaer}`}>
            {laeuft === "rollen" ? "Wird gespeichert …" : "Rollen speichern"}
          </button>
        </div>
      )}

      {darfAuskunft && (
        <p className="mt-3 text-xs text-muted-foreground">
          Die DSGVO-Auskunft schickt der Person einen persönlichen Link, über den sie ihre gespeicherten Daten
          nach Art. 15 DSGVO als PDF abrufen kann.
        </p>
      )}

      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-3 break-words rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"
          }`}
        >
          {meldung.text}
        </p>
      )}
    </div>
  );
}
