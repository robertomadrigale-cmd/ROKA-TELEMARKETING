# Especificación de Arquitectura y Sistema: ROKA Capacitación

Este documento detalla exhaustivamente la arquitectura, el stack tecnológico, los flujos de datos y la especificación de API de **ROKA Capacitación** (ROKA AI Training Center). Está diseñado tanto para desarrolladores humanos como para que cualquier **Modelo de Lenguaje / Inteligencia Artificial (LLM)** pueda comprender inmediatamente el estado actual del sistema, su lógica interna y comenzar a programar de forma directa.

---

## 1. Resumen del Sistema

**ROKA Capacitación** es una plataforma interactiva de entrenamiento y capacitación corporativa guiada por un **Instructor Virtual con Inteligencia Artificial**. El sistema permite capacitar a alumnos a través de múltiples modalidades conversacionales, incluyendo:
1. **Chat Tradicional interactivo**: Alimentado por modelos LLM tradicionales e inyectado con información empresarial.
2. **Voz e Interacción en Tiempo Real (Baja Latencia)**:
   - **Vía WebRTC Directo**: Utilizando la API Realtime de OpenAI (`/api/openai/realtime/session` con intercambio SDP de audio y datos).
   - **Vía Infraestructura WebRTC Distribuida**: Preparado para interactuar con **LiveKit Cloud/Self-hosted**, lo que permite salas WebRTC donde interactúan múltiples participantes y agentes de backend (ej. usando Python LiveKit Agents o orquestadores como Pipecat).
3. **Avatares 3D Interactivos**:
   - Renderizado en tiempo real de avatares en formato `.glb` / `.gltf` mediante `@google/model-viewer` directamente en el navegador.
   - Integración nativa con **Ready Player Me** y soporte de proxy para evitar problemas de CORS, así como subida directa de archivos binarios al servidor.
   - Preparación para avatares de video realistas premium a través de **HeyGen** y **D-ID**.
4. **Motor de Conocimiento Empresarial (Local RAG)**:
   - Los instructores basan sus respuestas en documentos corporativos cargados y procesados localmente.
   - Cuenta con "Modo Estricto" que restringe las respuestas del modelo únicamente a la información aprobada en los documentos para evitar alucinaciones operativas.

---

## 2. Stack Tecnológico

El proyecto está estructurado como una aplicación **Full-stack Monorepo** local con un frontend moderno y un servidor backend ligero en NodeJS.

### Frontend
* **Core**: React 19 (con TypeScript y tipado estricto).
* **Bundler & Dev Server**: Vite 7.
* **Sistema de Diseño (CSS)**: Vanilla CSS customizado (`src/styles.css`). Diseño premium con tonalidades verde-selva oscuro (`#101815`), fondos limpios de alta tecnología (`#eef1ee`), animaciones de micro-interacción y esquinas redondeadas.
* **Componentes Clave**:
  * `lucide-react`: Catálogo de iconos vectoriales.
  * `@google/model-viewer`: Componente web oficial de Google para cargar, interactuar y animar modelos 3D en formato GLB/GLTF sin sobrecarga de librerías como Three.js en crudo.
  * `livekit-client`: SDK oficial de cliente para conectarse, publicar pistas de audio/video y suscribirse a salas en tiempo real de LiveKit.

### Backend
* **Entorno**: NodeJS (ES Modules con extensión `.mjs` para compatibilidad nativa con imports de forma directa).
* **Servidor**: Express (con middleware para procesamiento de SDP, texto plano y streams binarios de hasta 50MB para modelos 3D).
* **Integración de IA**:
  * `openai`: SDK oficial para la interacción de chat y respuestas tradicionales.
  * `livekit-server-sdk`: Utilizado para la generación segura de tokens JWT para participantes y la verificación de salas de forma activa.
  * `dotenv`: Carga de configuración base desde variables de entorno.

---

## 3. Estructura del Proyecto

