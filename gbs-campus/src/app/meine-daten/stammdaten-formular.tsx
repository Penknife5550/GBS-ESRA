"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

export type StammdatenFelder = {
  telefon: string;
  strasse: string;
  plz: string;
  ort: string;
  kontoinhaber: string;
};

type Antwort = {
  gespeichert: boolean;
  geaendert: string[];
  mailGesendet: boolean | null;
  /** Hinweis an die eigene Adresse bei geänderter Bankverbindung; null = nichts zu melden. */
  hinweisGesendet: boolean | null;
};

/**
 * Selbstpflege der eigenen Stammdaten — seit dem Oberflächenplan 09/2026 in zwei
 * Blättern unter „Ich“: `teil="kontakt"` (Telefon und Adresse) und
 * `teil="bank"` (Kontoinhaber und IBAN). Jedes Blatt schickt nur seine Felder;
 * die Route lässt nicht mitgeschickte Felder unverändert („Teilangaben sind
 * erlaubt“, api/meine-daten/route.ts).
 *
 * Das IBAN-Feld ist absichtlich immer leer: Die hinterlegte Bankverbindung wird
 * nie im Klartext angezeigt. Leer lassen heißt deshalb „unverändert".
 */
export function StammdatenFormular({
  teil,
  vorbelegung,
  hatBankverbindung,
  istDozent = false,
}: {
  teil: "kontakt" | "bank";
  vorbelegung: StammdatenFelder;
  hatBankverbindung: boolean;
  /** Dozenten brauchen die IBAN für die Überweisung des Honorars, nicht für einen Lastschrifteinzug. */
  istDozent?: boolean;
}) {
  const router = useRouter();
  const [felder, setFelder] = useState<StammdatenFelder>(vorbelegung);
  const [iban, setIban] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [feldFehler, setFeldFehler] = useState<Record<string, string>>({});

  function aendere(feld: keyof StammdatenFelder, wert: string) {
    setFelder((bisher) => ({ ...bisher, [feld]: wert }));
    setMeldung(null);
    setFeldFehler((bisher) => {
      if (!(feld in bisher)) return bisher;
      const neu = { ...bisher };
      delete neu[feld];
      return neu;
    });
  }

  async function speichern(ereignis: React.FormEvent) {
    ereignis.preventDefault();
    setLaeuft(true);
    setMeldung(null);
    setFeldFehler({});

    const rumpf =
      teil === "kontakt"
        ? { telefon: felder.telefon, strasse: felder.strasse, plz: felder.plz, ort: felder.ort }
        : { kontoinhaber: felder.kontoinhaber, iban: iban.trim() || null };
    const antwort = await sendeAnfrage<Antwort>("/api/meine-daten", { methode: "PUT", rumpf });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      const zuordnung: Record<string, string> = {};
      for (const detail of antwort.details ?? []) {
        if (detail.feld) zuordnung[detail.feld] = detail.meldung;
      }
      setFeldFehler(zuordnung);
      // Zum ersten beanstandeten Feld springen, statt den Blick suchen zu lassen.
      const erstes = Object.keys(zuordnung)[0];
      if (erstes) document.getElementById(erstes)?.focus();
      return;
    }

    setIban("");
    const { geaendert, mailGesendet, hinweisGesendet } = antwort.daten;
    // Bei geänderter Bankverbindung geht zusätzlich ein Sicherheitshinweis an
    // die eigene Adresse — ob er zugestellt wurde, steht dabei.
    const hinweis =
      hinweisGesendet === true
        ? " Zur Sicherheit haben wir Ihnen einen Hinweis auf die geänderte Bankverbindung geschickt."
        : hinweisGesendet === false
          ? " Der Sicherheitshinweis an Ihre E-Mail-Adresse konnte aber nicht zugestellt werden — die Änderung gilt trotzdem."
          : "";
    // Die Verwaltung wird über jede Änderung informiert. Wenn die Mail nicht
    // rausging, darf hier nicht dasselbe stehen.
    setMeldung(
      geaendert.length === 0
        ? { art: "ok", text: "Es gab nichts zu ändern." }
        : mailGesendet === false
          ? {
              art: "warnung",
              text:
                `Gespeichert: ${geaendert.join(", ")}. Die Verwaltung konnte aber nicht benachrichtigt ` +
                "werden — bitte geben Sie der Schulleitung selbst Bescheid." +
                hinweis,
            }
          : {
              art: hinweisGesendet === false ? "warnung" : "ok",
              text: `Gespeichert: ${geaendert.join(", ")}. Die Verwaltung ist informiert.${hinweis}`,
            },
    );
    router.refresh();
  }

  return (
    <form onSubmit={speichern} className="flex flex-col gap-4">
      {teil === "kontakt" ? (
        <>
          <Feld
            name="telefon"
            label="Telefonnummer"
            typ="tel"
            autoComplete="tel"
            wert={felder.telefon}
            fehler={feldFehler.telefon}
            onAendern={(w) => aendere("telefon", w)}
          />
          <Feld
            name="strasse"
            label="Straße und Hausnummer"
            autoComplete="street-address"
            wert={felder.strasse}
            fehler={feldFehler.strasse}
            onAendern={(w) => aendere("strasse", w)}
          />
          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
            <Feld
              name="plz"
              label="Postleitzahl"
              autoComplete="postal-code"
              wert={felder.plz}
              fehler={feldFehler.plz}
              onAendern={(w) => aendere("plz", w)}
            />
            <Feld
              name="ort"
              label="Ort"
              autoComplete="address-level2"
              wert={felder.ort}
              fehler={feldFehler.ort}
              onAendern={(w) => aendere("ort", w)}
            />
          </div>
          <p className="text-[13px] text-muted-foreground">Die Verwaltung wird über jede Änderung informiert.</p>
        </>
      ) : (
        <>
          <Hinweis>
            {hatBankverbindung
              ? "Es ist eine Bankverbindung hinterlegt. Sie wird aus Sicherheitsgründen nicht angezeigt. Das Feld nur ausfüllen, wenn sich die IBAN geändert hat — leer lassen ändert nichts."
              : istDozent
                ? "Es ist noch keine Bankverbindung hinterlegt. Sie wird für die Überweisung des Dozentenhonorars benötigt."
                : "Es ist noch keine Bankverbindung hinterlegt. Der Semesterbeitrag wird per Lastschrift eingezogen."}
          </Hinweis>
          <Feld
            name="kontoinhaber"
            label="Kontoinhaber"
            autoComplete="name"
            wert={felder.kontoinhaber}
            fehler={feldFehler.kontoinhaber}
            onAendern={(w) => aendere("kontoinhaber", w)}
          />
          <Feld
            name="iban"
            label={hatBankverbindung ? "Neue IBAN" : "IBAN"}
            hinweis="Wird verschlüsselt gespeichert und ist nur für die Verwaltung einsehbar."
            wert={iban}
            fehler={feldFehler.iban}
            onAendern={(w) => {
              setIban(w);
              setMeldung(null);
            }}
          />
        </>
      )}

      <MeldungsBox meldung={meldung} />

      <button type="submit" disabled={laeuft} className={`${knopf("primaer")} w-full sm:w-auto sm:self-end`}>
        {laeuft ? "Speichert …" : "Änderungen speichern"}
      </button>
    </form>
  );
}

function Feld({
  name,
  label,
  wert,
  onAendern,
  typ = "text",
  hinweis,
  fehler,
  autoComplete,
}: {
  name: string;
  label: string;
  wert: string;
  onAendern: (wert: string) => void;
  typ?: "text" | "tel" | "email";
  hinweis?: string;
  fehler?: string;
  autoComplete?: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={typ}
        value={wert}
        autoComplete={autoComplete}
        onChange={(e) => onAendern(e.target.value)}
        aria-invalid={fehler ? true : undefined}
        aria-describedby={hinweis || fehler ? `${name}-hinweis` : undefined}
        className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
      />
      {(fehler || hinweis) && (
        <p id={`${name}-hinweis`} className={`mt-1 text-xs ${fehler ? "text-credo-rot" : "text-muted-foreground"}`}>
          {fehler ?? hinweis}
        </p>
      )}
    </div>
  );
}
