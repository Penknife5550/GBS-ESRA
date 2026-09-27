/**
 * GBS Campus — Prüfung der Umgebungsvariablen
 *
 * Vor dem Review gab es keine Startprüfung. Die Folgen waren still und schwer
 * zu finden:
 *
 *  - Ein fehlendes oder zu kurzes `SESSION_SECRET` sperrte alle aus, war aber
 *    von einer abgelaufenen Sitzung nicht zu unterscheiden — der Fehler wurde
 *    in `angemeldetePersonId()` gefangen und als „nicht angemeldet" ausgelegt.
 *  - Ein fehlender `ENCRYPTION_KEY` fiel erst mitten in der Anmelde-Transaktion
 *    auf, also nachdem jemand das ganze Formular ausgefüllt hatte.
 *  - Eine fehlende `APP_URL` erzeugte Magic-Links auf `localhost` — die eigene
 *    `.env.example` nennt das zu Recht „einen Totalausfall des Logins".
 *  - Der Healthcheck meldete dabei durchgehend „ok", weil er nur `SELECT 1`
 *    prüfte.
 *
 * Deshalb: beim Start laut scheitern, und im Healthcheck sichtbar machen.
 * Ausgegeben wird immer nur „gesetzt" oder „fehlt", nie ein Wert.
 */

import { erwarteterOrigin } from "@/lib/herkunft";

type Pflichtpruefung = {
  name: string;
  pruefe: (wert: string | undefined) => string | null;
};

const PFLICHT: Pflichtpruefung[] = [
  {
    name: "DATABASE_URL",
    pruefe: (w) => (w ? null : "fehlt"),
  },
  {
    name: "SESSION_SECRET",
    pruefe: (w) => (!w ? "fehlt" : w.length < 32 ? "zu kurz (mindestens 32 Zeichen)" : null),
  },
  {
    name: "ENCRYPTION_KEY",
    pruefe: (w) =>
      !w ? "fehlt" : !/^[0-9a-fA-F]{64}$/.test(w) ? "muss aus genau 64 Hex-Zeichen bestehen" : null,
  },
  {
    name: "APP_URL",
    pruefe: (w) =>
      pruefeAppUrl(w, { produktion: process.env.NODE_ENV === "production", appDomain: process.env.APP_DOMAIN }),
  },
];

/**
 * Prüft APP_URL. Eigene Funktion statt Einzeiler in PFLICHT, damit
 * scripts/pruefe-herkunft.ts die Regeln ohne Eingriff in process.env prüfen kann.
 *
 * Seit der Herkunftsprüfung (lib/herkunft.ts) hängt an APP_URL mehr als die
 * Adresse in den Anmeldelinks: Jede schreibende Anfrage aus dem Browser muss
 * genau ihre Herkunft tragen. Zwei Fälle kamen vorher durch den Start und
 * sperrten danach jede Änderung (Code-Review 4):
 *
 *  - Eine Adresse ohne Host wie „https://" besteht den Schema-Test, ergibt aber
 *    keine Herkunft — die Middleware wies dann jede Änderung als
 *    `app-url-ungueltig` ab, obwohl der Start „vollständig" meldete.
 *  - APP_DOMAIN (Traefik-Regel `Host(...)` in docker-compose.yml) und APP_URL
 *    sind getrennte Variablen. Laufen sie auseinander, liefert Traefik das
 *    Portal unter APP_DOMAIN aus, die Herkunftsprüfung erwartet aber APP_URL.
 *    Verglichen wird nur in Produktion und nur, wenn APP_DOMAIN gesetzt ist:
 *    Ohne Traefik (npm run dev, Durchstich) spielt APP_DOMAIN keine Rolle. Und
 *    nur der Hostname, ohne Port — so vergleicht auch Traefik.
 *  - Unter denselben Bedingungen (Produktion hinter Traefik) muss das Schema
 *    https sein: Die Traefik-Route kennt nur `websecure`, Port 80 leitet auf
 *    https um. Browser schicken deshalb immer `https://APP_DOMAIN` als Herkunft
 *    — mit APP_URL=http://… wiese die Middleware jede Änderung ab, auch die
 *    Anmeldung selbst. Den Port prüft der Start nicht (hängt an der
 *    Port-Zuordnung in docker-compose.yml).
 */