```text
ROKA CAPACITACION/
├── .env.example                    # Plantilla de variables de entorno configurables
├── package.json                    # Dependencias del frontend y del backend en conjunto
├── tsconfig.json                   # Configuración del compilador TypeScript
├── vite.config.ts                  # Configuración de compilación y empaquetado Vite
├── index.html                      # Punto de entrada HTML5
├── src/                            # FRONTEND (React)
│   ├── main.tsx                    # Punto de inicio e hidratación DOM
│   ├── App.tsx                     # Archivo principal de React (contiene lógica, estados y vistas del cliente)
│   ├── styles.css                  # Hoja de estilos premium (CSS Vanilla)
│   └── vite-env.d.ts               # Declaraciones de tipos para variables de entorno de Vite
├── server/                         # BACKEND (Express)
│   ├── index.mjs                   # Servidor central de Express (lógica RAG, APIs y Realtime)
│   ├── provider-config.local.json  # Configuración persistida de credenciales y modelos (Generado automáticamente)
│   └── knowledge.local.json        # Base de conocimientos persistida (Chunks indexados locales)
```

---

## 4. Diagrama Arquitectónico

El flujo interactivo entre los diferentes elementos del sistema se modela a continuación:

```mermaid
sequenceDiagram
    autonumber
    actor Alumno as Alumno (Navegador)
    participant Front as Frontend (React + WebRTC)
    participant Back as Backend (Express + Local RAG)
    participant OpenAI as API de OpenAI (Realtime / GPT)
    participant LK as LiveKit Cloud / Server

    %% Flujo 1: RAG Local
    Note over Alumno, Back: Fase de Carga de Conocimiento (RAG)
    Alumno->>Front: Sube documento .txt/.pdf
    Front->>Back: POST /api/knowledge (Archivos en texto plano)
    Back->>Back: Fragmentación de texto (Chunks)
    Back->>Back: Persiste en knowledge.local.json
    Back-->>Front: Confirma indexación exitosa

    %% Flujo 2: Chat con RAG
    Note over Alumno, OpenAI: Flujo de Chat Tradicional
    Alumno->>Front: Envía pregunta en Chat ("Pregunta de seguridad")
    Front->>Back: POST /api/chat { message: "Pregunta..." }
    Back->>Back: Búsqueda Semántica local por términos
    Back->>Back: Inyecta Contexto RAG en prompt de Sistema
    Back->>OpenAI: Envia prompt compilado a OpenAI Chat
    OpenAI-->>Back: Retorna respuesta de texto
    Back-->>Front: Retorna { answer, sources }
    Front->>Alumno: Renderiza texto y reproduce voz local (TTS Navegador)

    %% Flujo 3: OpenAI Realtime WebRTC
    Note over Alumno, OpenAI: Flujo de Voz Realtime (Baja Latencia)
    Alumno->>Front: Activa "Conectar voz IA"
    Front->>Front: Obtiene micrófono local (UserMedia) y crea PeerConnection
    Front->>Front: Genera Oferta SDP local
    Front->>Back: POST /api/openai/realtime/session (SDP de Oferta)
    Back->>Back: Recupera contexto del RAG local
    Back->>OpenAI: POST https://api.openai.com/v1/realtime/calls (Inyecta instrucciones + RAG)
    OpenAI-->>Back: Retorna Respuesta SDP
    Back-->>Front: Retorna Respuesta SDP
    Front->>Front: Establece Remote Description (Establece canal de audio y datos RTC)
    OpenAI<->>Front: Conversación de voz bidireccional continua (Baja latencia)

    %% Flujo 4: LiveKit
    Note over Alumno, LK: Flujo de Sala Multi-Agente (LiveKit)
    Alumno->>Front: Clic en "Conectar LiveKit"
    Front->>Back: POST /api/livekit/token { participantName }
    Back->>LK: Solicita token JWT seguro usando apiKey y apiSecret
    LK-->>Back: Devuelve JWT firmado
    Back-->>Front: Devuelve { serverUrl, participantToken, roomName }
    Front->>LK: Conecta sala usando livekit-client (WebRTC)
    LK<->>Front: Transmite pistas de audio y sincroniza con Agente externo en la sala
```

---

## 5. Especificaciones de la API de Backend (`server/index.mjs`)

El servidor Express corre por defecto en el puerto `8787`. Utiliza CORS abierto y acepta payloads JSON, binarios y texto plano.

### 5.1. Gestión de Configuración y Proveedores

