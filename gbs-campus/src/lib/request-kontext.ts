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

/**
 * Schlüssel für eine Anschlussdrossel (`…_IP:<schlüssel>`): IPv4 unverändert,
 * IPv6 auf das /64-Netz gekürzt.
 *
 * Ein Anschluss bekommt vom Provider in aller Regel mindestens ein ganzes /64.
 * Ungekürzt hätte jeder Rechner dahinter 2^64 Adressen — und mit jeder neuen
 * Adresse ein frisches Kontingent; die Drossel je Anschluss wäre für IPv6
 * wirkungslos. Für Consent- und Audit-Nachweise bleibt die volle Adresse
 * (`ermittleRequestKontext`), gekürzt wird nur der Drosselschlüssel.
 *
 * Eine IPv4-gemappte Adresse (::ffff:1.2.3.4) zählt als IPv4. Was sich nicht als
 * Adresse lesen lässt, bleibt unverändert — lieber zu streng als gar nicht.
 */
export function drosselSchluesselFuerIp(ip: string): string {
  const roh = ip.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").split("%")[0];
  const gemappt = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(roh);
  if (gemappt) return gemappt[1];
  if (!roh.includes(":")) return roh;
  const gruppen = ipv6Gruppen(roh);
  if (!gruppen) return roh;
  return `${gruppen.slice(0, 4).join(":")}::/64`;
}

/** Die acht Gruppen einer IPv6-Adresse ohne führende Nullen, oder null. */
function ipv6Gruppen(adresse: string): string[] | null {
  let text = adresse;
  // Eingebettete IPv4 am Ende (z. B. 64:ff9b::1.2.3.4) in zwei Gruppen umrechnen.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const teile = text.split("::");
  if (teile.length > 2) return null;
  const links = teile[0] ? teile[0].split(":") : [];
  const rechts = teile.length === 2 && teile[1] ? teile[1].split(":") : [];
  const fehlend = 8 - links.length - rechts.length;
  if (teile.length === 1 ? fehlend !== 0 : fehlend < 1) return null;
  const alle = [...links, ...Array<string>(teile.length === 2 ? fehlend : 0).fill("0"), ...rechts];
  if (!alle.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return alle.map((g) => g.replace(/^0+(?=.)/, ""));
}
