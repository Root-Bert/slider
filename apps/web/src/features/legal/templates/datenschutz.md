# Datenschutzerklärung

Stand: {{date}}

Diese Erklärung beschreibt, welche personenbezogenen Daten diese Slider-Instanz verarbeitet, wozu und wie lange – und welche Rechte du hast. Slider ist ein Werkzeug, um Präsentationen gemeinsam zu prüfen und zu kommentieren.

## 1. Verantwortlicher

{{name}}
{{street}}
{{city}}
E-Mail: {{email}}

## 2. Das Wichtigste in Kürze

- Kein Tracking, keine Werbung, keine Analyse-Tools. Schriften und Bilder liefert Slider selbst aus; beim Aufruf werden keine Dritten eingebunden{{#stockPhotos}} – nur wenn du beim Bearbeiten nach Fotos suchst, kommen deren Vorschaubilder von Unsplash (Abschnitt 6){{/stockPhotos}}.
- Es gibt nur technisch notwendige Cookies.
- Die Daten liegen auf Servern in der EU.
- KI gibt es nur in Workspaces, deren Admins einen KI-Dienst angebunden haben – und sie arbeitet nur, wenn jemand sie in einem Kommentar darum bittet oder ihr auf der Materialseite eine Notiz übergibt (Abschnitt 6).
- Eine KI-App wie Claude oder ChatGPT bekommt deine Daten nur, wenn du sie selbst mit deinem Konto verbindest (Abschnitt 6).
- Deine Daten kannst du jederzeit selbst herunterladen oder löschen – unter „Konto & Anmeldung“{{#mail}}, oder ohne Anmeldung unter /datenanfrage{{/mail}}.

## 3. Hosting und Server-Logs

Slider läuft auf Servern von {{hoster}} in Rechenzentren in der EU. Mit dem Anbieter besteht ein Vertrag zur Auftragsverarbeitung.

{{#cloudflare}}
Vor dem Server steht Cloudflare (Cloudflare, Inc., USA) für Namensauflösung und Schutz vor Angriffen. Dabei verarbeitet Cloudflare deine IP-Adresse und technische Angaben zur Anfrage. Mit Cloudflare besteht ein Vertrag zur Auftragsverarbeitung; die Übermittlung in die USA stützt sich auf das EU-US Data Privacy Framework und Standardvertragsklauseln.
{{/cloudflare}}

Zugriffsprotokolle speichern wir nicht. IP-Adressen werden nur zur Abwehr von Missbrauch, etwa der Begrenzung zu vieler Anfragen, im Arbeitsspeicher gehalten und nach spätestens einer Stunde verworfen. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).

## 4. Konto und Anmeldung

Für dein Konto speichern wir deinen Namen, deine E-Mail-Adresse und die Farbe, die du für deine Markierungen gewählt hast. Du meldest dich über einen dieser Wege an:

{{#microsoft}}
- Microsoft-Konto (Microsoft Ireland Operations Ltd.)
{{/microsoft}}
{{#google}}
- Google-Konto (Google Ireland Ltd.)
{{/google}}
{{#oidc}}
- Firmen-Login (SSO) über {{oidcProvider}}
{{/oidc}}
{{#nextcloud}}
- Nextcloud-Konto: bei {{nextcloudOperator}} oder bei einer anderen Nextcloud, deren Adresse du angibst
{{/nextcloud}}
{{#mail}}
- Login-Link per E-Mail: wir schicken einen Link an deine Adresse, der 15 Minuten gilt (Versand über {{mailer}}, siehe Abschnitt 7)
{{/mail}}
- Passkey (auf deinem Gerät; wir speichern nur einen öffentlichen Schlüssel)

Bei der Anmeldung über einen dieser Anbieter erhalten wir von dort deinen Namen, deine E-Mail-Adresse und eine Kennung deines Kontos. Für die Verarbeitung bei den Anbietern sind diese selbst verantwortlich; es gelten deren Datenschutzerklärungen.

{{#nextcloud}}
Meldest du dich mit einer Nextcloud über ihre Adresse an, erhalten wir von ihr zusätzlich ein App-Passwort. Damit ist sie zugleich als Speicherort verbunden: Slider liest darüber nur Präsentationen, die du einfügst, und ändert nichts. Das App-Passwort speichern wir verschlüsselt, du kannst es jederzeit in Slider trennen oder in deiner Nextcloud widerrufen. Entsteht dabei ein neues Konto, schicken wir zuerst einen Bestätigungslink an die E-Mail-Adresse aus der Nextcloud; ohne Bestätigung speichern wir nichts.
{{/nextcloud}}

Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO). Ohne Konto kannst du Slider nicht nutzen.

**Verwaltung der Instanz:** Als Betreiber sehen wir in einer Übersicht zu jedem Konto Name, E-Mail-Adresse, wann es angelegt und zuletzt genutzt wurde und in wie vielen Workspaces es ist; zu jedem Workspace Name, Logo, Firmen-Domain, Plan, Zahl der Mitglieder und Präsentationen und den belegten Speicher. Inhalte zeigt diese Übersicht nicht: keine Präsentationen und ihre Titel, keine Kommentare oder Aufnahmen und nicht, wer in welchem Workspace ist. Wir nutzen sie für den Betrieb, für Pläne und um Missbrauch zu unterbinden. Missbraucht ein Konto oder ein Workspace den Dienst oder verstößt gegen geltendes Recht, können wir das Konto oder den Workspace sperren: Ein gesperrtes Konto kann sich nicht mehr anmelden, einen gesperrten Workspace kann niemand mehr öffnen, seine Mitglieder können nur noch austreten. Gelöscht wird dabei nichts, und deine Rechte aus Abschnitt 11 kannst du weiter{{#mail}} über /datenanfrage{{/mail}} wahrnehmen. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und rechtmäßigen Betrieb (Art. 6 Abs. 1 lit. f DSGVO).

## 5. Verbundene Speicherorte

Präsentationen, die du hochlädst, liegen nur bei uns.

{{#nextcloud}}
Du kannst eine Nextcloud als Speicherort verbinden: bei {{nextcloudOperator}} oder bei einer anderen Nextcloud, deren Adresse du selbst angibst. Welche das ist, entscheidest allein du; für die Verarbeitung dort ist ihr Betreiber verantwortlich, es gilt dessen Datenschutzerklärung. Beim Verbinden gibt uns deine Nextcloud ein App-Passwort für dein Konto dort. Wir speichern es verschlüsselt und nutzen es nur zum Lesen: Slider zeigt dir beim Auswählen deine Ordner und Dateien, holt die Präsentationen, die du einfügst, und schaut nach, ob es von ihnen eine neue Version gibt. Wir ändern und löschen in deiner Nextcloud nichts und speichern von dort nur die Präsentationen, die du einfügst, samt den Namen, die die Nextcloud als Besitzer oder Bearbeiter nennt (siehe Abschnitt 6). Trennst du die Verbindung in Slider, widerrufen wir das App-Passwort bei deiner Nextcloud und löschen es bei uns; widerrufen kannst du es auch selbst in deiner Nextcloud unter Einstellungen, Sicherheit.
{{/nextcloud}}

Fügst du einen öffentlichen Link zu einer Präsentation ein, lädt Slider die Datei von unserem Server aus von dort, ohne Angaben zu dir mitzuschicken.

Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.

## 6. Präsentationen, Kommentare und Aufnahmen

Wir speichern die Präsentationen, die du hochlädst oder verknüpfst (Originaldatei und daraus erzeugte Folienbilder), Schriften, die ein Workspace hochlädt, sowie Kommentare, Markierungen, Zeichnungen und Reaktionen auf Kommentare (Daumen hoch, Daumen runter, egal). Sprach- und Videokommentare zeichnet dein Browser nur auf, wenn du die Aufnahme startest; Mikrofon und Kamera geben erst nach deiner Erlaubnis frei.

**Material:** Neben den Folien hat jede Präsentation eine Seite „Material“, auf der Mitglieder Notizen, Links und Dateien ablegen{{#nextcloud}} – auch aus einer verbundenen Nextcloud{{/nextcloud}}. Wir speichern sie mit dem Namen der Person, die sie abgelegt hat, und lesen den Text der Dateien aus, damit Suche und KI ihn finden. Links ruft Slider nicht auf. Übergibt jemand der KI eine Notiz (⌘↵), steht ihre Antwort unter der Notiz – für alle, die das Material sehen.

Präsentationen, Material und Kommentare sehen nur die Mitglieder des Workspace, in dem sie liegen. Wer gerade im Workspace ist und wer dieselbe Präsentation ansieht, wird den anderen Mitgliedern live angezeigt; das wird nicht gespeichert.

**KI:** Admins eines Workspace können einen KI-Dienst anbinden – mit einem API-Schlüssel des Workspace bei Anthropic, OpenAI, Google (Gemini) oder einem anderen Anbieter ihrer Wahl. Ohne Schlüssel gibt es keine KI, und nichts geht an einen KI-Dienst. Bittet jemand in einem Kommentar die KI, etwas an der Präsentation zu ändern, schickt Slider von unserem Server aus an diesen Dienst: den Kommentar-Thread mit den Namen der Schreibenden, bis zu sechs Bilder, die am Thread hängen, und die Inhalte der Präsentation und ihres Materials, die die KI für die Aufgabe ansieht (Folien mit Texten, Formaten und Bildern; Notizen, Links und der Text der Dateien). Ebenso, wenn jemand auf der Materialseite der KI eine Notiz übergibt – dann gehen ihr Text, die Namen der Dateien, an denen sie hängt, und das Material, das die KI dafür liest – oder aus dem Material eine Präsentation bauen lässt. E-Mail-Adressen und Sprach- oder Videoaufnahmen gehen nicht mit. Was die KI antwortet und ändert, speichern wir wie einen Kommentar und einen Bearbeitungsschritt, samt dem Namen der Person, die sie gebeten hat. Den Dienst wählt der Workspace, und mit dessen Anbieter schließt er den Vertrag; wo der Anbieter die Daten verarbeitet (etwa in den USA) und ob er sie speichert oder zum Training nutzt, richtet sich nach diesem Vertrag und den Einstellungen des Schlüssels. Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO) und, für die Namen anderer im Thread, das berechtigte Interesse des Workspace, seine Präsentationen mit KI zu bearbeiten (Art. 6 Abs. 1 lit. f DSGVO).

**KI-Apps:** Unter „Konto & Anmeldung“ → „KI-Apps“ kannst du eine KI-App wie Claude oder ChatGPT mit deinem Konto verbinden – für alle deine Workspaces oder nur für einen. Die App liest dann in deinem Namen, was du in Slider sehen kannst (Präsentationen, Kommentare mit den Namen der Schreibenden, Material), und kann kommentieren, Material ablegen und die KI des Workspace um Änderungen bitten. Was sie abfragt, schickt Slider an diese App. Welche App das ist, entscheidest allein du; für die Verarbeitung dort ist ihr Anbieter verantwortlich, es gilt dessen Datenschutzerklärung. Wir speichern zu jeder Verbindung den Namen der App, für welche Workspaces sie gilt, wann sie verbunden und zuletzt genutzt wurde, und von ihren Zugangsschlüsseln nur einen Hash. „Entfernen“ trennt sie sofort. Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO) und, für die Namen und Beiträge anderer, dein berechtigtes Interesse, mit den Inhalten deiner Workspaces in der App deiner Wahl zu arbeiten (Art. 6 Abs. 1 lit. f DSGVO).

{{#stockPhotos}}
**Fotosuche:** Suchst du beim Bearbeiten nach Fotos oder lässt die KI ein Foto für eine Folie aussuchen, schickt Slider den Suchbegriff an Unsplash (Unsplash Inc., Kanada) – von unserem Server aus, ohne Angaben zu dir. Die Vorschaubilder lädt dein Browser direkt von Unsplash, wie es dessen Nutzungsbedingungen verlangen; dabei erhält Unsplash deine IP-Adresse und technische Angaben zu deinem Browser. Nimmst du ein Foto – oder bestätigst das Foto der KI –, holt Slider es in die Präsentation und meldet Unsplash, dass es verwendet wurde, ebenfalls ohne Angaben zu dir. Wer das Foto gemacht hat, steht als Bildbeschreibung in der Datei. Für Kanada besteht ein Angemessenheitsbeschluss der EU-Kommission. Rechtsgrundlage ist die Erfüllung des Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO).
{{/stockPhotos}}

Kommentare, die schon in einer Präsentationsdatei stehen, übernimmt Slider samt den Namen ihrer Verfasser, damit sie beim Prüfen sichtbar bleiben. Ebenso zeigt Slider, wer an einer Präsentation gearbeitet hat: den Namen, unter dem die Datei zuletzt gespeichert wurde, und bei verknüpften Dateien die Namen, die der Speicherort als Besitzer, Ersteller, teilende Person oder Bearbeiter früherer Versionen nennt. Rechtsgrundlage dafür ist das berechtigte Interesse, eine Präsentation vollständig prüfen zu können (Art. 6 Abs. 1 lit. f DSGVO); für alles Übrige Art. 6 Abs. 1 lit. b DSGVO.

## 7. Workspaces und Einladungen

Wenn dich jemand in einen Workspace einlädt, speichern wir deine E-Mail-Adresse{{#mail}} und schicken dir die Einladung per E-Mail. Für den Versand nutzen wir {{mailer}} als Auftragsverarbeiter{{/mail}}. Rechtsgrundlage ist das berechtigte Interesse der einladenden Person an der Zusammenarbeit (Art. 6 Abs. 1 lit. f DSGVO).

{{#domains}}
**Beitritt per E-Mail-Domain:** Admins eines Workspace können ihn für die E-Mail-Domain ihrer Firma öffnen (z. B. @firma.de). Dazu gleicht Slider den Teil deiner E-Mail-Adresse nach dem @ mit den geöffneten Domains ab. Meldest du dich mit einer Adresse dieser Domain an, siehst du Name, Logo und Mitgliederzahl des Workspace und kannst ihm ohne Einladung als Mitglied beitreten; umgekehrt sehen alle mit derselben Domain Name, Logo und Mitgliederzahl deines Workspace, wenn du ihn für die Domain öffnest. Adressen von E-Mail-Anbietern wie Gmail oder GMX gelten nie als Firmen-Domain. Rechtsgrundlage ist das berechtigte Interesse der Firma, die den Workspace nutzt, ihre Mitarbeitenden ohne einzelne Einladungen zusammenzubringen (Art. 6 Abs. 1 lit. f DSGVO). Du entscheidest selbst, ob du beitrittst; Admins können die Öffnung jederzeit in den Einstellungen des Workspace zurücknehmen.
{{/domains}}

{{#mail}}
Über {{mailer}} verschicken wir außerdem Mails, die du selbst auslöst (Datenanfragen){{#deleteUnused}} oder die dich vor der Löschung eines ungenutzten Kontos oder einer ungenutzten Präsentation warnen{{/deleteUnused}}.
{{/mail}}

{{#payments}}
**Bezahlung:** Den Paid-Plan bezahlt pro Workspace genau eine Person. Die Zahlung wickelt Stripe (Stripe Payments Europe Ltd., Irland) als Auftragsverarbeiter ab: Zahlungsdaten wie Karten- oder Kontonummer gibst du direkt bei Stripe ein, wir sehen sie nie. Wir speichern nur, wer für welchen Workspace bezahlt, die Kunden- und Abo-Kennung bei Stripe, den Status des Abos und das Ende der laufenden Periode. Stripe verarbeitet Daten teils auch in den USA; die Übermittlung stützt sich auf das EU-US Data Privacy Framework und Standardvertragsklauseln. Rechtsgrundlage ist die Erfüllung des Vertrags (Art. 6 Abs. 1 lit. b DSGVO); Rechnungsdaten bewahren wir so lange auf, wie es Handels- und Steuerrecht verlangen (bis zu 10 Jahre). Schlägt eine Zahlung fehl oder verlässt die zahlende Person den Workspace, informieren wir die Admins per E-Mail.
{{/payments}}

## 8. Cookies

Slider setzt nur Cookies, die für den Betrieb unbedingt nötig sind (§ 25 Abs. 2 Nr. 2 TDDDG):

- `slider_session`: hält dich angemeldet; läuft 30 Tage nach deiner letzten Nutzung ab.
- `slider_ms_oauth`, `slider_google`, `slider_oidc`, `slider_nextcloud`: schützen den Anmeldevorgang; gelten 10 Minuten.
{{#nextcloud}}
- `slider_nc_flow`: ordnet eine Anmeldung mit Nextcloud über ihre Adresse diesem Browser zu; gilt 5 Minuten.
{{/nextcloud}}

Es gibt keine Cookies für Statistik, Werbung oder Dritte.

## 9. Speicherdauer

{{#deleteUnused}}
- **Konto:** bis du es löschst. Wird Slider 18 Monate lang nicht genutzt, wird das Konto gelöscht; ab 12 Monaten ohne Nutzung bekommst du vorher mehrere Erinnerungen per E-Mail und kannst es mit einem Klick behalten.
- **Präsentationen:** bis sie gelöscht werden. Hat 18 Monate lang niemand eine Präsentation geöffnet oder geändert, wird sie gelöscht; die Besitzerin oder der Besitzer wird vorher per E-Mail erinnert.
{{/deleteUnused}}
{{^deleteUnused}}
- **Konto:** bis du es löschst.
- **Präsentationen:** bis sie gelöscht werden.
{{/deleteUnused}}
- **Kommentare** einer Person, die ihr Konto löscht, bleiben für die anderen erhalten, aber ohne Namen und Bild („Gelöschtes Konto“). Ihre Sprach- und Videoaufnahmen, ihre Bilder (gezeichnet, eingefügt oder hochgeladen) und ihre Reaktionen auf Kommentare werden gelöscht.
- **Material** einer Präsentation: bis es gelöscht wird, spätestens mit der Präsentation. Antworten der KI unter Notizen: bis die Antwort oder ihre Notiz gelöscht wird; löscht die fragende Person ihr Konto, bleiben sie ohne Bezug zu ihr.
- **Verbundene KI-Apps:** bis du sie entfernst oder dein Konto löschst.
- **Bilder aus dem Editor** (hochgeladen{{#stockPhotos}} oder als Foto geholt{{/stockPhotos}}): 7 Tage; was du auf eine Folie gesetzt hast, steckt danach in der Präsentationsdatei.
{{#nextcloud}}
- **App-Passwort einer verbundenen Nextcloud:** bis du die Verbindung trennst oder dein Konto löschst.
{{/nextcloud}}
- **Einladungen:** 30 Tage nach Ablauf, Annahme oder Rücknahme.
- **Sitzungen:** 30 Tage nach der letzten Nutzung, spätestens 90 Tage nach der Anmeldung.
- **Sicherungskopien** werden nach {{backupDays}} Tagen überschrieben; gelöschte Daten sind danach auch aus den Backups entfernt.

## 10. Empfänger

Deine Daten sehen nur die Mitglieder der Workspaces, in denen du mitarbeitest, wir als Betreiber im Umfang der Übersicht aus Abschnitt 4 und – soweit für den Betrieb nötig – unsere Auftragsverarbeiter: {{hoster}} (Hosting){{#cloudflare}}, Cloudflare (Netzwerk und Schutz){{/cloudflare}}{{#mail}}, {{mailer}} (E-Mail-Versand){{/mail}}{{#payments}} und – falls du für einen Workspace bezahlst – Stripe (Zahlungsabwicklung){{/payments}}. Hat ein Workspace einen KI-Dienst angebunden, erhält dieser Dienst die Daten aus Abschnitt 6, wenn jemand die KI bittet. Eine KI-App, die du verbunden hast, erhält, was sie in deinem Namen abfragt. Wir verkaufen keine Daten und geben sie nicht für Werbung weiter.

## 11. Deine Rechte

Du hast das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen aus berechtigtem Interesse (Art. 21).

So nimmst du sie wahr:

- **Mit Anmeldung:** Unter „Konto & Anmeldung“ lädst du alle deine Daten als ZIP herunter, änderst deinen Namen oder löschst dein Konto.
{{#mail}}
- **Ohne Anmeldung:** Unter /datenanfrage gibst du deine E-Mail-Adresse ein und wählst „Kopie“ oder „Löschen“. Wir schicken einen Link an genau diese Adresse. Wer dieses Postfach hat, gilt als berechtigt – weitere Nachweise brauchen wir nicht.
{{/mail}}
- **Alles andere**, etwa zu Namen in Präsentationsdateien: per E-Mail an {{email}}.

Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO), etwa bei der für uns zuständigen: {{authority}}.

## 12. Keine automatisierten Entscheidungen

Es gibt keine automatisierten Entscheidungen oder Profilbildung im Sinne von Art. 22 DSGVO.
