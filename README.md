# ROKA Capacitacion

Centro de capacitacion con instructor IA, conocimiento empresarial y ruta real para voz/avatar en tiempo real.

Esta version ya no es una fachada puramente visual. Integra una base local con:

- Frontend React/Vite.
- Backend Express.
- Endpoint de token LiveKit basado en el starter oficial `livekit-examples/agent-starter-react`.
- Centro de conocimiento local con carga de documentos.
- Chat conectado a backend con modo RAG local de demostracion.
- Configuracion local de proveedores desde UI/backend: LiveKit, OpenAI, Gemini, ElevenLabs, HeyGen y D-ID.
- Preparacion para proveedores realtime: OpenAI Realtime, Gemini Live, ElevenLabs, HeyGen, D-ID, LiveKit y Pipecat.
- Avatares gratuitos configurables: TalkingHead y Ready Player Me, sin quitar HeyGen/D-ID.

## Referencias usadas

- LiveKit React starter: https://github.com/livekit-examples/agent-starter-react
- LiveKit Agents: https://github.com/livekit/agents
- Pipecat examples: https://github.com/pipecat-ai/pipecat-examples
- Pipecat framework: https://github.com/pipecat-ai/pipecat
- TalkingHead avatar/lip-sync: https://github.com/met4citizen/talkinghead
- Ready Player Me web avatars: https://github.com/readyplayerme/visage

Las referencias clonadas quedan en `_reference/` y estan ignoradas por Git.

## Correr completo

```bash
npm install
npm run dev:full
```

Esto levanta:

- Backend: `http://localhost:8787`
- Frontend Vite: normalmente `http://localhost:5173`

## Activar LiveKit real

Hay dos rutas soportadas:

1. Desde la UI: captura LiveKit URL, API key y API secret en configuracion y guarda localmente.
2. Desde `.env`: copia `.env.example` a `.env` y agrega:

```env
LIVEKIT_URL=wss://tu-proyecto.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=
```

3. Ejecuta:

```bash
npm run dev:full
```

4. En la app usa `Conectar LiveKit`.

Si no hay credenciales, la app muestra un error real en lugar de fingir conexion.

## Configuracion local de proveedores

El backend expone endpoints para que la UI guarde y cargue la configuracion en un JSON local:

- `GET /api/config/providers`: catalogo de proveedores, campos requeridos, estado y config con secretos enmascarados.
- `GET /api/config`: devuelve la configuracion efectiva, mezclando `.env` con `server/provider-config.local.json`.
- `GET /api/config?secrets=masked`: igual que el anterior, pero enmascara llaves.
- `POST /api/config`: guarda la configuracion en `server/provider-config.local.json`.

Campos soportados:

```json
{
  "company": "ROKA",
  "activeProvider": "openai",
  "providers": {
    "livekit": {
      "url": "wss://tu-proyecto.livekit.cloud",
      "apiKey": "LiveKit API key",
      "apiSecret": "LiveKit API secret",
      "agentName": "nombre opcional del agente"
    },
    "openai": {
      "apiKey": "OpenAI key",
      "model": "OpenAI model"
    },
    "gemini": {
      "apiKey": "Gemini key",
      "model": "Gemini model"
    },
    "elevenlabs": {
      "apiKey": "ElevenLabs key",
      "voice": "ElevenLabs voice"
    },
    "heygen": {
      "apiKey": "HeyGen key",
      "avatar": "HeyGen avatar"
    },
    "did": {
      "apiKey": "D-ID key",
      "agent": "D-ID agent"
    }
  }
}
```

## Centro de conocimiento / RAG

La seccion `Conocimiento` ahora incluye:

- Nombre del asistente.
- System instructions / prompt.
- Subida de documentos.
- Persistencia local en `server/knowledge.local.json`.
- Borrado de documentos desde UI.
- Busqueda RAG local por fragmentos en `/api/knowledge/search`.
- Uso de fragmentos recuperados dentro de `/api/chat` y al iniciar OpenAI Realtime.

Endpoints:

- `GET /api/knowledge`
- `POST /api/knowledge`
- `DELETE /api/knowledge/:id`
- `POST /api/knowledge/search`

Ejemplo para guardar desde UI o cliente local:

```bash
curl -X POST http://localhost:8787/api/config \
  -H "Content-Type: application/json" \
  -d "{\"company\":\"ROKA\",\"activeProvider\":\"openai\",\"providers\":{\"openai\":{\"apiKey\":\"sk...\",\"model\":\"gpt-realtime\"}}}"
```

El archivo `server/provider-config.local.json` contiene secretos y esta ignorado por `server/.gitignore`. En produccion conviene proteger estos endpoints con autenticacion y cifrar secretos en reposo.

## Siguiente capa

Para que el instructor sea completamente realtime con avatar:

1. Levantar un agente LiveKit Python o Node conectado a OpenAI Realtime/Gemini Live.
2. Conectar ese agente a la misma sala LiveKit que crea `/api/livekit/token`.
3. Agregar proveedor de avatar:
   - Premium: HeyGen, D-ID, Tavus, Anam.
   - Open source/controlado: TalkingHead o avatar 3D con lip-sync.
4. Cambiar el RAG local en memoria por almacenamiento persistente y embeddings.

## Scripts

```bash
npm run dev       # solo frontend
npm run server    # solo backend
npm run dev:full  # backend + frontend
npm run build     # build de produccion
```
