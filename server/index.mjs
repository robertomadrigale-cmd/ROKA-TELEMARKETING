import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const localConfigPath = path.join(serverDir, "provider-config.local.json");
const localKnowledgePath = path.join(serverDir, "knowledge.local.json");
const localAvatarDir = path.join(serverDir, "avatar-files.local");
const providerKeys = ["livekit", "openai", "gemini", "elevenlabs", "heygen", "did", "talkinghead", "readyplayerme"];
const secretFields = new Set(["apiKey", "apiSecret"]);
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
};
const envConfig = {
  version: 1,
  company: process.env.DEFAULT_COMPANY || "ROKA",
  assistantName: process.env.ASSISTANT_NAME || "Instructor ROKA",
  systemInstructions:
    process.env.SYSTEM_INSTRUCTIONS ||
    "Eres un instructor de capacitacion. Responde solo con informacion aprobada cuando el modo estricto este activo. Da pasos claros, ejemplos practicos y preguntas de verificacion.",
  strictKnowledge: true,
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

function asString(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
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
    assistantName: asString(input.assistantName ?? base.assistantName ?? envConfig.assistantName, 160) || "Instructor ROKA",
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
