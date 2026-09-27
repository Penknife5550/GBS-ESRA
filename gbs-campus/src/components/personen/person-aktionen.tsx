"use client";

/**
 * GBS Campus — Kopfleiste und Aktionen der Personen-Detailakte
 *
 * Oberflächenplan 09/2026 („Lesen wie eine Visitenkarte, ändern auf
 * Knopfdruck“): Die Akte zeigt zuerst den Stand, kein Formular steht offen.
 * Oben rechts „Bearbeiten“ (Stammdaten im Blatt) und das Menü „…“ für Seltenes
 * und Folgenreiches — Anmeldelink senden, Anmeldeadresse ändern, Status ändern
 * (Ausbildungsdaten & Status im Blatt), Rollen, Datenauskunft und ganz unten,
 * rot und abgesetzt, Anonymisieren. Vorher stand all das als Knopfreihe
 * „Verwaltung dieser Person“ mitten in der Akte, Anonymisieren rot im Alltag.
 *
 * Dieselben APIs, dasselbe `sendeAnfrage`+`router.refresh()`-Muster, dieselben
 * Rückfragen und Meldungen wie vorher; sichtbar ist nur, wofür das Konto das
 * Recht hat. Eine gelungene Aktion schließt ihr Blatt und meldet sich oben auf
 * der Seite, ein Fehler bleibt im Blatt neben dem Knopf.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { ADMIN_ROLLE, entziehtAdmin, rollenDiff } from "@/lib/benutzerverwaltung";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { Menue, type MenuePunkt } from "@/components/ui/menue";
import { Seitenkopf } from "@/components/ui/seitenkopf";
import { AusbildungStatus, type AusbildungStatusDaten } from "./ausbildung-status";

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

type BlattArt = "stammdaten" | "email" | "rollen" | "status";
type Laeuft = null | "email" | "link" | "auskunft" | "anonym" | "rollen" | "stammdaten";

const feld = "min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm";
// Eigener Auslöser für „…“: Im Standard von `Menue` gewinnt am Rechner `lg:px-3.5`
// aus `knopf()` gegen `lg:px-0`, und das Symbol wird auf wenige Pixel gequetscht.
const menueKnopf =
  "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-input bg-muted text-foreground " +
  "transition-colors hover:bg-feld lg:h-9 lg:w-9";
const hinweis = "mt-3 text-[13px] text-muted-foreground";

export function PersonAktionen({
  person,
  darfAendern,
  darfAuskunft,
  darfAnonymisieren,
  darfRollenVerwalten,
  alleRollen,
  istEigeneAkte,
  ausbildung,
}: {
  person: PersonAktionenDaten;
  darfAendern: boolean;
  darfAuskunft: boolean;
  darfAnonymisieren: boolean;
  darfRollenVerwalten: boolean;
  alleRollen: Rolle[];
  /** Die Akte des Bedienenden selbst — für die Warnung beim Entzug der eigenen Rechte. */
  istEigeneAkte: boolean;
  /** Ausbildungsdaten & Status (nur Schulleitung, nicht bei Anonymisierten) — sonst null. */
  ausbildung: AusbildungStatusDaten | null;
}) {
  const router = useRouter();
  const formId = useId();
  const [blatt, setBlatt] = useState<BlattArt | null>(null);
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
  // Welche Aktion gerade läuft (oder null) — währenddessen sind die übrigen gesperrt.
  const [laeuft, setLaeuft] = useState<Laeuft>(null);
  const beschaeftigt = laeuft !== null;
  // Oben auf der Seite: Ergebnis der Aktionen. Im offenen Blatt: dessen Fehler.
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [blattMeldung, setBlattMeldung] = useState<Meldung | null>(null);
  // Öffnet „Status ändern …“ jedes Mal frisch (ohne Reste einer abgebrochenen Eingabe).
  const [statusRunde, setStatusRunde] = useState(0);

  // Nach dem Schließen eines Blatts zurück zu seinem Auslöser: „Bearbeiten“ bzw.
  // der „…“-Knopf (die Menüeinträge gibt es dann nicht mehr, und nicht jeder
  // Browser fokussiert einen angeklickten Knopf — der Fokus fiele sonst auf die Seite).
  const bearbeitenRef = useRef<HTMLButtonElement>(null);
  const menueRef = useRef<HTMLDivElement>(null);
  const zuletzt = useRef<BlattArt | null>(null);
  useEffect(() => {
    if (blatt) {
      zuletzt.current = blatt;
      return;
    }
    if (zuletzt.current === "stammdaten") bearbeitenRef.current?.focus();
    else if (zuletzt.current) menueRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus();
    zuletzt.current = null;
  }, [blatt]);

  // Derselbe Diff wie auf dem Server (`/api/personen/[id]/rollen`) — Grundlage
  // für den Knopf und für die Rückfrage.
  const diff = rollenDiff(gewaehlt, person.rollenCodes);
  const rollenGeaendert = diff.hinzu.length > 0 || diff.weg.length > 0;

  function oeffne(art: BlattArt) {
    setMeldung(null);
    setBlattMeldung(null);
    if (art === "stammdaten") {
      setStamm({
        vorname: person.vorname,
        nachname: person.nachname,
        telefon: person.telefon,
        strasse: person.strasse,
        plz: person.plz,
        ort: person.ort,
      });
    }
    if (art === "email") setNeueEmail("");
    if (art === "rollen") setGewaehlt(person.rollenCodes);
    if (art === "status") setStatusRunde((n) => n + 1);
    setBlatt(art);
  }

  function schliessen() {
    setBlatt(null);
    setBlattMeldung(null);
  }

  /** Gelungen: Blatt zu, Meldung oben, Seite neu laden (lädt der Aufrufer schon, `neuLaden = false`). */
  function erledigt(text: string, neuLaden = true) {
    setBlatt(null);
    setBlattMeldung(null);
    setMeldung({ art: "ok", text });
    if (neuLaden) router.refresh();
  }

  async function adresseAendern() {
    if (
      !confirm(
        `Die Anmeldeadresse von ${person.name} wirklich auf ${neueEmail.trim()} ändern?\n\n` +
          "Ab dann läuft der Zugang über diese Adresse. Ein gesetztes Passwort sowie alle offenen " +
          "Anmelde- und Auskunftslinks werden dabei entwertet.\n\n" +
          "Bitte vorher sicherstellen, dass die Person wirklich die ist, für die sie sich ausgibt.",
      )
    ) {
      return;
    }
    setLaeuft("email");
    setBlattMeldung(null);
    const antwort = await sendeAnfrage<{ email: string; mailGesendet: boolean; passwortEntfernt: boolean }>(
      `/api/personen/${person.id}/email`,
      { methode: "PUT", rumpf: { email: neueEmail } },
    );
    setLaeuft(null);
    if (!antwort.ok) {
      setBlattMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setNeueEmail("");
    erledigt(
      (antwort.daten.mailGesendet
        ? "Adresse geändert. Alte und neue Adresse wurden benachrichtigt."
        : "Adresse geändert. Die Benachrichtigung konnte aber nicht zugestellt werden — die Ursache sieht der " +
          "Administrator im Versandprotokoll (Verwaltung → Betrieb).") +
        (antwort.daten.passwortEntfernt ? " Ein gesetztes Passwort wurde dabei entfernt." : ""),
    );
  }

  async function anmeldelinkSchicken() {
    setLaeuft("link");
    setMeldung(null);
    const antwort = await sendeAnfrage<{ empfaenger: string; gesendet: boolean }>(
      `/api/personen/${person.id}/anmeldelink`,
      { methode: "POST" },
    );
    setLaeuft(null);
    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    // Der Server meldet den echten Ausgang des Versands — „verschickt" steht nur
    // da, wenn der Mailserver die Nachricht angenommen hat.
    setMeldung(
      antwort.daten.gesendet
        ? { art: "ok", text: `Anmeldelink an ${antwort.daten.empfaenger} verschickt.` }
        : {
            art: "fehler",
            // Die Betriebsansicht verlangt SYSTEM_EINSTELLUNGEN — das hat nur der
            // Administrator, nicht wer diesen Knopf bedient.
            text:
              `Der Anmeldelink an ${antwort.daten.empfaenger} konnte nicht zugestellt werden — die Ursache ` +
              "sieht der Administrator im Versandprotokoll (Verwaltung → Betrieb).",
          },
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
        : "Der Auskunft-Link konnte nicht zugestellt werden — die Ursache sieht der Administrator im " +
          "Versandprotokoll (Verwaltung → Betrieb).",
    });
  }

  async function anonymisieren() {
    if (
      !confirm(
        `${person.name} wirklich unwiderruflich anonymisieren (Löschung nach Art. 17 DSGVO)?\n\n` +
          "Alle personenbezogenen Daten werden überschrieben: Name, E-Mail, Telefon, Adresse, " +
          "Geburtsdatum, Gemeinde, IBAN, die Anmelde-Antworten sowie Name und Geburtsdatum auf " +
          "ausgestellten Zeugnissen. Offene Anmeldungen werden geschlossen, Rollen entzogen, der " +
          "Zugang erlischt.\n\n" +
          "Als Nachweis erhalten bleiben — ohne Personenbezug — das Protokoll, die Einwilligungen und " +
          "die Zeugnisse (Beleg-Nr. und Fächer).\n\n" +
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
    setBlattMeldung(null);
    setGewaehlt((r) => (r.includes(code) ? r.filter((c) => c !== code) : [...r, code]));
  }

  async function rollenSpeichern() {
    // Nichts geändert — keine Anfrage (der Knopf ist dann ohnehin gesperrt).
    if (!rollenGeaendert) return;
    const bezeichnung = (code: string) => alleRollen.find((r) => r.code === code)?.bezeichnung ?? code;
    const zeilen = [
      diff.weg.length > 0 ? `Entzogen: ${diff.weg.map(bezeichnung).join(", ")}` : null,
      diff.hinzu.length > 0 ? `Hinzu: ${diff.hinzu.map(bezeichnung).join(", ")}` : null,
    ].filter(Boolean);
    const selbstWarnung =
      istEigeneAkte && entziehtAdmin(diff)
        ? `\n\nAchtung: Das ist Ihr eigenes Konto. Ohne die Rolle „${bezeichnung(ADMIN_ROLLE)}“ kommen Sie danach ` +
          "nicht mehr an Konten und Rollen — zurückgeben kann sie Ihnen nur ein anderer Administrator."
        : istEigeneAkte
          ? "\n\nDas ist Ihr eigenes Konto — die Änderung wirkt sofort."
          : "";
    if (!confirm(`Rollen von ${person.name} ändern?\n\n${zeilen.join("\n")}${selbstWarnung}`)) return;

    setLaeuft("rollen");
    setBlattMeldung(null);
    const antwort = await sendeAnfrage<{ geaendert: boolean }>(`/api/personen/${person.id}/rollen`, {
      methode: "PUT",
      rumpf: { rollen: gewaehlt },
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setBlattMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    erledigt("Rollen gespeichert.");
  }

  async function stammdatenSpeichern() {
    if (beschaeftigt || stamm.vorname.trim() === "" || stamm.nachname.trim() === "") return;
    setLaeuft("stammdaten");
    setBlattMeldung(null);
    const antwort = await sendeAnfrage<{ gespeichert: boolean }>(`/api/personen/${person.id}/stammdaten`, {
      methode: "PUT",
      rumpf: stamm,
    });
    setLaeuft(null);
    if (!antwort.ok) {
      setBlattMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    erledigt("Stammdaten gespeichert.");
  }

  // Das Menü „…“: nur Einträge, für die das Konto das Recht hat (wie vorher die Knöpfe).
  const punkte: MenuePunkt[] = [];
  if (darfAendern && !person.istTerminal) {
    punkte.push({ text: "Anmeldelink senden", icon: "senden", aktion: anmeldelinkSchicken, deaktiviert: beschaeftigt });
  }
  if (darfAendern && !person.istAnonym) {
    punkte.push({ text: "Anmeldeadresse ändern", icon: "adresse", aktion: () => oeffne("email"), deaktiviert: beschaeftigt });
  }
  if (ausbildung) {
    punkte.push({ text: "Status ändern …", icon: "wechseln", aktion: () => oeffne("status"), deaktiviert: beschaeftigt });
  }
  if (darfRollenVerwalten && !person.istAnonym) {
    punkte.push({ text: "Rollen …", icon: "einstellungen", aktion: () => oeffne("rollen"), deaktiviert: beschaeftigt });
  }
  if (darfAuskunft && !person.istAnonym) {
    punkte.push({ text: "Datenauskunft senden", icon: "datei-herunter", aktion: auskunftSenden, deaktiviert: beschaeftigt });
  }
  // Unumkehrbar — deshalb ganz unten, rot und durch eine Linie von den Alltagsaktionen getrennt.
  if (darfAnonymisieren && !person.istAnonym) {
    punkte.push({
      text: "Anonymisieren …",
      icon: "person-entfernen",
      aktion: anonymisieren,
      gefahr: true,
      trenner: punkte.length > 0,
      deaktiviert: beschaeftigt,
    });
  }
  const darfStammdaten = darfAendern && !person.istAnonym;

  const laeuftText =
    laeuft === "link"
      ? "Anmeldelink wird gesendet …"
      : laeuft === "auskunft"
        ? "Auskunft wird angestoßen …"
        : laeuft === "anonym"
          ? "Wird anonymisiert …"
          : "";

  const abbrechen = (
    <button type="button" onClick={schliessen} className={knopf("sekundaer")}>
      Abbrechen
    </button>
  );

  return (
    <>
      <Seitenkopf
        zurueck={{ href: "/verwaltung/personen", text: "Personen" }}
        aktionen={
          darfStammdaten || punkte.length > 0 ? (
            // Auch am Handy rechtsbündig: Das Menü „…“ öffnet sich zum Knopf hin nach
            // links und bliebe links ausgerichtet teilweise außerhalb des Bildschirms.
            <div className="ml-auto flex items-center gap-2">
              <span role="status" className={laeuftText ? "text-[13px] text-muted-foreground" : "sr-only"}>
                {laeuftText}
              </span>
              {darfStammdaten && (
                <button
                  ref={bearbeitenRef}
                  type="button"
                  onClick={() => oeffne("stammdaten")}
                  disabled={beschaeftigt}
                  className={knopf("sekundaer")}
                >
                  Bearbeiten
                </button>
              )}
              {punkte.length > 0 && (
                <div ref={menueRef}>
                  <Menue punkte={punkte} label="Weitere Aktionen" ausloeserKlasse={menueKnopf} />
                </div>
              )}
            </div>
          ) : undefined
        }
      />
      {/* Die Meldung der letzten Aktion; leer bleibt nur die (unsichtbare) Live-Region. */}
      <div className={meldung || (blatt === null && blattMeldung) ? "px-4 pt-4 sm:px-6 lg:px-8" : ""}>
        {/* Endet eine Anfrage erst nach dem Schließen ihres Blatts, erscheint ihr Fehler hier. */}
        <MeldungsBox meldung={meldung ?? (blatt === null ? blattMeldung : null)} className="max-w-3xl break-words" />
      </div>

      {darfStammdaten && (
        <Blatt
          offen={blatt === "stammdaten"}
          onSchliessen={schliessen}
          titel="Stammdaten"
          fuss={
            <>
              {abbrechen}
              <button
                type="submit"
                form={`${formId}-stamm`}
                disabled={beschaeftigt || stamm.vorname.trim() === "" || stamm.nachname.trim() === ""}
                className={knopf("primaer")}
              >
                {laeuft === "stammdaten" ? "Wird gespeichert …" : "Speichern"}
              </button>
            </>
          }
        >
          <form
            id={`${formId}-stamm`}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void stammdatenSpeichern();
            }}
          >
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
              ).map(([name, label]) => (
                <div key={name}>
                  <label htmlFor={`${name}-${person.id}`} className="mb-1.5 block text-sm font-medium">
                    {label}
                  </label>
                  <input
                    id={`${name}-${person.id}`}
                    value={stamm[name]}
                    onChange={(e) => {
                      setStamm((s) => ({ ...s, [name]: e.target.value }));
                      setBlattMeldung(null);
                    }}
                    className={feld}
                  />
                </div>
              ))}
            </div>
            <p className={hinweis}>
              E-Mail-Adresse und Bankverbindung laufen über eigene Wege. Geburtsdatum, Gemeinde, Teilnahmeform und
              Status ändert die Schulleitung im Menü „…“ unter „Status ändern …“.
            </p>
            <MeldungsBox meldung={blatt === "stammdaten" ? blattMeldung : null} className="mt-3 break-words" />
          </form>
        </Blatt>
      )}

      {darfStammdaten && (
        <Blatt
          offen={blatt === "email"}
          onSchliessen={schliessen}
          titel="Anmeldeadresse ändern"
          fuss={
            <>
              {abbrechen}
              <button
                type="submit"
                form={`${formId}-adresse`}
                disabled={beschaeftigt || neueEmail.trim().length === 0}
                className={knopf("primaer")}
              >
                {laeuft === "email" ? "Wird geändert …" : "Adresse ändern"}
              </button>
            </>
          }
        >
          <form
            id={`${formId}-adresse`}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!beschaeftigt && neueEmail.trim().length > 0) void adresseAendern();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Bisher: <span className="break-all text-foreground">{person.email}</span>
            </p>
            <label htmlFor={`email-${person.id}`} className="mb-1.5 mt-4 block text-sm font-medium">
              Neue Anmeldeadresse
            </label>
            <input
              id={`email-${person.id}`}
              name="email"
              type="email"
              value={neueEmail}
              onChange={(e) => {
                setNeueEmail(e.target.value);
                setBlattMeldung(null);
              }}
              className={feld}
            />
            <p className={hinweis}>
              Erst die Person erkennen — Anruf oder persönlich. Eine Meldung über das Hilfeformular allein reicht nicht:
              Dort kann jeder jeden Namen eintragen.
            </p>
            <MeldungsBox meldung={blatt === "email" ? blattMeldung : null} className="mt-3 break-words" />
          </form>
        </Blatt>
      )}

      {ausbildung && (
        <Blatt offen={blatt === "status"} onSchliessen={schliessen} titel="Status ändern">
          <AusbildungStatus key={statusRunde} {...ausbildung} onErfolg={(m) => erledigt(m.text, false)} />
        </Blatt>
      )}

      {darfRollenVerwalten && !person.istAnonym && (
        <Blatt
          offen={blatt === "rollen"}
          onSchliessen={schliessen}
          titel="Rollen"
          fuss={
            <>
              {abbrechen}
              <button
                type="button"
                onClick={rollenSpeichern}
                disabled={beschaeftigt || !rollenGeaendert}
                className={knopf("primaer")}
              >
                {laeuft === "rollen" ? "Wird gespeichert …" : "Rollen speichern"}
              </button>
            </>
          }
        >
          <fieldset>
            <legend className="text-sm font-medium">Rollen von {person.name}</legend>
            <div className="mt-2 divide-y divide-linie overflow-hidden rounded-xl border border-linie">
              {alleRollen.map((rolle) => (
                <label key={rolle.code} className="flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm hover:bg-muted/60">
                  <input
                    type="checkbox"
                    checked={gewaehlt.includes(rolle.code)}
                    onChange={() => rolleUmschalten(rolle.code)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  {rolle.bezeichnung}
                </label>
              ))}
            </div>
          </fieldset>
          <p className={hinweis}>
            Steuert, was das Konto darf. Der letzte Administrator lässt sich nicht entziehen — sonst käme niemand mehr
            an die Rollenverwaltung.
          </p>
          <MeldungsBox meldung={blatt === "rollen" ? blattMeldung : null} className="mt-3 break-words" />
        </Blatt>
      )}
    </>
  );
}
