import {
  CATEGORIES,
  cleanText,
  historyFormulas,
  isYes,
  isoToSerial,
  normalizeName,
  normalizeStatus,
  parseDateToIso,
  sheetForCategory
} from "./logic.js";

const API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";
const REQUIRED_SHEETS = Object.freeze(["PARTICIPANTES", "CUCA", "BEBIDAS", "LANCHES"]);

export class SheetsApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.name = "SheetsApiError";
    this.status = status;
    this.code = code;
  }
}

export class GoogleSheetsStore {
  constructor({ accessToken, spreadsheetId }) {
    this.accessToken = accessToken;
    this.spreadsheetId = spreadsheetId;
    this.sheetMap = new Map();
  }

  setAccessToken(accessToken) {
    this.accessToken = accessToken;
  }

  async request(path = "", options = {}) {
    const response = await fetch(`${API_ROOT}/${encodeURIComponent(this.spreadsheetId)}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiMessage = data?.error?.message || `Falha na comunicação com a planilha (HTTP ${response.status}).`;
      const message = response.status === 401
        ? "Sua sessão Google expirou. Entre novamente para continuar."
        : response.status === 403
          ? "Sua conta não possui permissão de edição nesta planilha, ou a API do Google Sheets não está habilitada."
          : response.status === 404
            ? "Planilha não encontrada. Revise o ID configurado e o compartilhamento."
            : apiMessage;
      throw new SheetsApiError(message, response.status, data?.error?.status || "");
    }
    return data;
  }

  async load() {
    const params = new URLSearchParams({
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
      majorDimension: "ROWS"
    });
    [
      "PARTICIPANTES!A4:I2000",
      "CUCA!A4:K5000",
      "BEBIDAS!A4:K5000",
      "LANCHES!A4:K5000"
    ].forEach((range) => params.append("ranges", range));

    const [metadata, values] = await Promise.all([
      this.request("?fields=properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))"),
      this.request(`/values:batchGet?${params.toString()}`)
    ]);

    this.sheetMap = new Map((metadata.sheets || []).map((sheet) => [sheet.properties.title, sheet.properties]));
    const missing = REQUIRED_SHEETS.filter((title) => !this.sheetMap.has(title));
    if (missing.length) throw new Error(`A planilha não possui as abas obrigatórias: ${missing.join(", ")}.`);

    const ranges = values.valueRanges || [];
    const participants = parseParticipants(ranges[0]?.values || []);
    const history = {
      CUCA: parseHistory(ranges[1]?.values || [], "CUCA", this.sheetMap.get("CUCA").sheetId),
      BEBIDA: parseHistory(ranges[2]?.values || [], "BEBIDA", this.sheetMap.get("BEBIDAS").sheetId),
      LANCHE: parseHistory(ranges[3]?.values || [], "LANCHE", this.sheetMap.get("LANCHES").sheetId)
    };

    return { title: metadata.properties?.title || "Planilha do rodízio", participants, history };
  }

  async updateValues(range, values, valueInputOption = "USER_ENTERED") {
    return this.request(`/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`, {
      method: "PUT",
      body: JSON.stringify({ range, majorDimension: "ROWS", values })
    });
  }

  async appendValues(range, values) {
    return this.request(`/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ range, majorDimension: "ROWS", values })
    });
  }

  async batchUpdateValues(data) {
    if (!data.length) return null;
    return this.request("/values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data })
    });
  }

  async batchUpdate(requests) {
    if (!requests.length) return null;
    return this.request(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  }

  async saveContribution(contribution) {
    const sheetTitle = sheetForCategory(contribution.category);
    let row;
    let id;
    if (contribution.existingSchedule) {
      row = contribution.existingSchedule.row;
      id = contribution.existingSchedule.id || makeUuid();
      await this.writeHistoryRow(sheetTitle, row, contribution, id);
    } else {
      const append = await this.appendValues(`${sheetTitle}!A:D`, [[
        isoToSerial(contribution.date),
        contribution.person,
        contribution.item,
        contribution.status
      ]]);
      row = rowFromUpdatedRange(append?.updates?.updatedRange);
      if (!row) throw new Error("O Google Sheets não informou a linha criada.");
      id = makeUuid();
      const formulas = historyFormulas(row, contribution.category);
      await this.updateValues(`${sheetTitle}!E${row}:K${row}`, [[...formulas, id]]);
      await this.formatDateCells(sheetTitle, row, [0]);
    }
    return { row, id, sheetTitle };
  }

  async writeHistoryRow(sheetTitle, row, contribution, id) {
    const formulas = historyFormulas(row, contribution.category);
    await this.updateValues(`${sheetTitle}!A${row}:K${row}`, [[
      isoToSerial(contribution.date),
      contribution.person,
      contribution.item,
      contribution.status,
      ...formulas,
      id
    ]]);
    await this.formatDateCells(sheetTitle, row, [0]);
  }

  async markRealized(record) {
    await this.updateValues(`${record.sheetTitle}!D${record.row}`, [["REALIZADO"]]);
  }

  async deleteRecord(record) {
    const sheetId = record.sheetId ?? this.sheetMap.get(record.sheetTitle)?.sheetId;
    if (sheetId === undefined) throw new Error("Não foi possível identificar a aba do registro.");
    await this.batchUpdate([{
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: Number(record.row) - 1,
          endIndex: Number(record.row)
        }
      }
    }]);
  }

  async saveParticipant(participant, rawData) {
    const existing = (rawData.participants || []).find((person) => normalizeName(person.name) === normalizeName(participant.originalName));
    const values = [[
      participant.name,
      isoToSerial(participant.generalStart),
      participant.cuca ? "SIM" : "NÃO",
      participant.cuca ? isoToSerial(participant.cucaStart) : "",
      participant.beverage ? "SIM" : "NÃO",
      participant.beverage ? isoToSerial(participant.beverageStart) : "",
      participant.snack ? "SIM" : "NÃO",
      participant.snack ? isoToSerial(participant.snackStart) : "",
      participant.notes
    ]];

    let row;
    if (existing) {
      row = existing.row;
      await this.updateValues(`PARTICIPANTES!A${row}:I${row}`, values);
    } else {
      const append = await this.appendValues("PARTICIPANTES!A:I", values);
      row = rowFromUpdatedRange(append?.updates?.updatedRange);
      if (!row) throw new Error("O Google Sheets não informou a linha criada para a pessoa.");
    }
    await this.formatDateCells("PARTICIPANTES", row, [1, 3, 5, 7]);

    if (existing && normalizeName(existing.name) !== normalizeName(participant.name)) {
      const renameUpdates = CATEGORIES.flatMap((category) => (rawData.history?.[category] || [])
        .filter((record) => normalizeName(record.person) === normalizeName(existing.name))
        .map((record) => ({ range: `${record.sheetTitle}!B${record.row}`, majorDimension: "ROWS", values: [[participant.name]] })));
      await this.batchUpdateValues(renameUpdates);
    }
    return { row };
  }

  async formatDateCells(sheetTitle, row, zeroBasedColumns) {
    const sheetId = this.sheetMap.get(sheetTitle)?.sheetId;
    if (sheetId === undefined) return;
    const requests = zeroBasedColumns.map((column) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: column, endColumnIndex: column + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/MM/yyyy" } } },
        fields: "userEnteredFormat.numberFormat"
      }
    }));
    await this.batchUpdate(requests);
  }
}