#### `GET /api/health`
* **Descripción**: Verifica el estado de salud del backend y si los proveedores críticos están configurados.
* **Respuesta (JSON)**:
  ```json
  {
    "ok": true,
    "livekit": true,
    "providers": {
      "openai": true,
      "gemini": false,
      "elevenlabs": false,
      "heygen": false,
      "did": false,
      "talkinghead": true,
      "readyplayerme": true
    }
  }
  ```

#### `GET /api/config/providers`
* **Descripción**: Retorna el catálogo completo de proveedores con los campos requeridos y el estado actual de los secretos (enmascarados).
* **Respuesta (JSON)**: Retorna la metadata de configuración en `providerCatalog` y su enmascaramiento.

#### `GET /api/config`
* **Descripción**: Retorna la configuración efectiva actual mezclando variables de entorno `.env` con la persistencia local de `provider-config.local.json`.
* **Query Params**:
  * `secrets=masked` (opcional): Si se define, enmascara las API keys e información sensible con asteriscos (`********`).
* **Respuesta (JSON)**:
  ```json
  {
    "config": {
      "version": 1,
      "company": "ROKA",
      "assistantName": "Instructor ROKA",
      "systemInstructions": "Eres un asistente...",
      "strictKnowledge": true,
      "activeProvider": "openai",
      "activeAvatarProvider": "talkinghead",
      "providers": {
        "openai": { "apiKey": "sk-...", "model": "gpt-realtime" },
        "livekit": { "url": "wss://...", "apiKey": "...", "apiSecret": "..." }
      }
    }
  }
  ```

#### `POST /api/config`
* **Descripción**: Guarda la configuración de la UI en el archivo JSON local `server/provider-config.local.json`.
* **Body (JSON)**: Objeto de configuración parcial o completo compatible con la estructura de `AppSettings`.
* **Respuesta (JSON)**: Configuración guardada y estatus enmascarado.

---

### 5.2. Gestión de Salas e Infraestructura WebRTC (LiveKit)

#### `POST /api/livekit/token`
* **Descripción**: Crea una sala y genera un token JWT seguro de acceso a la sala WebRTC de LiveKit con duración de 30 minutos.
* **Body (JSON)**:
  ```json
  {
    "participantName": "Nombre Alumno",
    "roomName": "roka-training-opcional"
  }
  ```
* **Respuesta (JSON)**:
  ```json
  {
    "serverUrl": "wss://tu-proyecto.livekit.cloud",
    "roomName": "roka-training-17482937",
    "participantName": "Nombre Alumno",
    "participantToken": "eyJhbGciOi...",
    "agentName": "nombre-del-agente-si-existe"
  }
  ```

#### `POST /api/livekit/verify`
* **Descripción**: Verifica de forma activa si las credenciales de LiveKit son válidas realizando una petición de prueba a las salas activas.
* **Respuesta (JSON)**: `{ "ok": true, "serverUrl": "...", "apiKeyPrefix": "..." }`

---

### 5.3. Voz Realtime (OpenAI WebRTC)

#### `POST /api/openai/realtime/session`
* **Descripción**: Endpoint puente para iniciar sesiones de OpenAI Realtime API a través de WebRTC. Carga el contexto del RAG local, lo inyecta como instrucciones al inicio del prompt del sistema, y negocia la oferta SDP del navegador.
* **Headers**: `Content-Type: application/sdp`
* **Body (Text/SDP)**: Oferta SDP generada por el navegador del cliente.
* **Respuesta**: Respuesta SDP (`application/sdp`) devuelta por OpenAI para configurar el peer local en el cliente.

---

### 5.4. Gestión de Conocimiento (RAG Local)

#### `GET /api/knowledge`
* **Descripción**: Lista todos los documentos indexados en el sistema.
* **Respuesta (JSON)**:
  ```json
  {
    "items": [
      {
        "id": 1,
        "title": "Induccion operativa ROKA",
        "type": "Curso",
        "owner": "RH",
        "status": "Indexado",
        "updated": "Inicial",
        "content": "Contenido del documento..."
      }
    ]
  }
  ```

