# Betrieb auf Windows 11

Für die vollständige Einrichtung von Anfang an einschließlich Programmdownloads und iPhone-Schritten siehe [howto.md](../howto.md). Dieses Dokument ergänzt technische Betriebsdetails.

Die Anwendung besteht aus einem Node-Prozess für Daten und Oberfläche sowie optional Caddy für HTTPS. Node hört nur auf `127.0.0.1:3210`. Caddy bindet ausschließlich die ausdrücklich eingerichtete private IPv4-Adresse. Es gibt keine Cloud-Veröffentlichung oder Router-Portweiterleitung.

Die App öffnet direkt die Auswahl Karla/Marvin und merkt sich das gewählte Profil pro Gerätesitzung. Wer das erlaubte Heimnetz und die App-Adresse erreicht, kann die gemeinsamen Inhalte lesen und ändern. Die Profilnamen kennzeichnen Einträge; sie schützen den Zugang nicht. Sicherungskennwort und Windows-Kennwort für die Aufgabenplanung bleiben davon unabhängig erforderlich.

## Ordner und Konfiguration

| Ort | Inhalt |
| --- | --- |
| `.runtime\config.json` | Nicht geheime Konfiguration: Datenpfad, Adresse, Port und Sicherungsziel |
| `.runtime\data\home.sqlite` | Datenbank im Standardbetrieb |
| `.runtime\data\media` | Originalbilder und Vorschauen |
| `.runtime\data\caddy` | Lokale Zertifikatsstelle und TLS-Dateien |
| `.runtime\backup-key.dpapi` | Für das aktuelle Windows-Konto verschlüsseltes Sicherungskennwort |
| `.runtime\logs` | Anwendungs- und HTTPS-Protokolle |
| `.tools` | Portable Node-Laufzeit und gegebenenfalls Caddy |

Der Datenordner kann beim ersten Start mit `Start.ps1 -DataDir 'D:\UnserZuhause'` festgelegt werden. Einen bestehenden Haushalt nicht einfach auf einen leeren Datenpfad umstellen: Erst sichern, vollständig wiederherstellen und anschließend die Konfiguration ändern. Die Datenbank muss auf einem lokalen Laufwerk bleiben. Eine NAS-Freigabe ist als Sicherungsziel vorgesehen.

`Run.ps1` setzt Dateirechte des gewählten Datenordners für den ausführenden Windows-Benutzer und SYSTEM. Nicht einen bereits anderweitig verwendeten Ordner als Datenordner angeben.

## Lokal starten

1. `scripts\Install.ps1` ausführen, wenn Laufzeit oder Abhängigkeiten fehlen. Die portable Node-Datei wird von nodejs.org geladen und anhand der veröffentlichten SHA-256-Prüfsumme kontrolliert. Pakete werden anhand der Sperrdatei installiert.
2. `scripts\Start.ps1 -OpenBrowser` ausführen.
3. Unter `http://localhost:3210` direkt Karla oder Marvin wählen. Ein bereits gemerktes Profil bleibt normalerweise ausgewählt.
4. Einen Raum, ein Projekt und eine Aufgabe anlegen und nach Neuladen prüfen.

Beim Öffnen legt `GET /api/session` automatisch eine Gerätesitzung an oder verwendet die vorhandene weiter. Eine vorherige Kennworteinrichtung ist auch vor der HTTPS-Freigabe nicht nötig. „Profil wechseln“ und „Zur Profilauswahl“ ändern die Auswahl auf diesem Gerät, ohne die Auswahl auf anderen Geräten zu ändern.

## Projektplan und Aufgabenketten

Der Projektplan bietet Liste, Board und Zeitachse. Aufgaben können den Phasen Planung, Vorbereitung, Renovierung und Abschluss zugeordnet werden. Zeitangaben bleiben manuell; eine Abhängigkeit berechnet oder verschiebt keine Termine.

