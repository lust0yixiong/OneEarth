export async function openTaskEvents(id: string, body: string, signal: AbortSignal) {
  const input: unknown = JSON.parse(body);
  const created = await fetch("/api/tasks", {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id, input}), signal,
  });
  if (!created.ok) return created;
  return fetch("/api/tasks/" + encodeURIComponent(id) + "/events", {signal, cache:"no-store"});
}
