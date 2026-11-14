import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  AudioWaveform,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  Disc3,
  HardDrive,
  Image,
  LayoutDashboard,
  Menu,
  Monitor,
  MonitorPlay,
  MoreHorizontal,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import { getServerHealth, type ConnectionState, type ServerHealth } from "./api";

type Page = "overview" | "devices" | "sources" | "media" | "playlists" | "system";

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

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const checkHealth = async () => {
      controller?.abort();
      controller = new AbortController();

      try {
        const result = await getServerHealth(controller.signal);
        if (!active) return;
        setHealth(result);
        setConnection("online");
      } catch {
        if (!active || controller.signal.aborted) return;
        setHealth(null);
        setConnection("offline");
      } finally {
        if (active) setLastChecked(new Date());
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

  const navigate = (nextPage: Page) => {
    setPage(nextPage);
    setMobileNavOpen(false);
  };

  const pageTitle = navigation.find((item) => item.id === page)?.label ?? "System";

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
          <ChevronDown size={15} className="muted-icon" />
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
              <span>Read the setup guide</span>
            </div>
            <ArrowRight size={15} />
          </div>
          <div className="profile-row">
            <div className="profile-avatar">L</div>
            <div className="profile-copy">
              <strong>Local administrator</strong>
              <span>Administrator</span>
            </div>
            <MoreHorizontal size={18} className="muted-icon" />
          </div>
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
            <button className="icon-button topbar-help" aria-label="Help"><CircleHelp size={18} /></button>
            <div className="topbar-avatar">L</div>
          </div>
        </header>

        <div className="page-content">
          {page === "overview" && (
            <Overview
              connection={connection}
              health={health}
              lastChecked={lastChecked}
              onNavigate={navigate}
            />
          )}
          {page === "devices" && <EmptyPage kind="devices" onNavigate={navigate} />}
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

function Overview({
  connection,
  health,
  lastChecked,
  onNavigate,
}: {
  connection: ConnectionState;
  health: ServerHealth | null;
  lastChecked: Date | null;
  onNavigate: (page: Page) => void;
}) {
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">YOUR NETWORK AT A GLANCE</div>
          <h1>Good morning.</h1>
          <p>Here's what's happening across your Veyra network.</p>
        </div>
        <button className="button button-secondary" onClick={() => onNavigate("devices")}>
          <Plus size={16} /> Add a device
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
            Set up your first device <ArrowRight size={16} />
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
          <h2>Not configured</h2>
          <p>Persistent storage has not been connected to the server yet.</p>
          <div className="system-card-foot"><span className="status-dot dot-pending" />Next server milestone</div>
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
          <h2>Local development</h2>
          <p>The server currently binds to loopback. Authentication is required before LAN exposure.</p>
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
