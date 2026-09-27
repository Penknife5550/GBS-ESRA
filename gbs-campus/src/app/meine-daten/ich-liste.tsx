"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { Hinweis } from "@/components/ui/hinweis";
import { Abschnitt, Gruppe, WertZeile, Zeile } from "@/components/ui/liste";
import { MeldungsBox } from "@/components/ui/meldung";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { EmailAendern, type OffenerEmailAntrag } from "./email-aendern";
import { PasswortAbschnitt } from "./passwort-abschnitt";
import { StammdatenFormular, type StammdatenFelder } from "./stammdaten-formular";

type Blattart = "kontakt" | "bank" | "email" | "passwort" | "angaben";

export type IchDaten = {
  kopf: { initialen: string; name: string; rolle: string; email: string };
  stammdaten: StammdatenFelder;
  hatBankverbindung: boolean;
  istDozent: boolean;
  offenerEmailAntrag: OffenerEmailAntrag | null;
  passwort: { hatPasswort: boolean; gesetztAm: string | null; mindestLaenge: number };
  /** Die Ausbildungsdaten zum Nachlesen; null für Konten ohne Ausbildung. */
  angaben: { bezeichnung: string; wert: string }[] | null;
  /** Dozenten oder Verwaltung mit eigener Teilnahme: Wege zu Übersicht und Abenden. */
  ausbildungsWege: boolean;
  darfBearbeiten: boolean;
};

/**
 * „Ich“ als gruppierte Liste wie in den iPhone-Einstellungen (Oberflächenplan
 * 09/2026, Vorlage b2-tn-ich): zuerst der Stand, bearbeitet wird im Blatt. Die
 * Formulare sind die bisherigen (Selbstpflege mit Meldung an die Verwaltung,
 * E-Mail-Wechsel mit Bestätigungslink, Passwort); die IBAN wird nie angezeigt.
 */
export function IchListe({ daten }: { daten: IchDaten }) {
  const [offen, setOffen] = useState<Blattart | null>(null);
  const [runde, setRunde] = useState(0);
  const zu = () => setOffen(null);
  const auf = (art: Blattart) => {
    setRunde((r) => r + 1);
    setOffen(art);
  };
  const { stammdaten: s, darfBearbeiten } = daten;
  const adresse = [s.strasse, s.ort].filter(Boolean).join(", ");
  const fehlt = <span className="text-dezent">fehlt</span>;
  const oeffnen = (art: Blattart) => (darfBearbeiten ? () => auf(art) : undefined);

  return (
    <div>
      <Gruppe>
        <div className="flex min-h-[72px] items-center gap-3 px-4 py-3">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-feld text-base font-semibold text-foreground"
          >
            {daten.kopf.initialen}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold text-foreground">{daten.kopf.name}</p>
            <p className="break-words text-[13px] text-muted-foreground">{`${daten.kopf.rolle} · ${daten.kopf.email}`}</p>
          </div>
        </div>
      </Gruppe>

      {!darfBearbeiten && (
        <Hinweis className="mt-4">Ihr Konto darf die eigenen Daten zurzeit nur ansehen.</Hinweis>
      )}

      <Abschnitt titel="Kontakt" className="mt-7" />
      <Gruppe>
        <ListenZeile label="Telefon" wert={s.telefon || fehlt} onOeffnen={oeffnen("kontakt")} />
        <ListenZeile label="Adresse" wert={adresse || fehlt} onOeffnen={oeffnen("kontakt")} />
      </Gruppe>

      <Abschnitt titel={daten.istDozent ? "Honorar" : "Beitrag"} className="mt-7" />
      <Gruppe>
        <ListenZeile
          label="Bankverbindung"
          wert={
            daten.hatBankverbindung ? (
              "hinterlegt"
            ) : (
              <StatusPunkt ton="gelb" className="text-[15px] text-muted-foreground lg:text-sm">
                fehlt noch
              </StatusPunkt>
            )
          }
          onOeffnen={oeffnen("bank")}
        />
      </Gruppe>

      <Abschnitt titel="Zugang" className="mt-7" />
      <Gruppe>
        <ListenZeile
          label="E-Mail-Adresse"
          wert={
            !darfBearbeiten ? (
              daten.kopf.email
            ) : daten.offenerEmailAntrag ? (
              <StatusPunkt ton="gelb" className="text-[15px] text-muted-foreground lg:text-sm">
                Bestätigung offen
              </StatusPunkt>
            ) : (
              "ändern"
            )
          }
          onOeffnen={oeffnen("email")}
        />
        <ListenZeile
          label="Passwort"
          wert={daten.passwort.hatPasswort ? "gesetzt" : "nicht gesetzt"}
          onOeffnen={oeffnen("passwort")}
        />
      </Gruppe>

      {daten.angaben && (
        <>
          <Abschnitt titel="Ausbildung" className="mt-7" />
          <Gruppe>
            <ListenZeile label="Meine Angaben" untertitel="Geburtsdatum, Gemeinde, Teilnahme" onOeffnen={() => auf("angaben")} />
            {daten.ausbildungsWege && (
              <>
                <Zeile href="/meine-daten" titel="Übersicht" untertitel="Anwesenheit, Noten und Zeugnisse" />
                <Zeile href="/meine-daten/abende" titel="Abende" untertitel="Alle Abende mit Selbstbestätigung" />
              </>
            )}
          </Gruppe>
        </>
      )}

      <Gruppe className="mt-7">
        <AbmeldenZeile />
      </Gruppe>

      {/* Die Blätter bleiben stehen und gehen nur auf und zu: So gibt der Browser
          beim Schließen den Fokus an die Zeile zurück. `runde` setzt die
          Formulare bei jedem Öffnen frisch auf (keine alte Meldung, keine halbe
          Eingabe von vorhin). */}
      {darfBearbeiten && (
        <>
          <Blatt offen={offen === "kontakt"} titel="Kontakt" onSchliessen={zu}>
            <StammdatenFormular
              key={`kontakt-${runde}`}
              teil="kontakt"
              vorbelegung={s}
              hatBankverbindung={daten.hatBankverbindung}
              istDozent={daten.istDozent}
            />
          </Blatt>
          <Blatt offen={offen === "bank"} titel="Bankverbindung" onSchliessen={zu}>
            <StammdatenFormular
              key={`bank-${runde}`}
              teil="bank"
              vorbelegung={s}
              hatBankverbindung={daten.hatBankverbindung}
              istDozent={daten.istDozent}
            />
          </Blatt>
          <Blatt offen={offen === "email"} titel="E-Mail-Adresse" onSchliessen={zu}>
            <EmailAendern key={`email-${runde}`} bisherige={daten.kopf.email} offenerAntrag={daten.offenerEmailAntrag} />
          </Blatt>
          <Blatt offen={offen === "passwort"} titel="Passwort" onSchliessen={zu}>
            <PasswortAbschnitt
              key={`passwort-${runde}`}
              hatPasswort={daten.passwort.hatPasswort}
              mindestLaenge={daten.passwort.mindestLaenge}
              gesetztAm={daten.passwort.gesetztAm}
            />
          </Blatt>
        </>
      )}
      {daten.angaben && (
        <Blatt offen={offen === "angaben"} titel="Meine Angaben" onSchliessen={zu}>
          <Gruppe>
            {daten.angaben.map((a) => (
              <WertZeile key={a.bezeichnung} label={a.bezeichnung}>
                {a.wert}
              </WertZeile>
            ))}
          </Gruppe>
          <Hinweis className="mt-4">
            Stimmt etwas nicht, wenden Sie sich bitte an die Schulleitung. Diese Angaben gehören zur Aufnahmeentscheidung
            und lassen sich deshalb nicht selbst ändern.
          </Hinweis>
        </Blatt>
      )}
    </div>
  );
}

