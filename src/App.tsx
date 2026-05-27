import { Building2, MessageSquare, Phone, Radio, Save, Send, Settings, Sparkles, UserCircle2, Smartphone, Search, HelpCircle, CheckCircle, RefreshCw, Archive } from "lucide-react";
import { Device as TwilioDevice } from "@twilio/voice-sdk";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, getRedirectResult, User } from "firebase/auth";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { firebaseAuth, googleProvider } from "./firebase";

type Section = "conversations" | "calls" | "contacts" | "messages" | "scripts" | "evaluations" | "providers" | "settings";
type ProviderId = "twilio" | "whatsapp" | "telegram";
type CallStatus = "idle" | "ready" | "ringing" | "in-call" | "ended" | "error";
type CrmContact = { id: string; name?: string; email?: string; phone?: string; account?: string; company?: string; collection?: string };
type InboxConversation = { id: string; customerKey: string; status: string; assignedTo: string; lastChannel: string; events: Array<{ id: string; text: string; direction: string; channel: string }> };
type ScriptDraft = { opening: string; discovery: string; objectionHandling: string; closing: string; nextSteps: string };
type ProviderConfig = {
  enabled?: boolean;
  model?: string;
  accountSid?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  twimlAppSid?: string;
  phoneNumber?: string;
  webhookAuthToken?: string;
  crmBridgeUrl?: string;
  bridgeToken?: string;
  organizationId?: string;
  allowedOrigins?: string;
  provider?: string;
  from?: string;
  botToken?: string;
  defaultChatId?: string;
  apiKey?: string;
  voice?: string;
  [key: string]: unknown;
};

type AppSettings = {
  company: string;
  activeProvider: string;
  providers: Record<string, ProviderConfig>;
  [key: string]: unknown;
};

const defaultSettings: AppSettings = {
  company: "ROKA",
  activeProvider: "openai",
  providers: {
    twilio: {
      model: "voice-central",
      callerName: "ROKA Agente",
      crmBridgeUrl: "https://agencycrmbridge-uqt2333mca-uc.a.run.app",
      organizationId: "roka-crm-c437f",
      allowedOrigins: "https://roka-telemarketing.web.app",
    } as any,
    whatsapp: { model: "messaging", provider: "twilio", from: "" },
    telegram: { model: "messaging", botToken: "", defaultChatId: "" },
    openai: { model: "gpt-realtime", apiKey: "" },
    gemini: { model: "gemini-live-2.5-flash-preview", apiKey: "" },
    elevenlabs: { model: "eleven_turbo_v2_5", apiKey: "", voice: "" },
  },
};

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text || "{}"); } catch { return { raw: text }; }
}
const BUILD_STAMP = "build-2026-05-27-13:55";

