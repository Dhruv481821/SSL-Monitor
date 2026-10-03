import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Globe2,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import EarthGlobe from "./components/earth/EarthGlobe.js";
import type { EarthMarker } from "./components/earth/types.js";
import "./styles.css";

const earthTextureUrl = "/earth/earth-surface.png";

type Theme = "dark" | "light";
type Page =
  | "overview"
  | "domains"
  | "alerts"
  | "settings"
  | "details"
  | "login"
  | "register";

type Domain = {
  id: string;
  hostname: string;
  status: "unknown" | "valid" | "expiring" | "expired" | "error" | string;
  monitoringEnabled: boolean;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
};

type Ssl = {
  hostname?: string;
  success?: boolean;
  status: string;
  validFrom?: string | null;
  validUntil?: string | null;
  daysRemaining?: number | null;
  issuer?: string | null;
  subject?: string | null;
  dnsNames?: string[];
  tlsVersion?: string | null;
  chainValid?: boolean | null;
  latencyMs?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type Alert = {
  id: string;
  domainId: string;
  type: string;
  severity: "info" | "warning" | "critical" | string;
  state: "open" | "resolved" | string;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  createdAt: string;
  deliveries: Array<{
    channel: string;
    status: string;
    attemptCount: number;
    nextAttemptAt: string | null;
    deliveredAt: string | null;
  }>;
};

type Settings = {
  emailEnabled: boolean;
  emailAddress: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  expiryThresholdDays: number[];
  createdAt?: string;
  updatedAt?: string;
};

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000/api/v1";

function readTheme(): Theme {
  const saved = localStorage.getItem("ssl-monitor-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ssl-monitor-theme", theme);
  }, [theme]);
  return {
    theme,
    toggle: () => setTheme((value) => (value === "dark" ? "light" : "dark")),
  };
}

const ThemeContext = createContext<Theme>("dark");

function useApi() {
  const token = localStorage.getItem("ssl-monitor-token");
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined && init.body !== null
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (response.status === 401) {
      localStorage.removeItem("ssl-monitor-token");
      window.dispatchEvent(new Event("ssl-monitor:unauthorized"));
      throw new Error("Your session has expired. Please sign in again.");
    }
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body &&
        "error" in body &&
        typeof body.error === "object" &&
        body.error &&
        "message" in body.error
          ? String(body.error.message)
          : "Request failed. Please try again.";
      throw new Error(message);
    }
    return body as T;
  }
  return { request };
}