Eine Aufgabe kann mehrere Vorgänger innerhalb desselben Projekts haben. Erst wenn alle Vorgänger erledigt sind, ist der Wechsel zu „In Arbeit“ oder „Erledigt“ möglich. Die zuständigen Personen können bereits vorher festgelegt werden. Der Fotovergleich zeigt zwei ausgewählte Bilder überlagert; Position und Zoom dienen dem passenden Ausschnitt.

## HTTPS im Heimnetz

Ermittle die lokale IPv4-Adresse deines Windows-PCs im Heimnetz. Ersetze den Platzhalter `HIER_DEINE_IP_EINFUEGEN` durch diese Adresse und `HIER_DEIN_HEIMNETZ_MIT_CIDR_EINFUEGEN` durch das zugehörige Heimnetz mit Präfixlänge. Die Adresse im tatsächlich verwendeten Router per DHCP-Reservierung festlegen. Für `zuhause.home.arpa` zusätzlich einen lokalen DNS-Eintrag auf die PC-Adresse einrichten. Routerkonfigurationen werden von den Skripten nicht geändert.

App mit `scripts\Stop.ps1` anhalten. Für die Einrichtung einschließlich Firewall ein PowerShell-Fenster als Administrator öffnen und im Projektordner ausführen; beide Platzhalter vorher ersetzen:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-Https.ps1 -LanIp "HIER_DEINE_IP_EINFUEGEN" -AllowedSubnet "HIER_DEIN_HEIMNETZ_MIT_CIDR_EINFUEGEN" -ConfigureFirewall
```

Die Adresse ist dann `https://HIER_DEINE_IP_EINFUEGEN` mit deiner eingesetzten IP-Adresse. Mit lokal eingerichteter Namensauflösung kann zusätzlich `-Hostname zuhause.home.arpa` angegeben werden. Die endgültige Adresse vor der Installation auf dem Homescreen festlegen; Browser behandeln IP und Namen als unterschiedliche Anwendungen.

Das Skript lädt bei Bedarf das offizielle Caddy-Paket und prüft dessen SHA-256-Summe. Es erstellt eine Caddy-Konfiguration mit interner Zertifikatsstelle und einer Windows-Firewallregel ausschließlich für das angegebene private IPv4-Netz auf TCP-Port 443. Caddy bindet kein IPv6-Interface. Das vorhandene WLAN muss in Windows als vertrauenswürdiges privates Netzwerk eingerichtet sein; das Skript ändert diese Netzwerkeinstufung nicht. Gastnetztrennung muss im Router geprüft werden.

Ohne `-ConfigureFirewall` bereitet das Skript nur HTTPS-Konfiguration und Caddy vor und benötigt für diesen Schritt keine Firewall-Administratorrechte. Dies ist noch keine bestätigte WLAN-Erreichbarkeit.

Danach als übliches Windows-Konto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Trust-LocalCertificate.ps1
```

Der zweite Befehl vertraut der lokalen Zertifikatsstelle für diesen Windows-Benutzer und kopiert das **öffentliche** Stammzertifikat nach `.runtime\Zuhause-Zertifikat.crt`. Nur diese öffentliche Datei wird auf die Handys übertragen. Der private Schlüssel aus dem Caddy-Datenordner bleibt auf dem PC und gehört nur in die verschlüsselte Sicherung.

Auf iPhone/iPad das Zertifikatsprofil installieren und anschließend unter Allgemein → Info → Zertifikatsvertrauenseinstellungen das volle Vertrauen aktivieren. Auf dem Pixel das Zertifikat über die Zertifikatsinstallation für eine CA importieren; die genaue Bezeichnung hängt von der Android-Version ab. Eine Warnung lediglich zu überspringen reicht nicht.

Erst nachdem die Adresse auf jedem Gerät ohne Zertifikatswarnung lädt: Karla oder Marvin auswählen und die App zum Homescreen hinzufügen. Auf Safari über das Teilen-Menü; auf Chrome/Edge über die angebotene Installation. Nach einem Geräteneustart erneut prüfen.

## Automatischer Start

`Start.ps1` startet den Supervisor unsichtbar. Er überwacht die eigenen App-/Caddy-Prozesse und startet sie nach einem Fehler erneut. `Stop.ps1` setzt einen Stoppwunsch und beendet nur diese Prozesse. Beim Stoppen laufende Uploads und Sicherungen zuvor abschließen lassen.

Für den Start direkt beim Windows-Systemstart, auch ohne interaktive Anmeldung, ist eine Aufgabe vorbereitet:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Autostart.ps1
```

