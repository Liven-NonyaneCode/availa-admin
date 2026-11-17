import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Flag, LifeBuoy, Percent, ShieldCheck, TrendingUp, Undo2, Users, Wallet, Banknote, Palette } from "lucide-react";
import { BarChart, HBars, LineChart } from "../components/charts";
import { ErrorNote, Loading, MetricCard, PageHead, Stars } from "../components/ui";
import { rpc } from "../lib/db";
import { useAsync } from "../lib/useAsync";
import { formatMoney, formatNumber, label } from "../lib/format";
import { useOverlay } from "../lib/overlay";

type Dash = {
  clients: number; artists: number; artists_listed: number; artists_unverified: number; signups_7d: number; suspended: number;
  bookings_total: number; bookings_today: number; bookings_by_status: Record<string, number>;
  booked_value_30d: number; collected_30d: number; platform_fees_30d: number; platform_fees_total: number;
  queue: { verifications: number; reports: number; support: number; refunds: number; payouts_failed: number; payouts_processing: number; hidden_reviews: number };
  top_services: { name: string; value: number }[]; top_cities: { name: string; value: number }[];
  top_artists: { id: string; name: string; value: number; rating: number }[];
};
type Day = { day: string; bookings: number; completed: number; collected: number; signups: number };

const short = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" });

export default function Overview() {
  const [days, setDays] = useState(30);
  const { openUser } = useOverlay();
  const dash = useAsync(() => rpc<Dash>("admin_dashboard"), []);
  const series = useAsync(() => rpc<Day[]>("admin_timeseries", { p_days: days }), [days]);
  const d = dash.data;
  const q = d?.queue;

  const tiles = q ? [
    { to: "/verifications", icon: ShieldCheck, n: q.verifications, text: "ID checks waiting" },
    { to: "/reports", icon: Flag, n: q.reports, text: "Open safety reports" },
    { to: "/support", icon: LifeBuoy, n: q.support, text: "Support messages to answer" },
    { to: "/money?tab=refunds", icon: Undo2, n: q.refunds, text: "Refunds needing attention" },
    { to: "/money?tab=payouts", icon: Banknote, n: q.payouts_failed, text: "Failed payouts (14 days)" },
    { to: "/reviews", icon: Percent, n: q.hidden_reviews, text: "Hidden reviews" },
  ] : [];

  return (
    <>
      <PageHead title="Overview" subtitle="What needs you today, and how the platform is doing." />
      {dash.error && <ErrorNote message={dash.error} />}
      {!d && dash.loading && <Loading />}
      {d && (
        <>
          <div className="card cardPad" style={{ marginBottom: 24 }}>
            <div className="cardHead"><div><h2>Needs attention</h2><p>Click a tile to open that queue.</p></div></div>
            <div className="queueGrid">
              {tiles.map(({ to, icon: Icon, n, text }) => (
                <Link key={text} to={to} className={`queueTile ${Number(n) > 0 ? "hot" : ""}`}>
                  <span className="qIcon"><Icon size={20} /></span>
                  <div><strong className="mono">{formatNumber(n)}</strong><span className="label">{text}</span></div>
                </Link>
              ))}
            </div>
            {Number(q?.payouts_processing) > 0 && <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>{q!.payouts_processing} payout(s) are on their way to banks right now.</p>}
          </div>

          <div className="metricGrid">
            <MetricCard icon={<Users size={20} />} label="Clients" value={formatNumber(d.clients)} hint={`${formatNumber(d.signups_7d)} new accounts this week`} />
            <MetricCard icon={<Palette size={20} />} label="Artists" value={formatNumber(d.artists)} hint={`${formatNumber(d.artists_listed)} visible · ${formatNumber(d.artists_unverified)} without an ID check`} />
            <MetricCard icon={<CalendarCheck size={20} />} label="Bookings today" value={formatNumber(d.bookings_today)} hint={`${formatNumber(d.bookings_total)} all time`} />
            <MetricCard icon={<Wallet size={20} />} label="Collected, last 30 days" value={formatMoney(d.collected_30d)} hint="Successful card payments" />
            <MetricCard icon={<TrendingUp size={20} />} label="Completed value, 30 days" value={formatMoney(d.booked_value_30d)} hint="Price of completed bookings" />
            <MetricCard icon={<Percent size={20} />} label="Availa fees, 30 days" value={formatMoney(d.platform_fees_30d)} hint={`${formatMoney(d.platform_fees_total)} all time`} />
            <MetricCard icon={<Users size={20} />} label="Suspended accounts" value={formatNumber(d.suspended)} />
          </div>

          <div className="card cardPad" style={{ marginBottom: 24 }}>
            <div className="cardHead">
              <div><h2>Activity</h2><p>Per day, most recent on the right.</p></div>
              <div className="rangeSwitch">
                {[14, 30, 90].map((n) => <button key={n} type="button" className={days === n ? "active" : ""} onClick={() => setDays(n)}>{n} days</button>)}
              </div>
            </div>
            {series.error && <ErrorNote message={series.error} />}
            {series.data && (
              <div className="grid2">
                <div><div className="cellMain" style={{ marginBottom: 8, fontWeight: 600 }}>New bookings</div><BarChart data={series.data.map((r) => ({ label: short(r.day), value: Number(r.bookings) }))} /></div>
                <div><div className="cellMain" style={{ marginBottom: 8, fontWeight: 600 }}>Money collected</div><LineChart data={series.data.map((r) => ({ label: short(r.day), value: Number(r.collected) }))} format={(n) => formatMoney(n).replace(".00", "")} /></div>
                <div><div className="cellMain" style={{ marginBottom: 8, fontWeight: 600 }}>Completed appointments</div><BarChart data={series.data.map((r) => ({ label: short(r.day), value: Number(r.completed) }))} /></div>
                <div><div className="cellMain" style={{ marginBottom: 8, fontWeight: 600 }}>New accounts</div><BarChart data={series.data.map((r) => ({ label: short(r.day), value: Number(r.signups) }))} /></div>
              </div>
            )}
          </div>

          <div className="grid3">
            <div className="card cardPad">
              <div className="cardHead"><h2>Bookings by status</h2></div>
              <HBars data={Object.entries(d.bookings_by_status).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: label(k), value: Number(v) }))} />
            </div>
            <div className="card cardPad">
              <div className="cardHead"><h2>Popular services</h2></div>
              {d.top_services.length ? <HBars data={d.top_services} /> : <span className="muted">No bookings yet.</span>}
            </div>
            <div className="card cardPad">
              <div className="cardHead"><h2>Artists by location</h2></div>
              {d.top_cities.length ? <HBars data={d.top_cities} /> : <span className="muted">No artists yet.</span>}
            </div>
          </div>

          <div className="card cardPad" style={{ marginTop: 24 }}>
            <div className="cardHead"><h2>Top artists</h2><p>By completed bookings</p></div>
            {d.top_artists.length === 0 ? <span className="muted">No completed bookings yet.</span> : (
              <div className="miniList">
                {d.top_artists.map((a) => (
                  <div key={a.id} className="miniRow clickable" onClick={() => openUser(a.id)}>
                    <span className="cellMain">{a.name}</span>
                    <span className="rowActions" style={{ alignItems: "center" }}><Stars value={Number(a.rating)} /><span className="muted mono">{a.value} completed</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
