import { AppShell } from "./components/app-shell";

// Skeleton global: aparece instantaneamente ao navegar entre páginas
// (todas são force-dynamic), mantendo a sidebar sólida e o conteúdo em shimmer.
export default function Loading() {
  return (
    <AppShell>
      <header className="topbar">
        <div>
          <div className="skeleton" style={{ width: 260, height: 32 }} />
          <div className="skeleton" style={{ width: 380, height: 14, marginTop: 10 }} />
        </div>
      </header>

      <section className="metric-grid metric-grid-eight">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="metric" key={i}>
            <div className="skeleton" style={{ width: "60%", height: 10 }} />
            <div className="skeleton" style={{ width: "80%", height: 26 }} />
            <div className="skeleton" style={{ width: "70%", height: 10 }} />
          </div>
        ))}
      </section>

      <section className="panel" style={{ padding: 18 }}>
        <div className="skeleton" style={{ width: 220, height: 18, marginBottom: 14 }} />
        <div className="skeleton" style={{ width: "100%", height: 180 }} />
      </section>
    </AppShell>
  );
}
