# Slider selbst hosten

Slider läuft als ein Container (API und Web-App) mit Postgres und Caddy davor, der HTTPS per
Let's Encrypt übernimmt. Ein fertiges Image gibt es nicht, es wird aus dem Repo gebaut.

## Voraussetzungen

- Linux-Server mit Docker und Compose-Plugin, Ports 80 und 443 offen. 2 vCPU und 4 GB RAM
  reichen für ein Team (z. B. Hetzner CX23, ca. 7 € im Monat). amd64 und arm64 gehen.
- Eine (Sub-)Domain, z. B. `slider.firma.de`, deren A-/AAAA-Record auf den Server zeigt.
- Mindestens ein Login-Weg: Microsoft, Google, Nextcloud oder OIDC (z. B. Keycloak). Er wird
  nach dem Start im Browser eingetragen.

## Installation

```bash
curl -fsSL https://get.docker.com | sh       # falls Docker fehlt
git clone https://github.com/Root-Bert/slider.git /opt/slider
cd /opt/slider/deploy
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
chmod 600 .env
nano .env                                    # SLIDER_DOMAIN eintragen
docker compose up -d --build                 # baut das Image (einige Minuten)
docker compose logs slider                   # Einrichtungsseite und „Setup token: …“
```

`curl -s https://slider.firma.de/api/health` antwortet mit `{"ok":true}`, sobald alles läuft.
Eine feste Version statt des neuesten Stands: vor dem Bauen `git checkout <tag>`.

## Ersteinrichtung

1. Im Log stehen die **Einrichtungsseite** `https://slider.firma.de/einrichtung` und ein
   einmaliger **Setup-Token** (Zeile `Setup token: …`). Nicht weitergeben.
