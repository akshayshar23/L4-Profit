import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, ComposedChart, Line } from "recharts";

// ─── CONSTANTS ───────────────────────────────────────────────
const INR_TO_USD_DEFAULT = 87;
const PERIODS = ["daily","weekly","monthly","bi-monthly","quarterly","yearly"];
const PERIOD_LABELS = {daily:"Daily",weekly:"Weekly",monthly:"Monthly","bi-monthly":"Bi-Monthly",quarterly:"Quarterly",yearly:"Yearly"};

const STATUS_CONFIG = {
  profitable: { label:"Profitable", color:"#34d399", bg:"rgba(52,211,153,0.08)", icon:"▲", gradient:"linear-gradient(135deg,#059669,#34d399)" },
  improving:  { label:"Can Improve", color:"#fbbf24", bg:"rgba(251,191,36,0.08)", icon:"◆", gradient:"linear-gradient(135deg,#d97706,#fbbf24)" },
  losing:     { label:"Losing Money", color:"#f87171", bg:"rgba(248,113,113,0.08)", icon:"▼", gradient:"linear-gradient(135deg,#dc2626,#f87171)" },
  turnoff:    { label:"Turn Off", color:"#ef4444", bg:"rgba(239,68,68,0.12)", icon:"✕", gradient:"linear-gradient(135deg,#991b1b,#ef4444)" },
};

function classifyUrl(adSpendUSD, mvRevenue) {
  if (adSpendUSD === 0 && mvRevenue === 0) return "improving";
  const profit = mvRevenue - adSpendUSD;
  const roi = adSpendUSD > 0 ? (profit / adSpendUSD) * 100 : (mvRevenue > 0 ? 999 : 0);
  if (roi > 40) return "profitable";
  if (roi >= 0 && roi <= 40) return "improving";
  if (roi < -40) return "turnoff";
  return "losing";
}

const fmt = (n) => {
  if (typeof n !== "number" || isNaN(n)) return "$0.00";
  return (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
};
const fmtINR = (n) => {
  if (typeof n !== "number" || isNaN(n)) return "₹0";
  return "₹" + n.toLocaleString("en-IN",{minimumFractionDigits:0,maximumFractionDigits:0});
};
const pctStr = (n) => (typeof n === "number" ? (n >= 0 ? "+" : "") + n.toFixed(1) + "%" : "0%");
const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[$₹%"',\s]/g, "").replace(/--/g, "0");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

// ─── CSV PARSERS ─────────────────────────────────────────────
function smartSplitCSVLine(line) {
  const vals = [];
  let inQuote = false, cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  vals.push(cur.trim());
  return vals;
}

function cleanCSVText(text) {
  // Remove BOM, normalize line endings, trim
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function parseMediavineCSV(text) {
  const clean = cleanCSVText(text);
  const lines = clean.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = smartSplitCSVLine(lines[0]).map(h => h.toLowerCase());
  return lines.slice(1).map(line => {
    const vals = smartSplitCSVLine(line);
    const row = {};
    headers.forEach((h,i) => row[h] = vals[i] || "");
    return row;
  }).filter(r => r.slug);
}

function parseGoogleAdsCSV(text) {
  const clean = cleanCSVText(text);
  const lines = clean.split("\n").filter(l => l.trim());
  
  // Find header line - must contain BOTH "Landing page" AND "Cost" to avoid matching the title line "Landing page report"
  let headerIdx = lines.findIndex(l => l.includes("Landing page") && l.includes("Cost") && l.includes("Clicks"));
  if (headerIdx < 0) {
    // Fallback: find line with most commas that contains "Landing page"
    headerIdx = lines.findIndex(l => l.includes("Landing page") && l.split(",").length > 5);
  }
  if (headerIdx < 0) return [];
  
  const headers = smartSplitCSVLine(lines[headerIdx]);
  const results = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("https://")) continue;
    const vals = smartSplitCSVLine(line);
    const row = {};
    headers.forEach((h,idx) => row[h] = vals[idx] || "");
    results.push(row);
  }
  return results;
}

// ─── STORAGE HOOK ────────────────────────────────────────────
function useCloudStore(key, init) {
  const [data, setData] = useState(init);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let m = true;
    (async () => {
      try { const r = await window.storage.get(key); if (m && r?.value) setData(JSON.parse(r.value)); } catch {}
      if (m) setLoading(false);
    })();
    return () => { m = false; };
  }, [key]);
  const save = useCallback(async (d) => {
    setData(d);
    try { await window.storage.set(key, JSON.stringify(d)); } catch {}
  }, [key]);
  return [data, save, loading];
}

// ─── COMPONENTS ──────────────────────────────────────────────
const Card = ({children, style}) => (
  <div style={{ background:"var(--card)", borderRadius:14, border:"1px solid var(--border)", ...style }}>{children}</div>
);

function MetricCard({ icon, label, value, sub, color, small, sovereign }) {
  return (
    <Card style={{
      padding: small ? "14px 16px" : sovereign ? "20px 24px" : "18px 22px",
      flex: sovereign ? "1.3 1 220px" : "1 1 180px",
      minWidth: small ? 140 : sovereign ? 200 : 170,
      ...(sovereign ? { border:"1px solid rgba(0,230,118,0.2)", boxShadow:"0 0 20px rgba(0,230,118,0.06)" } : {})
    }}>
      <div style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:1.1, marginBottom: sovereign ? 8 : 6, display:"flex", alignItems:"center", gap:5 }}>
        {icon && <span style={{fontSize:13}}>{icon}</span>}{label}
      </div>
      <div className={sovereign ? "ruby-glow" : undefined} style={{
        fontSize: small ? 22 : sovereign ? 34 : 28,
        fontWeight: sovereign ? 900 : 800,
        color: color||"var(--text)",
        fontFamily:"'JetBrains Mono',monospace",
        lineHeight:1.1
      }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:"var(--muted)", marginTop:5 }}>{sub}</div>}
    </Card>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_CONFIG[status];
  if (!c) return null;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:700, color:c.color, background:c.bg, border:`1px solid ${c.color}33`, whiteSpace:"nowrap", letterSpacing:0.3 }}>
      <span style={{fontSize:8}}>{c.icon}</span>{c.label}
    </span>
  );
}

function ProfitBar({ value, max }) {
  const w = max > 0 ? Math.min(Math.abs(value)/max*100,100) : 0;
  const positive = value >= 0;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, width:120 }}>
      <div style={{ flex:1, height:5, background:"var(--border)", borderRadius:3, overflow:"hidden", direction: positive ? "ltr" : "rtl" }}>
        <div style={{ width:`${w}%`, height:"100%", background: positive ? "var(--green)" : "var(--red)", borderRadius:3, transition:"width 0.5s ease" }} />
      </div>
    </div>
  );
}

function Tabs({ items, active, onChange }) {
  return (
    <div style={{ display:"flex", gap:2, background:"var(--border)", borderRadius:11, padding:3, flexWrap:"wrap" }}>
      {items.map(t => {
        const isActive = active===t.key;
        const isMars = t.key === "actions";
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            padding:"9px 18px", borderRadius:9, border:"none", cursor:"pointer", fontSize:13, fontWeight:700,
            background: isActive ? (isMars ? "linear-gradient(135deg,#FF4500,#FF6B35)" : "var(--card)") : "transparent",
            color: isActive ? (isMars ? "#fff" : "var(--text)") : (isMars ? "#FF4500" : "var(--muted)"),
            boxShadow: isActive ? (isMars ? "0 2px 12px rgba(255,69,0,0.35)" : "0 2px 8px rgba(0,0,0,0.08)") : "none",
            transition:"all 0.2s", whiteSpace:"nowrap"
          }}>{t.icon} {t.label}</button>
        );
      })}
    </div>
  );
}

