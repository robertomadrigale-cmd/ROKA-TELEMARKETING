import {
  Activity,
  BookOpen,
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  FileText,
  KeyRound,
  MessageSquare,
  Mic,
  MonitorPlay,
  PlugZap,
  Radio,
  Save,
  ServerCog,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
  Volume2,
  X,
} from "lucide-react";
import "@google/model-viewer";
import { createLocalAudioTrack, Room } from "livekit-client";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Section = "session" | "knowledge" | "providers" | "settings";
type Role = "assistant" | "user" | "system";
type ProviderId =
  | "openai"
  | "gemini"
  | "elevenlabs"
  | "heygen"
  | "did"
  | "livekit"
  | "pipecat"
  | "talkinghead"
  | "readyplayerme";
type LiveKitStatus = "disconnected" | "connecting" | "connected" | "error";
type RealtimeStatus = "disconnected" | "connecting" | "connected" | "error";

type ProviderConfig = {
  enabled: boolean;
  model: string;
  apiKey: string;
  url?: string;
  voice?: string;
  avatar?: string;
  agent?: string;
  apiSecret?: string;
  agentName?: string;
};

type AppSettings = {
  company: string;
  assistantName: string;
  systemInstructions: string;
  activeProvider: ProviderId;
  activeAvatarProvider: ProviderId;
  strictKnowledge: boolean;
  providers: Record<ProviderId, ProviderConfig>;
};

type KnowledgeItem = {
  id: number;
  title: string;
  type: string;
  owner: string;
  status: "Indexado" | "Pendiente" | "Revision";
  updated: string;
};

type Message = {
  id: number;
  role: Role;
  text: string;
};

type DidDebug = {
  connection: string;
  ice: string;
  lastStep: string;
  lastSpeech: string;
  streamId: string;
  sessionId: string;
  video: string;
  error: string;
};

type BackendHealth = {
  ok: boolean;
  livekit: boolean;
  providers: Record<string, boolean>;
};

const providerCatalog: Array<{
  id: ProviderId;
  name: string;
  kind: string;
  use: string;
  defaultModel: string;
  needs: string[];
}> = [
  {
    id: "openai",
    name: "OpenAI Realtime",
    kind: "IA realtime",
    use: "Conversacion voz a voz, baja latencia, tool calling y respuestas naturales.",
    defaultModel: "gpt-realtime",
    needs: ["API key", "Modelo"],
  },
  {
    id: "gemini",
    name: "Gemini Live",
    kind: "IA realtime",
    use: "Agente multimodal con audio, texto e imagen.",
    defaultModel: "gemini-live-2.5-flash-preview",
    needs: ["API key", "Modelo"],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    kind: "Voz",
    use: "Voces naturales, clonacion y agentes conversacionales.",
    defaultModel: "eleven_turbo_v2_5",
    needs: ["API key", "Voz"],
  },
  {
    id: "heygen",
    name: "HeyGen LiveAvatar",
    kind: "Avatar",
    use: "Avatar realista por WebRTC/WebSocket usando audio externo.",
    defaultModel: "live-avatar",
    needs: ["API key", "Avatar ID"],
  },
  {
    id: "talkinghead",
    name: "TalkingHead",
    kind: "Avatar gratis",
    use: "Avatar 3D open source con lip-sync en navegador usando Ready Player Me y Three.js.",
    defaultModel: "talkinghead-web",
    needs: ["Avatar URL opcional"],
  },
  {
    id: "readyplayerme",
    name: "Ready Player Me",
    kind: "Avatar gratis",
    use: "Avatares 3D gratuitos para web; se pueden usar con TalkingHead para lip-sync.",
    defaultModel: "rpm-avatar",
    needs: ["Avatar URL"],
  },
  {
    id: "did",
    name: "D-ID Realtime",
    kind: "Avatar",
    use: "Agente visual realtime con streaming WebRTC.",
    defaultModel: "agents-v4",
    needs: ["API key", "Agent ID"],
  },
  {
    id: "livekit",
    name: "LiveKit",
    kind: "Transporte",
    use: "Sala WebRTC para conectar navegador, agente, voz y avatar.",
    defaultModel: "agent-dispatch",
    needs: ["URL", "API key", "API secret"],
  },
  {
    id: "pipecat",
    name: "Pipecat",
    kind: "Orquestacion",
    use: "Pipeline open source STT + LLM + TTS + transporte.",
    defaultModel: "pipeline-local",
    needs: ["Endpoint", "Modelo"],
  },
];

const readyPlayerMeSampleAvatar = "";
const neutralSampleAvatar = "";
const legacyReadyPlayerMeSampleAvatar = "https://models.readyplayer.me/6185a4acfb622cf1cdc49348.glb";
const legacyHalfBodyAvatar = "https://raw.githubusercontent.com/readyplayerme/visage/main/public/half-body.glb";
const legacySoldierAvatar = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb";

type BuiltInAvatar = {
  id: string;
  name: string;
  role: string;
  description: string;
  image: string;
  modelUrl: string;
  color: string;
};

const builtInAvatars: BuiltInAvatar[] = [
  {
    id: "executive",
    name: "Mariana",
    role: "Instructora Ejecutiva",
    description: "Avatar 3D humano corporativo.",
    image: "/avatars/executive.png",
    modelUrl: "/avatars/michelle.glb",
    color: "#6b4c8a",
  },
  {
    id: "mentor",
    name: "Valeria",
    role: "Mentora Técnica",
    description: "Modelo 3D (Kira).",
    image: "/avatars/mentor.png",
    modelUrl: "/avatars/kira.glb",
    color: "#2a7a8c",
  }
];

const defaultSettings: AppSettings = {
  company: "ROKA",
  assistantName: "Instructor ROKA",
  systemInstructions:
    "Eres un asistente especializado en capacitacion. Usa la base de conocimiento recuperada por RAG. Si el modo estricto esta activo, no inventes informacion fuera de los documentos. Responde con pasos claros, ejemplos practicos y una pregunta de verificacion.",
  activeProvider: "openai",
  activeAvatarProvider: "did",
  strictKnowledge: true,
  providers: {
    openai: { enabled: true, model: "gpt-realtime", apiKey: "" },
    gemini: { enabled: false, model: "gemini-live-2.5-flash-preview", apiKey: "" },
    elevenlabs: { enabled: false, model: "eleven_turbo_v2_5", apiKey: "", voice: "Marin" },
    heygen: { enabled: false, model: "live-avatar", apiKey: "", avatar: "" },
    did: { enabled: false, model: "agents-v4", apiKey: "", agent: "" },
    talkinghead: { enabled: true, model: "talkinghead-web", apiKey: "", avatar: readyPlayerMeSampleAvatar },
    readyplayerme: { enabled: true, model: "rpm-avatar", apiKey: "", avatar: readyPlayerMeSampleAvatar },
    livekit: { enabled: false, model: "agent-dispatch", apiKey: "", apiSecret: "", url: "", agentName: "" },
    pipecat: { enabled: false, model: "pipeline-local", apiKey: "", url: "http://localhost:7860" },
  },
};