function fmtRelative(value: string | null) {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function fmtNext(value: string | null) {
  if (!value) return "not scheduled";
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "due now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `in ${hours}h`;
}

function statusLabel(status: string) {
  return status === "valid"
    ? "Valid"
    : status === "expiring"
      ? "Expiring Soon"
      : status === "expired"
        ? "Expired"
        : status === "error"
          ? "Invalid"
          : "Unknown";
}

function statusTone(status: string) {
  return status === "valid"
    ? "success"
    : status === "expiring"
      ? "warning"
      : status === "expired" || status === "error"
        ? "critical"
        : "neutral";
}

function severityTone(severity: string) {
  return severity === "critical"
    ? "critical"
    : severity === "warning"
      ? "warning"
      : "info";
}

function DomainIcon({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span className={`domain-icon ${tone}`}>
      <Globe2 size={17} />
    </span>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

// Domain has no verified latitude/longitude, so there are no markers to show.
// Never derive coordinates from hostnames or array order.
const NO_MARKERS: EarthMarker[] = [];

function Earth({ domains }: { domains: Domain[] }) {
  void domains;

  const theme = useContext(ThemeContext);

  return (
    <EarthGlobe
      markers={NO_MARKERS}
      theme={theme}
      timeScale={600}
      textureUrl={earthTextureUrl}
      className="earth"
    />
  );
}

function Sidebar({
  page,
  setPage,
  alerts,
  onLogout,
  mobileOpen,
  closeMobile,
}: {
  page: Page;
  setPage: (p: Page) => void;
  alerts: Alert[];
  onLogout: () => void;
  mobileOpen: boolean;
  closeMobile: () => void;
}) {
  const nav = [
    { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
    { id: "domains" as const, label: "Domains", icon: Globe2 },
    { id: "alerts" as const, label: "Alerts", icon: Bell },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];
  return (
    <>
      {mobileOpen && (
        <button
          className="sidebar-overlay"
          onClick={closeMobile}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <ShieldCheck size={25} />
          </span>
          <span>SSL Monitor</span>
        </div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={
                page === id || (id === "domains" && page === "details")
                  ? "active"
                  : ""
              }
              onClick={() => {
                setPage(id);
                closeMobile();
              }}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "alerts" &&
                alerts.filter((a) => a.state === "open").length > 0 && (
                  <b>{alerts.filter((a) => a.state === "open").length}</b>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">JD</span>
            <div>
              <strong>SSL Monitor User</strong>
              <small>Authenticated account</small>
            </div>
          </div>
          <button className="logout" onClick={onLogout}>
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>
    </>
  );
}

function Topbar({
  theme,
  toggleTheme,
  onMenu,
  onAlerts,
  search,
  setSearch,
}: {
  theme: Theme;
  toggleTheme: () => void;
  onMenu: () => void;
  onAlerts: () => void;
  search: string;
  setSearch: (v: string) => void;
}) {
  return (
    <header className="topbar">
      <button
        className="mobile-menu"
        onClick={onMenu}
        aria-label="Open navigation"
      >
        <Menu />
      </button>
      <div className="top-search">
        <Search size={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search domains..."
          aria-label="Search domains"
        />
      </div>
      <div className="top-actions">
        <button
          className="icon-button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <button
          className="icon-button"
          onClick={onAlerts}
          aria-label="Open alerts"
        >
          <Bell size={19} />
          <i />
        </button>
        <span className="top-avatar">JD</span>
      </div>
    </header>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && (
          <div className="eyebrow">
            <Globe2 size={15} /> {eyebrow}
          </div>
        )}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Metric({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof Globe2;
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span className="metric-icon">
        <Icon size={22} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function DomainsTable({
  domains,
  onCheck,
  onDelete,
  onDetails,
  onToggleMonitoring,
  loading,
  monitoringLoading,
  compact = false,
}: {
  domains: Domain[];
  onCheck: (id: string) => void;
  onDelete: (id: string) => void;
  onDetails: (id: string) => void;
  onToggleMonitoring: (id: string, enabled: boolean) => void;
  loading?: string | null;
  monitoringLoading?: string | null;
  compact?: boolean;
}) {
  if (!domains.length)
    return (
      <EmptyState
        title="No domains are being monitored yet."
        action="Add your first domain"
      />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Status</th>
            <th>Days Remaining</th>
            <th>Last Check</th>
            <th>Next Check</th>
            <th>Monitoring</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d) => (
            <tr key={d.id}>
              <td>
                <button className="domain-link" onClick={() => onDetails(d.id)}>
                  <DomainIcon status={d.status} />
                  <span>{d.hostname}</span>
                </button>
              </td>
              <td>
                <Badge tone={statusTone(d.status)}>
                  {statusTone(d.status) === "success" && <Check size={13} />}
                  {statusTone(d.status) === "warning" && (
                    <AlertTriangle size={13} />
                  )}
                  {statusTone(d.status) === "critical" && <X size={13} />}
                  {statusLabel(d.status)}
                </Badge>
              </td>
              <td
                className={
                  d.status === "expiring" || d.status === "expired"
                    ? "attention"
                    : ""
                }
              >
                {d.status === "expired" ? "Expired" : "—"}
              </td>
              <td>{fmtRelative(d.lastCheckedAt)}</td>
              <td>{fmtNext(d.nextCheckAt)}</td>
              <td>
                <button
                  type="button"
                  className={`toggle ${d.monitoringEnabled ? "on" : ""}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (monitoringLoading === d.id) return;
                    void onToggleMonitoring(d.id, !d.monitoringEnabled);
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  disabled={monitoringLoading === d.id}
                  aria-label={
                    d.monitoringEnabled
                      ? `Disable monitoring for ${d.hostname}`
                      : `Enable monitoring for ${d.hostname}`
                  }
                  aria-pressed={d.monitoringEnabled}
                >
                  <span />
                </button>
              </td>
              {!compact && (
                <td>
                  <div className="row-actions">
                    <button
                      className="small-action"
                      onClick={() => onCheck(d.id)}
                      disabled={loading === d.id}
                    >
                      {loading === d.id ? (
                        <Loader2 className="spin" size={15} />
                      ) : (
                        <Play size={14} />
                      )}{" "}
                      Check Now
                    </button>
                    <button
                      className="icon-button subtle"
                      onClick={() => onDelete(d.id)}
                      aria-label={`Delete ${d.hostname}`}
                    >
                      <MoreHorizontal size={17} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertList({
  alerts,
  domains,
  onSelect,
}: {
  alerts: Alert[];
  domains: Domain[];
  onSelect: (a: Alert) => void;
}) {
  const map = new Map(domains.map((d) => [d.id, d.hostname]));
  if (!alerts.length) return <EmptyState title="No alerts found." />;
  return (
    <div className="alert-list">
      {alerts.slice(0, 8).map((a) => (
        <button key={a.id} className="alert-row" onClick={() => onSelect(a)}>
          <span className={`alert-icon ${severityTone(a.severity)}`}>
            {a.severity === "critical" ? (
              <X size={17} />
            ) : (
              <AlertTriangle size={17} />
            )}
          </span>
          <span className="alert-copy">
            <strong>{map.get(a.domainId) ?? "Unknown domain"}</strong>
            <small>{a.message}</small>
          </span>
          <span className="alert-time">{fmtRelative(a.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyState({ title, action }: { title: string; action?: string }) {
  return (
    <div className="empty-state">
      <ShieldCheck size={24} />
      <strong>{title}</strong>
      {action && (
        <button className="text-action">
          {action} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-state">
      <AlertTriangle size={22} />
      <strong>{message}</strong>
      {retry && (
        <button className="text-action" onClick={retry}>
          Retry <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function Overview({
  domains,
  alerts,
  loading,
  error,
  onRetry,
  onAdd,
  onCheck,
  onDelete,
  onDetails,
  onToggleMonitoring,
  monitoringLoading,
  onAlerts,
}: {
  domains: Domain[];
  alerts: Alert[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAdd: () => void;
  onCheck: (id: string) => void;
  onDelete: (id: string) => void;
  onDetails: (id: string) => void;
  onToggleMonitoring: (id: string, enabled: boolean) => void;
  monitoringLoading: string | null;
  onAlerts: () => void;
}) {
  const healthy = domains.filter((d) => d.status === "valid").length;
  const expiring = domains.filter((d) => d.status === "expiring").length;
  const critical = domains.filter(
    (d) => d.status === "expired" || d.status === "error",
  ).length;
  return (
    <main className="page overview-page">
      <PageHeader
        title="Good evening, John"
        description="Your websites are being monitored for SSL/TLS certificates."
      />
      {error && <ErrorState message={error} retry={onRetry} />}
      <section className="hero-grid">
        <div className="earth-panel">
          <Earth domains={domains} />
          <div className="earth-overlay">
            <div>
              <span className="live-dot" /> Global SSL Monitoring
            </div>
            <small>Secure coverage across your monitored domains</small>
          </div>
        </div>
        <div className="hero-side">
          <div className="section-heading">
            <div>
              <h2>Global SSL Monitoring</h2>
              <p>Keeping your websites secure, everywhere.</p>
            </div>
          </div>
          <div className="metrics">
            <Metric
              icon={Globe2}
              value={domains.length}
              label="Total Domains"
              tone="blue"
            />
            <Metric
              icon={CheckCircle2}
              value={healthy}
              label="Healthy"
              tone="green"
            />
            <Metric
              icon={AlertTriangle}
              value={expiring}
              label="Expiring Soon"
              tone="amber"
            />
            <Metric icon={X} value={critical} label="Critical" tone="red" />
          </div>
          <div className="system-card">
            <span className="live-dot" />
            <div>
              <strong>Monitoring Active</strong>
              <small>
                {domains.length
                  ? `Last checked ${fmtRelative(domains.reduce((latest, d) => (new Date(d.lastCheckedAt ?? 0) > new Date(latest ?? 0) ? d.lastCheckedAt : latest), null as string | null))}`
                  : "No domains yet"}
              </small>
            </div>
            <span className="system-next">
              <Clock3 size={18} /> Next checks scheduled automatically
            </span>
          </div>
        </div>
      </section>
      <section className="content-grid">
        <div className="panel domains-panel">
          <div className="panel-header">
            <div>
              <h2>Monitored Domains</h2>
              <p>Your domains and their SSL certificate status.</p>
            </div>
            <button className="primary-button" onClick={onAdd}>
              <Plus size={17} /> Add Domain
            </button>
          </div>
          {loading ? (
            <div className="loading-block">
              <Loader2 className="spin" /> Loading domains...
            </div>
          ) : (
            <DomainsTable
              domains={domains.slice(0, 5)}
              onCheck={onCheck}
              onDelete={onDelete}
              onDetails={onDetails}
              onToggleMonitoring={onToggleMonitoring}
              monitoringLoading={monitoringLoading}
              compact
            />
          )}
        </div>
        <div className="panel alerts-panel">
          <div className="panel-header">
            <div>
              <h2>Recent Alerts</h2>
              <p>Latest SSL health events.</p>
            </div>
            <button className="link-button" onClick={onAlerts}>
              View All <ArrowRight size={14} />
            </button>
          </div>
          <AlertList
            alerts={alerts}
            domains={domains}
            onSelect={() => onAlerts()}
          />
        </div>
      </section>
    </main>
  );
}

function DomainsPage({
  domains,
  search,
  setSearch,
  onAdd,
  onCheck,
  onDelete,
  onDetails,
  onToggleMonitoring,
  monitoringLoading,
  loading,
  error,
  onRetry,
}: {
  domains: Domain[];
  search: string;
  setSearch: (v: string) => void;
  onAdd: () => void;
  onCheck: (id: string) => void;
  onDelete: (id: string) => void;
  onDetails: (id: string) => void;
  onToggleMonitoring: (id: string, enabled: boolean) => void;
  monitoringLoading: string | null;
  loading: string | null;
  error: string | null;
  onRetry: () => void;
}) {
  const [status, setStatus] = useState("all");
  const filtered = domains.filter(
    (d) =>
      d.hostname.includes(search.toLowerCase()) &&
      (status === "all" || d.status === status),
  );
  return (
    <main className="page">
      <PageHeader
        eyebrow="Domains"
        title="Domains"
        description="Manage and monitor your domains for SSL/TLS certificates."
        action={
          <button className="primary-button" onClick={onAdd}>
            <Plus size={17} /> Add Domain
          </button>
        }
      />
      {error ? (
        <ErrorState message={error} retry={onRetry} />
      ) : (
        <>
          <div className="metrics compact-metrics">
            <Metric
              icon={Globe2}
              value={domains.length}
              label="Total Domains"
              tone="blue"
            />
            <Metric
              icon={CheckCircle2}
              value={domains.filter((d) => d.status === "valid").length}
              label="Healthy"
              tone="green"
            />
            <Metric
              icon={AlertTriangle}
              value={domains.filter((d) => d.status === "expiring").length}
              label="Expiring Soon"
              tone="amber"
            />
            <Metric
              icon={X}
              value={
                domains.filter(
                  (d) => d.status === "expired" || d.status === "error",
                ).length
              }
              label="Critical"
              tone="red"
            />
          </div>
          <div className="panel table-panel">
            <div className="filters">
              <div className="field search-field">
                <Search size={17} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search domains..."
                />
              </div>
              <label className="select-wrap">
                <span>Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="valid">Healthy</option>
                  <option value="expiring">Expiring</option>
                  <option value="expired">Expired</option>
                  <option value="error">Invalid</option>
                </select>
                <ChevronDown size={15} />
              </label>
            </div>
            <DomainsTable
              domains={filtered}
              onCheck={onCheck}
              onDelete={onDelete}
              onDetails={onDetails}
              onToggleMonitoring={onToggleMonitoring}
              monitoringLoading={monitoringLoading}
              loading={loading}
            />
          </div>
        </>
      )}
    </main>
  );
}

function DomainDetails({
  domain,
  ssl,
  history,
  alerts,
  onBack,
  onCheck,
  loading,
}: {
  domain: Domain;
  ssl: Ssl | null;
  history: Ssl[];
  alerts: Alert[];
  onBack: () => void;
  onCheck: () => void;
  loading: boolean;
}) {
  return (
    <main className="page">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Domains
      </button>
      <PageHeader
        eyebrow="Domain Details"
        title={domain.hostname}
        description="Certificate health, history, and associated security events."
        action={
          <button
            className="primary-button"
            onClick={onCheck}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <Play size={17} />
            )}{" "}
            Check Now
          </button>
        }
      />
      <div className="detail-status">
        <div>
          <span className={`status-orb ${statusTone(domain.status)}`}>
            <ShieldCheck size={26} />
          </span>
          <div>
            <small>Current SSL status</small>
            <strong>{statusLabel(domain.status)}</strong>
          </div>
        </div>
        <div>
          <small>Days remaining</small>
          <strong>
            {ssl?.daysRemaining ?? "—"}
            {ssl?.daysRemaining != null ? " days" : ""}
          </strong>
        </div>
        <div>
          <small>Last check</small>
          <strong>{fmtRelative(domain.lastCheckedAt)}</strong>
        </div>
        <div>
          <small>Next check</small>
          <strong>{fmtNext(domain.nextCheckAt)}</strong>
        </div>
      </div>
      <div className="detail-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Certificate Information</h2>
              <p>Latest successful certificate snapshot.</p>
            </div>
          </div>
          <div className="info-grid">
            {[
              ["Subject", ssl?.subject],
              ["Issuer", ssl?.issuer],
              [
                "Valid From",
                ssl?.validFrom
                  ? new Date(ssl.validFrom).toLocaleString()
                  : null,
              ],
              [
                "Valid Until",
                ssl?.validUntil
                  ? new Date(ssl.validUntil).toLocaleString()
                  : null,
              ],
              ["TLS Version", ssl?.tlsVersion],
              [
                "Chain Valid",
                ssl?.chainValid == null ? null : ssl.chainValid ? "Yes" : "No",
              ],
            ].map(([label, value]) => (
              <div className="info-item" key={label}>
                <small>{label}</small>
                <strong>{value ?? "—"}</strong>
              </div>
            ))}
          </div>
          {ssl?.dnsNames?.length ? (
            <div className="san-list">
              <small>DNS Names / SANs</small>
              <div>
                {ssl.dnsNames.map((name) => (
                  <Badge key={name}>{name}</Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent History</h2>
              <p>Latest monitoring checks.</p>
            </div>
          </div>
          <div className="history-list">
            {history.slice(0, 8).map((item, i) => (
              <div key={`${item.validUntil}-${i}`}>
                <span className={`history-dot ${statusTone(item.status)}`} />
                <div>
                  <strong>{statusLabel(item.status)}</strong>
                  <small>
                    {item.validUntil
                      ? `Valid until ${new Date(item.validUntil).toLocaleDateString()}`
                      : (item.errorMessage ?? "Check completed")}
                  </small>
                </div>
                <span>{item.daysRemaining ?? "—"}d</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Alerts</h2>
            <p>Security events associated with this domain.</p>
          </div>
        </div>
        <AlertList
          alerts={alerts.filter((a) => a.domainId === domain.id)}
          domains={[domain]}
          onSelect={() => undefined}
        />
      </div>
    </main>
  );
}

function AlertsPage({
  alerts,
  domains,
  onSelect,
  error,
  onRetry,
}: {
  alerts: Alert[];
  domains: Domain[];
  onSelect: (a: Alert) => void;
  error: string | null;
  onRetry: () => void;
}) {
  const [state, setState] = useState("all");
  const [severity, setSeverity] = useState("all");
  const map = new Map(domains.map((d) => [d.id, d.hostname]));
  const filtered = alerts.filter(
    (a) =>
      (state === "all" || a.state === state) &&
      (severity === "all" || a.severity === severity),
  );
  return (
    <main className="page">
      <PageHeader
        eyebrow="Alerts"
        title="Alerts"
        description="Stay informed about your SSL certificate status and security issues."
      />
      {error ? (
        <ErrorState message={error} retry={onRetry} />
      ) : (
        <>
          <div className="metrics compact-metrics alert-metrics">
            <Metric
              icon={X}
              value={alerts.filter((a) => a.state === "open").length}
              label="Open Alerts"
              tone="red"
            />
            <Metric
              icon={Bell}
              value={alerts.length}
              label="Recent Alerts"
              tone="blue"
            />
            <Metric
              icon={AlertTriangle}
              value={alerts.filter((a) => a.severity === "critical").length}
              label="Critical Alerts"
              tone="amber"
            />
            <Metric
              icon={CheckCircle2}
              value={alerts.filter((a) => a.state === "resolved").length}
              label="Resolved"
              tone="green"
            />
          </div>
          <div className="panel table-panel">
            <div className="tabs">
              <button
                className={state === "all" ? "active" : ""}
                onClick={() => setState("all")}
              >
                All ({alerts.length})
              </button>
              <button
                className={state === "open" ? "active" : ""}
                onClick={() => setState("open")}
              >
                Open
              </button>
              <button
                className={state === "resolved" ? "active" : ""}
                onClick={() => setState("resolved")}
              >
                Resolved
              </button>
              <span className="tab-spacer" />
              <label className="select-wrap">
                <span>Severity</span>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
                <ChevronDown size={15} />
              </label>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Message</th>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => onSelect(a)}
                      className="clickable"
                    >
                      <td>{map.get(a.domainId) ?? "Unknown"}</td>
                      <td>
                        <code>{a.type}</code>
                      </td>
                      <td>
                        <Badge tone={severityTone(a.severity)}>
                          {a.severity}
                        </Badge>
                      </td>
                      <td>{a.message}</td>
                      <td>{fmtRelative(a.createdAt)}</td>
                      <td>
                        <Badge
                          tone={a.state === "open" ? "critical" : "success"}
                        >
                          {a.state}
                        </Badge>
                      </td>
                      <td>
                        {a.deliveries.length
                          ? a.deliveries.map((d) => (
                              <Badge
                                key={d.channel}
                                tone={
                                  d.status === "delivered"
                                    ? "success"
                                    : "warning"
                                }
                              >
                                {d.channel}: {d.status}
                              </Badge>
                            ))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && (
                <EmptyState title="No alerts match the current filters." />
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function SettingsPage({
  settings,
  onSave,
  saving,
  error,
  onRetry,
}: {
  settings: Settings | null;
  onSave: (s: Settings) => Promise<void>;
  saving: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [form, setForm] = useState<Settings | null>(settings);
  useEffect(() => setForm(settings), [settings]);
  if (error)
    return (
      <main className="page">
        <PageHeader
          eyebrow="Settings"
          title="Settings"
          description="Configure your notification preferences and monitoring options."
        />
        <ErrorState message={error} retry={onRetry} />
      </main>
    );
  if (!form)
    return (
      <main className="page">
        <PageHeader
          eyebrow="Settings"
          title="Settings"
          description="Configure your notification preferences and monitoring options."
        />
        <div className="loading-block">
          <Loader2 className="spin" /> Loading settings...
        </div>
      </main>
    );
  const toggleThreshold = (day: number) =>
    setForm({
      ...form,
      expiryThresholdDays: form.expiryThresholdDays.includes(day)
        ? form.expiryThresholdDays.filter((x) => x !== day)
        : [...form.expiryThresholdDays, day].sort((a, b) => b - a),
    });
  return (
    <main className="page">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Configure your notification preferences and monitoring options."
      />
      <div className="settings-tabs">
        <button className="active">
          <Bell size={17} /> Notifications
        </button>
        <button>
          <Zap size={17} /> Monitoring
        </button>
        <button>
          <UserRound size={17} /> Account
        </button>
        <button>
          <Sun size={17} /> Appearance
        </button>
      </div>
      <div className="settings-grid">
        <div className="panel settings-main">
          <div className="setting-card">
            <div className="setting-title">
              <span className="setting-icon">
                <Bell />
              </span>
              <div>
                <h2>Email Notifications</h2>
                <p>Receive SSL alerts via email.</p>
              </div>
              <span
                className={`toggle ${form.emailEnabled ? "on" : ""}`}
                onClick={() =>
                  setForm({ ...form, emailEnabled: !form.emailEnabled })
                }
              >
                <span />
              </span>
            </div>
            <label>
              Email Address
              <input
                value={form.emailAddress ?? ""}
                onChange={(e) =>
                  setForm({ ...form, emailAddress: e.target.value || null })
                }
                placeholder="you@example.com"
              />
            </label>
          </div>
          <div className="setting-card">
            <div className="setting-title">
              <span className="setting-icon">
                <Link2 />
              </span>
              <div>
                <h2>Webhook Notifications</h2>
                <p>Receive SSL alerts via webhook.</p>
              </div>
              <span
                className={`toggle ${form.webhookEnabled ? "on" : ""}`}
                onClick={() =>
                  setForm({ ...form, webhookEnabled: !form.webhookEnabled })
                }
              >
                <span />
              </span>
            </div>
            <label>
              Webhook URL
              <input
                value={form.webhookUrl ?? ""}
                onChange={(e) =>
                  setForm({ ...form, webhookUrl: e.target.value || null })
                }
                placeholder="https://your-webhook-url.com/..."
              />
            </label>
          </div>
          <div className="setting-card">
            <div className="setting-title">
              <span className="setting-icon">
                <Clock3 />
              </span>
              <div>
                <h2>Expiry Notification Thresholds</h2>
                <p>Get notified when certificates approach expiry.</p>
              </div>
            </div>
            <div className="thresholds">
              {[30, 14, 7, 1].map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={form.expiryThresholdDays.includes(day)}
                    onChange={() => toggleThreshold(day)}
                  />{" "}
                  <span>{day} days</span>
                </label>
              ))}
            </div>
          </div>
          <button
            className="primary-button"
            onClick={() => onSave(form)}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="spin" size={17} />
            ) : (
              <Check size={17} />
            )}{" "}
            Save Settings
          </button>
        </div>
        <div className="settings-side">
          <div className="panel">
            <h2>Current Configuration</h2>
            <p className="muted">
              Your current notification and monitoring settings.
            </p>
            <div className="config-list">
              <div>
                <MailIcon />
                <span>Email Alerts</span>
                <Badge tone={form.emailEnabled ? "success" : "neutral"}>
                  {form.emailEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div>
                <Link2 />
                <span>Webhook Alerts</span>
                <Badge tone={form.webhookEnabled ? "success" : "neutral"}>
                  {form.webhookEnabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div>
                <Clock3 />
                <span>Expiry Thresholds</span>
                <strong>{form.expiryThresholdDays.join(", ")} days</strong>
              </div>
            </div>
          </div>
          <div className="panel">
            <h2>Monitoring Status</h2>
            <p className="muted">
              Your domain monitoring service is running and checking configured
              domains automatically.
            </p>
            <div className="running">
              <span className="live-dot" />
              <strong>Monitoring Active</strong>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
function MailIcon() {
  return <span className="mail-icon">✉</span>;
}

function AuthPage({
  mode,
  onAuthenticated,
}: {
  mode: "login" | "register";
  onAuthenticated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data?.error?.message ?? "Authentication failed.");
      localStorage.setItem("ssl-monitor-token", data.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-visual">
        <div className="auth-earth">
          <Earth domains={[]} />
        </div>
        <div className="auth-copy">
          <span className="brand-mark">
            <ShieldCheck size={25} />
          </span>
          <h1>Global SSL Monitoring.</h1>
          <p>
            Know before certificates fail. Monitor every domain from one focused
            workspace.
          </p>
        </div>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-form">
          <div className="brand auth-brand">
            <span className="brand-mark">
              <ShieldCheck size={23} />
            </span>
            SSL Monitor
          </div>
          <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p>
            {mode === "login"
              ? "Sign in to your monitoring workspace."
              : "Start monitoring your SSL certificates."}
          </p>
          {error && <ErrorState message={error} />}
          <form onSubmit={submit}>
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
              />
            </label>
            <button className="primary-button full" disabled={loading}>
              {loading ? (
                <Loader2 className="spin" />
              ) : mode === "login" ? (
                "Sign In"
              ) : (
                "Create Account"
              )}
            </button>
          </form>
          <button
            className="link-button centered"
            onClick={() => {
              window.history.pushState(
                {},
                "",
                mode === "login" ? "/register" : "/login",
              );
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            {mode === "login"
              ? "Create an account"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { theme, toggle } = useTheme();
  const [page, setPage] = useState<Page>(
    () =>
      (location.pathname.slice(1) as Page) ||
      (localStorage.getItem("ssl-monitor-token") ? "overview" : "login"),
  );
  const [domains, setDomains] = useState<Domain[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<Domain | null>(null);
  const [ssl, setSsl] = useState<Ssl | null>(null);
  const [history, setHistory] = useState<Ssl[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState<string | null>(
    null,
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataErrors, setDataErrors] = useState({
    domains: null as string | null,
    alerts: null as string | null,
    settings: null as string | null,
  });
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alertDetail, setAlertDetail] = useState<Alert | null>(null);
  const [authenticated, setAuthenticated] = useState(() =>
    Boolean(localStorage.getItem("ssl-monitor-token")),
  );
  const api = useApi();
  const go = (next: Page) => {
    setPage(next);
    window.history.pushState({}, "", `/${next === "overview" ? "" : next}`);
  };

  async function loadAll() {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    setDataErrors({ domains: null, alerts: null, settings: null });

    const [domainsResult, alertsResult, settingsResult] =
      await Promise.allSettled([
        api.request<{ domains: Domain[] }>("/domains"),
        api.request<{ items: Alert[] }>("/alerts?limit=100"),
        api.request<Settings>("/notification-settings"),
      ]);

    const errors: string[] = [];

    if (domainsResult.status === "fulfilled") {
      setDomains(domainsResult.value.domains);
    } else {
      const message =
        domainsResult.reason instanceof Error
          ? domainsResult.reason.message
          : "Unable to load domains.";
      setDataErrors((current) => ({ ...current, domains: message }));
      errors.push(message);
    }

    if (alertsResult.status === "fulfilled") {
      setAlerts(alertsResult.value.items);
    } else {
      const message =
        alertsResult.reason instanceof Error
          ? alertsResult.reason.message
          : "Unable to load alerts.";
      setDataErrors((current) => ({ ...current, alerts: message }));
      errors.push(message);
    }

    if (settingsResult.status === "fulfilled") {
      setSettings(settingsResult.value);
    } else {
      const message =
        settingsResult.reason instanceof Error
          ? settingsResult.reason.message
          : "Unable to load notification settings.";
      setDataErrors((current) => ({ ...current, settings: message }));
      errors.push(message);
    }

    if (errors.length) {
      setError(errors.join(" "));
    }

    setLoading(false);
  }
  useEffect(() => {
    if (authenticated && page !== "login" && page !== "register") {
      void loadAll();
    }
  }, [authenticated, page]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setPage("login");
      window.history.replaceState({}, "", "/login");
    };
    window.addEventListener("ssl-monitor:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("ssl-monitor:unauthorized", onUnauthorized);
  }, []);

  useEffect(() => {
    const onPop = () =>
      setPage((location.pathname.slice(1) as Page) || "overview");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function addDomain() {
    const hostname = window.prompt("Domain to monitor (example.com):");
    if (!hostname) return;
    try {
      const created = await api.request<Domain>("/domains", {
        method: "POST",
        body: JSON.stringify({ hostname }),
      });
      setDomains((items) => [created, ...items]);
    } catch (e) {
      if (e instanceof Error && e.message === "Domain already exists") {
        await loadAll();
      }
      window.alert(e instanceof Error ? e.message : "Unable to add domain.");
    }
  }
  async function checkDomain(id: string) {
    setLoadingId(id);
    try {
      await api.request(`/domains/${id}/check`, { method: "POST" });
      await loadAll();
      if (selectedDomain?.id === id) await openDetails(id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "SSL check failed.");
    } finally {
      setLoadingId(null);
    }
  }
  async function onToggleMonitoring(id: string, enabled: boolean) {
    setMonitoringLoading(id);
    try {
      const updated = await api.request<Domain>(`/domains/${id}/monitoring`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      setDomains((items) =>
        items.map((domain) => (domain.id === id ? updated : domain)),
      );
      if (selectedDomain?.id === id) setSelectedDomain(updated);
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Unable to update monitoring.",
      );
    } finally {
      setMonitoringLoading(null);
    }
  }

  async function deleteDomain(id: string) {
    if (!window.confirm("Delete this monitored domain?")) return;
    try {
      await api.request(`/domains/${id}`, { method: "DELETE" });
      setDomains((items) => items.filter((d) => d.id !== id));
      if (selectedDomain?.id === id) go("domains");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to delete domain.");
    }
  }
  async function openDetails(id: string) {
    setLoading(true);
    setError(null);
    try {
      const [d, current, cert, h, a] = await Promise.all([
        api.request<Domain>(`/domains/${id}`),
        api.request<Ssl>(`/domains/${id}/ssl`),
        api.request<Ssl>(`/domains/${id}/certificate`),
        api.request<{ items: Ssl[] }>(`/domains/${id}/history?limit=20`),
        api.request<{ items: Alert[] }>("/alerts?limit=100"),
      ]);
      setSelectedDomain(d);
      setSsl(cert ?? current);
      setHistory(h.items);
      setAlerts(a.items);
      go("details");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load domain details.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function saveSettings(next: Settings) {
    setSavingSettings(true);
    try {
      const saved = await api.request<Settings>("/notification-settings", {
        method: "PUT",
        body: JSON.stringify({
          emailEnabled: next.emailEnabled,
          emailAddress: next.emailAddress,
          webhookEnabled: next.webhookEnabled,
          webhookUrl: next.webhookUrl,
          expiryThresholdDays: next.expiryThresholdDays,
        }),
      });
      setSettings(saved);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Unable to save settings.");
    } finally {
      setSavingSettings(false);
    }
  }
  function logout() {
    localStorage.removeItem("ssl-monitor-token");
    setAuthenticated(false);
    setDomains([]);
    setAlerts([]);
    go("login");
  }

  if (!authenticated || page === "login" || page === "register")
    return (
      <ThemeContext.Provider value={theme}>
        <AuthPage
          mode={page === "register" ? "register" : "login"}
          onAuthenticated={() => {
            setAuthenticated(true);
            go("overview");
          }}
        />
      </ThemeContext.Provider>
    );
  const filteredDomains = domains.filter((d) =>
    d.hostname.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <ThemeContext.Provider value={theme}>
      <div className="app-shell">
        <Sidebar
          page={page}
          setPage={go}
          alerts={alerts}
          onLogout={logout}
          mobileOpen={mobileOpen}
          closeMobile={() => setMobileOpen(false)}
        />
        <div className="main-shell">
          <Topbar
            theme={theme}
            toggleTheme={toggle}
            onMenu={() => setMobileOpen(true)}
            onAlerts={() => go("alerts")}
            search={search}
            setSearch={setSearch}
          />
          {page === "overview" && (
            <Overview
              domains={filteredDomains}
              alerts={alerts}
              loading={loading}
              error={error}
              onRetry={loadAll}
              onAdd={addDomain}
              onCheck={checkDomain}
              onDelete={deleteDomain}
              onDetails={openDetails}
              onToggleMonitoring={onToggleMonitoring}
              monitoringLoading={monitoringLoading}
              onAlerts={() => go("alerts")}
            />
          )}
          {page === "domains" && (
            <DomainsPage
              domains={filteredDomains}
              search={search}
              setSearch={setSearch}
              onAdd={addDomain}
              onCheck={checkDomain}
              onDelete={deleteDomain}
              onDetails={openDetails}
              onToggleMonitoring={onToggleMonitoring}
              monitoringLoading={monitoringLoading}
              loading={loadingId}
              error={dataErrors.domains}
              onRetry={loadAll}
            />
          )}
          {page === "details" && selectedDomain && (
            <DomainDetails
              domain={selectedDomain}
              ssl={ssl}
              history={history}
              alerts={alerts}
              onBack={() => go("domains")}
              onCheck={() => checkDomain(selectedDomain.id)}
              loading={loadingId === selectedDomain.id}
            />
          )}
          {page === "alerts" && (
            <AlertsPage
              alerts={alerts}
              domains={domains}
              onSelect={setAlertDetail}
              error={dataErrors.alerts}
              onRetry={loadAll}
            />
          )}
          {page === "settings" && (
            <SettingsPage
              settings={settings}
              onSave={saveSettings}
              saving={savingSettings}
              error={dataErrors.settings}
              onRetry={loadAll}
            />
          )}
        </div>
        {alertDetail && (
          <div className="modal-backdrop" onClick={() => setAlertDetail(null)}>
            <aside
              className="alert-detail"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="close-button"
                onClick={() => setAlertDetail(null)}
              >
                <X />
              </button>
              <span
                className={`alert-icon ${severityTone(alertDetail.severity)}`}
              >
                {alertDetail.severity === "critical" ? (
                  <X />
                ) : (
                  <AlertTriangle />
                )}
              </span>
              <Badge tone={severityTone(alertDetail.severity)}>
                {alertDetail.severity}
              </Badge>
              <h2>{alertDetail.message}</h2>
              <p>{alertDetail.type}</p>
              <div className="detail-fields">
                <div>
                  <small>Domain</small>
                  <strong>
                    {domains.find((d) => d.id === alertDetail.domainId)
                      ?.hostname ?? "Unknown"}
                  </strong>
                </div>
                <div>
                  <small>Status</small>
                  <Badge
                    tone={alertDetail.state === "open" ? "critical" : "success"}
                  >
                    {alertDetail.state}
                  </Badge>
                </div>
                <div>
                  <small>First Seen</small>
                  <strong>
                    {new Date(alertDetail.firstSeenAt).toLocaleString()}
                  </strong>
                </div>
                <div>
                  <small>Last Seen</small>
                  <strong>
                    {new Date(alertDetail.lastSeenAt).toLocaleString()}
                  </strong>
                </div>
              </div>
              <div>
                <h3>Notification Delivery</h3>
                {alertDetail.deliveries.length ? (
                  alertDetail.deliveries.map((d) => (
                    <div className="delivery-row" key={d.channel}>
                      <span>{d.channel}</span>
                      <Badge
                        tone={d.status === "delivered" ? "success" : "warning"}
                      >
                        {d.status}
                      </Badge>
                      <small>{d.attemptCount} attempt(s)</small>
                    </div>
                  ))
                ) : (
                  <p className="muted">No delivery records.</p>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </ThemeContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