function Modal({ open, onClose, title, width, children }) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"var(--card)", borderRadius:18, padding:0, width:"100%", maxWidth:width||620, maxHeight:"88vh", overflow:"hidden", border:"1px solid var(--border)", boxShadow:"0 24px 80px rgba(0,0,0,0.4)" }}>
        <div style={{ padding:"20px 24px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h3 style={{ margin:0, fontSize:17, fontWeight:800, color:"var(--text)" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"var(--border)", border:"none", width:32, height:32, borderRadius:8, fontSize:16, cursor:"pointer", color:"var(--muted)", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>
        <div style={{ padding:24, overflowY:"auto", maxHeight:"calc(88vh - 70px)" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────
export default function AdProfitDashboard() {
  const [snapshots, saveSnapshots, loading] = useCloudStore("adprofit_snapshots_v3", []);
  const [settings, saveSettings] = useCloudStore("adprofit_settings_v1", { inrToUsd: INR_TO_USD_DEFAULT });
  
  const [view, setView] = useState("dashboard");
  const [importModal, setImportModal] = useState(false);
  const [detailSlug, setDetailSlug] = useState(null);
  const [settingsModal, setSettingsModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [sortBy, setSortBy] = useState("profit");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedSnapshot, setSelectedSnapshot] = useState("latest");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [exportData, setExportData] = useState(null);
  
  // Compare / Date Range state
  const [compareFrom, setCompareFrom] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0,10);
  });
  const [compareTo, setCompareTo] = useState(new Date().toISOString().slice(0,10));
  const [compareSortBy, setCompareSortBy] = useState("profit");
  const [compareSortDir, setCompareSortDir] = useState("desc");
  const [compareFilterStatus, setCompareFilterStatus] = useState("all");
  const [compareSearch, setCompareSearch] = useState("");
  
  // Import state
  const [mvText, setMvText] = useState("");
  const [gaText, setGaText] = useState("");
  const [mvFileName, setMvFileName] = useState("");
  const [gaFileName, setGaFileName] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [importPeriod, setImportPeriod] = useState("monthly");
  const [importDate, setImportDate] = useState(new Date().toISOString().slice(0,10));
  const mvFileRef = useRef(null);
  const gaFileRef = useRef(null);

  const handleFileUpload = (file, setter, nameSetter) => {
    if (!file) return;
    nameSetter(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setter(e.target.result);
    reader.readAsText(file);
  };

  const rate = settings?.inrToUsd || INR_TO_USD_DEFAULT;

  // ─── PROCESS IMPORT ──────────────────────────────────────
  const processImport = () => {
    const mvRows = mvText.trim() ? parseMediavineCSV(mvText) : [];
    const gaRows = gaText.trim() ? parseGoogleAdsCSV(gaText) : [];

    // Build MV lookup by normalized slug
    const mvMap = {};
    mvRows.forEach(r => {
      const slug = (r.slug||"").trim().replace(/^\/|\/$/g,"");
      if (!slug) return;
      mvMap[slug] = {
        views: num(r.views),
        revenue: num(r.revenue),
        rpm: num(r.rpm),
        cpm: num(r.cpm),
        viewability: num(r.viewability),
        fillRate: num(r.fillrate || r.fillRate),
        impressionsPerPV: num(r.impressionsperpageview || r.impressionsPerPageview),
      };
    });

    // Build GA lookup by normalized slug (aggregate across campaigns)
    const gaMap = {};
    gaRows.forEach(r => {
      const lp = (r["Landing page"]||"").trim();
      const slug = lp.replace(/^https?:\/\/[^/]+/,"").replace(/^\/|\/$/g,"");
      if (!slug) return;
      if (!gaMap[slug]) gaMap[slug] = { campaigns:[], clicks:0, impressions:0, costINR:0, cpc:0, ctr:0 };
      const clicks = num(r.Clicks);
      const impr = num(r["Impr."]);
      const cost = num(r.Cost);
      const cpc = num(r["Avg. CPC"]);
      const ctr = num(r.CTR);
      const campaign = (r.Campaign||"").trim();
      gaMap[slug].clicks += clicks;
      gaMap[slug].impressions += impr;
      gaMap[slug].costINR += cost;
      if (campaign && !gaMap[slug].campaigns.includes(campaign)) gaMap[slug].campaigns.push(campaign);
    });

    // Merge all slugs
    const allSlugs = new Set([...Object.keys(mvMap), ...Object.keys(gaMap)]);
    const urls = [];
    allSlugs.forEach(slug => {
      const mv = mvMap[slug] || { views:0, revenue:0, rpm:0, cpm:0, viewability:0, fillRate:0, impressionsPerPV:0 };
      const ga = gaMap[slug] || { campaigns:[], clicks:0, impressions:0, costINR:0 };
      const costUSD = ga.costINR / rate;
      const profit = mv.revenue - costUSD;
      const roi = costUSD > 0 ? (profit / costUSD) * 100 : (mv.revenue > 0 ? 999 : 0);
      const revenuePerClick = ga.clicks > 0 ? mv.revenue / ga.clicks : 0;
      const costPerClick = ga.clicks > 0 ? costUSD / ga.clicks : 0;
      const status = classifyUrl(costUSD, mv.revenue);

      urls.push({
        slug, status, profit, roi, revenuePerClick, costPerClick,
        mv, ga: { ...ga, costUSD },
        hasAds: ga.costINR > 0,
      });
    });

    const snapshot = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      label: importLabel || `Import ${new Date().toLocaleDateString()}`,
      date: importDate,
      period: importPeriod,
      createdAt: Date.now(),
      urls,
      totals: {
        mvRevenue: urls.reduce((s,u) => s + u.mv.revenue, 0),
        gaSpendINR: urls.reduce((s,u) => s + u.ga.costINR, 0),
        gaSpendUSD: urls.reduce((s,u) => s + u.ga.costUSD, 0),
        gaClicks: urls.reduce((s,u) => s + u.ga.clicks, 0),
        gaImpressions: urls.reduce((s,u) => s + u.ga.impressions, 0),
        totalProfit: urls.reduce((s,u) => s + u.profit, 0),
        urlCount: urls.length,
        adsUrlCount: urls.filter(u => u.hasAds).length,
      }
    };

    saveSnapshots([snapshot, ...snapshots]);
    setMvText(""); setGaText(""); setImportLabel(""); setMvFileName(""); setGaFileName("");
    setImportModal(false);
    setSelectedSnapshot("latest");
  };

  // ─── ACTIVE SNAPSHOT ──────────────────────────────────────
  const activeSnapshot = useMemo(() => {
    if (!snapshots.length) return null;
    if (selectedSnapshot === "latest") return snapshots[0];
    return snapshots.find(s => s.id === selectedSnapshot) || snapshots[0];
  }, [snapshots, selectedSnapshot]);

  // ─── FILTERED/SORTED URLs ────────────────────────────────
  const processedUrls = useMemo(() => {
    if (!activeSnapshot) return [];
    let data = activeSnapshot.urls.filter(u => u.hasAds); // Only show URLs with Google Ads
    if (filterStatus !== "all") data = data.filter(u => u.status === filterStatus);
    if (filterSearch) data = data.filter(u => u.slug.toLowerCase().includes(filterSearch.toLowerCase()) || u.ga.campaigns.some(c => c.toLowerCase().includes(filterSearch.toLowerCase())));
    data.sort((a,b) => {
      let va, vb;
      switch(sortBy) {
        case "profit": va=a.profit; vb=b.profit; break;
        case "mvRevenue": va=a.mv.revenue; vb=b.mv.revenue; break;
        case "adSpend": va=a.ga.costUSD; vb=b.ga.costUSD; break;
        case "roi": va=a.roi; vb=b.roi; break;
        case "clicks": va=a.ga.clicks; vb=b.ga.clicks; break;
        case "rpc": va=a.revenuePerClick; vb=b.revenuePerClick; break;
        default: va=a.slug; vb=b.slug;
      }
      return sortDir==="desc" ? (vb > va ? 1 : -1) : (va > vb ? 1 : -1);
    });
    return data;
  }, [activeSnapshot, filterStatus, filterSearch, sortBy, sortDir]);

  const maxProfit = useMemo(() => Math.max(...processedUrls.map(u=>Math.abs(u.profit)), 1), [processedUrls]);

  // ─── MONTHLY TREND DATA (last 12 months across all snapshots) ────
  const monthlyTrend = useMemo(() => {
    if (!snapshots.length) return [];
    // Group snapshots by month (YYYY-MM)
    const monthMap = {};
    snapshots.forEach(s => {
      const month = s.date ? s.date.slice(0, 7) : null;
      if (!month) return;
      // If multiple snapshots in same month, aggregate
      if (!monthMap[month]) monthMap[month] = { mvRevenue: 0, gaSpendUSD: 0, gaSpendINR: 0, profit: 0, clicks: 0, impressions: 0, snapCount: 0, adsCount: 0, profitable: 0, losing: 0, turnoff: 0 };
      const m = monthMap[month];
      m.mvRevenue += s.totals.mvRevenue;
      m.gaSpendUSD += s.totals.gaSpendUSD;
      m.gaSpendINR += s.totals.gaSpendINR;
      m.profit += s.totals.totalProfit;
      m.clicks += s.totals.gaClicks;
      m.impressions += s.totals.gaImpressions;
      m.adsCount += s.totals.adsUrlCount;
      m.snapCount += 1;
      s.urls.filter(u => u.hasAds).forEach(u => {
        if (u.status === "profitable") m.profitable++;
        if (u.status === "losing") m.losing++;
        if (u.status === "turnoff") m.turnoff++;
      });
    });
    // Sort by month and take last 12
    return Object.entries(monthMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, d]) => {
        const roi = d.gaSpendUSD > 0 ? ((d.profit / d.gaSpendUSD) * 100) : 0;
        const [y, m] = month.split("-");
        const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        return { month, label, ...d, roi: Math.round(roi) };
      });
  }, [snapshots]);

  // ─── COMPARE: DATE RANGE AGGREGATION ─────────────────────
  const compareData = useMemo(() => {
    if (!snapshots.length) return { urls: [], totals: null, snapshotsUsed: 0, monthlyBreakdown: [] };
    
    // Filter snapshots in date range
    const filtered = snapshots.filter(s => s.date >= compareFrom && s.date <= compareTo);
    if (!filtered.length) return { urls: [], totals: null, snapshotsUsed: 0, monthlyBreakdown: [] };
    
    // Aggregate all URLs across filtered snapshots
    const urlMap = {};
    const monthMap = {};
    
    filtered.forEach(s => {
      const month = s.date.slice(0,7);
      if (!monthMap[month]) monthMap[month] = { mvRevenue:0, gaSpendUSD:0, gaSpendINR:0, profit:0, clicks:0 };
      
      s.urls.filter(u => u.hasAds).forEach(u => {
        if (!urlMap[u.slug]) urlMap[u.slug] = {
          slug: u.slug, mvRevenue:0, gaSpendUSD:0, gaSpendINR:0, gaClicks:0, gaImpressions:0,
          campaigns: new Set(), appearances:0, months: new Set(),
          monthlyData: {},
        };
        const um = urlMap[u.slug];
        um.mvRevenue += u.mv.revenue;
        um.gaSpendUSD += u.ga.costUSD;
        um.gaSpendINR += u.ga.costINR;
        um.gaClicks += u.ga.clicks;
        um.gaImpressions += u.ga.impressions;
        um.appearances += 1;
        um.months.add(month);
        u.ga.campaigns.forEach(c => um.campaigns.add(c));
        
        // Per-month data for sparkline
        if (!um.monthlyData[month]) um.monthlyData[month] = { mv:0, spend:0, profit:0 };
        um.monthlyData[month].mv += u.mv.revenue;
        um.monthlyData[month].spend += u.ga.costUSD;
        um.monthlyData[month].profit += (u.mv.revenue - u.ga.costUSD);
        
        monthMap[month].mvRevenue += u.mv.revenue;
        monthMap[month].gaSpendUSD += u.ga.costUSD;
        monthMap[month].gaSpendINR += u.ga.costINR;
        monthMap[month].profit += u.profit;
        monthMap[month].clicks += u.ga.clicks;
      });
    });
    
    // Convert to array and compute derived fields
    let urls = Object.values(urlMap).map(u => {
      const profit = u.mvRevenue - u.gaSpendUSD;
      const roi = u.gaSpendUSD > 0 ? (profit / u.gaSpendUSD) * 100 : (u.mvRevenue > 0 ? 999 : 0);
      const rpc = u.gaClicks > 0 ? u.mvRevenue / u.gaClicks : 0;
      const status = classifyUrl(u.gaSpendUSD, u.mvRevenue);
      // Determine trend from monthly data
      const months = Object.keys(u.monthlyData).sort();
      let trend = "stable";
      if (months.length >= 2) {
        const first = u.monthlyData[months[0]].profit;
        const last = u.monthlyData[months[months.length-1]].profit;
        if (last > first + 1) trend = "improving";
        else if (last < first - 1) trend = "declining";
      }
      return {
        ...u, profit, roi, rpc, status, trend,
        campaigns: [...u.campaigns],
        monthCount: u.months.size,
        months: [...u.months].sort(),
      };
    });
    
    // Apply filters
    if (compareFilterStatus !== "all") urls = urls.filter(u => u.status === compareFilterStatus);
    if (compareSearch) urls = urls.filter(u => u.slug.toLowerCase().includes(compareSearch.toLowerCase()) || u.campaigns.some(c => c.toLowerCase().includes(compareSearch.toLowerCase())));
    
    // Sort
    urls.sort((a,b) => {
      let va, vb;
      switch(compareSortBy) {
        case "profit": va=a.profit; vb=b.profit; break;
        case "mvRevenue": va=a.mvRevenue; vb=b.mvRevenue; break;
        case "adSpend": va=a.gaSpendUSD; vb=b.gaSpendUSD; break;
        case "roi": va=a.roi; vb=b.roi; break;
        case "clicks": va=a.gaClicks; vb=b.gaClicks; break;
        case "appearances": va=a.appearances; vb=b.appearances; break;
        default: va=a.slug; vb=b.slug;
      }
      return compareSortDir==="desc" ? (vb>va?1:-1) : (va>vb?1:-1);
    });
    
    // Totals
    const allUrls = Object.values(urlMap);
    const totals = {
      mvRevenue: allUrls.reduce((s,u) => s+u.mvRevenue, 0),
      gaSpendUSD: allUrls.reduce((s,u) => s+u.gaSpendUSD, 0),
      gaSpendINR: allUrls.reduce((s,u) => s+u.gaSpendINR, 0),
      profit: allUrls.reduce((s,u) => s+(u.mvRevenue-u.gaSpendUSD), 0),
      clicks: allUrls.reduce((s,u) => s+u.gaClicks, 0),
      urlCount: allUrls.length,
      profitable: allUrls.filter(u => classifyUrl(u.gaSpendUSD, u.mvRevenue)==="profitable").length,
      improving: allUrls.filter(u => classifyUrl(u.gaSpendUSD, u.mvRevenue)==="improving").length,
      losing: allUrls.filter(u => classifyUrl(u.gaSpendUSD, u.mvRevenue)==="losing").length,
      turnoff: allUrls.filter(u => classifyUrl(u.gaSpendUSD, u.mvRevenue)==="turnoff").length,
    };
    totals.roi = totals.gaSpendUSD > 0 ? (totals.profit / totals.gaSpendUSD * 100) : 0;
    
    // Monthly breakdown for chart
    const monthlyBreakdown = Object.entries(monthMap).sort((a,b)=>a[0].localeCompare(b[0])).map(([m,d]) => {
      const [y,mo] = m.split("-");
      return { month:m, label: new Date(+y,+mo-1).toLocaleDateString("en-US",{month:"short",year:"2-digit"}), ...d, roi: d.gaSpendUSD>0?((d.profit/d.gaSpendUSD)*100):0 };
    });
    
    return { urls, totals, snapshotsUsed: filtered.length, monthlyBreakdown };
  }, [snapshots, compareFrom, compareTo, compareFilterStatus, compareSearch, compareSortBy, compareSortDir]);

  // ─── STATS ───────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!activeSnapshot) return null;
    const ads = activeSnapshot.urls.filter(u => u.hasAds);
    const t = activeSnapshot.totals;
    return {
      ...t,
      profitable: ads.filter(u => u.status==="profitable").length,
      improving: ads.filter(u => u.status==="improving").length,
      losing: ads.filter(u => u.status==="losing").length,
      turnoff: ads.filter(u => u.status==="turnoff").length,
      avgROI: t.gaSpendUSD > 0 ? ((t.totalProfit / t.gaSpendUSD) * 100) : 0,
      adsCount: ads.length,
    };
  }, [activeSnapshot]);

  // ─── EXPORT ──────────────────────────────────────────────
  const exportCSV = () => {
    if (!activeSnapshot) return;
    const headers = ["Slug","Status","MV Revenue (USD)","MV Views","MV RPM","GA Spend (INR)","GA Spend (USD)","GA Clicks","GA Impressions","Campaigns","Profit (USD)","ROI %","Rev/Click"];
    const rows = processedUrls.map(u => [
      "/"+u.slug, u.status, u.mv.revenue.toFixed(2), u.mv.views, u.mv.rpm.toFixed(2),
      u.ga.costINR.toFixed(2), u.ga.costUSD.toFixed(2), u.ga.clicks, u.ga.impressions,
      u.ga.campaigns.join(" | "), u.profit.toFixed(2), u.roi.toFixed(1), u.revenuePerClick.toFixed(4)
    ]);
    const csvContent = [headers,...rows].map(r => r.map(c=>`"${c}"`).join(",")).join("\n");
    setExportData(csvContent);
  };

  // ─── THEME ───────────────────────────────────────────────
  const theme = {
    "--bg":"#08090d","--card":"#11131a","--card2":"#161926","--border":"#1c2035","--text":"#e4e6f0",
    "--muted":"#5c6489","--accent":"#6366f1","--accent2":"#818cf8","--hover":"#171b2a",
    "--green":"#34d399","--red":"#f87171","--amber":"#fbbf24","--blue":"#60a5fa",
    "--gold":"#D4A017","--gold-bright":"#F5C518","--emerald-glow":"#00E676","--ruby":"#E0115F","--mars":"#FF4500",
  };

  if (loading) {
    return (
      <div style={{...theme,background:"var(--bg)",color:"var(--text)",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',sans-serif"}}>
        <div style={{textAlign:"center"}}>
          <div style={{width:44,height:44,border:"3px solid var(--border)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 16px"}} />
          <p style={{color:"var(--muted)",fontSize:14}}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const btnP = {padding:"9px 20px",borderRadius:9,border:"none",background:"var(--accent)",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700};
  const btnS = {...btnP,background:"var(--card2)",color:"var(--text)",border:"1px solid var(--border)"};
  const btnGold = {padding:"9px 20px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#D4A017,#F5C518)",color:"#0a0a0f",cursor:"pointer",fontSize:13,fontWeight:800,letterSpacing:0.3};

  return (
    <div style={{...theme,background:"radial-gradient(ellipse at top left, #1a0a2e 0%, #08090d 35%), radial-gradient(ellipse at bottom right, #1a0a2e 0%, #08090d 35%)",backgroundBlendMode:"screen",color:"var(--text)",minHeight:"100vh",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
        @keyframes rubyPulse{0%,100%{text-shadow:0 0 8px rgba(224,17,95,0.4),0 0 20px rgba(224,17,95,0.15)}50%{text-shadow:0 0 16px rgba(224,17,95,0.7),0 0 40px rgba(224,17,95,0.3)}}
        @keyframes goldShimmer{0%,100%{box-shadow:0 0 8px rgba(245,197,24,0.3)}50%{box-shadow:0 0 18px rgba(245,197,24,0.55)}}
        .rhover:hover{background:var(--hover)!important}
        .rhover{transition:background 0.15s}
        input:focus,select:focus,textarea:focus{border-color:var(--accent)!important;outline:none;box-shadow:0 0 0 3px rgba(99,102,241,0.12)!important}
        button{transition:all 0.15s}button:hover{filter:brightness(1.15)}
        .sort-btn{padding:5px 11px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:11px;font-weight:700;transition:all 0.15s;font-family:inherit}
        .sort-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
        .sort-btn:not(.active){background:var(--card);color:var(--muted)}
        .ruby-glow{animation:rubyPulse 3s ease-in-out infinite}
        .gold-glow{animation:goldShimmer 3s ease-in-out infinite}
      `}</style>

      {/* ══ HEADER ═══════════════════════════════════════ */}
      <header style={{padding:"14px 28px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--card)",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div className="gold-glow" style={{width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#D4A017,#F5C518,#D4A017)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:"#0a0a0f",fontSize:13}}>L4</div>
          <div>
            <h1 style={{fontSize:16,fontWeight:900,letterSpacing:-0.4,lineHeight:1.2}}>Sovereign Profit Matrix</h1>
            <p style={{fontSize:11,color:"var(--muted)",fontWeight:500}}>Mediavine Revenue × Google Ads Analyzer</p>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {snapshots.length > 0 && (
            <select value={selectedSnapshot} onChange={e=>setSelectedSnapshot(e.target.value)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontSize:12,cursor:"pointer",fontFamily:"inherit",maxWidth:200}}>
              <option value="latest">Latest Snapshot</option>
              {snapshots.map(s => <option key={s.id} value={s.id}>{s.label} ({s.date})</option>)}
            </select>
          )}
          <button onClick={()=>setSettingsModal(true)} style={{...btnS,padding:"8px 14px"}}>⚙️</button>
          {activeSnapshot && <button onClick={exportCSV} style={btnS}>↓ Export</button>}
          <button onClick={()=>setImportModal(true)} style={btnGold}>+ Import Data</button>
        </div>
      </header>

      <div style={{maxWidth:1440,margin:"0 auto",padding:"22px 28px"}}>
        {/* ══ TABS ════════════════════════════════════════ */}
        <div style={{marginBottom:22}}>
          <Tabs active={view} onChange={v=>{setView(v);setDetailSlug(null)}} items={[
            {key:"dashboard",icon:"📊",label:"Dashboard"},
            {key:"analysis",icon:"🔬",label:"URL Analysis"},
            {key:"actions",icon:"⚡",label:"Action Center"},
            {key:"compare",icon:"📅",label:"Date Range"},
            {key:"history",icon:"📁",label:"Snapshots"},
          ]} />
        </div>

        {!activeSnapshot && view !== "history" ? (
          <Card style={{padding:"60px 40px",textAlign:"center"}}>
            <div style={{fontSize:48,marginBottom:16}}>📂</div>
            <h2 style={{fontSize:20,fontWeight:800,marginBottom:8}}>No Data Yet</h2>
            <p style={{color:"var(--muted)",fontSize:14,marginBottom:20,maxWidth:400,margin:"0 auto 20px"}}>
              Import your Mediavine pages CSV and Google Ads landing page report to get started.
            </p>
            <button onClick={()=>setImportModal(true)} style={{...btnGold,padding:"12px 28px",fontSize:14}}>+ Import Your First Dataset</button>
          </Card>
        ) : (
          <>
            {/* ══════════════════════════════════════════════ */}
            {/* DASHBOARD VIEW                                 */}
            {/* ══════════════════════════════════════════════ */}
            {view === "dashboard" && stats && (
              <div style={{animation:"fadeUp 0.3s ease"}}>
                {/* Top Metrics */}
                <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
                  <MetricCard icon="💚" label="MV Revenue" value={fmt(stats.mvRevenue)} sub={`From ${stats.urlCount.toLocaleString()} pages`} color="var(--green)" />
                  <MetricCard icon="📢" label="GA Spend" value={fmt(stats.gaSpendUSD)} sub={fmtINR(stats.gaSpendINR) + " INR"} color="var(--red)" />
                  <MetricCard icon="🎯" label="Net Profit" value={fmt(stats.totalProfit)} sub={`After ad spend`} color={stats.totalProfit>=0?"var(--emerald-glow)":"var(--red)"} sovereign />
                  <MetricCard icon="⚡" label="Portfolio ROI" value={pctStr(stats.avgROI)} sub={`On ${stats.adsCount} ad URLs`} color={stats.avgROI>=0?"var(--green)":"var(--red)"} />
                  <MetricCard icon="👆" label="Total Clicks" value={stats.gaClicks.toLocaleString()} sub={`${stats.gaImpressions.toLocaleString()} impressions`} color="var(--blue)" />
                </div>

                {/* Status Grid */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
                  {Object.entries(STATUS_CONFIG).map(([key,cfg]) => {
                    const count = stats[key] || 0;
                    const pctVal = stats.adsCount > 0 ? (count/stats.adsCount*100) : 0;
                    const urls = activeSnapshot.urls.filter(u=>u.hasAds&&u.status===key);
                    const spend = urls.reduce((s,u)=>s+u.ga.costUSD,0);
                    const hasJupiterGlow = key === "profitable" || key === "improving";
                    return (
                      <Card key={key} style={{
                        padding:18,cursor:"pointer",transition:"all 0.2s",transform:"scale(1)",
                        borderColor: hasJupiterGlow ? "#800080" : (filterStatus===key ? cfg.color : "var(--border)"),
                        boxShadow: hasJupiterGlow ? "0 0 12px rgba(128,0,128,0.25), inset 0 0 12px rgba(128,0,128,0.04)" : "none",
                      }} onClick={()=>{ setFilterStatus(filterStatus===key?"all":key); setView("analysis"); }}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                          <span style={{fontSize:9,fontWeight:800,color:cfg.color,textTransform:"uppercase",letterSpacing:1.2}}>{cfg.label}</span>
                          <span style={{fontSize:8,fontWeight:700,color:"var(--muted)",background:"var(--border)",padding:"2px 7px",borderRadius:10}}>{pctVal.toFixed(0)}%</span>
                        </div>
                        <div style={{fontSize:32,fontWeight:900,color:cfg.color,fontFamily:"'JetBrains Mono',monospace",lineHeight:1}}>{count}</div>
                        <div style={{fontSize:11,color:"var(--muted)",marginTop:6}}>Spend: {fmt(spend)}</div>
                        <div style={{height:3,borderRadius:2,background:`${cfg.color}15`,marginTop:10,overflow:"hidden"}}>
                          <div style={{width:`${pctVal}%`,height:"100%",background:cfg.gradient,borderRadius:2,transition:"width 0.6s ease"}} />
                        </div>
                      </Card>
                    );
                  })}
                </div>

                {/* ─── 12-MONTH PROFIT vs EXPENSE CHART ─────────── */}
                {monthlyTrend.length > 0 && (
                  <Card style={{padding:22,marginBottom:20}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                      <div>
                        <h3 style={{fontSize:15,fontWeight:800,margin:0}}>Profit vs Expense — Last 12 Months</h3>
                        <p style={{fontSize:11,color:"var(--muted)",margin:"3px 0 0"}}>Aggregated from {snapshots.length} snapshot{snapshots.length!==1?"s":""} · Hover for details</p>
                      </div>
                      <div style={{display:"flex",gap:14,fontSize:11,fontWeight:600}}>
                        <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:"#00E676"}} /> Profit</span>
                        <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:"#f87171"}} /> Ad Spend</span>
                        <span style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:"#818cf8"}} /> MV Revenue</span>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={monthlyTrend} margin={{top:5,right:10,left:0,bottom:5}}>
                        <defs>
                          <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00E676" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#00E676" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f87171" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#f87171" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1c2035" />
                        <XAxis dataKey="label" tick={{fill:"#5c6489",fontSize:11,fontWeight:600}} tickLine={false} axisLine={{stroke:"#1c2035"}} />
                        <YAxis tick={{fill:"#5c6489",fontSize:11}} tickLine={false} axisLine={{stroke:"#1c2035"}} tickFormatter={v => `$${Math.abs(v) >= 1000 ? (v/1000).toFixed(1)+"k" : v.toFixed(0)}`} />
                        <Tooltip
                          contentStyle={{background:"#161926",border:"1px solid #1c2035",borderRadius:10,fontSize:12,color:"#e4e6f0",boxShadow:"0 8px 30px rgba(0,0,0,0.4)"}}
                          labelStyle={{fontWeight:800,marginBottom:6,fontSize:13}}
                          formatter={(value, name) => {
                            const formatted = "$" + Math.abs(value).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
                            return [value < 0 ? "-"+formatted : formatted, name];
                          }}
                        />
                        <Area type="monotone" dataKey="mvRevenue" name="MV Revenue" stroke="#818cf8" fill="none" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="gaSpendUSD" name="Ad Spend" stroke="#f87171" fill="url(#spendGrad)" strokeWidth={2} dot={false} />
                        <Area type="monotone" dataKey="profit" name="Net Profit" stroke="#00E676" fill="url(#profitGrad)" strokeWidth={2.5} dot={{r:4,fill:"#00E676",stroke:"#11131a",strokeWidth:2}} activeDot={{r:6,fill:"#00E676",stroke:"#fff",strokeWidth:2}} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    {/* Monthly summary row */}
                    <div style={{display:"flex",gap:6,overflowX:"auto",marginTop:14,paddingBottom:4}}>
                      {monthlyTrend.map(m => (
                        <div key={m.month} style={{flex:"0 0 auto",minWidth:90,padding:"8px 10px",borderRadius:8,background:"var(--card2)",border:"1px solid var(--border)",textAlign:"center"}}>
                          <div style={{fontSize:10,fontWeight:700,color:"var(--muted)",marginBottom:4}}>{m.label}</div>
                          <div style={{fontSize:13,fontWeight:800,color:m.profit>=0?"var(--emerald-glow)":"var(--red)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(m.profit)}</div>
                          <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>{m.roi > 0 ? "+" : ""}{m.roi}% ROI</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Top Winners & Losers */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <Card style={{padding:20,display:"flex",flexDirection:"column"}}>
                    <h3 style={{fontSize:14,fontWeight:800,color:"var(--green)",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:2,background:"var(--green)"}} /> Top 50 Profitable Ads</span>
                      <span style={{fontSize:10,fontWeight:600,color:"var(--muted)"}}>{processedUrls.filter(u=>u.profit>0).length} total</span>
                    </h3>
                    <div style={{overflowY:"auto",maxHeight:600,flex:1}}>
                    {processedUrls.filter(u=>u.profit>0).sort((a,b)=>b.profit-a.profit).slice(0,50).map((u,i) => (
                      <div key={u.slug} onClick={()=>{setDetailSlug(u.slug);setView("analysis")}} style={{padding:"8px 0",borderBottom:"1px solid var(--border)",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",animation:`slideIn 0.3s ease ${Math.min(i*0.02,0.5)}s both`}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
                          <span style={{fontSize:10,fontWeight:700,color:"var(--muted)",minWidth:20}}>{i+1}.</span>
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>/{u.slug}</div>
                            <div style={{fontSize:10,color:"var(--muted)"}}>{u.ga.campaigns[0]||"—"}</div>
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--green)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(u.profit)}</div>
                          <div style={{fontSize:10,color:"var(--muted)"}}>{pctStr(u.roi)} ROI</div>
                        </div>
                      </div>
                    ))}
                    </div>
                    {processedUrls.filter(u=>u.profit>0).length===0 && <p style={{color:"var(--muted)",fontSize:12}}>No profitable ads yet</p>}
                  </Card>
                  <Card style={{padding:20,display:"flex",flexDirection:"column"}}>
                    <h3 style={{fontSize:14,fontWeight:800,color:"var(--red)",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:2,background:"var(--red)"}} /> Top 50 Money Losers</span>
                      <span style={{fontSize:10,fontWeight:600,color:"var(--muted)"}}>{processedUrls.filter(u=>u.profit<0).length} total</span>
                    </h3>
                    <div style={{overflowY:"auto",maxHeight:600,flex:1}}>
                    {processedUrls.filter(u=>u.profit<0).sort((a,b)=>a.profit-b.profit).slice(0,50).map((u,i) => (
                      <div key={u.slug} onClick={()=>{setDetailSlug(u.slug);setView("analysis")}} style={{padding:"8px 0",borderBottom:"1px solid var(--border)",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",animation:`slideIn 0.3s ease ${Math.min(i*0.02,0.5)}s both`}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
                          <span style={{fontSize:10,fontWeight:700,color:"var(--muted)",minWidth:20}}>{i+1}.</span>
                          <div style={{minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>/{u.slug}</div>
                            <div style={{fontSize:10,color:"var(--muted)"}}>{u.ga.campaigns[0]||"—"}</div>
                          </div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                          <div style={{fontSize:13,fontWeight:800,color:"var(--red)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(u.profit)}</div>
                          <div style={{fontSize:10,color:"var(--muted)"}}>Spent {fmt(u.ga.costUSD)}</div>
                        </div>
                      </div>
                    ))}
                    </div>
                    {processedUrls.filter(u=>u.profit<0).length===0 && <p style={{color:"var(--muted)",fontSize:12}}>No losing ads</p>}
                  </Card>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* URL ANALYSIS VIEW                              */}
            {/* ══════════════════════════════════════════════ */}
            {view === "analysis" && (
              <div style={{animation:"fadeUp 0.3s ease"}}>
                {detailSlug ? (() => {
                  const u = activeSnapshot?.urls.find(x=>x.slug===detailSlug);
                  if (!u) return <p>URL not found</p>;
                  // Find this URL across all snapshots
                  const history = snapshots.map(s => {
                    const found = s.urls.find(x=>x.slug===detailSlug);
                    return found ? { date: s.date, label: s.label, period: s.period, ...found } : null;
                  }).filter(Boolean);
                  return (
                    <div>
                      <button onClick={()=>setDetailSlug(null)} style={{...btnS,marginBottom:16,fontSize:12}}>← Back to All URLs</button>
                      <Card style={{padding:24,marginBottom:16}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                          <div>
                            <h2 style={{fontSize:18,fontWeight:900,marginBottom:4}}>/{u.slug}</h2>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                              {u.ga.campaigns.map(c => <span key={c} style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:"var(--card2)",border:"1px solid var(--border)",color:"var(--muted)",fontWeight:600}}>{c}</span>)}
                            </div>
                          </div>
                          <StatusBadge status={u.status} />
                        </div>
                        <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                          <MetricCard small label="MV Revenue" value={fmt(u.mv.revenue)} color="var(--green)" icon="💚" />
                          <MetricCard small label="Ad Spend" value={fmt(u.ga.costUSD)} sub={fmtINR(u.ga.costINR)} color="var(--red)" icon="📢" />
                          <MetricCard small label="Net Profit" value={fmt(u.profit)} color={u.profit>=0?"var(--green)":"var(--red)"} icon="🎯" />
                          <MetricCard small label="ROI" value={u.roi > 900 ? "∞" : pctStr(u.roi)} color={u.roi>=0?"var(--green)":"var(--red)"} icon="⚡" />
                          <MetricCard small label="Clicks" value={u.ga.clicks.toLocaleString()} sub={`${u.ga.impressions.toLocaleString()} impr`} icon="👆" />
                          <MetricCard small label="Rev/Click" value={fmt(u.revenuePerClick)} sub={`CPC: ${fmt(u.costPerClick)}`} icon="💲" />
                        </div>
                      </Card>
                      {/* MV Details */}
                      <Card style={{padding:20,marginBottom:16}}>
                        <h3 style={{fontSize:14,fontWeight:800,marginBottom:12,color:"var(--green)"}}>Mediavine Metrics</h3>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
                          {[["Views",u.mv.views.toLocaleString()],["RPM","$"+u.mv.rpm.toFixed(2)],["CPM","$"+u.mv.cpm.toFixed(2)],["Viewability",u.mv.viewability+"%"],["Fill Rate",u.mv.fillRate+"%"],["Impr/PV",u.mv.impressionsPerPV.toFixed(1)]].map(([l,v])=>(
                            <div key={l} style={{padding:12,background:"var(--card2)",borderRadius:8}}>
                              <div style={{fontSize:10,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.8,marginBottom:4}}>{l}</div>
                              <div style={{fontSize:16,fontWeight:800,fontFamily:"'JetBrains Mono',monospace"}}>{v}</div>
                            </div>
                          ))}
                        </div>
                      </Card>
                      {/* History across snapshots */}
                      {history.length > 1 && (
                        <>
                        <Card style={{padding:20,marginBottom:16}}>
                          <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>📈 Profit vs Expense Trend</h3>
                          <ResponsiveContainer width="100%" height={200}>
                            <ComposedChart data={history.map(h => ({
                              label: h.date ? (() => { const [y,m] = h.date.split("-"); return new Date(+y,+m-1).toLocaleDateString("en-US",{month:"short",year:"2-digit"}); })() : h.label,
                              mvRevenue: h.mv.revenue,
                              gaSpend: h.ga.costUSD,
                              profit: h.profit,
                            }))} margin={{top:5,right:10,left:0,bottom:5}}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1c2035" />
                              <XAxis dataKey="label" tick={{fill:"#5c6489",fontSize:10,fontWeight:600}} tickLine={false} axisLine={{stroke:"#1c2035"}} />
                              <YAxis tick={{fill:"#5c6489",fontSize:10}} tickLine={false} axisLine={{stroke:"#1c2035"}} tickFormatter={v=>"$"+v.toFixed(0)} />
                              <Tooltip contentStyle={{background:"#161926",border:"1px solid #1c2035",borderRadius:8,fontSize:11,color:"#e4e6f0"}} formatter={(v,n)=>["$"+Math.abs(v).toFixed(2),n]} />
                              <Bar dataKey="gaSpend" name="Ad Spend" fill="#f8717144" stroke="#f87171" strokeWidth={1} radius={[3,3,0,0]} />
                              <Bar dataKey="mvRevenue" name="MV Revenue" fill="#818cf844" stroke="#818cf8" strokeWidth={1} radius={[3,3,0,0]} />
                              <Line type="monotone" dataKey="profit" name="Net Profit" stroke="#00E676" strokeWidth={2.5} dot={{r:4,fill:"#00E676",stroke:"#11131a",strokeWidth:2}} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </Card>
                        <Card style={{padding:20}}>
                          <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>📋 History Across Snapshots</h3>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                            <thead><tr style={{borderBottom:"1px solid var(--border)"}}>
                              {["Snapshot","Date","MV Rev","GA Spend","Profit","ROI","Status"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:"var(--muted)",textTransform:"uppercase"}}>{h}</th>)}
                            </tr></thead>
                            <tbody>{history.map(h=>(
                              <tr key={h.date+h.label} style={{borderBottom:"1px solid var(--border)"}}>
                                <td style={{padding:"8px 10px",fontWeight:600}}>{h.label}</td>
                                <td style={{padding:"8px 10px",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{h.date}</td>
                                <td style={{padding:"8px 10px",color:"var(--green)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(h.mv.revenue)}</td>
                                <td style={{padding:"8px 10px",color:"var(--red)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(h.ga.costUSD)}</td>
                                <td style={{padding:"8px 10px",fontWeight:700,color:h.profit>=0?"var(--green)":"var(--red)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(h.profit)}</td>
                                <td style={{padding:"8px 10px",fontFamily:"'JetBrains Mono',monospace"}}>{h.roi>900?"∞":pctStr(h.roi)}</td>
                                <td style={{padding:"8px 10px"}}><StatusBadge status={h.status} /></td>
                              </tr>
                            ))}</tbody>
                          </table>
                        </Card>
                        </>
                      )}
                    </div>
                  );
                })() : (
                  <div>
                    {/* Filters & Sort */}
                    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                      <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{padding:"7px 12px",borderRadius:7,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                        <option value="all">All Statuses</option>
                        {Object.entries(STATUS_CONFIG).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                      </select>
                      <input value={filterSearch} onChange={e=>setFilterSearch(e.target.value)} placeholder="Search URL or campaign..." style={{padding:"7px 12px",borderRadius:7,border:"1px solid var(--border)",background:"var(--card)",color:"var(--text)",fontSize:12,flex:"1 1 180px",minWidth:140,fontFamily:"inherit"}} />
                      <span style={{fontSize:11,color:"var(--muted)",fontWeight:600}}>{processedUrls.length} ad URLs</span>
                      <div style={{marginLeft:"auto",display:"flex",gap:4}}>
                        {[["profit","Profit"],["roi","ROI"],["adSpend","Spend"],["mvRevenue","MV Rev"],["clicks","Clicks"],["rpc","Rev/Click"]].map(([k,l])=>(
                          <button key={k} className={`sort-btn ${sortBy===k?"active":""}`} onClick={()=>{if(sortBy===k)setSortDir(d=>d==="desc"?"asc":"desc");else{setSortBy(k);setSortDir("desc")}}}>{l}{sortBy===k?(sortDir==="desc"?" ↓":" ↑"):""}</button>
                        ))}
                      </div>
                    </div>
                    {/* Table */}
                    <Card style={{overflow:"hidden"}}>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead><tr style={{borderBottom:"1px solid var(--border)"}}>
                            {["URL","Campaign","MV Rev","MV Views","GA Spend","Clicks","Impr","Profit","ROI","","Status"].map(h=>(
                              <th key={h} style={{padding:"11px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.6,whiteSpace:"nowrap"}}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {processedUrls.map(u => (
                              <tr key={u.slug} className="rhover" style={{borderBottom:"1px solid var(--border)",cursor:"pointer"}} onClick={()=>setDetailSlug(u.slug)}>
                                <td style={{padding:"9px 12px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600,fontSize:12}}>/{u.slug}</td>
                                <td style={{padding:"9px 12px",fontSize:11,color:"var(--muted)",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.ga.campaigns[0]||"—"}{u.ga.campaigns.length>1?` +${u.ga.campaigns.length-1}`:""}</td>
                                <td style={{padding:"9px 12px",color:"var(--green)",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(u.mv.revenue)}</td>
                                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",color:"var(--muted)"}}>{u.mv.views.toLocaleString()}</td>
                                <td style={{padding:"9px 12px",color:"var(--red)",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(u.ga.costUSD)}</td>
                                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace"}}>{u.ga.clicks.toLocaleString()}</td>
                                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",color:"var(--muted)"}}>{u.ga.impressions.toLocaleString()}</td>
                                <td style={{padding:"9px 12px",fontWeight:800,color:u.profit>=0?"var(--green)":"var(--red)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(u.profit)}</td>
                                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{u.roi>900?"∞":pctStr(u.roi)}</td>
                                <td style={{padding:"9px 12px"}}><ProfitBar value={u.profit} max={maxProfit} /></td>
                                <td style={{padding:"9px 12px"}}><StatusBadge status={u.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {processedUrls.length===0 && <div style={{padding:40,textAlign:"center",color:"var(--muted)"}}>No URLs match your filters</div>}
                    </Card>
                  </div>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* ACTION CENTER VIEW                             */}
            {/* ══════════════════════════════════════════════ */}
            {view === "actions" && activeSnapshot && (
              <div style={{animation:"fadeUp 0.3s ease"}}>
                {/* Immediate Actions Summary */}
                <Card style={{padding:22,marginBottom:16}}>
                  <h3 style={{fontSize:16,fontWeight:900,marginBottom:6}}>⚡ Executive Summary</h3>
                  <p style={{fontSize:13,color:"var(--muted)",lineHeight:1.7,marginBottom:0}}>
                    You're running <strong style={{color:"var(--text)"}}>{stats?.adsCount} Google Ads</strong> across your pages, spending <strong style={{color:"var(--red)"}}>{fmt(stats?.gaSpendUSD)}</strong> ({fmtINR(stats?.gaSpendINR)}) to generate <strong style={{color:"var(--green)"}}>{fmt(stats?.mvRevenue)}</strong> in Mediavine revenue. Net profit: <strong style={{color:stats?.totalProfit>=0?"var(--green)":"var(--red)"}}>{fmt(stats?.totalProfit)}</strong> ({pctStr(stats?.avgROI)} ROI).
                    {" "}{stats?.turnoff > 0 && <><strong style={{color:"var(--red)"}}>{stats.turnoff} ads should be turned off immediately</strong>, saving you <strong>{fmt(activeSnapshot.urls.filter(u=>u.hasAds&&u.status==="turnoff").reduce((s,u)=>s+u.ga.costUSD,0))}</strong> in wasted spend.</>}
                  </p>
                </Card>

                {/* Action Sections */}
                {[
                  { status:"turnoff", title:"🛑 Turn Off Immediately", desc:"Deep negative ROI. These ads are burning money with minimal to no return. Pause them now.", action:"Pause Ad" },
                  { status:"losing", title:"⚠️ Losing Money — Review & Optimize", desc:"Negative ROI but potentially recoverable. Review targeting, ad copy, landing page, and bids.", action:"Review" },
                  { status:"improving", title:"🔧 Can Improve — Optimization Opportunities", desc:"Marginal performance. Small tweaks to bids, keywords, or landing pages could make these profitable.", action:"Optimize" },
                  { status:"profitable", title:"✅ Profitable — Consider Scaling", desc:"Strong ROI. Consider increasing budget 10-20% to capture more traffic. Watch for diminishing returns.", action:"Scale" },
                ].map(section => {
                  const urls = processedUrls.filter(u=>u.status===section.status).sort((a,b)=> section.status==="profitable" ? b.profit-a.profit : a.profit-b.profit);
                  if (urls.length === 0) return null;
                  const totalSpend = urls.reduce((s,u)=>s+u.ga.costUSD,0);
                  const totalProfit = urls.reduce((s,u)=>s+u.profit,0);
                  const cfg = STATUS_CONFIG[section.status];
                  const exportSection = (e) => {
                    e.stopPropagation();
                    const headers = ["Slug","Campaign","MV Revenue (USD)","MV Views","GA Spend (INR)","GA Spend (USD)","GA Clicks","GA Impressions","Profit (USD)","ROI %","Rev/Click","Status"];
                    const rows = urls.map(u => [
                      "/"+u.slug, u.ga.campaigns.join(" | "), u.mv.revenue.toFixed(2), u.mv.views,
                      u.ga.costINR.toFixed(2), u.ga.costUSD.toFixed(2), u.ga.clicks, u.ga.impressions,
                      u.profit.toFixed(2), u.roi.toFixed(1), u.revenuePerClick.toFixed(4), u.status
                    ]);
                    const csv = [headers,...rows].map(r => r.map(c=>`"${c}"`).join(",")).join("\n");
                    setExportData(csv);
                  };
                  return (
                    <Card key={section.status} style={{marginBottom:14,overflow:"hidden"}}>
                      <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",background:cfg.bg}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{flex:1}}>
                            <h3 style={{fontSize:15,fontWeight:800,color:cfg.color,marginBottom:3}}>{section.title}</h3>
                            <p style={{fontSize:12,color:"var(--muted)",margin:0}}>{section.desc}</p>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:12}}>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:11,color:"var(--muted)"}}>{urls.length} ads · Spend: {fmt(totalSpend)}</div>
                              <div style={{fontSize:14,fontWeight:800,color:cfg.color,fontFamily:"'JetBrains Mono',monospace"}}>{fmt(totalProfit)}</div>
                            </div>
                            <button onClick={exportSection} title={`Export ${cfg.label} URLs as CSV`} style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${cfg.color}33`,background:`${cfg.color}11`,color:cfg.color,cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}}>
                              ↓ CSV
                            </button>
                          </div>
                        </div>
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <tbody>
                            {urls.map(u => (
                              <tr key={u.slug} className="rhover" style={{borderBottom:"1px solid var(--border)",cursor:"pointer"}} onClick={()=>{setDetailSlug(u.slug);setView("analysis")}}>
                                <td style={{padding:"10px 16px",fontWeight:600,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>/{u.slug}</td>
                                <td style={{padding:"10px 12px",color:"var(--muted)",fontSize:11}}>{u.ga.campaigns[0]||"—"}</td>
                                <td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace"}}>
                                  <span style={{color:"var(--green)"}}>{fmt(u.mv.revenue)}</span>
                                  <span style={{color:"var(--muted)",margin:"0 4px"}}>−</span>
                                  <span style={{color:"var(--red)"}}>{fmt(u.ga.costUSD)}</span>
                                  <span style={{color:"var(--muted)",margin:"0 4px"}}>=</span>
                                  <strong style={{color:u.profit>=0?"var(--green)":"var(--red)"}}>{fmt(u.profit)}</strong>
                                </td>
                                <td style={{padding:"10px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{u.roi>900?"∞":pctStr(u.roi)}</td>
                                <td style={{padding:"10px 12px"}}>{u.ga.clicks.toLocaleString()} clicks</td>
                                <td style={{padding:"10px 12px"}}><StatusBadge status={u.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* DATE RANGE COMPARE VIEW                        */}
            {/* ══════════════════════════════════════════════ */}
            {view === "compare" && (
              <div style={{animation:"fadeUp 0.3s ease"}}>
                {/* Date Range Selector */}
                <Card style={{padding:20,marginBottom:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                    <div>
                      <label style={{display:"block",fontSize:10,fontWeight:700,color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:0.8}}>From</label>
                      <input type="date" value={compareFrom} onChange={e=>setCompareFrom(e.target.value)} style={{padding:"9px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontSize:13,fontFamily:"inherit"}} />
                    </div>
                    <div style={{fontSize:20,color:"var(--muted)",marginTop:16}}>→</div>
                    <div>
                      <label style={{display:"block",fontSize:10,fontWeight:700,color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:0.8}}>To</label>
                      <input type="date" value={compareTo} onChange={e=>setCompareTo(e.target.value)} style={{padding:"9px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontSize:13,fontFamily:"inherit"}} />
                    </div>
                    <div style={{marginTop:16,fontSize:12,color:"var(--muted)"}}>
                      {compareData.snapshotsUsed > 0
                        ? <span><strong style={{color:"var(--text)"}}>{compareData.snapshotsUsed}</strong> snapshot{compareData.snapshotsUsed!==1?"s":""} found · <strong style={{color:"var(--text)"}}>{compareData.totals?.urlCount||0}</strong> ad URLs</span>
                        : <span style={{color:"var(--amber)"}}>No snapshots in this date range</span>
                      }
                    </div>
                    {/* Quick presets */}
                    <div style={{marginLeft:"auto",display:"flex",gap:6,marginTop:16}}>
                      {[
                        {label:"Last 30d", fn:()=>{const d=new Date();const f=new Date();f.setDate(f.getDate()-30);setCompareFrom(f.toISOString().slice(0,10));setCompareTo(d.toISOString().slice(0,10))}},
                        {label:"Last 90d", fn:()=>{const d=new Date();const f=new Date();f.setDate(f.getDate()-90);setCompareFrom(f.toISOString().slice(0,10));setCompareTo(d.toISOString().slice(0,10))}},
                        {label:"Last 6m", fn:()=>{const d=new Date();const f=new Date();f.setMonth(f.getMonth()-6);setCompareFrom(f.toISOString().slice(0,10));setCompareTo(d.toISOString().slice(0,10))}},
                        {label:"Last 12m", fn:()=>{const d=new Date();const f=new Date();f.setFullYear(f.getFullYear()-1);setCompareFrom(f.toISOString().slice(0,10));setCompareTo(d.toISOString().slice(0,10))}},
                        {label:"All Time", fn:()=>{setCompareFrom("2020-01-01");setCompareTo(new Date().toISOString().slice(0,10))}},
                      ].map(p => (
                        <button key={p.label} onClick={p.fn} style={{padding:"6px 12px",borderRadius:6,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--muted)",cursor:"pointer",fontSize:11,fontWeight:700}}>{p.label}</button>
                      ))}
                    </div>
                  </div>
                </Card>

                {compareData.totals && compareData.snapshotsUsed > 0 ? (
                  <>
                    {/* Summary Metrics */}
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
                      <MetricCard icon="💚" label="Total MV Revenue" value={fmt(compareData.totals.mvRevenue)} color="var(--green)" />
                      <MetricCard icon="📢" label="Total Ad Spend" value={fmt(compareData.totals.gaSpendUSD)} sub={fmtINR(compareData.totals.gaSpendINR)} color="var(--red)" />
                      <MetricCard icon="🎯" label="Total Net Profit" value={fmt(compareData.totals.profit)} color={compareData.totals.profit>=0?"var(--emerald-glow)":"var(--red)"} sovereign />
                      <MetricCard icon="⚡" label="Period ROI" value={pctStr(compareData.totals.roi)} color={compareData.totals.roi>=0?"var(--green)":"var(--red)"} />
                      <MetricCard icon="👆" label="Total Clicks" value={compareData.totals.clicks.toLocaleString()} color="var(--blue)" />
                    </div>

                    {/* Status summary bar */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
                      {Object.entries(STATUS_CONFIG).map(([key,cfg]) => {
                        const count = compareData.totals[key]||0;
                        return (
                          <div key={key} onClick={()=>setCompareFilterStatus(compareFilterStatus===key?"all":key)} style={{padding:"12px 14px",borderRadius:10,background:cfg.bg,border:`1px solid ${compareFilterStatus===key?cfg.color:cfg.color+"22"}`,cursor:"pointer",textAlign:"center",transition:"all 0.2s"}}>
                            <div style={{fontSize:22,fontWeight:900,color:cfg.color,fontFamily:"'JetBrains Mono',monospace"}}>{count}</div>
                            <div style={{fontSize:10,fontWeight:700,color:cfg.color}}>{cfg.label}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Monthly Trend Chart */}
                    {compareData.monthlyBreakdown.length > 1 && (
                      <Card style={{padding:22,marginBottom:16}}>
                        <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>Monthly Trend — {compareFrom} to {compareTo}</h3>
                        <ResponsiveContainer width="100%" height={260}>
                          <ComposedChart data={compareData.monthlyBreakdown} margin={{top:5,right:10,left:0,bottom:5}}>
                            <defs>
                              <linearGradient id="cProfitGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#00E676" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="#00E676" stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1c2035" />
                            <XAxis dataKey="label" tick={{fill:"#5c6489",fontSize:10,fontWeight:600}} tickLine={false} axisLine={{stroke:"#1c2035"}} />
                            <YAxis tick={{fill:"#5c6489",fontSize:10}} tickLine={false} axisLine={{stroke:"#1c2035"}} tickFormatter={v=>`$${Math.abs(v)>=1000?(v/1000).toFixed(1)+"k":v.toFixed(0)}`} />
                            <Tooltip contentStyle={{background:"#161926",border:"1px solid #1c2035",borderRadius:10,fontSize:12,color:"#e4e6f0"}} formatter={(v,n)=>["$"+Math.abs(v).toFixed(2),n]} />
                            <Bar dataKey="gaSpendUSD" name="Ad Spend" fill="#f8717133" stroke="#f87171" strokeWidth={1} radius={[3,3,0,0]} />
                            <Bar dataKey="mvRevenue" name="MV Revenue" fill="#818cf833" stroke="#818cf8" strokeWidth={1} radius={[3,3,0,0]} />
                            <Area type="monotone" dataKey="profit" name="Net Profit" stroke="#00E676" fill="url(#cProfitGrad)" strokeWidth={2.5} dot={{r:4,fill:"#00E676",stroke:"#11131a",strokeWidth:2}} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Card>
                    )}

                    {/* URL Breakdown Table */}
                    <Card style={{overflow:"hidden"}}>
                      <div style={{padding:"14px 18px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                        <div>
                          <h3 style={{fontSize:14,fontWeight:800,margin:0}}>All URLs in Date Range</h3>
                          <p style={{fontSize:11,color:"var(--muted)",margin:"2px 0 0"}}>{compareData.urls.length} URLs · Click any row for detail</p>
                        </div>
                        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                          <input value={compareSearch} onChange={e=>setCompareSearch(e.target.value)} placeholder="Search URL or campaign..." style={{padding:"6px 12px",borderRadius:6,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontSize:11,fontFamily:"inherit",width:180}} />
                          {[["profit","Profit"],["roi","ROI"],["adSpend","Spend"],["mvRevenue","MV Rev"],["clicks","Clicks"],["appearances","Freq"]].map(([k,l])=>(
                            <button key={k} className={`sort-btn ${compareSortBy===k?"active":""}`} onClick={()=>{if(compareSortBy===k)setCompareSortDir(d=>d==="desc"?"asc":"desc");else{setCompareSortBy(k);setCompareSortDir("desc")}}}>{l}{compareSortBy===k?(compareSortDir==="desc"?" ↓":" ↑"):""}</button>
                          ))}
                          <button onClick={()=>{
                            const headers=["Slug","Status","Trend","Campaigns","Months Active","MV Revenue","GA Spend USD","GA Spend INR","Clicks","Impressions","Profit","ROI%"];
                            const rows=compareData.urls.map(u=>["/"+u.slug,u.status,u.trend,u.campaigns.join(" | "),u.monthCount,u.mvRevenue.toFixed(2),u.gaSpendUSD.toFixed(2),u.gaSpendINR.toFixed(2),u.gaClicks,u.gaImpressions,u.profit.toFixed(2),u.roi.toFixed(1)]);
                            setExportData([headers,...rows].map(r=>r.map(c=>`"${c}"`).join(",")).join("\n"));
                          }} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--muted)",cursor:"pointer",fontSize:11,fontWeight:700}}>↓ CSV</button>
                        </div>
                      </div>
                      <div style={{overflowX:"auto"}}>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <thead><tr style={{borderBottom:"1px solid var(--border)"}}>
                            {["URL","Campaign","Months","MV Rev","GA Spend","Clicks","Profit","ROI","Trend","Status"].map(h=>(
                              <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:0.6,whiteSpace:"nowrap"}}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {compareData.urls.map(u => (
                              <tr key={u.slug} className="rhover" style={{borderBottom:"1px solid var(--border)",cursor:"pointer"}} onClick={()=>{setDetailSlug(u.slug);setView("analysis")}}>
                                <td style={{padding:"9px 12px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>/{u.slug}</td>
                                <td style={{padding:"9px 12px",fontSize:11,color:"var(--muted)",maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.campaigns[0]||"—"}{u.campaigns.length>1?` +${u.campaigns.length-1}`:""}</td>
                                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:11,textAlign:"center"}}>{u.monthCount}</td>
                                <td style={{padding:"9px 12px",color:"var(--green)",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(u.mvRevenue)}</td>
                                <td style={{padding:"9px 12px",color:"var(--red)",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(u.gaSpendUSD)}</td>
                                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace"}}>{u.gaClicks.toLocaleString()}</td>
                                <td style={{padding:"9px 12px",fontWeight:800,color:u.profit>=0?"var(--green)":"var(--red)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(u.profit)}</td>
                                <td style={{padding:"9px 12px",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{u.roi>900?"∞":pctStr(u.roi)}</td>
                                <td style={{padding:"9px 12px"}}>
                                  <span style={{fontSize:11,fontWeight:700,color: u.trend==="improving"?"var(--green)":u.trend==="declining"?"var(--red)":"var(--muted)"}}>
                                    {u.trend==="improving"?"📈 Up":u.trend==="declining"?"📉 Down":"➡️ Flat"}
                                  </span>
                                </td>
                                <td style={{padding:"9px 12px"}}><StatusBadge status={u.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {compareData.urls.length===0 && <div style={{padding:40,textAlign:"center",color:"var(--muted)"}}>{compareData.snapshotsUsed>0?"No URLs match your filters":"No data in selected date range"}</div>}
                    </Card>
                  </>
                ) : (
                  <Card style={{padding:40,textAlign:"center"}}>
                    <div style={{fontSize:40,marginBottom:12}}>📅</div>
                    <p style={{color:"var(--muted)",fontSize:14}}>Select a date range above to aggregate and compare all snapshot data.</p>
                    <p style={{color:"var(--muted)",fontSize:12,marginTop:4}}>You have <strong style={{color:"var(--text)"}}>{snapshots.length}</strong> snapshot{snapshots.length!==1?"s":""} stored.</p>
                  </Card>
                )}
              </div>
            )}

            {/* ══════════════════════════════════════════════ */}
            {/* SNAPSHOTS / HISTORY VIEW                       */}
            {/* ══════════════════════════════════════════════ */}
            {view === "history" && (
              <div style={{animation:"fadeUp 0.3s ease"}}>
                <Card style={{padding:20,marginBottom:16}}>
                  <h3 style={{fontSize:15,fontWeight:800,marginBottom:4}}>📁 Data Snapshots</h3>
                  <p style={{fontSize:12,color:"var(--muted)",margin:0}}>Each import creates a snapshot. Compare performance across time periods.</p>
                </Card>
                {snapshots.length === 0 ? (
                  <Card style={{padding:40,textAlign:"center"}}><p style={{color:"var(--muted)"}}>No snapshots yet. Import data to create your first snapshot.</p></Card>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {snapshots.map(s => (
                      <Card key={s.id} style={{padding:18,cursor:"pointer",borderColor:selectedSnapshot===s.id?"var(--accent)":"var(--border)"}} onClick={()=>{setSelectedSnapshot(s.id);setView("dashboard")}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:14,fontWeight:700,marginBottom:3}}>{s.label}</div>
                            <div style={{fontSize:11,color:"var(--muted)"}}>{s.date} · {PERIOD_LABELS[s.period]} · {s.totals.adsUrlCount} ad URLs / {s.totals.urlCount} total</div>
                          </div>
                          <div style={{display:"flex",gap:16,alignItems:"center"}}>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>
                                <span style={{color:"var(--green)"}}>{fmt(s.totals.mvRevenue)}</span>
                                <span style={{color:"var(--muted)",margin:"0 6px"}}>−</span>
                                <span style={{color:"var(--red)"}}>{fmt(s.totals.gaSpendUSD)}</span>
                                <span style={{color:"var(--muted)",margin:"0 6px"}}>=</span>
                                <strong style={{color:s.totals.totalProfit>=0?"var(--green)":"var(--red)"}}>{fmt(s.totals.totalProfit)}</strong>
                              </div>
                            </div>
                            <button onClick={e=>{e.stopPropagation();setDeleteConfirm(s.id)}} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,color:"var(--muted)",padding:4}}>🗑️</button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ══ IMPORT MODAL ════════════════════════════════════ */}
      <Modal open={importModal} onClose={()=>setImportModal(false)} title="Import Mediavine & Google Ads Data" width={720}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
          <div>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:0.8}}>Label</label>
            <input value={importLabel} onChange={e=>setImportLabel(e.target.value)} placeholder="e.g. Feb 1-16 2026" style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit"}} />
          </div>
          <div>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:0.8}}>Date</label>
            <input type="date" value={importDate} onChange={e=>setImportDate(e.target.value)} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit"}} />
          </div>
          <div>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:"var(--muted)",marginBottom:4,textTransform:"uppercase",letterSpacing:0.8}}>Period</label>
            <select value={importPeriod} onChange={e=>setImportPeriod(e.target.value)} style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13,fontFamily:"inherit",cursor:"pointer"}}>
              {PERIODS.map(p=><option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
            </select>
          </div>
        </div>

        {/* MV File Upload */}
        <div style={{marginBottom:16}}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"var(--green)",marginBottom:6}}>💚 Mediavine Pages CSV</label>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>Export from Mediavine → Reporting → Pages. Expected headers: <code style={{background:"var(--card2)",padding:"1px 5px",borderRadius:3}}>slug, views, revenue, rpm, ...</code></div>
          <input ref={mvFileRef} type="file" accept=".csv,.txt" onChange={e=>handleFileUpload(e.target.files[0],setMvText,setMvFileName)} style={{display:"none"}} />
          <div
            onClick={()=>mvFileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--green)"}}
            onDragLeave={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--border)"}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--border)";handleFileUpload(e.dataTransfer.files[0],setMvText,setMvFileName)}}
            style={{width:"100%",padding:mvFileName?"16px 20px":"28px 20px",borderRadius:10,border:`2px dashed ${mvFileName?"var(--green)":"var(--border)"}`,background:mvFileName?"rgba(52,211,153,0.04)":"var(--bg)",cursor:"pointer",textAlign:"center",transition:"all 0.2s"}}
          >
            {mvFileName ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                <span style={{fontSize:20}}>✅</span>
                <div style={{textAlign:"left"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--green)"}}>{mvFileName}</div>
                  <div style={{fontSize:11,color:"var(--muted)"}}>File loaded · Click to replace</div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{fontSize:28,marginBottom:6}}>📄</div>
                <div style={{fontSize:13,fontWeight:600,color:"var(--text)",marginBottom:3}}>Click to upload or drag & drop</div>
                <div style={{fontSize:11,color:"var(--muted)"}}>Mediavine CSV file (.csv)</div>
              </div>
            )}
          </div>
        </div>

        {/* GA File Upload */}
        <div style={{marginBottom:16}}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"var(--red)",marginBottom:6}}>📢 Google Ads Landing Page Report CSV</label>
          <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>Export from Google Ads → Reports → Landing Page Report. Expected headers: <code style={{background:"var(--card2)",padding:"1px 5px",borderRadius:3}}>Landing page, Campaign, Clicks, Cost, ...</code></div>
          <input ref={gaFileRef} type="file" accept=".csv,.txt" onChange={e=>handleFileUpload(e.target.files[0],setGaText,setGaFileName)} style={{display:"none"}} />
          <div
            onClick={()=>gaFileRef.current?.click()}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--red)"}}
            onDragLeave={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--border)"}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--border)";handleFileUpload(e.dataTransfer.files[0],setGaText,setGaFileName)}}
            style={{width:"100%",padding:gaFileName?"16px 20px":"28px 20px",borderRadius:10,border:`2px dashed ${gaFileName?"var(--red)":"var(--border)"}`,background:gaFileName?"rgba(248,113,113,0.04)":"var(--bg)",cursor:"pointer",textAlign:"center",transition:"all 0.2s"}}
          >
            {gaFileName ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                <span style={{fontSize:20}}>✅</span>
                <div style={{textAlign:"left"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--red)"}}>{gaFileName}</div>
                  <div style={{fontSize:11,color:"var(--muted)"}}>File loaded · Click to replace</div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{fontSize:28,marginBottom:6}}>📊</div>
                <div style={{fontSize:13,fontWeight:600,color:"var(--text)",marginBottom:3}}>Click to upload or drag & drop</div>
                <div style={{fontSize:11,color:"var(--muted)"}}>Google Ads CSV file (.csv)</div>
              </div>
            )}
          </div>
        </div>

        {/* Parse Preview */}
        {(mvText || gaText) && (() => {
          const mvRows = mvText ? parseMediavineCSV(mvText) : [];
          const gaRows = gaText ? parseGoogleAdsCSV(gaText) : [];
          const mvWithRev = mvRows.filter(r => num(r.revenue) > 0);
          const totalMV = mvRows.reduce((s,r) => s + num(r.revenue), 0);
          const totalGACost = gaRows.reduce((s,r) => s + num(r.Cost), 0);
          const totalGAClicks = gaRows.reduce((s,r) => s + num(r.Clicks), 0);
          return (
            <div style={{padding:14,background:"rgba(99,102,241,0.06)",borderRadius:10,border:"1px solid rgba(99,102,241,0.15)",marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--accent)",marginBottom:8}}>📋 Parse Preview</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,fontSize:12}}>
                {mvText && (
                  <div>
                    <div style={{fontWeight:700,color:"var(--green)",marginBottom:4}}>Mediavine</div>
                    <div style={{color:"var(--text)"}}>Pages parsed: <strong>{mvRows.length.toLocaleString()}</strong></div>
                    <div style={{color:"var(--text)"}}>Pages with revenue: <strong>{mvWithRev.length}</strong></div>
                    <div style={{color:"var(--text)"}}>Total revenue: <strong style={{color:"var(--green)"}}>${totalMV.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
                  </div>
                )}
                {gaText && (
                  <div>
                    <div style={{fontWeight:700,color:"var(--red)",marginBottom:4}}>Google Ads</div>
                    <div style={{color:"var(--text)"}}>Ad rows parsed: <strong>{gaRows.length}</strong></div>
                    <div style={{color:"var(--text)"}}>Total clicks: <strong>{totalGAClicks.toLocaleString()}</strong></div>
                    <div style={{color:"var(--text)"}}>Total cost: <strong style={{color:"var(--red)"}}>₹{totalGACost.toLocaleString("en-IN",{minimumFractionDigits:2})} (${(totalGACost/rate).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})})</strong></div>
                  </div>
                )}
              </div>
              {mvRows.length === 0 && mvText && <div style={{color:"var(--red)",marginTop:6,fontSize:11}}>⚠️ Could not parse Mediavine CSV — check file format</div>}
              {gaRows.length === 0 && gaText && <div style={{color:"var(--red)",marginTop:6,fontSize:11}}>⚠️ Could not parse Google Ads CSV — check file format</div>}
            </div>
          );
        })()}

        <div style={{padding:12,background:"var(--card2)",borderRadius:8,marginBottom:16,fontSize:12,color:"var(--muted)",lineHeight:1.7}}>
          <strong>💡 How it works:</strong> URLs are matched by slug (the path after ponly.com). Google Ads costs in INR are auto-converted to USD at ₹{rate}/USD. Multiple campaigns for the same URL are aggregated. You can upload just one file or both.
        </div>

        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={()=>setImportModal(false)} style={btnS}>Cancel</button>
          <button onClick={processImport} disabled={!mvText.trim()&&!gaText.trim()} style={{...btnP,opacity:(mvText.trim()||gaText.trim())?1:0.5}}>
            Import & Analyze
          </button>
        </div>
      </Modal>

      {/* ══ SETTINGS MODAL ══════════════════════════════════ */}
      <Modal open={settingsModal} onClose={()=>setSettingsModal(false)} title="Settings" width={420}>
        <div style={{marginBottom:20}}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"var(--muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:0.8}}>INR to USD Exchange Rate</label>
          <input type="number" value={settings?.inrToUsd||87} onChange={e=>saveSettings({...settings,inrToUsd:parseFloat(e.target.value)||87})} step="0.1" style={{width:"100%",padding:"10px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:14,fontFamily:"'JetBrains Mono',monospace"}} />
          <p style={{fontSize:11,color:"var(--muted)",marginTop:6}}>Current: ₹{settings?.inrToUsd||87} = $1 USD. This affects all profit/ROI calculations.</p>
        </div>
        <div style={{borderTop:"1px solid var(--border)",paddingTop:16,marginBottom:16}}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"var(--red)",marginBottom:8,textTransform:"uppercase",letterSpacing:0.8}}>Danger Zone</label>
          <button onClick={()=>{if(window.confirm("Delete ALL snapshots? This cannot be undone.")){saveSnapshots([]);setSelectedSnapshot("latest");setSettingsModal(false)}}} style={{...btnS,color:"var(--red)",borderColor:"rgba(239,68,68,0.3)",background:"rgba(239,68,68,0.06)",width:"100%",textAlign:"center"}}>
            🗑️ Clear All Data & Snapshots
          </button>
          <p style={{fontSize:11,color:"var(--muted)",marginTop:6}}>This permanently deletes all imported snapshots from storage.</p>
        </div>
        <button onClick={()=>setSettingsModal(false)} style={btnP}>Done</button>
      </Modal>

      {/* ══ DELETE CONFIRM ═══════════════════════════════════ */}
      {deleteConfirm && (
        <div onClick={()=>setDeleteConfirm(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:14,padding:24,maxWidth:380,border:"1px solid var(--border)"}}>
            <p style={{margin:"0 0 16px",fontSize:14}}>Delete this snapshot? This cannot be undone.</p>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setDeleteConfirm(null)} style={btnS}>Cancel</button>
              <button onClick={()=>{saveSnapshots(snapshots.filter(s=>s.id!==deleteConfirm));setDeleteConfirm(null);if(selectedSnapshot===deleteConfirm)setSelectedSnapshot("latest")}} style={{...btnP,background:"#ef4444"}}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ EXPORT MODAL ════════════════════════════════════ */}
      <Modal open={!!exportData} onClose={()=>setExportData(null)} title="Export Report" width={640}>
        <p style={{fontSize:13,color:"var(--muted)",marginBottom:12}}>
          {processedUrls.length} rows exported. Copy the CSV below or use the button to copy to clipboard, then paste into a spreadsheet or save as a .csv file.
        </p>
        <textarea
          readOnly
          value={exportData||""}
          onClick={e=>e.target.select()}
          style={{width:"100%",minHeight:250,padding:12,borderRadius:8,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:11,fontFamily:"'JetBrains Mono',monospace",resize:"vertical"}}
        />
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:14}}>
          <button onClick={()=>setExportData(null)} style={btnS}>Close</button>
          <button onClick={()=>{
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(exportData||"").then(()=>alert("Copied to clipboard!")).catch(()=>{});
            } else {
              const ta = document.createElement("textarea");
              ta.value = exportData||"";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
              alert("Copied to clipboard!");
            }
          }} style={btnP}>📋 Copy to Clipboard</button>
        </div>
      </Modal>
    </div>
  );
}
