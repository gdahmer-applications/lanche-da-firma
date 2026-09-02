import test from "node:test";
import assert from "node:assert/strict";

import {
  AppsScriptAiClient,
  AppsScriptAiError,
  buildAiContext,
  isAiDeploymentConfigured
} from "../ai-client.js";

const DEPLOYMENT_ID = "AKfycb1234567890abcdefghijklmnop";

test("aceita somente um Deployment ID preenchido", () => {
  assert.equal(isAiDeploymentConfigured(DEPLOYMENT_ID), true);
  assert.equal(isAiDeploymentConfigured(""), false);
  assert.equal(isAiDeploymentConfigured("COLE_O_ID_AQUI"), false);
});

test("envia todos os registros do painel no contexto da IA", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    id: `id-${index}`,
    dateIso: "2026-09-02",
    category: "BEBIDA",
    person: `Pessoa ${index}`,
    item: "Refrigerante",
    status: "REALIZADO",
    credit: 0.25
  }));
  const context = buildAiContext({
    referenceIso: "2026-09-02",
    app: { timezone: "America/Sao_Paulo" },
    baseRecords: records
  });
  assert.equal(context.records.length, records.length);
  assert.equal(context.records[11].person, "Pessoa 11");
});

test("executa a função do Apps Script com OAuth e devolve o resultado", async () => {
  let request;
  const client = new AppsScriptAiClient({
    accessToken: "token-de-teste",
    deploymentId: DEPLOYMENT_ID,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: { result: { ok: true, source: "gemini", answer: "Resposta" } } })
      };
    }
  });
  const result = await client.askAdvisor({ question: "Quem traz?", context: { records: [] } });
  const body = JSON.parse(request.options.body);
  assert.match(request.url, /script\.googleapis\.com\/v1\/scripts\/.*:run$/);
  assert.equal(request.options.headers.Authorization, "Bearer token-de-teste");
  assert.equal(body.function, "pagesAskAdvisor");
  assert.equal(body.parameters[0].question, "Quem traz?");
  assert.equal(result.answer, "Resposta");
});

test("mantém o contexto global ao chamar um fetch sensível a this", async () => {
  const sensitiveFetch = async function () {
    assert.equal(this, globalThis);
    return {
      ok: true,
      status: 200,
      json: async () => ({ response: { result: { ok: true, source: "gemini", phrase: "Frase" } } })
    };
  };
  const client = new AppsScriptAiClient({
    accessToken: "token-de-teste",
    deploymentId: DEPLOYMENT_ID,
    fetchImpl: sensitiveFetch
  });
  const result = await client.getDailyWisdom({});
  assert.equal(result.phrase, "Frase");
});

test("traduz falha de permissão do backend", async () => {
  const client = new AppsScriptAiClient({
    accessToken: "token-de-teste",
    deploymentId: DEPLOYMENT_ID,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({})
    })
  });
  await assert.rejects(
    () => client.getDailyWisdom({}),
    (error) => error instanceof AppsScriptAiError && error.status === 403 && /acesso/.test(error.message)
  );
});
