# GBS Campus — Deploy auf den CREDO-Server (hinter Caddy)

Gleiches Muster wie das HR-Portal: Der Stack bringt **keinen eigenen Reverse Proxy** mit. TLS und
Weiterleitung macht der bereits laufende Caddy; er erreicht die App über das externe Docker-Netz
`reverse_proxy` unter dem Namen `gbs-app:3000`.

| Datei | Zweck |
|---|---|
| `docker-compose.yml` | Standard: app · worker · db · backup, hinter Caddy |
| `Caddyfile.gbs-campus` | Block für das Caddyfile des Servers |
| `docker-compose.traefik.yml` | Nur für einen Server **ohne** Caddy (eigener Traefik auf 80/443) |

> Warum die alte Compose-Datei nicht lief: Sie startet einen eigenen Traefik auf Port 80/443, und
> genau diese Ports belegt auf dem Server schon Caddy.

## 1. Voraussetzungen (einmalig)

- DNS: `gbs.fes-credo.de` zeigt auf den Server.
- Das Netz `reverse_proxy` existiert schon (HR-Portal). Sonst: `docker network create reverse_proxy`
- Der Caddy-Container hängt am Netz `reverse_proxy`.

## 2. Code holen

```bash
git clone https://github.com/Penknife5550/GBS-ESRA.git
cd GBS-ESRA/gbs-campus
```

Alle weiteren Befehle laufen im Ordner `gbs-campus`.

## 3. `.env` anlegen

```bash
cp .env.example .env
```

Die Geheimnisse erzeugen und in die `.env` eintragen (Passwörter **nur** hex, keine Sonderzeichen):

```bash
echo "DB_PASSWORD=$(openssl rand -hex 24)"
echo "APP_DB_PASSWORD=$(openssl rand -hex 24)"
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "CRON_SECRET=$(openssl rand -hex 24)"
```

Außerdem setzen: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`,
`MAIL_ANTWORT_AN`, `DMS_EMAIL`. `APP_DOMAIN=gbs.fes-credo.de` und `APP_URL=https://gbs.fes-credo.de`
sind schon richtig. `ACME_EMAIL` bleibt leer (Caddy holt die Zertifikate selbst).

**Der `ENCRYPTION_KEY` muss sofort in den Notfall-Tresor.** Ohne ihn ist jedes Backup wertlos.

## 4. Starten

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Der Build führt zuerst alle Prüfungen aus (rund 1350). Ist eine davon rot, entsteht kein Image. Beim
Start spielt die App die Migrationen ein, richtet den DB-Nutzer `gbs_app` ein und setzt die
Grunddaten. Fertig ist der Start, wenn im Log `[START] Konfiguration vollständig.` steht und
`gbs-app` den Zustand `healthy` hat.

## 5. Caddy einhängen

Den Inhalt von `Caddyfile.gbs-campus` in das Caddyfile des Servers übernehmen (neben den Block
`hr.fes-credo.de`). Danach Caddy neu laden:

```bash
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

**Die Zeile `header_up X-Real-IP {remote_host}` darf nicht fehlen.** Die App liest die IP des
Besuchers aus diesem Header. Ohne die Zeile ließe sich die IP fälschen, und damit wären der Schutz
gegen Massenanmeldungen und das Einwilligungs-Protokoll ausgehebelt.

Prüfen:

```bash
curl -s https://gbs.fes-credo.de/api/health
```

Erwartet: `{"data":{"status":"ok","datenbank":"erreichbar","smtp":"konfiguriert"}}`

## 6. Erstes Admin-Konto anlegen

Auf einem frischen Server gibt es noch niemanden, der sich anmelden kann. E-Mail und Namen anpassen:

```bash
docker exec -i gbs-db psql -U gbs -d gbs_campus -v ON_ERROR_STOP=1 \
  -v email="vorname.nachname@example.de" -v vorname="Vorname" -v nachname="Nachname" <<'EOF'
INSERT INTO personen (id, vorname, nachname, email, "statusCode", "erstelltAm", "aktualisiertAm")
VALUES (gen_random_uuid(), :'vorname', :'nachname', lower(:'email'), 'AKTIV', now(), now())
ON CONFLICT (email) DO NOTHING;
INSERT INTO person_rolle ("personId", "rolleCode", "erteiltAm")
SELECT id, 'ADMIN', now() FROM personen WHERE email = lower(:'email')
ON CONFLICT DO NOTHING;
EOF
```

Danach auf `https://gbs.fes-credo.de` mit dieser Adresse den Anmeldelink anfordern. Alle weiteren
Konten legt man in der Oberfläche an (Benutzerverwaltung).

## 7. Updates einspielen

```bash
git pull
docker compose up -d --build
```

Die Daten liegen im Volume `gbs-campus_pgdata`. Der Projektname ist in der Compose-Datei fest auf
`gbs-campus` gesetzt, deshalb bleibt der Volume-Name gleich, auch wenn der Ordner anders heißt.
**Nie `docker compose down -v` ausführen**, das löscht die Datenbank.

## Backups

Der Dienst `backup` schreibt beim Start und jede Nacht um 02:30 Uhr einen Dump nach
`gbs-campus/backups/` auf dem Host, so wie es das HR-Portal macht. Eine Kopie außer Haus fehlt
noch: Ein Backup auf demselben Server überlebt einen Ausfall des Servers nicht.
