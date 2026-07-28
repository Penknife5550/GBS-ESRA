/**
 * GBS Campus — Herkunft einer Anfrage ermitteln
 *
 * Hinter dem Reverse Proxy ist die TCP-Gegenstelle immer der Proxy-Container.
 * Wer die falsche Adresse protokolliert, hat ein Consent-Protokoll, das als
 * Nachweis nichts taugt, und ein Rate-Limit, das den eigenen Proxy aussperrt
 * statt den Angreifer (1_Bauplan.html Kap. 08, Fallstrick 2).
 *
 * WICHTIG — warum nicht der erste Eintrag aus X-Forwarded-For:
 * Traefik haengt die tatsaechliche Gegenstelle HINTEN an einen bereits
 * vorhandenen Header an. Schickt ein Angreifer selbst ein
 * "X-Forwarded-For: 1.2.3.4", steht danach "1.2.3.4, <echte IP>" darin.
 * Der linke Eintrag ist also frei waehlbar, der rechte nicht. Bei genau einem
 * vertrauenswuerdigen Proxy ist der RECHTE Eintrag der richtige.
 *
 * X-Real-Ip setzt Traefik selbst und ueberschreibt dabei einen mitgeschickten
 * Wert — deshalb hat dieser Header Vorrang.
 */

export type RequestKontext = {
  ipAdresse: string | null;
  userAgent: string | null;
};

export function ermittleRequestKontext(headers: Headers): RequestKontext {
  return {
    ipAdresse: ermittleIp(headers),
    userAgent: headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}

function ermittleIp(headers: Headers): string | null {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const eintraege = forwarded
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    // Rechtester Eintrag — siehe Kommentar oben.
    if (eintraege.length > 0) return eintraege[eintraege.length - 1];
  }

  return null;
}