Diesen Befehl in einer Administrator-PowerShell ausführen. Die Windows-Aufgabenplanung benötigt das Kennwort des vorgesehenen Windows-Kontos, keine Windows-Hello-PIN. Es wird über den sicheren Anmeldedialog eingegeben und nicht in eine Projektdatei geschrieben. Dasselbe Konto wie für die Backupkonfiguration verwenden, damit Windows den DPAPI-Schlüssel entschlüsseln kann. Die Aufgabe selbst läuft ohne erhöhte Rechte.

Ein kontrollierter Neustart ist Teil der Abnahme: Windows noch nicht anmelden, vom Handy die App öffnen und anschließend einen absichtlich beendeten App-Prozess auf automatischen Wiederanlauf prüfen. Diese Tests wurden durch das Bereitstellen der Skripte nicht ersetzt. Der PC wird nicht automatisch wach gehalten.

Ein bewusster Stopp bleibt durch `.runtime\stop.request` erhalten; `Start.ps1` hebt ihn wieder auf. Zum Entfernen des Autostarts in der Aufgabenplanung die Aufgabe „Unser Zuhause“ deaktivieren oder entfernen. Die App-Daten bleiben dabei bestehen.

## Sicherung einrichten

Ein unabhängiges externes Laufwerk oder ausreichend großes NAS wählen. N: wurde als FRITZ!NAS-Freigabe mit ungefähr 3,1 GB freiem Platz erkannt; das ist für das vorgesehene Medienbudget von bis zu 20 GB nicht ausreichend dimensioniert. Es wurde kein Sicherungsziel automatisch gewählt.

Beispiel mit einem tatsächlich vorhandenen externen Laufwerk:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Configure-Backup.ps1 -RepositoryDir 'E:\UnserZuhause-Backup'
```

Der Befehl fragt das Sicherungskennwort verdeckt ab. Es muss mindestens zwölf Zeichen lang sein und unabhängig vom PC aufbewahrt werden. Windows schützt die lokale Kopie mit DPAPI; auf einem anderen PC oder unter einem anderen Windows-Benutzer ist diese Kopie nicht automatisch entschlüsselbar. Die Originalpassphrase bleibt für eine Wiederherstellung nötig.

Für geplanten Betrieb mit einem NAS eine UNC-Adresse verwenden, etwa `\\server\freigabe\UnserZuhause-Backup`, weil Laufwerksbuchstaben in einer Aufgabe ohne Anmeldung nicht zuverlässig verfügbar sind. Die Erreichbarkeit und Berechtigungen unter dem tatsächlichen Aufgabenkonto prüfen. Das Eintragen eines Ordners beweist noch kein unabhängiges Backup.

Die App anschließend neu starten und in den Einstellungen eine erste Sicherung auslösen. Bei konfiguriertem Ziel kann der Server fällige tägliche Sicherungen nachholen; der angezeigte letzte Erfolg ist entscheidend. Fehler und fehlende Ziele bleiben sichtbar.

Die Sicherung erstellt mit SQLite `VACUUM INTO` einen konsistenten Datenbanksnapshot. Ein verschlüsseltes Manifest enthält die dazugehörigen Dateien und Prüfsummen. Datenbank, Originale, Vorschauen und vorhandenes Caddy-Material sind mit AES-256-GCM verschlüsselt. Unveränderte Dateien werden anhand ihres Inhalts wiederverwendet. Bereits existierende Objekte werden vor Wiederverwendung überprüft.

Aufbewahrung: neuester Stand je sieben Kalendertagen, vier Kalenderwochen und drei Kalendermonaten; alle Stände des neuesten Tages bleiben zusätzlich erhalten. Erst nach einer erfolgreichen neuen Sicherung und Prüfung der alten Manifeste werden nicht mehr benötigte Manifestdateien entfernt. Nicht mehr referenzierte verschlüsselte Datenobjekte werden konservativ noch nicht automatisch gelöscht. Das Archiv kann deshalb langfristig wachsen und sein Platz muss überwacht werden.

## Wiederherstellen

Die App zuerst stoppen. Sicherungen auflisten:

```powershell
.\.tools\node-v26.13.1-win-x64\node.exe --import tsx .\scripts\backup-cli.ts list 'E:\UnserZuhause-Backup'
```

Mit einer ausgegebenen Snapshot-ID in einen **leeren** Ordner wiederherstellen:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Restore.ps1 -RepositoryDir 'E:\UnserZuhause-Backup' -SnapshotId 'DIE-AUSGEGEBENE-ID' -TargetDir 'C:\UnserZuhause-Wiederhergestellt'
```