function parseParticipants(rows) {
  return rows.map((row, index) => {
    const generalStart = parseDateToIso(row[1]);
    return {
      row: index + 4,
      name: cleanText(row[0]),
      generalStart,
      cuca: isYes(row[2]),
      cucaStart: parseDateToIso(row[3]) || generalStart,
      beverage: isYes(row[4]),
      beverageStart: parseDateToIso(row[5]) || generalStart,
      snack: isYes(row[6]),
      snackStart: parseDateToIso(row[7]) || generalStart,
      notes: cleanText(row[8])
    };
  }).filter((person) => person.name);
}

function parseHistory(rows, category, sheetId) {
  const sheetTitle = sheetForCategory(category);
  return rows.map((row, index) => ({
    row: index + 4,
    id: cleanText(row[10]) || `${sheetTitle}-${index + 4}`,
    category,
    date: parseDateToIso(row[0]),
    person: cleanText(row[1]),
    item: cleanText(row[2]),
    status: normalizeStatus(row[3]),
    sheetTitle,
    sheetId
  })).filter((record) => record.date && (record.person || record.item || record.status));
}

function rowFromUpdatedRange(range) {
  const match = cleanText(range).match(/![A-Z]+(\d+):[A-Z]+\d+$/i);
  return match ? Number(match[1]) : 0;
}

function makeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    return (char === "x" ? value : value & 0x3 | 0x8).toString(16);
  });
}

export class DemoStore {
  constructor() {
    this.raw = demoRawData();
  }

  async load() {
    return structuredClone(this.raw);
  }

  async saveContribution(contribution) {
    const list = this.raw.history[contribution.category];
    if (contribution.existingSchedule) {
      Object.assign(list.find((item) => item.id === contribution.existingSchedule.id), {
        date: contribution.date,
        person: contribution.person,
        item: contribution.item,
        status: contribution.status
      });
      return;
    }
    const row = Math.max(3, ...list.map((item) => item.row)) + 1;
    list.push({ id: makeUuid(), row, category: contribution.category, date: contribution.date, person: contribution.person, item: contribution.item, status: contribution.status, sheetTitle: sheetForCategory(contribution.category), sheetId: CATEGORIES.indexOf(contribution.category) + 2 });
  }

  async markRealized(record) {
    const item = this.raw.history[record.category].find((candidate) => candidate.id === record.id);
    if (item) item.status = "REALIZADO";
  }

  async deleteRecord(record) {
    this.raw.history[record.category] = this.raw.history[record.category].filter((candidate) => candidate.id !== record.id);
  }

  async saveParticipant(participant) {
    const existing = this.raw.participants.find((person) => normalizeName(person.name) === normalizeName(participant.originalName));
    if (existing) Object.assign(existing, participant, { row: existing.row });
    else this.raw.participants.push({ ...participant, row: Math.max(3, ...this.raw.participants.map((person) => person.row)) + 1 });
  }
}

export function demoRawData() {
  return {
    title: "Demonstração",
    participants: [
      { row: 4, name: "Ana", generalStart: "2026-06-19", cuca: true, cucaStart: "2026-06-19", beverage: true, beverageStart: "2026-06-19", snack: true, snackStart: "2026-07-06", notes: "" },
      { row: 5, name: "Bruno", generalStart: "2026-06-19", cuca: true, cucaStart: "2026-06-19", beverage: true, beverageStart: "2026-06-19", snack: true, snackStart: "2026-07-06", notes: "" },
      { row: 6, name: "Carla", generalStart: "2026-07-03", cuca: true, cucaStart: "2026-08-07", beverage: true, beverageStart: "2026-07-03", snack: true, snackStart: "2026-07-06", notes: "Entrada posterior" }
    ],
    history: {
      CUCA: [
        { id: "demo-c1", row: 4, category: "CUCA", date: "2026-08-21", person: "Ana", item: "Chocolate", status: "REALIZADO", sheetTitle: "CUCA", sheetId: 2 },
        { id: "demo-c2", row: 5, category: "CUCA", date: "2026-09-04", person: "Bruno", item: "A definir", status: "PROGRAMADO", sheetTitle: "CUCA", sheetId: 2 }
      ],
      BEBIDA: [
        { id: "demo-b1", row: 4, category: "BEBIDA", date: "2026-08-18", person: "Bruno", item: "Refrigerante", status: "REALIZADO", sheetTitle: "BEBIDAS", sheetId: 3 },
        { id: "demo-b2", row: 5, category: "BEBIDA", date: "2026-08-26", person: "Carla", item: "Suco", status: "REALIZADO", sheetTitle: "BEBIDAS", sheetId: 3 }
      ],
      LANCHE: [
        { id: "demo-l1", row: 4, category: "LANCHE", date: "2026-08-25", person: "Ana", item: "Amendoim", status: "REALIZADO", sheetTitle: "LANCHES", sheetId: 4 }
      ]
    }
  };
}
