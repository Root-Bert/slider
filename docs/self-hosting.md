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

**Instanz** (`/instanz`) zeigt Größe, Workspaces und Konten (nie Inhalte). Konten und Workspaces
lassen sich dort **sperren** (nichts wird gelöscht) und, wo `PLAN_FREE_*` gilt, ohne Stripe in den
Paid-Plan freischalten.

Wer sich registrieren darf, regelt `SIGNUP`: Standard ist `open` (jede:r mit einem der Logins).
Für eine Firmen-Instanz besser `invite`, `domains` oder `company`.

## Anmeldung

Die Einrichtungsseite zeigt alle Weiterleitungs-URIs zum Kopieren.

**Microsoft (Entra ID):** Entra admin center → App-Registrierungen → Neue Registrierung,
Kontotypen „beliebiges Organisationsverzeichnis und persönliche Microsoft-Konten“.
Plattform _Web_ mit Redirect-URI `https://slider.firma.de/api/auth/microsoft/callback`. Neuen
Clientschlüssel anlegen. API-Berechtigungen (delegiert), Microsoft Graph: `openid`, `profile`,
`email`. Unter Tokenkonfiguration → Optionalen Anspruch hinzufügen → ID: `xms_edov` – dann
nimmt Slider eine Adresse nur, wenn Microsoft sie bestätigt hat. Nur die eigene Firma:
`MS_TENANT=<Tenant-ID>`.