2. Seite öffnen, Token eingeben, mindestens einen Anmeldeweg eintragen (siehe
   [Anmeldung](#anmeldung)) und **Speichern**. Slider startet kurz neu.
3. Anmelden. Slider fragt danach sofort: den Setup-Token **noch einmal** eingeben →
   **Admin werden**. Anmelden allein macht niemanden zum Admin.

Solange es keinen Admin gibt, kommt jedes neue Konto nur bis zur Abfrage des Tokens. Danach
ändert der Admin alles unter Einstellungen → **Instanz** → Einrichtung. Werte in `deploy/.env`
haben immer Vorrang und erscheinen dort schreibgeschützt.

Die Seite **Instanz** (`/instanz`) zeigt dem Admin, wie groß die Instanz ist (Personen,
Workspaces, Reviews, Speicher), dazu alle Workspaces mit Größe und Plan, nie ihre Inhalte,
und alle Konten mit Name und E-Mail. Dort lassen sich Konten und Workspaces **sperren**: Ein
gesperrtes Konto meldet sich nirgends mehr an, einen gesperrten Workspace öffnet niemand mehr,
nur Austreten geht. Gelöscht wird dabei nichts. Wo die Pläne sich unterscheiden
(`PLAN_FREE_*`), schaltet der Admin einen Workspace auch ohne Stripe in den Paid-Plan frei,
etwa bei Zahlung per Rechnung.

Wer sich registrieren darf, regelt `SIGNUP`: Standard ist `open` (jede:r mit einem der Logins).
Für eine Firmen-Instanz besser `invite`, `domains` oder `company`.

## Anmeldung

Die Einrichtungsseite zeigt alle Weiterleitungs-URIs zum Kopieren.

**Microsoft (Entra ID):** Entra admin center → App-Registrierungen → Neue Registrierung,
Kontotypen „beliebiges Organisationsverzeichnis und persönliche Microsoft-Konten“.
Plattform _Web_ mit Redirect-URI `https://slider.firma.de/api/auth/microsoft/callback`. Neuen
Clientschlüssel anlegen. API-Berechtigungen (delegiert), Microsoft Graph: `openid`, `profile`,
`email`, `offline_access`, `User.Read`, `Files.Read.All`; für den OneDrive-Picker zusätzlich
SharePoint: `MyFiles.Read`, `AllSites.Read`. Nur die eigene Firma: `MS_TENANT=<Tenant-ID>`.

**Google:** [Google Cloud Console](https://console.cloud.google.com/) → neues Projekt →
Google Auth Platform: Zielgruppe **Extern**, Bereiche `openid`, `userinfo.email`,
`userinfo.profile` und `drive.file`. Client vom Typ _Webanwendung_ mit Weiterleitungs-URI
`https://slider.firma.de/api/auth/google/callback`. Unter APIs & Dienste die Google Drive API,
Google Picker API und Google Slides API aktivieren. Danach unter Zielgruppe **App
veröffentlichen**; mit diesen Bereichen ist keine Überprüfung durch Google nötig.

**OIDC (Keycloak, authentik, …):** vertraulicher Client mit Redirect-URI
`https://slider.firma.de/api/auth/oidc/callback`; Issuer, Client-ID und Secret eintragen.

**Nextcloud:** „Weiter mit Nextcloud“ geht ohne Einrichtung mit jeder öffentlichen Nextcloud
(neue Konten brauchen dann E-Mail-Versand zur Bestätigung). Für die Firmen-Nextcloud: dort als
Admin unter Verwaltung → Sicherheit → OAuth-2.0-Clients einen Client mit
`https://slider.firma.de/api/auth/nextcloud/callback` anlegen und mit `NEXTCLOUD_URL` eintragen.

Passkeys brauchen keine Einrichtung. „Mit E-Mail fortfahren“ (Konto per Login-Link, ohne
Passwort) ist an, sobald E-Mail-Versand eingerichtet ist. Workspaces können ihren eigenen
Firmen-Login (SSO) in ihren Einstellungen verbinden.

## E-Mail (optional)

Für Einladungen, Login-Links, Datenanfragen und Löschhinweise. Ohne SMTP zeigt Slider
Einladungslinks zum Weitergeben an. Jeder SMTP-Zugang geht, z. B. Brevo:
`SMTP_URL=smtp://<login>:<smtp-key>@smtp-relay.brevo.com:587` und
`MAIL_FROM=Slider <slider@firma.de>`. Sonderzeichen im Login URL-kodieren (`@` → `%40`).
Absender-Domain beim Dienst verifizieren (SPF/DKIM). Viele Cloud-Hoster sperren ausgehend Port 25
und 465, dann 587 nehmen.

## Schlüssel sichern

Slider verschlüsselt Inhalte (Dateien, Kommentare, Folientexte) mit `SLIDER_DATA_KEY`. Ohne ihn
erzeugt Slider ihn beim ersten Start in `/data/data-key`. Dann liegt er aber im selben Volume
wie die Daten und schützt die Backups nicht. Deshalb nach dem ersten Start auslagern:

```bash
cd /opt/slider/deploy
echo "SLIDER_DATA_KEY=$(docker compose exec -T slider cat /data/data-key)" >> .env
docker compose up -d slider
docker compose exec slider rm /data/data-key
```

Den Schlüssel zusätzlich im Passwortmanager ablegen und **nie ändern**: Mit einem anderen startet
Slider nicht, ohne ihn sind alle Inhalte verloren, auch in jedem Backup.

## Backups

Zu sichern sind die Datenbank, das Volume `/data` und getrennt davon `SLIDER_DATA_KEY`.

```bash
cd /opt/slider/deploy
mkdir -p /opt/backups
docker compose exec -T postgres pg_dump -U slider -Fc slider > /opt/backups/slider-$(date +%F).dump
docker run --rm -v slider_slider-data:/data -v /opt/backups:/backup debian:bookworm-slim \
  tar czf /backup/slider-data-$(date +%F).tar.gz -C /data .
```

Täglich per Cron ausführen, außer Haus kopieren (z. B. `restic` auf eine Storage Box) und alte
Backups rotieren.

### Wiederherstellen

Datenbank und `/data` gehören zusammen: `/data/secret` verschlüsselt die gespeicherten
Einstellungen und Verbindungen in der Datenbank, ohne das passende `secret` sind sie unlesbar.
Außerdem muss derselbe `SLIDER_DATA_KEY` gesetzt sein.

```bash
cd /opt/slider/deploy
docker compose stop slider
docker compose exec -T postgres pg_restore -U slider -d slider --clean --if-exists < /opt/backups/slider-DATUM.dump
docker run --rm -v slider_slider-data:/data -v /opt/backups:/backup debian:bookworm-slim \
  tar xzf /backup/slider-data-DATUM.tar.gz -C /data
docker compose up -d slider
```

## Updates

```bash
cd /opt/slider && git pull        # oder git checkout <tag>
cd deploy
docker compose pull postgres caddy
docker compose up -d --build      # Migrationen laufen beim Start
docker image prune -f
```

Vorher ein Backup ziehen: Migrationen lassen sich nicht zurückdrehen.

## Datenschutz

- **Impressum und Datenschutzerklärung** trägt der Admin auf der Einrichtungsseite ein.
  „Vorlage einfügen“ füllt Vorlagen ein; Platzhalter in `[eckigen Klammern]` ausfüllen. Die
  Vorlagen ersetzen keine Rechtsberatung.
- **Auskunft und Löschung** erledigen Nutzer:innen selbst: unter Konto & Anmeldung oder ohne
  Login über `/datenanfrage` (braucht E-Mail-Versand).
- **Wer was sieht:** Alle in einem Workspace sehen seine Präsentationen, auch verknüpfte.
  Slider liest verknüpfte Dateien mit dem Konto der Person, die sie verknüpft hat, nie mit dem
  der Betrachter; Freigaben bei OneDrive, Google oder Nextcloud gelten in Slider nicht. Per
  Rechtsklick → „Zugriff einschränken“ lässt sich eine Präsentation auf einzelne Personen
  begrenzen. Verlässt jemand einen Workspace oder löscht das Konto, werden die verknüpften
  Präsentationen gelöscht, hochgeladene gehen an den Owner des Workspace.
- **Löschfristen** (automatisch, stündlich geprüft): Konten und Präsentationen, die 18 Monate
  niemand genutzt hat, werden nach Erinnerungsmails gelöscht (`DELETE_UNUSED=false` schaltet das
  aus; Instanz-Admins sind ausgenommen). Einladungen verschwinden 30 Tage nach ihrem Ende,
  Sitzungen nach 30 Tagen ohne Nutzung, spätestens 90 Tage nach der Anmeldung. Kommentare
  gelöschter Konten bleiben ohne Namen, ihre Sprach- und Videoaufnahmen werden sofort gelöscht.
  Backups enthalten gelöschte Daten, bis sie rotiert sind; die Aufbewahrungsdauer gehört in die
  Datenschutzerklärung.

## Proxy und Cloudflare

- **Eigener Reverse-Proxy** statt Compose: Image bauen und den Container allein starten.

  ```bash
  docker build -t slider:local .
  docker run -d --name slider --restart unless-stopped -p 127.0.0.1:8787:8787 \
    -v slider-data:/data -e SLIDER_URL=https://slider.firma.de -e TRUST_PROXY=1 slider:local
  ```

  Ohne `DATABASE_URL` nutzt Slider die eingebettete Datenbank in `/data/db`. Der Proxy sollte
  HTTP/2 sprechen; nginx braucht außerdem `client_max_body_size 200m;`.

- **Ohne Docker:** `bun install --frozen-lockfile && bun run build`, dann `bun run start`.
- **Cloudflare:** DNS-Record erst „Nur DNS“, bis Caddy das Zertifikat hat, dann Proxy an und
  SSL-Modus „Vollständig (streng)“. In `deploy/.env` die Zeile `TRUSTED_PROXIES=…`
  einkommentieren, sonst teilen sich alle Besucher ein Rate-Limit. Der Free-Plan erlaubt nur
  100 MB pro Upload: dann `MAX_UPLOAD_BYTES=94371840` und `MAX_MEDIA_BYTES=94371840` setzen.
- **Mehrere Apps auf einem Server:** Ein gemeinsamer Caddy aus `deploy/proxy/` übernimmt 80/443
  (`cp .env.example .env`, `cp examples/slider.caddy sites/`, Domain eintragen,
  `docker compose up -d`). In `deploy/.env` dann
  `COMPOSE_FILE=docker-compose.yml:docker-compose.shared-proxy.yml` setzen.
- **Firmenschriften:** `.ttf`/`.otf`-Dateien nach `deploy/fonts/` legen, `docker compose up -d`
  und die Präsentation im ⋯-Menü **Neu rendern**.

## Umgebungsvariablen

In `deploy/.env` (Vorlage: `deploy/.env.example`). `NODE_ENV`, `PORT`, `DATA_DIR`, `SLIDER_URL`,
`DATABASE_URL` und `TRUST_PROXY` setzt `docker-compose.yml` selbst. Mit „Seite“ markierte Werte
gehen auch auf der Einrichtungsseite.

| Variable                                                          | Pflicht           | Bedeutung                                                                                      |
| ----------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `SLIDER_DOMAIN`                                                   | ja (Compose)      | Öffentlicher Hostname; Slider läuft unter `https://<domain>`.                                  |
| `POSTGRES_PASSWORD`                                               | ja (Compose)      | Nur Hex (`openssl rand -hex 24`).                                                              |
| `SLIDER_URL`                                                      | ja (ohne Compose) | Öffentliche URL, z. B. `https://slider.firma.de` (früher `WEB_ORIGIN`).                        |
| `SLIDER_SECRET`                                                   | nein              | Signiert Sessions, verschlüsselt Tokens und Einstellungen. Leer: in `DATA_DIR/secret` erzeugt. |
| `SLIDER_DATA_KEY`, `SLIDER_DATA_KEY_FILE`                         | nein              | Schlüssel der Inhalte (oder Datei damit). Siehe [Schlüssel sichern](#schlüssel-sichern).       |
| `DATABASE_URL`                                                    | nein              | `postgres://…`. Leer: eingebettete Datenbank in `DATA_DIR/db`.                                 |
| `DATA_DIR`, `MEDIA_DIR`, `WEB_DIST_DIR`                           | nein              | Datenordner (Container: `/data`), Ordner für Aufnahmen, gebaute Web-App.                       |
| `TRUST_PROXY`                                                     | nein              | `1` hinter einem Proxy, wenn Port 8787 nicht öffentlich ist.                                   |
| `TRUSTED_PROXIES`                                                 | nein (Compose)    | Adressen, deren Client-IP-Header Caddy glaubt (Cloudflare).                                    |
| `SIGNUP`, `SIGNUP_DOMAINS`                                        | nein (Seite)      | `open` (Standard), `invite`, `domains` (mit Liste, z. B. `firma.de,firma.com`) oder `company`. |
| `DELETE_UNUSED`                                                   | nein (Seite)      | `false` schaltet das Löschen ungenutzter Konten und Präsentationen aus.                        |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`                   | Login (Seite)     | Microsoft-Login und OneDrive/SharePoint.                                                       |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                        | Login (Seite)     | Google-Login und Google Drive.                                                                 |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`             | Login (Seite)     | OIDC-Anbieter, z. B. `https://auth.firma.de/realms/firma`.                                     |
| `OIDC_LABEL`, `OIDC_SCOPES`                                       | nein (Seite)      | Button-Text; Scopes (Standard `openid profile email`).                                         |
| `NEXTCLOUD_URL`, `NEXTCLOUD_CLIENT_ID`, `NEXTCLOUD_CLIENT_SECRET` | Login (Seite)     | Firmen-Nextcloud (darf intern sein) und ihr OAuth-Client.                                      |
| `NEXTCLOUD_LOGIN_ANY`                                             | nein              | `false`: „Weiter mit Nextcloud“ nur mit der Firmen-Nextcloud.                                  |
| `SMTP_URL`, `MAIL_FROM`                                           | nein (Seite)      | E-Mail-Versand, nur zusammen.                                                                  |
| `CONTACT_EMAIL`                                                   | nein              | Empfänger des Kontaktformulars der Produkt-Website.                                            |
| `SESSION_TTL_DAYS`                                                | nein              | Login-Dauer ohne Nutzung in Tagen, Standard 30.                                                |
| `INVITE_RATE_LIMIT`                                               | nein              | Anfragen pro Minute und IP auf Einladungslinks, Standard 30.                                   |
| `MAX_UPLOAD_BYTES`, `MAX_MEDIA_BYTES`                             | nein              | Größte PowerPoint (Standard 200 MB) und Aufnahme (100 MB).                                     |
| `SYNC_POLL_INTERVAL_MS`, `SYNC_DEBOUNCE_MS`                       | nein              | Abgleich verknüpfter Dateien, Standard je 1 Minute, `0` = aus.                                 |
| `LIBREOFFICE_PATH`, `LIBREOFFICE_TIMEOUT_MS`                      | nein              | `soffice` für Folienbilder (im Image enthalten); Zeitlimit, Standard 2 Minuten.                |
| `PDF_TIMEOUT_MS`                                                  | nein              | Zeitlimit für das Lesen eines PDFs, Standard 2 Minuten plus 1 Sekunde pro Seite.               |
| `IMPORT_WORKERS`                                                  | nein              | Gleichzeitige Importe, Standard 1 (je ~1 Kern, 1 GB RAM).                                      |
| `PLAN_FREE_MAX_MEMBERS`, `PLAN_FREE_MAX_DECKS`                    | nein              | Grenzen pro Workspace, Standard unbegrenzt.                                                    |
| `PLAN_FREE_MAX_STORAGE_BYTES`                                     | nein              | Speicher pro Workspace, Standard unbegrenzt (früher `MEDIA_QUOTA_BYTES`).                      |
| `SLIDER_DEMO`                                                     | nein              | `true` schaltet die Grenzen der gehosteten Instanz ein.                                        |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`   | nein              | Bezahlung, nur für eine Instanz mit Grenzen. Webhook: `${SLIDER_URL}/api/billing/webhook`.     |

## Fehlersuche

- `docker compose logs slider`: Konfigurationsfehler stehen beim Start im Log.
- Setup-Token verloren: Er steht bei jedem Start im Log, solange es keinen Admin gibt.
- Zertifikat schlägt fehl: DNS zeigt noch nicht auf den Server oder Port 80 ist zu
  (`docker compose logs caddy`).
- „redirect URI mismatch“ bei Microsoft oder Google: Die URI muss exakt wie auf der
  Einrichtungsseite eingetragen sein, ohne Schrägstrich am Ende.
- Google „Zugriff blockiert“: Die App steht noch auf „Testen“, unter Zielgruppe veröffentlichen.
- Folien sehen anders aus als in PowerPoint: Meist fehlen Firmenschriften (siehe oben).
- Passkeys gehen nach einem Domainwechsel nicht mehr: Passkeys gelten nur für ihre Domain, neu
  anlegen.
