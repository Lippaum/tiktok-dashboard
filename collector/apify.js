import { redact } from "./util.js";

const API = "https://api.apify.com/v2";
const USER_AGENT = "tiktok-dashboard/1.0 (+https://github.com/Lippaum/tiktok-dashboard)";
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

function clip(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}

function explainStatus(status) {
  if (status === 401) return "O token foi recusado. Confira o segredo APIFY_TOKEN.";
  if (status === 402) return "A conta Apify está sem crédito.";
  if (status === 403) return "O token não tem permissão para rodar este actor.";
  if (status === 404) return "Actor não encontrado. O id pode ter mudado na Apify.";
  if (status === 429) return "A Apify limitou a taxa. Rode de novo daqui a pouco.";
  return "";
}

async function request(token, url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: options.signal || AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new Error(`Falha de rede ao falar com a Apify: ${error.message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Apify respondeu HTTP ${response.status}. ${explainStatus(response.status)} ${clip(redact(text, token))}`.trim(),
    );
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`A Apify devolveu um JSON inválido em ${url.split("?")[0]}.`);
  }
}

async function abortRun(token, runId) {
  try {
    await request(token, `${API}/actor-runs/${runId}/abort`, { method: "POST" });
  } catch {
    // O erro original da coleta é mais útil do que uma falha ao cancelar.
  }
}

async function listItems(token, datasetId) {
  const items = [];
  const limit = 1000;
  let offset = 0;
  while (offset <= 20_000) {
    const page = await request(
      token,
      `${API}/datasets/${datasetId}/items?format=json&limit=${limit}&offset=${offset}`,
    );
    if (!Array.isArray(page)) {
      throw new Error(`O dataset ${datasetId} não veio como lista.`);
    }
    items.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return items;
}

export async function runActor(token, actorId, input, options = {}) {
  if (!/^[\w.\-]+\/[\w.\-]+$/.test(actorId)) {
    throw new Error(`Actor id inválido: ${actorId}`);
  }
  const timeoutSecs = options.timeoutSecs ?? 300;
  const memory = options.memoryMbytes ?? 256;
  const pollMs = options.pollMs ?? 4000;
  const maxWaitMs = options.maxWaitMs ?? 360_000;
  const id = actorId.replace("/", "~");
  const started = await request(
    token,
    `${API}/acts/${id}/runs?timeout=${timeoutSecs}&memory=${memory}`,
    { method: "POST", body: JSON.stringify(input) },
  );
  const runId = started?.data?.id;
  const datasetId = started?.data?.defaultDatasetId;
  if (!runId || !datasetId) {
    throw new Error(`A Apify não devolveu a execução de ${actorId}.`);
  }

  const startedAt = Date.now();
  let status = started.data.status;
  let statusMessage = started.data.statusMessage || "";
  while (!TERMINAL.has(status)) {
    if (Date.now() - startedAt > maxWaitMs) {
      await abortRun(token, runId);
      throw new Error(`A execução de ${actorId} passou de ${Math.round(maxWaitMs / 1000)}s e foi cancelada.`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const polled = await request(token, `${API}/actor-runs/${runId}`);
    status = polled?.data?.status;
    statusMessage = polled?.data?.statusMessage || statusMessage;
  }
  if (status !== "SUCCEEDED") {
    throw new Error(`O actor ${actorId} terminou com status ${status}. ${statusMessage}`.trim());
  }
  const items = await listItems(token, datasetId);
  return { runId, datasetId, items };
}
