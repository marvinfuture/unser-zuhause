# Unser Zuhause – Installation und Betrieb

Diese Anleitung führt vom Projektordner zur nutzbaren App auf Windows 11 und dem iPhone. Die App läuft auf deinem PC. Beim ersten Öffnen wählt ihr direkt Karla oder Marvin. Das Profil wird auf dem jeweiligen Gerät gemerkt; über „Profil wechseln“ oder „Zur Profilauswahl“ lässt es sich ändern.

Die App hat kein Zugangskennwort. Wer das erlaubte Heimnetz und die App-Adresse erreicht, kann Inhalte lesen und ändern. Die Namen kennzeichnen Einträge und sind keine Zugangskontrolle. Das Sicherungskennwort und das Windows-Kennwort für den optionalen Autostart bleiben erforderlich.

Die Befehle verwenden `C:\wxbapp` als Projektordner. Falls du einen anderen Ordner verwendest, passe diesen Pfad an. Texte wie `HIER_DEINE_IP_EINFUEGEN` sind Platzhalter: Ersetze sie vor dem Ausführen durch deine eigenen Werte. Tatsächliche Netzwerkadressen gehören nur in die lokale Konfiguration, nicht in diese Anleitung.

## 1. Was du brauchst

| Programm oder Voraussetzung | Woher / wofür |
| --- | --- |
| Windows 11 auf einem PC mit Intel-/AMD-64-Bit-Prozessor | Dein vorhandener PC. Die Installationsskripte laden Windows-x64-Versionen. |
| Windows PowerShell 5.1 | In Windows enthalten. Im Startmenü nach **Windows PowerShell** suchen. PowerShell 7 ist nicht erforderlich. |
| Git für Windows | Für Download und spätere Updates: [offizieller Download](https://git-scm.com/install/win). Den x64-Installer verwenden; Git muss für die Befehlszeile verfügbar sein. Danach PowerShell neu öffnen. |
| GitHub-Konto mit Zugriff auf das Repository | [marvinfuture/unser-zuhause](https://github.com/marvinfuture/unser-zuhause). Das Repository ist privat. Beim ersten Klonen kann Git eine Anmeldung im Browser öffnen. |
| Node.js und npm | Werden von `scripts\Install.ps1` automatisch aus [nodejs.org](https://nodejs.org/en/download) heruntergeladen und lokal unter `.tools` abgelegt. Keine separate Installation nötig. Die verwendete Version steht in `Install.ps1`. |
| Caddy für HTTPS | Wird von `scripts\Setup-Https.ps1` automatisch aus den [offiziellen Caddy-Veröffentlichungen](https://github.com/caddyserver/caddy/releases) geladen. Keine separate Installation nötig. |
| Browser | Auf Windows beispielsweise der vorhandene Edge; auf dem iPhone Safari. |
| Heimnetz und Routerzugang | PC und iPhone müssen im selben erlaubten Heimnetz sein. Der PC darf per LAN-Kabel verbunden sein. Du brauchst den Routerzugang für eine feste Adresszuordnung. |
| Administratorrechte für zwei Einrichtungsschritte | Für die Windows-Firewall und optional den Autostart. Normaler Start, Stoppen und Nutzung benötigen keine erhöhten Rechte. |
| Unabhängiges Sicherungsziel | Externe Festplatte oder NAS mit genügend freiem Platz für Fotos und mehrere Sicherungsstände. |

Internet wird für Download, Installation und Updates gebraucht. Die fertige App arbeitet im Heimnetz. Auf dem iPhone muss keine Node- oder Caddy-App installiert werden. Docker, ein separater Datenbankserver und Webhosting sind nicht erforderlich.

## 2. Projektdateien herunterladen

**Wenn `C:\wxbapp` bereits die App enthält, überspringe das Klonen.** Bestehende Dateien und Haushaltsdaten nicht ersetzen.

Auf einem neuen PC Windows PowerShell öffnen und ausführen:

```powershell
git clone https://github.com/marvinfuture/unser-zuhause.git C:\wxbapp
Set-Location C:\wxbapp
```

Bei der GitHub-Anmeldung das Konto mit Zugriff auf das private Repository verwenden. Eine Meldung „Repository not found“ kann bedeuten, dass das angemeldete Konto keinen Zugriff hat.

Du brauchst das **gesamte Repository**. Einzelne HTML- oder Skriptdateien reichen nicht. Die wichtigsten Orte:

| Datei / Ordner im Projekt | Inhalt und Bedeutung |
| --- | --- |
| `howto.md` | Diese Schritt-für-Schritt-Anleitung. |
| `README.md`, `docs\BETRIEB.md`, `PLANUNG.md` | Überblick, zusätzliche technische Betriebsdetails und vereinbarter Funktionsumfang. |
| `scripts` | Installation, Start, Stoppen, HTTPS, Autostart und Sicherung. Alle unten verwendeten Skripte liegen hier. |
| `src`, `server`, `shared`, `public` | Oberfläche, Server, gemeinsame Datentypen und Browserdateien. |
| `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | Abhängigkeiten und Baukonfiguration. Zusammen mit dem übrigen Quellcode aufbewahren. |
| `tests` | Automatisierte Prüfungen. |
| `.tools`, `node_modules`, `dist` | Laufzeiten, Pakete und gebaute Oberfläche. Werden lokal erzeugt. |
| `.runtime\config.json` | Lokale Einstellungen, darunter die eingesetzte IP-Adresse und Datenpfade. |
| `.runtime\data` | Standard-Datenordner: `home.sqlite`, Fotos in `media` und später Zertifikatsmaterial in `caddy`. |
| `.runtime\logs` | Protokolle für die Fehlersuche. |
| `.runtime\Zuhause-Zertifikat.crt` | Öffentliches Stammzertifikat zum Übertragen auf das iPhone; entsteht in Schritt 6. |

`.runtime`, `.tools`, `node_modules`, `dist` und lokale Haushaltsdaten werden durch `.gitignore` vom normalen Git-Upload ausgeschlossen. Ein Git-Push sichert den Programmcode, **nicht eure Fotos und Einträge**.

## 3. Installieren und am PC starten

Alle folgenden Befehle in PowerShell ausführen. In jedem neu geöffneten Fenster zuerst in den Projektordner wechseln:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install.ps1
```

Das Skript lädt bei Bedarf Node.js, prüft dessen Download-Prüfsumme, installiert die festgelegten Pakete und baut die Oberfläche. Bei einem Fehler erst die Ursache beheben; die nachfolgenden Schritte setzen eine erfolgreiche Installation voraus. `-ExecutionPolicy Bypass` gilt für den gestarteten PowerShell-Prozess und ändert keine dauerhafte Windows-Einstellung.

Anschließend starten:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1 -OpenBrowser
```

Nach wenigen Sekunden im PC-Browser **http://localhost:3210** öffnen beziehungsweise neu laden. Beim ersten Aufruf erscheint direkt die Auswahl Karla/Marvin. Ein bereits gemerktes Profil bleibt normalerweise ausgewählt.

Karla oder Marvin auswählen. Einen Raum, ein Projekt und eine Aufgabe anlegen; die Seite neu laden und prüfen, dass die Einträge erhalten bleiben. Der aktuelle Name bleibt sichtbar. Über „Profil wechseln“ oder „Zur Profilauswahl“ könnt ihr die Zuordnung auf diesem Gerät ändern.

HTTPS kann ohne vorherige Kennworteinrichtung eingerichtet werden. `localhost` auf dem iPhone bezeichnet das iPhone selbst und führt nicht zu deinem PC; dort verwendet ihr später die HTTPS-Adresse aus Schritt 5.

### Projekte und Aufgaben planen

Ein Projekt öffnen und den Reiter **Planung** wählen. Dort stehen **Liste**, **Board** und **Zeitachse** zur Verfügung. Die Liste eignet sich zum Bearbeiten einzelner Aufgaben, das Board für den Überblick und die Zeitachse für die eingetragenen Termine. Über **Aufgabe anlegen** oder das Bearbeiten einer vorhandenen Aufgabe die Phase **Planung, Vorbereitung, Renovierung oder Abschluss** auswählen.

Für eine Aufgabenfolge legt ihr bei einer Aufgabe ihre Vorgänger aus demselben Projekt fest. Eine Aufgabe kann mehrere Vorgänger haben. Sie lässt sich erst auf **In Arbeit** oder **Erledigt** setzen, wenn alle ausgewählten Vorgänger erledigt sind. Beispiel: „Wand streichen“ wartet auf „Tapete entfernen“ und „Löcher verspachteln“.

Karla, Marvin oder beide könnt ihr schon vorher zuweisen. Auch die Termine plant ihr selbst: Abhängigkeiten verschieben keine Daten und erstellen keinen automatischen Zeitplan.

In der Aufgabenübersicht hilft der Filter **Startbereit**, die nächsten möglichen Arbeiten zu finden. Im Board zeigen **Starten**, **Erledigen** und **Sperre aufheben** die passende nächste Aktion. Eine manuell blockierte Aufgabe bleibt gesperrt, auch wenn ihre Vorgänger inzwischen fertig sind. Aufgaben ohne Termin stehen unterhalb der Zeitachse separat.

Wenn ihr die Vorgänger einer bereits laufenden oder erledigten Aufgabe ändern möchtet, setzt diese Aufgabe im selben Formular wieder auf **Offen**. Einen erledigten Vorgänger könnt ihr erst wieder öffnen, wenn bereits laufende oder erledigte Nachfolger wieder offen sind oder die Verknüpfung bewusst entfernt wurde. Die App nennt betroffene Aufgaben in der Fehlermeldung.

### Vorher und Nachher vergleichen

Im Projekt Fotos hochladen und ein Vorher-/Nachher-Bildpaar auswählen. Der Vergleich zeigt beide Fotos übereinander; mit dem Schieberegler legt ihr mehr vom einen oder anderen Bild frei. Mit **Nur Vorher**, **Vergleichen** und **Nur Nachher** springt ihr zur entsprechenden Ansicht. Den Regler am PC mit der Tabulatortaste auswählen und mit den Pfeiltasten verschieben; am iPhone mit dem Finger ziehen. Bei unterschiedlichen Ausschnitten die Bildposition und den Zoom anpassen. Am besten funktioniert der Vergleich mit Fotos desselben Motivs aus einem ähnlichen Blickwinkel.

## 4. Heimnetzadresse vorbereiten

### PC-Adresse und Heimnetz ermitteln

Auf dem PC ausführen:

```powershell
ipconfig
```

Beim tatsächlich verbundenen Ethernet- oder WLAN-Adapter die **IPv4-Adresse**, **Subnetzmaske** und das **Standardgateway** ansehen. VPN-, virtuelle und getrennte Adapter nicht verwenden.

Für die Firewall wird zusätzlich das Heimnetz im Format `Netzadresse/Präfixlänge` benötigt. Beispielwerte zur Erklärung: Aus der PC-Adresse `192.168.1.50` und der Maske `255.255.255.0` folgt `192.168.1.0/24`. Das ist ein Beispiel, keine Vorgabe für dein Netzwerk.

Damit du auch bei einer anderen Subnetzmaske nicht rechnen musst, kannst du diesen Block verwenden. Nur in der ersten Zeile den Platzhalter ersetzen; der Block liest die Netzwerkeinstellungen und ändert nichts:

```powershell
$pcIp = 'HIER_DEINE_IP_EINFUEGEN'
$adresse = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $pcIp -ErrorAction Stop | Select-Object -First 1
$bytes = ([Net.IPAddress]::Parse($pcIp)).GetAddressBytes()
$netzBytes = for ($i = 0; $i -lt 4; $i++) {
    $bits = [Math]::Min(8, [Math]::Max(0, $adresse.PrefixLength - 8 * $i))
    $maske = 256 - [int][Math]::Pow(2, 8 - $bits)
    $bytes[$i] -band $maske
}
'Heimnetz: ' + ($netzBytes -join '.') + '/' + $adresse.PrefixLength
```

Den ausgegebenen Wert später für `HIER_DEIN_HEIMNETZ_MIT_CIDR_EINFUEGEN` einsetzen.

### Adresse im Router festhalten

In der Verwaltung des Routers, der diesem PC seine Adresse zuweist, den PC auswählen und die aktuelle IPv4-Adresse dauerhaft zuordnen. Diese Funktion heißt je nach Router **DHCP-Reservierung**, **feste IP-Zuordnung** oder **immer dieselbe IPv4-Adresse zuweisen**. Bei FRITZ!Box und UniFi im selben Aufbau ist entscheidend, welches Gerät das Heimnetz verwaltet. Das Standardgateway hilft bei der Zuordnung.

Die Windows-Adresse weiterhin automatisch per DHCP beziehen lassen. Nach der Reservierung mit `ipconfig` kontrollieren, dass die gewünschte Adresse verwendet wird. Wechselt die Adresse später, muss Schritt 5 mit der neuen Adresse wiederholt werden.

### Windows-Netzwerkprofil prüfen

Unter **Einstellungen → Netzwerk und Internet** die aktive WLAN- oder Ethernet-Verbindung öffnen und für dieses eigene Heimnetz den Netzwerkprofiltyp **Privat** wählen. Die App-Firewallregel gilt nur in diesem Profil. Die entsprechenden Windows-Einstellungen beschreibt [Microsoft](https://support.microsoft.com/de-de/windows/experience/connectivity-networking/essential-network-settings-and-tasks-in-windows).

Das iPhone mit dem normalen Heim-WLAN verbinden, nicht mit einem isolierten Gast-WLAN. Im Router keine Internet-Portweiterleitung für die App einrichten.

## 5. HTTPS und Firewall einrichten

Zuerst die App in der normalen PowerShell stoppen:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop.ps1
```

Dann im Startmenü **Windows PowerShell → Als Administrator ausführen** öffnen und die Windows-Abfrage bestätigen. Dabei dasselbe Windows-Konto verwenden, unter dem die App eingerichtet wurde. Nicht mit einem anderen Administratorkonto weitermachen; Dateirechte, Zertifikate und Sicherungskennwort sind an das verwendete Konto gebunden.

Im Administratorfenster beide Platzhalter durch die Werte aus Schritt 4 ersetzen und ausführen:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-Https.ps1 -LanIp 'HIER_DEINE_IP_EINFUEGEN' -AllowedSubnet 'HIER_DEIN_HEIMNETZ_MIT_CIDR_EINFUEGEN' -ConfigureFirewall
```

Das Skript lädt Caddy mit Prüfsummenkontrolle, erzeugt die lokale HTTPS-Konfiguration und erlaubt TCP-Port 443 für diese PC-Adresse und dieses private Heimnetz. Der eigentliche App-Server bleibt auf dem PC an `127.0.0.1:3210` gebunden.

Diese Anleitung verwendet die IP-Adresse direkt; ein eigener DNS-Name ist nicht nötig. Falls du stattdessen `zuhause.home.arpa` verwenden möchtest, beschreibt [BETRIEB.md](docs/BETRIEB.md) die zusätzliche DNS-Voraussetzung und den Parameter `-Hostname`. Wähle die endgültige Adresse vor der iPhone-Installation.

Nach erfolgreichem Abschluss das Administratorfenster schließen. In der normalen PowerShell starten:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1
```

## 6. Zertifikat auf Windows und iPhone einrichten

### Auf Windows

Caddy erzeugt beim ersten HTTPS-Start eine lokale Zertifikatsstelle. Einige Sekunden warten, dann unter dem üblichen Windows-Konto ausführen:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Trust-LocalCertificate.ps1
```

Falls das Skript meldet, dass das Zertifikat noch fehlt, kurz warten und erneut ausführen. Bleibt der Fehler bestehen, die HTTPS-Protokolle aus Abschnitt 11 prüfen.

Das Skript vertraut dem Zertifikat für deinen Windows-Benutzer und legt die öffentliche Datei hier ab:

```text
C:\wxbapp\.runtime\Zuhause-Zertifikat.crt
```

Nun im PC-Browser `https://HIER_DEINE_IP_EINFUEGEN` mit deiner IP aufrufen. Die Seite muss ohne Zertifikatswarnung laden. Nach Aktivierung von HTTPS diese endgültige HTTPS-Adresse verwenden, auch am PC; die Gerätesitzung verwendet jetzt sichere Cookies. Beim ersten Aufruf dieser Adresse gegebenenfalls erneut Karla oder Marvin auswählen.

### Auf dem iPhone

1. **Nur** `Zuhause-Zertifikat.crt` auf das iPhone übertragen. Ein konkreter Weg: Die Datei selbst als E-Mail-Anhang an deine eigene Adresse senden und den Anhang auf dem iPhone in Apple Mail öffnen. Das ist das öffentliche Zertifikat; private Schlüssel und andere Dateien aus `.runtime\data\caddy` nicht übertragen.
2. Nach dem Öffnen den Profildownload zulassen. In **Einstellungen → Profil geladen** das Profil öffnen und installieren; den Gerätecode eingeben. Falls dieser Hinweis nicht erscheint, unter **Allgemein → VPN und Geräteverwaltung** nachsehen. Installiere das gerade von deinem PC übertragene Zertifikat. Apples Anleitung erklärt die [Profilinstallation](https://support.apple.com/de-de/102400).
3. Danach **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** öffnen. Für die neue lokale Caddy-Zertifikatsstelle das volle Vertrauen aktivieren und bestätigen. Die Profilinstallation allein reicht für HTTPS nicht aus. Siehe [Apples Anleitung zum Zertifikatsvertrauen](https://support.apple.com/de-at/102390).
4. Safari öffnen und die vollständige Adresse `https://HIER_DEINE_IP_EINFUEGEN` mit deiner IP eingeben. Die Seite muss ohne Zertifikatswarnung laden. Karla oder Marvin auswählen.

Diese Schritte auf jedem verwendeten iPhone oder iPad einzeln durchführen. Falls später eine neue lokale Zertifikatsstelle entsteht, etwa nach einer Neuinstallation ohne die alten Zertifikatsdaten, muss deren neues Zertifikat erneut eingerichtet werden.

### App zum Home-Bildschirm hinzufügen

In Safari bei geöffneter App das Teilen-Menü öffnen; je nach Safari-Ansicht liegt es im Seitenmenü. **Zum Home-Bildschirm** wählen, falls angeboten **Als Web-App öffnen** aktivieren und **Hinzufügen** antippen. Das Symbol anschließend öffnen und bei Bedarf noch einmal Karla oder Marvin auswählen. [Apple beschreibt den aktuellen Ablauf hier.](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)

Zum Abschluss auf dem iPhone eine Aufgabe anlegen und am PC prüfen, ob sie erscheint. Ein Foto hochladen und einen Vorher-Nachher-Vergleich testen. Diese Prüfung bestätigt auch die tatsächliche Verbindung zwischen euren Geräten.

## 7. Im Alltag starten, stoppen und wach halten

Starten, zum Beispiel nach einem bewussten Stopp:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1
```

Beenden, nachdem laufende Uploads und Sicherungen abgeschlossen sind:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop.ps1
```

Der Starter betreibt die App im Hintergrund und startet ihre Prozesse nach einem Absturz erneut. Das PowerShell-Fenster muss nicht offen bleiben. Ein bewusster Stopp bleibt auch nach einem PC-Neustart bestehen, bis `Start.ps1` ihn aufhebt.

Der PC muss eingeschaltet und wach sein. Für dauerhafte Erreichbarkeit unter **Einstellungen → System → Stromversorgung** beziehungsweise **Stromversorgung und Akku** die Zeit bis zum automatischen Energiespar-/Ruhezustand im Netzbetrieb auf **Nie** setzen. Der Bildschirm darf sich weiter ausschalten. Die Bezeichnungen hängen von der Windows-Version ab; [Microsoft beschreibt die Energieeinstellungen](https://support.microsoft.com/de-de/windows/experience/power-battery/power-settings-in-windows-11).

Unterwegs über Mobilfunk ist die App nicht erreichbar. Die installierte Web-App bietet keine vollständige Offline-Bearbeitung. Eine Einkaufsliste bei Bedarf vorher über die Druckfunktion der App als PDF sichern.

### Optional: automatisch beim Windows-Start

In einer Administrator-PowerShell desselben Windows-Kontos:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Autostart.ps1
```

Im Anmeldedialog das **Kennwort des Windows-Kontos** eingeben. Die Windows-Hello-PIN ist hierfür nicht geeignet. Ohne ein für die Aufgabenplanung verwendbares Kontokennwort ist dieser Autostartweg nicht eingerichtet; manuelles Starten bleibt möglich.

Falls die App vorher bewusst gestoppt wurde, `Start.ps1` einmal ausführen. Danach den PC kontrolliert neu starten und **vor der Windows-Anmeldung** vom iPhone prüfen, ob die App erreichbar wird. Damit ist der tatsächliche Autostart getestet. In der Windows-Aufgabenplanung heißt die Aufgabe **Unser Zuhause**; dort kann sie später deaktiviert werden.

## 8. Sicherung einrichten und prüfen

Wähle ein unabhängiges Laufwerk oder ein NAS. Ein weiterer Ordner auf derselben SSD schützt nicht vor deren Ausfall. Das Ziel braucht Platz für den gesamten Datenbestand und zusätzliche Sicherungsstände. Die bisherigen Hinweise zum vorhandenen NAS stehen in [BETRIEB.md](docs/BETRIEB.md).

Im folgenden Beispiel `E:\UnserZuhause-Backup` durch einen tatsächlich verfügbaren Zielordner ersetzen. In der normalen PowerShell unter dem Konto, das auch die App betreibt:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Configure-Backup.ps1 -RepositoryDir 'E:\UnserZuhause-Backup'
```

Das Skript fragt zweimal ein **Sicherungskennwort mit mindestens zwölf Zeichen** ab. Es verschlüsselt das Archiv und wird auch für die Wiederherstellung benötigt. Das Kennwort außerhalb dieses PCs aufbewahren. Die lokal gespeicherte, von Windows geschützte Kennwortkopie funktioniert nicht automatisch unter einem anderen Windows-Konto oder auf einem neuen PC.

Wenn der Zielordner bereits ein Sicherungsarchiv enthält, dessen bisheriges Sicherungskennwort verwenden. Für ein neues Kennwort einen neuen, leeren Archivordner wählen.

Für ein NAS einen UNC-Pfad wie `\\SERVER\FREIGABE\UnserZuhause-Backup` verwenden. Ein verbundener Laufwerksbuchstabe ist beim Autostart ohne Anmeldung möglicherweise nicht vorhanden. Das Windows-Aufgabenkonto muss die Freigabe erreichen und dort schreiben dürfen.

App neu starten:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1
```

In den **Einstellungen** der App eine Sicherung auslösen. Warten, bis ein erfolgreicher Sicherungsstand angezeigt wird. Den Archivordner auf dem Ziel kontrollieren. Anschließend eine Wiederherstellungsprobe nach Abschnitt 9 durchführen, zunächst ohne den aktiven Datenordner umzustellen.

Bei laufender App prüft die Wartung nach etwa einer Minute und anschließend stündlich, ob eine Sicherung fehlt oder über 24 Stunden alt ist. Das Ziel muss erreichbar sein. Es gibt keinen Sicherungslauf bei ausgeschaltetem PC. Letzten Sicherungserfolg und freien Platz regelmäßig in der App prüfen.

Die Sicherung enthält Datenbank, Fotos/Vorschauen und vorhandenes lokales Zertifikatsmaterial. Alte Sicherungsstände werden nach einer Aufbewahrungsregel ausgedünnt; nicht mehr benötigte verschlüsselte Datenobjekte werden derzeit nicht automatisch gelöscht. Das Archiv kann deshalb langfristig wachsen. Details stehen in [BETRIEB.md](docs/BETRIEB.md).

## 9. Daten wiederherstellen

Auf einem neuen PC zuerst den Projektcode holen und aus Schritt 3 die Installation ausführen. Zur Wiederherstellung brauchst du **den vollständigen Sicherungsordner und das Sicherungskennwort**. Die GitHub-Kopie allein enthält keine Haushaltsdaten.

### Sicherungsstand in einen leeren Ordner entpacken

App stoppen und verfügbare Sicherungsstände auflisten. Den Beispiel-Archivpfad wie in Abschnitt 8 ersetzen:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop.ps1
.\.tools\node-v26.13.1-win-x64\node.exe --import tsx .\scripts\backup-cli.ts list 'E:\UnserZuhause-Backup'
```

Eine ausgegebene ID vollständig kopieren und für `HIER_SNAPSHOT_ID_EINFUEGEN` einsetzen. Als Ziel einen neuen oder leeren Ordner verwenden:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Restore.ps1 -RepositoryDir 'E:\UnserZuhause-Backup' -SnapshotId 'HIER_SNAPSHOT_ID_EINFUEGEN' -TargetDir 'C:\UnserZuhause-Wiederhergestellt'
```

Das Sicherungskennwort verdeckt eingeben. Das Skript prüft die entschlüsselten Dateien und die Datenbank; ein gefüllter Zielordner wird abgelehnt. Die ursprünglichen Daten bleiben bestehen. Für eine reine Wiederherstellungsprobe kannst du jetzt den ursprünglichen Haushalt mit `Start.ps1` wieder starten. Die folgende Umstellung ist nur nötig, wenn du den wiederhergestellten Haushalt verwenden oder in der App ansehen möchtest.

### Wiederhergestellten Haushalt aktivieren

Während die App gestoppt ist, den neuen Datenpfad in der lokalen Konfiguration eintragen:

```powershell
$config = Get-Content .\.runtime\config.json -Raw -Encoding UTF8 | ConvertFrom-Json
$config.dataDir = 'C:\UnserZuhause-Wiederhergestellt'
$config | ConvertTo-Json | Set-Content .\.runtime\config.json -Encoding UTF8
```

Auf einem frisch installierten PC ohne `config.json` zuerst `Start.ps1` ausführen, einige Sekunden warten und anschließend `Stop.ps1` ausführen, damit die lokale Konfiguration angelegt wird. Danach den Block oben ausführen. Die im Restore enthaltene `runtime-config.json` ist eine Referenz und wird nicht automatisch übernommen.

Für WLAN-/HTTPS-Betrieb **vor dem erneuten Start** Schritt 5 mit der richtigen Adresse wiederholen. Das erzeugt auch den Caddy-Speicherpfad für den neuen Datenordner. Dann starten und Schritt 6 für Windows ausführen. Auf dem iPhone nur dann ein neues Zertifikat installieren, wenn die Zertifikatsstelle gewechselt hat.

Nach dem Start Karla oder Marvin auswählen. Räume und Aufgaben prüfen, Fotos öffnen und einen Bildvergleich testen. Alte Sitzungen werden bei einer Wiederherstellung absichtlich entfernt. Ein in älteren Sicherungen enthaltenes App-Kennwort wird beim Start durch die Datenbankmigration entfernt; die App öffnet die Profilauswahl. Das Sicherungskennwort zum Entschlüsseln des Archivs bleibt davon unberührt. Anschließend das Sicherungsziel nach Abschnitt 8 prüfen beziehungsweise neu einrichten. Die alten Daten erst entfernen, wenn die Wiederherstellung vollständig geprüft ist.

## 10. Programm aktualisieren

Vor einem Update in der App eine erfolgreiche Sicherung prüfen. Danach in PowerShell jeden Befehl einzeln ausführen und bei Fehlern anhalten:

```powershell
Set-Location C:\wxbapp
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop.ps1
git status --short
git pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install.ps1
$env:PATH = 'C:\wxbapp\.tools\node-v26.13.1-win-x64;' + $env:PATH
npm.cmd test
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1
```

Wenn `git status --short` eigene geänderte Dateien zeigt, diese vor dem Pull sichern beziehungsweise die Änderungen klären. Bei Git-Konflikten, Installations- oder Testfehlern nicht einfach weiter starten. `Install.ps1` baut die Oberfläche inklusive TypeScript-Prüfung neu; `Build.ps1` genügt nur, wenn die benötigten Pakete bereits installiert sind. Sollte sich die mitgelieferte Node-Version ändern, den Versionsordner in Befehlen entsprechend `Install.ps1` anpassen.

Nach dem Start die App auf PC und iPhone schließen und neu öffnen. Gewähltes Profil, Aufgaben und ein Foto kurz prüfen. Datenbankänderungen führt die App beim Start über Migrationen aus; dabei wird ein noch vorhandenes altes App-Kennwort entfernt. Für die Rückkehr zu einem älteren Stand die dazu passende Programmversion und Sicherung verwenden.

## 11. Wenn etwas nicht funktioniert

| Problem | Nächster Prüfschritt |
| --- | --- |
| `git` wird nicht gefunden | Git installieren und PowerShell neu öffnen. |
| Erste lokale Seite lädt nicht | Nach `Start.ps1` kurz warten, dann `http://localhost:3210` neu laden. Bei bestehender HTTPS-Konfiguration die HTTPS-Adresse verwenden. Protokolle prüfen. |
| „Port 3210 belegt“ | Prüfen, ob ein manuell gestarteter Entwicklungsserver läuft. Diesen in seinem ursprünglichen Terminal beenden. Nicht beliebige Node-Prozesse abschießen. |
| PC erreicht HTTPS, iPhone nicht | PC wach, richtige IP, iPhone im normalen Heim-WLAN, Windows-Profil privat und Schritt 5 einschließlich Firewall erfolgreich? Router-Geräteisolation/Gastnetz prüfen. |
| Zertifikatswarnung | Stimmt die aufgerufene IP bzw. der Name mit der Einrichtung überein? Zertifikat aus Schritt 6 installiert **und** volles Vertrauen aktiviert? Datum/Uhrzeit der Geräte prüfen. |
| Zertifikat fehlt nach dem Start | In `.runtime\logs\https.err.log` nach Caddy-Startfehlern suchen, zum Beispiel belegter Port 443 oder nicht mehr zugewiesene IP. |
| Nach PC-Neustart nicht erreichbar | Aufgabenplanung „Unser Zuhause“, Windows-Kontokennwort und einen vorherigen bewussten Stopp prüfen. `Start.ps1` hebt den Stoppwunsch auf. |
| Sicherung fehlgeschlagen | Letzten Fehler in den App-Einstellungen, freien Speicher, Zielpfad und Schreibrechte des ausführenden Windows-Kontos prüfen. Nach Konfigurationsänderungen App neu starten. |
| Profilauswahl passt nicht | Den gewünschten Namen wählen. Bei einem bereits offenen Formular die Meldung der App beachten und das Formular mit dem gewünschten Profil neu öffnen. |

Die letzten Fehlermeldungen anzeigen:

```powershell
Get-Content .\.runtime\logs\app.err.log -Tail 60
Get-Content .\.runtime\logs\https.err.log -Tail 60
```

HTTPS-Protokolle entstehen erst nach der entsprechenden Einrichtung. Weitere Ausgaben liegen in `app.out.log` und `https.out.log` im selben Ordner. Protokolle können lokale Pfade und Adressen enthalten; vor dem Teilen prüfen.

## 12. Code verstehen und selbst ändern

Die benannten Funktionen, Komponenten und Methoden tragen direkt darüber einen deutschen Kommentar zu ihrem Zweck. Die Regel steht auch in [AGENTS.md](AGENTS.md), damit sie bei späteren Änderungen beibehalten wird. Einstiegspunkte sind `src\main.tsx` und `src\App.tsx` für die Oberfläche sowie `server\index.ts` und `server\app.ts` für den Server.

Nach Codeänderungen im Projektordner prüfen und bauen:

```powershell
$env:PATH = 'C:\wxbapp\.tools\node-v26.13.1-win-x64;' + $env:PATH
npm.cmd test
npm.cmd run build
```

Anschließend die App mit den Start-/Stoppskripten neu starten. Die Tests arbeiten mit getrennten Testdaten. Tests ersetzen nicht die Prüfung von Zertifikaten, iPhone-Bedienung, Router, Autostart und unabhängigem Sicherungsziel an deinen tatsächlichen Geräten.
