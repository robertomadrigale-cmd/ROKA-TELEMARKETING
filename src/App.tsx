import { Building2, MessageSquare, Phone, Radio, Save, Send, Settings, Sparkles, UserCircle2 } from "lucide-react";
import { Device as TwilioDevice } from "@twilio/voice-sdk";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, getRedirectResult, User } from "firebase/auth";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { firebaseAuth, googleProvider } from "./firebase";

type Section = "conversations" | "calls" | "powerDialer" | "contacts" | "messages" | "scripts" | "evaluations" | "providers" | "settings";
type ProviderId = "twilio" | "whatsapp" | "telegram";
type CallStatus = "idle" | "ready" | "ringing" | "in-call" | "ended" | "error";
type CrmContact = { id: string; name?: string; email?: string; phone?: string; account?: string; company?: string; collection?: string };
type InboxConversation = { id: string; customerKey: string; status: string; assignedTo: string; lastChannel: string; events: Array<{ id: string; text: string; direction: string; channel: string }> };
type ScriptDraft = { opening: string; discovery: string; objectionHandling: string; closing: string; nextSteps: string };
type AppSettings = {
  company: string;
  activeProvider: "openai";
  providers: Record<ProviderId, {
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
  }>;
};

const defaultSettings: AppSettings = {
  company: "ROKA",
  activeProvider: "openai",
  providers: {
    twilio: { model: "voice-central", callerName: "ROKA Agente" } as any,
    whatsapp: { model: "messaging", provider: "twilio", from: "" },
    telegram: { model: "messaging", botToken: "", defaultChatId: "" },
  },
};

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text || "{}"); } catch { return { raw: text }; }
}

