import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboard,
  dailyHomeMessage,
  dailyPhrasePeriod,
  historyFormulas,
  isoToBr,
  isoToSerial,
  nextFridayIso,
  normalizeCategory,
  parseDateToIso,
  validateContribution,
  validateParticipant
} from "../logic.js";
import { demoRawData } from "../sheets-api.js";

test("normaliza categorias usadas pela interface antiga", () => {
  assert.equal(normalizeCategory("Bebida"), "BEBIDA");
  assert.equal(normalizeCategory("Lanche / Amendoim"), "LANCHE");
  assert.equal(normalizeCategory("cuca"), "CUCA");
});

test("converte datas sem depender do fuso do computador", () => {
  assert.equal(parseDateToIso("07/08/2026"), "2026-08-07");
  assert.equal(isoToBr("2026-08-07"), "07/08/2026");
  assert.equal(parseDateToIso(46241), "2026-08-07");
  assert.equal(parseDateToIso("46241"), "2026-08-07");
  assert.equal(isoToSerial("2026-08-07"), 46241);
  assert.equal(nextFridayIso("2026-09-02"), "2026-09-04");
});

test("troca a sabedoria diária às 07h no horário de São Paulo", () => {
  const before = new Date("2026-09-02T09:59:59Z");
  const atSeven = new Date("2026-09-02T10:00:00Z");
  const later = new Date("2026-09-02T20:00:00Z");
  const nextMorning = new Date("2026-09-03T10:00:00Z");

  assert.equal(dailyPhrasePeriod(before), "2026-09-01");
  assert.equal(dailyPhrasePeriod(atSeven), "2026-09-02");
  assert.equal(dailyHomeMessage(atSeven), dailyHomeMessage(later));
  assert.notEqual(dailyHomeMessage(atSeven), dailyHomeMessage(nextMorning));
});

test("mantém a regra de saldo esperado menos realizado", () => {
  const dashboard = buildDashboard(demoRawData(), { referenceIso: "2026-09-02", now: new Date("2026-09-02T12:00:00Z") });
  assert.equal(dashboard.baseStats.total, 5);
  assert.equal(dashboard.baseStats.realized, 4);
  assert.equal(dashboard.baseStats.programmed, 1);
  assert.equal(dashboard.schedules[0].person, "Bruno");
  assert.equal(dashboard.rankings.BEBIDA.length, 3);
  assert.equal(dashboard.rankings.BEBIDA[0].priority, 1);
  assert.equal(dashboard.rankings.BEBIDA[0].balance >= dashboard.rankings.BEBIDA[1].balance, true);
});

test("não gera dívida retroativa antes da entrada de uma pessoa", () => {
  const raw = demoRawData();
  raw.history.CUCA.push({ id: "early", row: 3, category: "CUCA", date: "2026-07-31", person: "Carla", item: "Extra", status: "REALIZADO", sheetTitle: "CUCA", sheetId: 2 });
  const dashboard = buildDashboard(raw, { referenceIso: "2026-09-02", now: new Date("2026-09-02T12:00:00Z") });
  const early = dashboard.baseRecords.find((record) => record.id === "early");
  assert.equal(early.counts, "NÃO");
  assert.equal(early.calcNote, "EXTRA PRÉ-INÍCIO");
});

test("valida CUCA somente às sextas-feiras", () => {
  const raw = demoRawData();
  assert.throws(() => validateContribution({ pessoa: "Ana", categoria: "CUCA", data: "2026-09-03", acao: "agendado" }, raw, "2026-09-02"), /sexta-feira/);
  const valid = validateContribution({ pessoa: "Ana", categoria: "CUCA", data: "2026-09-11", acao: "agendado" }, raw, "2026-09-02");
  assert.equal(valid.category, "CUCA");
});

test("impede duplicidade realizada na mesma data", () => {
  const raw = demoRawData();
  assert.throws(() => validateContribution({ pessoa: "Bruno", categoria: "BEBIDA", data: "2026-08-18", acao: "realizado" }, raw, "2026-09-02"), /Já existe/);
});

test("novo participante não sobrescreve nome existente", () => {
  const raw = demoRawData();
  assert.throws(() => validateParticipant({ name: "Ana", generalStart: "2026-09-02", cuca: true }, raw.participants), /Já existe/);
  const participant = validateParticipant({ name: "Daniel", generalStart: "2026-09-02", cuca: true }, raw.participants);
  assert.equal(participant.name, "Daniel");
  assert.equal(participant.cucaStart, "2026-09-02");
});

test("gera seis fórmulas de auditoria por linha", () => {
  const formulas = historyFormulas(12, "BEBIDA");
  assert.equal(formulas.length, 6);
  assert.equal(formulas.every((formula) => formula.startsWith("=")), true);
  assert.match(formulas[0], /A12/);
  assert.match(formulas[0], /PARTICIPANTES/);
});