Das Sicherungskennwort wird verdeckt abgefragt und über Standardeingabe übergeben. Es steht weder in der Befehlszeile noch im Protokoll. Vorhandene Dateien im Ziel führen zum Abbruch. Beschädigte Dateien, falsche Schlüssel und gefährliche Pfade werden abgelehnt. Vor erfolgreichem Abschluss werden die Datenbankintegrität und Datei-Prüfsummen geprüft. Alte Sitzungen und Retry-Kennungen werden entfernt; nach dem Start wählt ihr erneut Karla oder Marvin. Enthält ein älterer Sicherungsstand noch ein App-Kennwort, entfernt die Datenbankmigration es beim Start. Das Sicherungskennwort bleibt unverändert nötig, um das Archiv zu entschlüsseln.

Zum Prüfen den neuen Datenpfad bei gestoppter App in `.runtime\config.json` eintragen und bei HTTPS-Betrieb die HTTPS-Konfiguration vor dem Start erneut erzeugen. Der Caddy-Speicherpfad muss zum neuen Datenordner passen; bei einem Umzug können außerdem Hostname und IP anders sein. Die vollständige Befehlsfolge steht in [howto.md, Abschnitt 9](../howto.md#9-daten-wiederherstellen). Nach dem Start Räume und Aufgaben ansehen, Originalfoto und Vorschau öffnen sowie ein Bildpaar vergleichen. Der alte Datenordner bleibt bis zum erfolgreichen Abschluss erhalten. Die gespeicherte `runtime-config.json` dient als Referenz und wird nicht ungeprüft aktiviert.

Ein Backup auf einem verlorenen oder beschädigten PC ist nur hilfreich, wenn Archiv und Wiederherstellungskennwort unabhängig verfügbar sind. Eine Wiederherstellungsprobe ist vor Produktivbetrieb und nach wesentlichen Sicherungsänderungen erforderlich.

## Update und Fehlerbehebung

Vor Updates einen erfolgreichen Sicherungsstand prüfen. App stoppen, Code und Sperrdatei aktualisieren, `Install.ps1` beziehungsweise `Build.ps1` ausführen, Tests ausführen und neu starten. Datenbankmigrationen werden von der Anwendung verwaltet. Bei einem Rückschritt die passende alte App-Version zusammen mit einem passenden Datenbanksnapshot verwenden.

Bei „Port belegt“ keinen beliebigen Node-Prozess beenden. Zuerst prüfen, ob ein eigener Testserver noch läuft. Bei Zertifikatsproblemen Adresse, Uhrzeit, Zertifikatsvertrauen und lokale Namensauflösung prüfen. Bei fehlendem NAS die Netzwerkverbindung und das tatsächliche Windows-Aufgabenkonto prüfen.

Ein unterbrochener Sicherungslauf kann eine Sperrdatei im Archiv hinterlassen. Lokale Sperren werden nur dann automatisch gelöst, wenn der zugehörige Prozess nachweislich nicht mehr läuft. Eine fremde oder unklare `.backup.lock` erst entfernen, nachdem auf allen beteiligten Rechnern sicher kein Sicherungs- oder Wiederherstellungslauf aktiv ist. Niemals während einer Sicherung Datenbank oder Mediendateien verschieben.