export default function App() {
  const [section, setSection] = useState<Section>("conversations");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CrmContact | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [inboxItems, setInboxItems] = useState<InboxConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState("");
  const [agentFilter, setAgentFilter] = useState("roka-agent-1");
  const [replyText, setReplyText] = useState("");
  const [wrapOutcome, setWrapOutcome] = useState("");
  const [wrapReason, setWrapReason] = useState("");
  const [wrapNotes, setWrapNotes] = useState("");
  const [dialNumber, setDialNumber] = useState("");
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [waTo, setWaTo] = useState("");
  const [waText, setWaText] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgText, setTgText] = useState("");
  const [scriptDraft, setScriptDraft] = useState<ScriptDraft>({ opening: "", discovery: "", objectionHandling: "", closing: "", nextSteps: "" });
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [powerDialerQueue, setPowerDialerQueue] = useState<CrmContact[]>([]);
  const [powerDialerIndex, setPowerDialerIndex] = useState(0);
  const [callMethod, setCallMethod] = useState<"twilio" | "personal">("twilio");
  const twilioDeviceRef = useRef<TwilioDevice | null>(null);
  const twilioCallSidRef = useRef("");

  const selectedConversation = useMemo(() => inboxItems.find((item) => item.id === selectedConvId) || null, [inboxItems, selectedConvId]);
  const filteredInboxItems = useMemo(() => {
    if (!agentFilter.trim()) return inboxItems;
    return inboxItems.filter((item) => String(item.assignedTo || "").toLowerCase().includes(agentFilter.toLowerCase()));
  }, [inboxItems, agentFilter]);
  const activeDialerContact = powerDialerQueue[powerDialerIndex] || null;

  async function runAction<T>(key: string, action: () => Promise<T>) {
    setPending((p) => ({ ...p, [key]: true }));
    try {
      return await action();
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }

  useEffect(() => {
    void boot();
    const unsub = onAuthStateChanged(firebaseAuth, (user) => setAuthUser(user));
    getRedirectResult(firebaseAuth).then((result) => {
      if (result?.user) void connectFirebaseSession(result.user);
    }).catch(() => undefined);
    return () => unsub();
  }, []);

  async function boot() {
    await Promise.all([loadConfig(), loadInbox(), loadContacts("")]);
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    const data = await readJson(res);
    if (!res.ok) return;
    const remoteConfig = (data?.config && typeof data.config === "object") ? data.config : data;
    setSettings((prev) => ({
      ...prev,
      ...(remoteConfig || {}),
      providers: {
        ...prev.providers,
        ...((remoteConfig?.providers || {}) as Record<string, ProviderConfig>),
        twilio: {
          ...(prev.providers.twilio || {}),
          ...((remoteConfig?.providers?.twilio || {}) as ProviderConfig),
        },
        whatsapp: {
          ...(prev.providers.whatsapp || {}),
          ...((remoteConfig?.providers?.whatsapp || {}) as ProviderConfig),
        },
        telegram: {
          ...(prev.providers.telegram || {}),
          ...((remoteConfig?.providers?.telegram || {}) as ProviderConfig),
        },
      },
    }));
  }

  async function saveConfig() {
    const res = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    const data = await readJson(res);
    setNotice(res.ok ? "Configuración guardada." : (data.error || "No se pudo guardar configuración."));
  }

  async function connectFirebaseSession(user: User) {
    const token = await user.getIdToken();
    await fetch("/api/auth/firebase/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  }

  async function signInGoogle() {
    setAuthBusy(true);
    setNotice("");
    try {
      googleProvider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      if (result.user) await connectFirebaseSession(result.user);
      setNotice("Sesión Google conectada.");
    } catch {
      try {
        await signInWithRedirect(firebaseAuth, googleProvider);
      } catch (error: any) {
        setNotice(error?.message || "No se pudo iniciar sesión con Google.");
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutGoogle() {
    await signOut(firebaseAuth);
    await fetch("/api/auth/firebase/session", { method: "DELETE" });
    setNotice("Sesión cerrada.");
  }

  async function loadContacts(query: string) {
    const trimmed = query.trim();
    const endpoint = trimmed ? "/api/crm/search-customer" : "/api/crm/contacts";
    const body = trimmed ? { query: trimmed, limitPerCollection: 25 } : { limit: 120, query: "" };
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await readJson(res);
    if (!res.ok) {
      setNotice(data.error || "No se pudo cargar CRM.");
      setContacts([]);
      return;
    }
    const list = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.results)
        ? data.results
        : [];
    setContacts(list);
    if (list.length > 0 && powerDialerQueue.length === 0) {
      setPowerDialerQueue(list.slice(0, 50));
      setPowerDialerIndex(0);
    }
  }

  async function loadInbox() {
    const res = await fetch("/api/inbox/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 80 }) });
    const data = await readJson(res);
    if (res.ok) {
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        await fetch("/api/dev/seed-inbox", { method: "POST" });
        const second = await fetch("/api/inbox/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 80 }) });
        const secondData = await readJson(second);
        setInboxItems(Array.isArray(secondData.items) ? secondData.items : []);
        return;
      }
      setInboxItems(items);
    }
  }

  async function assignConversation(id: string) {
    await fetch("/api/inbox/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, assignedTo: "roka-agent-1" }) });
    await loadInbox();
  }

  async function sendReply() {
    if (!selectedConversation || !replyText.trim()) return;
    const channel = selectedConversation.lastChannel || "whatsapp";
    const res = await fetch(`/api/inbox/${selectedConversation.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, direction: "outbound", text: replyText }),
    });
    const data = await readJson(res);
    if (!res.ok) setNotice(data.error || "No se pudo enviar.");
    setReplyText("");
    await loadInbox();
  }

  async function wrapUpConversation() {
    if (!selectedConversation) return;
    const res = await fetch(`/api/inbox/${selectedConversation.id}/wrapup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: wrapOutcome, reason: wrapReason, notes: wrapNotes }),
    });
    const data = await readJson(res);
    setNotice(res.ok ? "Interacción cerrada." : (data.error || "No se pudo cerrar."));
    await loadInbox();
  }

  async function connectTwilioDevice() {
    if (twilioDeviceRef.current) return;
    const tokenRes = await fetch("/api/telephony/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: "roka-agent-1" }) });
    const tokenData = await readJson(tokenRes);
    if (!tokenRes.ok || !tokenData.token) {
      setCallStatus("error");
      setNotice(tokenData.error || "Twilio no está configurado.");
      return;
    }
    const device = new TwilioDevice(tokenData.token, { logLevel: 1 });
    device.on("registered", () => setCallStatus("ready"));
    device.on("incoming", async (call) => {
      setCallStatus("ringing");
      const from = String(call.parameters?.From || "");
      setDialNumber(from);
      await call.accept();
      setCallStatus("in-call");
    });
    device.on("error", (error) => { setCallStatus("error"); setNotice(error.message || "Error Twilio."); });
    await device.register();
    twilioDeviceRef.current = device;
  }

  async function searchCustomer() {
    const query = customerSearchQuery.trim() || dialNumber.trim();
    if (!query) return;
    const res = await fetch("/api/crm/search-customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    const data = await readJson(res);
    if (!res.ok) { setNotice(data.error || "No se pudo buscar cliente."); return; }
    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length === 0) {
      setNotice("No se encontraron clientes.");
      return;
    }
    setContacts(results);
    setSelectedCustomer(results[0]);
    setDialNumber(String(results[0].phone || ""));
    setNotice(`Se encontraron ${results.length} clientes. Revisa Contactos para elegir.`);
  }

  async function startOutboundCall() {
    const to = dialNumber.trim();
    if (!to) return;
    const res = await fetch("/api/telephony/call/outbound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        customerRef: {
          phone: to,
          crmEntityType: "contact",
          crmEntityId: selectedCustomer?.id || "",
        },
      }),
    });
    const data = await readJson(res);
    if (!res.ok) { setCallStatus("error"); setNotice(data.error || "No se pudo llamar."); return; }
    twilioCallSidRef.current = String(data.callSid || "");
    setCallStatus("in-call");
  }

  async function hangupCall() {
    const callSid = twilioCallSidRef.current;
    if (!callSid) return;
    await fetch("/api/telephony/call/hangup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callSid }) });
    setCallStatus("ended");
    twilioCallSidRef.current = "";
  }

  async function startPersonalPhoneLinkCall() {
    const to = dialNumber.trim();
    if (!to) {
      setNotice("Captura un número para usar tu línea personal.");
      return;
    }
    const safe = encodeURIComponent(to);
    window.open(`tel:${safe}`, "_self");
    await fetch("/api/telephony/personal-line/attempt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        provider: "microsoft-phone-link",
        note: "Intento de llamada desde línea personal (Phone Link / marcador del sistema).",
        customerRef: {
          phone: to,
          crmEntityType: "contact",
          crmEntityId: selectedCustomer?.id || "",
        },
      }),
    });
    setNotice("Se abrió marcador externo. Registra resultado en wrap-up.");
  }

  async function sendWhatsApp() {
    const res = await fetch("/api/messages/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: waTo,
        text: waText,
        customerRef: { phone: waTo, crmEntityType: "contact", crmEntityId: selectedCustomer?.id || "" },
      }),
    });
    const data = await readJson(res);
    setNotice(res.ok ? "WhatsApp enviado." : (data.error || "No se pudo enviar WhatsApp."));
  }

  async function sendTelegram() {
    const res = await fetch("/api/messages/telegram/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: tgChatId,
        text: tgText,
        customerRef: { chatId: tgChatId, crmEntityType: "contact", crmEntityId: selectedCustomer?.id || "" },
      }),
    });
    const data = await readJson(res);
    setNotice(res.ok ? "Telegram enviado." : (data.error || "No se pudo enviar Telegram."));
  }

  async function generateScript() {
    const res = await fetch("/api/script/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: selectedCustomer || { phone: dialNumber },
        manualNotes: wrapNotes,
      }),
    });
    const data = await readJson(res);
    if (!res.ok) { setNotice(data.error || "No se pudo generar guion."); return; }
    setScriptDraft({
      opening: data.script?.opening || "",
      discovery: data.script?.discovery || "",
      objectionHandling: data.script?.objectionHandling || "",
      closing: data.script?.closing || "",
      nextSteps: data.script?.nextSteps || "",
    });
  }

  async function loadDialerQueue() {
    const q = customerSearchQuery || contactQuery || "";
    const endpoint = q.trim() ? "/api/crm/search-customer" : "/api/crm/contacts";
    const body = q.trim() ? { query: q.trim(), limitPerCollection: 100 } : { limit: 100, query: "" };
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await readJson(res);
    if (!res.ok) {
      setNotice(data.error || "No se pudo cargar cola de marcación.");
      return;
    }
    const list = Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : [];
    setContacts(list);
    if (list.length > 0) {
      setPowerDialerQueue(list.slice(0, 50));
      setPowerDialerIndex(0);
      setSelectedCustomer(list[0]);
      setDialNumber(String(list[0].phone || ""));
    }
  }

  function dialerNext() {
    if (powerDialerQueue.length === 0) return;
    const next = Math.min(powerDialerIndex + 1, powerDialerQueue.length - 1);
    setPowerDialerIndex(next);
    const row = powerDialerQueue[next];
    setSelectedCustomer(row);
    setDialNumber(String(row.phone || ""));
  }

  return (
    <main className="product-shell">
      <aside className="rail">
        <div className="brand"><div className="brand-icon">R</div><div><strong>ROKA</strong><span>Telemarketing Center</span></div></div>
        <nav>
          {([
            ["conversations", MessageSquare, "Conversaciones"],
            ["calls", Phone, "Telefonía"],
            ["contacts", UserCircle2, "Contactos"],
            ["messages", Send, "Mensajería"],
            ["scripts", Sparkles, "Guiones IA"],
            ["evaluations", Building2, "Evaluaciones"],
            ["providers", Settings, "Canales"],
            ["settings", Settings, "Configuración"],
          ] as Array<[Section, ComponentType<{ size?: number }>, string]>).map(([id, Icon, label]) => (
            <button key={id} className={section === id ? "rail-link active" : "rail-link"} type="button" onClick={() => setSection(id as Section)}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-status">
          <span className="dot ok" />
          <div>
            <strong>Backend activo</strong>
            <span>Telemarketing omnicanal</span>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="app-header">
          <h1>ROKA <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{BUILD_STAMP}</span></h1>
          <div className="header-actions">
            {!authUser ? <button className="secondary-action" onClick={() => void runAction("google-login", signInGoogle)} disabled={authBusy || pending["google-login"]}>{pending["google-login"] ? "Conectando..." : "Entrar con Google"}</button> : <button className="secondary-action" onClick={() => void runAction("google-logout", signOutGoogle)}>{pending["google-logout"] ? "Saliendo..." : `Salir (${authUser.email})`}</button>}
            <button className="primary-action" onClick={() => void runAction("save-config", saveConfig)} disabled={pending["save-config"]}><Save size={16} />{pending["save-config"] ? "Guardando..." : "Guardar"}</button>
          </div>
        </header>

        {notice && <div className="notice">{notice}</div>}

        {section === "contacts" && (
          <section className="ops-panel wide">
            <div className="panel-title"><div><p>CRM</p><h2>Contactos y leads</h2></div><button className="secondary-action" onClick={() => void loadContacts(contactQuery)}>Buscar</button></div>
            <div className="form-grid"><label>Buscar por nombre, empresa, email o teléfono<input value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} /></label></div>
            <div className="data-table">
              {contacts.map((item) => <article key={item.id} style={{ cursor: "pointer" }} onClick={() => { setSelectedCustomer(item); setDialNumber(item.phone || ""); setSection("calls"); }}><UserCircle2 size={16} /><div><strong>{item.name || "Sin nombre"}</strong><span>{item.account || item.company || item.email || item.phone || item.id}</span></div><span className="pill">{item.collection || "crm"}</span></article>)}
            </div>
          </section>
        )}

        {section === "calls" && (
          <div className="ops-grid">
            <section className="ops-panel">
              <div className="panel-title">
                <div>
                  <p>Telefonía Integrada</p>
                  <h2>Llamadas & Dialer</h2>
                </div>
                <button 
                  className="secondary-action" 
                  onClick={() => void runAction("dialer-queue", loadDialerQueue)} 
                  disabled={pending["dialer-queue"]}
                >
                  {pending["dialer-queue"] ? "Cargando..." : "Cargar cola CRM"}
                </button>
              </div>

              {/* Dialer Mode Selector */}
              <div className="dialer-mode-selector">
                <div 
                  className={`dialer-mode-card ${callMethod === "twilio" ? "active" : ""}`}
                  onClick={() => setCallMethod("twilio")}
                >
                  <Building2 size={24} />
                  <strong>Línea Corporativa</strong>
                  <span>Llamada vía Twilio (Cloud)</span>
                </div>
                <div 
                  className={`dialer-mode-card ${callMethod === "personal" ? "active" : ""}`}
                  onClick={() => setCallMethod("personal")}
                >
                  <Smartphone size={24} />
                  <strong>Línea Personal</strong>
                  <span>Enlace Móvil (Windows)</span>
                </div>
              </div>

              <div className="unified-call-container">
                <div className="form-grid compact">
                  <div className="dialer-input-wrapper">
                    <label>Buscar cliente (CRM)</label>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input 
                        value={customerSearchQuery} 
                        onChange={(e) => setCustomerSearchQuery(e.target.value)} 
                        placeholder="Nombre, email o tel..." 
                        style={{ flex: 1 }}
                      />
                      <button 
                        className="secondary-action" 
                        onClick={() => void runAction("customer-search-calls", searchCustomer)} 
                        disabled={pending["customer-search-calls"]}
                        style={{ minHeight: "38px" }}
                      >
                        <Search size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="dialer-input-wrapper">
                    <label>Número de Destino</label>
                    <div className="unified-phone-input-group">
                      <Phone className="prefix-icon" size={18} />
                      <input 
                        value={dialNumber} 
                        onChange={(e) => setDialNumber(e.target.value)} 
                        placeholder="+52..." 
                      />
                    </div>
                  </div>
                </div>

                {callMethod === "twilio" ? (
                  <div className="info-alert-box info">
                    <CheckCircle size={16} />
                    <div>
                      <strong>Twilio Voice Channel</strong>
                      <p>Llamadas salientes directas desde el navegador. Requiere conexión al servicio corporativo de Twilio.</p>
                      <button 
                        className="secondary-action" 
                        onClick={() => void runAction("twilio-connect", connectTwilioDevice)} 
                        disabled={pending["twilio-connect"]}
                        style={{ marginTop: "10px", fontSize: "0.75rem", padding: "4px 10px", minHeight: "28px" }}
                      >
                        {pending["twilio-connect"] ? "Conectando..." : "Conectar Twilio"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="info-alert-box warn">
                    <Smartphone size={16} />
                    <div>
                      <strong>Enlace Móvil Windows (Línea Personal)</strong>
                      <p>Esta opción abrirá el marcador nativo de tu sistema usando la conexión de tu teléfono (Microsoft Phone Link). Las llamadas se registrarán automáticamente en el CRM.</p>
                    </div>
                  </div>
                )}

                {activeDialerContact && (
                  <div className="info-alert-box info" style={{ borderLeft: "4px solid var(--brand)", background: "rgba(255,255,255,0.01)", marginTop: "12px" }}>
                    <div>
                      <strong>Contacto en Marcación Automática</strong>
                      <p style={{ fontSize: "0.9rem", color: "var(--text-2)", fontWeight: "600", marginTop: "4px" }}>
                        {activeDialerContact?.name || "N/D"}
                      </p>
                      <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                        Empresa: {activeDialerContact?.company || activeDialerContact?.account || "No especificada"} · Cola: {powerDialerIndex + 1}/{Math.max(powerDialerQueue.length, 1)}
                      </span>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0" }}>
                  <div className="dialer-status-badge idle">
                    Estado: <strong style={{ marginLeft: "4px", color: callStatus === "in-call" ? "var(--brand)" : "inherit" }}>{callStatus.toUpperCase()}</strong>
                  </div>
                  <span className={`call-provider-badge ${callMethod === "twilio" ? "twilio" : "personal"}`}>
                    Canal: {callMethod === "twilio" ? "Twilio" : "Celular"}
                  </span>
                </div>

                <div className="control-flow-actions">
                  {callMethod === "twilio" ? (
                    <div className="control-flow-actions-row">
                      <button 
                        className="dialer-btn dial" 
                        onClick={() => void runAction("call-outbound", startOutboundCall)} 
                        disabled={pending["call-outbound"] || callStatus === "in-call"}
                      >
                        <Phone size={16} />
                        {pending["call-outbound"] ? "Llamando..." : "Llamar Twilio"}
                      </button>
                      <button 
                        className="dialer-btn hangup" 
                        onClick={() => void runAction("call-hangup", hangupCall)} 
                        disabled={pending["call-hangup"] || callStatus !== "in-call"}
                      >
                        <Phone size={16} style={{ transform: "rotate(135deg)" }} />
                        {pending["call-hangup"] ? "Colgando..." : "Colgar"}
                      </button>
                    </div>
                  ) : (
                    <button 
                      className="dialer-btn dial" 
                      onClick={() => void runAction("call-personal", startPersonalPhoneLinkCall)} 
                      disabled={pending["call-personal"]}
                    >
                      <Smartphone size={16} />
                      {pending["call-personal"] ? "Abriendo Marcador..." : "Llamar con Mi Número Celular"}
                    </button>
                  )}
                  {powerDialerQueue.length > 0 && (
                    <button 
                      className="dialer-btn secondary" 
                      onClick={() => dialerNext()} 
                      style={{ width: "100%", marginTop: "8px" }}
                    >
                      Siguiente Contacto
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="ops-panel">
              <div className="panel-title"><div><p>Cliente</p><h2>Contexto CRM</h2></div></div>
              <pre className="muted" style={{ maxHeight: "380px", overflow: "auto" }}>
                {selectedCustomer ? JSON.stringify(selectedCustomer, null, 2) : "Sin cliente seleccionado."}
              </pre>
            </section>
          </div>
        )}

        {section === "messages" && (
          <div className="premium-messages-grid" style={{ gridTemplateColumns: "320px minmax(0,1fr) 320px" }}>
            <div className="chat-list-panel">
              <div className="chat-list-header">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Bandeja de Entrada</h2>
                  <button className="secondary-action" onClick={() => void loadInbox()} style={{ padding: "4px 8px", fontSize: "0.8rem", minHeight: "28px" }}>
                    <RefreshCw size={14} style={{ marginRight: 4 }}/> Actualizar
                  </button>
                </div>
                <input 
                  value={agentFilter} 
                  onChange={(e) => setAgentFilter(e.target.value)} 
                  placeholder="Filtrar agente (ej: roka-agent-1)" 
                  style={{ width: "100%", background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)", padding: "8px 12px", borderRadius: "8px", color: "var(--text-2)", fontSize: "0.85rem" }} 
                />
              </div>
              <div className="chat-list-items">
                {filteredInboxItems.map((item) => (
                  <div 
                    key={`msg-${item.id}`} 
                    className={`chat-item ${selectedConvId === item.id ? "active" : ""}`} 
                    onClick={() => setSelectedConvId(item.id)}
                  >
                    <div className="chat-item-icon">
                      <MessageSquare size={18} />
                    </div>
                    <div className="chat-item-details">
                      <strong>{item.customerKey}</strong>
                      <span>{item.lastChannel} · {item.status}</span>
                    </div>
                  </div>
                ))}
                {filteredInboxItems.length === 0 && <p style={{ textAlign: "center", color: "var(--muted)", marginTop: "20px", fontSize: "0.9rem" }}>No hay conversaciones.</p>}
              </div>
            </div>

            <div className="chat-thread-panel">
              <div className="chat-thread-header">
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.2rem" }}>{selectedConversation?.customerKey || "Selecciona una conversación"}</h2>
                  {selectedConversation && (
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "4px", display: "block" }}>
                      Asignado a: {selectedConversation.assignedTo || "Nadie"} · Estado: {selectedConversation.status}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="secondary-action" onClick={() => { setSelectedConvId("") }} disabled={!selectedConversation} title="Cerrar chat">
                    <Archive size={16} />
                  </button>
                </div>
              </div>
              
              <div className="chat-thread-messages">
                {!selectedConversation && (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>
                    <p>Selecciona una conversación a la izquierda para empezar.</p>
                  </div>
                )}
                {(selectedConversation?.events || []).map((m) => (
                  <div key={`msg-thread-${m.id}`} className={`chat-bubble ${m.direction === "outbound" ? "outbound" : "inbound"}`}>
                    <p style={{ margin: 0 }}>{m.text}</p>
                    <span className="chat-bubble-meta">{m.channel} · {m.direction}</span>
                  </div>
                ))}
              </div>

              <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); void runAction("send-reply", sendReply); }}>
                <input 
                  value={replyText} 
                  onChange={(e) => setReplyText(e.target.value)} 
                  placeholder="Escribe tu mensaje..." 
                  disabled={!selectedConversation || pending["send-reply"]}
                />
                <button 
                  className="primary-action" 
                  type="submit" 
                  disabled={!selectedConversation || !replyText.trim() || pending["send-reply"]}
                >
                  <Send size={16} /> {pending["send-reply"] ? "Enviando" : "Enviar"}
                </button>
              </form>
            </div>

            <div className="chat-thread-panel">
              <div className="chat-list-header">
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Envío Directo (Manual)</h2>
              </div>
              <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-2)", fontWeight: "500" }}>WhatsApp destino</label>
                  <input 
                    value={waTo} 
                    onChange={(e) => setWaTo(e.target.value)} 
                    style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)", padding: "10px", borderRadius: "6px", color: "white" }} 
                  />
                  <label style={{ fontSize: "0.85rem", color: "var(--text-2)", fontWeight: "500" }}>Mensaje WhatsApp</label>
                  <textarea 
                    value={waText} 
                    onChange={(e) => setWaText(e.target.value)} 
                    style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)", padding: "10px", borderRadius: "6px", color: "white", minHeight: "80px", resize: "vertical" }} 
                  />
                  <button className="primary-action" onClick={() => void runAction("send-whatsapp", sendWhatsApp)} type="button" disabled={pending["send-whatsapp"]}>
                    {pending["send-whatsapp"] ? "Enviando..." : "Enviar WhatsApp"}
                  </button>
                </div>

                <div style={{ height: "1px", background: "var(--line)", margin: "4px 0" }} />

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--text-2)", fontWeight: "500" }}>Telegram Chat ID</label>
                  <input 
                    value={tgChatId} 
                    onChange={(e) => setTgChatId(e.target.value)} 
                    style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)", padding: "10px", borderRadius: "6px", color: "white" }} 
                  />
                  <label style={{ fontSize: "0.85rem", color: "var(--text-2)", fontWeight: "500" }}>Mensaje Telegram</label>
                  <textarea 
                    value={tgText} 
                    onChange={(e) => setTgText(e.target.value)} 
                    style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--line)", padding: "10px", borderRadius: "6px", color: "white", minHeight: "80px", resize: "vertical" }} 
                  />
                  <button className="primary-action" onClick={() => void runAction("send-telegram", sendTelegram)} type="button" disabled={pending["send-telegram"]}>
                    {pending["send-telegram"] ? "Enviando..." : "Enviar Telegram"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {section === "scripts" && (
          <section className="ops-panel wide">
            <div className="panel-title"><div><p>IA Comercial</p><h2>Guión por cliente</h2></div><button className="primary-action" onClick={() => void generateScript()}>Generar guión</button></div>
            <div className="assistant-editor">
              <label>Apertura<textarea value={scriptDraft.opening} onChange={(e) => setScriptDraft((s) => ({ ...s, opening: e.target.value }))} /></label>
              <label>Descubrimiento<textarea value={scriptDraft.discovery} onChange={(e) => setScriptDraft((s) => ({ ...s, discovery: e.target.value }))} /></label>
              <label>Objeciones<textarea value={scriptDraft.objectionHandling} onChange={(e) => setScriptDraft((s) => ({ ...s, objectionHandling: e.target.value }))} /></label>
              <label>Cierre<textarea value={scriptDraft.closing} onChange={(e) => setScriptDraft((s) => ({ ...s, closing: e.target.value }))} /></label>
              <label>Siguientes pasos<textarea value={scriptDraft.nextSteps} onChange={(e) => setScriptDraft((s) => ({ ...s, nextSteps: e.target.value }))} /></label>
            </div>
          </section>
        )}

        {section === "conversations" && (
          <div className="ops-grid">
            <section className="ops-panel">
              <div className="panel-title"><div><p>Bandeja</p><h2>Conversaciones</h2></div><button className="secondary-action" onClick={() => void runAction("refresh-inbox", loadInbox)} disabled={pending["refresh-inbox"]}>{pending["refresh-inbox"] ? "Actualizando..." : "Actualizar"}</button></div>
              <div className="form-grid"><label>Filtro agente asignado<input value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} placeholder="roka-agent-1" /></label></div>
              <div className="data-table">
                {filteredInboxItems.map((item) => <article key={item.id} onClick={() => setSelectedConvId(item.id)} style={{ cursor: "pointer" }}><MessageSquare size={16} /><div><strong>{item.customerKey}</strong><span>{item.lastChannel} · {item.status} · {item.assignedTo || "sin asignar"}</span></div><button className="secondary-action" onClick={(e) => { e.stopPropagation(); void assignConversation(item.id); }}>Asignar</button></article>)}
              </div>
            </section>
            <section className="ops-panel">
              <div className="panel-title"><div><p>Detalle</p><h2>{selectedConversation?.customerKey || "Selecciona conversación"}</h2></div></div>
              <div className="message-list">{(selectedConversation?.events || []).map((m) => <article key={m.id} className={`msg ${m.direction === "outbound" ? "user" : "assistant"}`}><strong>{m.channel}</strong><p>{m.text}</p></article>)}</div>
              <form className="composer" onSubmit={(e) => { e.preventDefault(); void runAction("send-reply", sendReply); }}><input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Escribe respuesta..." /><button className="primary-action" type="submit" disabled={pending["send-reply"]}>{pending["send-reply"] ? "Enviando..." : "Enviar"}</button></form>
            </section>
            <section className="ops-panel">
              <div className="panel-title"><div><p>Wrap-up</p><h2>Cierre obligatorio</h2></div></div>
              <div className="assistant-editor">
                <label>Outcome<input value={wrapOutcome} onChange={(e) => setWrapOutcome(e.target.value)} /></label>
                <label>Reason<input value={wrapReason} onChange={(e) => setWrapReason(e.target.value)} /></label>
                <label>Notas<textarea value={wrapNotes} onChange={(e) => setWrapNotes(e.target.value)} /></label>
              </div>
              <button className="primary-action" onClick={() => void runAction("wrapup", wrapUpConversation)} disabled={!selectedConversation || pending["wrapup"]}>{pending["wrapup"] ? "Cerrando..." : "Cerrar interacción"}</button>
            </section>
          </div>
        )}

        {section === "providers" && (
          <section className="ops-panel wide">
            <div className="panel-title"><div><p>Canales</p><h2>Twilio + WhatsApp + Telegram + CRM</h2></div></div>
            <div className="form-grid">
              <label>Twilio Account SID<input value={settings.providers.twilio.accountSid || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, accountSid: e.target.value } } }))} /></label>
              <label>Twilio API Key SID<input value={settings.providers.twilio.apiKeySid || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, apiKeySid: e.target.value } } }))} /></label>
              <label>Twilio API Key Secret<input type="password" value={settings.providers.twilio.apiKeySecret || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, apiKeySecret: e.target.value } } }))} /></label>
              <label>Twilio TwiML App SID<input value={settings.providers.twilio.twimlAppSid || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, twimlAppSid: e.target.value } } }))} /></label>
              <label>Número Twilio<input value={settings.providers.twilio.phoneNumber || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, phoneNumber: e.target.value } } }))} /></label>
              <label>CRM Bridge URL<input value={settings.providers.twilio.crmBridgeUrl || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, crmBridgeUrl: e.target.value } } }))} /></label>
              <label>CRM Organization ID<input value={settings.providers.twilio.organizationId || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, organizationId: e.target.value } } }))} /></label>
              <label>WhatsApp From<input value={settings.providers.whatsapp.from || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, whatsapp: { ...s.providers.whatsapp, from: e.target.value } } }))} placeholder="whatsapp:+14155238886" /></label>
              <label>Telegram Bot Token<input type="password" value={settings.providers.telegram.botToken || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, telegram: { ...s.providers.telegram, botToken: e.target.value } } }))} /></label>
              <label>Microsoft Phone Link (provider)<input value={String((settings.providers.microsoft_phone_link as any)?.provider || "microsoft_phone_link")} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, microsoft_phone_link: { ...(s.providers.microsoft_phone_link || {}), provider: e.target.value } } }))} /></label>
            </div>
          </section>
        )}



        {section === "evaluations" && (
          <section className="ops-panel wide">
            <div className="panel-title"><div><p>Calidad</p><h2>Resultados de interacciones</h2></div></div>
            <div className="data-table">
              {inboxItems.map((item) => (
                <article key={`eval-${item.id}`}>
                  <MessageSquare size={16} />
                  <div>
                    <strong>{item.customerKey}</strong>
                    <span>{item.lastChannel} · {item.status}</span>
                  </div>
                  <span className="pill">{item.assignedTo || "sin asignar"}</span>
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "settings" && (
          <section className="ops-panel wide">
            <div className="panel-title"><div><p>Sistema</p><h2>Configuración general</h2></div></div>
            <div className="form-grid">
              <label>Empresa<input value={settings.company} onChange={(e) => setSettings((s) => ({ ...s, company: e.target.value }))} /></label>
              <label>CRM Bridge URL<input value={settings.providers.twilio.crmBridgeUrl || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, crmBridgeUrl: e.target.value } } }))} /></label>
              <label>Organization ID<input value={settings.providers.twilio.organizationId || ""} onChange={(e) => setSettings((s) => ({ ...s, providers: { ...s.providers, twilio: { ...s.providers.twilio, organizationId: e.target.value } } }))} /></label>
              <label>OpenAI API Key<input type="password" value={(settings as any).providers?.openai?.apiKey || ""} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, openai: { ...(s.providers?.openai || {}), apiKey: e.target.value } } }))} /></label>
              <label>OpenAI Modelo<input value={(settings as any).providers?.openai?.model || ""} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, openai: { ...(s.providers?.openai || {}), model: e.target.value } } }))} /></label>
              <label>Gemini API Key<input type="password" value={(settings as any).providers?.gemini?.apiKey || ""} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, gemini: { ...(s.providers?.gemini || {}), apiKey: e.target.value } } }))} /></label>
              <label>Gemini Modelo<input value={(settings as any).providers?.gemini?.model || ""} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, gemini: { ...(s.providers?.gemini || {}), model: e.target.value } } }))} /></label>
              <label>ElevenLabs API Key<input type="password" value={(settings as any).providers?.elevenlabs?.apiKey || ""} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, elevenlabs: { ...(s.providers?.elevenlabs || {}), apiKey: e.target.value } } }))} /></label>
              <label>ElevenLabs Voz<input value={(settings as any).providers?.elevenlabs?.voice || ""} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, elevenlabs: { ...(s.providers?.elevenlabs || {}), voice: e.target.value } } }))} /></label>
              <label>Microsoft Phone Link activo
                <select value={String((settings as any).providers?.microsoft_phone_link?.enabled ?? true)} onChange={(e) => setSettings((s: any) => ({ ...s, providers: { ...s.providers, microsoft_phone_link: { ...(s.providers?.microsoft_phone_link || {}), enabled: e.target.value === "true" } } }))}>
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              </label>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
