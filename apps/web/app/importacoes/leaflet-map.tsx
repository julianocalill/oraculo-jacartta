"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapVessel } from "./data";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatQuantity(value: number | null) {
  if (value == null) return "";
  return `${new Intl.NumberFormat("pt-BR").format(value)}× `;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function tooltipHtml(vessel: MapVessel) {
  const meta = [
    vessel.destinations.length > 0 ? `Destino: ${escapeHtml(vessel.destinations.join(", "))}` : null,
    vessel.nextArrival ? `Chegada: ${formatDate(vessel.nextArrival)}` : null,
    `Faturas: ${escapeHtml(vessel.invoiceNumbers.join(", "))}`
  ]
    .filter(Boolean)
    .map((line) => `<span>${line}</span>`)
    .join("");

  const items =
    vessel.items.length > 0
      ? `<ul>${vessel.items
          .map((item) => `<li>${formatQuantity(item.quantity)}${escapeHtml(item.description)}</li>`)
          .join("")}</ul>`
      : "<span>Sem itens cadastrados</span>";

  return `<div class="vessel-tip"><strong>${escapeHtml(vessel.name)}</strong>${meta}<em>Itens a bordo</em>${items}</div>`;
}

export default function LeafletMap({ vessels }: { vessels: MapVessel[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // scrollWheelZoom desligado para o scroll da página não virar zoom do mapa
    const map = L.map(containerRef.current, { worldCopyJump: true, scrollWheelZoom: false }).setView(
      [5, -20],
      2
    );
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap"
    }).addTo(map);

    const positioned = vessels.filter(
      (vessel) => vessel.latitude != null && vessel.longitude != null
    );

    const points: L.LatLngExpression[] = [];
    for (const vessel of positioned) {
      const point: L.LatLngExpression = [vessel.latitude as number, vessel.longitude as number];
      points.push(point);

      const marker = L.marker(point, {
        icon: L.divIcon({
          className: "vessel-marker-wrap",
          html: `<div class="vessel-marker"><span class="vessel-marker-dot"></span><span class="vessel-marker-name">${escapeHtml(vessel.name)}</span></div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        })
      });

      // Popup (não tooltip): autoPan reposiciona o mapa para o balão caber
      // inteiro e maxHeight rola a lista quando o navio tem muitos itens —
      // nunca fica cortado pela borda do mapa.
      marker.bindPopup(tooltipHtml(vessel), {
        className: "vessel-popup",
        maxWidth: 300,
        minWidth: 240,
        maxHeight: 300,
        autoPan: true,
        autoPanPadding: [24, 24],
        closeButton: false,
        offset: [0, -6]
      });

      // Abre no hover e mantém aberto enquanto o mouse estiver no marcador ou
      // dentro do balão (para conseguir rolar a lista). Fecha ao sair de ambos.
      let closeTimer: number | undefined;
      const cancelClose = () => {
        if (closeTimer) {
          window.clearTimeout(closeTimer);
          closeTimer = undefined;
        }
      };
      const scheduleClose = () => {
        cancelClose();
        closeTimer = window.setTimeout(() => marker.closePopup(), 200);
      };

      marker.on("mouseover", () => {
        cancelClose();
        marker.openPopup();
      });
      marker.on("mouseout", scheduleClose);
      marker.on("popupopen", (event) => {
        const el = (event as unknown as { popup: L.Popup }).popup.getElement();
        el?.addEventListener("mouseenter", cancelClose);
        el?.addEventListener("mouseleave", scheduleClose);
      });

      marker.addTo(map);
    }

    if (points.length === 1) {
      map.setView(points[0], 6);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 6 });
    }

    const timer = window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, [vessels]);

  return <div ref={containerRef} className="vessel-map" />;
}
