"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import { MAP_CENTER } from "@/lib/site";

// Used when an event has no location pin yet (NEXT_PUBLIC_MAP_CENTER).
const DEFAULT_CENTER: [number, number] = [MAP_CENTER.latitude, MAP_CENTER.longitude];

export function LocationMapPicker({ latitude, longitude, onChange }: { latitude: number | null; longitude: number | null; onChange: (latitude: number, longitude: number) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Set right before a drag/click updates the position ourselves, so the
  // sync effect below knows to skip re-centering — the map is already
  // showing that spot. Only external changes (e.g. a geocoded address)
  // should pan the view.
  const isInternalUpdateRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    void (async () => {
      // Leaflet touches `window` at import time, so it must only ever load
      // in the browser — not during the server-rendered first pass.
      const [{ default: L }] = await Promise.all([
        import("leaflet"),
        import("leaflet/dist/leaflet.css"),
      ]);
      if (cancelled || !containerRef.current) return;
      // A plain L.icon (not Icon.Default) — Icon.Default._getIconUrl always
      // prepends its own auto-detected base path onto every url, even ones
      // set explicitly via mergeOptions, which broke the bundler-resolved
      // asset URLs here. Loading straight from a CDN sidesteps both issues.
      const markerIcon = L.icon({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      });

      const start: [number, number] = latitude != null && longitude != null ? [latitude, longitude] : DEFAULT_CENTER;
      const map = L.map(containerRef.current, { center: start, zoom: latitude != null && longitude != null ? 13 : MAP_CENTER.zoom });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      const marker = L.marker(start, { draggable: true, icon: markerIcon }).addTo(map);
      marker.on("dragend", () => {
        const position = marker.getLatLng();
        isInternalUpdateRef.current = true;
        onChangeRef.current(position.lat, position.lng);
      });
      map.on("click", (event) => {
        marker.setLatLng(event.latlng);
        isInternalUpdateRef.current = true;
        onChangeRef.current(event.latlng.lat, event.latlng.lng);
      });
      mapRef.current = map;
      markerRef.current = marker;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker (and view) in sync if the coordinates change from
  // outside the map — e.g. an address lookup — without re-creating the map.
  useEffect(() => {
    if (!markerRef.current || !mapRef.current || latitude == null || longitude == null) return;
    if (isInternalUpdateRef.current) { isInternalUpdateRef.current = false; return; }
    markerRef.current.setLatLng([latitude, longitude]);
    mapRef.current.setView([latitude, longitude], Math.max(mapRef.current.getZoom(), 14));
  }, [latitude, longitude]);

  return <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-xl border" />;
}
