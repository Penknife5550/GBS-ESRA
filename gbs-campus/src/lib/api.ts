/**
 * GBS Campus — einheitliche Form der API-Antworten
 *
 * CLAUDE.md kennt genau zwei Formen: `{ data: T }` oder `{ error: string }`.
 * Vor dem Review gab es drei verschiedene Zusatzschlüssel für dieselbe Sache —
 * `felder`, `fehler` und `maengel` —, sodass jeder Client alle drei kennen
 * musste. Hier ist es einer: `details`.
 */

import { NextResponse } from "next/server";

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

/** 401 — angemeldet sein wäre nötig. Der Client leitet darauf zur Anmeldung. */
export function nichtAngemeldet() {
  return fehler("Bitte melde dich an.", 401);
}
