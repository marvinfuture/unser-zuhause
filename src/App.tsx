import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Archive,
  BookOpen,
  CalendarDays,
  Camera,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  DoorOpen,
  Download,
  Ellipsis,
  FolderHeart,
  Heart,
  House,
  ImagePlus,
  Images,
  Leaf,
  ListTodo,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import {
  localDay,
  progress,
  TASK_PHASES,
  taskPhaseLabels,
  type AppState,
  type BaseRecord,
  type Collection,
  type Comparison,
  type Defect,
  type Photo,
  type Priority,
  type ProfileId,
  type Project,
  type Session,
  type ShoppingItem,
  type Task,
} from '../shared/types';
import {
  api,
  ApiError,
  hasSameAuthorContext,
  photoUrl,
  uploadPhoto,
  type AuthorContext,
} from './api';

type AnyRecord = BaseRecord & Record<string, any>;
type EditorSpec = {
  collection: Collection;
  record?: AnyRecord;
  defaults?: Record<string, any>;
  profileVersion: number;
  profileId: ProfileId | null;
  csrfToken: string;
};
const priorityLabels: Record<Priority, string> = {
  urgent: 'Dringend',
  high: 'Hoch',
  normal: 'Normal',
  later: 'Später',
};
const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, later: 3 };
const projectStatus = {
  idea: 'Idee',
  planned: 'Geplant',
  active: 'In Arbeit',
  paused: 'Pausiert',
  done: 'Abgeschlossen',
};
const taskStatus = { open: 'Offen', active: 'In Arbeit', blocked: 'Blockiert', done: 'Erledigt' };
const defectStatus = { open: 'Offen', active: 'In Bearbeitung', resolved: 'Behoben' };
const categoryLabels = { before: 'Vorher', progress: 'Zwischenstand', after: 'Nachher' };
const collectionLabels: Record<Collection, string> = {
  rooms: 'Raum',
  projects: 'Projekt',
  tasks: 'Aufgabe',
  shopping: 'Einkauf',
  defects: 'Mangel',
  notes: 'Notiz',
  comparisons: 'Fotovergleich',
};
/**
 * Formatiert einen Zeitstempel oder ein reines Tagesdatum mit Jahr für die deutsche Anzeige.
 * Tagesdaten erhalten eine lokale Mittagszeit; die Ausgabe verwendet Europe/Berlin.
 */
const fullDate = (value: string) =>
  new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
/**
 * Erzeugt die kurze deutsche Tagesanzeige für Fälligkeiten. Reine Datumswerte werden zur Anzeige um
 * eine Mittagszeit ergänzt.
 */
const shortDate = (value: string) =>
  new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Berlin',
  }).format(new Date(`${value}T12:00:00`));
/** Wandelt den intern ganzzahligen Centbetrag in eine deutsche Euro-Anzeige um. */
const money = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
/** Kürzt Speichergrößen anhand von 1024er-Schritten zu MB oder GB mit einer Nachkommastelle. */
const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;
/**
 * Übersetzt die beiden festen Profil-IDs in Anzeigenamen; eine fehlende Zuordnung erscheint als
 * „Noch offen“.
 */
const name = (profile: ProfileId | null | undefined) =>
  profile === 'karla' ? 'Karla' : profile === 'marvin' ? 'Marvin' : 'Noch offen';
/**
 * Liefert nur nicht archivierte Datensätze, ohne die ursprüngliche Liste zu verändern. Der
 * Foto-Papierkorb wird zusätzlich in der Galerie behandelt.
 */
const active = <T extends BaseRecord>(records: T[]) =>
  records.filter((record) => !record.archivedAt);
/**
 * Wechselt die Ansicht über den URL-Hash und setzt die Scrollposition zurück. Die Navigation
 * benötigt keinen neuen Serveraufruf für die HTML-Seite.
 */
const go = (path: string) => {
  location.hash = `#/${path}`;
  window.scrollTo({ top: 0, behavior: 'instant' });
};
/**
 * Übernimmt eine vorhandene Fehlermeldung oder liefert einen verständlichen Ersatz für unbekannte
 * Fehlerwerte.
 */
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Das hat nicht geklappt. Bitte versuche es erneut.';

/** Ermittelt unerledigte Vorgänger, einschließlich fehlender Verweise, ohne Aufgaben zu verändern. */
function waitingFor(task: Pick<Task, 'predecessorIds'>, tasks: Task[]) {
  return (task.predecessorIds || [])
    .map((id) => ({ id, task: tasks.find((candidate) => candidate.id === id) }))
    .filter((entry) => !entry.task || entry.task.status !== 'done');
}

/** Eine offene Aufgabe ist erst startbereit, wenn alle Vorgänger erledigt sind und keine manuelle Sperre besteht. */
function isReady(task: Task, tasks: Task[]) {
  return task.status === 'open' && waitingFor(task, tasks).length === 0;
}

/** Ordnet Aufgaben dem Board zu; Abhängigkeiten und manuelle Sperren haben Vorrang vor offenen Arbeiten. */
function boardColumn(task: Task, tasks: Task[]): 'open' | 'waiting' | 'active' | 'done' {
  if (task.status === 'done') return 'done';
  if (task.status === 'blocked' || waitingFor(task, tasks).length) return 'waiting';
  return task.status === 'active' ? 'active' : 'open';
}

interface AppContextValue {
  state: AppState;
  session: Session;
  online: boolean;
  refresh: () => Promise<void>;
  edit: (collection: Collection, record?: BaseRecord, defaults?: Record<string, any>) => void;
  mutate: (collection: string, record: BaseRecord, fields: Record<string, any>) => Promise<boolean>;
  notify: (text: string, error?: boolean) => void;
}
const AppContext = createContext<AppContextValue>(null!);
/**
 * Gibt den gemeinsamen Datenstand und die zentralen Aktionen aus dem App-Provider zurück. Aufruf
 * nur innerhalb dieses Providers.
 */
const useApp = () => useContext(AppContext);

/**
 * Zeichnet die rein dekorative Hausillustration als lokales SVG. Die Grafik enthält keine
 * Nutzerdaten und wird für Screenreader ausgeblendet.
 */
function HouseDrawing({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? 'house-drawing small' : 'house-drawing'}
      viewBox="0 0 360 250"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="185" cy="224" rx="151" ry="14" fill="#D9DFCF" />
      <path
        d="M74 217V124L177 51L282 126V217H74Z"
        fill="#FFF9EA"
        stroke="#456557"
        strokeWidth="2.5"
      />
      <path
        d="M56 129L176 40L301 131"
        stroke="#456557"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M60 123L177 37L297 125"
        stroke="#D59678"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M236 78V42H257V94" fill="#D59678" stroke="#456557" strokeWidth="2" />
      <path d="M105 155V120H141V155H105Z" fill="#DCE7D5" stroke="#456557" strokeWidth="2" />
      <path d="M123 120V155M105 138H141" stroke="#456557" strokeWidth="2" />
      <path d="M220 155V120H255V155H220Z" fill="#DCE7D5" stroke="#456557" strokeWidth="2" />
      <path d="M237 120V155M220 138H255" stroke="#456557" strokeWidth="2" />
      <path
        d="M161 217V164C161 139 198 139 198 164V217"
        fill="#88A082"
        stroke="#456557"
        strokeWidth="2"
      />
      <circle cx="188" cy="184" r="2.8" fill="#FFF9EA" />
      <circle cx="178" cy="104" r="14" fill="#EAD5A8" stroke="#456557" strokeWidth="2" />
      <path d="M177 90V117M164 104H192" stroke="#456557" strokeWidth="2" />
      <path d="M155 223H202L219 239H138L155 223Z" fill="#CBBCA3" />
      <path
        d="M91 216V185M91 205C66 201 67 185 70 180C86 183 94 191 91 205ZM91 197C112 192 111 180 109 177C97 179 90 185 91 197Z"
        fill="#88A082"
        stroke="#456557"
        strokeWidth="1.5"
      />
      <path
        d="M267 218V188M267 205C244 201 244 188 247 182C261 184 269 193 267 205ZM267 198C285 193 288 181 284 176C271 179 266 187 267 198Z"
        fill="#88A082"
        stroke="#456557"
        strokeWidth="1.5"
      />
      <path
        d="M43 211V161M43 191C19 182 20 162 29 153C43 163 48 178 43 191ZM43 179C64 170 65 152 56 146C46 153 41 165 43 179Z"
        fill="#ACBBA0"
      />
      <path
        d="M316 216V170M316 194C291 187 296 168 302 162C316 171 319 183 316 194ZM316 185C337 179 341 160 332 151C320 161 314 172 316 185Z"
        fill="#ACBBA0"
      />
      <path
        d="M282 52L287 43M302 65L312 62M260 32V23"
        stroke="#B39155"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M58 59C66 46 77 48 85 53" stroke="#9DAD91" strokeWidth="2" strokeLinecap="round" />
      <path d="M48 60C38 48 29 49 23 55" stroke="#9DAD91" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Zeigt das gemeinsame App-Logo mit Wortmarke für Navigation, Anmeldung und Ladeansichten. */
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <House size={23} />
        <Heart size={10} className="brand-heart" />
      </span>
      <span>
        Unser Zuhause<small>PLATZ FÜR EURE IDEEN</small>
      </span>
    </div>
  );
}
/**
 * Stellt ein freiwilliges Personen-Namensschild dar. Farbe und Initiale ergänzen den
 * ausgeschriebenen Namen; sie ersetzen keinen Identitätsnachweis.
 */
function Person({
  id,
  prefix = '',
  compact = false,
}: {
  id?: ProfileId | null;
  prefix?: string;
  compact?: boolean;
}) {
  return (
    <span className={`person ${id || 'none'} ${compact ? 'compact' : ''}`}>
      <span className="person-dot">{id ? name(id)[0] : '–'}</span>
      {prefix}
      {name(id)}
    </span>
  );
}
/**
 * Zeigt die fachliche Priorität mit Text und Farbpunkten, sodass die Bedeutung nicht allein von
 * einer Farbe abhängt.
 */
function PriorityBadge({ value }: { value: Priority }) {
  return (
    <span className={`priority ${value}`}>
      <span />
      {priorityLabels[value]}
    </span>
  );
}
/** Rendert einen erklärenden Leerzustand mit optionalem Einstieg in die passende Anlegeaktion. */
function Empty({
  icon = <Sprout />,
  title,
  children,
  action,
  onAction,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action && (
        <button className="button primary" onClick={onAction}>
          <Plus size={17} />
          {action}
        </button>
      )}
    </div>
  );
}
/** Vereinheitlicht Seitenüberschrift, Einleitung und optionale Hauptaktion der Fachansichten. */
function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
/**
 * Berechnet den Projektfortschritt aus nicht archivierten Aufgaben. Ein Projekt ohne Aufgaben zeigt
 * keinen künstlichen Fertigstellungswert.
 */
