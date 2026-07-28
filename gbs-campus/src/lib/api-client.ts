/**
 * GBS Campus — Anfragen aus dem Browser
 *
 * Warum es diesen Helfer gibt: Vor dem Review stand in jeder Client-Komponente
 * `const inhalt = await antwort.json()` ohne `try/catch`, und `setLaeuft(false)`
 * kam erst danach. Bei einem Netzwerkabbruch, einem 502 während eines Deploys
 * oder jedem 500 (Next liefert dann kein JSON) warf diese Zeile — der Knopf
 * blieb dauerhaft auf „Wird gesendet …", und es erschien **keine**
 * Fehlermeldung. Wer zehn Minuten am Anmeldeformular gesessen hatte, kam nicht
 * weiter und verlor beim Neuladen alles.
 *
 * Hier gibt es deshalb nur einen Rückgabeweg: ein Ergebnis, das entweder Daten
 * oder eine deutsche Meldung trägt. Geworfen wird nichts.
 */

const ZEITGRENZE_MS = 30_000;

export type AnfrageErgebnis<T> =
  | { ok: true; daten: T }
  | { ok: false; status: number; meldung: string; details?: FehlerDetail[] };

export type FehlerDetail = { feld?: string; meldung: string };

type Optionen = {
  methode?: "GET" | "POST" | "PUT" | "DELETE";
  rumpf?: unknown;
};

export async function sendeAnfrage<T>(pfad: string, optionen: Optionen = {}): Promise<AnfrageErgebnis<T>> {
  const { methode = "GET", rumpf } = optionen;

  let antwort: Response;
  try {
    antwort = await fetch(pfad, {
      method: methode,
      headers: rumpf ? { "Content-Type": "application/json" } : undefined,
      body: rumpf ? JSON.stringify(rumpf) : undefined,
      signal: AbortSignal.timeout(ZEITGRENZE_MS),
    });
  } catch (fehler) {
    const abgelaufen = fehler instanceof DOMException && fehler.name === "TimeoutError";
    return {
      ok: false,
      status: 0,
      meldung: abgelaufen
        ? "Der Server hat zu lange nicht geantwortet. Bitte versuche es noch einmal."
        : "Die Verbindung zum Server ist abgerissen. Bitte prüfe deine Internetverbindung und versuche es noch einmal.",
    };
  }

  // Auch das Auslesen kann scheitern: Bei einem 502 vom Reverse Proxy oder einer
  // Next.js-Fehlerseite kommt HTML zurück, kein JSON.
  let inhalt: unknown;
  try {
    inhalt = await antwort.json();
  } catch {
    return {
      ok: false,
      status: antwort.status,
      meldung:
        antwort.status >= 500
          ? "Auf dem Server ist ein Fehler aufgetreten. Bitte versuche es später noch einmal."
          : "Der Server hat unerwartet geantwortet. Bitte lade die Seite neu.",
    };
  }

  const objekt = (inhalt ?? {}) as { data?: T; error?: string; details?: FehlerDetail[] };

  if (!antwort.ok) {
    return {
      ok: false,
      status: antwort.status,
      meldung: objekt.error ?? "Das hat nicht geklappt.",
      details: objekt.details,
    };
  }

  return { ok: true, daten: objekt.data as T };
}
