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
    pruefe: (w) => {
      if (!w) return "fehlt";
      if (!/^https?:\/\//.test(w)) return "muss mit http:// oder https:// beginnen";
      if (process.env.NODE_ENV === "production" && w.includes("localhost")) {
        return "zeigt auf localhost — dann gehen alle Anmeldelinks ins Leere";
      }
      return null;
    },
  },
];

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
