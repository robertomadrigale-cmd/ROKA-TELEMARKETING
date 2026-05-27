import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import OpenAI from "openai";
import twilio from "twilio";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const localConfigPath = path.join(serverDir, "provider-config.local.json");
const localKnowledgePath = path.join(serverDir, "knowledge.local.json");
const localAvatarDir = path.join(serverDir, "avatar-files.local");
const providerKeys = ["livekit", "openai", "gemini", "elevenlabs", "heygen", "did", "talkinghead", "readyplayerme", "twilio", "whatsapp", "telegram"];
const secretFields = new Set(["apiKey", "apiSecret", "webhookAuthToken", "apiKeySid", "apiKeySecret", "accountSid", "bridgeToken"]);
const providerCatalog = {
  livekit: {
    name: "LiveKit",
    required: ["url", "apiKey", "apiSecret"],
    fields: {
      url: "LiveKit URL",
      apiKey: "LiveKit API key",
      apiSecret: "LiveKit API secret",
      agentName: "LiveKit agent name",
    },
  },
  openai: {
    name: "OpenAI",
    required: ["apiKey", "model"],
    fields: {
      apiKey: "OpenAI key",
      model: "OpenAI model",
    },
  },
  gemini: {
    name: "Gemini",
    required: ["apiKey", "model"],
    fields: {
      apiKey: "Gemini key",
      model: "Gemini model",
    },
  },
  elevenlabs: {
    name: "ElevenLabs",
    required: ["apiKey", "voice"],
    fields: {
      apiKey: "ElevenLabs key",
      voice: "ElevenLabs voice",
    },
  },
  heygen: {
    name: "HeyGen",
    required: ["apiKey", "avatar"],
    fields: {
      apiKey: "HeyGen key",
      avatar: "HeyGen avatar",
    },
  },
  did: {
    name: "D-ID",
    required: ["apiKey"],
    fields: {
      apiKey: "D-ID key",
      agent: "D-ID agent",
    },
  },
  talkinghead: {
    name: "TalkingHead",
    required: [],
    fields: {
      avatar: "Ready Player Me avatar URL",
    },
  },
  readyplayerme: {
    name: "Ready Player Me",
    required: [],
    fields: {
      avatar: "Ready Player Me avatar URL",
    },
  },
  twilio: {
    name: "Twilio Voice",
    required: ["accountSid", "apiKeySid", "apiKeySecret", "twimlAppSid", "phoneNumber"],
    fields: {
      accountSid: "Twilio account SID",
      apiKeySid: "Twilio API key SID",
      apiKeySecret: "Twilio API key secret",
      twimlAppSid: "Twilio TwiML App SID",
      phoneNumber: "Twilio number",
      webhookAuthToken: "Twilio webhook auth token",
      callerName: "Caller name",
      crmBridgeUrl: "CRM bridge URL",
      bridgeToken: "CRM bridge token",
      organizationId: "CRM organization id",
      allowedOrigins: "Allowed origins CSV",
    },
  },
  whatsapp: {
    name: "WhatsApp",
    required: ["provider", "from"],
    fields: {
      provider: "Provider (twilio)",
      from: "Numero origen WhatsApp",
      apiKey: "API key/provider token",
    },
  },
  telegram: {
    name: "Telegram",
    required: ["botToken"],
    fields: {
      botToken: "Telegram bot token",
      defaultChatId: "Chat id por defecto",
    },
  },
};
const emptyProviderConfig = {
  livekit: { url: "", apiKey: "", apiSecret: "", agentName: "" },
  openai: { apiKey: "", model: "" },
  gemini: { apiKey: "", model: "" },
  elevenlabs: { apiKey: "", voice: "" },
  heygen: { apiKey: "", avatar: "" },
  did: { apiKey: "", agent: "" },
  talkinghead: { avatar: "" },
  readyplayerme: { avatar: "" },
  twilio: {
    model: "voice-central",
    apiKey: "",
    accountSid: "",
    apiKeySid: "",
    apiKeySecret: "",
    twimlAppSid: "",
    phoneNumber: "",
    webhookAuthToken: "",
    callerName: "ROKA Agente",
    crmBridgeUrl: "",
    bridgeToken: "",
    organizationId: "",
    allowedOrigins: "",
  },
  whatsapp: {
    model: "messaging",
    enabled: false,
    apiKey: "",
    provider: "twilio",
    from: "",
  },
  telegram: {
    model: "messaging",
    enabled: false,
    apiKey: "",
    botToken: "",
    defaultChatId: "",
  },
};
const envConfig = {
  version: 1,
  company: process.env.DEFAULT_COMPANY || "ROKA",
  assistantName: process.env.ASSISTANT_NAME || "Agente ROKA",
  systemInstructions:
    process.env.SYSTEM_INSTRUCTIONS ||
    "Eres un asistente comercial de telemarketing. Tu objetivo es convertir, calificar y agendar seguimiento con datos del CRM.",
  strictKnowledge: false,
  activeProvider: process.env.DEFAULT_AI_PROVIDER || "openai",
  activeAvatarProvider: process.env.DEFAULT_AVATAR_PROVIDER || "talkinghead",
  providers: {
    livekit: {
      url: process.env.LIVEKIT_URL || "",
      apiKey: process.env.LIVEKIT_API_KEY || "",
      apiSecret: process.env.LIVEKIT_API_SECRET || "",
      agentName: process.env.LIVEKIT_AGENT_NAME || "",
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      model: process.env.OPENAI_MODEL || "",
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
      model: process.env.GEMINI_MODEL || "",
    },
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY || "",
      voice: process.env.ELEVENLABS_VOICE || process.env.ELEVENLABS_VOICE_ID || "",
    },
    heygen: {
      apiKey: process.env.HEYGEN_API_KEY || "",
      avatar: process.env.HEYGEN_AVATAR || process.env.HEYGEN_AVATAR_ID || "",
    },
    did: {
      apiKey: process.env.D_ID_API_KEY || "",
      agent: process.env.D_ID_AGENT || process.env.D_ID_AGENT_ID || "",
    },
    talkinghead: {
      avatar: process.env.TALKINGHEAD_AVATAR || "",
    },
    readyplayerme: {
      avatar: process.env.READYPLAYERME_AVATAR || "",
    },
    twilio: {
      model: "voice-central",
      apiKey: "",
      accountSid: process.env.TWILIO_ACCOUNT_SID || "",
      apiKeySid: process.env.TWILIO_API_KEY_SID || "",
      apiKeySecret: process.env.TWILIO_API_KEY_SECRET || "",
      twimlAppSid: process.env.TWILIO_TWIML_APP_SID || "",
      phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
      webhookAuthToken: process.env.TWILIO_WEBHOOK_AUTH_TOKEN || "",
      callerName: process.env.TWILIO_CALLER_NAME || "ROKA Agente",
      crmBridgeUrl: process.env.CRM_BRIDGE_URL || "",
      bridgeToken: process.env.CRM_BRIDGE_TOKEN || "",
      organizationId: process.env.CRM_ORGANIZATION_ID || "",
      allowedOrigins: process.env.CRM_ALLOWED_ORIGINS || "",
    },
    whatsapp: {
      model: "messaging",
      enabled: false,
      apiKey: process.env.WHATSAPP_API_KEY || "",
      provider: process.env.WHATSAPP_PROVIDER || "twilio",
      from: process.env.WHATSAPP_FROM || "",
    },
    telegram: {
      model: "messaging",
      enabled: false,
      apiKey: "",
      botToken: process.env.TELEGRAM_BOT_TOKEN || "",
      defaultChatId: process.env.TELEGRAM_DEFAULT_CHAT_ID || "",
    },
  },
};
const starterKnowledge = [
  {
    id: 1,
    title: "Induccion operativa ROKA",
    type: "Curso",
    owner: "RH",
    status: "Indexado",
    updated: "Inicial",
    content: "Bienvenida, politicas basicas, seguridad general y evaluacion inicial.",
  },
  {
    id: 2,
    title: "Protocolos de seguridad industrial",
    type: "Manual",
    owner: "Seguridad",
    status: "Indexado",
    updated: "Inicial",
    content: "Uso de casco, lentes, chaleco, zonas restringidas, bloqueo y etiquetado.",
  },
];