#### `POST /api/knowledge`
* **Descripción**: Permite subir nuevos documentos. El backend divide automáticamente el texto en chunks y lo persiste en `server/knowledge.local.json`.
* **Body (JSON)**:
  ```json
  {
    "files": [
      {
        "name": "Manual de Seguridad.txt",
        "type": "TXT",
        "content": "Texto largo del manual..."
      }
    ]
  }
  ```
* **Respuesta (JSON)**: Lista actualizada de ítems y lista de los ítems recién creados.

#### `DELETE /api/knowledge/:id`
* **Descripción**: Elimina un documento indexado por su ID.
* **Respuesta (JSON)**: `{ "items": [...], "deleted": 1 }`

#### `POST /api/knowledge/search`
* **Descripción**: Ejecuta una búsqueda directa de términos en el índice local.
* **Body (JSON)**: `{ "query": "seguridad industrial", "limit": 5 }`
* **Respuesta (JSON)**:
  ```json
  {
    "results": [
      {
        "id": 2,
        "title": "Protocolos de seguridad industrial",
        "type": "Manual",
        "owner": "Seguridad",
        "chunk": "Texto del fragmento recuperado...",
        "chunkIndex": 0,
        "score": 12
      }
    ]
  }
  ```

#### `POST /api/chat`
* **Descripción**: Chat conversacional estructurado. Realiza una búsqueda RAG local, inyecta la información recuperada como system instructions, y llama a la API de OpenAI tradicional (o retorna un mock local explicativo en caso de no tener API keys configuradas).
* **Body (JSON)**: `{ "message": "...", "company": "...", "provider": "openai" }`
* **Respuesta (JSON)**: `{ "mode": "...", "answer": "Respuesta procesada...", "sources": [...] }`

---

### 5.5. Servido y Subida de Avatares 3D

#### `GET /api/avatar/proxy`
* **Descripción**: Proxy CORS que descarga el avatar 3D `.glb` / `.gltf` desde Ready Player Me para evitar problemas de dominios en el componente `<model-viewer>`.
* **Query Params**: `url` (URL absoluta del archivo `.glb`).

#### `POST /api/avatar/upload`
* **Descripción**: Permite subir un archivo binario `.glb` o `.gltf` local y lo almacena físicamente en la carpeta `server/avatar-files.local/`.
* **Headers**: `Content-Type: application/octet-stream`
* **Query Params**: `name` (Nombre del archivo).
* **Respuesta (JSON)**: `{ "ok": true, "url": "/api/avatar/local/avatar-timestamp.glb" }`

#### `GET /api/avatar/local/:file`
* **Descripción**: Sirve los archivos de avatar 3D binarios subidos localmente.

---

## 6. Lógica Interna del Motor RAG Local

El backend utiliza un sistema RAG (Generación Aumentada por Recuperación) ligero implementado directamente en memoria y persistido en JSON. Es ideal para entornos de demostración u offline:

1. **Fragmentación (Chunking)**:
   Al subir un documento en `/api/knowledge`, la función `chunkText(text, max = 900)` limpia espacios colindantes y extrae bloques secuenciales de un tamaño máximo de 900 caracteres.
2. **Normalización y Tokenización**:
   La función `tokenize(text)` procesa el texto:
   * Convierte todo a minúsculas.
   * Remueve acentos y caracteres especiales de manera uniforme mediante normalización Unicode (`NFD` reemplazando `[\u0300-\u036f]`).
   * Divide el texto en palabras separadas por delimitadores no alfanuméricos.
   * Filtra las palabras cortas (longitud menor o igual a 2 caracteres) para evitar preposiciones y conectores comunes.
3. **Puntuación y Ranking**:
   La función `retrieveKnowledge(items, query, limit = 5)`:
   * Tokeniza la consulta del usuario.
   * Para cada fragmento de la base de datos indexada, cuenta cuántas veces los términos de la consulta aparecen de forma parcial o total dentro de los términos del fragmento.
   * Retorna los fragmentos ordenados por puntuación (`score`) descendente, filtrando aquellos que no tengan ninguna coincidencia relevante.

---

## 7. Integración Realtime de Voz y Avatares