export default function App() {
  const [section, setSection] = useState<Section>("conversations");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CrmContact | null>(null);
  const [inboxItems, setInboxItems] = useState<InboxConversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState("");
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
  const twilioDeviceRef = useRef<TwilioDevice | null>(null);
  const twilioCallSidRef = useRef("");

  const selectedConversation = useMemo(() => inboxItems.find((item) => item.id === selectedConvId) || null, [inboxItems, selectedConvId]);

  useEffect(() => {
    void boot();
    const unsub = onAuthStateChanged(firebaseAuth, (user) => setAuthUser(user));
    void getRedirectResult(firebaseAuth).catch(() => undefined);
    return () => unsub();
  }, []);

  async function boot() {
    await Promise.all([loadConfig(), loadInbox(), loadContacts("")]);
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    const data = await readJson(res);
    if (res.ok) setSettings((prev) => ({ ...prev, ...data }));
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
  }

  async function loadInbox() {
    const res = await fetch("/api/inbox/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 80 }) });
    const data = await readJson(res);
    if (res.ok) setInboxItems(Array.isArray(data.items) ? data.items : []);
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
    if (!dialNumber.trim()) return;
    const res = await fetch("/api/crm/search-customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: dialNumber }) });
    const data = await readJson(res);
    if (!res.ok) { setNotice(data.error || "No se pudo buscar cliente."); return; }
    const first = Array.isArray(data.results) ? data.results[0] : null;
    setSelectedCustomer(first);
    if (first) setNotice(`Cliente encontrado: ${first.name || first.id}`);
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">R</div><div><strong>ROKA</strong><span>Telemarketing Center</span></div></div>
        <nav className="nav-list">
          {([
            ["conversations", MessageSquare, "Conversaciones"],
            ["calls", Phone, "Llamadas"],
            ["powerDialer", Radio, "Power Dialer"],
            ["contacts", UserCircle2, "Contactos"],
            ["messages", Send, "Mensajería"],
            ["scripts", Sparkles, "Guiones IA"],
            ["evaluations", Building2, "Evaluaciones"],
            ["providers", Settings, "Canales"],
            ["settings", Settings, "Configuración"],
          ] as Array<[Section, ComponentType<{ size?: number }>, string]>).map(([id, Icon, label]) => (
            <button key={id} className={section === id ? "nav-item active" : "nav-item"} type="button" onClick={() => setSection(id as Section)}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <h1>ROKA</h1>
          <div className="header-actions">
            {!authUser ? <button className="secondary-action" onClick={() => void signInGoogle()} disabled={authBusy}>Entrar con Google</button> : <button className="secondary-action" onClick={() => void signOutGoogle()}>Salir ({authUser.email})</button>}
            <button className="primary-action" onClick={() => void saveConfig()}><Save size={16} />Guardar</button>
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
              <div className="panel-title"><div><p>Telefonía</p><h2>Llamadas</h2></div></div>
              <div className="form-grid compact"><label>Número<input value={dialNumber} onChange={(e) => setDialNumber(e.target.value)} placeholder="+52..." /></label></div>
              <div className="header-actions">
                <button className="secondary-action" onClick={() => void connectTwilioDevice()}>Conectar</button>
                <button className="secondary-action" onClick={() => void searchCustomer()}>Buscar cliente</button>
                <button className="primary-action" onClick={() => void startOutboundCall()}>Llamar</button>
                <button className="danger-action" onClick={() => void hangupCall()}>Colgar</button>
              </div>
              <p className="muted">Estado: {callStatus}</p>
            </section>
            <section className="ops-panel">
              <div className="panel-title"><div><p>Cliente</p><h2>Contexto CRM</h2></div></div>
              <pre className="muted">{selectedCustomer ? JSON.stringify(selectedCustomer, null, 2) : "Sin cliente seleccionado."}</pre>
            </section>
          </div>
        )}

        {section === "messages" && (
          <div className="ops-grid">
            <section className="ops-panel">
              <div className="panel-title"><div><p>Canal</p><h2>WhatsApp</h2></div><button className="primary-action" onClick={() => void sendWhatsApp()}>Enviar</button></div>
              <div className="assistant-editor"><label>Número destino<input value={waTo} onChange={(e) => setWaTo(e.target.value)} /></label><label>Mensaje<textarea value={waText} onChange={(e) => setWaText(e.target.value)} /></label></div>
            </section>
            <section className="ops-panel">
              <div className="panel-title"><div><p>Canal</p><h2>Telegram</h2></div><button className="primary-action" onClick={() => void sendTelegram()}>Enviar</button></div>
              <div className="assistant-editor"><label>Chat ID<input value={tgChatId} onChange={(e) => setTgChatId(e.target.value)} /></label><label>Mensaje<textarea value={tgText} onChange={(e) => setTgText(e.target.value)} /></label></div>
            </section>
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
              <div className="panel-title"><div><p>Bandeja</p><h2>Conversaciones</h2></div><button className="secondary-action" onClick={() => void loadInbox()}>Actualizar</button></div>
              <div className="data-table">
                {inboxItems.map((item) => <article key={item.id} onClick={() => setSelectedConvId(item.id)} style={{ cursor: "pointer" }}><MessageSquare size={16} /><div><strong>{item.customerKey}</strong><span>{item.lastChannel} · {item.status}</span></div><button className="secondary-action" onClick={(e) => { e.stopPropagation(); void assignConversation(item.id); }}>Asignar</button></article>)}
              </div>
            </section>
            <section className="ops-panel">
              <div className="panel-title"><div><p>Detalle</p><h2>{selectedConversation?.customerKey || "Selecciona conversación"}</h2></div></div>
              <div className="message-list">{(selectedConversation?.events || []).map((m) => <article key={m.id} className={`msg ${m.direction === "outbound" ? "user" : "assistant"}`}><strong>{m.channel}</strong><p>{m.text}</p></article>)}</div>
              <form className="composer" onSubmit={(e) => { e.preventDefault(); void sendReply(); }}><input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Escribe respuesta..." /><button className="primary-action" type="submit">Enviar</button></form>
            </section>
            <section className="ops-panel">
              <div className="panel-title"><div><p>Wrap-up</p><h2>Cierre obligatorio</h2></div></div>
              <div className="assistant-editor">
                <label>Outcome<input value={wrapOutcome} onChange={(e) => setWrapOutcome(e.target.value)} /></label>
                <label>Reason<input value={wrapReason} onChange={(e) => setWrapReason(e.target.value)} /></label>
                <label>Notas<textarea value={wrapNotes} onChange={(e) => setWrapNotes(e.target.value)} /></label>
              </div>
              <button className="primary-action" onClick={() => void wrapUpConversation()} disabled={!selectedConversation}>Cerrar interacción</button>
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
            </div>
          </section>
        )}

        {(section === "settings" || section === "powerDialer" || section === "evaluations") && (
          <section className="ops-panel"><h2>Este módulo está en transición</h2><p className="muted">Ya no contiene funciones de capacitación; lo terminamos en el siguiente ajuste.</p></section>
        )}
      </section>
    </main>
  );
}
