# Unser Zuhause

Read PLANUNG.md for the approved scope. User approved implementation on 2026-11-16.

On 2026-11-17 the user also approved all four ideas in IDEEN.md: password-free entry, task dependencies, project planning with phases/board/timeline, and the overlay photo slider. Push the completed, verified changes to the existing private GitHub repository.

- Local Windows application, LAN only. No cloud deployment, public tunnel or paid service.
- User approved password-free app access on 2026-11-17: open directly to Karla/Marvin profile selection. Profiles provide voluntary attribution, not authentication. Preserve device sessions, CSRF protection, profile-version conflicts and LAN restrictions. Encrypted-backup and Windows-account passwords are separate and remain unchanged.
- Keep actual household data and secrets outside Git. Use temporary test data for automated verification.
- Implement small coherent units. Test session and origin protection, profile attribution, concurrency, upload handling and backup/restore before claiming completion.
- Use TypeScript, React/Vite, Node LTS, SQLite and separate protected media files.
- Do not silently overwrite concurrent edits or change an open form's author after a profile switch.
- Preserve existing data and use numbered database migrations. No destructive reset of household data.
- Only the root agent changes shared types and package dependencies. Coordinate API contracts before changes.
- Report unverified physical-device, certificate trust, service and backup-target checks honestly.
- Dokumentiere jede benannte Funktion, Hilfsfunktion, React-Komponente, Klassenmethode und jeden Konstruktor direkt davor mit einem kurzen deutschen Kommentar. Erkläre Zweck, wichtige Ein-/Ausgaben und relevante Nebenwirkungen; beschreibe bei nicht offensichtlichen Callbacks den Ablauf. Halte Kommentare bei Änderungen aktuell und formatiere Code lesbar. Kommentare sollen Verhalten erklären, nicht bloß den Funktionsnamen wiederholen.
- Speichere Windows-PowerShell-Skripte (`.ps1`) als UTF-8 mit BOM, damit Windows PowerShell 5.1 deutsche Kommentare und Meldungen korrekt einliest.

Portable Node: `.tools/node-v26.13.1-win-x64/node.exe`. Add its directory to the process PATH when running npm.