const starterKnowledge: KnowledgeItem[] = [
  { id: 1, title: "Induccion operativa ROKA", type: "Curso", owner: "RH", status: "Indexado", updated: "Inicial" },
  { id: 2, title: "Protocolos de seguridad industrial", type: "Manual", owner: "Seguridad", status: "Indexado", updated: "Inicial" },
];

const avatarChoices: Array<{
  id: string;
  provider: ProviderId;
  name: string;
  label: string;
  value: string;
  style: "free" | "premium";
  image: string;
}> = [
  {
    id: "upload-3d",
    provider: "readyplayerme",
    name: "Subir GLB",
    label: "3D Local",
    value: "",
    style: "free",
    image: "/avatars/ready-player-me.svg",
  },
  {
    id: "heygen-custom",
    provider: "heygen",
    name: "HeyGen",
    label: "Premium",
    value: "",
    style: "premium",
    image: "/avatars/heygen.svg",
  },
  {
    id: "did-custom",
    provider: "did",
    name: "D-ID",
    label: "Premium",
    value: "",
    style: "premium",
    image: "/avatars/d-id.svg",
  },
];

function loadSettings() {
  try {
    const raw = localStorage.getItem("roka-ai-settings");
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const mergedProviders = {
      ...defaultSettings.providers,
      ...(parsed.providers || {}),
    };
    if (
      mergedProviders.readyplayerme.avatar === legacyReadyPlayerMeSampleAvatar ||
      mergedProviders.readyplayerme.avatar === legacyHalfBodyAvatar ||
      mergedProviders.readyplayerme.avatar === legacySoldierAvatar
    ) {
      mergedProviders.readyplayerme = { ...mergedProviders.readyplayerme, enabled: true, avatar: "" };
    }
    if (mergedProviders.talkinghead.avatar?.startsWith("builtin://") || mergedProviders.talkinghead.avatar === legacySoldierAvatar) {
      mergedProviders.talkinghead = { ...mergedProviders.talkinghead, avatar: mergedProviders.readyplayerme.avatar };
    }
    const parsedTalkingHeadAvatar = parsed.providers?.talkinghead?.avatar || "";
    const activeAvatarProvider =
      parsed.activeAvatarProvider === "did"
        ? "did"
        : defaultSettings.activeAvatarProvider;
    return {
      ...defaultSettings,
      ...parsed,
      activeAvatarProvider,
      providers: mergedProviders,
    } as AppSettings;
  } catch {
    return defaultSettings;
  }
}

