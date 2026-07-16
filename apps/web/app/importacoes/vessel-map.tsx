"use client";

import dynamic from "next/dynamic";
import type { MapVessel } from "./data";

// Leaflet acessa window no import, então o mapa só carrega no browser.
const LeafletMap = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="vessel-map vessel-map-loading">Carregando mapa…</div>
});

export function VesselMap({ vessels }: { vessels: MapVessel[] }) {
  return <LeafletMap vessels={vessels} />;
}
