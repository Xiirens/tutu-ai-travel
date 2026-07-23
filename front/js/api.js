async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || `Ошибка HTTP ${response.status}`);
  }
  return payload;
}

export async function checkProxy() {
  return parseResponse(await fetch("/api/proxy/check"));
}

export async function sendChat(body) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}
