import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./style.css";

declare const __BUILD_DATE__: string;

type SerialDevice = {
  portName: string;
  portType: string;
  vid?: number;
  pid?: number;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
};

type ProbeResult = {
  portName: string;
  bytesReceived: number;
  frameFound: boolean;
  cardNumber?: number;
  rawHex: string;
  productionWeek?: number;
  productionYear?: number;
  punches: { controlCode: number; timeSeconds: number }[];
};
type ReaderStatus = { portName: string; bytesReceived: number };

function App() {
  const [devices, setDevices] = useState<SerialDevice[]>([]);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [status, setStatus] = useState("Haetaan sarjaportteja...");
  const [reading, setReading] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlistenRead: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenStopped: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenOpened: (() => void) | undefined;
    void (async () => {
      const listeners = await Promise.all([
        listen<ProbeResult>("emit250://read", (event) => {
        if (!disposed) { setResult(event.payload); setStatus(`Kortti ${event.payload.cardNumber ?? "tuntematon"} luettu.`); }
        }),
        listen<string>("emit250://error", (event) => { if (!disposed) { setReading(false); setStatus(event.payload); } }),
        listen("emit250://stopped", () => { if (!disposed) { setReading(false); setStatus("Kuuntelu lopetettu."); } }),
        listen<ReaderStatus>("emit250://status", (event) => { if (!disposed) setStatus(`Portti ${event.payload.portName} on auki · vastaanotettu ${event.payload.bytesReceived} tavua.`); }),
        listen<string>("emit250://opened", (event) => { if (!disposed) setStatus(`Portti ${event.payload} avattu · odotetaan korttia.`); }),
      ]);
      [unlistenRead, unlistenError, unlistenStopped, unlistenStatus, unlistenOpened] = listeners;
    })();
    return () => { disposed = true; unlistenRead?.(); unlistenError?.(); unlistenStopped?.(); unlistenStatus?.(); unlistenOpened?.(); void invoke("stop_emit250"); };
  }, []);

  async function refresh() {
    try {
      const found = await invoke<SerialDevice[]>("list_serial_devices");
      setDevices(found);
      setSelected((current) => current || found[0]?.portName || "");
      setStatus(found.length ? `Löytyi ${found.length} sarjaporttia.` : "Sarjaportteja ei löytynyt.");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function startListening() {
    if (!selected) return;
    setReading(true);
    setResult(null);
    setStatus("Avataan porttia…");
    try {
      await invoke("start_emit250", { portName: selected });
      setStatus(`Portti ${selected} avattu · odotetaan korttia.`);
    } catch (error) {
      setReading(false);
      setStatus(String(error));
    }
  }

  async function stopListening() {
    await invoke("stop_emit250");
    setReading(false);
    setStatus("Kuuntelu lopetettu.");
  }

  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!reading) return;
    let disposed = false;
    const poll = async () => {
      try {
        const latest = await invoke<ProbeResult | null>("latest_emit250_read");
        if (!disposed && latest) {
          setResult(latest);
          setStatus(`Kortti ${latest.cardNumber ?? "tuntematon"} luettu.`);
        }
      } catch (error) {
        if (!disposed) setStatus(String(error));
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 250);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [reading]);

  return (
    <main>
      <h1>EMIT 250 – Tauri PoC</h1>
      <p className="lead">Testi käyttää Rustin natiivia sarjaporttia, ei WebSerialia.</p>
      <p className="build-version">Build: {new Date(__BUILD_DATE__).toLocaleString("fi-FI")}</p>

      <section>
        <div className="toolbar">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Valitse sarjaportti</option>
            {devices.map((device) => (
              <option key={device.portName} value={device.portName}>
                {device.portName} – {device.product || device.manufacturer || device.portType}
              </option>
            ))}
          </select>
          <input className="port-input" value={selected} onChange={(e) => setSelected(e.target.value)} placeholder="Tai syötä porttipolku, esim. /dev/ttys000" aria-label="Sarjaportin polku" />
          <button onClick={() => void refresh()} disabled={reading}>Päivitä</button>
          <button className="primary" onClick={() => void startListening()} disabled={!selected || reading}>
            Käynnistä kuuntelu
          </button>
          <button onClick={() => void stopListening()} disabled={!reading}>Lopeta kuuntelu</button>
        </div>
        <p className="status">{status}</p>
      </section>

      <section>
        <h2>Löydetyt portit</h2>
        {devices.map((device) => (
          <div className="device" key={device.portName}>
            <strong>{device.portName}</strong>
            <span>{device.product || "Tuntematon laite"}</span>
            <code>{device.vid != null ? `VID ${device.vid.toString(16).padStart(4, "0")} / PID ${device.pid?.toString(16).padStart(4, "0")}` : device.portType}</code>
          </div>
        ))}
      </section>

      {result && (
        <section>
          <h2>Lukutulos</h2>
          <dl>
            <dt>Portti</dt><dd>{result.portName}</dd>
            <dt>Tavuja</dt><dd>{result.bytesReceived}</dd>
            <dt>Mahdollinen EMIT-kehys</dt><dd>{result.frameFound ? "Kyllä" : "Ei"}</dd>
            <dt>Kortin numero</dt><dd>{result.cardNumber ?? "–"}</dd>
            <dt>Rastileimoja</dt><dd>{result.punches.length}</dd>
          </dl>
          {result.punches.length > 0 && <p>Rastit: {result.punches.map((punch) => `${punch.controlCode} (${punch.timeSeconds} s)`).join(" → ")}</p>}
          <details><summary>Raakadata</summary><pre>{result.rawHex || "Ei dataa"}</pre></details>
        </section>
      )}
    </main>
  );
}

// Tauri event listeners are asynchronous; StrictMode's development-only
// double effect invocation can leave the first listener set in a race.
createRoot(document.getElementById("root")!).render(<App />);
