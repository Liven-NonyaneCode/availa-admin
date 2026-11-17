import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarCheck, Flag, LayoutDashboard, LifeBuoy, LogOut, Menu, Moon, Palette, ScrollText, Search, Settings as SettingsIcon,
  ShieldCheck, Sparkles, Star, Sun, Users, Wallet,
} from "lucide-react";
import BrandMark from "./BrandMark";
import { Avatar, Loading } from "./ui";
import UserDrawer from "./UserDrawer";
import BookingDrawer from "./BookingDrawer";
import { useAuth } from "../lib/AuthContext";
import { useTheme } from "../lib/ThemeContext";
import { rpc } from "../lib/db";
import { useOverlay } from "../lib/overlay";

type Queue = { verifications: number; reports: number; support: number; refunds: number; payouts_failed: number };

const GROUPS = [
  { label: "Overview", items: [{ to: "/", label: "Overview", icon: LayoutDashboard, end: true }] },
  {
    label: "People",
    items: [
      { to: "/users", label: "Users", icon: Users },
      { to: "/artists", label: "Artists", icon: Palette },
      { to: "/verifications", label: "ID checks", icon: ShieldCheck, badge: "verifications" as const },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/bookings", label: "Bookings", icon: CalendarCheck },
      { to: "/money", label: "Money", icon: Wallet, badge: "money" as const },
      { to: "/services", label: "Services", icon: Sparkles },
    ],
  },
  {
    label: "Trust and safety",
    items: [
      { to: "/reports", label: "Reports", icon: Flag, badge: "reports" as const },
      { to: "/reviews", label: "Reviews", icon: Star },
      { to: "/support", label: "Support inbox", icon: LifeBuoy, badge: "support" as const },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/settings", label: "Settings", icon: SettingsIcon },
      { to: "/audit", label: "Audit log", icon: ScrollText },
    ],
  },
];

export default function AdminShell() {
  const { admin, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { userId, bookingId, closeUser, closeBooking } = useOverlay();
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [q, setQ] = useState("");

  // Counts for the sidebar badges. Refreshed every minute and whenever you change page.
  useEffect(() => {
    let active = true;
    const load = () =>
      rpc<{ queue: Queue }>("admin_dashboard")
        .then((d) => active && setQueue(d.queue))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 60_000);
    return () => { active = false; clearInterval(id); };
  }, [location.pathname]);

  useEffect(() => setOpen(false), [location.pathname]);

  function badgeFor(key?: string): number {
    if (!queue || !key) return 0;
    if (key === "money") return Number(queue.refunds) + Number(queue.payouts_failed);
    return Number(queue[key as keyof Queue] ?? 0);
  }

  function search(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term) navigate(`/users?q=${encodeURIComponent(term)}`);
  }

  return (
    <>
      <header className="navbar">
        <div className="navLeft">
          <button type="button" className="iconButton menuButton" onClick={() => setOpen((o) => !o)} aria-label="Open menu" aria-expanded={open}>
            <Menu size={20} />
          </button>
          <BrandMark />
        </div>
        <form className="navSearch" onSubmit={search} role="search">
          <Search size={17} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person by name, email or phone" aria-label="Find a person" />
        </form>
        <div className="navRight">
          <button type="button" className="iconButton" onClick={toggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="profileChip">
            <Avatar name={admin?.full_name ?? admin?.email} />
            <span>{admin?.full_name || admin?.email}</span>
          </div>
          <button type="button" className="iconButton" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="adminLayout">
        <div className={`sidebarBackdrop ${open ? "open" : ""}`} onClick={() => setOpen(false)} />
        <nav className={`sidebar ${open ? "open" : ""}`} aria-label="Main">
          {GROUPS.map((g) => (
            <div key={g.label} className="navGroup">
              <div className="navGroupLabel">{g.label}</div>
              {g.items.map(({ to, label, icon: Icon, ...rest }) => {
                const end = "end" in rest ? rest.end : false;
                const badge = badgeFor("badge" in rest ? rest.badge : undefined);
                return (
                  <NavLink key={to} to={to} end={end} className={({ isActive }) => `navItem ${isActive ? "active" : ""}`}>
                    <Icon size={18} />
                    <span>{label}</span>
                    {badge > 0 && <span className="navBadge">{badge > 99 ? "99+" : badge}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <main className="main">
          <div className="mainInner">
            <Suspense fallback={<Loading />}><Outlet /></Suspense>
          </div>
        </main>
      </div>

      {/* These open from anywhere: ?user=ID and ?booking=ID */}
      {userId && <UserDrawer userId={userId} onClose={closeUser} />}
      {bookingId && <BookingDrawer bookingId={bookingId} onClose={closeBooking} />}
    </>
  );
}
