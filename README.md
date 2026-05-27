# ROKA TELEMARKETING

Centro omnicanal operativo para gestion comercial con:

- Llamadas (Twilio Voice)
- WhatsApp (Twilio WhatsApp)
- Telegram (Bot API)
- Bandeja unificada de conversaciones
- Guiones IA contextuales
- Registro de actividad y seguimiento en CRM
- PWA instalable

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Express (Node.js)
- IA: OpenAI
- Telefonia/mensajeria: Twilio + Telegram Bot API
- Integracion CRM: ROKA-CRM bridge (`agencyCrmBridge`)

## Requisitos

- Node 20+
- npm
- Cuenta Twilio (Voice + WhatsApp)
- Bot de Telegram
- ROKA-CRM desplegado (functions) o accesible por bridge

## Variables de entorno

Usa `.env.example` como base.

Claves principales:

- `PORT`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`
- `TWILIO_TWIML_APP_SID`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_AUTH_TOKEN`
- `WHATSAPP_PROVIDER`, `WHATSAPP_FROM`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_CHAT_ID`
- `CRM_BRIDGE_URL`, `CRM_ORGANIZATION_ID`, `CRM_BRIDGE_TOKEN` (opcional en local)
- `VITE_FIREBASE_*` para autenticacion Google/Firebase

## Correr en local

```bash
npm install
npm run dev:full
```

Servicios:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Scripts

```bash
npm run dev            # frontend
npm run server         # backend
npm run dev:full       # ambos
npm run build          # build produccion
npm run test:e2e:omnichannel
```

## Endpoints principales

### Bandeja omnicanal

- `POST /api/inbox/list`
- `POST /api/inbox/assign`
- `POST /api/inbox/:id/messages`
- `POST /api/inbox/:id/wrapup` (obligatorio outcome/reason)
- `POST /api/dev/seed-inbox` (demo local)

### Llamadas

- `POST /api/telephony/token`
- `POST /api/telephony/call/outbound`
- `POST /api/telephony/call/hangup`
- `POST /api/telephony/webhooks/voice`
- `POST /api/telephony/webhooks/status`

### Mensajeria

- `POST /api/messages/whatsapp/send`
- `POST /api/messages/whatsapp/webhook`
- `POST /api/messages/telegram/send`
- `POST /api/messages/telegram/webhook`
- `POST /api/messages/telegram/set-webhook`

### IA y CRM

- `POST /api/script/generate`
- `POST /api/script/refine`
- `POST /api/crm/context/:entityType/:entityId`
- `POST /api/crm/search-customer`

## Prueba rapida E2E

```bash
npm run test:e2e:omnichannel
```

Valida:

1. Seed de conversaciones demo
2. Asignacion de conversacion
3. Respuesta outbound
4. Wrap-up obligatorio
5. Cierre de interaccion

## Git y version

Version inicial sugerida:

```bash
git tag -a v1.0.0 -m "ROKA TELEMARKETING v1.0.0"
git push origin v1.0.0
```
