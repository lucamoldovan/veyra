import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  AudioWaveform,
  CircleHelp,
  Check,
  Clipboard,
  Command,
  Disc3,
  HardDrive,
  Image,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Monitor,
  MonitorPlay,
  Network,
  Radio,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import { createDevicePairingCode, createInitialOperator, getAuthSession, getDevices, getServerHealth, getSetupStatus, login, logout, type ConnectionState, type Device, type Operator, type PairingCode, type ServerHealth } from "./api";

type Page = "overview" | "devices" | "sources" | "media" | "playlists" | "system";
type AuthState = "checking" | "setup" | "login" | "authenticated" | "unavailable";

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "devices", label: "Devices", icon: Monitor },
  { id: "sources", label: "NDI sources", icon: Radio },
  { id: "media", label: "Media library", icon: Image },
  { id: "playlists", label: "Playlists", icon: Disc3 },
];

function App() {
  const [page, setPage] = useState<Page>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [operator, setOperator] = useState<Operator | null>(null);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const checkHealth = async () => {
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;

      try {
        const result = await getServerHealth(currentController.signal);
        if (!active) return;
        setHealth(result);
        setConnection("online");
      } catch {
        if (!active || currentController.signal.aborted) return;
        setHealth(null);
        setConnection("offline");
      } finally {
        if (active && !currentController.signal.aborted) setLastChecked(new Date());
      }
    };

    void checkHealth();
    const interval = window.setInterval(() => void checkHealth(), 15000);

    return () => {
      active = false;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadAuthentication = async () => {
      try {
        const [setupStatus, session] = await Promise.all([
          getSetupStatus(),
          getAuthSession(),
        ]);
        if (!active) return;

        if (session.authenticated && session.operator) {
          setOperator(session.operator);
          setAuthState("authenticated");
        } else {
          setAuthState(setupStatus.setupRequired ? "setup" : "login");
        }
      } catch {
        if (active) setAuthState("unavailable");
      }
    };

    void loadAuthentication();
    return () => { active = false; };
  }, []);

  const handleAuthenticated = (nextOperator: Operator) => {
    setOperator(nextOperator);
    setAuthState("authenticated");
  };

  const handleLogout = async () => {
    try {
      await logout();
      setOperator(null);
      setAuthState("login");
    } catch {
      setAuthState("unavailable");
    }
  };

  const navigate = (nextPage: Page) => {
    setPage(nextPage);
    setMobileNavOpen(false);
  };

  const pageTitle = navigation.find((item) => item.id === page)?.label ?? "System";

  if (authState !== "authenticated" || !operator) {
    return (
      <AuthScreen
        mode={authState}
        onAuthenticated={handleAuthenticated}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="app-shell">
      {mobileNavOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><AudioWaveform size={21} strokeWidth={2.2} /></div>
          <div className="brand-copy">
            <span className="brand-name">veyra</span>
            <span className="brand-caption">NETWORK VIDEO</span>
          </div>
          <button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMobileNavOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">V</div>
          <div className="workspace-copy">
            <strong>Local workspace</strong>
            <span>Private network</span>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "nav-item-active" : ""}`}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "devices" && <span className="nav-count">0</span>}
            </button>
          ))}
        </nav>

        <div className="nav-label system-label">SYSTEM</div>
        <nav className="main-nav" aria-label="System navigation">
          <button
            className={`nav-item ${page === "system" ? "nav-item-active" : ""}`}
            onClick={() => navigate("system")}
            aria-current={page === "system" ? "page" : undefined}
          >
            <Settings size={18} strokeWidth={1.8} />
            <span>System settings</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon"><CircleHelp size={17} /></div>
            <div>
              <strong>Need a hand?</strong>
              <span>Hosted on your local network</span>
            </div>
          </div>
          <button className="profile-row profile-button" onClick={() => void handleLogout()} title="Sign out">
            <div className="profile-avatar">{operator.username.slice(0, 1).toUpperCase()}</div>
            <div className="profile-copy">
              <strong>{operator.username}</strong>
              <span>Administrator · Sign out</span>
            </div>
            <LogOut size={16} className="muted-icon" />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>{pageTitle}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className={`server-indicator ${connection}`}>
              <span className="status-dot" />
              <span>{connection === "checking" ? "Connecting" : connection === "online" ? "Server online" : "Server offline"}</span>
            </div>
              <div className="topbar-avatar">{operator.username.slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        <div className="page-content">
          {page === "overview" && (
            <Overview
              connection={connection}
              lastChecked={lastChecked}
              onNavigate={navigate}
            />
          )}
          {page === "devices" && <DevicesPage />}
          {page === "sources" && <EmptyPage kind="sources" onNavigate={navigate} />}
          {page === "media" && <EmptyPage kind="media" onNavigate={navigate} />}
          {page === "playlists" && <EmptyPage kind="playlists" onNavigate={navigate} />}
          {page === "system" && (
            <SystemPage connection={connection} health={health} lastChecked={lastChecked} />
          )}
        </div>
      </main>
    </div>
  );
}


function AuthScreen({
  mode,
  onAuthenticated,
  onRetry,
}: {
  mode: AuthState;
  onAuthenticated: (operator: Operator) => void;
  onRetry: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isSetup = mode === "setup";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (isSetup && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = isSetup
        ? await createInitialOperator({ setupKey, username, password })
        : await login({ username, password });

      if (!result.authenticated || !result.operator) {
        throw new Error("Authentication did not complete. Please try again.");
      }
      onAuthenticated(result.operator);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"><AudioWaveform size={21} strokeWidth={2.2} /></div>
          <div className="brand-copy"><span className="brand-name">veyra</span><span className="brand-caption">NETWORK VIDEO</span></div>
        </div>

        {mode === "checking" && (
          <div className="auth-message">
            <LoaderCircle className="auth-spinner" size={25} />
            <h1>Connecting to Veyra</h1>
            <p>Checking your local workspace…</p>
          </div>
        )}

        {mode === "unavailable" && (
          <div className="auth-message">
            <div className="auth-symbol auth-symbol-error"><Server size={23} /></div>
            <h1>Server unavailable</h1>
            <p>Start the Veyra server, then try connecting again. Your dashboard and data stay on your local network.</p>
            <button className="button button-dark button-full" onClick={onRetry}>Try again <ArrowRight size={15} /></button>
          </div>
        )}

        {(mode === "setup" || mode === "login") && (
          <>
            <div className="auth-heading">
              <div className="auth-symbol"><LockKeyhole size={21} /></div>
              <div className="eyebrow">{isSetup ? "FIRST-TIME SETUP" : "LOCAL WORKSPACE"}</div>
              <h1>{isSetup ? "Create your workspace." : "Welcome back."}</h1>
              <p>{isSetup ? "Create the administrator account for this Veyra installation." : "Sign in to manage your network video system."}</p>
            </div>

            <form className="auth-form" onSubmit={(event) => void submit(event)}>
              {isSetup && (
                <label className="field-label">
                  Setup key
                  <input
                    autoComplete="off"
                    maxLength={128}
                    required
                    value={setupKey}
                    onChange={(event) => setSetupKey(event.target.value)}
                    placeholder="Paste the key from the server terminal"
                  />
                  <span className="field-hint">The first-run key is printed once in the Veyra server logs.</span>
                </label>
              )}
              <label className="field-label">
                Username
                <input
                  autoComplete="username"
                  minLength={3}
                  maxLength={32}
                  pattern="[a-zA-Z0-9_-]{3,32}"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Your username"
                />
              </label>
              <label className="field-label">
                Password
                <input
                  autoComplete={isSetup ? "new-password" : "current-password"}
                  minLength={isSetup ? 12 : 1}
                  maxLength={256}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={isSetup ? "At least 12 characters" : "Your password"}
                />
              </label>
              {isSetup && (
                <label className="field-label">
                  Confirm password
                  <input
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    required
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Enter your password again"
                  />
                </label>
              )}
              {error && <div className="auth-error" role="alert">{error}</div>}
              <button className="button button-dark button-full auth-submit" type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle size={16} className="auth-spinner" /> : null}
                {submitting ? "Please wait…" : isSetup ? "Create administrator" : "Sign in"}
                {!submitting && <ArrowRight size={15} />}
              </button>
            </form>
            <div className="auth-foot"><ShieldCheck size={14} /> Local authentication · No cloud account required</div>
          </>
        )}
      </div>
      <div className="auth-background-mark">VEYRA</div>
    </main>
  );
}

function Overview({
  connection,
  lastChecked,
  onNavigate,
}: {
  connection: ConnectionState;
  lastChecked: Date | null;
  onNavigate: (page: Page) => void;
}) {
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">YOUR NETWORK AT A GLANCE</div>
          <h1>Your network.</h1>
          <p>Here's what's happening across your Veyra network.</p>
        </div>
        <button className="button button-secondary" onClick={() => onNavigate("devices")}>
          <Monitor size={16} /> View devices
        </button>
      </section>

      <section className="stat-grid" aria-label="Network summary">
        <StatCard label="Total devices" value="0" detail="No receivers registered" icon={Monitor} />
        <StatCard label="Online now" value="0" detail="Waiting for first receiver" icon={Wifi} />
        <StatCard label="NDI sources" value="—" detail="Source discovery not connected" icon={Radio} />
        <StatCard label="Media assets" value="0" detail="Your library is empty" icon={Image} />
      </section>

      <section className="overview-grid">
        <div className="panel network-panel">
          <div className="panel-heading">
            <div>
              <h2>Network status</h2>
              <p>Live connection to your local Veyra server</p>
            </div>
            <span className={`pill ${connection === "online" ? "pill-success" : connection === "offline" ? "pill-danger" : "pill-neutral"}`}>
              <span className="status-dot" />
              {connection === "online" ? "Operational" : connection === "offline" ? "Disconnected" : "Checking"}
            </span>
          </div>

          <div className="network-visual">
            <div className="network-node network-node-server">
              <div className="network-node-icon"><Server size={22} /></div>
              <div><strong>Veyra server</strong><span>{connection === "online" ? "Responding normally" : connection === "offline" ? "Cannot be reached" : "Checking connection"}</span></div>
              <span className={`node-dot ${connection}`} />
            </div>
            <div className="network-connector"><span /></div>
            <div className="network-node network-node-receivers">
              <div className="network-node-icon receiver-icon"><MonitorPlay size={22} /></div>
              <div><strong>Receivers</strong><span>Waiting for devices to pair</span></div>
              <span className="node-count">0</span>
            </div>
          </div>

          <div className="panel-footer">
            <span>{lastChecked ? `Last checked at ${lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for first health check"}</span>
            <button className="text-button" onClick={() => onNavigate("system")}>View system status <ArrowRight size={14} /></button>
          </div>
        </div>

        <div className="panel setup-panel">
          <div className="setup-topline"><span className="setup-kicker">GETTING STARTED</span><span className="setup-step">01 / 04</span></div>
          <div className="setup-icon"><Network size={22} /></div>
          <h2>Let's get your network connected.</h2>
          <p>Veyra is ready for its first receiver. Once paired, you'll be able to manage its source, playback and fallback right here.</p>
          <div className="setup-progress"><span /></div>
          <div className="setup-progress-label"><span>Platform setup</span><strong>Just getting started</strong></div>
          <button className="button button-dark button-full" onClick={() => onNavigate("devices")}>
            Explore receiver management <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel table-panel">
          <div className="panel-heading">
            <div><h2>Devices</h2><p>Receivers connected to this workspace</p></div>
            <button className="text-button" onClick={() => onNavigate("devices")}>View all <ArrowRight size={14} /></button>
          </div>
          <div className="empty-table">
            <div className="empty-icon"><Monitor size={20} /></div>
            <strong>No devices yet</strong>
            <span>Paired receivers will appear here with their live playback status.</span>
          </div>
        </div>

        <div className="panel activity-panel">
          <div className="panel-heading"><div><h2>Recent activity</h2><p>Updates from your network</p></div><Activity size={18} className="muted-icon" /></div>
          <div className="empty-activity">
            <div className="activity-line" />
            <div><strong>It's quiet around here.</strong><span>Device events, playback changes and alerts will show up here.</span></div>
          </div>
          <div className="activity-foot"><span className="activity-foot-dot" /> Activity monitoring will start when your first receiver connects.</div>
        </div>
      </section>

      <footer className="page-footer"><span>VEYRA <span className="footer-separator">/</span> NETWORK VIDEO. SIMPLIFIED.</span><span>Local-first by design <ShieldCheck size={13} /></span></footer>
    </>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Monitor;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top"><span>{label}</span><div className="stat-icon"><Icon size={17} /></div></div>
      <div className="stat-value">{value}</div>
      <div className="stat-detail">{detail}</div>
    </div>
  );
}


function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [creatingCode, setCreatingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const loadDevices = async () => {
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;

      try {
        const result = await getDevices(currentController.signal);
        if (!active) return;
        setDevices(result.devices);
        setError("");
      } catch (loadError) {
        if (!active || currentController.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load devices.");
      } finally {
        if (active && !currentController.signal.aborted) setLoading(false);
      }
    };

    void loadDevices();
    const interval = window.setInterval(() => void loadDevices(), 15000);

    return () => {
      active = false;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, [refreshTick]);

  const createCode = async () => {
    setCreatingCode(true);
    setError("");
    setCopied(false);
    try {
      const result = await createDevicePairingCode();
      setPairingCode(result);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create a pairing code.");
    } finally {
      setCreatingCode(false);
    }
  };

  const copyCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode.code);
      setCopied(true);
    } catch {
      setError("Clipboard access is unavailable. You can select and copy the code manually.");
    }
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">RECEIVER MANAGEMENT</div>
          <h1>Devices</h1>
          <p>Manage Veyra receivers, display assignments and playback state.</p>
        </div>
        <button className="button button-dark" onClick={() => void createCode()} disabled={creatingCode}>
          {creatingCode ? <LoaderCircle size={15} className="auth-spinner" /> : <Plus size={16} />}
          {creatingCode ? "Creating code…" : "Pair receiver"}
        </button>
      </section>

      {pairingCode && (
        <section className="panel pairing-panel">
          <div className="pairing-heading">
            <div className="pairing-icon"><Network size={19} /></div>
            <div><h2>One-time pairing code</h2><p>Generated for a new Veyra receiver</p></div>
            <button className="icon-button" aria-label="Dismiss pairing code" onClick={() => setPairingCode(null)}><X size={17} /></button>
          </div>
          <div className="pairing-code-row">
            <code>{pairingCode.code}</code>
            <button className="button button-secondary" onClick={() => void copyCode()}>
              {copied ? <Check size={15} /> : <Clipboard size={15} />}
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
          <div className="pairing-foot">
            <span>This code expires at {new Date(pairingCode.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} and can only be used once.</span>
            <span>Receiver enrollment client is the next integration step.</span>
          </div>
        </section>
      )}

      {error && <div className="inline-error" role="alert">{error}</div>}

      <section className="panel devices-panel">
        <div className="panel-heading">
          <div><h2>Registered receivers</h2><p>Live status is refreshed every 15 seconds</p></div>
          <button className="icon-button refresh-button" aria-label="Refresh device list" onClick={() => setRefreshTick((tick) => tick + 1)}><RefreshCw size={16} /></button>
        </div>

        {loading ? (
          <div className="devices-empty"><LoaderCircle size={22} className="auth-spinner" /><span>Loading devices…</span></div>
        ) : devices.length === 0 ? (
          <div className="devices-empty">
            <div className="empty-icon"><Monitor size={20} /></div>
            <strong>No receivers paired yet</strong>
            <span>Create a one-time pairing code to prepare a receiver for enrollment.</span>
            <button className="button button-secondary" onClick={() => void createCode()} disabled={creatingCode}>
              <Plus size={15} /> Generate pairing code
            </button>
          </div>
        ) : (
          <div className="device-list">
            <div className="device-list-head"><span>DEVICE</span><span>STATUS</span><span>PLAYBACK</span><span>LAST SEEN</span></div>
            {devices.map((device) => (
              <div className="device-row" key={device.id}>
                <div className="device-identity">
                  <div className="device-avatar"><MonitorPlay size={18} /></div>
                  <div><strong>{device.name}</strong><span>{device.platform} · v{device.softwareVersion}</span></div>
                </div>
                <div><span className={`device-status device-status-${device.status}`}><span />{device.status}</span></div>
                <div className="device-playback"><strong>{device.playbackMode}</strong><span>{device.ndiSourceName ?? "No NDI source reported"}</span></div>
                <div className="device-last-seen">{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Never connected"}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="page-footer"><span>VEYRA <span className="footer-separator">/</span> NETWORK VIDEO. SIMPLIFIED.</span><span>Receiver status from local heartbeats <ShieldCheck size={13} /></span></footer>
    </>
  );
}

function EmptyPage({
  kind,
  onNavigate,
}: {
  kind: "devices" | "sources" | "media" | "playlists";
  onNavigate: (page: Page) => void;
}) {
  const content = {
    devices: {
      eyebrow: "RECEIVER MANAGEMENT",
      title: "Devices",
      description: "Manage your Veyra receivers, display assignments and playback state.",
      icon: Monitor,
      heading: "Your network starts here.",
      body: "Once a receiver is paired with this server, you'll see its connection, current NDI source, playback mode, health and assigned fallback.",
      next: "Receiver pairing is the next server feature being built.",
    },
    sources: {
      eyebrow: "NETWORK INPUTS",
      title: "NDI sources",
      description: "Discover sources on your LAN and choose what each receiver displays.",
      icon: Radio,
      heading: "No sources discovered yet.",
      body: "NDI sources discovered by your Veyra receivers will be listed here. You can then assign a source to an individual display.",
      next: "Source inventory and receiver reporting are not connected yet.",
    },
    media: {
      eyebrow: "CONTENT LIBRARY",
      title: "Media library",
      description: "Keep the images and content used by your displays in one place.",
      icon: Image,
      heading: "Your library is ready for its first asset.",
      body: "Uploaded media will be stored locally and synchronized to the receivers that need it, including content required by offline fallback playlists.",
      next: "Uploads, validation and local media storage are coming in the next platform layer.",
    },
    playlists: {
      eyebrow: "PLAYBACK CONTENT",
      title: "Playlists",
      description: "Build ordered content sequences and assign them to individual receivers.",
      icon: Disc3,
      heading: "Create your first playback sequence.",
      body: "Playlists will support ordered image items, individual display durations and per-device fallback assignments.",
      next: "Playlist editing will arrive after media storage and receiver synchronization.",
    },
  }[kind];
  const Icon = content.icon;

  return (
    <>
      <section className="page-heading">
        <div><div className="eyebrow">{content.eyebrow}</div><h1>{content.title}</h1><p>{content.description}</p></div>
        <span className="coming-pill"><span /> BUILDING</span>
      </section>
      <section className="feature-empty panel">
        <div className="feature-empty-icon"><Icon size={26} /></div>
        <h2>{content.heading}</h2>
        <p>{content.body}</p>
        <div className="feature-note"><ArrowDownRight size={16} /><span>{content.next}</span></div>
        {kind === "devices" && (
          <button className="button button-dark" onClick={() => onNavigate("system")}>Check server connection <ArrowRight size={15} /></button>
        )}
      </section>
      <footer className="page-footer"><span>VEYRA <span className="footer-separator">/</span> NETWORK VIDEO. SIMPLIFIED.</span><span>Local-first by design <ShieldCheck size={13} /></span></footer>
    </>
  );
}

function SystemPage({
  connection,
  health,
  lastChecked,
}: {
  connection: ConnectionState;
  health: ServerHealth | null;
  lastChecked: Date | null;
}) {
  return (
    <>
      <section className="page-heading">
        <div><div className="eyebrow">PLATFORM HEALTH</div><h1>System</h1><p>Health and diagnostics for your local Veyra installation.</p></div>
        <span className={`pill ${connection === "online" ? "pill-success" : connection === "offline" ? "pill-danger" : "pill-neutral"}`}><span className="status-dot" />{connection === "online" ? "Operational" : connection === "offline" ? "Disconnected" : "Checking"}</span>
      </section>
      <section className="system-grid">
        <div className="panel system-card">
          <div className="system-card-icon"><Server size={19} /></div>
          <div className="system-card-label">LOCAL SERVER</div>
          <h2>{connection === "online" ? "Connected" : connection === "offline" ? "Unreachable" : "Checking…"}</h2>
          <p>{health ? `${health.service} · v${health.version}` : "The dashboard is checking the local server health endpoint."}</p>
          <div className="system-card-foot"><span className={`status-dot ${connection === "online" ? "dot-online" : connection === "offline" ? "dot-offline" : ""}`} />{lastChecked ? `Last checked ${lastChecked.toLocaleString()}` : "No successful check yet"}</div>
        </div>
        <div className="panel system-card">
          <div className="system-card-icon"><HardDrive size={19} /></div>
          <div className="system-card-label">DATABASE</div>
          <h2>SQLite · WAL enabled</h2>
          <p>Persistent local storage is initialized by the Veyra server.</p>
          <div className="system-card-foot"><span className="status-dot dot-online" />Database ready</div>
        </div>
        <div className="panel system-card">
          <div className="system-card-icon"><Wifi size={19} /></div>
          <div className="system-card-label">RECEIVER NETWORK</div>
          <h2>Not connected</h2>
          <p>Device registration and heartbeat monitoring are not implemented yet.</p>
          <div className="system-card-foot"><span className="status-dot dot-pending" />Awaiting first receiver</div>
        </div>
        <div className="panel system-card">
          <div className="system-card-icon"><ShieldCheck size={19} /></div>
          <div className="system-card-label">SECURITY</div>
          <h2>Operator authentication</h2>
          <p>First-run setup keys, scrypt password hashes and HttpOnly sessions are implemented.</p>
          <div className="system-card-foot"><span className="status-dot dot-pending" />LAN access disabled by default</div>
        </div>
      </section>
      <section className="panel system-info">
        <div className="panel-heading"><div><h2>Platform components</h2><p>Implementation status of the Veyra stack</p></div><Command size={18} className="muted-icon" /></div>
        <div className="component-row"><div className="component-icon"><MonitorPlay size={17} /></div><div className="component-copy"><strong>Veyra Receiver</strong><span>Native C++ / NDI / SDL2</span></div><span className="component-status status-foundation">Foundation</span></div>
        <div className="component-row"><div className="component-icon"><Server size={17} /></div><div className="component-copy"><strong>Veyra Server</strong><span>TypeScript / Fastify</span></div><span className="component-status status-foundation">Foundation</span></div>
        <div className="component-row"><div className="component-icon"><LayoutDashboard size={17} /></div><div className="component-copy"><strong>Veyra Dashboard</strong><span>React / Vite</span></div><span className="component-status status-foundation">Foundation</span></div>
      </section>
      <footer className="page-footer"><span>VEYRA <span className="footer-separator">/</span> NETWORK VIDEO. SIMPLIFIED.</span><span>Local-first by design <ShieldCheck size={13} /></span></footer>
    </>
  );
}

export default App;
