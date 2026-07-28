#!/bin/sh
# =============================================================================
# GBS Campus — naechtliches Backup
#
# Laeuft im postgres:16-alpine-Image, also unter BusyBox ash. Das ist der Grund
# fuer mehrere Eigenheiten hier:
#
#  - KEINE date-Arithmetik. Weder GNU (`date -d "tomorrow"`) noch BSD
#    (`date -v+1d`) funktionieren unter BusyBox. Eine fruehere Fassung nutzte
#    beides mit Fallback — beide schlugen fehl, `set -e` brach ab, und der
#    Container lief mit `restart: unless-stopped` in eine stille Endlos-Schleife,
#    ohne je ein Backup zu erzeugen. Deshalb wird die Wartezeit hier von Hand
#    aus Stunden/Minuten/Sekunden gerechnet.
#
#  - `set -o pipefail`. Ohne das prueft `if pg_dump | gzip` nur den Status von
#    gzip. Ein abgebrochener Dump nimmt dann den Erfolgszweig, hinterlaesst ein
#    gueltiges aber abgeschnittenes Archiv — und die Rotation loescht daraufhin
#    die letzten intakten Staende.
#
#  - Erst in eine .tmp-Datei schreiben, mit `gzip -t` pruefen, dann umbenennen
#    und erst dann rotieren. Ein halb geschriebener Dump darf nie wie ein
#    fertiger aussehen.
#
# WICHTIG: Ein Backup ohne getesteten Restore ist kein Backup. Der Restore-Drill
# gehoert vierteljaehrlich in den Betriebskalender. Und ohne den ENCRYPTION_KEY
# aus dem Notfall-Tresor sind die IBAN-Felder in diesem Dump nicht
# wiederherstellbar.
#
# OFFEN: Der Off-Site-Transfer fehlt noch. Ein Backup auf demselben Host
# ueberlebt genau die Ausfaelle nicht, gegen die es schuetzen soll.
# =============================================================================
set -e
set -o pipefail

ZIEL=/backups
mkdir -p "$ZIEL"

# Aufbewahrung pruefen: ein leerer oder unsinniger Wert aus der .env wuerde
# `find -mtime` scheitern lassen und mit set -e den Container toeten.
AUFBEWAHRUNG_TAGE="${BACKUP_AUFBEWAHRUNG_TAGE:-60}"
case "$AUFBEWAHRUNG_TAGE" in
  ''|*[!0-9]*)
    echo "[Backup] BACKUP_AUFBEWAHRUNG_TAGE='$AUFBEWAHRUNG_TAGE' ist keine Zahl, nutze 60." >&2
    AUFBEWAHRUNG_TAGE=60
    ;;
esac

# Zielzeit 02:30 — bewusst nicht 00:00, damit der Lauf nicht mit Datumsgrenzen
# und Fristenlogik zusammenfaellt.
ZIEL_STUNDE=2
ZIEL_MINUTE=30

# Fuehrende Nullen entfernen: "09" waere in der Shell-Arithmetik eine ungueltige
# Oktalzahl und wuerde das Skript abbrechen lassen.
ohne_null() {
  wert="${1#0}"
  echo "${wert:-0}"
}

sekunden_bis_zielzeit() {
  jetzt=$(( $(ohne_null "$(date +%H)") * 3600 + $(ohne_null "$(date +%M)") * 60 + $(ohne_null "$(date +%S)") ))
  ziel=$(( ZIEL_STUNDE * 3600 + ZIEL_MINUTE * 60 ))
  rest=$(( ziel - jetzt ))
  [ "$rest" -le 0 ] && rest=$(( rest + 86400 ))
  echo "$rest"
}

erzeuge_backup() {
  datei="$ZIEL/gbs_campus_$(date +%Y-%m-%d_%H%M).sql.gz"
  tmp="$datei.tmp"

  echo "[Backup] Erzeuge $datei"

  if ! pg_dump -h db -U gbs -d gbs_campus | gzip > "$tmp"; then
    echo "[Backup] FEHLGESCHLAGEN — pg_dump oder gzip brach ab. Nichts wurde rotiert." >&2
    rm -f "$tmp"
    return 1
  fi

  # Gegenprobe: ein abgeschnittenes Archiv faellt hier auf, nicht erst beim Restore.
  if ! gzip -t "$tmp" 2>/dev/null; then
    echo "[Backup] FEHLGESCHLAGEN — das Archiv ist unvollstaendig. Nichts wurde rotiert." >&2
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$datei"
  echo "[Backup] Erfolgreich: $(du -h "$datei" | cut -f1)"

  # Erst rotieren, wenn ein gueltiger neuer Stand existiert.
  find "$ZIEL" -name 'gbs_campus_*.sql.gz' -mtime "+$AUFBEWAHRUNG_TAGE" -delete
  return 0
}

# Ein Lauf sofort beim Start: Ein kaputtes Backup soll beim Deploy auffallen,
# nicht erst in der ersten Nacht — und schon gar nicht erst, wenn es gebraucht
# wird. Schlaegt er fehl, laeuft der Container trotzdem weiter und versucht es
# zur Zielzeit erneut; der Fehler steht im Log.
echo "[Backup] Startlauf zur Ueberpruefung der Konfiguration..."
erzeuge_backup || echo "[Backup] Startlauf fehlgeschlagen — bitte pruefen." >&2

while true; do
  SCHLAFEN=$(sekunden_bis_zielzeit)
  echo "[Backup] Naechster Lauf in ${SCHLAFEN}s (Zielzeit ${ZIEL_STUNDE}:$(printf '%02d' $ZIEL_MINUTE) Uhr)."
  sleep "$SCHLAFEN"
  erzeuge_backup || true
done