app.use(cors());
app.use(express.text({ type: ["application/sdp", "text/plain"] }));
app.use(express.raw({ type: "application/octet-stream", limit: "50mb" }));
app.use(express.json({ limit: "10mb" }));

const telephonyState = {
  calls: new Map(),
};
const inboxState = {
  conversations: new Map(),
};
const authState = {
  firebaseIdToken: "",
};
const defaultAgent = "roka-agent-1";

function asString(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function getTwilioConfig(config) {
  return config.providers?.twilio || {};
}

function createTwilioClient(config) {
  const twilioConfig = getTwilioConfig(config);
  if (!twilioConfig.accountSid || !twilioConfig.apiKeySid || !twilioConfig.apiKeySecret) return null;
  return twilio(twilioConfig.apiKeySid, twilioConfig.apiKeySecret, { accountSid: twilioConfig.accountSid });
}

function parseAllowedOrigins(csvValue) {
  return String(csvValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function originAllowed(twilioConfig, origin) {
  const list = parseAllowedOrigins(twilioConfig.allowedOrigins);
  if (list.length === 0) return true;
  return list.includes(origin);
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d+]/g, "").trim();
}

async function fetchCrmBridge(config, payload) {
  const twilioConfig = getTwilioConfig(config);
  if (!twilioConfig.crmBridgeUrl || !twilioConfig.organizationId) {
    return { ok: false, error: "CRM bridge no configurado." };
  }
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-roka-local-link": "1",
    };
    if (twilioConfig.bridgeToken) {
      headers["x-roka-crm-token"] = twilioConfig.bridgeToken;
    }
    if (authState.firebaseIdToken) {
      headers.authorization = `Bearer ${authState.firebaseIdToken}`;
    }
    const response = await fetch(twilioConfig.crmBridgeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        organizationId: twilioConfig.organizationId,
        ...payload,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || "CRM bridge rechazo la solicitud.", data };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error CRM bridge." };
  }
}

app.post("/api/auth/firebase/session", async (req, res) => {
  const token = asString(req.body?.token, 6000);
  if (!token) {
    res.status(400).json({ error: "Token Firebase requerido." });
    return;
  }
  authState.firebaseIdToken = token;
  res.json({ ok: true });
});

app.delete("/api/auth/firebase/session", async (_req, res) => {
  authState.firebaseIdToken = "";
  res.json({ ok: true });
});

function upsertCallState(callSid, patch) {
  const current = telephonyState.calls.get(callSid) || {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  telephonyState.calls.set(callSid, next);
  return next;
}

function nowIso() {
  return new Date().toISOString();
}

function inferCustomerKey(customerRef = {}) {
  return customerRef.phone || customerRef.chatId || customerRef.crmEntityId || `unknown-${Date.now()}`;
}

function getOrCreateConversation(input = {}) {
  const customerRef = input.customerRef || {};
  const customerKey = inferCustomerKey(customerRef);
  let conversation = inboxState.conversations.get(customerKey);
  if (!conversation) {
    conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      customerKey,
      customerRef,
      assignedTo: input.assignedTo || defaultAgent,
      status: "new",
      lastChannel: input.channel || "voice",
      lastDirection: input.direction || "inbound",
      events: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      wrapUp: null,
    };
    inboxState.conversations.set(customerKey, conversation);
  }
  return conversation;
}

function appendConversationEvent(input = {}) {
  const conversation = getOrCreateConversation(input);
  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    channel: input.channel || "voice",
    direction: input.direction || "inbound",
    status: input.status || "active",
    text: asString(input.text || "", 4000),
    metadata: input.metadata || {},
    createdAt: nowIso(),
  };
  conversation.events.push(event);
  conversation.lastChannel = event.channel;
  conversation.lastDirection = event.direction;
  conversation.status = input.forceStatus || event.status || conversation.status;
  conversation.updatedAt = nowIso();
  inboxState.conversations.set(conversation.customerKey, conversation);
  return conversation;
}

function serializeScriptResponse(outputText) {
  const empty = {
    opening: "",
    discovery: "",
    objectionHandling: "",
    closing: "",
    nextSteps: "",
  };
  if (!outputText) return empty;
  try {
    const parsed = JSON.parse(outputText);
    return {
      opening: asString(parsed.opening, 2000),
      discovery: asString(parsed.discovery, 3000),
      objectionHandling: asString(parsed.objectionHandling, 3000),
      closing: asString(parsed.closing, 2000),
      nextSteps: asString(parsed.nextSteps, 2000),
    };
  } catch {
    return {
      opening: outputText,
      discovery: "",
      objectionHandling: "",
      closing: "",
      nextSteps: "",
    };
  }
}

