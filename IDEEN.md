# Ideensammlung – Unser Zuhause

Stand: 18. November 2026

Diese Datei sammelt die gewünschten Änderungen an der Webapp. Der Status jedes Eintrags hält fest, ob eine Umsetzung freigegeben wurde. Änderungen an der App erfolgen ausschließlich auf ausdrückliche Anweisung. Neue Ideen werden hier ergänzt.

## I-01 – Direkter Einstieg ohne Kennwort

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt.

- Beim Öffnen der App direkt die Auswahl **Karla / Marvin** anzeigen.
- Keine Kennwortabfrage für den App-Zugang.
- Die zugehörigen Kennwort- und Anmeldefunktionen entfernen; der ursprüngliche Wunsch lautet: „alles, was mit Kennwort zu tun hat“.

**Umfang dieser Umsetzung:** Der App-Zugang wird kennwortfrei. Das separate Sicherungskennwort für verschlüsselte Backups und das Windows-Kontokennwort für den optionalen Autostart bleiben unverändert. Die Profilwahl, Zuordnung der Einträge und vorhandene Haushaltsdaten bleiben erhalten.

## I-02 – Aufgaben verketten

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt.

- Aufgaben können voneinander abhängig sein.
- Eine Folgeaufgabe wird erst freigegeben, wenn ihre Vorgängeraufgabe erledigt ist.
- Dadurch lässt sich die notwendige Reihenfolge der Renovierungsarbeiten abbilden.

**Umsetzung:** Eine Aufgabe kann mehrere Vorgänger innerhalb desselben Projekts haben. Vorheriges Planen und Zuweisen bleibt möglich; Arbeitsbeginn und Erledigen sind erst erlaubt, wenn alle Vorgänger erledigt sind.

## I-03 – Renovierungen als Projekte planen

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt.

- Renovierungen als zusammenhängende Projekte planen und organisieren.
- Aufbau und Organisation sollen sich an **Microsoft Project beziehungsweise Microsoft Planner** orientieren.

**Umsetzung:** Projektaufgaben erhalten die Phasen Planung, Vorbereitung, Renovierung und Abschluss. Liste, Board und Zeitachse zeigen denselben Datenbestand. Termine werden zunächst manuell geplant. Eine vollständige Nachbildung von Microsoft Project ist nicht Teil dieses Ausbaus.

## I-04 – Vorher-Nachher-Fotos mit überlagertem Slider

**Status:** Am 17. November 2026 freigegeben; am 18. November 2026 umgesetzt. Bedienung am echten iPhone noch zu prüfen.

- Vorher- und Nachher-Foto liegen in derselben Vergleichsfläche übereinander.
- Ein verschiebbarer Regler legt jeweils mehr vom Vorher- oder Nachher-Bild frei.
- Durch Hin- und Herziehen wird die Veränderung direkt an derselben Bildposition sichtbar.

**Umsetzung:** Der vorhandene überlagerte Vergleich bleibt erhalten. Ergänzt wurden direkte Schaltflächen für „Nur Vorher“, „Vergleichen“ und „Nur Nachher“. Der native Schieberegler unterstützt Maus, Touch und Tastatur; Ausschnitt und Zoom bleiben einstellbar. Ein Test auf einem echten iPhone ist noch offen.

## Erste Bewertung und Vorschlag für den nächsten Schritt

Die folgende erste Bewertung ist historisch und wurde vor der Freigabe festgehalten. Anschließend hat der Nutzer alle vier Ideen zur Umsetzung freigegeben. Maßgeblich sind jetzt die oben dokumentierten Umsetzungen: Das Sicherungskennwort bleibt bestehen, und die Zeitachse ist enthalten.

| Idee | Einschätzung nach Prüfung des vorhandenen Codes |
| --- | --- |
| I-01 – Ohne Kennwort | Technisch machbar und bequemer. Jedes Gerät, das die App im freigegebenen Heimnetz erreichen kann, könnte danach die gemeinsamen Inhalte sehen und verändern. Die Namensauswahl dient nur der Zuordnung. Das separate Sicherungskennwort bleibt eine offene Entscheidung. |
| I-02 – Aufgaben verketten | Sinnvoller nächster Ausbau mit mittlerem Aufwand. Aufgaben, Zuständigkeiten, Termine und Fortschritt bestehen bereits; echte Abhängigkeiten fehlen. Der derzeitige Status „Blockiert“ ist nur eine manuelle Markierung. |
| I-03 – Projektplanung | Sinnvoll, aber noch zu breit für einen einzelnen Umsetzungsschritt. Als Richtung bieten sich Projektphasen, Aufgabenliste, Board und später eine Zeitachse an. Aufgabenabhängigkeiten sind dafür eine passende Grundlage. |
| I-04 – Foto-Slider | Das gewünschte Grundprinzip ist bereits in `src/App.tsx` in `CompareSlider` umgesetzt: überlagerte Bilder mit verschiebbarer Trennlinie sowie einstellbarer Bildposition und Zoom. Als nächster Schritt wäre die Bedienung mit echten Bildpaaren auf dem iPhone zu prüfen; diese Bewertung umfasst keinen neuen Gerätetest. |

Microsoft beschreibt Aufgabenlisten, Boards und Zeitachsen sowie Abhängigkeiten als unterschiedliche Planungsfunktionen. Diese dienen als Orientierung für die eigene App: [Planner-Ansichten](https://support.microsoft.com/de-de/planner/create-a-plan-in-microsoft-planner), [erweiterte Planungsfunktionen](https://support.microsoft.com/de-de/planner/teams/advanced-capabilities-with-premium-plans-in-planner).

### Festgelegter Umfang für I-02 und I-03

Verhalten der freigegebenen Umsetzung:

- Aufgaben können mehrere Vorgänger innerhalb desselben Projekts haben. Alle Vorgänger müssen erledigt sein.
- Aufgaben dürfen schon vorher geplant, priorisiert und Karla oder Marvin zugewiesen werden.
- Arbeitsbeginn und Erledigen bleiben gesperrt, solange ein Vorgänger offen ist. Die Aufgabe zeigt „Wartet auf: …“.
- Nach Abschluss aller Vorgänger ist die Aufgabe startbereit. Sie wird nicht automatisch begonnen oder erledigt.
- Ein Filter „Startbereit“ zeigt, welche Arbeiten als Nächstes möglich sind.
- Eine manuelle Blockierung, etwa wegen fehlenden Materials, bleibt unabhängig von den Vorgängern bestehen.
- Aufgaben dürfen weder auf sich selbst noch über eine Kette wieder auf sich selbst warten.
- Ein erledigter Vorgänger darf nicht unbemerkt wieder geöffnet oder entfernt werden, wenn bereits laufende oder erledigte Folgeaufgaben davon abhängen. Betroffene Aufgaben müssen angezeigt und die Abhängigkeiten bewusst geklärt werden.
- Termine bleiben in diesem Ausbau manuell geplant. Die Zeitachse stellt sie dar; eine automatische Terminverschiebung ist nicht enthalten.

Beispiel: **Tapete entfernen → Wand ausbessern → Trocknung prüfen → Streichen**.

**Zuweisung:** Wartende Aufgaben dürfen bereits Karla oder Marvin zugewiesen werden. Gesperrt sind Arbeitsbeginn und Erledigen.
