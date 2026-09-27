"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

const inputKlasse = "min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm";

/** Legt von Hand eine Person an (Recht BENUTZER_VERWALTEN) — für Konten, die
 * nicht über die öffentliche Anmeldung entstehen (Dozenten, Mitarbeiter). */
export function PersonAnlegen() {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [felder, setFelder] = useState({ vorname: "", nachname: "", email: "", telefon: "" });
  const [laeuft, setLaeuft] = useState(false);
  // `akteId`: Nach dem Anlegen führt ein Link in die Akte — dort liegen seit dem
  // Redesign Anmeldelink und Rollen, nicht mehr in der Liste.
  const [meldung, setMeldung] = useState<(Meldung & { akteId?: string }) | null>(null);

  function setze(feld: keyof typeof felder, wert: string) {
    setFelder((f) => ({ ...f, [feld]: wert }));
    setMeldung(null);
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
    setMeldung({
      art: "ok",
      text: `${felder.vorname} ${felder.nachname} wurde angelegt. In der Akte der Person können Sie den Anmeldelink schicken und Rollen vergeben.`,
      akteId: antwort.daten.id,
    });
    setFelder({ vorname: "", nachname: "", email: "", telefon: "" });
    setOffen(false);
    router.refresh();
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => {
          setOffen(!offen);
          setMeldung(null);
        }}
        aria-expanded={offen}
        aria-controls="person-anlegen"
        className="min-h-11 rounded-lg border border-border px-4 py-2 text-sm font-medium"
      >
        {offen ? "Abbrechen" : "Person anlegen"}
      </button>

      {offen && (
        <div id="person-anlegen" className="mt-3 rounded-lg border border-border bg-muted p-4">
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
              <input id="anlegen-email" type="email" value={felder.email} onChange={(e) => setze("email", e.target.value)} className={inputKlasse} />
            </div>
            <div>
              <label htmlFor="anlegen-telefon" className="mb-1.5 block text-sm font-medium">
                Telefon <span className="text-muted-foreground">(optional)</span>
              </label>
              <input id="anlegen-telefon" value={felder.telefon} onChange={(e) => setze("telefon", e.target.value)} className={inputKlasse} />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Die Person startet als aktives Konto mit der Rolle Teilnehmer. Der Anmeldelink wird nicht
            automatisch verschickt — das machen Sie in der Akte der Person, sobald Sie sie erkannt haben.
          </p>
          <button
            type="button"
            onClick={anlegen}
            disabled={laeuft || felder.vorname.trim() === "" || felder.nachname.trim() === "" || felder.email.trim() === ""}
            className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {laeuft ? "Wird angelegt …" : "Person anlegen"}
          </button>
        </div>
      )}

      <MeldungsBox meldung={meldung} className="mt-3">
        {meldung?.akteId && (
          <>
            {" "}
            <Link href={`/verwaltung/personen/${meldung.akteId}`} className="font-medium underline underline-offset-4">
              Akte öffnen
            </Link>
          </>
        )}
      </MeldungsBox>
    </div>
  );
}