**Google:** [Google Cloud Console](https://console.cloud.google.com/) → neues Projekt →
Google Auth Platform: Zielgruppe **Extern**, Bereiche `openid`, `userinfo.email` und
`userinfo.profile`. Client vom Typ _Webanwendung_ mit Weiterleitungs-URI
`https://slider.firma.de/api/auth/google/callback`. Danach unter Zielgruppe **App
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

## Desktop-App

Die Desktop-App (Mac, Linux; Download unter den GitHub-Releases) meldet sich standardmäßig bei
office.bertro.dev an. Für die eigene Instanz: in der App unter Konto → **Anderer Server** die
Adresse eintragen, z. B. `https://slider.firma.de` (https, ab Slider 1.6.0). Die Anmeldung öffnet
den Browser mit den Logins der Instanz; danach liegen die Workspaces und Präsentationen des Kontos
als Kopien auf dem Computer und werden abgeglichen. Auf dem Server ist nichts einzurichten.

## Cloud

Cloud, die Dateiablage des Workspaces, ist Teil desselben Servers (`/cloud`, im Kopf der App
neben Slider) und braucht keine eigene Einrichtung, keine eigene Domain und keinen eigenen
Dienst.

- **Speicherort:** Dateien, ihre Fassungen und Vorschaubilder liegen verschlüsselt im selben
  Volume wie alles andere (`/data/blobs`), Uploads in Arbeit unter `/data/tmp/cloud-uploads`. Das
  Backup unten deckt sie mit ab.
- **Nur im Workspace:** Wer was sieht, folgt aus Rolle und Bereich. Betrachter und Kommentierer
  sehen nur an und haben keine eigenen Dateien. Einzeln teilen (`CLOUD_SHARING=true`) und Links
  für Personen außerhalb (`CLOUD_PUBLIC_LINKS=true`) sind aus, solange nicht gesetzt.
- **Platz:** Eine Datei darf bis 5 GB groß sein (`CLOUD_MAX_FILE_BYTES`), der Speicher je
  Workspace ist ohne `PLAN_FREE_MAX_STORAGE_BYTES` unbegrenzt. Auf einem Server mit offener
  Registrierung beides setzen, sonst begrenzt nur die Platte. Gelöschtes bleibt 30 Tage in
  „Gelöscht“ und belegt so lange Platz.
- **Nach dem Update von einer Version ohne Cloud:** Beim ersten Start legt der Server für jede
  vorhandene Präsentation einmalig eine Datei in der Cloud an, im Bereich des Workspace (für alle im
  Workspace) oder, wenn ihr Zugriff eingeschränkt ist, in den eigenen Dateien ihrer
  Besitzerin, geteilt mit denen, die sie sehen dürfen. Frühere Ordner aus Slider werden zu
  Ordnern gleichen Namens. Das dauert je nach Menge einige Sekunden bis Minuten, der Server ist
  dabei erreichbar; im Log steht am Ende „… older presentations got their place“. Der Speicher
  wächst dabei um die Größe der Präsentationsdateien.
- **App für den Schreibtisch:** „The Office Cloud“ (Mac, Linux; Download unter den
  GitHub-Releases) zeigt die Cloud in einem eigenen Fenster und auf dem Mac ab macOS 15 als Ort
  im Finder. Selbst bauen: `cd desktop && bun install && bun run cloud:dmg` (Mac mit Apple Chip,
  Xcode Command Line Tools). Solange die App nicht von Apple beglaubigt ist, fragt macOS vor dem
  ersten Start nach: einmal öffnen, dann unter Systemeinstellungen › Datenschutz & Sicherheit
  „Dennoch öffnen“ wählen. Den Rest führt die App: Sie legt sich auf Nachfrage selbst in
  „Programme“ und meldet nach der Anmeldung den Ort im Finder an – er ist sofort da. Ist er in
  den Systemeinstellungen ausgeschaltet, fragt die App und öffnet sie an der richtigen Stelle
  (Dateianbieter › „The Office Cloud“); sobald der Schalter an ist, öffnet sich der Ordner.
  Jederzeit erreichbar über das Menü Konto › „Im Finder zeigen“. Ohne ihn bleibt die App ein
  vollständiges Fenster auf die Cloud. Updates lädt diese App noch nicht selbst.
- **Große Uploads** gehen in Teilen von 32 MB, im Browser wie aus dem Finder. Ein Proxy vor dem
  Server muss also nur 32 MB je Anfrage durchlassen (Cloudflare mit 100 MB im Free-Plan reicht).

## KI-Apps

Claude, ChatGPT und Claude Code verbinden sich über MCP mit Slider: Adresse
`https://slider.firma.de/api/mcp`, Anmeldung per OAuth oder mit einem Token aus Konto →
**KI-Apps**. Auf dem Server ist nichts einzurichten, die Adressen kommen aus `SLIDER_URL`. Die
OAuth-Erkennung liegt im Wurzelverzeichnis der Domain (`/.well-known/oauth-…`): Der mitgelieferte
Caddy leitet alles durch, ein eigener Proxy, der nur einzelne Pfade weiterreicht, braucht
`/.well-known/` dazu. Claude und ChatGPT rufen Slider aus ihrer Cloud auf; eine Instanz nur im Firmennetz erreicht
nur Claude Code auf Rechnern in diesem Netz.

## E-Mail (optional)

Für Einladungen, Login-Links, Datenanfragen und Löschhinweise. Ohne SMTP zeigt Slider
Einladungslinks zum Weitergeben an. Jeder SMTP-Zugang geht, z. B. Brevo:
`SMTP_URL=smtp://<login>:<smtp-key>@smtp-relay.brevo.com:587` und
`MAIL_FROM=Slider <slider@firma.de>`. Sonderzeichen im Login URL-kodieren (`@` → `%40`).
Absender-Domain beim Dienst verifizieren (SPF/DKIM). Viele Cloud-Hoster sperren ausgehend Port 25
und 465, dann 587 nehmen.

## Fotos (optional)

Fotos im Editor und für die KI kommen von Unsplash. Auf
[unsplash.com/oauth/applications](https://unsplash.com/oauth/applications) eine App anlegen und
ihren Access Key als `UNSPLASH_ACCESS_KEY` setzen (Secret Key unnötig). Neue Apps sind im
Demo-Modus (50 Anfragen pro Stunde); für mehr „Production“ beantragen, mit Screenshots der
Fotonennung im Editor und im Kommentar der KI. Slider hält die Unsplash-Regeln ein (Key nur auf
dem Server, Hotlinks, verlinkte Nennung, einmalige Meldung pro Foto). Die Datenschutz-Vorlage
nimmt den Absatz „Fotosuche“ auf, sobald der Key gesetzt ist.

## Freistellen (optional)

Die KI kann Bildhintergründe entfernen, mit [rembg](https://github.com/danielgatis/rembg)
(Modell IS-Net) auf dem eigenen Server. Starten mit `docker compose --profile rembg up -d` und
`REMBG_URL=http://rembg:7000` in `.env`. Bis zu 2 GB RAM und 2 Kerne, einige Sekunden pro Bild.
Ohne `REMBG_URL` hat die KI das Werkzeug nicht.

## Sprache zu Text (optional)

Der eigene Server kann Aufnahmen in Text umwandeln: Whisper large-v3-turbo über faster-whisper,
ohne API-Key, keine Aufnahme verlässt den Server. Starten mit
`docker compose --profile stt up -d` (der erste Build lädt das Modell, ~1,6 GB) und in `.env`
`SPEECH_URL=http://stt:8000/v1` setzen, dann `docker compose up -d slider`.

Etwa 2 GB RAM (Limit 3 GB), bis zu 2 Kerne (Anrufe und Folien behalten ihren Teil); ohne
Grafikkarte dauert eine Aufnahme damit länger als mit 4 Kernen (dort rund drei Viertel ihrer
Länge). Der eigene Server gilt überall, wo kein Key für Sprache zu Text aktiv ist
(„Integrationen“ zeigt „Auf diesem Server“); ein aktiver Key geht vor.

Anderes Modell: `docker compose build --build-arg WHISPER_MODEL=large-v3 stt` (genauer,
doppelt so langsam, ~4 GB RAM) und `SPEECH_MODEL=whisper-large-v3` in `.env`.

## Spamfilter (optional)

Ohne eigenen Filter gilt, was der Spam-Ordner des Postfachs sagt (und die eigenen Regeln unter
„Postfächer“). Mit [Rspamd](https://rspamd.com) prüft der eigene Server zusätzlich jede Mail, die
im Posteingang ankommt, und Antworten in Unterhaltungen, auf die noch niemand geantwortet hat.
Was er aussortiert, steht in Spam mit „Vom Filter aussortiert“, der Grund im Tooltip.

Starten mit `docker compose --profile spam up -d` (Rspamd, Redis für das Gelernte und ein
eigener DNS-Resolver – Sperrlisten wie Spamhaus antworten öffentlichen Resolvern nicht), dann in
`.env` `RSPAMD_URL=http://rspamd:11333` und `RSPAMD_PASSWORD=` (z. B. `openssl rand -hex 24`)
setzen und `docker compose up -d slider rspamd`. Mit `deploy/deploy.sh` (auch dem Deploy aus
GitHub Actions) reicht `COMPOSE_PROFILES=spam`: Adresse und Passwort setzt es selbst, das Passwort
einmal erzeugt in `/var/lib/slider/rspamd-password`. Etwa 300 MB RAM, ein Kern.

- **Lernen** nur aus dem, was Menschen entscheiden: „Als Spam markieren“, „Kein Spam“ und neue
  Regeln („Absender blockieren“/„vertrauen“) – nie aus dem Urteil der KI oder des Filters selbst.
  Gelernt wird für den ganzen Server (Bayes), ab 200 Spam- und 200 anderen Mails zählt es.
  Ohne `RSPAMD_PASSWORD` prüft Rspamd nur und lernt nichts. Das Passwort geht im internen
  Docker-Netz unverschlüsselt an Rspamd; seine Ports sind nicht veröffentlicht.
- **Was den Server verlässt:** DNS-Anfragen zu Absender-Servern und Links (Sperrlisten) und
  Prüfsummen von Mailteilen an Rspamds Fuzzy-Dienst (`fuzzy_check`, keine Inhalte). Abschalten
  mit `enabled = false;` in `deploy/rspamd/local.d/fuzzy_check.conf`.
- **Spamhaus** ist frei für nicht-kommerzielle Nutzung mit wenig Mails; für mehr einen kostenlosen
  [DQS-Key](https://www.spamhaus.com/free-trial/sign-up-for-a-free-data-query-service-account/)
  holen (`deploy/rspamd/local.d/rbl.conf` laut Rspamd-Doku).
- Der Filter verschiebt nichts im Postfach selbst; die Rettung aus Spam und „Kein Spam“ gelten
  wie bei der KI.

## Anrufe mit vielen Personen (optional)

Ohne Weiteres schicken sich die Browser in einem Anruf Ton und Bild gegenseitig zu, höchstens 8
Personen. Mit [LiveKit](https://livekit.io) auf dem eigenen Server leitet der Server weiter: bis
zu 50 Personen pro Anruf, jede schickt ihr Bild einmal und bekommt nur, was sie sieht. Nichts
wird aufgezeichnet, kein Dritter ist beteiligt.

1. **DNS:** ein A-Record (und AAAA, falls vorhanden) für einen eigenen Namen, z. B.
   `call.firma.de`, auf den Server – bei Cloudflare **„Nur DNS“** (graue Wolke): Ton und Bild
   laufen über eigene Ports, die Cloudflare nicht weiterleitet.
2. **Ports** in der Firewall (auch der des Hosters) öffnen:

   | Port    | Protokoll | Wofür                                             |
   | ------- | --------- | ------------------------------------------------- |
   | 443, 80 | TCP       | Verbindungsaufbau (wss) über Caddy, Zertifikat    |
   | 7882    | UDP       | Ton und Bild (ein Port für alle)                  |
   | 7881    | TCP       | Ton und Bild, wenn UDP gesperrt ist               |
   | 3478    | UDP       | TURN, für Netze, die sonst nichts durchlassen     |
   | 5349    | TCP       | TURN über TLS (Firmennetze, die nur TLS erlauben) |

3. **`deploy/.env`:** `COMPOSE_PROFILES=call` (mit anderen Profilen per Komma, z. B.
   `COMPOSE_PROFILES=stt,call`) und `CALL_DOMAIN=call.firma.de`, dann `docker compose up -d`.

Beim ersten Start legt Slider das Schlüsselpaar für LiveKit im Daten-Volume an
(`/data/livekit/keys.yaml`), LiveKit liest es von dort – nichts von Hand. Caddy holt das
Zertifikat für `CALL_DOMAIN`; LiveKit nutzt es für TURN über TLS und startet neu, sobald es da
ist (bis dahin läuft TURN nur über UDP). Ein erneuertes nimmt es nachts zwischen 2 und 4 Uhr
UTC (`CERT_RESTART_FROM_HOUR`/`_TO_HOUR`): laufende Anrufe enden vorher in Ruhe, das alte
Zertifikat gilt noch Wochen. Seine öffentliche Adresse findet LiveKit per STUN; stimmt sie nicht (`docker compose
logs livekit` zeigt `nodeIP`), `LIVEKIT_NODE_IP=<öffentliche IPv4>` setzen.

LiveKit ist auf 2 Kerne und 1 GB RAM begrenzt; es leitet nur weiter und rechnet nichts um. Ein
Anruf mit 50 Personen braucht beim Server etwa 50 × 1–2 Mbit/s eingehend und ein Vielfaches
davon ausgehend – die Kamerabilder kommen in drei Größen, jede Person bekommt nur die gezeigten
in der gezeigten Größe. Ohne `CALL_DOMAIN` bleibt alles wie vorher (höchstens 8 Personen).
Beides gehört zusammen: `CALL_DOMAIN` ohne Profil `call` gibt Tickets für einen Server, der
nicht läuft. Mit dem gemeinsamen Caddy aus `deploy/proxy/` steht die Site in
`examples/slider.caddy`; TURN läuft dann nur über UDP. Ein LiveKit anderswo:
`LIVEKIT_URL=wss://…`, `LIVEKIT_API_KEY` und `LIVEKIT_API_SECRET` statt des Profils.

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
docker builder prune -f --filter until=24h   # Build-Cache, wächst sonst mit jedem Build
```

Vorher ein Backup ziehen: Migrationen lassen sich nicht zurückdrehen.

Von einer Version vor 1.6: OneDrive, SharePoint und Google Drive gibt es nicht mehr, Microsoft und
Google dienen nur noch der Anmeldung. Beim ersten Start widerruft Slider gespeicherte
Google-Zugriffe (braucht ausgehend `oauth2.googleapis.com`, sonst beim nächsten Start) und löscht
die alten Dateiverbindungen. Danach in der Entra-App alles außer `openid`, `profile` und `email`
entfernen und bei Google den Bereich `drive.file` sowie Drive-, Picker- und Slides-API abschalten.

## Domain wechseln

Neue Adresse in `SLIDER_DOMAIN`, die alte in `SLIDER_OLD_DOMAINS` (mehrere mit Leerzeichen), DNS
beider auf den Server, `docker compose up -d`. Vorher die neuen Weiterleitungs-URIs bei Microsoft,
Google, OIDC und Nextcloud eintragen (siehe [Anmeldung](#anmeldung); die alten stehen lassen),
Workspaces mit eigenem Firmen-Login (SSO) tragen sie bei ihrem Anbieter ein.

Auf der alten Adresse leitet Caddy Browser auf dieselbe Seite der neuen um (308), auch Links aus
Mails und Suchmaschinen. Die API, KI-Apps (`/api/mcp`, Tokens bleiben gültig) und die Desktop-Apps
der Version davor bekommen dort weiter ihre Antworten. Was nicht mitkommt: Browser melden sich auf
der neuen Adresse neu an (das Cookie gehört zur Adresse), Passkeys gelten nur auf der Adresse, auf
der sie angelegt wurden (neu anlegen unter Konto), und eine Anmeldung über Microsoft oder Google
aus einem Fenster einer alten Desktop-App heraus (z. B. ein Postfach verbinden) geht erst mit der
neuen Version oder der neuen Adresse unter **Anderer Server**. KI-Apps bei Gelegenheit mit der
neuen Adresse neu verbinden. Kommt niemand mehr über die alte, `SLIDER_OLD_DOMAINS` leeren.

## Datenschutz

- **Impressum und Datenschutzerklärung** trägt der Admin auf der Einrichtungsseite ein.
  „Vorlagen ausfüllen“ fragt Betreiberdaten einmal für beide Texte ab und schaltet Absätze nach
  dem, was die Instanz nutzt (Logins, E-Mail, Stripe, Unsplash, Löschfristen – vorbelegt aus der
  Einrichtung); KI ist immer drin, weil jeder Workspace einen Key hinterlegen kann. Was leer
  bleibt, steht als `[Lücke]` im Text und lässt sich unter dem Feld einzeln setzen oder streichen.
  Die Werte merkt sich die Seite: Kommt mit einem Update eine neuere Vorlage, füllt
  **„Vorlage aktualisieren“** sie mit ihnen neu, **„Vorlage bearbeiten“** öffnet das Formular darauf.
  Die Vorlagen ersetzen keine Rechtsberatung.
- **Auskunft und Löschung** erledigen Nutzer:innen selbst: unter Konto & Anmeldung oder ohne
  Login über `/datenanfrage` (braucht E-Mail-Versand).
- **Wer was sieht:** Alle in einem Workspace sehen seine Präsentationen, auch verknüpfte.
  Slider liest verknüpfte Dateien mit dem Konto der Person, die sie verknüpft hat, nie mit dem
  der Betrachter; Freigaben in der Nextcloud gelten in Slider nicht. Per
  Rechtsklick → „Zugriff einschränken“ lässt sich eine Präsentation auf einzelne Personen
  begrenzen. Verlässt jemand einen Workspace oder löscht das Konto, werden die verknüpften
  Präsentationen gelöscht, hochgeladene gehen an den Owner des Workspace.
- **Löschfristen** (automatisch, stündlich geprüft): Konten und Präsentationen, die 18 Monate
  niemand genutzt hat, werden nach Erinnerungsmails gelöscht (`DELETE_UNUSED=false` schaltet das
  aus; Instanz-Admins sind ausgenommen). Einladungen verschwinden 30 Tage nach ihrem Ende,
  Sitzungen nach 30 Tagen ohne Nutzung, spätestens 90 Tage nach der Anmeldung, im Editor
  hochgeladene Bilder nach 7 Tagen (eingesetzte stecken dann in der Datei). Kommentare
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
  HTTP/2 sprechen. Große Dateien (ab 64 MB) lädt Slider in Teilen zu 32 MB hoch, kleinere in
  einer Anfrage (ein Kommentar mit zehn Bildern bis gut 100 MB): nginx braucht deshalb
  `client_max_body_size 128m;` (Caddy hat kein Limit).

- **Ohne Docker:** `bun install --frozen-lockfile && bun run build`, dann `bun run start`.
- **Cloudflare:** DNS-Record erst „Nur DNS“, bis Caddy das Zertifikat hat, dann Proxy an und
  SSL-Modus „Vollständig (streng)“. In `deploy/.env` die Zeile `TRUSTED_PROXIES=…`
  einkommentieren, sonst teilen sich alle Besucher ein Rate-Limit. Der Free-Plan nimmt höchstens
  100 MB pro Anfrage an; Präsentationen und Aufnahmen lädt Slider ab 64 MB in Teilen zu 32 MB
  hoch (tus), der Proxy (orange Wolke) kann also an bleiben. Ein abgebrochener Upload geht beim
  nächsten Versuch mit derselben Datei weiter, auch nach einem Neuladen der Seite.
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

| Variable                                                          | Pflicht           | Bedeutung                                                                                                         |
| ----------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `SLIDER_DOMAIN`                                                   | ja (Compose)      | Öffentlicher Hostname; Slider läuft unter `https://<domain>`.                                                     |
| `POSTGRES_PASSWORD`                                               | ja (Compose)      | Nur Hex (`openssl rand -hex 24`).                                                                                 |
| `SLIDER_URL`                                                      | ja (ohne Compose) | Öffentliche URL, z. B. `https://slider.firma.de` (früher `WEB_ORIGIN`).                                           |
| `SLIDER_SECRET`                                                   | nein              | Signiert Sessions, verschlüsselt Tokens und Einstellungen. Leer: in `DATA_DIR/secret` erzeugt.                    |
| `SLIDER_DATA_KEY`, `SLIDER_DATA_KEY_FILE`                         | nein              | Schlüssel der Inhalte (oder Datei damit). Siehe [Schlüssel sichern](#schlüssel-sichern).                          |
| `DATABASE_URL`                                                    | nein              | `postgres://…`. Leer: eingebettete Datenbank in `DATA_DIR/db`.                                                    |
| `DATA_DIR`, `MEDIA_DIR`, `WEB_DIST_DIR`                           | nein              | Datenordner (Container: `/data`), Ordner für Aufnahmen, gebaute Web-App.                                          |
| `TRUST_PROXY`                                                     | nein              | `1` hinter einem Proxy, wenn Port 8787 nicht öffentlich ist.                                                      |
| `HOST`                                                            | nein              | Adresse, auf der die API lauscht; leer: alle Schnittstellen. Im Container leer lassen.                            |
| `TRUSTED_PROXIES`                                                 | nein (Compose)    | Adressen, deren Client-IP-Header Caddy glaubt (Cloudflare).                                                       |
| `SLIDER_OLD_DOMAINS`                                              | nein (Compose)    | Frühere Hostnamen (Leerzeichen dazwischen), siehe [Domain wechseln](#domain-wechseln).                            |
| `SIGNUP`, `SIGNUP_DOMAINS`                                        | nein (Seite)      | `open` (Standard), `invite`, `domains` (mit Liste, z. B. `firma.de,firma.com`) oder `company`.                    |
| `DELETE_UNUSED`                                                   | nein (Seite)      | `false` schaltet das Löschen ungenutzter Konten und Präsentationen aus.                                           |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`                   | Login (Seite)     | Microsoft-Login.                                                                                                  |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                        | Login (Seite)     | Google-Login.                                                                                                     |
| `GOOGLE_MAILBOXES`                                                | Postfächer        | `true`: „Mit Google anmelden“ auch für Gmail-Postfächer und ihre Kalender. Erst nach Googles Prüfung (eingeschränkter Scope) für alle.|
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`             | Login (Seite)     | OIDC-Anbieter, z. B. `https://auth.firma.de/realms/firma`.                                                        |
| `OIDC_LABEL`, `OIDC_SCOPES`                                       | nein (Seite)      | Button-Text; Scopes (Standard `openid profile email`).                                                            |
| `NEXTCLOUD_URL`, `NEXTCLOUD_CLIENT_ID`, `NEXTCLOUD_CLIENT_SECRET` | Login (Seite)     | Firmen-Nextcloud (darf intern sein) und ihr OAuth-Client.                                                         |
| `NEXTCLOUD_LOGIN_ANY`                                             | nein              | `false`: „Weiter mit Nextcloud“ nur mit der Firmen-Nextcloud.                                                     |
| `SMTP_URL`, `MAIL_FROM`                                           | nein (Seite)      | E-Mail-Versand, nur zusammen.                                                                                     |
| `CONTACT_EMAIL`                                                   | nein              | Empfänger des Kontaktformulars der Produkt-Website.                                                               |
| `SESSION_TTL_DAYS`                                                | nein              | Login-Dauer ohne Nutzung in Tagen, Standard 30.                                                                   |
| `INVITE_RATE_LIMIT`                                               | nein              | Anfragen pro Minute und IP auf Einladungslinks, Standard 30.                                                      |
| `MAX_UPLOAD_BYTES`, `MAX_MEDIA_BYTES`                             | nein              | Größte Präsentation und Aufnahme (Standard je 512 MB). Pro 512-MB-Upload ~1–1,5 GB RAM.                           |
| `CLOUD_MAX_FILE_BYTES`                                            | nein              | Größte Datei in der Cloud (Standard 5 GB). Wird gestreamt, kostet keinen RAM je Upload.                           |
| `CLOUD_PUBLIC_LINKS`                                              | nein              | `true` erlaubt Links für Personen außerhalb des Workspace. Standard: aus, Cloud bleibt im Workspace.              |
| `CLOUD_SHARING`                                                   | nein              | `true` erlaubt, Dateien einzeln mit Personen des Workspace zu teilen. Standard: aus, es gelten Rolle und Bereich. |
| `LIBREOFFICE_PATH`, `LIBREOFFICE_TIMEOUT_MS`                      | nein              | `soffice` für Folienbilder (im Image enthalten); Zeitlimit, Standard 2 Minuten.                                   |
| `LIBREOFFICE_WORKERS`                                             | nein              | Dauerhaft laufende LibreOffices für den Editor, Standard 2 (je ~300 MB), `0` = aus.                               |
| `PDF_TIMEOUT_MS`                                                  | nein              | Zeitlimit für das Lesen eines PDFs, Standard 2 Minuten plus 1 Sekunde pro Seite.                                  |
| `UNSPLASH_ACCESS_KEY`                                             | nein              | Fotosuche im Editor und Fotos der KI: Access Key einer Unsplash-App.                                              |
| `ANTHROPIC_API_KEY`                                               | nein (Seite)      | KI-Key der Instanz, beim Start einmal übernommen; danach unter „Integrationen“.                                   |
| `MISTRAL_API_KEY`, `BFL_API_KEY`                                  | nein (Seite)      | Sprache zu Text (Mistral) und Bilder (Black Forest Labs), einmal übernommen wie der KI-Key.                       |
| `AI_ALLOW_INTERNAL_URLS`                                          | nein              | `true`: OpenAI-kompatibler Dienst der Instanz darf intern/http sein (Ollama, vLLM).                               |
| `REMBG_URL`                                                       | nein              | Freistellen durch die KI: Adresse von rembg, z. B. `http://rembg:7000`.                                           |
| `REMBG_MODEL`                                                     | nein              | Modell von rembg, Standard `isnet-general-use`.                                                                   |
| `SPEECH_URL`                                                      | nein              | Sprache zu Text auf dem eigenen Server: Adresse von deploy/stt, z. B. `http://stt:8000/v1`.                       |
| `SPEECH_MODEL`                                                    | nein              | Modell von deploy/stt, Standard `whisper-large-v3-turbo`.                                                         |
| `RSPAMD_URL`                                                      | nein              | Spamfilter: Adresse von Rspamd (Profil `spam`), z. B. `http://rspamd:11333`.                                      |
| `RSPAMD_PASSWORD`                                                 | nein              | Passwort von Rspamds Controller (ab 12 Zeichen): damit lernt er aus Entscheidungen.                               |
| `RSPAMD_CONTROLLER_URL`                                           | nein              | Nur wenn Rspamds Controller nicht unter `RSPAMD_URL` auf Port 11334 liegt.                                        |
| `CALL_DOMAIN`                                                     | nein              | Anrufe mit bis zu 50 Personen über LiveKit (Profil `call`), siehe [oben](#anrufe-mit-vielen-personen-optional).   |
| `LIVEKIT_NODE_IP`                                                 | nein (Compose)    | Öffentliche IPv4 für LiveKit, wenn STUN eine falsche findet.                                                      |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`            | nein              | Ein LiveKit anderswo statt des Profils (`wss://…`, Schlüsselpaar dann Pflicht); `LIVEKIT_API_URL` für seine API.  |
| `IMPORT_WORKERS`                                                  | nein              | Gleichzeitige Importe, Standard 1 (je ~1 Kern, 1 GB RAM).                                                         |
| `PLAN_FREE_MAX_MEMBERS`, `PLAN_FREE_MAX_DECKS`                    | nein              | Grenzen pro Workspace, Standard unbegrenzt.                                                                       |
| `PLAN_FREE_MAX_STORAGE_BYTES`                                     | nein              | Speicher pro Workspace, Standard unbegrenzt (früher `MEDIA_QUOTA_BYTES`).                                         |
| `SLIDER_DEMO`                                                     | nein              | `true` schaltet die Grenzen der gehosteten Instanz ein.                                                           |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`   | nein              | Bezahlung, nur für eine Instanz mit Grenzen. Webhook: `${SLIDER_URL}/api/billing/webhook`.                        |

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