function mask(value?: string) {
  if (!value) return "Sin llave";
  if (value.length < 8) return "Guardada";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readReadyPlayerMessage(data: unknown) {
  const payload = typeof data === "string" ? safeJson(data) : data;
  if (!payload || typeof payload !== "object") return "";
  const event = payload as { eventName?: string; data?: { url?: string } };
  return event.eventName === "v1.avatar.exported" ? event.data?.url || "" : "";
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isModelUrl(value?: string) {
  return Boolean(value && (/^https?:\/\/.+\.(glb|gltf)(\?|#|$)/i.test(value) || value.includes("models.readyplayer.me")));
}

function getActiveAvatarValue(settings: AppSettings) {
  const config = settings.providers[settings.activeAvatarProvider];
  return settings.activeAvatarProvider === "did" ? config.agent || "" : config.avatar || "";
}

function avatarAssetUrl(src?: string) {
  if (!src) return "";
  return /^https?:\/\//i.test(src) ? `/api/avatar/proxy?url=${encodeURIComponent(src)}` : src;
}

const didDefaultAvatar = "https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg";
const initialDidDebug: DidDebug = {
  connection: "sin iniciar",
  ice: "sin iniciar",
  lastStep: "esperando Conectar D-ID",
  lastSpeech: "sin hablar",
  streamId: "",
  sessionId: "",
  video: "sin stream",
  error: "",
};

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export function App() {
  const [section, setSection] = useState<Section>("settings");
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>(starterKnowledge);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "system", text: "Configura empresa, proveedor, modelo y llaves antes de iniciar una sesion real." },
  ]);
  const [input, setInput] = useState("");
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [liveKitStatus, setLiveKitStatus] = useState<LiveKitStatus>("disconnected");
  const [remoteParticipants, setRemoteParticipants] = useState(0);
  const [openAiRealtimeStatus, setOpenAiRealtimeStatus] = useState<RealtimeStatus>("disconnected");
  const [voiceSource, setVoiceSource] = useState<"none" | "browser" | "openai" | "livekit-agent">("none");
  const [notice, setNotice] = useState("");
  const [avatarCreatorOpen, setAvatarCreatorOpen] = useState(false);
  const [avatarUrlDraft, setAvatarUrlDraft] = useState(settings.providers.readyplayerme.avatar || "");
  const [selectedBuiltInAvatar, setSelectedBuiltInAvatar] = useState<string>(() => {
    try {
      return localStorage.getItem("roka-builtin-avatar") || "instructor";
    } catch {
      return "instructor";
    }
  });
  const roomRef = useRef<Room | null>(null);
  const openAiPeerRef = useRef<RTCPeerConnection | null>(null);
  const openAiDataChannelRef = useRef<RTCDataChannel | null>(null);
  const openAiAudioRef = useRef<HTMLAudioElement | null>(null);

  // D-ID WebRTC State
  const didPeerRef = useRef<RTCPeerConnection | null>(null);
  const [didStatus, setDidStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [didStreamId, setDidStreamId] = useState<string>("");
  const [didSessionId, setDidSessionId] = useState<string>("");
  const [didDebug, setDidDebug] = useState<DidDebug>(initialDidDebug);
  const didVideoRef = useRef<HTMLVideoElement | null>(null);

  const activeProvider = providerCatalog.find((provider) => provider.id === settings.activeProvider)!;
  const livekitConfig = settings.providers.livekit;
  const configuredCount = useMemo(
    () => Object.values(settings.providers).filter((provider) => provider.enabled && (provider.apiKey || provider.url)).length,
    [settings.providers],
  );

  useEffect(() => {
    localStorage.setItem("roka-ai-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    try { localStorage.setItem("roka-builtin-avatar", selectedBuiltInAvatar); } catch { /* noop */ }
  }, [selectedBuiltInAvatar]);

  useEffect(() => {
    void refreshBackend();
    fetch("/api/knowledge")
      .then((res) => res.json())
      .then((data) => Array.isArray(data.items) && setKnowledge(data.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const url = readReadyPlayerMessage(event.data);
      if (url) saveReadyPlayerAvatar(url);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const refreshBackend = async () => {
    try {
      const res = await fetch("/api/health");
      setHealth(await res.json());
    } catch {
      setHealth(null);
    }
  };

  const updateProvider = (id: ProviderId, patch: Partial<ProviderConfig>) => {
    setSettings((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [id]: { ...current.providers[id], ...patch },
      },
    }));
  };

  const saveReadyPlayerAvatar = (url: string) => {
    const cleanUrl = url.trim();
    if (!cleanUrl) return;
    setSettings((current) => ({
      ...current,
      activeAvatarProvider: "readyplayerme",
      providers: {
        ...current.providers,
        readyplayerme: {
          ...current.providers.readyplayerme,
          enabled: true,
          avatar: cleanUrl,
        },
        talkinghead: {
          ...current.providers.talkinghead,
          enabled: true,
          avatar: cleanUrl,
        },
      },
    }));
    setAvatarUrlDraft(cleanUrl);
    setAvatarCreatorOpen(false);
    setSection("session");
  };

  const uploadAvatarModel = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".glb") && !file.name.toLowerCase().endsWith(".gltf")) {
      setNotice("El avatar debe ser archivo .glb o .gltf.");
      return;
    }
    const res = await fetch(`/api/avatar/upload?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await file.arrayBuffer(),
    });
    const data = await res.json();
    if (!res.ok) {
      setNotice(data.error || "No se pudo subir el avatar.");
      return;
    }
    saveReadyPlayerAvatar(data.url);
  };

  const getDidAvatarSource = () => settings.providers.did.agent || settings.providers.did.avatar || didDefaultAvatar;

  const updateDidDebug = (patch: Partial<DidDebug>) => {
    setDidDebug((current) => ({ ...current, ...patch }));
  };

  const sendDidSpeech = async (text: string) => {
    if (settings.activeAvatarProvider !== "did" || didStatus !== "connected" || !didStreamId || !didSessionId) {
      updateDidDebug({
        lastSpeech: "bloqueado: D-ID no conectado",
        error: "No hay stream/session activos para hablar.",
      });
      return false;
    }
    updateDidDebug({
      lastSpeech: `enviando texto (${text.length} chars)`,
      error: "",
    });
    setVoiceSource("openai");
    const didRes = await fetch("/api/did/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        streamId: didStreamId,
        sessionId: didSessionId,
        text,
      }),
    });
    const didData = await readJsonResponse(didRes);
    if (!didRes.ok) throw new Error(didData.detail || didData.error || "D-ID no pudo hablar.");
    updateDidDebug({ lastSpeech: "D-ID acepto el texto para hablar", error: "" });
    return true;
  };

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-MX";
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((current) => [...current, { id: Date.now(), role: "user", text }]);

    if (openAiDataChannelRef.current?.readyState === "open") {
      openAiDataChannelRef.current.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text }],
          },
        }),
      );
      openAiDataChannelRef.current.send(JSON.stringify({ type: "response.create" }));
      return;
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          company: settings.company,
          provider: settings.activeProvider,
          model: settings.providers[settings.activeProvider].model,
          strictKnowledge: settings.strictKnowledge,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data.detail || data.error || "OpenAI no respondio.");
      const answer = data.answer || "Sin respuesta.";
      setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", text: answer }]);
      
      if (settings.activeAvatarProvider === "did" && didStatus === "connected" && didStreamId && didSessionId) {
        void sendDidSpeech(answer)
          .catch((didError) => {
            setVoiceSource("none");
            setNotice(didError instanceof Error ? didError.message : "D-ID no pudo hablar.");
          });
      } else {
        setVoiceSource("browser");
        speak(answer);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "system",
          text: error instanceof Error ? error.message : "No hubo respuesta de OpenAI. Revisa llave, modelo y backend.",
        },
      ]);
    }
  };

  const uploadKnowledge = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const payload = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.name.split(".").pop()?.toUpperCase() || "DOC",
        content: await file.text().catch(() => ""),
      })),
    );
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: payload }),
    });
    const data = await res.json();
    if (Array.isArray(data.items)) setKnowledge(data.items);
  };

  const deleteKnowledge = async (id: number) => {
    const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (Array.isArray(data.items)) setKnowledge(data.items);
  };

  const saveServerConfig = async () => {
    setNotice("");
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setNotice(res.ok ? "Configuracion guardada en navegador y backend local." : "No se pudo guardar en backend.");
  };

  const connectLiveKit = async () => {
    if (liveKitStatus === "connected") {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setLiveKitStatus("disconnected");
      setRemoteParticipants(0);
      return;
    }

    setLiveKitStatus("connecting");
    setNotice("");
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantName: `${settings.company} alumno` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.hint || "LiveKit no configurado.");

      const room = new Room({ adaptiveStream: true, dynacast: true });
      room.on("disconnected", () => {
        setLiveKitStatus("disconnected");
        setRemoteParticipants(0);
      });
      room.on("participantConnected", () => setRemoteParticipants(room.remoteParticipants.size));
      room.on("participantDisconnected", () => setRemoteParticipants(room.remoteParticipants.size));
      await room.connect(data.serverUrl, data.participantToken);
      const audioTrack = await createLocalAudioTrack();
      await room.localParticipant.publishTrack(audioTrack);
      roomRef.current = room;
      setLiveKitStatus("connected");
      setRemoteParticipants(room.remoteParticipants.size);
      setVoiceSource(room.remoteParticipants.size > 0 ? "livekit-agent" : "none");
      setMessages((current) => [
        ...current,
        {
          id: Date.now(),
          role: "system",
          text:
            `LiveKit conectado a sala ${data.roomName}. ` +
            "La sala WebRTC ya esta conectada; para audio de vuelta por LiveKit falta levantar un agente LiveKit en esa sala.",
        },
      ]);
    } catch (error) {
      setLiveKitStatus("error");
      setNotice(error instanceof Error ? error.message : "Error conectando LiveKit.");
    }
  };

  const connectOpenAiRealtime = async () => {
    if (openAiRealtimeStatus === "connected") {
      openAiDataChannelRef.current?.close();
      openAiPeerRef.current?.close();
      openAiPeerRef.current = null;
      openAiDataChannelRef.current = null;
      setOpenAiRealtimeStatus("disconnected");
      setVoiceSource("none");
      return;
    }

    setNotice("");
    setOpenAiRealtimeStatus("connecting");
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      const peer = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        audio.muted = settings.activeAvatarProvider === "did" && didStatus === "connected";
        void audio.play().catch(() => undefined);
      };

      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      peer.addTrack(media.getAudioTracks()[0]);

      const dc = peer.createDataChannel("oai-events");
      dc.onopen = () => {
        setOpenAiRealtimeStatus("connected");
        setVoiceSource("openai");
        dc.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "Saluda brevemente y di que estas listo para capacitar." }],
            },
          }),
        );
        dc.send(JSON.stringify({ type: "response.create" }));
      };
      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "response.output_text.done" && data.text) {
            setMessages((current) => [...current, { id: Date.now(), role: "assistant", text: data.text }]);
            void sendDidSpeech(data.text).catch((didError) => {
              setVoiceSource("none");
              setNotice(didError instanceof Error ? didError.message : "D-ID no pudo hablar.");
            });
          }
          if (data.type === "response.audio_transcript.done" && data.transcript) {
            setMessages((current) => [...current, { id: Date.now(), role: "assistant", text: data.transcript }]);
            void sendDidSpeech(data.transcript).catch((didError) => {
              setVoiceSource("none");
              setNotice(didError instanceof Error ? didError.message : "D-ID no pudo hablar.");
            });
          }
          if (data.type === "error") {
            setNotice(data.error?.message || "OpenAI Realtime devolvio error.");
          }
        } catch {
          // OpenAI events are best-effort UI telemetry here.
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const response = await fetch("/api/openai/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp || "",
      });
      const answerSdp = await response.text();
      if (!response.ok) throw new Error(answerSdp);

      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      openAiPeerRef.current = peer;
      openAiDataChannelRef.current = dc;
      openAiAudioRef.current = audio;
    } catch (error) {
      setOpenAiRealtimeStatus("error");
      setNotice(error instanceof Error ? error.message : "No se pudo conectar OpenAI Realtime.");
    }
  };

  const connectDidStream = async () => {
    if (didStatus === "connected") {
      if (didPeerRef.current) {
        didPeerRef.current.close();
        didPeerRef.current = null;
      }
      updateDidDebug({ ...initialDidDebug, lastStep: "desconectando D-ID" });
      if (didStreamId && didSessionId) {
        try {
          await fetch(`/api/did/stream/${didStreamId}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: didSessionId })
          });
        } catch { /* noop */ }
      }
      setDidStatus("disconnected");
      setDidStreamId("");
      setDidSessionId("");
      updateDidDebug({ ...initialDidDebug, lastStep: "D-ID desconectado" });
      return;
    }

    setNotice("");
    setDidStatus("connecting");
    updateDidDebug({
      ...initialDidDebug,
      lastStep: "solicitando stream a D-ID",
      video: "esperando stream",
    });
    try {
      const resStream = await fetch("/api/did/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_url: getDidAvatarSource()
        })
      });
      const streamData = await readJsonResponse(resStream);
      if (!resStream.ok) throw new Error(streamData.error || streamData.detail || "Error al crear flujo en D-ID");

      const { id: streamId, session_id: sessionId, offer, ice_servers } = streamData;
      setDidStreamId(streamId);
      setDidSessionId(sessionId);
      updateDidDebug({
        lastStep: "stream creado; preparando WebRTC",
        streamId: streamId ? `${streamId}`.slice(0, 10) : "",
        sessionId: sessionId ? `${sessionId}`.slice(0, 10) : "",
      });

      const peer = new RTCPeerConnection({
        iceServers: ice_servers
      });

      peer.ontrack = (event) => {
        if (didVideoRef.current && event.streams && event.streams[0]) {
          didVideoRef.current.srcObject = event.streams[0];
          didVideoRef.current.muted = false;
          didVideoRef.current.volume = 1;
          didVideoRef.current.play().catch(() => undefined);
          setDidStatus("connected");
          updateDidDebug({
            lastStep: "video recibido desde D-ID",
            video: "stream recibido",
            connection: peer.connectionState,
            ice: peer.iceConnectionState,
            error: "",
          });
        }
      };

      peer.onconnectionstatechange = () => {
        updateDidDebug({ connection: peer.connectionState });
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          updateDidDebug({ error: `WebRTC ${peer.connectionState}` });
        }
      };

      peer.oniceconnectionstatechange = () => {
        updateDidDebug({ ice: peer.iceConnectionState, lastStep: `ICE ${peer.iceConnectionState}` });
        if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') {
          setTimeout(() => {
            void sendDidSpeech("Hola, estoy conectado y listo.").catch((didError) => {
              updateDidDebug({
                lastSpeech: "fallo saludo inicial",
                error: didError instanceof Error ? didError.message : "D-ID no pudo hablar.",
              });
            });
          }, 500);
        }
      };

      peer.onicecandidate = async (event) => {
        if (event.candidate) {
          updateDidDebug({ lastStep: "enviando candidato ICE" });
          try {
            await fetch("/api/did/ice", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                streamId,
                sessionId,
                candidate: {
                  candidate: event.candidate.candidate,
                  sdpMid: event.candidate.sdpMid,
                  sdpMLineIndex: event.candidate.sdpMLineIndex
                }
              })
            });
          } catch (iceError) {
            updateDidDebug({
              error: iceError instanceof Error ? iceError.message : "Fallo enviando ICE",
            });
          }
        }
      };

      updateDidDebug({ lastStep: "aplicando offer remota" });
      await peer.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      updateDidDebug({ lastStep: "enviando SDP answer" });
      const resSdp = await fetch("/api/did/sdp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamId,
          sessionId,
          answer: {
            type: "answer",
            sdp: answer.sdp
          }
        })
      });
      if (!resSdp.ok) {
        const sdpError = await readJsonResponse(resSdp);
        throw new Error(sdpError.error || sdpError.detail || "Error al enviar SDP");
      }

      didPeerRef.current = peer;
      updateDidDebug({ lastStep: "SDP aceptado; esperando video" });
    } catch (error) {
      setDidStatus("error");
      const message = error instanceof Error ? error.message : "Error al conectar D-ID WebRTC.";
      setNotice(message);
      updateDidDebug({ lastStep: "fallo conexion D-ID", error: message });
    }
  };
 
  const selectAvatarChoice = (choice: (typeof avatarChoices)[number]) => {
    if (choice.id === "rpm-create" || choice.id === "upload-3d") {
      setAvatarCreatorOpen(true);
      setSettings((current) => ({ ...current, activeAvatarProvider: "readyplayerme" }));
      return;
    }
    setSettings((current) => ({
      ...current,
      activeAvatarProvider: choice.provider,
      providers: {
        ...current.providers,
        [choice.provider]: {
          ...current.providers[choice.provider],
          enabled: true,
          avatar: choice.provider === "did" ? current.providers[choice.provider].avatar : choice.value || current.providers[choice.provider].avatar,
          agent: choice.provider === "did" ? choice.value || current.providers.did.agent : current.providers[choice.provider].agent,
        },
      },
    }));
  };

  return (
    <main className="product-shell">
      <aside className="rail">
        <div className="brand">
          <div className="brand-icon">R</div>
          <div>
            <strong>ROKA</strong>
            <span>AI Training Center</span>
          </div>
        </div>
        <nav>
          {[
            ["settings", Settings, "Configuracion"],
            ["session", MonitorPlay, "Sesion"],
            ["knowledge", BookOpen, "Conocimiento"],
            ["providers", PlugZap, "Proveedores"],
          ].map(([id, Icon, label]) => (
            <button className={section === id ? "rail-link active" : "rail-link"} key={id as string} onClick={() => setSection(id as Section)} type="button">
              <Icon size={18} />
              <span>{label as string}</span>
            </button>
          ))}
        </nav>
        <div className="rail-status">
          <span className={health?.ok ? "dot ok" : "dot"} />
          <div>
            <strong>{health?.ok ? "Backend activo" : "Backend offline"}</strong>
            <span>{configuredCount} proveedores configurados</span>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="app-header">
          <div>
            <p>Centro de capacitacion IA</p>
            <h1>{settings.company}</h1>
          </div>
          <div className="header-actions">
            <button className="secondary-action" onClick={refreshBackend} type="button">
              <ServerCog size={18} />
              Backend
            </button>
            <button className="primary-action" onClick={() => setSection("settings")} type="button">
              <KeyRound size={18} />
              Llaves y modelos
            </button>
          </div>
        </header>

        {section === "settings" && (
          <SettingsView
            activeProvider={activeProvider}
            health={health}
            notice={notice}
            settings={settings}
            setSettings={setSettings}
            updateProvider={updateProvider}
            onSave={saveServerConfig}
          />
        )}

        {section === "session" && (
          <SessionView
            activeProvider={activeProvider}
            input={input}
            liveKitStatus={liveKitStatus}
            messages={messages}
            notice={notice}
            openAiRealtimeStatus={openAiRealtimeStatus}
            remoteParticipants={remoteParticipants}
            settings={settings}
            selectedBuiltInAvatar={selectedBuiltInAvatar}
            onSelectBuiltInAvatar={setSelectedBuiltInAvatar}
            onAvatarUrl={saveReadyPlayerAvatar}
            onOpenAvatarCreator={() => setAvatarCreatorOpen(true)}
            onSelectAvatar={selectAvatarChoice}
            voiceSource={voiceSource}
            setInput={setInput}
            onConnectLiveKit={connectLiveKit}
            onConnectOpenAiRealtime={connectOpenAiRealtime}
            onSend={sendMessage}
            didStatus={didStatus}
            didVideoRef={didVideoRef}
            didPoster={getDidAvatarSource()}
            didDebug={didDebug}
            onConnectDidStream={connectDidStream}
          />
        )}

        {section === "knowledge" && (
          <KnowledgeView
            items={knowledge}
            settings={settings}
            setSettings={setSettings}
            onDelete={deleteKnowledge}
            onSave={saveServerConfig}
            onUpload={uploadKnowledge}
            strict={settings.strictKnowledge}
          />
        )}

        {section === "providers" && (
          <ProviderView
            settings={settings}
            setSettings={setSettings}
            updateProvider={updateProvider}
            onAvatarUrl={saveReadyPlayerAvatar}
            onOpenAvatarCreator={() => setAvatarCreatorOpen(true)}
          />
        )}
      </section>

      {avatarCreatorOpen && (
        <AvatarCreatorModal
          draft={avatarUrlDraft}
          onChangeDraft={setAvatarUrlDraft}
          onClose={() => setAvatarCreatorOpen(false)}
          onSave={() => saveReadyPlayerAvatar(avatarUrlDraft)}
          onUpload={uploadAvatarModel}
        />
      )}
    </main>
  );
}

