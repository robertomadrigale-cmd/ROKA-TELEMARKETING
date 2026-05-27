const baseUrl = process.env.ROKA_API_URL || "http://localhost:8787";

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${data.error || JSON.stringify(data)}`);
  }
  return data;
}

async function run() {
  console.log(`[e2e] baseUrl=${baseUrl}`);

  const seed = await post("/api/dev/seed-inbox", {});
  console.log(`[e2e] seed count=${seed.count}`);

  const inbox = await post("/api/inbox/list", {});
  if (!Array.isArray(inbox.items) || inbox.items.length === 0) {
    throw new Error("No hay conversaciones en bandeja después del seed.");
  }
  const conversation = inbox.items[0];
  console.log(`[e2e] selected conversation=${conversation.id} status=${conversation.status}`);

  await post("/api/inbox/assign", {
    conversationId: conversation.id,
    assignedTo: "agente-e2e",
  });
  console.log("[e2e] assigned");

  await post(`/api/inbox/${conversation.id}/messages`, {
    text: "Mensaje de prueba E2E desde agente.",
    channel: conversation.lastChannel || "whatsapp",
    direction: "outbound",
  });
  console.log("[e2e] reply sent");

  await post(`/api/inbox/${conversation.id}/wrapup`, {
    outcome: "contactado",
    reason: "interesado",
    notes: "Cliente solicita propuesta por correo.",
    followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    followUpType: "call",
  });
  console.log("[e2e] wrap-up closed");

  const finalInbox = await post("/api/inbox/list", {});
  const finalRow = finalInbox.items.find((row) => row.id === conversation.id);
  if (!finalRow || finalRow.status !== "closed") {
    throw new Error("La conversación no quedó cerrada.");
  }
  if (!finalRow.wrapUp?.outcome || !finalRow.wrapUp?.reason) {
    throw new Error("Wrap-up no guardado correctamente.");
  }

  console.log("[e2e] PASS omnichannel flow");
}

run().catch((error) => {
  console.error(`[e2e] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
