# Slider selbst hosten

Kurz und praktisch: Slider auf einem eigenen kleinen Server für ein Unternehmen betreiben.
Stand Oktober 2026 – Preise und Versionen sind Näherungswerte, bitte vor dem Bestellen prüfen.

> **Hinweis:** Das Docker-Image (`Dockerfile`) und die Compose-Dateien sind bisher **nicht mit
> Docker gebaut/getestet** worden (auf der Entwicklungsmaschine gibt es kein Docker). Getestet sind
> die Teile darunter: API gegen einen echten Postgres-Server inkl. Migrationen, Auslieferung der
> Web-App durch die API, Health-Check, sauberes Herunterfahren, die Caddyfile (`caddy adapt`) und
> die gefilterte Produktions-Installation (`bun install --production --filter @slider/api`),
> außerdem der Start ohne Secret und Login samt Einrichtungsseite und automatischem Neustart
> (Supervisor, ohne Docker). Das Image baut erstmals der Workflow `.github/workflows/image.yml`.
> Beim ersten echten `docker compose up` also genau hinschauen (siehe [Fehlersuche](#fehlersuche)).

## Aufbau

```
Internet ──443──▶ Caddy (HTTPS, Let's Encrypt)
                    │
                    ▼
                  slider  (ein Container: Bun-API + gebaute Web-App, Port 8787)
                    │            │
                    ▼            ▼
                 Postgres     Volume /data  (Folien-Bilder, PPTX, Aufnahmen)
                    ▲
   optional: Authentik (Firmen-Login per OIDC, eigener Postgres)
```

- **Ein Deployable:** Die API liefert im Produktivbetrieb auch die Web-App aus `apps/web/dist`
  (alle Pfade außer `/api` und `/files` fallen auf `index.html` zurück). Gehashte Dateien unter
  `/assets/` werden ein Jahr gecacht, `index.html` nie. Dadurch gilt: `SLIDER_URL` = öffentliche URL.
- **Datenbank:** Mit `DATABASE_URL` ein echter Postgres (in Compose: `postgres:17`), sonst
  die eingebettete PGlite-Datenbank in `/data/db`. Migrationen laufen beim Start automatisch.
- **Dateien** liegen im Volume `/data` (`blobs/`, `media/`).
- **Health-Check:** `GET /api/health` → `200 {"ok":true}`, wenn die Datenbank antwortet.
- **Hinter Caddy:** `TRUST_PROXY=1` sorgt dafür, dass Rate-Limits die echte Client-IP aus
  `X-Forwarded-For` nehmen. Sichere Cookies gibt es automatisch mit `NODE_ENV=production`.

## Schnellstart: ein Container

Für alle, die schon einen Server mit Reverse-Proxy (Traefik, nginx, Caddy, Load Balancer) haben:

```bash
docker run -d --name slider --restart unless-stopped \
  -p 8787:8787 -v slider-data:/data \
  -e SLIDER_URL=https://slider.firma.de \
  ghcr.io/root-bert/slider:edge
docker logs slider
```

1. Im Log steht der **Einrichtungslink** `https://slider.firma.de/einrichtung#token=…`. Er gilt,
   bis das erste Konto existiert – nicht weitergeben.
2. Auf der Seite **eigene E-Mail-Adresse** (wird Instanz-Admin) und **mindestens einen
   Anmeldeweg** eintragen: E-Mail per SMTP (am schnellsten), Microsoft, Google oder SSO (OIDC).
   Die Weiterleitungs-URIs für Microsoft/Google/SSO zeigt die Seite zum Kopieren an.
3. **Speichern** – Slider startet im Container kurz neu und übernimmt die Einstellungen.
4. **Anmelden** mit der Admin-Adresse. Später ändert der Admin alles unter Konto →
   **Einrichtung** (`/einrichtung`).

Was dabei automatisch passiert:

- `SLIDER_SECRET` wird beim ersten Start erzeugt und liegt in `/data/secret` (nur für den Server
  lesbar). Ein selbst gesetzter `SLIDER_SECRET` hat Vorrang.
- Ohne `DATABASE_URL` liegt die Datenbank (PGlite) in `/data/db`. Für mehr als ein kleines Team
  lieber Postgres (`DATABASE_URL`, siehe Compose unten).
- Die Einstellungen der Seite liegen in der Datenbank (Tabelle `instance_settings`), Secrets und
  das SMTP-Passwort AES-GCM-verschlüsselt mit `SLIDER_SECRET`. **Umgebungsvariablen haben immer
  Vorrang** und erscheinen auf der Seite schreibgeschützt – wer lieber alles per `.env` steuert,
  kann das weiter tun.
- Hinter dem Proxy `-e TRUST_PROXY=1` setzen, damit Rate-Limits die echte Besucher-IP sehen –
  aber nur, wenn Port 8787 nicht öffentlich erreichbar ist (`-p 127.0.0.1:8787:8787`).
- Ein festes Release statt `:edge` (Stand von `main`): `ghcr.io/root-bert/slider:1`, sobald
  Versionen getaggt sind.

Alle Daten liegen im Volume `slider-data` – das ist das, was gesichert werden muss.

## Voraussetzungen

- Ein Linux-Server mit Docker + Compose-Plugin, öffentlicher IPv4/IPv6, Ports 80 und 443 offen.
  - Nur Slider: 2 vCPU, 4 GB RAM, 40 GB SSD reichen für ein Team (z. B. Hetzner CX23).
  - Mit Authentik: **8 GB RAM** einplanen (Authentik braucht laut Doku mind. 2 CPU-Kerne und
    2 GB RAM zusätzlich), z. B. Hetzner CX33.
  - x86 (amd64) ist der Normalfall. ARM (z. B. Hetzner CAX) sollte gehen – alle Basis-Images und
    `@napi-rs/canvas` gibt es für arm64 –, ist aber ungetestet.
- Eine (Sub-)Domain, z. B. `slider.firma.de`, deren A-/AAAA-Record auf den Server zeigt.
- Mindestens ein Login-Weg: Microsoft (Entra), OIDC (z. B. Authentik) oder E-Mail (SMTP).
  Im Produktivbetrieb startet Slider ohne Login-Weg nicht.

## Schritt für Schritt (Hetzner-VPS)

1. **Server anlegen:** Hetzner Console → Server → Ubuntu 24.04, Typ CX23 (bzw. CX33 mit
   Authentik), SSH-Key hinterlegen. Optional: Backups aktivieren (+20 % vom Serverpreis).
2. **Firewall:** In der Hetzner-Firewall nur 22 (SSH), 80 und 443 (TCP) sowie 443/UDP (HTTP/3)
   erlauben.
3. **DNS:** Beim Domain-Anbieter `A slider.firma.de → <IPv4>` (und `AAAA → <IPv6>`) setzen.
   Warten, bis `dig +short slider.firma.de` die IP liefert – sonst schlägt das Zertifikat fehl.
4. **Docker installieren** (als root):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
5. **Slider holen und konfigurieren:**
   ```bash
   git clone <repo-url> /opt/slider
   cd /opt/slider/deploy
   cp .env.example .env
   sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
   chmod 600 .env
   nano .env   # SLIDER_DOMAIN – alles andere geht auch im Browser
   ```
   Login, `BOOTSTRAP_EMAIL` und `SIGNUP` können hier stehen oder auf der Einrichtungsseite
   gesetzt werden (Schritt 6). Was in `.env` steht, hat Vorrang. `SIGNUP` steht standardmäßig
   auf `open` – für eine reine Firmen-Instanz eher `invite` oder `domains` wählen.
6. **Starten und einrichten:**
   ```bash
   docker compose up -d                 # zieht ghcr.io/root-bert/slider:edge
   docker compose logs slider           # Einrichtungslink …/einrichtung#token=…
   curl -s https://slider.firma.de/api/health   # {"ok":true}
   ```
   Den Link öffnen, eigene Adresse und einen Anmeldeweg eintragen, speichern – wie im
   [Schnellstart](#schnellstart-ein-container). Wer das Image aus dem Checkout bauen will:
   `SLIDER_IMAGE=slider:local docker compose up -d --build` (dauert einige Minuten).
   Danach sofort selbst anmelden – mit der Admin-Adresse (`BOOTSTRAP_EMAIL`). Dieses Konto ist
   Instanz-Admin; alle Weiteren kommen per Einladung oder über `SIGNUP`. Neue Konten haben noch
   keine Organisation: Nach dem ersten Login gründen sie eine oder treten per Einladungslink bei.
7. **Microsoft-Login** (falls genutzt): In der Entra-App-Registrierung unter _Authentication_ die
   Redirect-URI `https://slider.firma.de/api/auth/microsoft/callback` ergänzen (Typ _Web_).

Ohne Docker geht es auch: `bun install --frozen-lockfile && bun run build`, dann
`NODE_ENV=production bun apps/api/src/server.ts` (oder `bun run start`). Die Konfiguration kommt
dann aus der Umgebung; Bun liest zusätzlich eine `.env` im aktuellen Ordner, falls vorhanden –
eine fehlende `.env` ist kein Fehler. Davor einen Reverse-Proxy mit HTTPS setzen.

## Umgebungsvariablen

In Compose stehen sie in `deploy/.env` (Vorlage: `deploy/.env.example`). `NODE_ENV`, `PORT`,
`DATA_DIR`, `SLIDER_URL`, `DATABASE_URL` und `TRUST_PROXY` setzt `docker-compose.yml` selbst.
Mit „Seite“ markierte Werte lassen sich auch auf der Einrichtungsseite (`/einrichtung`) setzen;
die Umgebungsvariable hat dann Vorrang.

| Variable                                              | Pflicht                    | Bedeutung                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLIDER_DOMAIN`                                       | ja (Compose)               | Öffentlicher Hostname; daraus wird `SLIDER_URL=https://<domain>`.                                                                                                                                                                                                                         |
| `POSTGRES_PASSWORD`                                   | ja (Compose)               | Passwort des Postgres-Users `slider`. Nur Hex (`openssl rand -hex 24`), da es in der URL landet.                                                                                                                                                                                          |
| `SLIDER_SECRET`                                       | nein                       | ≥ 32 Zeichen, signiert Sessions/Gast-Cookies, verschlüsselt Microsoft-Tokens und gespeicherte Einstellungen. Leer: beim ersten Start erzeugt und in `DATA_DIR/secret` abgelegt. Ändern meldet alle ab und macht gespeicherte Microsoft-Verbindungen und Einstellungen der Seite ungültig. |
| `SLIDER_URL`                                          | ja (ohne Compose)          | Öffentliche URL, z. B. `https://slider.firma.de` (CORS, Redirect-URIs, Links in Mails). Früherer Name: `WEB_ORIGIN` (geht weiter).                                                                                                                                                        |
| `DATABASE_URL`                                        | nein                       | `postgres://user:pass@host:5432/db`. Leer = PGlite in `DATA_DIR/db`.                                                                                                                                                                                                                      |
| `DATA_DIR`                                            | nein                       | Daten-Ordner (Container: `/data`).                                                                                                                                                                                                                                                        |
| `WEB_DIST_DIR`                                        | nein                       | Gebaute Web-App; Standard in Produktion `apps/web/dist`.                                                                                                                                                                                                                                  |
| `TRUST_PROXY`                                         | nein                       | `1` hinter Caddy/Proxy. Nur setzen, wenn die API nicht direkt erreichbar ist.                                                                                                                                                                                                             |
| `SIGNUP`                                              | nein (Seite)               | `open` (Standard) = jeder, der sich anmelden kann – das Konto entsteht beim ersten Login · `invite` = nur Eingeladene · `domains` = alle mit E-Mail aus `SIGNUP_DOMAINS`.                                                                                                                 |
| `SIGNUP_DOMAINS`                                      | bei `domains` (Seite)      | Kommagetrennt, z. B. `firma.de,firma.com`.                                                                                                                                                                                                                                                |
| `BOOTSTRAP_EMAIL`                                     | dringend empfohlen (Seite) | Kommagetrennt, z. B. `ich@firma.de`. Nur diese (verifizierte) Adresse darf das erste Konto (Instanz-Admin) anlegen; die Einrichtungsseite fragt sie in Produktion ab. Leer: nur, wen `SIGNUP=open`/`domains` ohnehin zulässt (bei `invite` niemand), plus Warnung im Log.                 |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`                    | eine Login-Art (Seite)     | Entra-App (Login + OneDrive/SharePoint-Import).                                                                                                                                                                                                                                           |
| `MS_TENANT`                                           | nein (Seite)               | `common` (Standard) oder die Tenant-ID, um nur die eigene Firma zuzulassen.                                                                                                                                                                                                               |
| `MS_REDIRECT_URI`                                     | nein                       | Standard `${SLIDER_URL}/api/auth/microsoft/callback` – genau so in Entra eintragen.                                                                                                                                                                                                       |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`            | eine Login-Art (Seite)     | „Weiter mit Google“ – OAuth-Client aus der Google Cloud Console (siehe unten). Nur zusammen.                                                                                                                                                                                              |
| `GOOGLE_REDIRECT_URI`                                 | nein                       | Standard `${SLIDER_URL}/api/auth/google/callback` – genau so bei Google eintragen.                                                                                                                                                                                                        |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | eine Login-Art (Seite)     | z. B. Authentik: `https://auth.firma.de/application/o/slider/`.                                                                                                                                                                                                                           |
| `OIDC_LABEL`, `OIDC_SCOPES`, `OIDC_REDIRECT_URI`      | nein                       | Button-Text, Scopes (`openid profile email`), Redirect (Standard `${SLIDER_URL}/api/auth/oidc/callback`).                                                                                                                                                                                 |
| `SMTP_URL`, `MAIL_FROM`                               | eine Login-Art (Seite)     | Login-Mails (Link + Code) und Einladungen, z. B. `smtps://user:pass@smtp.anbieter.de:465` und `Slider <slider@firma.de>`. Nur zusammen. Die Seite setzt die URL aus Server, Port, Benutzer und Passwort zusammen.                                                                         |
| `SESSION_TTL_DAYS`                                    | nein                       | Login-Dauer, Standard 30.                                                                                                                                                                                                                                                                 |
| `MAX_UPLOAD_BYTES`                                    | nein                       | Max. PPTX-Größe, Standard 200 MB.                                                                                                                                                                                                                                                         |
| `MEDIA_QUOTA_BYTES`, `MAX_MEDIA_BYTES`                | nein                       | Speicher für Sprach-/Video-Kommentare pro Deck-Besitzer (Standard 5 GB) bzw. pro Aufnahme (100 MB).                                                                                                                                                                                       |
| `SYNC_POLL_INTERVAL_MS`, `SYNC_DEBOUNCE_MS`           | nein                       | Automatische Updates verlinkter Decks (Standard 2 min / 1 min, `0` = aus).                                                                                                                                                                                                                |
| `PLAN_FREE_MAX_MEMBERS`                               | nein                       | Plätze pro Organisation im Free-Plan: Mitglieder plus offene E-Mail-Einladungen. Standard 5, `0` = unbegrenzt.                                                                                                                                                                            |
| `PLAN_FREE_MAX_DECKS`                                 | nein                       | Präsentationen pro Organisation im Free-Plan (archivierte zählen mit). Standard 3, `0` = unbegrenzt.                                                                                                                                                                                      |
| `LIBREOFFICE_PATH`                                    | nein                       | Pfad zu LibreOffices `soffice` für die Folienbilder hochgeladener Decks. Leer = `soffice` im `PATH` (im Docker-Image enthalten), sonst `/Applications/LibreOffice.app/…` (macOS).                                                                                                         |

## Folienbilder

Slider zeigt Folien so, wie PowerPoint sie zeichnet (Master, Theme-Schriften, Verläufe, Formen):

- **Verlinkte Decks (OneDrive/SharePoint):** Office rendert die Datei als PDF (Microsoft Graph,
  `…/content?format=pdf`) – nur mit Microsoft-Login (`MS_CLIENT_ID`/`MS_CLIENT_SECRET`).
- **Hochgeladene Decks** – und verlinkte, wenn Office nicht verfügbar ist: **LibreOffice**
  (`soffice --headless --convert-to pdf`, je Lauf eigenes Profil im Temp-Ordner, Abbruch nach
  120 s). Im Docker-Image ist LibreOffice Impress samt Office-kompatibler Schriften (Carlito ≙
  Calibri, Caladea ≙ Cambria, Liberation ≙ Arial/Times New Roman) enthalten; das Image wird
  dadurch ca. 0,5 GB größer.
- Jede PDF-Seite wird zu einem WebP mit 2400 px Breite (plus 640-px-Vorschaubild). Ausgeblendete
  Folien fehlen im PDF und behalten die eingebaute SVG-Vorschau; passt die Seitenzahl nicht zu den
  sichtbaren Folien, bekommen alle Folien die SVG-Vorschau.
- **Ohne beides** (kein Microsoft-Login, kein LibreOffice) zeigt Slider die eingebaute
  SVG-Vorschau – brauchbar, aber nicht pixelgenau. Beim Start steht dann
  „LibreOffice is not installed …“ im Log.
- **Bestehende Decks** werden nach dem Start automatisch im Hintergrund neu gerendert (einmal pro
  Version, nacheinander), sobald ein besserer Renderer verfügbar ist. Von Hand: ⋯-Menü der
  Präsentation → **Folienbilder neu erzeugen**. Schlägt etwas fehl, bleiben die alten Bilder.

Ohne Docker (z. B. lokal auf dem Mac): `brew install --cask libreoffice`, danach findet Slider
`soffice` selbst; sonst `LIBREOFFICE_PATH` setzen. Unter Debian/Ubuntu:
`apt install --no-install-recommends libreoffice-impress fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu`.

## Login einrichten

### Microsoft (Entra ID)

Wie im README unter „Link import“ beschrieben, plus für den Server: Redirect-URI
`https://<SLIDER_DOMAIN>/api/auth/microsoft/callback` hinzufügen. Wer nur Kolleg:innen der eigenen
Firma zulassen will, setzt `MS_TENANT=<Tenant-ID>` (dann die App als „nur dieses Verzeichnis“
registrieren).

### Google

„Weiter mit Google“ erscheint, sobald `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` gesetzt sind –
neben Microsoft, SSO und E-Mail (alle gleichzeitig möglich). Es gelten dieselben Regeln wie
überall: `SIGNUP`, `BOOTSTRAP_EMAIL`, Einladungen. Slider übernimmt nur bestätigte Adressen
(`email_verified`); private Gmail-Konten funktionieren genauso wie Google-Workspace-Konten.

Einrichtung in der [Google Cloud Console](https://console.cloud.google.com/) (einmalig, ca. 10 Minuten):

1. Oben links **Projekt auswählen → Neues Projekt**, z. B. `Slider`, und es auswählen.
2. Menü **Google Auth Platform** (früher „OAuth-Zustimmungsbildschirm“) → **Jetzt starten**:
   - **Branding**: App-Name `Slider`, Support-E-Mail, optional Logo; unter _Autorisierte Domains_
     die eigene Domain (z. B. `firma.de`) eintragen.
   - **Zielgruppe** (Audience): **Extern** – sonst können sich nur Konten der eigenen
     Google-Workspace-Organisation anmelden („Intern“ ist nur dafür sinnvoll).
   - **Datenzugriff** (Data access): **Bereiche hinzufügen** → `openid`, `…/auth/userinfo.email`,
     `…/auth/userinfo.profile` (= `openid email profile`). Mehr braucht Slider nicht.
3. **Clients → Client erstellen**: Anwendungstyp **Webanwendung**, Name `Slider`.
   Unter **Autorisierte Weiterleitungs-URIs** eintragen:
   - `http://localhost:5173/api/auth/google/callback` (lokale Entwicklung, über den Vite-Proxy)
   - `https://<SLIDER_DOMAIN>/api/auth/google/callback` (Produktion)

   „Autorisierte JavaScript-Quellen“ bleiben leer. Nach **Erstellen** Client-ID und
   Clientschlüssel kopieren (der Schlüssel ist später nur noch neu erzeugbar).

4. In `.env` bzw. `deploy/.env` eintragen und Slider neu starten:
   ```env
   GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-…
   ```
5. **Zielgruppe → App veröffentlichen** („In Produktion“). Im Status „Testen“ dürfen sich nur
   eingetragene Testnutzer:innen anmelden, und Logins laufen nach 7 Tagen ab. Mit nur
   `openid email profile` ist **keine Überprüfung durch Google** nötig – die App ist sofort
   für alle nutzbar.

Wer ein Konto schon per E-Mail oder Microsoft hat, verbindet Google unter **Konto & Anmeldung**
(`/konto` → „Verbinden“) – eine Google-Anmeldung mit derselben Adresse legt kein zweites Konto an,
sondern wird mit `account_exists` abgelehnt, bis Google verbunden ist.

### Authentik (optional, eigener Identity Provider)

Sinnvoll, wenn Kund:innen kein Microsoft 365 haben oder ein zentrales Login für mehrere Tools
wollen. Läuft neben Slider auf demselben Server (Netzwerk `slider`, Caddy macht HTTPS).

1. DNS: `auth.firma.de` auf denselben Server zeigen lassen; in `deploy/.env`
   `AUTHENTIK_DOMAIN=auth.firma.de` setzen.
2. Starten:
   ```bash
   cd /opt/slider/deploy/authentik
   cp .env.example .env
   sed -i "s|^PG_PASS=.*|PG_PASS=$(openssl rand -base64 36 | tr -d '\n')|" .env
   sed -i "s|^AUTHENTIK_SECRET_KEY=.*|AUTHENTIK_SECRET_KEY=$(openssl rand -base64 60 | tr -d '\n')|" .env
   chmod 600 .env
   docker compose up -d
   cp authentik.caddy ../sites/
   cd .. && docker compose up -d --force-recreate caddy
   ```
3. Ersteinrichtung: `https://auth.firma.de/if/flow/initial-setup/` öffnen und das Passwort für
   `akadmin` setzen.
4. Im Admin-Interface → _Applications_ → _Applications_ → **Create with provider**:
   - Application: Name `Slider`, Slug **`slider`** (der Slug steckt in der Issuer-URL).
   - Provider-Typ **OAuth2/OpenID Connect**, Authorization flow
     `default-provider-authorization-implicit-consent` (oder `explicit`, wenn Nutzer:innen
     zustimmen sollen).
   - Client type **Confidential**; Client ID und Client Secret notieren.
   - Redirect URI (strict): `https://slider.firma.de/api/auth/oidc/callback`.
   - Signing key: das mitgelieferte `authentik Self-signed Certificate` (RS256).
   - Scopes: `openid`, `profile`, `email` (Standard-Mappings).
5. In `deploy/.env` eintragen und Slider neu starten (`docker compose up -d`):
   ```env
   OIDC_ISSUER=https://auth.firma.de/application/o/slider/
   OIDC_CLIENT_ID=<Client ID>
   OIDC_CLIENT_SECRET=<Client Secret>
   OIDC_LABEL=Weiter mit Firmen-Login
   ```
   Prüfen: `https://auth.firma.de/application/o/slider/.well-known/openid-configuration` muss
   JSON liefern.
6. Nutzer:innen in Authentik anlegen (oder Authentik an ein bestehendes Verzeichnis anbinden).
   Wer in Slider ein Konto bekommt, entscheidet weiterhin `SIGNUP`.

Authentik-Version: gepinnt auf `2026.8.3` (`AUTHENTIK_TAG`). Seit 2025.10 braucht Authentik kein
Redis mehr. Der Worker hat hier keinen Docker-Socket – Outposts müssen dann manuell betrieben
werden, für reines OIDC sind keine nötig.

### E-Mail (Link + Code, Einladungen)

Die Login-Mail enthält einen Link **und** einen 6-stelligen Code (beide 15 Minuten gültig, nur
einmal; nach 5 falschen Codes ist die Mail verbrannt). Der Code hilft, wenn die Mail auf dem Handy
gelesen wird, die Anmeldung aber am Rechner läuft. Der Link öffnet zuerst eine Bestätigungsseite
mit dem Knopf „Anmelden“; erst der Klick löst ihn ein. So verbrauchen Link-Scanner (z. B. Outlook
Safe Links), die jeden Link vorab öffnen, ihn nicht.

Jeder SMTP-Zugang geht – das vorhandene Firmen-Postfach oder ein Versanddienst mit
Gratis-Kontingent. Für ein Team reicht das locker (Stand Oktober 2026):

| Dienst                                           | `SMTP_URL`                                           | Gratis                          | Hinweise                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Resend](https://resend.com/docs/send-with-smtp) | `smtps://resend:<API_KEY>@smtp.resend.com:465`       | 3.000 Mails/Monat, max. 100/Tag | Benutzername ist wörtlich `resend`, Passwort ein API-Key. An echte Empfänger:innen erst mit **verifizierter Domain** (DNS-Einträge in Resend), vorher nur an die eigene Adresse.          |
| [Brevo](https://www.brevo.com/free-smtp-server)  | `smtp://<LOGIN>:<SMTP_KEY>@smtp-relay.brevo.com:587` | 300 Mails/Tag                   | Login und SMTP-Key stehen unter _SMTP & API_ im Brevo-Konto (nicht das Konto-Passwort). Port 587 mit STARTTLS. Absender-Domain authentifizieren (DKIM), sonst ersetzt Brevo den Absender. |

`MAIL_FROM` muss eine Adresse der verifizierten Domain sein, z. B. `Slider <slider@firma.de>`.
Sonderzeichen in Schlüsseln URL-kodieren (`/` → `%2F`, `+` → `%2B`). Absender-Domain mit SPF/DKIM
einrichten, sonst landen Mails im Spam.

**Lokal ohne SMTP:** In der Entwicklung (`NODE_ENV=development`, also `bun run dev`) ohne
`SMTP_URL` werden Mails nicht verschickt, sondern mit Link und Code in der API-Konsole ausgegeben
und die letzten 20 unter `http://localhost:5173/api/dev/mails` gelistet – die E-Mail-Anmeldung
lässt sich so sofort ausprobieren. In Produktion gibt es das nie; dort braucht E-Mail-Login SMTP.
Hinweis: Ist sonst keine Anmeldung eingerichtet, bleibt der Dev-Login aktiv (jede:r ist der
Dev-Owner) – zum Ausprobieren `AUTH_DEV_LOGIN=false` setzen.

### Passkeys

Passkeys (Fingerabdruck, Gesicht, Geräte-PIN; synchronisiert z. B. über iCloud-Schlüsselbund oder
Google Passwortmanager) brauchen keine Konfiguration. Jede:r legt sie selbst unter **Konto &
Anmeldung** (`/konto`) an; danach gibt es auf der Login-Seite „Mit Passkey anmelden“, und gespeicherte
Passkeys erscheinen auch direkt im Vorschlagsmenü des E-Mail-Felds.

- Ein Passkey meldet nur an ein **bestehendes** Konto an – das Konto entsteht immer über Microsoft,
  Google, SSO oder E-Mail. `SIGNUP` spielt für Passkeys daher keine Rolle.
- Die **RP-ID ist der Hostname von `SLIDER_URL`** (z. B. `slider.firma.de`), die erlaubte Origin
  genau `SLIDER_URL`. **Ein Domainwechsel macht alle Passkeys ungültig** – danach meldet man sich
  einmal anders an und legt neue an. Lokal ist die RP-ID `localhost`.
- Passkeys funktionieren nur über HTTPS (oder `http://localhost`).
- Gespeichert werden nur öffentlicher Schlüssel und Signaturzähler; ein Datenbank-Leak verrät
  keine Anmeldedaten. Wird ein Konto gelöscht, verschwinden seine Passkeys mit.

## Cloudflare (DNS und Schutz davor)

Liegt die Domain bei Cloudflare, bleibt Slider trotzdem auf dem eigenen Server – Cloudflare
übernimmt nur DNS und auf Wunsch den Schutz davor (kostenlos).

1. **DNS:** Cloudflare → Domain → DNS → Record hinzufügen: Typ `A`, Name `slider`, Inhalt = IPv4
   des Servers (optional `AAAA` mit der IPv6). Zuerst **„Nur DNS“ (graue Wolke)**, bis Caddy beim
   ersten Start das Zertifikat geholt hat (`docker compose logs caddy`).
2. **Proxy einschalten (orange Wolke):** danach umstellen. Unter SSL/TLS → Übersicht den Modus
   **„Vollständig (streng)“** wählen – Caddy hat ein echtes Zertifikat, „Flexibel“ würde
   Weiterleitungsschleifen erzeugen. Caddy erneuert das Zertifikat auch hinter dem Proxy
   (HTTP-Challenge über Port 80).
3. **Echte Besucher-IP:** in `deploy/.env` die Zeile `TRUSTED_PROXIES=…` (Cloudflare-Adressen,
   Liste unter <https://www.cloudflare.com/ips/>) einkommentieren und `docker compose up -d`.
   Ohne das sähe Slider nur Cloudflare-Adressen, und alle Besucher teilten sich die Rate-Limits.
4. **Optional, Server abschotten:** In der Hetzner-Firewall Port 80/443 nur für die
   Cloudflare-Adressen öffnen; dann ist der Server nur noch über Cloudflare erreichbar.
5. **Backups nach R2 (optional):** Cloudflare R2 (10 GB gratis) als Ziel für `pg_dump` und das
   `/data`-Volume, z. B. mit `rclone`.

Hinweis: Cloudflare begrenzt Uploads im Free-Plan auf 100 MB pro Anfrage, Slider erlaubt
PowerPoints bis 200 MB. Mit orange Wolke deshalb in `deploy/.env` `MAX_UPLOAD_BYTES=94371840`
(90 MB) und `MAX_MEDIA_BYTES=94371840` setzen, damit Slider zu große Dateien selbst mit einer
klaren Meldung ablehnt statt eines Cloudflare-Fehlers.

## Mehrere Apps auf einem Server

Normalerweise bringt `deploy/docker-compose.yml` einen eigenen Caddy mit, der nur Slider
ausliefert. Sollen auf demselben Server weitere Apps laufen, übernimmt ein **gemeinsamer Caddy**
aus `deploy/proxy/` die Ports 80/443 für alle; jede App hängt sich an das Docker-Netz `web` und
bekommt eine Datei in `deploy/proxy/sites/`.

```
Internet ──443──▶ Caddy (deploy/proxy)  ── Netz „web“ ──▶ slider:8787
                                                       ├─▶ app2:3000
                                                       └─▶ authentik-server:9000
```

1. **Proxy starten:**
   ```bash
   cd deploy/proxy
   cp .env.example .env              # hinter Cloudflare: TRUSTED_PROXIES einkommentieren
   cp examples/slider.caddy sites/   # Domain darin eintragen
   docker compose up -d
   ```
2. **Slider umhängen:** in `deploy/.env` ergänzen
   `COMPOSE_FILE=docker-compose.yml:docker-compose.shared-proxy.yml`. Damit startet der eigene
   Caddy nicht mehr, und Slider hängt zusätzlich im Netz `web` (Postgres bleibt privat). Bei einer
   bestehenden Installation zuerst den alten Caddy entfernen, damit die Ports frei werden:
   ```bash
   cd deploy
   docker compose rm -sf caddy
   docker compose up -d
   ```
   Caddy holt die Zertifikate dabei einmal neu.
3. **Weitere App:** deren `docker-compose.yml` hängt den Dienst ins Netz `web`
   (Vorlage: `deploy/proxy/examples/app.caddy`), dann `examples/app.caddy` nach `sites/` kopieren,
   Domain und `dienst:port` eintragen und neu laden:
   ```bash
   docker compose -f deploy/proxy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```
   Der Dienstname muss im Netz `web` eindeutig sein (also nicht `app`, `web` oder `db`). Datenbanken
   der Apps gehören nicht ins Netz `web`.
4. **Authentik** (falls genutzt): in `deploy/authentik/.env` `PROXY_NETWORK=web` setzen, die Domain
   in `authentik.caddy` eintragen und die Datei nach `deploy/proxy/sites/` kopieren.

Tipp: Mit mehreren Apps lohnt ein RAM-Limit für Slider (LibreOffice braucht beim Umwandeln kurz
einige hundert MB), z. B. in `docker-compose.shared-proxy.yml` unter `slider:` `mem_limit: 1g`.

## Backups

Wichtig sind **zwei** Dinge: die Datenbank und das Volume `/data`.

```bash
cd /opt/slider/deploy
mkdir -p /opt/backups
# Datenbank (konsistent, im laufenden Betrieb)
docker compose exec -T postgres pg_dump -U slider -Fc slider > /opt/backups/slider-$(date +%F).dump
# Dateien
docker run --rm -v slider_slider-data:/data -v /opt/backups:/backup debian:bookworm-slim \
  tar czf /backup/slider-data-$(date +%F).tar.gz -C /data .
```

- Per Cron täglich ausführen und die Dateien **außer Haus** kopieren (z. B. Hetzner Storage Box,
  `restic`/`borg`). Alte Backups rotieren.
- Hetzner-Server-Backups (+20 %) sind ein bequemes Sicherheitsnetz, ersetzen aber kein
  `pg_dump` (Snapshots einer laufenden Datenbank sind nicht garantiert konsistent).
- Wiederherstellen: `docker compose exec -T postgres pg_restore -U slider -d slider --clean < datei.dump`
  und das Tar-Archiv zurück ins Volume entpacken.
- Ohne `DATABASE_URL` (PGlite) liegt die Datenbank in `/data/db`: dann Slider kurz stoppen und
  das Volume sichern.
- Authentik: `docker compose exec -T authentik-db pg_dump -U authentik -Fc authentik > …`.

## Updates

```bash
cd /opt/slider/deploy
docker compose pull              # neues Image (ghcr.io/root-bert/slider)
docker compose up -d             # Migrationen laufen beim Start
docker image prune -f
```

Nur `docker run`: `docker pull ghcr.io/root-bert/slider:edge`, Container löschen und mit
denselben Optionen neu starten – die Daten liegen im Volume. Eigener Build aus dem Checkout:
nach dem Aktualisieren des Repos `SLIDER_IMAGE=slider:local docker compose up -d --build`.

Vorher ein Backup ziehen. Postgres-Major-Updates (17 → 18) brauchen `pg_dump`/`pg_restore`;
das Image-Tag also nicht einfach hochsetzen. Authentik: `AUTHENTIK_TAG` anheben, Release Notes
lesen, `docker compose pull && docker compose up -d` in `deploy/authentik`.

## Kosten (Stand Oktober 2026, ca.-Werte)

| Posten                                                       | Monatlich             | Anmerkung                                                                                    |
| ------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------- |
| Hetzner CX23 (2 vCPU, 4 GB, 40 GB)                           | ca. 6–7 € brutto      | Nach der Preisanpassung vom Juni 2026 ca. 5,49 € netto zzgl. IPv4. Reicht für Slider allein. |
| Hetzner CX33 (4 vCPU, 8 GB, 80 GB)                           | ca. 10–11 € brutto    | Nötig, wenn Authentik mitläuft (+2 GB RAM Bedarf).                                           |
| Server-Backups bei Hetzner                                   | +20 % vom Serverpreis | Optional, zusätzlich zu `pg_dump`.                                                           |
| Domain                                                       | ca. 1 €               | (ca. 5–15 € pro Jahr)                                                                        |
| Microsoft Entra App-Registrierung, Login, Graph-Dateizugriff | 0 €                   | Registrierung, Anmeldung und delegierter Lesezugriff über Graph kosten nichts.               |
| Authentik                                                    | 0 €                   | Open Source; kostet nur RAM (größerer Server, s. o.).                                        |
| E-Mail (SMTP)                                                | 0 €                   | Gratis-Kontingente der Versanddienste oder vorhandenes Postfach.                             |
| Let's Encrypt-Zertifikate                                    | 0 €                   | Caddy holt und erneuert sie automatisch.                                                     |

**Realistisch: ca. 7 € im Monat** (nur Slider) bzw. **ca. 11–13 €** mit Authentik und Backups.
Es gibt **keine Kosten pro Nutzer:in** – Slider hat keine Lizenz- oder API-Gebühren. Hetzner-Preise
sind 2026 zweimal gestiegen; die CX-Reihe ist zeitweise nicht in jedem Standort bestellbar –
vor dem Bestellen in der Hetzner Console prüfen.

Was die Kosten treiben könnte, ist **Speicher**: PPTX-Dateien, Folienbilder und vor allem
Sprach-/Video-Kommentare. Deshalb:

- **`SIGNUP`**: Standard ist `open` – jede Person, die sich anmelden kann, bekommt ein Konto und
  darf eine eigene Organisation gründen (mit den Grenzen des Free-Plans, siehe unten). Für eine
  Firmen-Instanz ist `SIGNUP=invite` (Konten nur per Einladung) oder `SIGNUP=domains` mit
  `SIGNUP_DOMAINS=firma.de` meist die bessere Wahl: Fremde können sich dann nicht selbst
  registrieren, Decks hochladen und so Speicher verbrauchen.
- **Free-Plan** pro Organisation: 5 Plätze (Mitglieder plus offene E-Mail-Einladungen) und
  3 Präsentationen. Jedes Konto darf eine Organisation selbst gründen; beitreten (per Einladung)
  kann es beliebig vielen. Auf dem eigenen Server lassen sich die Grenzen mit
  `PLAN_FREE_MAX_MEMBERS` / `PLAN_FREE_MAX_DECKS` ändern oder mit `0` aufheben. Bestehende
  Organisationen über der Grenze behalten ihre Decks, können aber keine neuen anlegen.
- **Review-Links sind nur zum Ansehen**: Gäste ohne Konto sehen die Folien und Kommentare, können
  aber nicht kommentieren. Kommentieren ist Mitgliedern der Organisation vorbehalten.
- `MEDIA_QUOTA_BYTES` und `MAX_UPLOAD_BYTES` begrenzen den Speicher pro Person bzw. Datei.
- Platz im Blick behalten: `docker system df -v`, `df -h`. Mehr Platz gibt es per Hetzner Volume
  (wenige Cent pro GB und Monat) oder Server-Upgrade.

## Sicherheits-Checkliste

- [ ] `.env`-Dateien niemals committen (sind in `.gitignore` und `.dockerignore`), Rechte `600`.
- [ ] `SLIDER_SECRET`, `POSTGRES_PASSWORD`, `AUTHENTIK_SECRET_KEY` lang und zufällig; bei Verdacht
      rotieren (`SLIDER_SECRET` neu → alle müssen sich neu anmelden, Microsoft-Verbindungen neu
      herstellen). Client Secrets in Entra/Authentik ebenfalls rotieren und Ablaufdaten notieren.
- [ ] Nur HTTPS: Caddy leitet HTTP automatisch um; Slider setzt HSTS und sichere Cookies.
- [ ] Nur Caddy veröffentlicht Ports (80/443). Slider (8787) und Postgres (5432) sind nicht von
      außen erreichbar – so bleibt auch `TRUST_PROXY=1` sicher.
- [ ] Firewall: nur 22, 80, 443. SSH nur mit Key, `PasswordAuthentication no`.
- [ ] Sicherheitsupdates: `unattended-upgrades` aktivieren, Slider/Authentik regelmäßig updaten.
- [ ] `BOOTSTRAP_EMAIL` gesetzt und das erste Konto selbst angelegt.
- [ ] `SIGNUP` bewusst gewählt: `open` (Standard) nur, wenn sich wirklich jede:r registrieren
      soll – sonst `invite` oder `domains`.
- [ ] Backups automatisch, außer Haus, und Wiederherstellung einmal ausprobiert.

## Fehlersuche

- `docker compose logs slider` – Konfigurationsfehler stehen beim Start im Log
  (z. B. „SLIDER_URL must be set in production“, „BOOTSTRAP_EMAIL is not set“).
- Einrichtungslink verloren → er steht bei jedem Start im Log, solange es kein Konto gibt
  (`docker logs slider`); die Datei `/data/setup-token` hält ihn.
- Login-Seite sagt „Anmeldung nicht eingerichtet“ → noch kein Anmeldeweg: Einrichtungslink aus
  dem Log öffnen (vor dem ersten Konto) oder als Admin `/einrichtung`.
- Nach dem Speichern auf der Einrichtungsseite „Starte den Slider-Server neu“ → Slider läuft ohne
  den Supervisor des Images (z. B. `bun apps/api/src/server.ts`); von Hand neu starten.
- „The settings saved on the setup page are invalid“ im Log → Slider startet ohne sie; Werte als
  Admin auf `/einrichtung` korrigieren (oder per Umgebungsvariable überschreiben).
- Erste Anmeldung scheitert mit `signup_closed` → `BOOTSTRAP_EMAIL`
  fehlt oder passt nicht zur Adresse, mit der man sich anmeldet; setzen und neu starten.
- `No web app at /app/apps/web/dist` → der Web-Build im Image fehlt; Build-Log prüfen.
- Zertifikat schlägt fehl → DNS zeigt noch nicht auf den Server oder Port 80 ist zu
  (`docker compose logs caddy`).
- Microsoft „AADSTS50011 redirect URI mismatch“ → Redirect-URI in Entra exakt wie
  `https://<domain>/api/auth/microsoft/callback` eintragen.
- Google „Error 400: redirect_uri_mismatch“ → Weiterleitungs-URI im Google-Client exakt wie
  `https://<domain>/api/auth/google/callback` eintragen (ohne Schrägstrich am Ende).
- Google „Zugriff blockiert: … nur für Testnutzer“ → App unter _Zielgruppe_ veröffentlichen.
- Passkey-Anmeldung schlägt nach Umzug fehl → neue Domain = neue RP-ID; Passkeys neu anlegen.
- Folien sehen anders aus als in PowerPoint → im Log nach „Office PDF …“, „PDF (…) of deck …“
  oder „LibreOffice …“ suchen. Fehlen Firmenschriften, rendert LibreOffice mit Ersatzschriften:
  Schriftdateien (`.ttf`/`.otf`) in den Container nach `/usr/local/share/fonts/` legen. Danach im
  ⋯-Menü **Folienbilder neu erzeugen**.
- OIDC „issuer mismatch“ → `OIDC_ISSUER` muss der Issuer aus der Discovery-URL sein
  (bei Authentik mit `/application/o/<slug>/`).
