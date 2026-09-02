import test from "node:test";
import assert from "node:assert/strict";

import { GoogleSheetsStore, SheetsApiError } from "../sheets-api.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("carrega somente as quatro abas-fonte e mantém as linhas", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("fields=")) {
      return jsonResponse({
        properties: { title: "Rodízio" },
        sheets: [
          { properties: { sheetId: 1, title: "PARTICIPANTES" } },
          { properties: { sheetId: 2, title: "CUCA" } },
          { properties: { sheetId: 3, title: "BEBIDAS" } },
          { properties: { sheetId: 4, title: "LANCHES" } }
        ]
      });
    }
    return jsonResponse({ valueRanges: [
      { values: [["Ana", "19/06/2026", "SIM", "19/06/2026", "SIM", "19/06/2026", "SIM", "06/07/2026", ""]] },
      { values: [["21/08/2026", "Ana", "Chocolate", "REALIZADO", "SIM", "1", "1", "REALIZADO", "", "OK", "id-c1"]] },
      { values: [] },
      { values: [] }
    ] });
  };

  const store = new GoogleSheetsStore({ accessToken: "token", spreadsheetId: "sheet-id-12345678901234567890" });
  const raw = await store.load();
  assert.equal(raw.title, "Rodízio");
  assert.equal(raw.participants[0].generalStart, "2026-06-19");
  assert.equal(raw.history.CUCA[0].row, 4);
  assert.equal(raw.history.CUCA[0].id, "id-c1");
  assert.equal(calls.every((call) => call.options.headers.Authorization === "Bearer token"), true);
});

test("adiciona registro, fórmulas e ID na linha devolvida pelo append", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes(":append")) return jsonResponse({ updates: { updatedRange: "'BEBIDAS'!A9:D9" } });
    return jsonResponse({});
  };

  const store = new GoogleSheetsStore({ accessToken: "token", spreadsheetId: "sheet-id-12345678901234567890" });
  store.sheetMap = new Map([["BEBIDAS", { sheetId: 3 }]]);
  const saved = await store.saveContribution({ category: "BEBIDA", date: "2026-09-02", person: "Ana", item: "Refrigerante", status: "PROGRAMADO", existingSchedule: null });
  assert.equal(saved.row, 9);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /BEBIDAS!A%3AD:append/);
  assert.match(calls[1].url, /BEBIDAS!E9%3AK9/);
  assert.equal(calls[1].body.values[0].length, 7);
  assert.match(calls[1].body.values[0][0], /^=IF/);
  assert.match(calls[1].body.values[0][6], /^[0-9a-f-]{36}$/i);
  assert.equal(calls[2].body.requests[0].repeatCell.range.sheetId, 3);
});

test("remove exatamente a linha selecionada", async (t) => {
  let body;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse({});
  };
  const store = new GoogleSheetsStore({ accessToken: "token", spreadsheetId: "sheet-id-12345678901234567890" });
  await store.deleteRecord({ sheetTitle: "CUCA", sheetId: 2, row: 11 });
  const range = body.requests[0].deleteDimension.range;
  assert.deepEqual(range, { sheetId: 2, dimension: "ROWS", startIndex: 10, endIndex: 11 });
});

test("traduz erro de permissão da API em mensagem útil", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => jsonResponse({ error: { message: "Forbidden", status: "PERMISSION_DENIED" } }, 403);
  const store = new GoogleSheetsStore({ accessToken: "token", spreadsheetId: "sheet-id-12345678901234567890" });
  await assert.rejects(() => store.request(""), (error) => error instanceof SheetsApiError && error.status === 403 && /permissão/.test(error.message));
});