function Progress({ projectId }: { projectId: string }) {
  const { state } = useApp();
  const value = progress(projectId, state.tasks);
  const total = active(state.tasks).filter((t) => t.projectId === projectId);
  return (
    <div className="progress-block">
      <div>
        <span>
          {value === null
            ? 'Noch keine Aufgaben'
            : `${total.filter((t) => t.status === 'done').length} von ${total.length} Aufgaben`}
        </span>
        <strong>{value === null ? '—' : `${value} %`}</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${value || 0}%` }} />
      </div>
    </div>
  );
}
/**
 * Unterscheidet gemeinsame Zuständigkeit, genau eine zugeteilte Person und noch offene Zuteilung.
 */
function Assignees({ ids }: { ids: ProfileId[] }) {
  return ids.length === 2 ? (
    <span className="together">
      <Users size={13} />
      Gemeinsam
    </span>
  ) : (
    <Person id={ids[0]} compact />
  );
}

/**
 * Verwendet ein natives modales Dialogelement für Fokusführung und Hintergrundsperre. Escape und
 * ein Klick auf den Hintergrund delegieren das Schließen an den Aufrufer.
 */
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // showModal übernimmt Fokusfalle und Hintergrundsperre; das Aufräumen schließt den Dialog beim Entfernen.
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-label={title}
      onCancel={(event) => {
        // Der Aufrufer darf Schließen etwa während eines Uploads blockieren; nicht nativ vorzeitig schließen.
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={close} aria-label="Schließen">
            <X />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/**
 * Verwaltet Gerätesitzung, gemeinsame Daten, Hash-Navigation und globale Dialoge. Der Einstieg
 * erfolgt direkt über die Profilwahl; eine Generation schützt vor verspäteten Sitzungsantworten.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState(location.hash.replace(/^#\/?/, '') || 'overview');
  const [editor, setEditor] = useState<EditorSpec | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [initialError, setInitialError] = useState('');
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const sessionEpoch = useRef(0);
  const sessionTransition = useRef(false);
  const resetPending = useRef<Session | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Zeigt jeweils die neueste Rückmeldung und ersetzt deren bisherigen Schließtimer.
   * Fehlermeldungen bleiben länger sichtbar als Erfolgsmeldungen.
   */
  const notify = useCallback((text: string, error = false) => {
    setToast({ text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 9000 : 4000);
  }, []);
  /**
   * Macht laufende Leseantworten ungültig und beendet ihren Transport. Eine neue Profilaktion
   * erhält damit eine eigene Generation, die alte Antworten nicht mehr überschreiben dürfen.
   */
  const invalidateRefresh = useCallback(() => {
    sessionEpoch.current += 1;
    refreshController.current?.abort();
    refreshController.current = null;
    pendingRefresh.current = null;
    return sessionEpoch.current;
  }, []);
  /**
   * Liest Sitzung und Daten nach einer Mutation garantiert neu. Nur regelmäßige Leser mit fresh=false
   * teilen eine Anfrage; Antworten vor einer Mutation oder Profilaktion werden per Generation verworfen.
   */
  const refresh = useCallback(
    async (fresh = true) => {
      if (sessionTransition.current || resetPending.current) return;
      if (fresh) invalidateRefresh();
      if (pendingRefresh.current) return pendingRefresh.current;
      const epoch = sessionEpoch.current;
      const controller = new AbortController();
      refreshController.current = controller;
      // Sitzung und Daten werden gemeinsam übernommen, damit kein älterer Profilstand dazwischen sichtbar wird.
      const job = (async () => {
        try {
          const current = await api<Session>('/session', { signal: controller.signal });
          if (epoch !== sessionEpoch.current || controller.signal.aborted) return;
          const nextState = current.profileId
            ? await api<AppState>('/state', { signal: controller.signal })
            : null;
          if (epoch !== sessionEpoch.current || controller.signal.aborted) return;
          setSession(current);
          setState(nextState);
          if (!current.profileId) {
            setEditor(null);
            setProfileOpen(false);
          }
          setOnline(true);
          setInitialError('');
        } catch (error) {
          if (epoch !== sessionEpoch.current || controller.signal.aborted) return;
          setOnline(false);
          setInitialError(errorText(error));
        } finally {
          // Das Ende einer alten Anfrage darf weder den neuen Ladezustand noch dessen Promise zurücksetzen.
          if (epoch === sessionEpoch.current && !controller.signal.aborted) {
            setLoading(false);
            pendingRefresh.current = null;
            refreshController.current = null;
          }
        }
      })();
      pendingRefresh.current = job;
      return job;
    },
    [invalidateRefresh],
  );
  // Navigation, Rückkehr in den Tab und ein sparsamer Timer halten die Ansicht über Geräte hinweg aktuell.
  useEffect(() => {
    void refresh(false);
    /** Übernimmt die Browser-Navigation aus dem Hash; eine leere Route führt zur Übersicht. */
    const onHash = () => setRoute(location.hash.replace(/^#\/?/, '') || 'overview');
    /**
     * Aktualisiert beim Wiederkehren nur sichtbare Dokumente, damit Hintergrundtabs keine unnötigen
     * Abrufe auslösen.
     */
    const onFocus = () => {
      if (!document.hidden) void refresh(false);
    };
    /**
     * Prüft Sitzung und Daten auch nach Wiederherstellung einer Seite durch die Browsernavigation
     * erneut.
     */
    const onPageShow = () => {
      void refresh(false);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const poll = setInterval(() => {
      if (!document.hidden) void refresh(false);
    }, 10000);
    // Alle registrierten Quellen entfernen, damit Remounts keine doppelten Listener oder Timer hinterlassen.
    return () => {
      clearInterval(poll);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);
  /**
   * Öffnet den passenden Datensatzeditor und merkt sich das aktuell ausgewählte Profil samt
   * Versionsnummer. Spätere Profilwechsel dürfen diesen Bearbeitungskontext nicht unbemerkt
   * ersetzen.
   */
  const edit = useCallback(
    (collection: Collection, record?: BaseRecord, defaults?: Record<string, any>) => {
      if (!session?.profileId) {
        setProfileOpen(true);
        return;
      }
      setEditor({
        collection,
        record: record as AnyRecord | undefined,
        defaults,
        profileVersion: session.profileVersion,
        profileId: session.profileId,
        csrfToken: session.csrfToken,
      });
    },
    [session],
  );
  /**
   * Sendet eine kleine Änderung mit Datensatz- und Profilversion und lädt danach den Serverstand.
   * Konflikte werden gemeldet statt lokal über fremde Änderungen geschrieben; der Rückgabewert
   * bestätigt den Erfolg der Mutation.
   */
  const mutate = async (collection: string, record: BaseRecord, fields: Record<string, any>) => {
    try {
      await api(`/${collection}/${record.id}`, {
        method: 'PATCH',
        session,
        body: { ...fields, version: record.version, profileVersion: session!.profileVersion },
      });
      await refresh();
      return true;
    } catch (error) {
      notify(errorText(error), true);
      if (error instanceof ApiError && error.status === 409) await refresh();
      return false;
    }
  };
  /**
   * Wählt ein Profil in der aktuellen Gerätesitzung. Während des Wechsels ruht das Polling;
   * die direkte Serverantwort ersetzt den Profilstand, bevor neue Daten geladen werden.
   */
  const chooseProfile = async (profileId: ProfileId) => {
    if (!session || sessionTransition.current) return;
    const previous = session;
    const epoch = invalidateRefresh();
    sessionTransition.current = true;
    try {
      const nextSession = await api<Session>('/profile', {
        method: 'POST',
        session: previous,
        body: { profileId, profileVersion: previous.profileVersion },
      });
      if (epoch !== sessionEpoch.current) return;
      setSession(nextSession);
      resetPending.current = null;
      setProfileOpen(false);
      const nextState = await api<AppState>('/state');
      if (epoch !== sessionEpoch.current) return;
      setState(nextState);
      setOnline(true);
      setInitialError('');
    } catch (error) {
      if (epoch !== sessionEpoch.current) return;
      setInitialError(errorText(error));
      if (error instanceof ApiError && error.status === 0) setOnline(false);
      throw error;
    } finally {
      if (epoch === sessionEpoch.current) {
        sessionTransition.current = false;
        setLoading(false);
      }
    }
  };
  /**
   * Kehrt sofort in einen neutralen Zustand zurück und ersetzt die Gerätesitzung serverseitig.
   * Die DELETE-Antwort wird direkt übernommen. Nach einem Übertragungsfehler bleibt das Polling
   * gesperrt, bis ein bewusster Wiederholungsversuch den tatsächlichen Sitzungsstand geklärt hat.
   */
  const resetProfile = async () => {
    if (sessionTransition.current) return;
    const retry = !!resetPending.current;
    const previous = resetPending.current || session;
    if (!previous) return;
    const epoch = invalidateRefresh();
    sessionTransition.current = true;
    resetPending.current = previous;
    setSession(null);
    setState(null);
    setEditor(null);
    setProfileOpen(false);
    setToast(null);
    setInitialError('');
    setLoading(true);
    try {
      // Bei verlorener DELETE-Antwort können Cookie und CSRF-Token bereits erneuert sein.
      const current = retry ? await api<Session>('/session') : previous;
      if (epoch !== sessionEpoch.current) return;
      const nextSession =
        retry && !current.profileId
          ? current
          : await api<Session>('/session', { method: 'DELETE', session: current });
      if (epoch !== sessionEpoch.current) return;
      resetPending.current = null;
      setSession(nextSession);
      setOnline(true);
    } catch (error) {
      if (epoch !== sessionEpoch.current) return;
      setInitialError(
        `Die Profilauswahl konnte noch nicht zurückgesetzt werden. ${errorText(error)}`,
      );
      setOnline(false);
    } finally {
      if (epoch === sessionEpoch.current) {
        sessionTransition.current = false;
        setLoading(false);
      }
    }
  };
  if (loading)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <p>Euer Zuhause wird geöffnet …</p>
      </div>
    );
  if (!session)
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand />
          <WifiOff className="auth-symbol" />
          <h1>Wir finden euren Zuhause-PC gerade nicht.</h1>
          <p>{initialError}</p>
          <button
            className="button primary"
            onClick={() => void (resetPending.current ? resetProfile() : refresh())}
          >
            <RefreshCw size={17} />
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  if (!session.profileId) return <ProfilePicker session={session} chooseProfile={chooseProfile} />;
  if (!state)
    return (
      <div className="loading-screen">
        <Brand />
        <p>{initialError || 'Eure Daten werden geladen …'}</p>
        <button className="button" onClick={() => void refresh()}>
          Erneut laden
        </button>
      </div>
    );
  const section = route.split('/')[0];
  const nav = [
    { id: 'overview', label: 'Übersicht', icon: House },
    { id: 'projects', label: 'Projekte', icon: FolderHeart },
    { id: 'tasks', label: 'Aufgaben', icon: ListTodo },
    { id: 'shopping', label: 'Einkauf', icon: ShoppingBasket },
    { id: 'house', label: 'Unser Haus', mobile: 'Haus', icon: DoorOpen },
  ];
  return (
    <AppContext.Provider value={{ state, session, online, refresh, edit, mutate, notify }}>
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand-link" href="#/overview" aria-label="Zur Übersicht">
            <Brand />
          </a>
          <div className="sidebar-label">EUER RENOVIERUNGSBUCH</div>
          <nav aria-label="Hauptnavigation">
            {nav.map((item) => (
              <a
                key={item.id}
                className={section === item.id ? 'nav-item selected' : 'nav-item'}
                href={`#/${item.id}`}
                aria-current={section === item.id ? 'page' : undefined}
              >
                <item.icon size={20} />
                {item.label}
                {item.id === 'tasks' &&
                  active(state.tasks).filter((t) => t.status !== 'done').length > 0 && (
                    <span className="nav-count">
                      {active(state.tasks).filter((t) => t.status !== 'done').length}
                    </span>
                  )}
              </a>
            ))}
          </nav>
          <div className="sidebar-note">
            <Sprout size={26} />
            <p>
              Ein Schritt nach dem anderen.
              <br />
              <strong>Gemeinsam wird’s schön.</strong>
            </p>
            <span className="handwritten">Karla & Marvin</span>
          </div>
          <div className="sidebar-bottom">
            <a className={`nav-item ${section === 'settings' ? 'selected' : ''}`} href="#/settings">
              <Settings size={19} />
              Einstellungen
            </a>
            <button className="profile-button" onClick={() => setProfileOpen(true)}>
              <span className={`avatar ${session.profileId}`}>{name(session.profileId)[0]}</span>
              <span>
                <strong>{name(session.profileId)}</strong>
                <small>Profil wechseln</small>
              </span>
              <Ellipsis size={19} />
            </button>
          </div>
        </aside>
        <div className="main-area">
          <header className="topbar">
            <div className="topbar-brand">
              <Brand />
            </div>
            <div className="topbar-date">
              <Leaf size={16} />
              {new Intl.DateTimeFormat('de-DE', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: 'Europe/Berlin',
              }).format(new Date())}
            </div>
            <div className="topbar-right">
              <span className={`connection ${online ? '' : 'disconnected'}`}>
                {online ? <Wifi size={14} /> : <WifiOff size={14} />}
                <span>{online ? 'Zuhause verbunden' : 'Keine Verbindung'}</span>
              </span>
              <button
                className={`avatar ${session.profileId}`}
                onClick={() => setProfileOpen(true)}
                aria-label={`Profil ${name(session.profileId)}, wechseln`}
              >
                {name(session.profileId)[0]}
              </button>
            </div>
          </header>
          {!online && (
            <div className="offline-banner" role="status">
              <WifiOff size={18} />
              <span>
                Keine Verbindung zu eurem Zuhause-PC. Neue Änderungen werden erst nach erfolgreichem
                Speichern übernommen.
              </span>
              <button onClick={() => void refresh()}>Erneut verbinden</button>
            </div>
          )}
          <main id="main" className="main-content">
            {section === 'overview' ? (
              <Dashboard />
            ) : section === 'projects' ? (
              route.split('/')[1] ? (
                <ProjectDetail id={route.split('/')[1]} />
              ) : (
                <Projects />
              )
            ) : section === 'tasks' ? (
              <TasksView />
            ) : section === 'shopping' ? (
              <ShoppingView />
            ) : section === 'house' ? (
              <HouseView />
            ) : section === 'settings' ? (
              <SettingsView resetProfile={resetProfile} openProfiles={() => setProfileOpen(true)} />
            ) : (
              <Dashboard />
            )}
          </main>
          <footer className="app-footer">
            <Heart size={13} />
            Unser Zuhause · Ein gemeinsames Stück Zuhause.
          </footer>
        </div>
        <nav className="bottom-nav" aria-label="Mobile Hauptnavigation">
          {nav.map((item) => (
            <a
              href={`#/${item.id}`}
              key={item.id}
              className={section === item.id ? 'selected' : ''}
              aria-current={section === item.id ? 'page' : undefined}
            >
              <item.icon size={21} />
              <span>{item.mobile || item.label}</span>
            </a>
          ))}
        </nav>
      </div>
      {editor && <RecordEditor spec={editor} close={() => setEditor(null)} />}
      {profileOpen && (
        <Modal title="Wer ist gerade hier?" close={() => setProfileOpen(false)}>
          <ProfilePicker
            session={session}
            chooseProfile={chooseProfile}
            resetProfile={resetProfile}
            close={() => setProfileOpen(false)}
            embedded
          />
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleAlert size={19} /> : <CircleCheck size={19} />}
          <span>{toast.text}</span>
          <button aria-label="Meldung schließen" onClick={() => setToast(null)}>
            <X size={17} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}

/**
 * Bietet den direkten Einstieg über Karla oder Marvin. Die Auswahl kennzeichnet Einträge und
 * bleibt auf diesem Gerät erhalten; sie ist kein persönlicher Zugriffsschutz.
 */
