const SCRIPT_API_ROOT = "https://script.googleapis.com/v1/scripts";

export const AI_EXECUTION_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.storage",
  "https://www.googleapis.com/auth/userinfo.email"
]);

export class AppsScriptAiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.name = "AppsScriptAiError";
    this.status = status;
    this.code = code;
  }
}

export function isAiDeploymentConfigured(value) {
  const deploymentId = String(value || "").trim();
  return /^[A-Za-z0-9_-]{20,}$/.test(deploymentId) && !deploymentId.startsWith("COLE_");
}

export function buildAiContext(dashboard) {
  const data = dashboard || {};
  return {
    referenceDate: data.referenceIso || "",
    timezone: data.app?.timezone || "America/Sao_Paulo",
    rules: [
      "CUCA acontece às sextas-feiras; bebida e lanche possuem data livre.",
      "Saldo é esperado menos realizado; quanto maior o saldo, maior a prioridade.",
      "PROGRAMADO não reduz saldo; somente REALIZADO conta.",
      "Um realizado por pessoa, categoria e data conta no máximo uma vez."
    ],
    cards: data.cards || [],
    rankings: data.rankings || {},
    participants: data.participants || [],
    schedules: data.schedules || [],
    statistics: data.baseStats || {},
    records: (data.baseRecords || []).map((record) => ({
      id: record.id || "",
      date: record.dateIso || record.date || "",
      category: record.category || "",
      person: record.person || "",
      item: record.item || "",
      status: record.status || "",
      counts: record.counts || "",
      eligible: record.eligible ?? "",
      credit: record.credit ?? "",
      calculationNote: record.calcNote || "",
      validation: record.validation || ""
    }))
  };
}

export class AppsScriptAiClient {
  constructor({ accessToken, deploymentId, fetchImpl = globalThis.fetch }) {
    if (!isAiDeploymentConfigured(deploymentId)) throw new Error("Deployment ID do Apps Script inválido.");
    if (typeof fetchImpl !== "function") throw new Error("Fetch indisponível para consultar o Apps Script.");
    this.accessToken = accessToken;
    this.deploymentId = String(deploymentId).trim();
    this.fetchImpl = fetchImpl;
  }

  setAccessToken(accessToken) {
    this.accessToken = accessToken;
  }

  async execute(functionName, parameters = []) {
    if (!this.accessToken) throw new AppsScriptAiError("Sessão Google ausente. Entre novamente.", 401, "NO_TOKEN");
    const response = await this.fetchImpl(`${SCRIPT_API_ROOT}/${encodeURIComponent(this.deploymentId)}:run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ function: functionName, parameters, devMode: false })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fallback = response.status === 401
        ? "Sua sessão Google expirou. Entre novamente para consultar o Gemini."
        : response.status === 403
          ? "Sua conta não possui acesso ao backend Gemini ou o Apps Script usa outro projeto Google Cloud."
          : response.status === 404
            ? "Backend Gemini não encontrado. Revise o Deployment ID do Apps Script."
            : `Falha ao consultar o backend Gemini (HTTP ${response.status}).`;
      throw new AppsScriptAiError(data?.error?.message || fallback, response.status, data?.error?.status || "");
    }
    if (data.error) {
      const detail = Array.isArray(data.error.details) ? data.error.details[0] : null;
      throw new AppsScriptAiError(detail?.errorMessage || data.error.message || "O Apps Script não concluiu a solicitação.", 200, "SCRIPT_ERROR");
    }
    if (!data.response || !Object.prototype.hasOwnProperty.call(data.response, "result")) {
      throw new AppsScriptAiError("O Apps Script respondeu sem resultado.", 200, "EMPTY_RESULT");
    }
    return data.response.result;
  }

  askAdvisor(payload) {
    if (!String(payload?.question || "").trim()) throw new AppsScriptAiError("Digite uma pergunta para o Conselheiro.", 400, "EMPTY_QUESTION");
    const contextSize = JSON.stringify(payload?.context || {}).length;
    if (contextSize > 4000000) throw new AppsScriptAiError("A base está grande demais para uma única consulta ao Conselheiro.", 413, "CONTEXT_TOO_LARGE");
    return this.execute("pagesAskAdvisor", [payload]);
  }

  getDailyWisdom(payload) {
    return this.execute("pagesGetDailyWisdom", [payload]);
  }
}