function SettingsView({
  activeProvider,
  health,
  notice,
  settings,
  setSettings,
  updateProvider,
  onSave,
}: {
  activeProvider: (typeof providerCatalog)[number];
  health: BackendHealth | null;
  notice: string;
  settings: AppSettings;
  setSettings: (settings: AppSettings | ((current: AppSettings) => AppSettings)) => void;
  updateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
  onSave: () => void;
}) {
  return (
    <div className="ops-grid">
      <section className="ops-panel wide">
        <div className="panel-title">
          <div>
            <p>Configuracion obligatoria</p>
            <h2>Empresa, proveedor, modelo y llaves</h2>
          </div>
          <button className="primary-action" onClick={onSave} type="button">
            <Save size={18} />
            Guardar
          </button>
        </div>

        <div className="form-grid">
          <label>
            Empresa
            <input value={settings.company} onChange={(event) => setSettings((current) => ({ ...current, company: event.target.value }))} />
          </label>
          <label>
            IA principal
            <select value={settings.activeProvider} onChange={(event) => setSettings((current) => ({ ...current, activeProvider: event.target.value as ProviderId }))}>
              {providerCatalog.filter((provider) => provider.kind.includes("IA") || provider.id === "pipecat").map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </label>
          <label>
            Avatar
            <select value={settings.activeAvatarProvider} onChange={(event) => setSettings((current) => ({ ...current, activeAvatarProvider: event.target.value as ProviderId }))}>
              {providerCatalog.filter(isAvatarProvider).map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </label>
          <label className="check-row">
            <input checked={settings.strictKnowledge} type="checkbox" onChange={(event) => setSettings((current) => ({ ...current, strictKnowledge: event.target.checked }))} />
            Responder solo con documentos aprobados
          </label>
        </div>

        <div className="config-section">
          <h3>Infraestructura realtime</h3>
          <ProviderCredentials id="livekit" settings={settings} updateProvider={updateProvider} />
          <ProviderCredentials id="pipecat" settings={settings} updateProvider={updateProvider} />
        </div>

        <div className="config-section">
          <h3>Empresas de IA y voz</h3>
          <ProviderCredentials id="openai" settings={settings} updateProvider={updateProvider} />
          <ProviderCredentials id="gemini" settings={settings} updateProvider={updateProvider} />
          <ProviderCredentials id="elevenlabs" settings={settings} updateProvider={updateProvider} />
        </div>

        <div className="config-section">
          <h3>Avatares realtime</h3>
          <ProviderCredentials id="heygen" settings={settings} updateProvider={updateProvider} />
          <ProviderCredentials id="did" settings={settings} updateProvider={updateProvider} />
        </div>

        {notice && <div className="notice">{notice}</div>}
      </section>

      <section className="ops-panel">
        <div className="provider-summary">
          <div className="summary-icon"><Bot size={26} /></div>
          <p>{activeProvider.kind}</p>
          <h2>{activeProvider.name}</h2>
          <span>{activeProvider.use}</span>
        </div>
        <div className="status-list">
          <Status label="Backend" ok={Boolean(health?.ok)} />
          <Status label="LiveKit" ok={Boolean(settings.providers.livekit.url && settings.providers.livekit.apiKey && settings.providers.livekit.apiSecret)} />
          <Status label="IA activa" ok={Boolean(settings.providers[settings.activeProvider].apiKey || settings.activeProvider === "pipecat")} />
          <Status label="Avatar" ok={Boolean(settings.providers[settings.activeAvatarProvider].apiKey)} />
        </div>
      </section>
    </div>
  );
}

function ProviderCredentials({
  id,
  settings,
  updateProvider,
}: {
  id: ProviderId;
  settings: AppSettings;
  updateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
}) {
  const provider = providerCatalog.find((item) => item.id === id)!;
  const config = settings.providers[id];
  return (
    <div className="credential-block">
      <div className="credential-head">
        <div>
          <p>{provider.kind}</p>
          <h3>{provider.name}</h3>
        </div>
        <label className="switch">
          <input checked={config.enabled} type="checkbox" onChange={(event) => updateProvider(id, { enabled: event.target.checked })} />
          Activo
        </label>
      </div>
      <div className="form-grid compact">
        {(id === "livekit" || id === "pipecat") && (
          <label>
            URL / endpoint
            <input value={config.url || ""} placeholder={id === "livekit" ? "wss://xxx.livekit.cloud" : "http://localhost:7860"} onChange={(event) => updateProvider(id, { url: event.target.value })} />
          </label>
        )}
        <label>
          Modelo
          <input value={config.model} placeholder={provider.defaultModel} onChange={(event) => updateProvider(id, { model: event.target.value })} />
        </label>
        <label>
          API key
          <input value={config.apiKey} placeholder="Pega la llave del usuario" type="password" onChange={(event) => updateProvider(id, { apiKey: event.target.value })} />
        </label>
        {id === "livekit" && (
          <label>
            API secret
            <input value={config.apiSecret || ""} placeholder="LiveKit API secret" type="password" onChange={(event) => updateProvider(id, { apiSecret: event.target.value })} />
          </label>
        )}
        {(id === "elevenlabs") && (
          <label>
            Voz
            <input value={config.voice || ""} placeholder="Voice ID o nombre" onChange={(event) => updateProvider(id, { voice: event.target.value })} />
          </label>
        )}
        {(id === "heygen" || id === "did" || id === "talkinghead" || id === "readyplayerme") && (
          <label>
            Avatar / Agent ID
            <input
              value={id === "did" ? config.agent || "" : config.avatar || ""}
              placeholder={id === "talkinghead" || id === "readyplayerme" ? "URL .glb de Ready Player Me" : "ID del avatar/agente"}
              onChange={(event) => updateProvider(id, id === "did" ? { agent: event.target.value } : { avatar: event.target.value })}
            />
          </label>
        )}
        {id === "livekit" && (
          <label>
            Agent name
            <input value={config.agentName || ""} placeholder="Opcional" onChange={(event) => updateProvider(id, { agentName: event.target.value })} />
          </label>
        )}
      </div>
      <div className="key-line">
        <KeyRound size={15} />
        <span>{mask(config.apiKey)}</span>
      </div>
    </div>
  );
}

function SessionView({
  activeProvider,
  input,
  liveKitStatus,
  messages,
  notice,
  onAvatarUrl,
  openAiRealtimeStatus,
  onOpenAvatarCreator,
  remoteParticipants,
  settings,
  selectedBuiltInAvatar,
  onSelectBuiltInAvatar,
  onSelectAvatar,
  voiceSource,
  setInput,
  onConnectLiveKit,
  onConnectOpenAiRealtime,
  onSend,
  didStatus,
  didVideoRef,
  didPoster,
  didDebug,
  onConnectDidStream,
}: {
  activeProvider: (typeof providerCatalog)[number];
  input: string;
  liveKitStatus: LiveKitStatus;
  messages: Message[];
  notice: string;
  onAvatarUrl: (url: string) => void;
  openAiRealtimeStatus: RealtimeStatus;
  onOpenAvatarCreator: () => void;
  remoteParticipants: number;
  settings: AppSettings;
  selectedBuiltInAvatar: string;
  onSelectBuiltInAvatar: (id: string) => void;
  onSelectAvatar: (choice: (typeof avatarChoices)[number]) => void;
  voiceSource: "none" | "browser" | "openai" | "livekit-agent";
  setInput: (value: string) => void;
  onConnectLiveKit: () => void;
  onConnectOpenAiRealtime: () => void;
  onSend: (event?: FormEvent) => void;
  didStatus: "disconnected" | "connecting" | "connected" | "error";
  didVideoRef: React.RefObject<HTMLVideoElement | null>;
  didPoster: string;
  didDebug: DidDebug;
  onConnectDidStream: () => void;
}) {
  const currentAvatar = builtInAvatars.find((a) => a.id === selectedBuiltInAvatar) || builtInAvatars[0];
  const activeAvatarValue = getActiveAvatarValue(settings);
  
  // If user entered a custom external URL in the advanced section, use it. Otherwise use the built-in 3D model.
  const isCustomAdvanced = settings.activeAvatarProvider === "readyplayerme" && activeAvatarValue !== "";
  const activeModelUrl = isCustomAdvanced ? activeAvatarValue : currentAvatar.modelUrl;
  
  const isSpeaking = voiceSource !== "none";

  return (
    <div className="session-grid">
      <section className="ops-panel session-main">
        {/* ── Toolbar ── */}
        <div className="panel-title">
          <div>
            <p>Sala de capacitación en vivo</p>
            <h2>{activeProvider.name} · {settings.providers[settings.activeProvider].model}</h2>
          </div>
          <div className="header-actions">
            {settings.activeAvatarProvider === "did" && (
              <button className={didStatus === "connected" ? "danger-action" : "primary-action"} onClick={onConnectDidStream} type="button">
                <Video size={16} />
                {didStatus === "connected" ? "Desconectar D-ID" : didStatus === "connecting" ? "Conectando…" : "Conectar D-ID"}
              </button>
            )}
            <button className={liveKitStatus === "connected" ? "danger-action" : "secondary-action"} onClick={onConnectLiveKit} type="button">
              <Radio size={16} />
              {liveKitStatus === "connected" ? "Desconectar" : liveKitStatus === "connecting" ? "Conectando…" : "LiveKit"}
            </button>
            <button className={openAiRealtimeStatus === "connected" ? "danger-action" : "secondary-action"} onClick={onConnectOpenAiRealtime} type="button">
              <Mic size={16} />
              {openAiRealtimeStatus === "connected" ? "Desconectar voz" : openAiRealtimeStatus === "connecting" ? "Conectando…" : "Voz IA"}
            </button>
          </div>
        </div>

        {notice && <div className="notice danger">{notice}</div>}

        {/* ── Main Content: Avatar (large) + Chat (sidebar) ── */}
        <div className="session-content">
          {/* Left: Avatar Stage — THE STAR */}
          <div className="avatar-stage">
            {settings.activeAvatarProvider === "did" ? (
              <video
                ref={didVideoRef}
                className="avatar-video"
                autoPlay
                playsInline
                poster={didPoster}
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "12px", background: "#0f172a" }}
              />
            ) : (
              <ModelViewer
                alt="Avatar 3D interactivo"
                className={`avatar-model ${isSpeaking ? "speaking-3d" : ""}`}
                src={activeModelUrl}
                auto-rotate
                camera-controls
              />
            )}
            <div>
              <strong>{settings.activeAvatarProvider === "did" ? "Avatar D-ID Humano Real" : isCustomAdvanced ? "Modelo 3D Personalizado" : currentAvatar.name}</strong>
              <span>{settings.activeAvatarProvider === "did" ? "Videollamada interactiva en tiempo real" : isCustomAdvanced ? activeModelUrl : currentAvatar.description}</span>
            </div>
          </div>

          {/* Right: Chat Panel */}
          <div className="session-chat-panel">
            <div className="chat-header">
              <MessageSquare size={16} />
              <h3>Chat de capacitación</h3>
            </div>
            <div className="message-list">
              {messages.map((message) => (
                <article className={`msg ${message.role}`} key={message.id}>
                  <strong>{message.role === "assistant" ? "IA" : message.role === "user" ? "Tú" : "Sistema"}</strong>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            <form className="composer" onSubmit={onSend}>
              <input value={input} aria-label="Mensaje para el instructor" placeholder="Escribe tu pregunta…" onChange={(event) => setInput(event.target.value)} />
              <button className="primary-action" type="submit">
                <ChevronRight size={16} />
              </button>
            </form>
          </div>
        </div>

        {/* ── Runtime Status ── */}
        <div className="runtime-strip">
          <span className={liveKitStatus === "connected" ? "runtime-pill ok" : "runtime-pill"}>
            LiveKit: {liveKitStatus === "connected" ? "conectado" : liveKitStatus}
          </span>
          {settings.activeAvatarProvider === "did" && (
            <span className={didStatus === "connected" ? "runtime-pill ok" : "runtime-pill"}>
              D-ID: {didStatus === "connected" ? "transmitiendo" : didStatus}
            </span>
          )}
          <span className={openAiRealtimeStatus === "connected" ? "runtime-pill ok" : "runtime-pill"}>
            Voz IA: {openAiRealtimeStatus === "connected" ? "activa" : openAiRealtimeStatus}
          </span>
          <span className={voiceSource !== "none" ? "runtime-pill ok" : "runtime-pill warn"}>
            Audio: {voiceSourceLabel(voiceSource)}
          </span>
        </div>

        {settings.activeAvatarProvider === "did" && (
          <div className="did-debug-panel">
            <strong>Diagnostico D-ID</strong>
            <span>Estado: {didStatus}</span>
            <span>Paso: {didDebug.lastStep}</span>
            <span>WebRTC: {didDebug.connection} / ICE: {didDebug.ice}</span>
            <span>Video: {didDebug.video}</span>
            <span>Habla: {didDebug.lastSpeech}</span>
            <span>Stream: {didDebug.streamId || "sin id"} / Session: {didDebug.sessionId || "sin id"}</span>
            {didDebug.error && <em>Error: {didDebug.error}</em>}
          </div>
        )}

        {/* ── Instructor Gallery (compact) ── */}
        <div className="gallery-section-title">
          <Bot size={14} />
          Elige tu instructor
          <span className="gallery-divider" />
        </div>
        <div className="builtin-avatar-gallery">
          {builtInAvatars.map((avatar) => (
            <button
              className={`builtin-avatar-card${selectedBuiltInAvatar === avatar.id ? " selected" : ""}`}
              key={avatar.id}
              onClick={() => onSelectBuiltInAvatar(avatar.id)}
              type="button"
            >
              <div className="builtin-avatar-portrait">
                <img src={avatar.image} alt={avatar.name} />
              </div>
              <strong>{avatar.name}</strong>
              <small>{avatar.role}</small>
              <span className="builtin-avatar-badge">✦ Gratuito</span>
            </button>
          ))}
        </div>

        {/* ── Advanced: 3D / Premium Avatars ── */}
        <div className="gallery-section-title">
          <Video size={14} />
          Avanzado: 3D y premium
          <span className="gallery-divider" />
        </div>
        <div className="avatar-picker">
          {avatarChoices.map((choice) => {
            const selected =
              settings.activeAvatarProvider === choice.provider &&
              (choice.value ? getActiveAvatarValue(settings) === choice.value : false);
            return (
              <button className={selected ? "avatar-choice selected" : "avatar-choice"} key={choice.id} onClick={() => onSelectAvatar(choice)} type="button">
                <AvatarPreview id={choice.provider} />
                <span>{choice.name}</span>
                <small>{choice.label}</small>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function KnowledgeView({
  items,
  onDelete,
  onSave,
  onUpload,
  settings,
  setSettings,
  strict,
}: {
  items: KnowledgeItem[];
  onDelete: (id: number) => void;
  onSave: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  settings: AppSettings;
  setSettings: (settings: AppSettings | ((current: AppSettings) => AppSettings)) => void;
  strict: boolean;
}) {
  return (
    <div className="ops-grid">
      <section className="ops-panel wide">
        <div className="panel-title">
          <div>
            <p>Assistant</p>
            <h2>Prompt, instrucciones y comportamiento</h2>
          </div>
          <button className="primary-action" onClick={onSave} type="button">
            <Save size={18} />
            Guardar prompt
          </button>
        </div>
        <div className="assistant-editor">
          <label>
            Nombre del asistente
            <input value={settings.assistantName} onChange={(event) => setSettings((current) => ({ ...current, assistantName: event.target.value }))} />
          </label>
          <label>
            System instructions
            <textarea
              value={settings.systemInstructions}
              onChange={(event) => setSettings((current) => ({ ...current, systemInstructions: event.target.value }))}
            />
          </label>
        </div>

        <div className="panel-title">
          <div>
            <p>Centro de conocimiento</p>
            <h2>RAG local: documentos, fragmentos y fuentes</h2>
          </div>
          <label className="upload-action">
            <Upload size={18} />
            Subir
            <input multiple type="file" onChange={onUpload} />
          </label>
        </div>
        <div className="data-table">
          {items.map((item) => (
            <article key={item.id}>
              <FileText size={18} />
              <div>
                <strong>{item.title}</strong>
                <span>{item.type} · {item.owner}</span>
              </div>
              <span className="pill">{item.status}</span>
              <span>{item.updated}</span>
              <button className="icon-danger" onClick={() => onDelete(item.id)} type="button" title="Borrar documento">
                <Trash2 size={16} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="ops-panel">
        <ShieldCheck size={28} />
        <h2>{strict ? "RAG estricto activo" : "RAG abierto"}</h2>
        <p className="muted">Los documentos se guardan en backend local, se fragmentan y se recuperan por búsqueda para alimentar OpenAI.</p>
        <div className="rag-stats">
          <strong>{items.length}</strong>
          <span>documentos indexados</span>
        </div>
      </section>
    </div>
  );
}

function ProviderView({
  onAvatarUrl,
  onOpenAvatarCreator,
  settings,
  setSettings,
  updateProvider,
}: {
  onAvatarUrl: (url: string) => void;
  onOpenAvatarCreator: () => void;
  settings: AppSettings;
  setSettings: (settings: AppSettings | ((current: AppSettings) => AppSettings)) => void;
  updateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => void;
}) {
  const avatarProviders = providerCatalog.filter(isAvatarProvider);
  const integrationProviders = providerCatalog.filter((provider) => !isAvatarProvider(provider));
  return (
    <div className="providers-layout">
      <section className="ops-panel">
        <div className="panel-title">
          <div>
            <p>Avatares</p>
            <h2>Gratis y premium</h2>
          </div>
        </div>
        <div className="avatar-provider-grid">
          {avatarProviders.map((provider) => {
            const config = settings.providers[provider.id];
            const selected = settings.activeAvatarProvider === provider.id;
            return (
              <article className={selected ? "avatar-provider selected" : "avatar-provider"} key={provider.id}>
                <div className="avatar-preview">
                  {provider.id === "readyplayerme" && isModelUrl(config.avatar) ? (
                    <ModelViewer
                      alt="Avatar Ready Player Me"
                      className="provider-avatar-model"
                      src={config.avatar}
                    />
                  ) : (
                    <AvatarPreview id={provider.id} />
                  )}
                </div>
                <div>
                  <p>{provider.kind}</p>
                  <h2>{provider.name}</h2>
                  <span>{provider.use}</span>
                </div>
                <label>
                  Avatar URL / ID
                  {provider.id === "readyplayerme" ? (
                    <input
                      defaultValue={config.avatar || ""}
                      placeholder="URL .glb Ready Player Me"
                      onBlur={(event) => onAvatarUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onAvatarUrl(event.currentTarget.value);
                      }}
                    />
                  ) : (
                    <input
                      value={provider.id === "did" ? config.agent || "" : config.avatar || ""}
                      placeholder={provider.id === "heygen" ? "avatar_id de HeyGen" : provider.id === "did" ? "agent_id de D-ID" : "URL .glb Ready Player Me"}
                      onChange={(event) => updateProvider(provider.id, provider.id === "did" ? { agent: event.target.value } : { avatar: event.target.value })}
                    />
                  )}
                </label>
                {provider.id === "readyplayerme" && (
                  <button className="secondary-action" type="button" onClick={onOpenAvatarCreator}>
                    Abrir creador 3D
                  </button>
                )}
                <button className="primary-action" type="button" onClick={() => setSettings((current) => ({ ...current, activeAvatarProvider: provider.id }))}>
                  {selected ? "Seleccionado" : "Usar avatar"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="provider-grid">
      {integrationProviders.map((provider) => {
        const config = settings.providers[provider.id];
        const selected = settings.activeProvider === provider.id || settings.activeAvatarProvider === provider.id;
        return (
          <article className={selected ? "provider-card selected" : "provider-card"} key={provider.id}>
            <div>
              <p>{provider.kind}</p>
              <h2>{provider.name}</h2>
              <span>{provider.use}</span>
            </div>
            <div className="need-list">
              {provider.needs.map((need) => <span key={need}>{need}</span>)}
            </div>
            <div className="provider-actions">
              <button className="secondary-action" type="button" onClick={() => updateProvider(provider.id, { enabled: !config.enabled })}>
                {config.enabled ? "Desactivar" : "Activar"}
              </button>
              {(provider.kind.includes("IA") || provider.id === "pipecat") && (
                <button className="primary-action" type="button" onClick={() => setSettings((current) => ({ ...current, activeProvider: provider.id }))}>
                  Usar IA
                </button>
              )}
              {isAvatarProvider(provider) && (
                <button className="primary-action" type="button" onClick={() => setSettings((current) => ({ ...current, activeAvatarProvider: provider.id }))}>
                  Usar avatar
                </button>
              )}
            </div>
          </article>
        );
      })}
      </section>
    </div>
  );
}

function AvatarCreatorModal({
  draft,
  onChangeDraft,
  onClose,
  onSave,
  onUpload,
}: {
  draft: string;
  onChangeDraft: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onUpload: (file: File) => void;
}) {
  return (
    <div className="avatar-modal-backdrop" role="dialog" aria-modal="true" aria-label="Creador de avatar 3D">
      <section className="avatar-modal">
        <div className="avatar-modal-head">
          <div>
            <p>Avatar 3D</p>
            <h2>Carga un avatar real</h2>
          </div>
          <div className="modal-actions">
            <button className="secondary-action" onClick={() => window.open("https://readyplayer.me/avatar", "_blank", "noopener,noreferrer")} type="button">
              Ready Player Me
            </button>
            <button className="secondary-action" onClick={() => window.open("https://app.heygen.com", "_blank", "noopener,noreferrer")} type="button">
              HeyGen
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Cerrar creador">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="avatar-loader-panel">
          <div className="loader-card">
            <strong>Archivo GLB local</strong>
            <span>Descarga un avatar en formato .glb y subelo aqui. Queda servido por el backend local.</span>
            <label className="upload-action">
              <Upload size={18} />
              Subir .glb
              <input
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                }}
              />
            </label>
          </div>
          <div className="loader-card">
            <strong>URL de avatar</strong>
            <span>Pega una URL directa a un .glb. Sirve para Ready Player Me, tu CDN o un archivo publico.</span>
            <label>
              URL del avatar .glb
              <input
                value={draft}
                placeholder="https://.../avatar.glb"
                onChange={(event) => onChangeDraft(event.target.value)}
              />
            </label>
            <button className="primary-action" onClick={onSave} type="button">
              Usar URL
            </button>
          </div>
          <div className="loader-card premium">
            <strong>Avatar realista con voz</strong>
            <span>Para video-avatar humano real, usa HeyGen o D-ID con API key y avatar_id. Eso no es gratis de forma seria.</span>
            <a href="https://developers.heygen.com/docs/quick-start" target="_blank" rel="noreferrer">Ver API de HeyGen</a>
          </div>
        </div>
        <div className="avatar-url-capture">
          <label>
            Avatar seleccionado
            <input
              value={draft}
              placeholder="Sin avatar cargado"
              onChange={(event) => onChangeDraft(event.target.value)}
            />
          </label>
          <button className="primary-action" onClick={onSave} type="button">
            Usar este avatar
          </button>
        </div>
      </section>
    </div>
  );
}

function isAvatarProvider(provider: (typeof providerCatalog)[number]) {
  return provider.kind.includes("Avatar");
}

function voiceSourceLabel(source: "none" | "browser" | "openai" | "livekit-agent") {
  if (source === "openai") return "OpenAI Realtime";
  if (source === "browser") return "Navegador";
  if (source === "livekit-agent") return "Agente LiveKit";
  return "Ninguna";
}

function ModelViewer({ alt, className, src }: { alt: string; className: string; src?: string }) {
  const viewerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !src) return;
    viewer.setAttribute("src", avatarAssetUrl(src));
    viewer.setAttribute("alt", alt);
    viewer.setAttribute("camera-controls", "");
    // Centrar la cámara exactamente en el rostro (1.55m de altura) con zoom cercano (1.2m)
    viewer.setAttribute("camera-target", "0m 1.55m 0m");
    viewer.setAttribute("camera-orbit", "0deg 85deg 1.2m");
    viewer.setAttribute("field-of-view", "30deg");
    viewer.setAttribute("shadow-intensity", "1");
    viewer.setAttribute("exposure", "1.2");
    // Añadimos interpolación suave
    viewer.setAttribute("interpolation-decay", "200");
    viewer.setAttribute("min-camera-orbit", "auto auto 0.8m");
    viewer.setAttribute("max-camera-orbit", "auto auto 2.5m");
  }, [alt, src]);

  return <model-viewer ref={viewerRef} class={className} />;
}

function AvatarPreview({ id }: { id: ProviderId }) {
  const avatar = avatarChoices.find((choice) => choice.provider === id);
  if (!avatar) return <span className="provider-mark">AI</span>;
  const code = id === "readyplayerme" ? "3D" : id === "talkinghead" ? "TH" : id === "heygen" ? "HG" : id === "did" ? "D-ID" : "AI";
  return (
    <span className={`provider-mark ${avatar.style}`}>
      {code}
    </span>
  );
}

function Status({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="status-row">
      {ok ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
      <div>
        <strong>{label}</strong>
        <span>{detail || (ok ? "Listo" : "Pendiente")}</span>
      </div>
    </div>
  );
}