/** Eine Zeile mit Beschriftung links und Wert rechts; öffnet ihr Blatt, wenn bearbeitet werden darf. */
function ListenZeile({
  label,
  wert,
  untertitel,
  onOeffnen,
}: {
  label: string;
  wert?: ReactNode;
  untertitel?: string;
  onOeffnen?: () => void;
}) {
  const inhalt = (
    <>
      <span className="min-w-0 shrink-0">
        <span className="block text-[15px] text-foreground lg:text-sm">{label}</span>
        {untertitel && <span className="block text-[13px] text-muted-foreground">{untertitel}</span>}
      </span>
      {wert !== undefined && (
        <span className="min-w-0 flex-1 truncate text-right text-[15px] text-muted-foreground lg:text-sm">{wert}</span>
      )}
    </>
  );
  const klassen = "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left";
  return onOeffnen ? (
    <button type="button" onClick={onOeffnen} className={`${klassen} hover:bg-muted/60 focus-visible:bg-muted/60`}>
      {inhalt}
      {wert === undefined && <span className="flex-1" />}
      <Icon name="weiter" className="h-4 w-4 shrink-0 text-dezent" />
    </button>
  ) : (
    <div className={klassen}>{inhalt}</div>
  );
}

/**
 * Abmelden — wie der Knopf im Profil erst, wenn der Server es bestätigt hat
 * (siehe `components/ui/abmelden-knopf.tsx`); sonst bliebe das Cookie gültig.
 */
function AbmeldenZeile() {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function abmelden() {
    setLaeuft(true);
    setFehler(null);
    const antwort = await sendeAnfrage("/api/auth/abmelden", { methode: "POST" });
    if (!antwort.ok) {
      setLaeuft(false);
      setFehler("Abmelden hat nicht geklappt — Sie sind auf diesem Gerät noch angemeldet. Bitte versuchen Sie es noch einmal.");
      return;
    }
    router.push("/anmelden");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={abmelden}
        disabled={laeuft}
        className="flex min-h-12 w-full items-center justify-center px-4 py-2.5 text-[15px] font-medium text-credo-rot hover:bg-credo-rot/5 disabled:opacity-60 lg:text-sm"
      >
        {laeuft ? "Wird abgemeldet …" : "Abmelden"}
      </button>
      <MeldungsBox meldung={fehler ? { art: "fehler", text: fehler } : null} className="m-3 mt-0" />
    </>
  );
}