export function pruefeAppUrl(
  wert: string | undefined,
  umgebung: { produktion: boolean; appDomain: string | undefined },
): string | null {
  if (!wert) return "fehlt";
  if (!/^https?:\/\//.test(wert)) return "muss mit http:// oder https:// beginnen";
  if (erwarteterOrigin(wert) === null) {
    return "ist keine vollständige Adresse (Schema und Host, etwa https://gbs.fes-credo.de)";
  }
  if (umgebung.produktion && wert.includes("localhost")) {
    return "zeigt auf localhost — dann gehen alle Anmeldelinks ins Leere";
  }
  const domain = umgebung.appDomain?.trim().toLowerCase();
  if (umgebung.produktion && domain && new URL(wert).protocol !== "https:") {
    return "muss mit https:// beginnen — hinter Traefik ist das Portal nur über https erreichbar, sonst wird jede Änderung abgewiesen";
  }
  if (umgebung.produktion && domain && new URL(wert).hostname !== domain) {
    return "passt nicht zu APP_DOMAIN — der Host muss derselbe sein, sonst wird jede Änderung im Portal abgewiesen";
  }
  return null;
}

export type Konfigurationsbefund = { name: string; problem: string };

export function pruefeKonfiguration(): Konfigurationsbefund[] {
  return PFLICHT.flatMap((p) => {
    const problem = p.pruefe(process.env[p.name]);
    return problem ? [{ name: p.name, problem }] : [];
  });
}

/**
 * SMTP wird getrennt behandelt: Ohne SMTP läuft die Anwendung im
 * Entwicklungsmodus (Mails gehen in die Konsole). In Produktion ist es dagegen
 * ein Ausfall des einzigen Login-Wegs — deshalb meldet der Healthcheck das,
 * auch wenn der Start gelingt.
 */
export function smtpKonfiguriert(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_ABSENDER_ADRESSE);
}

/**
 * Der Cron-Endpunkt der Semesterüberleitung (`/api/cron/erinnerungen`) wird von
 * einem externen Zeitgeber (systemd-Timer, Cron, Uptime-Ping) mit dem Header
 * `x-cron-secret` aufgerufen. Ohne gesetztes `CRON_SECRET` weist der Endpunkt
 * jeden Aufruf mit 503 ab — sonst liefe er entweder ungeschützt oder still ins
 * Leere. Wie bei SMTP kein Fail-fast beim Start: Die Erinnerungen sind ein
 * Zusatz, kein Anmeldeweg. Mindestlänge 16, damit das Geheimnis nicht zu raten
 * ist.
 */
export function cronKonfiguriert(): boolean {
  return Boolean(process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16);
}

/**
 * Passwort des rechtebeschränkten Anwendungsnutzers `gbs_app` (Opt-in, geprüft
 * in `prisma/setup-app-nutzer.ts` vor dem Anlegen der Rolle). docker-compose
 * setzt es UNKODIERT in `APP_DATABASE_URL` ein. Ein `/`, `+`, `@`, `:`, `#` oder
 * `%` (etwa aus `openssl rand -base64`) zerlegt diese URL: Das Setup legte die
 * Rolle trotzdem an, der Entrypoint schaltete um, und der Server stand ohne
 * DB-Zugriff da — Login, Anmeldung und Healthcheck fielen aus, obwohl der Start
 * sauber aussah. Deshalb nur Buchstaben und Ziffern, und bei allem anderen
 * scheitert der Start laut. Liefert das Problem oder null, wenn es taugt.
 */
export function pruefeAppDbPasswort(passwort: string): string | null {
  if (passwort.length < 16) return "ist zu kurz (mindestens 16 Zeichen)";
  if (!/^[A-Za-z0-9]+$/.test(passwort)) {
    return "darf nur Buchstaben und Ziffern enthalten (steht unkodiert in der Verbindungs-URL)";
  }
  return null;
}

/**
 * Postfach des Dokumentenmanagements, an das der Honorarsatz-Beleg geht. Wie bei
 * SMTP kein Fail-fast beim Start: Ist die Adresse nicht gesetzt, wird der Beleg
 * trotzdem erzeugt und die Genehmigung protokolliert — nur die Zustellung
 * unterbleibt und bleibt als offener Versand sichtbar. Die Honorar-Abrechnung
 * ist kein Anmeldeweg und darf den Start nicht blockieren.
 */
export function dmsAdresse(): string | null {
  const wert = process.env.DMS_EMAIL?.trim();
  return wert ? wert : null;
}
