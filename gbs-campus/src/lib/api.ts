/**
 * GBS Campus — einheitliche Form der API-Antworten
 *
 * CLAUDE.md kennt genau zwei Formen: `{ data: T }` oder `{ error: string }`.
 * Vor dem Review gab es drei verschiedene Zusatzschlüssel für dieselbe Sache —
 * `felder`, `fehler` und `maengel` —, sodass jeder Client alle drei kennen
 * musste. Hier ist es einer: `details`.
 */

import { NextResponse } from "next/server";
import { SITZUNG_ABGELAUFEN } from "@/lib/api-client";

export type FehlerDetail = { feld?: string; meldung: string };

export function erfolg<T>(daten: T, status = 200) {
  return NextResponse.json({ data: daten }, { status });
}

export function fehler(meldung: string, status: number, details?: FehlerDetail[]) {
  return NextResponse.json(details ? { error: meldung, details } : { error: meldung }, { status });
}

/** 403 mit einheitlichem Text. */
export function keineBerechtigung() {
  return fehler("Keine Berechtigung.", 403);
}

/**
 * 401 — angemeldet sein wäre nötig (keine oder keine gültige Sitzung mehr).
 * Der Client leitet NICHT selbst um: Eine Umleitung würfe ungespeicherte
 * Eingaben weg. Er zeigt die Meldung, und man meldet sich in einem zweiten Tab
 * neu an.
 */
export function nichtAngemeldet() {
  return fehler(SITZUNG_ABGELAUFEN, 401);
}

/**
 * Für `switch` über die Fehlercodes eines Fachmoduls: Steht hier ein Wert, den
 * kein `case` behandelt, meldet es schon der Compiler. Vorher stand an dieser
 * Stelle ein `default` mit 500 — ein neuer Fehlercode lief still dort hinein.
 */
export function nieErreicht(wert: never): never {
  throw new Error(`Unbehandelter Fall: ${String(wert)}`);
}

/**
 * Führt die Arbeit einer Route aus und fängt unerwartete Fehler ab
 * (Datenbank weg, Deadlock, Programmfehler). Ohne das endete so ein Fehler als
 * Framework-500 ohne JSON — der Client zeigte „Der Server hat unerwartet
 * geantwortet", und im Log stand kein Präfix, nach dem man suchen könnte.
 *
 * `meldung` ist der deutsche Satz für die Oberfläche, etwa „Die Noten konnten
 * nicht gespeichert werden."; ins Log geht er mit dem Präfix `[tag]`.
 */
export async function mitFehlerbehandlung(
  tag: string,
  meldung: string,
  arbeit: () => Promise<Response>,
): Promise<Response> {
  try {
    return await arbeit();
  } catch (f) {
    console.error(`[${tag}] ${meldung}`, f);
    return fehler(`${meldung} Bitte versuchen Sie es später noch einmal.`, 500);
  }
}

/** Erwartet der Aufrufer eine Seite (Klick im Browser) statt JSON (fetch, curl)? */
function erwartetHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function htmlMaskiert(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Fehlerantwort für Download-Routen (PDF, Excel), die über einen Link geöffnet
 * werden. Der Browser zeigt die Antwort dort als eigene Seite — mit `fehler()`
 * stand dann rohes JSON wie {"error":"…"} im Fenster, bei abgelaufener Sitzung
 * sogar im Normalfall.
 *
 *  - Klick im Browser (Accept: text/html): 401 leitet zur Anmeldung (303, mit
 *    relativer Adresse — hinter dem Proxy kennt die Anwendung ihre äußere
 *    Adresse nicht sicher), jeder andere Fehler bekommt eine kleine deutsche
 *    Fehlerseite mit demselben Statuscode.
 *  - Alle anderen (fetch, curl, Durchstich) bekommen wie bisher `{ error }`.
 */
export function downloadFehler(request: Request, meldung: string, status: number): Response {
  if (!erwartetHtml(request)) return fehler(meldung, status);
  if (status === 401) {
    return new NextResponse(null, { status: 303, headers: { Location: "/anmelden", "Cache-Control": "no-store" } });
  }
  // Systemfarben (Canvas/CanvasText) statt fester Werte: Die Seite folgt so dem
  // hellen oder dunklen Modus des Browsers, ohne das Stylesheet der App zu laden.
  const seite = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Download nicht möglich · GBS Campus</title>
<style>
body { font-family: system-ui, sans-serif; background: Canvas; color: CanvasText; margin: 0; }
main { max-width: 36rem; margin: 6rem auto; padding: 0 1.5rem; line-height: 1.5; }
h1 { font-size: 1.5rem; }
a { color: LinkText; }
</style>
</head>
<body>
<main>
<h1>Der Download hat nicht geklappt</h1>
<p>${htmlMaskiert(meldung)}</p>
<p><a href="/verwaltung">Zurück zum Portal</a></p>
</main>
</body>
</html>`;
  return new NextResponse(seite, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Wandelt eine fertige Fehlerantwort von `fehler()` — etwa aus `pruefeZugriff`
 * — in die Download-Form um (siehe `downloadFehler`).
 */
export async function alsDownloadFehler(request: Request, antwort: Response): Promise<Response> {
  if (!erwartetHtml(request)) return antwort;
  const inhalt = (await antwort.json().catch(() => ({}))) as { error?: string };
  return downloadFehler(request, inhalt.error ?? "Das hat nicht geklappt.", antwort.status);
}