function parseEnvAssignments(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
    if (match) result[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return result;
}

function extractAssignmentValue(value, key) {
  const text = asString(value);
  const parsed = parseEnvAssignments(text);
  if (parsed[key]) return parsed[key];
  const inline = text.match(new RegExp(`${key}\\s*=\\s*([^\\s]+)`));
  if (inline) return inline[1].trim().replace(/^["']|["']$/g, "");
  if (key === "LIVEKIT_URL") {
    const url = text.match(/wss?:\/\/[^\s]+/);
    if (url) return url[0];
  }
  return text;
}

function cloneProviders() {
  return JSON.parse(JSON.stringify(emptyProviderConfig));
}

function normalizeConfig(input = {}, base = {}) {
  const providers = cloneProviders();
  const baseProviders = base.providers && typeof base.providers === "object" ? base.providers : {};
  const inputProviders = input.providers && typeof input.providers === "object" ? input.providers : {};

  for (const key of providerKeys) {
    const allowedFields = Object.keys(emptyProviderConfig[key]);
    for (const field of allowedFields) {
      providers[key][field] = asString(inputProviders[key]?.[field] ?? input[key]?.[field] ?? baseProviders[key]?.[field] ?? "");
    }
  }

  const livekitEnv = parseEnvAssignments(
    [providers.livekit.url, providers.livekit.apiKey, providers.livekit.apiSecret, providers.livekit.agentName].join("\n"),
  );
  providers.livekit.url =
    livekitEnv.LIVEKIT_URL || extractAssignmentValue(providers.livekit.url, "LIVEKIT_URL");
  providers.livekit.apiKey =
    livekitEnv.LIVEKIT_API_KEY || extractAssignmentValue(providers.livekit.apiKey, "LIVEKIT_API_KEY");
  providers.livekit.apiSecret =
    livekitEnv.LIVEKIT_API_SECRET || extractAssignmentValue(providers.livekit.apiSecret, "LIVEKIT_API_SECRET");
  providers.livekit.agentName =
    livekitEnv.LIVEKIT_AGENT_NAME || extractAssignmentValue(providers.livekit.agentName, "LIVEKIT_AGENT_NAME");

  return {
    version: 1,
    company: asString(input.company ?? base.company ?? envConfig.company, 160) || "ROKA",
    assistantName: asString(input.assistantName ?? base.assistantName ?? envConfig.assistantName, 160) || "Agente ROKA",
    systemInstructions:
      asString(input.systemInstructions ?? base.systemInstructions ?? envConfig.systemInstructions, 12000) ||
      envConfig.systemInstructions,
    strictKnowledge:
      typeof input.strictKnowledge === "boolean"
        ? input.strictKnowledge
        : typeof base.strictKnowledge === "boolean"
          ? base.strictKnowledge
          : envConfig.strictKnowledge,
    activeProvider: providerKeys.includes(input.activeProvider) ? input.activeProvider : base.activeProvider || envConfig.activeProvider,
    activeAvatarProvider: providerKeys.includes(input.activeAvatarProvider)
      ? input.activeAvatarProvider
      : base.activeAvatarProvider || envConfig.activeAvatarProvider,
    providers,
    updatedAt: input.updatedAt && typeof input.updatedAt === "string" ? input.updatedAt : base.updatedAt || null,
  };
}

function mergeConfig(base, override) {
  const mergedProviders = cloneProviders();
  for (const key of providerKeys) {
    for (const field of Object.keys(emptyProviderConfig[key])) {
      mergedProviders[key][field] = override.providers?.[key]?.[field] || base.providers?.[key]?.[field] || "";
    }
  }

  return normalizeConfig({
    company: override.company || base.company,
    assistantName: override.assistantName || base.assistantName,
    systemInstructions: override.systemInstructions || base.systemInstructions,
    strictKnowledge: typeof override.strictKnowledge === "boolean" ? override.strictKnowledge : base.strictKnowledge,
    activeProvider: override.activeProvider || base.activeProvider,
    activeAvatarProvider: override.activeAvatarProvider || base.activeAvatarProvider,
    providers: mergedProviders,
    updatedAt: override.updatedAt || base.updatedAt,
  });
}

async function readLocalConfig() {
  if (!existsSync(localConfigPath)) return { config: null, error: null };

  try {
    const raw = await readFile(localConfigPath, "utf8");
    return { config: normalizeConfig(JSON.parse(raw)), error: null };
  } catch (error) {
    return { config: null, error };
  }
}

async function getEffectiveConfig() {
  const { config, error } = await readLocalConfig();
  if (error) throw error;
  return config ? mergeConfig(envConfig, config) : normalizeConfig(envConfig);
}

async function writeLocalConfig(config) {
  const normalized = normalizeConfig({ ...config, updatedAt: new Date().toISOString() });
  await mkdir(serverDir, { recursive: true });
  const tempPath = `${localConfigPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tempPath, localConfigPath);
  return normalized;
}

async function readKnowledge() {
  if (!existsSync(localKnowledgePath)) return starterKnowledge;
  try {
    const raw = await readFile(localKnowledgePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : starterKnowledge;
  } catch {
    return starterKnowledge;
  }
}

async function writeKnowledge(items) {
  await mkdir(serverDir, { recursive: true });
  const tempPath = `${localKnowledgePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
  await rename(tempPath, localKnowledgePath);
  return items;
}

function chunkText(text, max = 900) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks = [];
  for (let index = 0; index < clean.length; index += max) {
    chunks.push(clean.slice(index, index + max));
  }
  return chunks;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2);
}

function retrieveKnowledge(items, query, limit = 5) {
  const queryTerms = tokenize(query);
  const rows = [];
  for (const item of items.filter((doc) => doc.status === "Indexado")) {
    const chunks = chunkText(`${item.title}. ${item.content || ""}`);
    chunks.forEach((chunk, chunkIndex) => {
      const terms = tokenize(chunk);
      const score = queryTerms.reduce((sum, term) => sum + terms.filter((word) => word.includes(term)).length, 0);
      rows.push({ item, chunk, chunkIndex, score });
    });
  }
  return rows
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((row, index) => row.score > 0 || index < Math.min(2, rows.length));
}

function providerStatus(config) {
  return Object.fromEntries(
    providerKeys.map((key) => {
      const required = providerCatalog[key].required;
      const configured = required.every((field) => Boolean(config.providers[key]?.[field]));
      const missing = required.filter((field) => !config.providers[key]?.[field]);
      return [key, { configured, missing }];
    }),
  );
}

function publicConfig(config, includeSecrets = true) {
  const providers = cloneProviders();
  for (const key of providerKeys) {
    for (const field of Object.keys(emptyProviderConfig[key])) {
      const value = config.providers[key]?.[field] || "";
      providers[key][field] = includeSecrets || !secretFields.has(field) ? value : value ? "********" : "";
    }
  }

  return {
    version: config.version,
    company: config.company,
    assistantName: config.assistantName,
    systemInstructions: config.systemInstructions,
    strictKnowledge: config.strictKnowledge,
    activeProvider: config.activeProvider,
    activeAvatarProvider: config.activeAvatarProvider,
    providers,
    updatedAt: config.updatedAt,
  };
}

app.get("/api/health", async (_req, res) => {
  const config = await getEffectiveConfig();
  const status = providerStatus(config);
  res.json({
    ok: true,
    livekit: status.livekit.configured,
    providers: {
      openai: status.openai.configured,
      gemini: status.gemini.configured,
      elevenlabs: status.elevenlabs.configured,
      heygen: status.heygen.configured,
      did: status.did.configured,
      twilio: status.twilio.configured,
      whatsapp: status.whatsapp.configured,
      telegram: status.telegram.configured,
      talkinghead: true,
      readyplayerme: true,
    },
  });
});

app.get("/api/config/providers", async (_req, res) => {
  const config = await getEffectiveConfig();
  res.json({
    providers: providerCatalog,
    status: providerStatus(config),
    config: publicConfig(config, false),
    storage: {
      localJson: localConfigPath,
      exists: existsSync(localConfigPath),
    },
  });
});

app.get("/api/config", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    res.json({
      config: publicConfig(config, req.query.secrets !== "masked"),
      status: providerStatus(config),
      storage: {
        localJson: localConfigPath,
        exists: existsSync(localConfigPath),
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "No se pudo leer la configuracion local.",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.get("/api/avatar/proxy", async (req, res) => {
  try {
    const avatarUrl = new URL(String(req.query.url || ""));
    const allowed =
      avatarUrl.protocol === "https:" &&
      (avatarUrl.hostname === "models.readyplayer.me" ||
        avatarUrl.hostname.endsWith(".readyplayer.me") ||
        avatarUrl.hostname === "raw.githubusercontent.com") &&
      /\.(glb|gltf)$/i.test(avatarUrl.pathname);

    if (!allowed) {
      res.status(400).json({ error: "Avatar URL no permitida. Usa un GLB de Ready Player Me." });
      return;
    }

    const upstream = await fetch(avatarUrl);
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "No se pudo descargar el avatar 3D." });
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", avatarUrl.pathname.endsWith(".gltf") ? "model/gltf+json" : "model/gltf-binary");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch (error) {
    res.status(400).json({
      error: "Avatar URL invalida.",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.get("/api/avatar/local/:file", async (req, res) => {
  const file = path.basename(req.params.file || "");
  if (!/^[a-z0-9._-]+\.(glb|gltf)$/i.test(file)) {
    res.status(400).json({ error: "Archivo de avatar invalido." });
    return;
  }
  res.sendFile(path.join(localAvatarDir, file));
});

app.post("/api/avatar/upload", async (req, res) => {
  try {
    const original = String(req.query.name || "avatar.glb");
    const ext = path.extname(original).toLowerCase();
    if (![".glb", ".gltf"].includes(ext)) {
      res.status(400).json({ error: "Sube un archivo .glb o .gltf." });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length < 1) {
      res.status(400).json({ error: "Archivo vacio." });
      return;
    }
    await mkdir(localAvatarDir, { recursive: true });
    const safeName = `avatar-${Date.now()}${ext}`;
    await writeFile(path.join(localAvatarDir, safeName), req.body);
    res.json({ ok: true, url: `/api/avatar/local/${safeName}` });
  } catch (error) {
    res.status(400).json({
      error: "No se pudo guardar el avatar.",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.post("/api/config", async (req, res) => {
  try {
    const current = await getEffectiveConfig();
    const next = normalizeConfig(req.body?.config ?? req.body ?? {}, current);
    const saved = await writeLocalConfig(next);
    res.json({
      ok: true,
      config: publicConfig(saved),
      status: providerStatus(saved),
      storage: {
        localJson: localConfigPath,
        exists: true,
      },
    });
  } catch (error) {
    res.status(400).json({
      error: "No se pudo guardar la configuracion.",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.post("/api/livekit/token", async (req, res) => {
  const config = await getEffectiveConfig();
  const livekitUrl = config.providers.livekit.url;
  const apiKey = config.providers.livekit.apiKey;
  const apiSecret = config.providers.livekit.apiSecret;

  if (!livekitUrl || !apiKey || !apiSecret) {
    res.status(400).json({
      error: "LiveKit no esta configurado.",
      required: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
      hint: "Configuralo desde la UI via /api/config o copia .env.example a .env y agrega las credenciales.",
    });
    return;
  }

  const participantName = req.body?.participantName || "Usuario ROKA";
  const roomName = req.body?.roomName || `roka-training-${Date.now()}`;
  const identity = `roka-user-${Math.random().toString(16).slice(2)}`;
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: participantName,
    ttl: "30m",
  });

  token.addGrant({
    room: roomName,
    roomCreate: true,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  res.json({
    serverUrl: livekitUrl,
    roomName,
    participantName,
    participantToken: await token.toJwt(),
    agentName: config.providers.livekit.agentName || null,
  });
});

app.post("/api/livekit/verify", async (_req, res) => {
  try {
    const config = await getEffectiveConfig();
    const livekitUrl = config.providers.livekit.url;
    const apiKey = config.providers.livekit.apiKey;
    const apiSecret = config.providers.livekit.apiSecret;

    if (!livekitUrl || !apiKey || !apiSecret) {
      res.status(400).json({
        ok: false,
        error: "Faltan LiveKit URL, API key o API secret.",
      });
      return;
    }

    const service = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
    await service.listRooms([]);
    res.json({
      ok: true,
      serverUrl: livekitUrl,
      apiKeyPrefix: `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: "LiveKit rechazo las credenciales.",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.post("/api/telephony/token", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const twilioConfig = getTwilioConfig(config);
    const origin = String(req.get("origin") || "");
    if (!originAllowed(twilioConfig, origin)) {
      res.status(403).json({ error: "Origen no autorizado." });
      return;
    }
    if (!twilioConfig.accountSid || !twilioConfig.apiKeySid || !twilioConfig.apiKeySecret || !twilioConfig.twimlAppSid) {
      res.status(400).json({ error: "Twilio no esta configurado." });
      return;
    }
    const identity = asString(req.body?.identity || `agente-${Date.now()}`, 80);
    const voiceGrant = new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: twilioConfig.twimlAppSid,
      incomingAllow: true,
    });
    const token = new twilio.jwt.AccessToken(
      twilioConfig.accountSid,
      twilioConfig.apiKeySid,
      twilioConfig.apiKeySecret,
      { identity, ttl: 3600 },
    );
    token.addGrant(voiceGrant);
    res.json({ token: token.toJwt(), identity });
  } catch (error) {
    res.status(500).json({ error: "No se pudo crear token Twilio.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/telephony/call/outbound", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const client = createTwilioClient(config);
    const twilioConfig = getTwilioConfig(config);
    if (!client) {
      res.status(400).json({ error: "Twilio no esta configurado." });
      return;
    }
    const to = normalizePhone(req.body?.to);
    if (!to) {
      res.status(400).json({ error: "Numero destino invalido." });
      return;
    }
    const from = normalizePhone(req.body?.from || twilioConfig.phoneNumber);
    if (!from) {
      res.status(400).json({ error: "Numero origen no configurado." });
      return;
    }
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const call = await client.calls.create({
      to,
      from,
      url: `${baseUrl}/api/telephony/webhooks/voice?mode=outbound`,
      statusCallback: `${baseUrl}/api/telephony/webhooks/status`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });
  upsertCallState(call.sid, {
      callSid: call.sid,
      direction: "outbound",
      to,
      from,
      status: call.status,
      startedAt: new Date().toISOString(),
      customerPhone: to,
      customerName: asString(req.body?.customerName || "", 160),
  });
  const conversation = appendConversationEvent({
    channel: "voice",
    direction: "outbound",
    status: "active",
    text: `Llamada saliente iniciada a ${to}`,
    customerRef: { phone: to },
    metadata: { callSid: call.sid, status: call.status },
  });
  await fetchCrmBridge(config, {
    action: "upsertConversation",
    conversation: {
      external_id: conversation.id,
      customer_key: conversation.customerKey,
      channel: "voice",
      status: conversation.status,
      assigned_to: conversation.assignedTo,
      summary: `Llamada saliente iniciada a ${to}`,
      metadata: { callSid: call.sid },
    },
  });
  res.json({ ok: true, callSid: call.sid, status: call.status });
  } catch (error) {
    res.status(400).json({ error: "No se pudo originar la llamada.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/telephony/call/hangup", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const client = createTwilioClient(config);
    if (!client) {
      res.status(400).json({ error: "Twilio no esta configurado." });
      return;
    }
    const callSid = asString(req.body?.callSid, 120);
    if (!callSid) {
      res.status(400).json({ error: "callSid es requerido." });
      return;
    }
    await client.calls(callSid).update({ status: "completed" });
    const saved = upsertCallState(callSid, { status: "completed", endedAt: new Date().toISOString() });
    res.json({ ok: true, call: saved });
  } catch (error) {
    res.status(400).json({ error: "No se pudo colgar la llamada.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/telephony/personal-line/attempt", async (req, res) => {
  try {
    const to = normalizePhone(req.body?.to);
    if (!to) {
      res.status(400).json({ error: "Numero destino invalido." });
      return;
    }
    const customerRef = {
      phone: to,
      crmEntityType: asString(req.body?.crmEntityType || "contact", 40),
      crmEntityId: asString(req.body?.crmEntityId || "", 140) || undefined,
    };
    const conversation = appendConversationEvent({
      channel: "voice",
      direction: "outbound",
      status: "wrap_up_required",
      text: `Intento de llamada por linea personal a ${to}`,
      customerRef,
      metadata: {
        lineType: "personal_phone_link",
        initiatedAt: nowIso(),
      },
    });

    const config = await getEffectiveConfig();
    await fetchCrmBridge(config, {
      action: "logActivity",
      activity: {
        entityType: customerRef.crmEntityType,
        entityId: customerRef.crmEntityId || to,
        activityType: "call",
        title: "Intento de llamada (linea personal)",
        description: `Se inicio llamada personal (Phone Link) hacia ${to}.`,
        metadata: {
          channel: "voice",
          lineType: "personal_phone_link",
          conversationId: conversation.id,
        },
      },
    });

    res.json({ ok: true, conversationId: conversation.id });
  } catch (error) {
    res.status(500).json({ error: "No se pudo registrar intento de linea personal.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/telephony/webhooks/voice", async (req, res) => {
  const config = await getEffectiveConfig();
  const twilioConfig = getTwilioConfig(config);
  const signature = req.get("x-twilio-signature") || "";
  const rawToken = asString(req.body?.token || req.query?.token || "", 300);
  if (twilioConfig.webhookAuthToken && signature) {
    const valid = twilio.validateRequest(twilioConfig.webhookAuthToken, signature, `${req.protocol}://${req.get("host")}${req.originalUrl}`, req.body || {});
    if (!valid) {
      res.status(403).type("text/plain").send("Invalid signature");
      return;
    }
  } else if (twilioConfig.webhookAuthToken && rawToken !== twilioConfig.webhookAuthToken) {
    res.status(403).type("text/plain").send("Invalid token");
    return;
  }

  const voice = new twilio.twiml.VoiceResponse();
  const callSid = asString(req.body?.CallSid, 120);
  const from = normalizePhone(req.body?.From);
  const to = normalizePhone(req.body?.To);
  upsertCallState(callSid, {
    callSid,
    from,
    to,
    direction: req.body?.Direction || "inbound",
    status: req.body?.CallStatus || "ringing",
    customerPhone: from,
    startedAt: new Date().toISOString(),
  });
  const conversation = appendConversationEvent({
    channel: "voice",
    direction: String(req.body?.Direction || "").toLowerCase().includes("outbound") ? "outbound" : "inbound",
    status: "active",
    text: `Nueva llamada ${req.body?.CallStatus || "ringing"}`,
    customerRef: { phone: from || to },
    metadata: { callSid, from, to },
  });
  await fetchCrmBridge(config, {
    action: "upsertConversation",
    conversation: {
      external_id: conversation.id,
      customer_key: conversation.customerKey,
      channel: "voice",
      status: conversation.status,
      assigned_to: conversation.assignedTo,
      summary: `Nueva llamada ${req.body?.CallStatus || "ringing"}`,
      metadata: { callSid, from, to },
    },
  });
  voice.say({ voice: "alice", language: "es-MX" }, "Gracias por llamar a ROKA. Conectando con un agente.");
  voice.dial({ callerId: twilioConfig.phoneNumber || to, answerOnBridge: true }).client("roka-agent");
  res.type("text/xml").send(voice.toString());
});

app.post("/api/telephony/webhooks/status", async (req, res) => {
  const callSid = asString(req.body?.CallSid, 120);
  const status = asString(req.body?.CallStatus, 80);
  const duration = Number(req.body?.CallDuration || 0);
  const customerPhone = normalizePhone(req.body?.From);
  const saved = upsertCallState(callSid, {
    status,
    durationSec: duration,
    endedAt: ["completed", "busy", "failed", "no-answer", "canceled"].includes(status) ? new Date().toISOString() : undefined,
    customerPhone: customerPhone || undefined,
  });
  const conversation = appendConversationEvent({
    channel: "voice",
    direction: saved.direction || "inbound",
    status: ["completed", "busy", "failed", "no-answer", "canceled"].includes(status) ? "wrap_up_required" : "active",
    text: `Estado de llamada: ${status}`,
    customerRef: { phone: saved.customerPhone || customerPhone },
    metadata: { callSid, status, duration },
  });
  const config = await getEffectiveConfig();
  await fetchCrmBridge(config, {
    action: "upsertConversation",
    conversation: {
      external_id: conversation.id,
      customer_key: conversation.customerKey,
      channel: "voice",
      status: conversation.status,
      assigned_to: conversation.assignedTo,
      summary: `Estado de llamada: ${status}`,
      metadata: { callSid, status, duration },
    },
  });

  if (["completed", "busy", "failed", "no-answer", "canceled"].includes(status)) {
    await fetchCrmBridge(config, {
      action: "logActivity",
      activity: {
        entityType: saved.entityType || "lead",
        entityId: saved.entityId || saved.customerPhone || callSid,
        activityType: "call",
        title: `Llamada ${saved.direction === "outbound" ? "saliente" : "entrante"} ${status}`,
        description: `Duracion: ${duration}s. Telefono: ${saved.customerPhone || "N/D"}.`,
        metadata: {
          callSid,
          status,
          duration,
          direction: saved.direction || "unknown",
        },
      },
    });
  }

  res.json({ ok: true });
});

app.get("/api/telephony/calls/active", async (_req, res) => {
  const active = Array.from(telephonyState.calls.values()).filter((call) => !["completed", "busy", "failed", "no-answer", "canceled"].includes(call.status));
  res.json({ calls: active });
});

app.post("/api/crm/context/:entityType/:entityId", async (req, res) => {
  const config = await getEffectiveConfig();
  const entityType = asString(req.params.entityType, 40);
  const entityId = asString(req.params.entityId, 120);
  const phoneHint = normalizePhone(req.body?.phone || "");
  const result = await fetchCrmBridge(config, {
    action: "context",
    brief: {
      entityType,
      entityId,
      phone: phoneHint,
      query: [entityId, phoneHint].filter(Boolean).join(" "),
    },
    limitPerCollection: Number(req.body?.limitPerCollection || 8),
  });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result.data);
});

app.post("/api/crm/search-customer", async (req, res) => {
  const config = await getEffectiveConfig();
  const phone = normalizePhone(req.body?.phone || "");
  const query = asString(req.body?.query || phone, 180);
  if (!query) {
    res.status(400).json({ error: "query o phone es requerido." });
    return;
  }
  const result = await fetchCrmBridge(config, {
    action: "search",
    query,
    collections: ["leads", "contacts", "opportunities", "activities"],
    limitPerCollection: Number(req.body?.limitPerCollection || 8),
  });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result.data);
});

app.post("/api/messages/whatsapp/send", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const wa = config.providers.whatsapp || {};
    const twilioConfig = getTwilioConfig(config);
    const to = normalizePhone(req.body?.to);
    const text = asString(req.body?.text, 3000);
    if (!to || !text) {
      res.status(400).json({ error: "Destino y mensaje son requeridos." });
      return;
    }
    if (String(wa.provider || "twilio") !== "twilio") {
      res.status(400).json({ error: "Provider de WhatsApp no soportado en esta version." });
      return;
    }
    const client = createTwilioClient(config);
    if (!client) {
      res.status(400).json({ error: "Twilio no esta configurado para WhatsApp." });
      return;
    }
    const from = asString(wa.from || "", 80);
    if (!from) {
      res.status(400).json({ error: "Configura WHATSAPP_FROM en Settings." });
      return;
    }
    const message = await client.messages.create({
      from: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
      to: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
      body: text,
    });

    await fetchCrmBridge(config, {
      action: "logActivity",
      activity: {
        entityType: asString(req.body?.entityType || "contact", 40),
        entityId: asString(req.body?.entityId || to, 140),
        activityType: "email",
        title: "Mensaje WhatsApp enviado",
        description: text.slice(0, 500),
        metadata: { channel: "whatsapp", sid: message.sid, to },
      },
    });
    res.json({ ok: true, sid: message.sid, status: message.status });
  } catch (error) {
    res.status(500).json({ error: "No se pudo enviar WhatsApp.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/messages/telegram/send", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const telegram = config.providers.telegram || {};
    const botToken = asString(telegram.botToken || "", 300);
    const chatId = asString(req.body?.chatId || telegram.defaultChatId || "", 120);
    const text = asString(req.body?.text, 3000);
    if (!botToken || !chatId || !text) {
      res.status(400).json({ error: "Faltan botToken, chatId o texto." });
      return;
    }
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      res.status(400).json({ error: data.description || "Telegram rechazo el mensaje." });
      return;
    }
    await fetchCrmBridge(config, {
      action: "logActivity",
      activity: {
        entityType: asString(req.body?.entityType || "contact", 40),
        entityId: asString(req.body?.entityId || chatId, 140),
        activityType: "email",
        title: "Mensaje Telegram enviado",
        description: text.slice(0, 500),
        metadata: { channel: "telegram", chatId, messageId: data.result?.message_id || null },
      },
    });
    res.json({ ok: true, result: data.result || null });
  } catch (error) {
    res.status(500).json({ error: "No se pudo enviar Telegram.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/messages/whatsapp/webhook", async (req, res) => {
  const from = normalizePhone(req.body?.From || "");
  const to = normalizePhone(req.body?.To || "");
  const body = asString(req.body?.Body || "", 4000);
  const status = asString(req.body?.MessageStatus || "received", 80);
  const conversation = appendConversationEvent({
    channel: "whatsapp",
    direction: "inbound",
    status: status === "received" ? "active" : "waiting",
    text: body,
    customerRef: { phone: from },
    metadata: { from, to, sid: req.body?.MessageSid || null },
  });
  const config = await getEffectiveConfig();
  await fetchCrmBridge(config, {
    action: "upsertConversation",
    conversation: {
      external_id: conversation.id,
      customer_key: conversation.customerKey,
      channel: "whatsapp",
      status: conversation.status,
      assigned_to: conversation.assignedTo,
      summary: body,
    },
  });
  res.type("text/xml").send("<Response></Response>");
});

app.post("/api/messages/telegram/webhook", async (req, res) => {
  const message = req.body?.message || req.body?.edited_message || null;
  if (!message) {
    res.json({ ok: true });
    return;
  }
  const chatId = String(message.chat?.id || "");
  const text = asString(message.text || "", 4000);
  const conversation = appendConversationEvent({
    channel: "telegram",
    direction: "inbound",
    status: "active",
    text,
    customerRef: { chatId },
    metadata: { messageId: message.message_id || null, username: message.from?.username || "" },
  });
  const config = await getEffectiveConfig();
  await fetchCrmBridge(config, {
    action: "upsertConversation",
    conversation: {
      external_id: conversation.id,
      customer_key: conversation.customerKey,
      channel: "telegram",
      status: conversation.status,
      assigned_to: conversation.assignedTo,
      summary: text,
    },
  });
  res.json({ ok: true });
});

app.post("/api/messages/telegram/set-webhook", async (req, res) => {
  const config = await getEffectiveConfig();
  const telegram = config.providers.telegram || {};
  const botToken = asString(telegram.botToken || "", 300);
  const webhookUrl = asString(req.body?.webhookUrl || "", 1000);
  if (!botToken || !webhookUrl) {
    res.status(400).json({ error: "Faltan botToken o webhookUrl." });
    return;
  }
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    res.status(400).json({ error: data.description || "No se pudo registrar webhook de Telegram." });
    return;
  }
  res.json({ ok: true, result: data.result || null });
});

app.post("/api/inbox/list", async (req, res) => {
  const statusFilter = asString(req.body?.status || "", 80);
  const items = Array.from(inboxState.conversations.values())
    .filter((row) => (statusFilter ? row.status === statusFilter : true))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ items });
});

app.post("/api/inbox/assign", async (req, res) => {
  const conversationId = asString(req.body?.conversationId, 120);
  const assignedTo = asString(req.body?.assignedTo, 120) || defaultAgent;
  const row = Array.from(inboxState.conversations.values()).find((item) => item.id === conversationId);
  if (!row) {
    res.status(404).json({ error: "Conversacion no encontrada." });
    return;
  }
  row.assignedTo = assignedTo;
  row.updatedAt = nowIso();
  inboxState.conversations.set(row.customerKey, row);
  res.json({ ok: true, item: row });
});

app.post("/api/crm/contacts", async (req, res) => {
  const config = await getEffectiveConfig();
  const result = await fetchCrmBridge(config, {
    action: "listCollection",
    listCollection: {
      name: "contacts",
      limit: Number(req.body?.limit || 100),
    },
  });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result.data);
});

app.post("/api/crm/leads", async (req, res) => {
  const config = await getEffectiveConfig();
  const result = await fetchCrmBridge(config, {
    action: "listCollection",
    listCollection: {
      name: "leads",
      limit: Number(req.body?.limit || 100),
    },
  });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result.data);
});

app.post("/api/inbox/:id/messages", async (req, res) => {
  const id = asString(req.params.id, 120);
  const text = asString(req.body?.text, 4000);
  const channel = asString(req.body?.channel || "whatsapp", 40);
  const direction = asString(req.body?.direction || "outbound", 40);
  const row = Array.from(inboxState.conversations.values()).find((item) => item.id === id);
  if (!row) {
    res.status(404).json({ error: "Conversacion no encontrada." });
    return;
  }
  const updated = appendConversationEvent({
    channel,
    direction,
    status: "active",
    text,
    customerRef: row.customerRef,
    metadata: req.body?.metadata || {},
  });
  const config = await getEffectiveConfig();
  await fetchCrmBridge(config, {
    action: "upsertConversation",
    conversation: {
      external_id: updated.id,
      customer_key: updated.customerKey,
      channel,
      status: updated.status,
      assigned_to: updated.assignedTo,
      summary: text,
      metadata: req.body?.metadata || {},
    },
  });
  res.json({ ok: true, item: updated });
});

app.post("/api/inbox/:id/wrapup", async (req, res) => {
  const id = asString(req.params.id, 120);
  const row = Array.from(inboxState.conversations.values()).find((item) => item.id === id);
  if (!row) {
    res.status(404).json({ error: "Conversacion no encontrada." });
    return;
  }
  const outcome = asString(req.body?.outcome, 120);
  const reason = asString(req.body?.reason, 300);
  const notes = asString(req.body?.notes, 2000);
  if (!outcome || !reason) {
    res.status(400).json({ error: "Wrap-up obligatorio: outcome y reason son requeridos." });
    return;
  }
  row.wrapUp = {
    outcome,
    reason,
    notes,
    followUpAt: asString(req.body?.followUpAt, 120) || null,
    followUpType: asString(req.body?.followUpType, 120) || null,
    closedAt: nowIso(),
  };
  row.status = "closed";
  row.updatedAt = nowIso();
  inboxState.conversations.set(row.customerKey, row);

  const config = await getEffectiveConfig();
  await fetchCrmBridge(config, {
    action: "logActivity",
    activity: {
      entityType: row.customerRef?.crmEntityType || "lead",
      entityId: row.customerRef?.crmEntityId || row.customerRef?.phone || row.customerRef?.chatId || row.id,
      activityType: "call",
      title: `Wrap-up ${row.lastChannel}`,
      description: `${outcome} - ${reason}. ${notes}`,
      metadata: { channel: row.lastChannel, wrapUp: row.wrapUp },
    },
  });
  if (row.wrapUp.followUpAt) {
    await fetchCrmBridge(config, {
      action: "createFollowUpTask",
      task: {
        title: `Seguimiento ${row.lastChannel} - ${row.customerKey}`,
        description: notes || `Outcome: ${outcome}. Reason: ${reason}`,
        dueDate: row.wrapUp.followUpAt,
        priority: "high",
        createdBy: "roka-telemarketing",
      },
    });
  }
  res.json({ ok: true, item: row });
});

app.post("/api/dev/seed-inbox", async (_req, res) => {
  const seed = [
    {
      channel: "voice",
      direction: "inbound",
      status: "wrap_up_required",
      text: "Cliente llamo para cotizacion inicial.",
      customerRef: { phone: "+526141112233", crmEntityType: "lead", crmEntityId: "lead-seed-001" },
      metadata: { seed: true },
    },
    {
      channel: "whatsapp",
      direction: "inbound",
      status: "active",
      text: "Hola, me interesa saber precios.",
      customerRef: { phone: "+526142224466", crmEntityType: "lead", crmEntityId: "lead-seed-002" },
      metadata: { seed: true },
    },
    {
      channel: "telegram",
      direction: "inbound",
      status: "waiting",
      text: "Podemos agendar una demo?",
      customerRef: { chatId: "99887766", crmEntityType: "contact", crmEntityId: "contact-seed-003" },
      metadata: { seed: true },
    },
  ];
  const created = seed.map((row) => appendConversationEvent(row));
  res.json({ ok: true, count: created.length, items: created });
});

app.post("/api/script/generate", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const openaiConfig = config.providers.openai;
    const customer = req.body?.customer || {};
    const objective = asString(req.body?.objective || "Calificar al prospecto y avanzar al siguiente paso.", 2000);
    const contextRows = Array.isArray(req.body?.contextRows) ? req.body.contextRows.slice(0, 20) : [];

    if (!openaiConfig.apiKey || !openaiConfig.model) {
      res.status(400).json({ error: "OpenAI no esta configurado para generar guion." });
      return;
    }

    const client = new OpenAI({ apiKey: openaiConfig.apiKey });
    const prompt = [
      `Empresa: ${config.company}`,
      `Objetivo comercial: ${objective}`,
      `Cliente: ${JSON.stringify(customer)}`,
      `Contexto CRM: ${JSON.stringify(contextRows)}`,
      "Devuelve JSON con llaves exactas: opening, discovery, objectionHandling, closing, nextSteps.",
      "Texto en espanol, concreto y profesional para llamada telefonica.",
    ].join("\n");

    const response = await client.responses.create({
      model: openaiConfig.model,
      input: [
        { role: "system", content: "Eres un supervisor premium de telemarketing B2B/B2C." },
        { role: "user", content: prompt },
      ],
    });

    const script = serializeScriptResponse(response.output_text || "");
    res.json({ ok: true, script, raw: response.output_text || "" });
  } catch (error) {
    res.status(500).json({ error: "No se pudo generar guion.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/script/refine", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const openaiConfig = config.providers.openai;
    if (!openaiConfig.apiKey || !openaiConfig.model) {
      res.status(400).json({ error: "OpenAI no esta configurado para refinar guion." });
      return;
    }
    const currentScript = req.body?.script || {};
    const feedback = asString(req.body?.feedback || "Hazlo mas corto y enfocado a cierre.", 2000);
    const client = new OpenAI({ apiKey: openaiConfig.apiKey });
    const response = await client.responses.create({
      model: openaiConfig.model,
      input: [
        { role: "system", content: "Refina guiones de telemarketing. Devuelve JSON estricto con opening, discovery, objectionHandling, closing, nextSteps." },
        { role: "user", content: `Guion actual: ${JSON.stringify(currentScript)}\nFeedback: ${feedback}` },
      ],
    });
    const script = serializeScriptResponse(response.output_text || "");
    res.json({ ok: true, script, raw: response.output_text || "" });
  } catch (error) {
    res.status(500).json({ error: "No se pudo refinar guion.", detail: error instanceof Error ? error.message : "Error desconocido" });
  }
});

app.post("/api/openai/realtime/session", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const openai = config.providers.openai;
    const sdp = typeof req.body === "string" ? req.body : "";
    const knowledgeItems = await readKnowledge();
    const initialContext = retrieveKnowledge(knowledgeItems, "capacitacion seguridad instrucciones", 5)
      .map((row) => `[${row.item.title}] ${row.chunk}`)
      .join("\n\n");

    if (!openai.apiKey || !openai.model) {
      res.status(400).json({
        error: "OpenAI no esta configurado.",
        required: ["OpenAI API key", "OpenAI model"],
      });
      return;
    }

    if (!sdp) {
      res.status(400).json({ error: "Falta SDP del navegador." });
      return;
    }

    const fd = new FormData();
    fd.set("sdp", sdp);
    fd.set(
      "session",
      JSON.stringify({
        type: "realtime",
        model: openai.model,
        instructions: `${config.systemInstructions}\n\nEmpresa: ${config.company}\nConocimiento inicial RAG:\n${initialContext}`,
        audio: {
          output: {
            voice: "marin",
          },
        },
      }),
    );

    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openai.apiKey}`,
        "OpenAI-Safety-Identifier": "roka-local-user",
      },
      body: fd,
    });

    const answer = await response.text();
    if (!response.ok) {
      res.status(response.status).type("text/plain").send(answer);
      return;
    }

    res.type("application/sdp").send(answer);
  } catch (error) {
    res.status(500).json({
      error: "No se pudo iniciar OpenAI Realtime.",
      detail: error instanceof Error ? error.message : "Error desconocido",
    });
  }
});

app.get("/api/knowledge", async (_req, res) => {
  res.json({ items: await readKnowledge() });
});

app.post("/api/knowledge", async (req, res) => {
  const current = await readKnowledge();
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const created = files.map((file, index) => ({
    id: Date.now() + index,
    title: file.name || `Documento ${index + 1}`,
    type: file.type || "Documento",
    owner: "Usuario",
    status: "Indexado",
    updated: "Ahora",
    content: file.content || "",
    chunks: chunkText(file.content || ""),
  }));
  const items = [...created, ...current];
  await writeKnowledge(items);
  res.json({ items, created });
});

app.delete("/api/knowledge/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await readKnowledge();
  const items = current.filter((item) => Number(item.id) !== id);
  await writeKnowledge(items);
  res.json({ items, deleted: current.length - items.length });
});

app.post("/api/knowledge/search", async (req, res) => {
  const items = await readKnowledge();
  const results = retrieveKnowledge(items, req.body?.query || "", Number(req.body?.limit || 5));
  res.json({
    results: results.map(({ item, chunk, chunkIndex, score }) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      owner: item.owner,
      chunk,
      chunkIndex,
      score,
    })),
  });
});

app.post("/api/chat", (req, res) => {
  void handleChat(req, res);
});

async function handleChat(req, res) {
  const message = String(req.body?.message || "").trim();
  const config = await getEffectiveConfig();
  const company = req.body?.company || config.company || "ROKA";
  const provider = req.body?.provider || config.activeProvider || "openai";
  const items = await readKnowledge();
  const retrieved = retrieveKnowledge(items, message, 5);
  const sources = retrieved.map((row) => row.item);
  const context = retrieved.map((row) => `[${row.item.title} #${row.chunkIndex + 1}] ${row.chunk}`).join("\n\n");

  if (provider === "openai" && config.providers.openai.apiKey && config.providers.openai.model) {
    try {
      const client = new OpenAI({ apiKey: config.providers.openai.apiKey });
      const response = await client.responses.create({
        model: config.providers.openai.model,
        input: [
          {
            role: "system",
            content:
              `${config.systemInstructions}\n\nEmpresa: ${company}\nModo estricto: ${config.strictKnowledge ? "si" : "no"}.\n` +
              `Conocimiento recuperado por RAG:\n${context || "No hay fragmentos relevantes."}`,
          },
          {
            role: "user",
            content: message || "Inicia la capacitacion.",
          },
        ],
      });
      res.json({
        mode: "openai-responses",
        model: config.providers.openai.model,
        answer: response.output_text || "OpenAI no devolvio texto.",
        sources: sources.map(({ id, title, type, owner }) => ({ id, title, type, owner })),
      });
      return;
    } catch (error) {
      res.status(400).json({
        mode: "openai-error",
        error: "OpenAI rechazo la solicitud.",
        detail: error instanceof Error ? error.message : "Error desconocido",
      });
      return;
    }
  }

  res.json({
    mode: "local-rag-demo",
    answer: `${config.systemInstructions}\n\nCon base en RAG de ${company}: ${context || sources.map((item) => item.title).join(", ")}. Respuesta sugerida: ${message || "iniciaremos la capacitacion"} se debe explicar con una regla clara, un ejemplo de planta y una pregunta de verificacion antes de marcar el modulo como aprobado.`,
    sources: sources.map(({ id, title, type, owner }) => ({ id, title, type, owner })),
  });
}

function getDidAuthHeader(apiKey) {
  if (!apiKey) return "";
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("Basic ")) return trimmed;
  if (trimmed.includes(":")) {
    return `Basic ${Buffer.from(trimmed).toString("base64")}`;
  }
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes(":")) {
      return `Basic ${trimmed}`;
    }
  } catch {
    // Ignore
  }
  return `Basic ${trimmed}`;
}

async function readDidResponse(response) {
  const text = await response.text();
  if (!text) return { data: {}, text: "" };
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: { description: text }, text };
  }
}

app.post("/api/did/stream", async (req, res) => {
  try {
    const config = await getEffectiveConfig();
    const did = config.providers.did;
    
    if (!did.apiKey) {
      return res.status(400).json({ error: "API Key de D-ID no configurada en ROKA." });
    }

    const authHeader = getDidAuthHeader(did.apiKey);
    const sourceUrl = req.body?.source_url || did.agent || did.avatar || "https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg";

    const response = await fetch("https://api.d-id.com/talks/streams", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source_url: sourceUrl
      }),
    });

    const { data, text } = await readDidResponse(response);
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error al crear flujo en D-ID",
        detail: data.description || text || JSON.stringify(data)
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "Error interno al conectar con D-ID Streams",
      detail: error instanceof Error ? error.message : "Error desconocido"
    });
  }
});

app.post("/api/did/sdp", async (req, res) => {
  try {
    const { streamId, answer, sessionId } = req.body || {};
    if (!streamId || !answer || !sessionId) {
      return res.status(400).json({ error: "Faltan parametros obligatorios (streamId, answer, sessionId)." });
    }

    const config = await getEffectiveConfig();
    const did = config.providers.did;
    const authHeader = getDidAuthHeader(did.apiKey);

    const response = await fetch(`https://api.d-id.com/talks/streams/${streamId}/sdp`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        answer,
        session_id: sessionId
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error("D-ID SDP ERROR:", response.status, text);
      return res.status(response.status).json({
        error: "Error al enviar SDP a D-ID",
        detail: text
      });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: "Error interno al enviar SDP",
      detail: error instanceof Error ? error.message : "Error desconocido"
    });
  }
});

app.post("/api/did/ice", async (req, res) => {
  try {
    const { streamId, candidate, sessionId } = req.body || {};
    if (!streamId || !sessionId) {
      return res.status(400).json({ error: "Faltan parametros obligatorios (streamId, sessionId)." });
    }

    const config = await getEffectiveConfig();
    const did = config.providers.did;
    const authHeader = getDidAuthHeader(did.apiKey);

    const response = await fetch(`https://api.d-id.com/talks/streams/${streamId}/ice`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        session_id: sessionId
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error("D-ID ICE ERROR:", response.status, text);
      return res.status(response.status).json({
        error: "Error al enviar candidato ICE a D-ID",
        detail: text
      });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: "Error interno al enviar ICE",
      detail: error instanceof Error ? error.message : "Error desconocido"
    });
  }
});

app.post("/api/did/speak", async (req, res) => {
  try {
    const { streamId, text, sessionId } = req.body || {};
    if (!streamId || !text || !sessionId) {
      return res.status(400).json({ error: "Faltan parametros obligatorios (streamId, text, sessionId)." });
    }

    const config = await getEffectiveConfig();
    const did = config.providers.did;
    const authHeader = getDidAuthHeader(did.apiKey);

    const response = await fetch(`https://api.d-id.com/talks/streams/${streamId}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        script: {
          type: "text",
          input: text,
          provider: {
            type: "microsoft",
            voice_id: "es-MX-DaliaNeural"
          }
        },
        session_id: sessionId
      }),
    });

    const { data, text: responseText } = await readDidResponse(response);
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error al solicitar voz a D-ID",
        detail: data.description || responseText || JSON.stringify(data)
      });
    }

    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      error: "Error interno al solicitar voz",
      detail: error instanceof Error ? error.message : "Error desconocido"
    });
  }
});

app.delete("/api/did/stream/:id", async (req, res) => {
  try {
    const streamId = req.params.id;
    const { sessionId } = req.body || {};
    if (!streamId || !sessionId) {
      return res.status(400).json({ error: "Faltan parametros obligatorios (streamId, sessionId)." });
    }

    const config = await getEffectiveConfig();
    const did = config.providers.did;
    const authHeader = getDidAuthHeader(did.apiKey);

    const response = await fetch(`https://api.d-id.com/talks/streams/${streamId}`, {
      method: "DELETE",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error al eliminar flujo de D-ID",
        detail: text
      });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: "Error interno al cerrar flujo",
      detail: error instanceof Error ? error.message : "Error desconocido"
    });
  }
});

app.listen(port, () => {
  console.log(`ROKA backend escuchando en http://localhost:${port}`);
});
