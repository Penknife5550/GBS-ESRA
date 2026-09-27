"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

const inputKlasse = "min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm";
const LEER = { vorname: "", nachname: "", email: "", telefon: "" };

/**
 * Legt von Hand eine Person an (Recht BENUTZER_VERWALTEN) — für Konten, die
 * nicht über die öffentliche Anmeldung entstehen (Dozenten, Mitarbeiter). Seit
 * dem Oberflächenplan 09/2026 als Knopf „Person“ oben rechts, das Formular im
 * Blatt über der Liste.
 */
export function PersonAnlegen() {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [felder, setFelder] = useState(LEER);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  // Nach dem Anlegen führt ein Link in die Akte — dort liegen Anmeldelink und Rollen.
  const [angelegt, setAngelegt] = useState<{ id: string; name: string } | null>(null);

  function setze(feld: keyof typeof felder, wert: string) {
    setFelder((f) => ({ ...f, [feld]: wert }));
    setMeldung(null);
  }

  function schliessen() {
    setOffen(false);
    setMeldung(null);
    setAngelegt(null);
  }

  async function anlegen() {
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<{ id: string }>("/api/personen", { methode: "POST", rumpf: felder });
    setLaeuft(false);
    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setAngelegt({ id: antwort.daten.id, name: `${felder.vorname.trim()} ${felder.nachname.trim()}` });
    setFelder(LEER);
    router.refresh();
  }

  const unvollstaendig = felder.vorname.trim() === "" || felder.nachname.trim() === "" || felder.email.trim() === "";

  return (
    <>
      <button type="button" onClick={() => setOffen(true)} className={knopf("primaer")}>
        <Icon name="plus" className="h-4 w-4" />
        Person
      </button>
      <Blatt
        offen={offen}
        onSchliessen={schliessen}
        titel="Person anlegen"
        fuss={
          angelegt ? (
            <>
              <button type="button" onClick={schliessen} className={knopf("sekundaer")}>
                Fertig
              </button>
              <Link href={`/verwaltung/personen/${angelegt.id}`} className={knopf("primaer")}>
                Akte öffnen
              </Link>
            </>
          ) : (
            <>
              <button type="button" onClick={schliessen} className={knopf("sekundaer")}>
                Abbrechen
              </button>
              <button type="submit" form="person-anlegen" disabled={laeuft || unvollstaendig} className={knopf("primaer")}>
                {laeuft ? "Wird angelegt …" : "Person anlegen"}
              </button>
            </>
          )
        }
      >
        {angelegt ? (
          <p role="status" className="rounded-lg bg-credo-gruen/10 px-3 py-2 text-sm text-foreground">
            {angelegt.name} ist angelegt. In der Akte schicken Sie den Anmeldelink und vergeben Rollen.
          </p>
        ) : (
          <form
            id="person-anlegen"
            onSubmit={(ereignis) => {
              ereignis.preventDefault();
              if (!laeuft && !unvollstaendig) void anlegen();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="anlegen-vorname" className="mb-1.5 block text-sm font-medium">
                  Vorname
                </label>
                <input id="anlegen-vorname" value={felder.vorname} onChange={(e) => setze("vorname", e.target.value)} className={inputKlasse} />
              </div>
              <div>
                <label htmlFor="anlegen-nachname" className="mb-1.5 block text-sm font-medium">
                  Nachname
                </label>
                <input id="anlegen-nachname" value={felder.nachname} onChange={(e) => setze("nachname", e.target.value)} className={inputKlasse} />
              </div>
              <div>
                <label htmlFor="anlegen-email" className="mb-1.5 block text-sm font-medium">
                  E-Mail-Adresse
                </label>
                <input
                  id="anlegen-email"
                  type="email"
                  value={felder.email}
                  onChange={(e) => setze("email", e.target.value)}
                  className={inputKlasse}
                />
              </div>
              <div>
                <label htmlFor="anlegen-telefon" className="mb-1.5 block text-sm font-medium">
                  Telefon <span className="text-muted-foreground">(optional)</span>
                </label>
                <input id="anlegen-telefon" value={felder.telefon} onChange={(e) => setze("telefon", e.target.value)} className={inputKlasse} />
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Die Person startet als aktives Konto mit der Rolle Teilnehmer. Den Anmeldelink schicken Sie in der Akte, sobald
              Sie die Person erkannt haben.
            </p>
            <MeldungsBox meldung={meldung} className="mt-3" />
          </form>
        )}
      </Blatt>
    </>
  );
}
