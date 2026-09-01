import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./style.css";

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
};

function App() {
  const [devices, setDevices] = useState<SerialDevice[]>([]);
  const [selected, setSelected] = useState("");
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [status, setStatus] = useState("Haetaan sarjaportteja...");
  const [reading, setReading] = useState(false);

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

  async function probe() {
    if (!selected) return;
    setReading(true);
    setResult(null);
    setStatus("Aseta EMIT-kortti lukijaan. Kuunnellaan 15 sekuntia...");
    try {
      const value = await invoke<ProbeResult>("probe_emit250", { portName: selected, seconds: 15 });
      setResult(value);
      setStatus(value.frameFound ? "EMIT 250 -kehys löytyi." : "EMIT 250 -kehystä ei löytynyt.");
    } catch (error) {
      setStatus(String(error));
    } finally {
      setReading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <main>
      <h1>EMIT 250 – Tauri PoC</h1>
      <p className="lead">Testi käyttää Rustin natiivia sarjaporttia, ei WebSerialia.</p>

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
          <button onClick={() => void refresh()} disabled={reading}>Päivitä</button>
          <button className="primary" onClick={() => void probe()} disabled={!selected || reading}>
            {reading ? "Luetaan…" : "Testaa EMIT 250"}
          </button>
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
            <dt>EMIT-kehys</dt><dd>{result.frameFound ? "Kyllä" : "Ei"}</dd>
            <dt>Kortin numero</dt><dd>{result.cardNumber ?? "–"}</dd>
          </dl>
          <details><summary>Raakadata</summary><pre>{result.rawHex || "Ei dataa"}</pre></details>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