### A. OpenAI Realtime WebRTC
* **Establecimiento**: El cliente crea un objeto `RTCPeerConnection` y añade una pista de audio obtenida de `navigator.mediaDevices.getUserMedia`.
* **DataChannel**: Crea un canal de datos llamado `"oai-events"` para comunicación de metadatos (como recibir el texto de salida o enviar comandos).
* **Oferta/Respuesta**: El cliente envía su SDP a `/api/openai/realtime/session`. El backend monta un FormData que incluye el SDP y la sesión de configuración (inyectando instrucciones generales y la búsqueda RAG relevante) y se la entrega a la API de OpenAI. OpenAI retorna un SDP de respuesta que el backend envía de vuelta al cliente, completando el handshake WebRTC de baja latencia sin servidores intermediarios.

### B. LiveKit Multi-agente
* **Canal**: Diseñado para soportar agentes de backend independientes (por ejemplo, escritos en Python usando `livekit-agents` y `Pipecat` u OpenAI Realtime API).
* **Lógica**: Al conectarse, el frontend publica su pista local de audio en la sala creada. Si hay un script de agente en el backend escuchando a esa misma sala de LiveKit (indicada por las variables de entorno), el agente se conectará de manera inmediata y transmitirá las respuestas de audio de vuelta, lo que se refleja en la UI incrementando el contador de participantes remotos y configurando la fuente de voz a `livekit-agent`.

---

## 8. Guía para Continuar la Implementación (Siguiente Paso)

Si deseas hacer crecer este sistema, te recomendamos priorizar las siguientes tareas:

1. **Agente LiveKit de Backend autónomo**:
   * Implementa un script de agente en `server/agent/` usando Python o NodeJS con el framework `@livekit/agents`.
   * Configura el agente para escuchar los eventos de conexión de la sala generada por `/api/livekit/token` y manejar la respuesta utilizando LLMs e inyección RAG del backend.
2. **Motor RAG robusto con Embeddings**:
   * Reemplaza la búsqueda de tokens en memoria por un almacén vectorial local ligero (como **ChromaDB**, **LanceDB** o simplemente embeddings guardados de OpenAI/Gemini procesados a través de similitud de coseno).
3. **Animación en Tiempo Real del Avatar 3D**:
   * Vincula las pistas de audio recibidas de OpenAI Realtime o LiveKit con el componente de avatar 3D para lograr **Lip-Sync** en tiempo real.
   * Puedes usar la referencia de TalkingHead (`_reference/talkinghead`) incluida en el proyecto para integrar la estimación de gesticulación a partir de las amplitudes de la señal de audio.

---

## 9. Prompt de Contexto para otra IA (Instrucciones Directas)

*Copia y pega este texto en tu sesión con otro asistente o IA para que empiece a programar inmediatamente sin explicaciones previas:*

```markdown
Hola. Vas a trabajar en el proyecto "ROKA Capacitación". Es una aplicación Full-stack monorepo para capacitaciones interactivas con instructores IA, voz realtime y avatares 3D.

Aquí tienes el contexto de desarrollo clave para que programes de forma directa:
1. El backend es un servidor Express escrito en ESM (fichero `server/index.mjs`) que corre por defecto en el puerto 8787.
2. El frontend está escrito en React 19 + TypeScript + Vite (`src/App.tsx`) con estilos en `src/styles.css`.
3. El frontend utiliza `@google/model-viewer` para cargar y renderizar archivos 3D de avatar .glb o .gltf.
4. El backend expone APIs críticas como:
   - `/api/config`: Para obtener y guardar la configuración de llaves y modelos en `server/provider-config.local.json`.
   - `/api/knowledge`: Para listar, subir y procesar documentos en un RAG local ligero guardado en `server/knowledge.local.json`.
   - `/api/livekit/token`: Para firmar tokens JWT de salas WebRTC de LiveKit de 30 minutos.
   - `/api/openai/realtime/session`: Que recibe un SDP del cliente, inyecta las directivas del RAG y negocia la conexión WebRTC con la API Realtime de OpenAI.
5. El flujo de chat clásico (`POST /api/chat`) usa búsqueda local por tokens normalizados y pasa los fragmentos recuperados en el prompt de sistema del LLM.

Quiero que me ayudes a implementar la siguiente característica a partir de esta estructura:
[ESCRIBE AQUÍ TU REQUERIMIENTO O FUNCIONALIDAD A IMPLEMENTAR]
```