function ProfilePicker({
  session,
  chooseProfile,
  resetProfile,
  close,
  embedded = false,
}: {
  session: Session;
  chooseProfile: (id: ProfileId) => Promise<void>;
  resetProfile?: () => Promise<void>;
  close?: () => void;
  embedded?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Sperrt weitere Klicks während der Profilwahl und lässt Fehler direkt bei der Auswahl stehen. */
  async function choose(id: ProfileId) {
    setBusy(true);
    setError('');
    try {
      await chooseProfile(id);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const content = (
    <>
      <p className="profile-intro">
        Wähle deinen Namen. Neue Einträge tragen dann dein Namensschild.
      </p>
      <div className="profile-options">
        {session.profiles.map((profile) => (
          <button
            disabled={busy}
            key={profile.id}
            className={`profile-option ${profile.id} ${session.profileId === profile.id ? 'current' : ''}`}
            onClick={() => void choose(profile.id)}
          >
            <span className={`avatar large ${profile.id}`}>{profile.name[0]}</span>
            <strong>{profile.name}</strong>
            <span>{session.profileId === profile.id ? 'Gerade ausgewählt' : 'Das bin ich'}</span>
            {session.profileId === profile.id && <Check size={18} />}
          </button>
        ))}
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <p className="tiny-note">
        Eure Daten liegen gemeinsam im Heimnetz. Die Profilwahl zeigt, von wem ein Eintrag stammt.
      </p>
      {embedded && (
        <div className="profile-footer">
          <button
            disabled={busy}
            className="button secondary"
            onClick={() => {
              close?.();
              go('settings');
            }}
          >
            <Settings size={16} />
            Einstellungen
          </button>
          {resetProfile && (
            <button
              disabled={busy}
              className="button text-button"
              onClick={() => void resetProfile()}
            >
              <Users size={16} />
              Zur Profilauswahl
            </button>
          )}
        </div>
      )}
    </>
  );
  return embedded ? (
    content
  ) : (
    <div className="auth-page profile-page">
      <div className="auth-card">
        <Brand />
        <h1>Wer ist gerade hier?</h1>
        {content}
        <p className="profile-home-note">
          <Wifi size={14} />
          Bei euch zu Hause. Für eure gemeinsamen Pläne.
        </p>
      </div>
    </div>
  );
}

/**
 * Leitet Kennzahlen, laufende Projekte, geplante Reihenfolge und nächste Aufgaben aus dem
 * gemeinsamen Datenstand ab. Es werden keine dekorativen Beispieldaten eingesetzt.
 */
function Dashboard() {
  const { state, session, edit } = useApp();
  const projects = active(state.projects);
  const tasks = active(state.tasks);
  const pending = tasks.filter((task) => task.status !== 'done');
  const current = projects.filter((p) => p.status === 'active');
  const next = projects
    .filter((p) => p.status === 'planned' || p.status === 'idea')
    .sort((a, b) => a.rank - b.rank);
  const today = localDay();
  const important = [...pending]
    .sort(
      (a, b) =>
        Number(isReady(b, state.tasks)) - Number(isReady(a, state.tasks)) ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
        priorityOrder[a.priority] - priorityOrder[b.priority],
    )
    .slice(0, 4);
  const unfinished = active(state.defects).filter((d) => d.status !== 'resolved');
  return (
    <>
      <PageTitle
        eyebrow="GEMEINSAM ETWAS SCHÖNES SCHAFFEN"
        title={`Hallo ${name(session.profileId)}.`}
        description="Hier werden aus euren Ideen die nächsten Schritte."
        action={
          <button className="button primary" onClick={() => edit('projects')}>
            <Plus size={18} />
            Neues Projekt
          </button>
        }
      />
      <section className="hero">
        <div className="hero-text">
          <span className="pill">
            <Sprout size={14} />
            EIN SCHRITT NACH DEM ANDEREN
          </span>
          <h2>
            Euer Zuhause.
            <br />
            Eure nächste schöne Idee.
          </h2>
          <p>
            {next.length
              ? `„${next[0].title}“ wartet auf seinen ersten Schritt. Plant heute, worauf ihr euch morgen freut.`
              : 'Ein frischer Anstrich, ein gemütlicher Raum, ein lange gehegter Plan. Was möchtet ihr als Nächstes angehen?'}
          </p>
          <button
            className="button primary"
            onClick={() => (next.length ? go(`projects/${next[0].id}`) : edit('projects'))}
          >
            {next.length ? 'Nächstes Vorhaben ansehen' : 'Erste Idee festhalten'}
            <ArrowRight size={17} />
          </button>
        </div>
        <div className="hero-art">
          <HouseDrawing />
          <span className="hero-art-label">Hier wächst etwas Schönes.</span>
        </div>
      </section>
      <div className="stats-grid">
        <Stat
          icon={<FolderHeart />}
          value={current.length}
          label="Projekte in Arbeit"
          tone="sage"
          onClick={() => go('projects')}
        />
        <Stat
          icon={<CheckSquare />}
          value={pending.length}
          label="Offene Aufgaben"
          tone="sand"
          onClick={() => go('tasks')}
        />
        <Stat
          icon={<ShoppingBasket />}
          value={active(state.shopping).filter((s) => !s.purchased).length}
          label="Auf der Einkaufsliste"
          tone="rose"
          onClick={() => go('shopping')}
        />
        <Stat
          icon={<Wrench />}
          value={unfinished.length}
          label="Mängel im Blick"
          tone="lavender"
          onClick={() => go('house')}
        />
      </div>
      <div className="dashboard-columns">
        <section>
          <div className="section-title">
            <h2>
              Hier geht’s voran <span className="count">{current.length}</span>
            </h2>
            <button className="text-link" onClick={() => go('projects')}>
              Alle Projekte
              <ArrowRight size={15} />
            </button>
          </div>
          {current.length ? (
            <div className="project-grid dashboard-projects">
              {current.slice(0, 2).map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <div className="panel">
              <Empty
                title="Raum für euren ersten Plan"
                action="Projekt anlegen"
                onAction={() => edit('projects')}
              >
                Von der kleinen Reparatur bis zum neuen Lieblingszimmer: Alles beginnt mit einer
                Idee.
              </Empty>
            </div>
          )}
          <div className="section-title next-heading">
            <h2>Als Nächstes</h2>
            <span className="subtle">Eure Reihenfolge</span>
          </div>
          <div className="panel next-list">
            {next.length ? (
              next.slice(0, 3).map((project, i) => (
                <button
                  className="next-item"
                  key={project.id}
                  onClick={() => go(`projects/${project.id}`)}
                >
                  <span className="next-number">0{i + 1}</span>
                  <span>
                    <strong>{project.title}</strong>
                    <small>
                      {state.rooms.find((r) => r.id === project.roomId)?.title ||
                        'Allgemein im Haus'}
                    </small>
                  </span>
                  <PriorityBadge value={project.priority} />
                  <ChevronRight size={17} />
                </button>
              ))
            ) : (
              <div className="quiet-empty">
                <Leaf size={18} />
                <p>Eure nächsten Renovierungsideen finden hier ihren Platz.</p>
              </div>
            )}
          </div>
        </section>
        <section className="dashboard-right">
          <div className="section-title">
            <h2>Die nächsten Schritte</h2>
            <button
              className="icon-button subtle-button"
              aria-label="Aufgabe anlegen"
              onClick={() => edit('tasks')}
            >
              <Plus size={19} />
            </button>
          </div>
          <div className="panel task-panel">
            {important.length ? (
              <>
                {important.map((task) => (
                  <TaskRow key={task.id} task={task} compact />
                ))}
                <button className="panel-footer-link" onClick={() => go('tasks')}>
                  Alle Aufgaben ansehen
                  <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <Empty
                icon={<CheckCheck />}
                title="Noch alles ganz entspannt"
                action="Aufgabe hinzufügen"
                onAction={() => edit('tasks')}
              >
                Haltet fest, was ansteht, und verteilt es so, wie es für euch passt.
              </Empty>
            )}
          </div>
          <div className="gentle-card">
            <span>
              <Heart size={20} />
            </span>
            <div>
              <h3>Jeder kleine Schritt zählt.</h3>
              <p>
                {tasks.some((t) => t.status === 'done')
                  ? `Ihr habt schon ${tasks.filter((t) => t.status === 'done').length} ${tasks.filter((t) => t.status === 'done').length === 1 ? 'Aufgabe' : 'Aufgaben'} geschafft. Schön, was gemeinsam entsteht.`
                  : 'Hier gibt es keinen Zeitdruck. Nur eure Pläne und die Freude, gemeinsam etwas zu verändern.'}
              </p>
            </div>
          </div>
          {pending.some((t) => t.dueDate && t.dueDate < today) && (
            <button className="attention-card" onClick={() => go('tasks')}>
              <CalendarDays size={20} />
              <span>
                <strong>Ein Blick auf eure Termine</strong>
                <small>
                  {pending.filter((t) => t.dueDate && t.dueDate < today).length} offene Aufgaben
                  sind über ihren geplanten Termin hinaus.
                </small>
              </span>
              <ArrowRight size={16} />
            </button>
          )}
        </section>
      </div>
    </>
  );
}
/**
 * Zeigt eine einzelne Dashboard-Kennzahl als anklickbaren Einstieg in die zugehörige Fachansicht.
 */
function Stat({
  icon,
  value,
  label,
  tone,
  onClick,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className="stat-card" onClick={onClick}>
      <span className={`stat-icon ${tone}`}>{icon}</span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
      <ArrowRight size={15} />
    </button>
  );
}

/**
 * Zeigt Projektstatus, Raum, Fortschritt und Priorität. Als Titelbild dient ein verfügbares
 * Projektfoto; ohne Foto erscheint eine lokale Illustration.
 */
function ProjectCard({ project }: { project: Project }) {
  const { state, edit } = useApp();
  const room = state.rooms.find((r) => r.id === project.roomId);
  const cover = state.photos.find(
    (p) => p.projectId === project.id && !p.deletedAt && !p.archivedAt,
  );
  const isDone = project.status === 'done';
  return (
    <article className="project-card">
      <button
        className={`project-cover ${cover ? '' : 'illustrated'}`}
        onClick={() => go(`projects/${project.id}`)}
        aria-label={`${project.title} öffnen`}
      >
        {cover ? (
          <img
            src={photoUrl(cover.id, 'thumb')}
            alt={cover.title || project.title}
            loading="lazy"
          />
        ) : (
          <>
            <span className="room-line-art">
              <House size={70} strokeWidth={1} />
              <Sprout size={27} />
            </span>
            <span className="cover-room">{room?.title || 'Ein neues Stück Zuhause'}</span>
          </>
        )}
        <span className={`status cover-status ${project.status}`}>
          {isDone && <Check size={12} />} {projectStatus[project.status]}
        </span>
      </button>
      <div className="project-card-body">
        <div className="card-eyebrow">
          {room?.title || 'Unser Haus'}
          <button
            className="icon-button"
            aria-label={`${project.title} bearbeiten`}
            onClick={() => edit('projects', project)}
          >
            <Ellipsis size={19} />
          </button>
        </div>
        <button className="heading-button" onClick={() => go(`projects/${project.id}`)}>
          <h3>{project.title}</h3>
        </button>
        <p className="card-description">
          {project.description || 'Ein neuer Plan für euer Zuhause.'}
        </p>
        <Progress projectId={project.id} />
        <div className="card-footer">
          <PriorityBadge value={project.priority} />
          {project.dueDate ? (
            <span className="date-label">
              <CalendarDays size={13} />
              {shortDate(project.dueDate)}
            </span>
          ) : (
            <Person id={project.createdBy} compact />
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Verwaltet Projektübersicht, Suche, Statusfilter und Archiv. Die Ansicht „Als Nächstes“ zeigt die
 * gespeicherte gemeinsame Planreihenfolge.
 */
function Projects() {
  const { state, edit, mutate } = useApp();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const items = state.projects
    .filter(
      (p) =>
        !!p.archivedAt === archived &&
        (filter === 'all' ||
          (filter === 'planned' && ['planned', 'idea'].includes(p.status)) ||
          p.status === filter) &&
        p.title.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')),
    )
    .sort((a, b) => a.rank - b.rank);
  /**
   * Verschiebt ein geplantes Projekt um eine Position, indem es einen Rang zwischen benachbarten
   * Rängen erhält. Nur der betroffene Datensatz wird mit Versionsprüfung geändert.
   */
  async function move(project: Project, direction: -1 | 1) {
    const list = active(state.projects)
      .filter((p) => ['idea', 'planned'].includes(p.status))
      .sort((a, b) => a.rank - b.rank);
    const i = list.findIndex((p) => p.id === project.id);
    const other = list[i + direction];
    if (!other) return;
    const target = i + direction;
    const rank =
      direction === -1
        ? list[target - 1]
          ? (list[target - 1].rank + other.rank) / 2
          : other.rank / 2
        : list[target + 1]
          ? (other.rank + list[target + 1].rank) / 2
          : other.rank + 1024;
    await mutate('projects', project, { rank });
  }
  return (
    <>
      <PageTitle
        eyebrow="PLÄNE, DIE SICH NACH ZUHAUSE ANFÜHLEN"
        title="Eure Projekte"
        description="Von der ersten Idee bis zum letzten Pinselstrich."
        action={
          <button className="button primary" onClick={() => edit('projects')}>
            <Plus size={18} />
            Projekt anlegen
          </button>
        }
      />
      <div className="toolbar">
        <div className="segmented">
          {[
            ['all', 'Alle'],
            ['planned', 'Als Nächstes'],
            ['active', 'In Arbeit'],
            ['done', 'Geschafft'],
          ].map(([key, label]) => (
            <button
              className={filter === key ? 'selected' : ''}
              onClick={() => setFilter(key)}
              key={key}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <SearchBox value={search} change={setSearch} placeholder="Projekt finden" />
          <ArchiveToggle value={archived} change={setArchived} />
        </div>
      </div>
      {items.length ? (
        filter === 'planned' && !archived ? (
          <div className="panel planning-list">
            {items.map((project, i) => (
              <div className="planning-item" key={project.id}>
                <span className="next-number">{String(i + 1).padStart(2, '0')}</span>
                <button className="planning-title" onClick={() => go(`projects/${project.id}`)}>
                  <strong>{project.title}</strong>
                  <small>
                    {state.rooms.find((r) => r.id === project.roomId)?.title || 'Unser Haus'}
                    {project.dueDate ? ` · bis ${fullDate(project.dueDate)}` : ''}
                  </small>
                </button>
                <PriorityBadge value={project.priority} />
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`${project.title} nach oben`}
                    disabled={i === 0}
                    onClick={() => void move(project, -1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${project.title} nach unten`}
                    disabled={i === items.length - 1}
                    onClick={() => void move(project, 1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="project-grid">
            {items.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )
      ) : (
        <div className="panel">
          <Empty
            title={
              archived
                ? 'Noch nichts im Archiv'
                : search || filter !== 'all'
                  ? 'Hier ist gerade Platz'
                  : 'Welche Idee soll Wirklichkeit werden?'
            }
            action={archived ? undefined : 'Projekt anlegen'}
            onAction={() => edit('projects')}
          >
            {archived
              ? 'Archivierte Projekte bleiben hier mit ihrer Geschichte erhalten.'
              : search || filter !== 'all'
                ? 'Für diese Auswahl gibt es noch keine Projekte. Ändere den Filter oder halte eine neue Idee fest.'
                : 'Vielleicht das Wohnzimmer streichen, den Garten verschönern oder eine kleine Reparatur. Euer erster Plan wartet auf euch.'}
          </Empty>
        </div>
      )}
    </>
  );
}

/**
 * Kapselt ein beschriftetes Suchfeld; der Aufrufer hält den Suchwert und bestimmt die eigentliche
 * Filterung.
 */
function SearchBox({
  value,
  change,
  placeholder,
}: {
  value: string;
  change: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <span className="sr-only">{placeholder}</span>
      <input value={value} onChange={(e) => change(e.target.value)} placeholder={placeholder} />
    </label>
  );
}
/**
 * Schaltet zwischen aktiven und archivierten Datensätzen um und meldet den Zustand auch über
 * aria-pressed.
 */
function ArchiveToggle({ value, change }: { value: boolean; change: (value: boolean) => void }) {
  return (
    <button
      className={`button secondary archive-toggle ${value ? 'selected' : ''}`}
      onClick={() => change(!value)}
      aria-pressed={value}
    >
      <Archive size={16} />
      <span>Archiv</span>
    </button>
  );
}

/**
 * Zeigt Aufgabe, Termine und Zuständigkeit mit direkter Erledigungsaktion. Die kompakte Variante
 * wird im Dashboard verwendet; Details öffnen den gemeinsamen Editor.
 */
function TaskRow({ task, compact = false }: { task: Task; compact?: boolean }) {
  const { state, edit, mutate } = useApp();
  const [busy, setBusy] = useState(false);
  const late = task.status !== 'done' && task.dueDate && task.dueDate < localDay();
  const project = state.projects.find((p) => p.id === task.projectId);
  const predecessors = waitingFor(task, state.tasks);
  const blocked = task.status !== 'done' && (task.status === 'blocked' || predecessors.length > 0);
  /**
   * Wechselt zwischen erledigt und offen und sperrt die Aktion während der Anfrage. Der sichtbare
   * Datenstand ändert sich erst nach Bestätigung des Servers.
   */
  async function toggle() {
    if (blocked) return;
    setBusy(true);
    await mutate('tasks', task, { status: task.status === 'done' ? 'open' : 'done' });
    setBusy(false);
  }
  return (
    <div
      className={`task-row ${task.status === 'done' ? 'completed' : ''} ${compact ? 'compact-row' : ''}`}
    >
      <button
        className={`check-button ${task.status === 'done' ? 'checked' : ''}`}
        disabled={busy || !!task.archivedAt || blocked}
        title={
          blocked
            ? 'Erst die Vorgänger erledigen beziehungsweise die manuelle Sperre aufheben.'
            : undefined
        }
        aria-label={
          task.status === 'done' ? `${task.title} wieder öffnen` : `${task.title} erledigen`
        }
        onClick={() => void toggle()}
      >
        {busy ? (
          <LoaderCircle className="spin" size={15} />
        ) : task.status === 'done' ? (
          <Check size={15} />
        ) : null}
      </button>
      <button className="task-main" onClick={() => edit('tasks', task)}>
        <strong>{task.title}</strong>
        <span className="task-meta">
          {project && <span>{project.title}</span>}
          {!compact && <span className="phase-label">{taskPhaseLabels[task.phase]}</span>}
          {task.dueDate && (
            <span className={late ? 'late' : ''}>
              <CalendarDays size={12} />
              {task.dueDate === localDay() ? 'Heute' : shortDate(task.dueDate)}
              {late ? ' · überfällig' : ''}
            </span>
          )}
          {!compact && task.status !== 'open' && (
            <span className={`mini-status ${task.status}`}>{taskStatus[task.status]}</span>
          )}
        </span>
        {predecessors.length > 0 && (
          <span className="task-waiting">
            <CircleAlert size={12} />
            Wartet auf:{' '}
            {predecessors
              .map((entry) => entry.task?.title || 'Nicht mehr verfügbare Aufgabe')
              .join(', ')}
          </span>
        )}
        {task.status === 'blocked' && <span className="task-waiting">Manuell gesperrt</span>}
      </button>
      <div className="task-row-end">
        {!compact && <PriorityBadge value={task.priority} />}
        <Assignees ids={task.assignees} />
        <button
          className="icon-button row-edit"
          aria-label={`${task.title} bearbeiten`}
          onClick={() => edit('tasks', task)}
        >
          <Pencil size={15} />
        </button>
      </div>
    </div>
  );
}

/**
 * Filtert und sortiert Aufgaben nach Person, Projekt, Status, Priorität und Fälligkeit. Mit
 * projectId lässt sich dieselbe Ansicht in ein einzelnes Projekt einbetten.
 */
function TasksView({ projectId, embedded = false }: { projectId?: string; embedded?: boolean }) {
  const { state, session, edit } = useApp();
  const [person, setPerson] = useState('all');
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('all');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [projectFilter, setProjectFilter] = useState('all');
  const items = state.tasks
    .filter(
      (t) =>
        !!t.archivedAt === archived &&
        (!projectId || t.projectId === projectId) &&
        (projectFilter === 'all' || t.projectId === projectFilter) &&
        (status === 'all' ||
          (status === 'open' && t.status !== 'done') ||
          (status === 'ready' && isReady(t, state.tasks)) ||
          (status === 'waiting' && boardColumn(t, state.tasks) === 'waiting') ||
          (status === 'overdue' && t.status !== 'done' && !!t.dueDate && t.dueDate < localDay()) ||
          t.status === status) &&
        (person === 'all' ||
          (person === 'mine' && t.assignees.includes(session.profileId!)) ||
          (person === 'both' && t.assignees.length === 2)) &&
        (priority === 'all' || t.priority === priority) &&
        t.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(a.status === 'done') - Number(b.status === 'done') ||
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    );
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow="GEMEINSAM ANPACKEN"
          title="Eure Aufgaben"
          description="Was steht an, wer übernimmt es und was hat Vorrang?"
          action={
            <button
              className="button primary"
              onClick={() => edit('tasks', undefined, { projectId })}
            >
              <Plus size={18} />
              Aufgabe anlegen
            </button>
          }
        />
      )}
      <div className="toolbar">
        <div className="segmented">
          {[
            ['all', 'Alle'],
            ['mine', 'Für mich'],
            ['both', 'Gemeinsam'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={person === key ? 'selected' : ''}
              onClick={() => setPerson(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {embedded ? (
          <button
            className="button primary"
            onClick={() => edit('tasks', undefined, { projectId })}
          >
            <Plus size={16} />
            Aufgabe
          </button>
        ) : (
          <SearchBox value={search} change={setSearch} placeholder="Aufgabe finden" />
        )}
      </div>
      <div className="filter-bar">
        <label>
          <span className="sr-only">Aufgabenstatus</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Noch offen</option>
            <option value="ready">Startbereit</option>
            <option value="waiting">Wartet</option>
            <option value="all">Jeder Status</option>
            <option value="active">In Arbeit</option>
            <option value="blocked">Blockiert</option>
            <option value="done">Erledigt</option>
            <option value="overdue">Überfällig</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Priorität</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="all">Jede Priorität</option>
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!projectId && (
          <label>
            <span className="sr-only">Projekt</span>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="all">Alle Projekte</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <ArchiveToggle value={archived} change={setArchived} />
        <span className="filter-count">
          {items.length} {items.length === 1 ? 'Aufgabe' : 'Aufgaben'}
        </span>
      </div>
      <div className="panel">
        {items.length ? (
          items.map((task) => <TaskRow key={task.id} task={task} />)
        ) : (
          <Empty
            icon={<ListTodo />}
            title="Hier ist alles übersichtlich"
            action="Aufgabe anlegen"
            onAction={() => edit('tasks', undefined, { projectId })}
          >
            Für diese Auswahl gibt es noch keine Aufgaben. Haltet den nächsten kleinen Schritt fest.
          </Empty>
        )}
      </div>
    </>
  );
}

/**
 * Zeigt offene Einkäufe und eine getrennt aufklappbare Liste gekaufter Positionen. Projektfilter,
 * Archiv und Browserdruck arbeiten auf dem derzeit angezeigten gemeinsamen Datenstand.
 */
function ShoppingView({ projectId, embedded = false }: { projectId?: string; embedded?: boolean }) {
  const { state, edit, mutate } = useApp();
  const [archived, setArchived] = useState(false);
  const [showBought, setShowBought] = useState(false);
  const [projectFilter, setProjectFilter] = useState('all');
  const items = state.shopping.filter(
    (item) =>
      !!item.archivedAt === archived &&
      (!projectId || item.projectId === projectId) &&
      (projectFilter === 'all' || item.projectId === projectFilter),
  );
  const pending = items.filter((i) => !i.purchased);
  const bought = items.filter((i) => i.purchased);
  /**
   * Rendert eine Einkaufsposition mit Menge, Einheit, freiwilligem Einzelpreis und
   * Personenkennzeichnung. Abhaken sendet eine versionsgeprüfte Änderung; der Titel öffnet den
   * Editor.
   */
  const row = (item: ShoppingItem) => (
    <div className={`shopping-row ${item.purchased ? 'completed' : ''}`} key={item.id}>
      <button
        className={`check-button ${item.purchased ? 'checked' : ''}`}
        onClick={() => void mutate('shopping', item, { purchased: !item.purchased })}
        aria-label={`${item.title} als ${item.purchased ? 'offen' : 'gekauft'} markieren`}
        disabled={!!item.archivedAt}
      >
        {item.purchased && <Check size={15} />}
      </button>
      <button className="shopping-main" onClick={() => edit('shopping', item)}>
        <strong>{item.title}</strong>
        <small>
          {item.category === 'tool' ? 'Werkzeug' : 'Material'}
          {' · '}
          {state.projects.find((p) => p.id === item.projectId)?.title || 'Allgemein fürs Haus'}
        </small>
      </button>
      <span className="quantity">
        {new Intl.NumberFormat('de-DE').format(item.quantity)} <span>{item.unit}</span>
      </span>
      <span className="item-price">
        {item.unitPriceCents === null
          ? 'Preis offen'
          : `${money(item.unitPriceCents)} / ${item.unit}`}
      </span>
      <Person id={item.purchased ? item.purchasedBy : item.createdBy} compact />
      <button
        className="icon-button row-edit"
        aria-label={`${item.title} bearbeiten`}
        onClick={() => edit('shopping', item)}
      >
        <Pencil size={15} />
      </button>
    </div>
  );
  return (
    <>
      {!embedded && (
        <PageTitle
          eyebrow="GUT VORBEREITET LOSLEGEN"
          title="Die Einkaufsliste"
          description="Alles, was ihr für eure nächsten Schritte braucht."
          action={
            <button
              className="button primary"
              onClick={() => edit('shopping', undefined, { projectId })}
            >
              <Plus size={18} />
              Etwas hinzufügen
            </button>
          }
        />
      )}
      <div className="shopping-note">
        <ShoppingBasket size={21} />
        <div>
          <strong>Vor der Fahrt einmal einpacken.</strong>
          <p>
            Eure App bleibt im Heimnetz. Druckt die Liste vor dem Einkauf aus oder speichert sie als
            PDF.
          </p>
        </div>
        <button className="button secondary" onClick={() => window.print()}>
          <Printer size={17} />
          Drucken
        </button>
      </div>
      <div className="toolbar">
        <div className="filter-bar">
          {!projectId && (
            <label>
              <span className="sr-only">Projekt</span>
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                <option value="all">Alle Projekte</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ArchiveToggle value={archived} change={setArchived} />
        </div>
        {embedded && (
          <button
            className="button primary"
            onClick={() => edit('shopping', undefined, { projectId })}
          >
            <Plus size={17} />
            Hinzufügen
          </button>
        )}
      </div>
      <section className="panel printable-list">
        <div className="list-heading">
          <h2>Noch besorgen</h2>
          <span className="count">{pending.length}</span>
        </div>
        {pending.length ? (
          pending.map(row)
        ) : (
          <Empty
            icon={<ShoppingBasket />}
            title="Alles da oder noch nichts geplant?"
            action="Etwas hinzufügen"
            onAction={() => edit('shopping', undefined, { projectId })}
          >
            Farbe, Schrauben oder das richtige Werkzeug: Schreibt es auf, damit nichts vergessen
            wird.
          </Empty>
        )}
      </section>
      {bought.length > 0 && (
        <section className="panel bought-panel">
          <button
            className="bought-toggle"
            onClick={() => setShowBought(!showBought)}
            aria-expanded={showBought}
          >
            <CheckCheck size={18} />
            <strong>Schon besorgt</strong>
            <span className="count">{bought.length}</span>
            <ChevronRight className={showBought ? 'rotated' : ''} size={18} />
          </button>
          {showBought && bought.map(row)}
        </section>
      )}
    </>
  );
}

/**
 * Verbindet Räume und Hausmängel in einer Ansicht. Ein Mangel kann ohne Projekt bestehen, Fotos
 * erhalten und als Ausgangspunkt für eine verknüpfte Aufgabe dienen.
 */
function HouseView() {
  const { state, edit, mutate } = useApp();
  const [tab, setTab] = useState('rooms');
  const [archived, setArchived] = useState(false);
  const [status, setStatus] = useState('open');
  const [selectedDefect, setSelectedDefect] = useState<string | null>(null);
  const rooms = state.rooms.filter((r) => !!r.archivedAt === archived);
  const defects = state.defects
    .filter(
      (d) =>
        !!d.archivedAt === archived &&
        (status === 'all' || status === 'open'
          ? status === 'all' || d.status !== 'resolved'
          : d.status === 'resolved'),
    )
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const selected = state.defects.find((d) => d.id === selectedDefect);
  return (
    <>
      <PageTitle
        eyebrow="ALLES HAT SEINEN PLATZ"
        title="Unser Haus"
        description="Eure Räume, kleinen Baustellen und großen Möglichkeiten."
        action={
          <button
            className="button primary"
            onClick={() => edit(tab === 'rooms' ? 'rooms' : 'defects')}
          >
            <Plus size={18} />
            {tab === 'rooms' ? 'Raum anlegen' : 'Mangel festhalten'}
          </button>
        }
      />
      <div className="toolbar">
        <div className="segmented">
          <button className={tab === 'rooms' ? 'selected' : ''} onClick={() => setTab('rooms')}>
            <DoorOpen size={17} />
            Räume & Bereiche
          </button>
          <button className={tab === 'defects' ? 'selected' : ''} onClick={() => setTab('defects')}>
            <Wrench size={17} />
            Mängel
          </button>
        </div>
        <div className="toolbar-right">
          {tab === 'defects' && (
            <select
              aria-label="Mängelstatus"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="open">Noch offen</option>
              <option value="resolved">Behoben</option>
              <option value="all">Alle</option>
            </select>
          )}
          <ArchiveToggle value={archived} change={setArchived} />
        </div>
      </div>
      {tab === 'rooms' ? (
        rooms.length ? (
          <div className="room-grid">
            {rooms.map((room) => (
              <article className="room-card" key={room.id}>
                <div className="room-card-top">
                  <span
                    className="room-icon"
                    style={{
                      background: `${room.color || '#456557'}16`,
                      color: room.color || '#456557',
                    }}
                  >
                    <DoorOpen size={29} strokeWidth={1.5} />
                  </span>
                  <button
                    className="icon-button"
                    onClick={() => edit('rooms', room)}
                    aria-label={`${room.title} bearbeiten`}
                  >
                    <Ellipsis size={20} />
                  </button>
                </div>
                <h2>{room.title}</h2>
                <p>{room.description || 'Ein Teil eures Zuhauses.'}</p>
                <div className="room-counts">
                  <span>
                    <FolderHeart size={15} />
                    {active(state.projects).filter((p) => p.roomId === room.id).length} Projekte
                  </span>
                  <span>
                    <Wrench size={14} />
                    {
                      active(state.defects).filter(
                        (d) => d.roomId === room.id && d.status !== 'resolved',
                      ).length
                    }
                    {' Mängel'}
                  </span>
                </div>
                <div className="room-projects">
                  {active(state.projects)
                    .filter((p) => p.roomId === room.id)
                    .slice(0, 3)
                    .map((p) => (
                      <button key={p.id} onClick={() => go(`projects/${p.id}`)}>
                        {p.title}
                        <ChevronRight size={14} />
                      </button>
                    ))}
                </div>
                {!room.archivedAt && (
                  <button
                    className="text-link"
                    onClick={() => edit('projects', undefined, { roomId: room.id })}
                  >
                    <Plus size={15} />
                    Projekt für diesen Raum
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="panel">
            <Empty
              icon={<DoorOpen />}
              title={archived ? 'Euer Raumarchiv ist leer' : 'Gebt euren Plänen einen Raum'}
              action={archived ? undefined : 'Ersten Raum anlegen'}
              onAction={() => edit('rooms')}
            >
              Wohnzimmer, Küche, Garten oder Fassade: Legt die Bereiche an, um die ihr euch kümmern
              möchtet.
            </Empty>
          </div>
        )
      ) : defects.length ? (
        <div className="defect-grid">
          {defects.map((defect) => (
            <article className="defect-card" key={defect.id}>
              <div className="defect-top">
                <span className="eyebrow">
                  {state.rooms.find((r) => r.id === defect.roomId)?.title || 'Unser Haus'}
                </span>
                <PriorityBadge value={defect.priority} />
              </div>
              <h2>
                <button className="heading-button" onClick={() => setSelectedDefect(defect.id)}>
                  {defect.title}
                </button>
              </h2>
              <p>{defect.description || 'Ein kleiner Befund, den ihr im Blick behaltet.'}</p>
              <div className="defect-meta">
                <span className={`status ${defect.status}`}>{defectStatus[defect.status]}</span>
                <Assignees ids={defect.assignees} />
              </div>
              <div className="defect-actions">
                <button className="button secondary" onClick={() => setSelectedDefect(defect.id)}>
                  <Camera size={16} />
                  Details & Fotos
                </button>
                <button
                  className="icon-button"
                  aria-label={`${defect.title} bearbeiten`}
                  onClick={() => edit('defects', defect)}
                >
                  <Pencil size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            icon={<Wrench />}
            title="Gut im Blick, aus dem Kopf"
            action="Mangel festhalten"
            onAction={() => edit('defects')}
          >
            Eine klemmende Tür oder eine undichte Fuge: Haltet fest, was euch auffällt. Ein Projekt
            braucht es dafür noch nicht.
          </Empty>
        </div>
      )}
      {selected && (
        <Modal title={selected.title} close={() => setSelectedDefect(null)} wide>
          <div className="detail-meta">
            <PriorityBadge value={selected.priority} />
            <Assignees ids={selected.assignees} />
            <span className="status">{defectStatus[selected.status]}</span>
          </div>
          <p className="detail-description">{selected.description || 'Noch keine Beschreibung.'}</p>
          <div className="action-wrap">
            <button
              className="button secondary"
              onClick={() => {
                // Der Detaildialog wird ersetzt; zwei native modale Dialoge sollen nicht übereinander liegen.
                setSelectedDefect(null);
                edit('defects', selected);
              }}
            >
              <Pencil size={16} />
              Bearbeiten
            </button>
            <button
              className="button secondary"
              onClick={() => {
                // Befund und Ortsbezug als Vorschlag übernehmen; der Mangel selbst bleibt unverändert offen.
                setSelectedDefect(null);
                edit('tasks', undefined, {
                  title: selected.title,
                  description: selected.description,
                  defectId: selected.id,
                  roomId: selected.roomId,
                  projectId: selected.projectId,
                  priority: selected.priority,
                  assignees: selected.assignees,
                });
              }}
            >
              <Plus size={16} />
              Aufgabe daraus machen
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void mutate('defects', selected, {
                  status: selected.status === 'resolved' ? 'open' : 'resolved',
                })
              }
            >
              <Check size={16} />
              {selected.status === 'resolved' ? 'Wieder öffnen' : 'Als behoben markieren'}
            </button>
          </div>
          <PhotoGallery defectId={selected.id} />
        </Modal>
      )}
    </>
  );
}

/**
 * Orchestriert Projektübersicht und Register für Aufgaben, Einkäufe, Fotos und Verlauf. Abschluss
 * und Wiederöffnung erfolgen bewusst; offene Aufgaben werden vor dem Abschluss genannt.
 */
function ProjectDetail({ id }: { id: string }) {
  const { state, edit, mutate } = useApp();
  const [tab, setTab] = useState('overview');
  const [confirmComplete, setConfirmComplete] = useState(false);
  const project = state.projects.find((p) => p.id === id);
  if (!project)
    return (
      <>
        <button className="back-link" onClick={() => go('projects')}>
          <ArrowLeft size={16} />
          Zurück zu Projekten
        </button>
        <Empty title="Dieses Projekt ist nicht verfügbar">
          Vielleicht wurde es auf einem anderen Gerät geändert. Lade die Ansicht erneut.
        </Empty>
      </>
    );
  const tasks = active(state.tasks).filter((t) => t.projectId === id);
  const room = state.rooms.find((r) => r.id === project.roomId);
  const incomplete = tasks.filter((t) => t.status !== 'done');
  return (
    <>
      <button className="back-link" onClick={() => go('projects')}>
        <ArrowLeft size={16} />
        Alle Projekte
      </button>
      {project.archivedAt && (
        <div className="info-banner">
          <Archive size={18} />
          Dieses Projekt liegt im Archiv.
          <button onClick={() => void mutate('projects', project, { archivedAt: null })}>
            Wiederherstellen
          </button>
        </div>
      )}
      <PageTitle
        eyebrow={room?.title.toUpperCase() || 'UNSER HAUS'}
        title={project.title}
        description={project.description || 'Ein gemeinsames Vorhaben für euer Zuhause.'}
        action={
          <button className="button secondary" onClick={() => edit('projects', project)}>
            <Pencil size={16} />
            Bearbeiten
          </button>
        }
      />
      <div className="project-overview-strip">
        <div className="detail-meta">
          <span className={`status ${project.status}`}>{projectStatus[project.status]}</span>
          <PriorityBadge value={project.priority} />
          {project.dueDate && (
            <span className="date-label">
              <CalendarDays size={15} />
              Geplant bis {fullDate(project.dueDate)}
            </span>
          )}
          <Person id={project.createdBy} prefix="Von " />
        </div>
        <Progress projectId={id} />
      </div>
      <div className="project-tabs" role="tablist" aria-label="Projektbereiche">
        {[
          { key: 'overview', label: 'Übersicht', icon: House },
          { key: 'planning', label: 'Planung', icon: ClipboardList },
          { key: 'tasks', label: 'Aufgaben', icon: ListTodo },
          { key: 'shopping', label: 'Einkauf', icon: ShoppingBasket },
          { key: 'photos', label: 'Fotos', icon: Images },
          { key: 'journal', label: 'Verlauf', icon: BookOpen },
        ].map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            className={tab === item.key ? 'selected' : ''}
            onClick={() => setTab(item.key)}
          >
            <item.icon size={17} />
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'overview' ? (
        <div className="project-detail-grid">
          <section className="panel">
            <div className="list-heading">
              <h2>Die nächsten Schritte</h2>
              <button
                className="text-link"
                onClick={() => edit('tasks', undefined, { projectId: id, roomId: project.roomId })}
              >
                <Plus size={16} />
                Aufgabe
              </button>
            </div>
            {incomplete.length ? (
              incomplete.slice(0, 6).map((task) => <TaskRow key={task.id} task={task} />)
            ) : (
              <Empty
                icon={<CheckCheck />}
                title={tasks.length ? 'Alle Aufgaben geschafft!' : 'Womit möchtet ihr anfangen?'}
                action="Aufgabe anlegen"
                onAction={() => edit('tasks', undefined, { projectId: id, roomId: project.roomId })}
              >
                {tasks.length
                  ? 'Nehmt euch einen Moment und schaut auf euren Fortschritt zurück.'
                  : 'Kleine, konkrete Aufgaben machen auch große Pläne übersichtlich.'}
              </Empty>
            )}
          </section>
          <div className="project-side">
            <div className="panel project-action-card">
              <span className="empty-icon">
                <Sprout />
              </span>
              <h3>
                {project.status === 'done'
                  ? 'Das habt ihr geschafft.'
                  : 'Bereit für den nächsten Schritt?'}
              </h3>
              <p>
                {project.status === 'done'
                  ? 'Fotos, Notizen und die Geschichte bleiben erhalten.'
                  : 'Der Projektstatus hilft euch, Ideen und laufende Vorhaben auseinanderzuhalten.'}
              </p>
              {project.status !== 'active' && project.status !== 'done' && (
                <button
                  className="button primary full"
                  onClick={() => void mutate('projects', project, { status: 'active' })}
                >
                  <Wrench size={16} />
                  Projekt starten
                </button>
              )}
              {project.status === 'active' && (
                <button className="button primary full" onClick={() => setConfirmComplete(true)}>
                  <CheckCheck size={16} />
                  Projekt abschließen
                </button>
              )}
              {project.status === 'done' && (
                <button
                  className="button secondary full"
                  onClick={() => void mutate('projects', project, { status: 'active' })}
                >
                  Projekt wieder öffnen
                </button>
              )}
            </div>
            <button className="photo-prompt" onClick={() => setTab('photos')}>
              <Camera size={25} />
              <span>
                <strong>Ein Bild vom Fortschritt</strong>
                <small>Haltet fest, wie sich euer Zuhause verändert.</small>
              </span>
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : tab === 'planning' ? (
        <ProjectPlanning project={project} />
      ) : tab === 'tasks' ? (
        <TasksView projectId={id} embedded />
      ) : tab === 'shopping' ? (
        <ShoppingView projectId={id} embedded />
      ) : tab === 'photos' ? (
        <PhotoGallery projectId={id} />
      ) : (
        <Journal projectId={id} />
      )}
      {confirmComplete && (
        <Modal title="Ein Vorhaben geschafft" close={() => setConfirmComplete(false)}>
          <p>
            {incomplete.length
              ? `Es gibt noch ${incomplete.length} offene Aufgaben. Ihr könnt das Projekt trotzdem bewusst abschließen; die Aufgaben bleiben erhalten.`
              : 'Alle Aufgaben sind erledigt. Möchtet ihr das Projekt als abgeschlossen markieren?'}
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setConfirmComplete(false)}>
              Noch einmal ansehen
            </button>
            <button
              className="button primary"
              onClick={async () => {
                if (await mutate('projects', project, { status: 'done' }))
                  setConfirmComplete(false);
              }}
            >
              <Check size={17} />
              Abschließen
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Vereint Listen-, Board- und Zeitachsenansicht desselben Projektbestands. Phasensummen werden
 * ausschließlich aus nicht archivierten Aufgaben gebildet; Ansichtswechsel ändern keine Termine.
 */
function ProjectPlanning({ project }: { project: Project }) {
  const { state, edit } = useApp();
  const [view, setView] = useState<'list' | 'board' | 'timeline'>('list');
  const [grouped, setGrouped] = useState(true);
  const [phase, setPhase] = useState('all');
  const tasks = active(state.tasks).filter((task) => task.projectId === project.id);
  const visible = tasks
    .filter((task) => phase === 'all' || task.phase === phase)
    .sort(
      (a, b) =>
        TASK_PHASES.indexOf(a.phase) - TASK_PHASES.indexOf(b.phase) ||
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
    );
  const completed = tasks.filter((task) => task.status === 'done').length;
  const ready = tasks.filter((task) => isReady(task, state.tasks)).length;
  const waiting = tasks.filter((task) => boardColumn(task, state.tasks) === 'waiting').length;
  return (
    <section className="project-planning">
      <div className="section-title planning-heading">
        <div>
          <h2>Ein Plan, der zusammenpasst</h2>
          <p className="subtle">
            {completed} von {tasks.length} Aufgaben geschafft · {ready} startbereit · {waiting}{' '}
            warten
          </p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            edit('tasks', undefined, {
              projectId: project.id,
              roomId: project.roomId,
              ...(phase !== 'all' ? { phase } : {}),
            })
          }
        >
          <Plus size={17} />
          Aufgabe anlegen
        </button>
      </div>
      <div className="phase-overview">
        {TASK_PHASES.map((key, index) => {
          const entries = tasks.filter((task) => task.phase === key);
          const done = entries.filter((task) => task.status === 'done').length;
          return (
            <button
              key={key}
              className={`phase-summary ${phase === key ? 'selected' : ''}`}
              onClick={() => setPhase(phase === key ? 'all' : key)}
              aria-pressed={phase === key}
            >
              <span className="phase-summary-name">
                <span>0{index + 1}</span>
                <strong>{taskPhaseLabels[key]}</strong>
              </span>
              <span className="phase-summary-count">
                {done} von {entries.length} erledigt
              </span>
              <span className="progress-track">
                <span style={{ width: `${entries.length ? (done / entries.length) * 100 : 0}%` }} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="toolbar planning-toolbar">
        <div className="segmented" aria-label="Planungsansicht">
          {(['list', 'board', 'timeline'] as const).map((key) => (
            <button
              key={key}
              className={view === key ? 'selected' : ''}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {key === 'list' ? (
                <ListTodo size={16} />
              ) : key === 'board' ? (
                <ClipboardList size={16} />
              ) : (
                <CalendarDays size={16} />
              )}
              {{ list: 'Liste', board: 'Board', timeline: 'Zeitachse' }[key]}
            </button>
          ))}
        </div>
        <div className="planning-options">
          <label>
            <span className="sr-only">Projektphase filtern</span>
            <select value={phase} onChange={(event) => setPhase(event.target.value)}>
              <option value="all">Alle Phasen</option>
              {TASK_PHASES.map((key) => (
                <option key={key} value={key}>
                  {taskPhaseLabels[key]}
                </option>
              ))}
            </select>
          </label>
          {view === 'list' && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={grouped}
                onChange={(event) => setGrouped(event.target.checked)}
              />
              Nach Phase gruppieren
            </label>
          )}
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="panel">
          <Empty
            icon={<ClipboardList />}
            title="Schritt für Schritt zum fertigen Raum"
            action="Ersten Schritt planen"
            onAction={() =>
              edit('tasks', undefined, { projectId: project.id, roomId: project.roomId })
            }
          >
            Teilt euer Vorhaben in Planung, Vorbereitung, Renovierung und Abschluss ein. Vorgänger
            halten die richtige Reihenfolge fest.
          </Empty>
        </div>
      ) : view === 'list' ? (
        visible.length ? (
          grouped ? (
            <div className="phase-task-groups">
              {TASK_PHASES.filter((key) => visible.some((task) => task.phase === key)).map(
                (key) => (
                  <section className="panel" key={key}>
                    <div className="list-heading">
                      <h3>{taskPhaseLabels[key]}</h3>
                      <span className="count">
                        {visible.filter((task) => task.phase === key).length}
                      </span>
                    </div>
                    {visible
                      .filter((task) => task.phase === key)
                      .map((task) => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                  </section>
                ),
              )}
            </div>
          ) : (
            <div className="panel">
              {visible.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )
        ) : (
          <div className="panel">
            <Empty title="Diese Phase hat noch Platz">
              Ergänzt Aufgaben für diese Phase oder zeigt wieder alle Phasen an.
            </Empty>
          </div>
        )
      ) : view === 'board' ? (
        <div className="planning-board">
          {(['open', 'waiting', 'active', 'done'] as const).map((column) => {
            const entries = visible.filter((task) => boardColumn(task, state.tasks) === column);
            return (
              <section className={`board-column ${column}`} key={column}>
                <header>
                  <h3>
                    {
                      { open: 'Offen', waiting: 'Wartet', active: 'In Arbeit', done: 'Erledigt' }[
                        column
                      ]
                    }
                  </h3>
                  <span className="count">{entries.length}</span>
                </header>
                {entries.map((task) => (
                  <PlanningTaskCard key={task.id} task={task} />
                ))}
                {!entries.length && <p className="board-empty">Hier liegt gerade nichts.</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <PlanningTimeline tasks={visible} />
      )}
      <p className="planning-footnote">
        Vorgänger müssen zuerst erledigt sein. Eine manuelle Sperre bleibt bestehen, bis ihr sie
        bewusst aufhebt. Termine werden nicht automatisch verschoben.
      </p>
    </section>
  );
}

/** Zeigt eine Board-Aufgabe mit verständlicher Sperrursache und einer tastaturbedienbaren nächsten Aktion. */
function PlanningTaskCard({ task }: { task: Task }) {
  const { state, edit, mutate } = useApp();
  const [busy, setBusy] = useState(false);
  const predecessors = waitingFor(task, state.tasks);
  const action =
    task.status === 'done'
      ? 'open'
      : task.status === 'blocked'
        ? 'open'
        : task.status === 'active'
          ? 'done'
          : 'active';
  const disabled = busy || (['active', 'done'].includes(action) && predecessors.length > 0);
  /** Verändert nur den bestätigten Aufgabenstatus; Versions- und Abhängigkeitsprüfungen bleiben zusätzlich serverseitig verbindlich. */
  async function advance() {
    if (disabled) return;
    setBusy(true);
    try {
      await mutate('tasks', task, { status: action });
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="planning-task-card">
      <div className="board-card-top">
        <span className="phase-label">{taskPhaseLabels[task.phase]}</span>
        <PriorityBadge value={task.priority} />
      </div>
      <button className="heading-button" onClick={() => edit('tasks', task)}>
        <h4>{task.title}</h4>
      </button>
      <Assignees ids={task.assignees} />
      {task.dueDate && (
        <span
          className={`date-label ${task.status !== 'done' && task.dueDate < localDay() ? 'late' : ''}`}
        >
          <CalendarDays size={13} />
          {shortDate(task.dueDate)}
        </span>
      )}
      {predecessors.length > 0 && (
        <p className="task-waiting">
          Wartet auf:{' '}
          {predecessors
            .map((entry) => entry.task?.title || 'Nicht mehr verfügbare Aufgabe')
            .join(', ')}
        </p>
      )}
      {task.status === 'blocked' && <p className="task-waiting">Manuell gesperrt</p>}
      <div className="board-card-actions">
        <button className="button secondary" onClick={() => void advance()} disabled={disabled}>
          {busy ? (
            <LoaderCircle className="spin" size={14} />
          ) : task.status === 'done' ? (
            <RefreshCw size={14} />
          ) : (
            <ArrowRight size={14} />
          )}{' '}
          {task.status === 'done'
            ? 'Wieder öffnen'
            : task.status === 'blocked'
              ? 'Sperre aufheben'
              : predecessors.length
                ? 'Wartet'
                : task.status === 'active'
                  ? 'Erledigen'
                  : 'Starten'}
        </button>
        <button
          className="icon-button"
          onClick={() => edit('tasks', task)}
          aria-label={`${task.title} bearbeiten`}
        >
          <Pencil size={14} />
        </button>
      </div>
    </article>
  );
}

/** Rechnet ein gespeichertes Tagesdatum in einen UTC-Tageswert um, damit Sommerzeit keine Balkenbreiten verändert. */
function planningDay(value: string) {
  return Date.parse(`${value}T12:00:00Z`) / 86_400_000;
}

/** Zeichnet nur ausdrücklich gesetzte Start- und Fälligkeitstage; Aufgaben ohne Datum stehen separat darunter. */
function PlanningTimeline({ tasks }: { tasks: Task[] }) {
  const { state, edit } = useApp();
  const dated = tasks.filter((task) => task.startDate || task.dueDate);
  const undated = tasks.filter((task) => !task.startDate && !task.dueDate);
  const dates = dated.flatMap((task) =>
    [task.startDate, task.dueDate].filter((date): date is string => !!date).map(planningDay),
  );
  const first = dates.length ? Math.min(...dates) : planningDay(localDay());
  const last = dates.length ? Math.max(...dates) : first;
  const span = Math.max(last - first + 1, 7);
  const ticks = Array.from({ length: Math.min(7, span) }, (_, index) =>
    Math.floor((index * (span - 1)) / Math.min(6, span - 1)),
  );
  return (
    <div className="planning-timeline">
      {dated.length ? (
        <div
          className="timeline-scroll"
          tabIndex={0}
          aria-label="Zeitachse der Aufgaben; bei schmalem Bildschirm seitlich scrollen"
        >
          <div className="gantt-grid">
            <div className="gantt-header">
              <strong>Aufgabe & Zeitraum</strong>
              <div className="gantt-dates">
                {ticks.map((day) => (
                  <span key={day} style={{ left: `${(day / span) * 100}%` }}>
                    {shortDate(new Date((first + day) * 86_400_000).toISOString().slice(0, 10))}
                  </span>
                ))}
              </div>
            </div>
            {dated.map((task) => {
              const start = planningDay(task.startDate || task.dueDate!);
              const end = planningDay(task.dueDate || task.startDate!);
              const column = boardColumn(task, state.tasks);
              const label =
                task.startDate && task.dueDate
                  ? `${shortDate(task.startDate)} – ${shortDate(task.dueDate)}`
                  : task.startDate
                    ? `Beginn ${shortDate(task.startDate)} · Ende offen`
                    : `Fällig ${shortDate(task.dueDate!)} · Beginn offen`;
              return (
                <div className="gantt-row" key={task.id}>
                  <button className="gantt-task-label" onClick={() => edit('tasks', task)}>
                    <strong>{task.title}</strong>
                    <small>{label}</small>
                  </button>
                  <div className="gantt-lane">
                    <button
                      className={`gantt-bar ${column} ${!task.startDate || !task.dueDate ? 'milestone' : ''}`}
                      style={{
                        left: `${((start - first) / span) * 100}%`,
                        width: `${(Math.max(1, end - start + 1) / span) * 100}%`,
                      }}
                      onClick={() => edit('tasks', task)}
                      aria-label={`${task.title}: ${label}, ${column === 'waiting' ? 'wartet' : taskStatus[task.status]}`}
                      title={`${task.title} · ${label}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel">
          <Empty icon={<CalendarDays />} title="Eure Termine sind noch offen">
            Tragt einen Beginn oder eine Fälligkeit ein, damit die Aufgabe auf der Zeitachse
            erscheint.
          </Empty>
        </div>
      )}
      {!!dated.length && (
        <p className="tiny-note">
          Ein einzelnes Datum wird als Markierung angezeigt. Der andere Termin bleibt offen.
        </p>
      )}
      {undated.length > 0 && (
        <section className="panel undated-tasks">
          <div className="list-heading">
            <h3>Noch ohne Termin</h3>
            <span className="count">{undated.length}</span>
          </div>
          {undated.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * Zeigt chronologisch absteigend manuelle Notizen und automatische Projektereignisse. Nur manuelle
 * Notizen sind bearbeitbar; ihr Archiv bleibt über den Filter erreichbar.
 */
function Journal({ projectId }: { projectId: string }) {
  const { state, edit } = useApp();
  const [archived, setArchived] = useState(false);
  const notes = state.notes
    .filter((n) => !!n.archivedAt === archived && n.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <div className="section-title">
        <div>
          <h2>Eure Geschichte, Schritt für Schritt</h2>
          <p className="subtle">Entscheidungen, Erinnerungen und das, was sich verändert.</p>
        </div>
        <div className="journal-toolbar">
          <ArchiveToggle value={archived} change={setArchived} />
          <button
            className="button primary"
            onClick={() => edit('notes', undefined, { projectId })}
          >
            <Plus size={17} />
            Notiz schreiben
          </button>
        </div>
      </div>
      <div className="panel journal-panel">
        {notes.length ? (
          <div className="timeline">
            {notes.map((note) => (
              <article key={note.id} className={`timeline-item ${note.event ? 'event' : ''}`}>
                <span className="timeline-marker">
                  {note.event ? <Check size={13} /> : <BookOpen size={14} />}
                </span>
                <div className="timeline-top">
                  <Person id={note.createdBy} />
                  <time>{fullDate(note.createdAt)}</time>
                  {!note.event && (
                    <button
                      className="icon-button"
                      aria-label="Notiz bearbeiten"
                      onClick={() => edit('notes', note)}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
                <p>{note.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={<BookOpen />}
            title="Jeder Plan hat eine Geschichte"
            action="Erste Notiz schreiben"
            onAction={() => edit('notes', undefined, { projectId })}
          >
            Welcher Farbton soll es werden? Was hat heute gut geklappt? Hier ist Platz für eure
            Gedanken.
          </Empty>
        )}
      </div>
    </>
  );
}

/**
 * Verwaltet Projekt- oder Mängelfotos, Kategorien, Papierkorb und Vergleichspaare. Gelöschte Bilder
 * werden nicht abgerufen; archivierte Vergleiche bleiben über einen eigenen Bereich erreichbar.
 */
function PhotoGallery({ projectId, defectId }: { projectId?: string; defectId?: string }) {
  const { state, session, edit, mutate, refresh, notify } = useApp();
  const [upload, setUpload] = useState(false);
  const [category, setCategory] = useState('all');
  const [trash, setTrash] = useState(false);
  const [view, setView] = useState<Photo | null>(null);
  const [pair, setPair] = useState<Comparison | null>(null);
  const photos = state.photos.filter(
    (p) =>
      (projectId ? p.projectId === projectId : p.defectId === defectId) &&
      !!p.deletedAt === trash &&
      (category === 'all' || p.category === category),
  );
  const comparisons = active(state.comparisons).filter(
    (c) =>
      c.projectId === projectId &&
      state.photos.some((p) => p.id === c.beforeId && !p.deletedAt) &&
      state.photos.some((p) => p.id === c.afterId && !p.deletedAt),
  );
  /**
   * Legt ein Foto über deletedAt in den Papierkorb oder stellt es wieder her. Erst nach einer
   * bestätigten Mutation wird der Fotodialog geschlossen.
   */
  async function remove(photo: Photo, authorSession: Session) {
    await api(`/photos/${photo.id}`, {
      method: 'PATCH',
      session: authorSession,
      body: {
        deletedAt: photo.deletedAt ? null : new Date().toISOString(),
        version: photo.version,
        profileVersion: authorSession.profileVersion,
      },
    });
    await refresh();
    setView(null);
    notify(photo.deletedAt ? 'Foto wiederhergestellt.' : 'Foto liegt jetzt im Papierkorb.');
  }
  return (
    <>
      <div className="section-title photo-section-heading">
        <div>
          <h2>{defectId ? 'Fotos zum Mangel' : 'So verändert sich euer Zuhause'}</h2>
          <p className="subtle">
            Die kleinen Schritte werden irgendwann ein großes Vorher und Nachher.
          </p>
        </div>
        <button className="button primary" onClick={() => setUpload(true)}>
          <ImagePlus size={17} />
          Fotos hinzufügen
        </button>
      </div>
      {projectId && comparisons.length > 0 && (
        <div className="comparison-grid">
          {comparisons.map((comparison) => (
            <article className="comparison-card" key={comparison.id}>
              <button
                className="comparison-preview"
                onClick={() => setPair(comparison)}
                aria-label={`${comparison.title} vergleichen`}
              >
                <img src={photoUrl(comparison.afterId, 'thumb')} alt="Nachher" />
                <img
                  className="comparison-before-preview"
                  src={photoUrl(comparison.beforeId, 'thumb')}
                  alt="Vorher"
                />
                <span className="comparison-preview-line">
                  <SlidersHorizontal size={18} />
                </span>
                <span className="comparison-label before">Vorher</span>
                <span className="comparison-label after">Nachher</span>
              </button>
              <div>
                <h3>{comparison.title}</h3>
                <button
                  className="icon-button"
                  aria-label="Vergleich bearbeiten"
                  onClick={() => edit('comparisons', comparison)}
                >
                  <Pencil size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {projectId && state.comparisons.some((c) => c.projectId === projectId && !!c.archivedAt) && (
        <details className="archived-comparisons">
          <summary>Archivierte Fotovergleiche</summary>
          {state.comparisons
            .filter((c) => c.projectId === projectId && !!c.archivedAt)
            .map((comparison) => (
              <button key={comparison.id} onClick={() => edit('comparisons', comparison)}>
                <span>{comparison.title}</span>
                <Archive size={16} />
              </button>
            ))}
        </details>
      )}
      <div className="toolbar">
        <div className="segmented photo-filters">
          {[
            ['all', 'Alle Fotos'],
            ['before', 'Vorher'],
            ['progress', 'Mittendrin'],
            ['after', 'Nachher'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={category === key ? 'selected' : ''}
              onClick={() => setCategory(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <button
            className={`button secondary ${trash ? 'selected' : ''}`}
            onClick={() => setTrash(!trash)}
            aria-pressed={trash}
          >
            <Trash2 size={16} />
            <span>Papierkorb</span>
          </button>
          {projectId && (
            <button
              className="button secondary"
              onClick={() => edit('comparisons', undefined, { projectId })}
            >
              <SlidersHorizontal size={16} />
              Vergleich erstellen
            </button>
          )}
        </div>
      </div>
      {trash && (
        <div className="info-banner">
          Fotos bleiben mindestens 30 Tage im Papierkorb. Stelle benötigte Fotos vor dem
          Wiederherstellen eines archivierten Vergleichs wieder her.
        </div>
      )}
      {photos.length ? (
        <div className="photo-grid">
          {photos.map((photo) => (
            <button className="photo-card" onClick={() => setView(photo)} key={photo.id}>
              {photo.deletedAt ? (
                <span className="trash-photo-placeholder">
                  <Trash2 size={32} />
                  <span>Im Papierkorb</span>
                </span>
              ) : (
                <img
                  src={photoUrl(photo.id, 'thumb')}
                  alt={photo.title || categoryLabels[photo.category]}
                  loading="lazy"
                />
              )}
              <span className="photo-caption">
                <strong>{photo.title || categoryLabels[photo.category]}</strong>
                <span>
                  {categoryLabels[photo.category]}
                  <span>{name(photo.createdBy)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            icon={<Camera />}
            title={trash ? 'Hier ist nichts im Papierkorb' : 'Haltet den Anfang fest'}
            action={trash ? undefined : 'Erste Fotos hinzufügen'}
            onAction={() => setUpload(true)}
          >
            {trash
              ? 'Entfernte Fotos könnt ihr hier vorübergehend wiederherstellen.'
              : 'Ein Foto von heute wird später eine schöne Erinnerung daran, wie alles angefangen hat.'}
          </Empty>
        </div>
      )}
      {upload && (
        <UploadDialog projectId={projectId} defectId={defectId} close={() => setUpload(false)} />
      )}{' '}
      {view && (
        <PhotoDialog
          photo={state.photos.find((p) => p.id === view.id) || view}
          close={() => setView(null)}
          remove={remove}
        />
      )}{' '}
      {pair && (
        <Modal title={pair.title} close={() => setPair(null)} wide>
          <CompareSlider comparison={pair} />
          <p className="tiny-note">
            Ziehe den Schieber oder nutze die Pfeiltasten, um Vorher und Nachher zu vergleichen.
          </p>
        </Modal>
      )}
    </>
  );
}

/**
 * Überlagert das Vorherbild mit dem Nachherbild und verändert nur den sichtbaren Ausschnitt. Der
 * native Range-Regler unterstützt Touch, Maus und Tastatur ohne erneute Bildberechnung.
 */
function CompareSlider({ comparison }: { comparison: Comparison | Record<string, any> }) {
  const [value, setValue] = useState(50);
  /**
   * Übersetzt die gespeicherten Positions- und Zoomwerte einer Vergleichsseite in CSS-Bildposition
   * und Transformationsursprung.
   */
  const style = (side: 'before' | 'after') => ({
    objectPosition: `${comparison[`${side}X`]}% ${comparison[`${side}Y`]}%`,
    transform: `scale(${comparison[`${side}Zoom`]})`,
    transformOrigin: `${comparison[`${side}X`]}% ${comparison[`${side}Y`]}%`,
  });
  return (
    <div className="compare-view">
      <div className="compare-frame">
        <img src={photoUrl(comparison.afterId)} style={style('after')} alt="Nachher" />
        <div className="compare-overlay" style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}>
          <img src={photoUrl(comparison.beforeId)} style={style('before')} alt="Vorher" />
        </div>
        <span className="comparison-label before">Vorher</span>
        <span className="comparison-label after">Nachher</span>
        <div className="compare-line" style={{ left: `${value}%` }}>
          <span>
            <ArrowLeft size={16} />
            <ArrowRight size={16} />
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          aria-label="Vorher-Nachher-Vergleich"
          aria-valuetext={`${value} Prozent Vorher sichtbar`}
        />
      </div>
      <div className="compare-controls" aria-label="Bildvergleich einstellen">
        <button
          type="button"
          className="button secondary"
          onClick={() => setValue(100)}
          aria-pressed={value === 100}
        >
          Nur Vorher
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setValue(50)}
          aria-pressed={value === 50}
        >
          <SlidersHorizontal size={15} />
          Vergleichen
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setValue(0)}
          aria-pressed={value === 0}
        >
          Nur Nachher
        </button>
      </div>
    </div>
  );
}

/** Erklärt einen geänderten Autorenkontext und verlangt eine ausdrückliche Bestätigung vor weiteren Änderungen. */
function AuthorContextNotice({
  opened,
  current,
  busy,
  confirm,
}: {
  opened: AuthorContext;
  current: Session;
  busy: boolean;
  confirm: () => void;
}) {
  if (hasSameAuthorContext(opened, current)) return null;
  return (
    <div className="conflict-box" role="alert">
      <h3>Bitte das Namensschild bestätigen</h3>
      <p>
        Die Sitzung oder das Profil hat sich seit dem Öffnen geändert. Deine Eingaben bleiben
        erhalten. Bestätige das aktuelle Namensschild, bevor du speicherst, oder öffne das Formular
        erneut.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={busy || !current.profileId}
        onClick={confirm}
      >
        Unter {name(current.profileId)} weiterbearbeiten
      </button>
    </div>
  );
}

/**
 * Hält Dateiauswahl und den beim Öffnen gültigen Profilstand fest. Uploadfortschritt und Fehler
 * bleiben sichtbar; bereits bestätigte Dateien werden aus der noch offenen Auswahl entfernt.
 */
function UploadDialog({
  projectId,
  defectId,
  close,
}: {
  projectId?: string;
  defectId?: string;
  close: () => void;
}) {
  const { session, refresh, notify } = useApp();
  // Anders als der laufend aktualisierte Sitzungskontext bleibt dieses Profil für den offenen Upload fest.
  const [initial, setInitial] = useState(session);
  const contextChanged = !hasSameAuthorContext(initial, session);
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState('before');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(0);
  const requests = useRef(new Map<File, string>());
  /** Übernimmt das aktuelle Namensschild erst nach Bestätigung; die ausgewählten Dateien bleiben erhalten. */
  function confirmAuthorContext() {
    if (busy || !session.profileId) return;
    setInitial(session);
    setError('');
  }
  /**
   * Überträgt ausgewählte Bilder nacheinander und verwendet je Datei eine stabile Anfrage-ID für
   * Wiederholungen. Bei einem Fehler bleiben die noch nicht bestätigten Dateien auswählbar; bereits
   * gespeicherte Bilder werden nicht erneut eingereiht.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (contextChanged) {
      setError('Bitte bestätige zuerst das aktuelle Namensschild oder öffne den Upload erneut.');
      return;
    }
    if (!files.length) return;
    setError('');
    setBusy(true);
    let successful = 0;
    try {
      for (const file of files) {
        setCurrent(file.name);
        setPercent(0);
        const data = new FormData();
        data.append('file', file);
        if (projectId) data.append('projectId', projectId);
        if (defectId) data.append('defectId', defectId);
        data.append(
          'title',
          (files.length === 1 && title.trim()
            ? title.trim()
            : file.name.replace(/\.[^.]+$/, '')
          ).slice(0, 160),
        );
        data.append('category', category);
        data.append('profileVersion', String(initial.profileVersion));
        // Bei einer verlorenen Antwort kann dieselbe Datei ohne unbeabsichtigte Dopplung erneut gesendet werden.
        if (!requests.current.has(file)) requests.current.set(file, crypto.randomUUID());
        data.append('requestId', requests.current.get(file)!);
        await uploadPhoto(data, initial, setPercent);
        successful++;
        setDone((d) => d + 1);
        setFiles((previous) => previous.filter((f) => f !== file));
      }
      await refresh();
      notify(`${successful} ${successful === 1 ? 'Foto gespeichert' : 'Fotos gespeichert'}.`);
      close();
    } catch (error) {
      setError(errorText(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Einen Moment festhalten"
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <AuthorContextNotice
          opened={initial}
          current={session}
          busy={busy}
          confirm={confirmAuthorContext}
        />
        <p className="form-intro">
          JPEG, PNG, WebP oder HEIC · höchstens 25 MB pro Foto · bis zu 10 Fotos
        </p>
        <label className="upload-area">
          <span className="empty-icon">
            <ImagePlus />
          </span>
          <strong>Fotos auswählen oder aufnehmen</strong>
          <span>Vom Handy, Tablet oder Computer</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            multiple
            disabled={busy}
            onChange={(event) => {
              // Die frühe Größenprüfung spart Übertragung; der Server prüft Inhalt und Grenzen unabhängig erneut.
              const selected = Array.from(event.target.files || []);
              setError('');
              if (selected.length > 10) {
                setError('Bitte höchstens 10 Fotos auf einmal auswählen.');
                return;
              }
              if (selected.some((f) => f.size > 25 * 1024 * 1024)) {
                setError('Ein Foto ist größer als 25 MB. Bitte verkleinere es vor dem Hochladen.');
                return;
              }
              setFiles(selected);
            }}
          />
        </label>
        {files.length > 0 && (
          <div className="upload-files">
            {files.map((file) => (
              <div key={`${file.name}-${file.lastModified}`}>
                <Camera size={15} />
                <span>{file.name}</span>
                <small>{bytes(file.size)}</small>
              </div>
            ))}
          </div>
        )}
        {files.length === 1 && (
          <label>
            Bildbeschreibung
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              placeholder="Zum Beispiel: Die Fensterseite vor dem Streichen"
              disabled={busy}
            />
          </label>
        )}
        <label>
          Zu welchem Schritt gehören die Fotos?
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
            {Object.entries(categoryLabels).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="tiny-note">
          Das Namensschild bleibt während dieses Uploads bei {name(initial.profileId)}. Nicht
          lesbare Dateien werden mit einer verständlichen Meldung abgelehnt.
        </p>
        {busy && (
          <div className="upload-progress">
            <span>
              {current} · {percent === 100 ? 'Wird verarbeitet …' : `${percent} %`}
            </span>
            <progress value={percent} max={100} />
          </div>
        )}
        {done > 0 && <p className="success-text">{done} Fotos bereits gespeichert.</p>}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={close} disabled={busy}>
            Schließen
          </button>
          <button className="button primary" disabled={busy || contextChanged || !files.length}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <ImagePlus size={17} />}Fotos
            speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Zeigt geschützte Bilddetails und bearbeitbare Metadaten mit dem beim Öffnen gültigen
 * Versionsstand. Papierkorb und Wiederherstellung bleiben bewusste Aktionen.
 */
function PhotoDialog({
  photo,
  close,
  remove,
}: {
  photo: Photo;
  close: () => void;
  remove: (photo: Photo, authorSession: Session) => Promise<void>;
}) {
  const { session, refresh, notify } = useApp();
  const [initial, setInitial] = useState(session);
  const version = useRef(photo.version);
  const contextChanged = !hasSameAuthorContext(initial, session);
  const [title, setTitle] = useState(photo.title);
  const [category, setCategory] = useState(photo.category);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  /** Bestätigt die aktuelle Sitzung ausdrücklich, ohne den ursprünglichen Fotostand still zu ersetzen. */
  function confirmAuthorContext() {
    if (busy || !session.profileId) return;
    setInitial(session);
    setConfirmRemove(false);
    setError('');
  }
  /** Verändert den Papierkorb nur im bestätigten Autorenkontext und behält Fehler im offenen Dialog. */
  async function changeDeletedAt() {
    if (busy || contextChanged) return;
    setBusy(true);
    setError('');
    try {
      await remove({ ...photo, version: version.current }, initial);
    } catch (error) {
      setError(errorText(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  /**
   * Speichert Titel und Fotokategorie mit den ursprünglichen Datensatz- und Profilversionen. Bei
   * Konflikten bleiben Eingaben erhalten; nach Erfolg wird die Galerie aktualisiert.
   */
  async function save(event: FormEvent) {
    event.preventDefault();
    if (contextChanged) {
      setError('Bitte bestätige zuerst das aktuelle Namensschild oder öffne das Foto erneut.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/photos/${photo.id}`, {
        method: 'PATCH',
        session: initial,
        body: { title, category, profileVersion: initial.profileVersion, version: version.current },
      });
      await refresh();
      notify('Foto aktualisiert.');
      close();
    } catch (error) {
      setError(errorText(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={photo.title || 'Euer Foto'} close={close} wide>
      {photo.deletedAt ? (
        <div className="trash-photo-placeholder detail">
          <Trash2 size={38} />
          <p>Stelle dieses Foto wieder her, um es erneut anzusehen.</p>
        </div>
      ) : (
        <img
          className="lightbox-image"
          src={photoUrl(photo.id)}
          alt={photo.title || 'Projektfoto'}
        />
      )}
      <div className="photo-detail-meta">
        <Person id={photo.createdBy} />
        <span>
          {fullDate(photo.createdAt)} · {photo.width} × {photo.height} · {bytes(photo.bytes)}
        </span>
        {!photo.deletedAt && (
          <a className="text-link" href={photoUrl(photo.id, 'original')} download>
            <Download size={16} />
            Original
          </a>
        )}
      </div>
      <form onSubmit={save}>
        <AuthorContextNotice
          opened={initial}
          current={session}
          busy={busy}
          confirm={confirmAuthorContext}
        />
        <div className="form-grid">
          <label>
            Beschreibung
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </label>
          <label>
            Schritt
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Photo['category'])}
            >
              {Object.entries(categoryLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error} Schließe diese Ansicht und öffne das Foto erneut, um den aktuellen Stand zu
            prüfen.
          </div>
        )}
        <div className="modal-actions spread">
          <button
            type="button"
            className="button danger-text"
            disabled={busy || contextChanged}
            onClick={() => (photo.deletedAt ? void changeDeletedAt() : setConfirmRemove(true))}
          >
            <Trash2 size={16} />
            {photo.deletedAt ? 'Wiederherstellen' : 'In den Papierkorb'}
          </button>
          <button className="button primary" disabled={busy || contextChanged}>
            Änderungen speichern
          </button>
        </div>
      </form>
      {confirmRemove && (
        <div className="confirm-inline">
          <p>
            Dieses Foto in den Papierkorb legen? Es bleibt mindestens 30 Tage wiederherstellbar.
            Falls es zu einem aktiven Vergleich gehört, muss der Vergleich zuerst archiviert werden.
          </p>
          <div className="action-wrap">
            <button className="button secondary" onClick={() => setConfirmRemove(false)}>
              Behalten
            </button>
            <button
              className="button danger"
              disabled={busy || contextChanged}
              onClick={() => void changeDeletedAt()}
            >
              Foto entfernen
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Zeigt die gewählte Person, die Nutzung im Heimnetz und den tatsächlichen Sicherungsstatus.
 * Profilaktionen betreffen nur dieses Gerät; die gemeinsamen Inhalte und Backups bleiben erhalten.
 */
function SettingsView({
  resetProfile,
  openProfiles,
}: {
  resetProfile: () => Promise<void>;
  openProfiles: () => void;
}) {
  const { session, notify } = useApp();
  const [system, setSystem] = useState<any>(null);
  const [systemError, setSystemError] = useState('');
  const [busy, setBusy] = useState(false);
  // Beim Öffnen den Betriebsstatus lesen; nach einer manuellen Sicherung aktualisiert backup ihn erneut.
  useEffect(() => {
    api('/system')
      .then(setSystem)
      .catch((error) => setSystemError(errorText(error)));
  }, []);
  /** Fordert eine Sicherung an und zeigt Erfolg erst nach Bestätigung und erneuter Statusabfrage. */
  async function backup() {
    setBusy(true);
    try {
      await api('/backup', {
        method: 'POST',
        session,
        body: { profileVersion: session.profileVersion },
      });
      setSystem(await api('/system'));
      notify('Die Sicherung wurde abgeschlossen.');
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="EIN GUTER PLATZ FÜR EURE PLÄNE"
        title="Euer Zuhause, gut aufgehoben"
        description="Profile, Heimnetz und Datensicherung."
      />
      <div className="settings-grid">
        <div className="settings-stack">
          <section className="panel settings-card">
            <div className="settings-card-title">
              <Users size={23} />
              <h2>Dein Namensschild</h2>
            </div>
            <div className="settings-profile">
              <span className={`avatar large ${session.profileId}`}>
                {name(session.profileId)[0]}
              </span>
              <div>
                <strong>{name(session.profileId)}</strong>
                <span>Auf diesem Gerät ausgewählt</span>
              </div>
            </div>
            <p>
              Neue Einträge werden dieser Person zugeordnet. Ihr könnt das Profil jederzeit
              wechseln; eure Daten bleiben gemeinsam.
            </p>
            <div className="action-wrap">
              <button className="button primary" onClick={openProfiles}>
                <Users size={16} />
                Profil wechseln
              </button>
              <button className="button secondary" onClick={() => void resetProfile()}>
                <ArrowLeft size={16} />
                Zur Profilauswahl
              </button>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="settings-card-title">
              <Wifi size={22} />
              <h2>Nur bei euch zu Hause</h2>
            </div>
            <p>
              Eure App läuft auf dem Windows-PC und ist im freigegebenen Heimnetz erreichbar. Der PC
              muss dafür eingeschaltet und wach sein.
            </p>
            <p className="tiny-note">
              Installation am Handy: Im Browser-Menü „Zum Home-Bildschirm“ beziehungsweise „App
              installieren“ wählen. Ein vertrauenswürdiger HTTPS-Zugang ist dafür erforderlich.
            </p>
          </section>
        </div>
        <section className="panel settings-card">
          <div className="settings-card-title">
            <ShieldCheck size={23} />
            <h2>Sicherung & Speicher</h2>
          </div>
          {system ? (
            <>
              <div className="storage-heading">
                <span>Geschützte Fotos</span>
                <strong>
                  {bytes(system.mediaBytes || 0)}
                  {' / '}
                  {bytes(system.mediaLimitBytes || 20 * 1024 ** 3)}
                </strong>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, ((system.mediaBytes || 0) / (system.mediaLimitBytes || 1)) * 100)}%`,
                  }}
                />
              </div>
              {typeof system.freeBytes === 'number' && (
                <p className="tiny-note">{bytes(system.freeBytes)} auf dem Laufwerk frei.</p>
              )}
              <div className={`backup-state ${system.backupConfigured ? '' : 'attention'}`}>
                <CircleAlert size={20} />
                <div>
                  <strong>
                    {system.backupConfigured
                      ? 'Sicherungsziel eingerichtet'
                      : 'Sicherungsziel noch einrichten'}
                  </strong>
                  <p>
                    {system.backupConfigured
                      ? system.lastBackup?.lastSuccess?.createdAt
                        ? `Letzte erfolgreiche Sicherung: ${fullDate(system.lastBackup.lastSuccess.createdAt)}${system.lastBackup.error ? '. Der letzte Versuch ist fehlgeschlagen: ' + system.lastBackup.error : ''}`
                        : system.lastBackup?.error
                          ? `Noch keine erfolgreiche Sicherung. ${system.lastBackup.error}`
                          : 'Noch keine erfolgreiche Sicherung angezeigt.'
                      : 'Für den verlässlichen Alltag braucht ihr eine geprüfte Sicherung auf einem anderen Datenträger. Eine Kopie auf derselben SSD reicht nicht.'}
                  </p>
                </div>
              </div>
              {system.backupConfigured && (
                <button className="button secondary" disabled={busy} onClick={() => void backup()}>
                  <RefreshCw size={16} />
                  Jetzt sichern
                </button>
              )}
            </>
          ) : (
            <p>{systemError || 'Betriebsstatus wird geladen …'}</p>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * Gemeinsamer Formular-Dialog für fachliche Datensätze. Er hält eigene Eingaben, die ursprüngliche
 * Datensatzversion und den gewählten Autor getrennt vom laufend aktualisierten App-Zustand.
 */
function RecordEditor({ spec, close }: { spec: EditorSpec; close: () => void }) {
  const { state, session, refresh, notify } = useApp();
  const isNew = !spec.record;
  const collection = spec.collection;
  const defaults: Record<string, any> = {
    title: '',
    description: '',
    roomId: '',
    projectId: '',
    defectId: '',
    priority: 'normal',
    status: collection === 'projects' ? 'idea' : 'open',
    phase: 'preparation',
    predecessorIds: [],
    assignees: [],
    startDate: '',
    dueDate: '',
    color: '#456557',
    icon: 'door',
    quantity: 1,
    unit: 'Stück',
    category: 'material',
    unitPriceCents: '',
    purchased: false,
    body: '',
    beforeId: '',
    afterId: '',
    beforeX: 50,
    beforeY: 50,
    afterX: 50,
    afterY: 50,
    beforeZoom: 1,
    afterZoom: 1,
    ...spec.defaults,
    ...spec.record,
  };
  if (spec.record && collection === 'shopping')
    defaults.unitPriceCents =
      spec.record.unitPriceCents === null ? '' : (spec.record.unitPriceCents / 100).toFixed(2);
  const [form, setForm] = useState(defaults);
  // Diese Versionen gehören zum geöffneten Formular und folgen ausdrücklich nicht dem Hintergrund-Polling.
  const [version, setVersion] = useState(spec.record?.version);
  const [authorContext, setAuthorContext] = useState<AuthorContext>({
    profileVersion: spec.profileVersion,
    profileId: spec.profileId,
    csrfToken: spec.csrfToken,
  });
  const { profileVersion, profileId: author } = authorContext;
  const contextChanged = !hasSameAuthorContext(authorContext, session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<{ latest?: AnyRecord; profile?: Session } | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [completeConfirm, setCompleteConfirm] = useState(false);
  // Die unveränderte Kennung lässt den Server wiederholtes Anlegen nach einem Verbindungsabbruch erkennen.
  const requestId = useRef(crypto.randomUUID());
  /** Bestätigt den aktuellen Autor ausdrücklich; Eingaben und offene Datensatzkonflikte bleiben bestehen. */
  function confirmAuthorContext() {
    if (busy || !session.profileId) return;
    setAuthorContext({
      csrfToken: session.csrfToken,
      profileVersion: session.profileVersion,
      profileId: session.profileId,
    });
    setError('');
  }
  /**
   * Ändert genau ein Formularfeld unveränderlich. Andere Eingaben und der gespeicherte
   * Bearbeitungskontext bleiben erhalten.
   */
  const update = (field: string, value: any) =>
    setForm((previous) => ({ ...previous, [field]: value }));
  /** Ein Projektwechsel entfernt unpassende Vorgänger und übernimmt bei Aufgaben den zugehörigen Raum. */
  const updateProject = (projectId: string) => {
    setForm((previous) => ({
      ...previous,
      projectId,
      ...(collection === 'tasks' && projectId !== previous.projectId
        ? {
            predecessorIds: [],
            roomId:
              state.projects.find((project) => project.id === projectId)?.roomId || previous.roomId,
          }
        : {}),
    }));
  };
  // Die Positivliste verhindert, dass UI-Hilfsfelder oder fremde Datensatzattribute zur API gelangen.
  const fields: Record<Collection, string[]> = {
    rooms: ['title', 'description', 'color', 'icon'],
    projects: ['title', 'description', 'roomId', 'priority', 'status', 'startDate', 'dueDate'],
    tasks: [
      'title',
      'description',
      'projectId',
      'roomId',
      'defectId',
      'priority',
      'status',
      'phase',
      'predecessorIds',
      'assignees',
      'startDate',
      'dueDate',
    ],
    shopping: ['title', 'projectId', 'category', 'quantity', 'unit', 'unitPriceCents', 'purchased'],
    defects: [
      'title',
      'description',
      'roomId',
      'projectId',
      'priority',
      'status',
      'assignees',
      'dueDate',
    ],
    notes: ['projectId', 'body'],
    comparisons: [
      'projectId',
      'title',
      'beforeId',
      'afterId',
      'beforeX',
      'beforeY',
      'afterX',
      'afterY',
      'beforeZoom',
      'afterZoom',
    ],
  };
  /**
   * Validiert zusammenhängende Felder und erstellt nur die für diese Sammlung erlaubte Nutzlast.
   * Anlegen nutzt eine stabile Anfrage-ID; Bearbeiten sendet Datensatz- und Profilversion. Bei HTTP
   * 409 lädt der Dialog den aktuellen Vergleichsstand, behält aber die eigenen Eingaben bis zur
   * ausdrücklichen Bestätigung.
   */
  async function save(event?: FormEvent, extra: Record<string, any> = {}, confirmed = false) {
    event?.preventDefault();
    setError('');
    if (contextChanged) {
      setError('Bitte bestätige zuerst das aktuelle Namensschild oder öffne das Formular erneut.');
      return;
    }
    if (
      collection === 'tasks' &&
      ['active', 'done'].includes(form.status) &&
      waitingFor(form as Pick<Task, 'predecessorIds'>, state.tasks).length
    ) {
      setError(
        'Diese Aufgabe wartet noch auf Vorgänger. Erledigt sie zuerst oder ändert die Verknüpfung bewusst.',
      );
      return;
    }
    if (form.startDate && form.dueDate && form.startDate > form.dueDate) {
      setError('Der Beginn muss vor oder am Fälligkeitstag liegen.');
      return;
    }
    if (
      collection === 'comparisons' &&
      (!form.beforeId || !form.afterId || form.beforeId === form.afterId)
    ) {
      setError('Wähle zwei unterschiedliche Fotos für Vorher und Nachher.');
      return;
    }
    if (
      collection === 'projects' &&
      form.status === 'done' &&
      spec.record?.status !== 'done' &&
      active(state.tasks).some((t) => t.projectId === spec.record?.id && t.status !== 'done') &&
      !confirmed &&
      !extra.archivedAt
    ) {
      setCompleteConfirm(true);
      return;
    }
    const body: Record<string, any> = {};
    // Leere Auswahl-/Datumsfelder werden als fachlich fehlender Wert übertragen, nicht als leere Zeichenfolge.
    for (const field of fields[collection])
      body[field] = ['roomId', 'projectId', 'defectId', 'startDate', 'dueDate'].includes(field)
        ? form[field] || null
        : form[field];
    if (collection === 'shopping') {
      body.quantity = Number(form.quantity);
      // Das Formular arbeitet in Euro; die API erhält ganze Cent. Ein unbekannter Preis bleibt null.
      body.unitPriceCents =
        form.unitPriceCents === '' || form.unitPriceCents === null
          ? null
          : Math.round(Number(String(form.unitPriceCents).replace(',', '.')) * 100);
    }
    if (isNew && collection === 'projects')
      body.rank = Math.max(0, ...state.projects.map((p) => p.rank)) + 1024;
    Object.assign(
      body,
      extra,
      { profileVersion },
      isNew ? { requestId: requestId.current } : { version },
    );
    setBusy(true);
    try {
      await api(`/${collection}${isNew ? '' : `/${spec.record!.id}`}`, {
        method: isNew ? 'POST' : 'PATCH',
        session: { ...session, ...authorContext },
        body,
      });
      await refresh();
      notify(
        `${collectionLabels[collection]} ${extra.archivedAt === null ? 'wiederhergestellt' : extra.archivedAt ? 'archiviert' : isNew ? 'angelegt' : 'gespeichert'}.`,
      );
      close();
    } catch (error) {
      setError(errorText(error));
      if (error instanceof ApiError && error.status === 403) await refresh();
      if (error instanceof ApiError && error.status === 409) {
        // Nur den Vergleichsstand laden: form, version und author werden hier bewusst nicht überschrieben.
        try {
          const [latestState, latestSession] = await Promise.all([
            api<AppState>('/state'),
            api<Session>('/session'),
          ]);
          setConflict({
            latest: (latestState[collection] as unknown as AnyRecord[]).find(
              (r) => r.id === spec.record?.id,
            ),
            profile: latestSession,
          });
        } catch {
          /* Auch wenn der Vergleichsstand nicht erreichbar ist, bleiben die eigenen Eingaben erhalten. */
        }
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }
  const roomSelect = (
    <label>
      Raum oder Bereich
      <select value={form.roomId || ''} onChange={(e) => update('roomId', e.target.value)}>
        <option value="">Allgemein im Haus</option>
        {state.rooms
          .filter((r) => !r.archivedAt || r.id === form.roomId)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
              {r.archivedAt ? ' (Archiv)' : ''}
            </option>
          ))}
      </select>
    </label>
  );
  const projectSelect = (
    <label>
      Projekt
      <select
        value={form.projectId || ''}
        required={collection === 'notes' || collection === 'comparisons'}
        onChange={(e) => updateProject(e.target.value)}
      >
        <option value="">
          {collection === 'notes' || collection === 'comparisons'
            ? 'Projekt auswählen'
            : 'Allgemein fürs Haus'}
        </option>
        {state.projects
          .filter((p) => !p.archivedAt || p.id === form.projectId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.archivedAt ? ' (Archiv)' : ''}
            </option>
          ))}
      </select>
    </label>
  );
  const prioritySelect = (
    <label>
      Priorität
      <select value={form.priority} onChange={(e) => update('priority', e.target.value)}>
        {Object.entries(priorityLabels).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const statusOptions =
    collection === 'projects'
      ? projectStatus
      : collection === 'defects'
        ? defectStatus
        : taskStatus;
  const predecessorChoices =
    collection === 'tasks' && form.projectId
      ? state.tasks.filter(
          (task) =>
            task.projectId === form.projectId &&
            task.id !== spec.record?.id &&
            (!task.archivedAt || form.predecessorIds.includes(task.id)),
        )
      : [];
  const pendingPredecessors =
    collection === 'tasks' ? waitingFor(form as Pick<Task, 'predecessorIds'>, state.tasks) : [];
  const photoOptions = state.photos.filter(
    (p) => p.projectId === form.projectId && !p.deletedAt && !p.archivedAt,
  );
  return (
    <Modal
      title={`${collectionLabels[collection]} ${isNew ? (collection === 'notes' ? 'schreiben' : 'anlegen') : 'bearbeiten'}`}
      close={() => {
        if (!busy) close();
      }}
      wide={collection === 'comparisons'}
    >
      <form onSubmit={(event) => void save(event)}>
        <div className="form-author">
          <Person id={author} prefix={isNew ? 'Neu von ' : 'Bearbeitung von '} />
          <span>Gemeinsam sichtbar</span>
        </div>
        <AuthorContextNotice
          opened={authorContext}
          current={session}
          busy={busy}
          confirm={confirmAuthorContext}
        />
        {collection !== 'notes' && (
          <label>
            {collection === 'rooms'
              ? 'Name des Raums oder Bereichs'
              : collection === 'shopping'
                ? 'Was braucht ihr?'
                : collection === 'comparisons'
                  ? 'Name des Vergleichs'
                  : 'Titel'}
            <input
              autoFocus
              required
              maxLength={160}
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              placeholder={
                collection === 'projects'
                  ? 'Zum Beispiel: Wohnzimmer streichen'
                  : collection === 'rooms'
                    ? 'Zum Beispiel: Wohnzimmer'
                    : collection === 'tasks'
                      ? 'Zum Beispiel: Wand abkleben'
                      : collection === 'shopping'
                        ? 'Zum Beispiel: Malerkrepp'
                        : collection === 'defects'
                          ? 'Zum Beispiel: Undichte Silikonfuge'
                          : 'Zum Beispiel: Die Fensterseite'
              }
            />
          </label>
        )}
        {['rooms', 'projects', 'tasks', 'defects'].includes(collection) && (
          <label>
            Beschreibung <span className="optional">optional</span>
            <textarea
              rows={3}
              maxLength={10000}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Was möchtet ihr dazu festhalten?"
            />
          </label>
        )}
        {collection === 'rooms' && (
          <fieldset className="color-field">
            <legend>Farbakzent</legend>
            {['#456557', '#A65C45', '#815773', '#326E75', '#A18144', '#67789A'].map((color) => (
              <label
                key={color}
                className={form.color === color ? 'selected' : ''}
                style={{ background: color }}
              >
                <input
                  type="radio"
                  name="roomColor"
                  value={color}
                  checked={form.color === color}
                  onChange={() => update('color', color)}
                />
                <span className="sr-only">Farbe {color}</span>
                {form.color === color && <Check size={18} />}
              </label>
            ))}
          </fieldset>
        )}
        {['projects', 'tasks', 'defects'].includes(collection) && (
          <>
            <div className="form-grid">
              {roomSelect}
              {prioritySelect}
            </div>
            <div className="form-grid">
              <label>
                Status
                <select value={form.status} onChange={(e) => update('status', e.target.value)}>
                  {Object.entries(statusOptions).map(([key, label]) => (
                    <option
                      key={key}
                      value={key}
                      disabled={
                        collection === 'tasks' &&
                        ['active', 'done'].includes(key) &&
                        pendingPredecessors.length > 0
                      }
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {collection !== 'projects' ? (
                projectSelect
              ) : (
                <label>
                  Wunschbeginn <span className="optional">optional</span>
                  <input
                    type="date"
                    value={form.startDate || ''}
                    onChange={(e) => update('startDate', e.target.value)}
                  />
                </label>
              )}
            </div>
            {collection === 'tasks' && (
              <div className="task-planning-fields">
                <label>
                  Projektphase
                  <select
                    value={form.phase}
                    onChange={(event) => update('phase', event.target.value)}
                  >
                    {TASK_PHASES.map((phase) => (
                      <option key={phase} value={phase}>
                        {taskPhaseLabels[phase]}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="predecessor-field">
                  <legend>Was muss vorher fertig sein?</legend>
                  <p className="tiny-note">
                    Alle ausgewählten Vorgänger müssen erledigt sein. Verknüpfungen gelten im selben
                    Projekt; bei einem Projektwechsel werden sie entfernt.
                  </p>
                  {!form.projectId ? (
                    <p className="subtle">Wähle zuerst ein Projekt, um Aufgaben zu verknüpfen.</p>
                  ) : predecessorChoices.length ? (
                    <div className="predecessor-options">
                      {predecessorChoices.map((task) => (
                        <label key={task.id} className="predecessor-option">
                          <input
                            type="checkbox"
                            checked={form.predecessorIds.includes(task.id)}
                            onChange={(event) =>
                              update(
                                'predecessorIds',
                                event.target.checked
                                  ? [...form.predecessorIds, task.id]
                                  : form.predecessorIds.filter((id: string) => id !== task.id),
                              )
                            }
                          />
                          <span>
                            <strong>{task.title}</strong>
                            <small>
                              {taskPhaseLabels[task.phase]} · {taskStatus[task.status]}
                              {task.archivedAt ? ' · Archiviert' : ''}
                            </small>
                          </span>
                          {task.status === 'done' && <Check size={15} />}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="subtle">Noch keine anderen Aufgaben in diesem Projekt.</p>
                  )}
                  {pendingPredecessors.length > 0 && (
                    <p className="dependency-notice">
                      <CircleAlert size={15} />
                      Wartet auf:{' '}
                      {pendingPredecessors
                        .map((entry) => entry.task?.title || 'Nicht mehr verfügbare Aufgabe')
                        .join(', ')}
                    </p>
                  )}
                </fieldset>
              </div>
            )}
            {collection !== 'projects' && (
              <fieldset className="assignee-field">
                <legend>Wer übernimmt es?</legend>
                {[
                  ['', 'Noch offen'],
                  ['karla', 'Karla'],
                  ['marvin', 'Marvin'],
                  ['both', 'Gemeinsam'],
                ].map(([id, label]) => {
                  // Die Radioauswahl bildet keine Person, genau eine Person oder beide Profil-IDs ab.
                  const checked =
                    id === 'both'
                      ? form.assignees.length === 2
                      : id === ''
                        ? !form.assignees.length
                        : form.assignees.length === 1 && form.assignees[0] === id;
                  return (
                    <label key={id} className={checked ? 'selected' : ''}>
                      <input
                        type="radio"
                        name="assignee"
                        checked={checked}
                        onChange={() =>
                          update('assignees', id === 'both' ? ['karla', 'marvin'] : id ? [id] : [])
                        }
                      />
                      {label}
                    </label>
                  );
                })}
              </fieldset>
            )}
            <div className="form-grid">
              {collection === 'tasks' && (
                <label>
                  Beginn <span className="optional">optional</span>
                  <input
                    type="date"
                    value={form.startDate || ''}
                    onChange={(e) => update('startDate', e.target.value)}
                  />
                </label>
              )}
              <label>
                {collection === 'projects' ? 'Geplanter Abschluss' : 'Fällig am'}{' '}
                <span className="optional">optional</span>
                <input
                  type="date"
                  value={form.dueDate || ''}
                  onChange={(e) => update('dueDate', e.target.value)}
                />
              </label>
            </div>
          </>
        )}
        {collection === 'shopping' && (
          <>
            <div className="form-grid">
              <label>
                Menge
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={form.quantity}
                  onChange={(e) => update('quantity', e.target.value)}
                />
              </label>
              <label>
                Einheit
                <input
                  required
                  maxLength={40}
                  list="units"
                  value={form.unit}
                  onChange={(e) => update('unit', e.target.value)}
                />
                <datalist id="units">
                  {['Stück', 'Rolle', 'Liter', 'Kilogramm', 'Meter', 'Quadratmeter', 'Packung'].map(
                    (unit) => (
                      <option key={unit}>{unit}</option>
                    ),
                  )}
                </datalist>
              </label>
            </div>
            <div className="form-grid">
              <label>
                Art
                <select value={form.category} onChange={(e) => update('category', e.target.value)}>
                  <option value="material">Material</option>
                  <option value="tool">Werkzeug</option>
                </select>
              </label>
              <label>
                Einzelpreis in € <span className="optional">optional</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.unitPriceCents ?? ''}
                  onChange={(e) => update('unitPriceCents', e.target.value)}
                  placeholder="Preis noch offen"
                />
                <small>Je {form.unit || 'Einheit'}, kein Gesamtpreis.</small>
              </label>
            </div>
            {projectSelect}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.purchased}
                onChange={(e) => update('purchased', e.target.checked)}
              />
              Schon gekauft
            </label>
          </>
        )}
        {collection === 'notes' && (
          <>
            {projectSelect}
            <label>
              Eure Notiz
              <textarea
                autoFocus
                required
                rows={7}
                maxLength={10000}
                value={form.body}
                onChange={(e) => update('body', e.target.value)}
                placeholder="Eine Entscheidung, ein kleiner Erfolg oder eine Idee für später …"
              />
            </label>
          </>
        )}
        {collection === 'comparisons' && (
          <>
            {projectSelect}
            {photoOptions.length < 2 && (
              <div className="info-banner">
                Für einen Vergleich braucht ihr mindestens zwei Fotos im selben Projekt.
              </div>
            )}
            <div className="form-grid">
              {(['before', 'after'] as const).map((side) => (
                <label key={side}>
                  {side === 'before' ? 'Vorher-Foto' : 'Nachher-Foto'}
                  <select
                    required
                    value={form[`${side}Id`]}
                    onChange={(e) => update(`${side}Id`, e.target.value)}
                  >
                    <option value="">Foto auswählen</option>
                    {photoOptions.map((photo) => (
                      <option key={photo.id} value={photo.id}>
                        {photo.title || categoryLabels[photo.category]}
                        {' · '}
                        {categoryLabels[photo.category]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {form.beforeId && form.afterId && (
              <>
                <CompareSlider comparison={form} />
                <details className="crop-settings">
                  <summary>Ausschnitt und Ausrichtung anpassen</summary>
                  <div className="form-grid">
                    {(['before', 'after'] as const).map((side) => (
                      <fieldset key={side}>
                        <legend>{side === 'before' ? 'Vorher' : 'Nachher'}</legend>
                        {[
                          ['X', 'Waagerecht', 0, 100, 1],
                          ['Y', 'Senkrecht', 0, 100, 1],
                          ['Zoom', 'Vergrößerung', 1, 3, 0.05],
                        ].map(([key, label, min, max, step]) => (
                          <label key={String(key)}>
                            {label}
                            <input
                              type="range"
                              min={min}
                              max={max}
                              step={step}
                              value={form[`${side}${key}`]}
                              onChange={(e) => update(`${side}${key}`, Number(e.target.value))}
                            />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  </div>
                </details>
              </>
            )}
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {conflict && (
          <div className="conflict-box">
            <h3>Bitte den aktuellen Stand prüfen</h3>
            <p>Deine Eingaben bleiben im Formular. Ein anderer Stand wurde nicht überschrieben.</p>
            {conflict.latest && (
              <div className="conflict-values">
                {fields[collection]
                  .filter(
                    (field) =>
                      JSON.stringify(conflict.latest![field]) !==
                      JSON.stringify(spec.record?.[field]),
                  )
                  .map((field) => (
                    <div key={field}>
                      <strong>
                        {(
                          {
                            title: 'Titel',
                            description: 'Beschreibung',
                            status: 'Status',
                            priority: 'Priorität',
                            dueDate: 'Fälligkeit',
                            startDate: 'Beginn',
                            quantity: 'Menge',
                            body: 'Notiz',
                            assignees: 'Zuständigkeit',
                          } as Record<string, string>
                        )[field] || field}
                        :
                      </strong>{' '}
                      {typeof conflict.latest![field] === 'string'
                        ? conflict.latest![field]
                        : JSON.stringify(conflict.latest![field])}
                    </div>
                  ))}
              </div>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy || contextChanged}
              onClick={() => {
                // Nur der Datensatzstand wird hier bestätigt; ein anderer Autor benötigt die eigene Bestätigung oben.
                if (conflict.latest) setVersion(conflict.latest.version);
                setConflict(null);
                setError('');
              }}
            >
              Geprüft · Meine Eingaben weiterbearbeiten
            </button>
          </div>
        )}
        {spec.record && (
          <div className="record-history">
            <span>
              Erstellt von <strong>{name(spec.record.createdBy)}</strong>
              {' · '}
              {fullDate(spec.record.createdAt)}
            </span>
            <span>
              Zuletzt geändert von <strong>{name(spec.record.updatedBy)}</strong>
              {' · '}
              {fullDate(spec.record.updatedAt)}
            </span>
            {spec.record.completedBy && (
              <span>
                Erledigt von <strong>{name(spec.record.completedBy)}</strong>
              </span>
            )}
            {spec.record.purchasedBy && (
              <span>
                Gekauft von <strong>{name(spec.record.purchasedBy)}</strong>
              </span>
            )}
          </div>
        )}
        <div className="modal-actions spread">
          {!isNew ? (
            <button
              type="button"
              className="button text-button"
              disabled={busy || contextChanged}
              onClick={() =>
                spec.record!.archivedAt
                  ? void save(undefined, { archivedAt: null }, true)
                  : setArchiveConfirm(true)
              }
            >
              <Archive size={16} />
              {spec.record!.archivedAt ? 'Wiederherstellen' : 'Archivieren'}
            </button>
          ) : (
            <button type="button" className="button secondary" disabled={busy} onClick={close}>
              Abbrechen
            </button>
          )}
          <button className="button primary" disabled={busy || contextChanged || !!conflict}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Speichern
          </button>
        </div>
        {archiveConfirm && (
          <div className="confirm-inline">
            <p>
              {collectionLabels[collection]} archivieren? Zugehörige Daten bleiben erhalten und
              können später wieder aufgerufen werden.
            </p>
            <div className="action-wrap">
              <button
                type="button"
                className="button secondary"
                onClick={() => setArchiveConfirm(false)}
              >
                Behalten
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || contextChanged || !!conflict}
                onClick={() => void save(undefined, { archivedAt: new Date().toISOString() }, true)}
              >
                Archivieren
              </button>
            </div>
          </div>
        )}
        {completeConfirm && (
          <div className="confirm-inline">
            <p>Es gibt noch offene Aufgaben. Das Projekt trotzdem bewusst abschließen?</p>
            <div className="action-wrap">
              <button
                type="button"
                className="button secondary"
                onClick={() => setCompleteConfirm(false)}
              >
                Zurück
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || contextChanged}
                onClick={() => void save(undefined, {}, true)}
              >
                Trotzdem abschließen
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
