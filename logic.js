export const CATEGORIES = Object.freeze(["CUCA", "BEBIDA", "LANCHE"]);

const CATEGORY_RULES = Object.freeze({
  CUCA: { participates: "cuca", start: "cucaStart", sheet: "CUCA", flagColumn: "C", startColumn: "D" },
  BEBIDA: { participates: "beverage", start: "beverageStart", sheet: "BEBIDAS", flagColumn: "E", startColumn: "F" },
  LANCHE: { participates: "snack", start: "snackStart", sheet: "LANCHES", flagColumn: "G", startColumn: "H" }
});

const HOME_MESSAGES = Object.freeze([
  "Aqui todo mundo gosta quando chega bem recheado. Estamos falando do lanche, obviamente.",
  "Quem promete trazer e não traz deixa todo mundo com vontade. De comer.",
  "Gelado, grande e compartilhado: a bebida, gente.",
  "Sexta é dia de pegar firme… no pedaço de cuca.",
  "O importante é não deixar ninguém seco. Estamos falando do refri.",
  "Pode ser doce ou salgado. O que não pode é chegar de mãos vazias.",
  "O rodízio é democrático: todo mundo tem sua vez de colocar coisa na mesa."
]);

export function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function stripAccents(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeName(value) {
  return stripAccents(cleanText(value).toLowerCase());
}

export function normalizeCategory(value) {
  const text = stripAccents(cleanText(value).toUpperCase());
  if (text.includes("CUCA")) return "CUCA";
  if (text.includes("BEBIDA") || text.includes("REFRI") || text.includes("ENERGETICO")) return "BEBIDA";
  if (text.includes("LANCHE") || text.includes("AMENDOIM") || text.includes("PETISCO")) return "LANCHE";
  return "";
}

export function normalizeStatus(value) {
  const text = stripAccents(cleanText(value).toUpperCase());
  if (text.includes("REALIZADO") || text.includes("PAGO")) return "REALIZADO";
  if (text.includes("PROGRAMADO") || text.includes("AGENDADO")) return "PROGRAMADO";
  return text;
}

export function isYes(value) {
  const text = stripAccents(cleanText(value).toUpperCase());
  return text === "SIM" || text === "TRUE" || text === "1" || text === "YES";
}

export function parseDateToIso(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  if (/^\d+(?:\.\d+)?$/.test(text) && Number(text) > 20000) return parseDateToIso(Number(text));
  return "";
}

export function isoToBr(iso) {
  const match = cleanText(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : cleanText(iso);
}

export function isoToSerial(iso) {
  const date = isoDate(iso);
  if (!date) return "";
  return Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

export function isoDate(iso) {
  const match = cleanText(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function todayIso(timezone = "America/Sao_Paulo", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function daysBetween(fromIso, toIso) {
  const from = isoDate(fromIso);
  const to = isoDate(toIso);
  if (!from || !to) return 0;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

export function nextFridayIso(baseIso) {
  const date = isoDate(baseIso);
  if (!date) return "";
  const add = (5 - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + add);
  return date.toISOString().slice(0, 10);
}

export function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

export function signed(value, decimals = 3) {
  const number = round(value, decimals);
  return `${number > 0 ? "+" : ""}${number.toFixed(decimals).replace(".", ",")}`;
}

export function categoryRule(participant, category) {
  const spec = CATEGORY_RULES[category];
  if (!participant || !spec) return { participates: false, start: "" };
  return {
    participates: Boolean(participant[spec.participates]),
    start: participant[spec.start] || participant.generalStart || ""
  };
}

export function sheetForCategory(category) {
  const spec = CATEGORY_RULES[category];
  if (!spec) throw new Error("Categoria sem aba configurada.");
  return spec.sheet;
}

export function defaultItem(category) {
  if (category === "CUCA") return "Cuca";
  if (category === "BEBIDA") return "Bebida";
  return "Lanche / algo para comer";
}

export function insightFromBalance(balance) {
  if (balance >= 0.5) return "ATRASADO";
  if (balance > 0.1) return "NA VEZ";
  if (balance >= -0.1) return "EQUILIBRADO";
  return "ADIANTADO";
}

function findParticipant(participants, name) {
  const target = normalizeName(name);
  return participants.find((person) => normalizeName(person.name) === target) || null;
}

function activeCountAt(participants, category, dateIso) {
  return participants.filter((participant) => {
    const rule = categoryRule(participant, category);
    return rule.participates && rule.start && rule.start <= dateIso;
  }).length;
}

function enrichCategoryRecords(participants, events, category, referenceIso) {
  const duplicateKeys = new Set();
  return events
    .filter((event) => event.date)
    .slice()
    .sort((a, b) => Number(a.row || 0) - Number(b.row || 0))
    .map((event) => {
      const status = normalizeStatus(event.status);
      const owner = findParticipant(participants, event.person);
      const rule = categoryRule(owner, category);
      const key = `${normalizeName(event.person)}|${event.date}`;
      const duplicate = status === "REALIZADO" && duplicateKeys.has(key);
      if (status === "REALIZADO") duplicateKeys.add(key);
      const outsideRotation = !owner || !rule.participates;
      const beforeStart = Boolean(owner && rule.participates && rule.start && event.date < rule.start);
      const counts = status === "REALIZADO" && !duplicate && !outsideRotation && !beforeStart;
      const eligible = activeCountAt(participants, category, event.date);
      const credit = counts && event.date <= referenceIso && eligible > 0 ? 1 / eligible : 0;
      const calcNote = duplicate
        ? "DUPLICADO MESMO DIA"
        : outsideRotation
          ? "FORA DO RODÍZIO"
          : beforeStart
            ? "EXTRA PRÉ-INÍCIO"
            : "";
      const date = isoDate(event.date);
      const validation = category === "CUCA" && date && date.getUTCDay() !== 5
        ? "⚠ FORA DE SEXTA"
        : counts
          ? "OK"
          : calcNote || "-";
      return {
        ...event,
        category,
        status,
        counts: counts ? "SIM" : "NÃO",
        eligible,
        credit: round(credit, 3),
        situation: status,
        calcNote,
        validation
      };
    });
}

function calculateCategoryRanking(participants, records, category, referenceIso) {
  const validEvents = records
    .filter((event) => event.counts === "SIM" && event.date <= referenceIso)
    .map((event) => ({ date: event.date, person: event.person, share: Number(event.credit || 0) }));

  const rows = participants
    .filter((participant) => {
      const rule = categoryRule(participant, category);
      return rule.participates && rule.start && rule.start <= referenceIso;
    })
    .map((participant) => {
      const rule = categoryRule(participant, category);
      const ownEvents = validEvents.filter((event) => normalizeName(event.person) === normalizeName(participant.name));
      const relevantEvents = validEvents.filter((event) => event.date >= rule.start);
      const expected = relevantEvents.reduce((sum, event) => sum + event.share, 0);
      const lastTime = ownEvents.reduce((latest, event) => !latest || event.date > latest ? event.date : latest, "");
      const balance = round(expected - ownEvents.length, 3);
      return {
        name: participant.name,
        participates: true,
        startDate: isoToBr(rule.start),
        realized: ownEvents.length,
        expected: round(expected, 3),
        balance,
        lastTime: isoToBr(lastTime),
        lastTimeIso: lastTime,
        daysWithout: daysBetween(lastTime || rule.start, referenceIso),
        priority: 999,
        insight: insightFromBalance(balance),
        notes: participant.notes || ""
      };
    });

  rows.sort((a, b) => b.balance - a.balance || b.daysWithout - a.daysWithout || a.name.localeCompare(b.name, "pt-BR"));
  rows.forEach((row, index) => { row.priority = index + 1; });
  return rows;
}

function buildStats(records) {
  const stats = {
    total: 0,
    realized: 0,
    programmed: 0,
    byCategory: Object.fromEntries(CATEGORIES.map((category) => [category, { total: 0, realized: 0, programmed: 0 }])),
    byPerson: []
  };
  const people = new Map();
  records.forEach((record) => {
    stats.total += 1;
    if (record.status === "REALIZADO") stats.realized += 1;
    if (record.status === "PROGRAMADO") stats.programmed += 1;
    const category = stats.byCategory[record.category];
    category.total += 1;
    if (record.status === "REALIZADO") category.realized += 1;
    if (record.status === "PROGRAMADO") category.programmed += 1;
    if (!record.person) return;
    const key = normalizeName(record.person);
    if (!people.has(key)) people.set(key, { name: record.person, total: 0, realized: 0, programmed: 0, cuca: 0, beverage: 0, snack: 0 });
    const person = people.get(key);
    person.total += 1;
    if (record.status === "REALIZADO") {
      person.realized += 1;
      if (record.category === "CUCA") person.cuca += 1;
      if (record.category === "BEBIDA") person.beverage += 1;
      if (record.category === "LANCHE") person.snack += 1;
    }
    if (record.status === "PROGRAMADO") person.programmed += 1;
  });
  stats.byPerson = [...people.values()].sort((a, b) => b.realized - a.realized || a.name.localeCompare(b.name, "pt-BR"));
  return stats;
}

function buildCards(participants, recordsByCategory, rankings, referenceIso) {
  return CATEGORIES.map((category) => {
    const next = recordsByCategory[category]
      .filter((record) => record.status === "PROGRAMADO" && record.date >= referenceIso && record.person)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const activeToday = activeCountAt(participants, category, referenceIso);
    if (next) {
      return {
        category,
        responsible: next.person,
        date: isoToBr(next.date),
        reason: "Agenda já definida",
        activeToday,
        observation: next.item || "PROGRAMADO"
      };
    }
    const top = rankings[category]?.[0];
    return {
      category,
      responsible: top?.name || "—",
      date: category === "CUCA" ? isoToBr(nextFridayIso(referenceIso)) : "LIVRE",
      reason: top ? "Maior saldo + mais tempo sem trazer" : "Sem participantes ativos",
      activeToday,
      observation: top ? `Saldo ${signed(top.balance)}` : ""
    };
  });
}

function serializeParticipant(participant) {
  return {
    ...participant,
    generalStartText: isoToBr(participant.generalStart),
    cucaStartText: participant.cuca ? isoToBr(participant.cucaStart || participant.generalStart) : "",
    beverageStartText: participant.beverage ? isoToBr(participant.beverageStart || participant.generalStart) : "",
    snackStartText: participant.snack ? isoToBr(participant.snackStart || participant.generalStart) : ""
  };
}

export function buildDashboard(rawData, options = {}) {
  const timezone = options.timezone || "America/Sao_Paulo";
  const referenceIso = options.referenceIso || todayIso(timezone);
  const participants = (rawData.participants || []).filter((person) => person.name).map((person) => ({ ...person }));
  const recordsByCategory = {};
  const rankings = {};

  CATEGORIES.forEach((category) => {
    recordsByCategory[category] = enrichCategoryRecords(participants, rawData.history?.[category] || [], category, referenceIso);
    rankings[category] = calculateCategoryRanking(participants, recordsByCategory[category], category, referenceIso);
  });

  const baseRecords = CATEGORIES.flatMap((category) => recordsByCategory[category])
    .sort((a, b) => b.date.localeCompare(a.date) || a.category.localeCompare(b.category) || Number(b.row || 0) - Number(a.row || 0))
    .map((record) => ({ ...record, dateIso: record.date, date: isoToBr(record.date) }));
  const schedules = baseRecords.filter((record) => record.status === "PROGRAMADO").sort((a, b) => a.dateIso.localeCompare(b.dateIso));
  const now = options.now || new Date();
  const generatedAt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "medium"
  }).format(now);

  return {
    ok: true,
    app: { title: "Lanche da Firma", timezone, aiEnabled: false, provider: "local", metricsMode: "dynamic-pages-v4" },
    generatedAt,
    referenceIso,
    mainMessage: HOME_MESSAGES[Math.floor(Math.random() * HOME_MESSAGES.length)],
    cards: buildCards(participants, recordsByCategory, rankings, referenceIso),
    rankings,
    participants: participants.map(serializeParticipant),
    recentActivity: baseRecords.slice(0, 14),
    schedules,
    baseRecords,
    baseStats: buildStats(baseRecords)
  };
}

export function validateContribution(payload, rawData, referenceIso) {
  const category = normalizeCategory(payload.category || payload.categoria);
  const personName = cleanText(payload.person || payload.pessoa);
  const date = parseDateToIso(payload.date || payload.data);
  const action = cleanText(payload.action || payload.acao || "agendado").toLowerCase();
  if (!personName) throw new Error("Selecione quem vai trazer.");
  if (!category) throw new Error("Selecione uma categoria válida.");
  if (!date) throw new Error("Informe uma data válida.");
  if (!["agendado", "realizado"].includes(action)) throw new Error("Ação inválida.");
  const parsed = isoDate(date);
  if (category === "CUCA" && parsed?.getUTCDay() !== 5) throw new Error("A CUCA deve ser agendada para uma sexta-feira.");
  const participant = findParticipant(rawData.participants || [], personName);
  if (!participant) throw new Error("Pessoa não encontrada. Cadastre-a primeiro em Pessoas.");
  const rule = categoryRule(participant, category);
  if (!rule.participates) throw new Error(`${participant.name} não participa do rodízio de ${category.toLowerCase()}.`);
  const matches = (rawData.history?.[category] || []).filter((event) => normalizeName(event.person) === normalizeName(personName) && event.date === date);
  if (action === "realizado" && matches.some((event) => normalizeStatus(event.status) === "REALIZADO")) {
    throw new Error(`Já existe uma participação realizada para ${participant.name} nesta categoria e data.`);
  }
  return {
    person: participant.name,
    category,
    date,
    item: cleanText(payload.item) || defaultItem(category),
    status: action === "realizado" ? "REALIZADO" : "PROGRAMADO",
    existingSchedule: matches.find((event) => normalizeStatus(event.status) === "PROGRAMADO") || null,
    warning: rule.start && date < rule.start ? "Registro pré-início: ficará fora do saldo do rodízio." : "",
    referenceIso
  };
}

export function validateParticipant(payload, participants = []) {
  const name = cleanText(payload.name || payload.nome);
  const originalName = cleanText(payload.originalName);
  const generalStart = parseDateToIso(payload.generalStart || payload.inicioGeral);
  const cuca = Boolean(payload.cuca);
  const beverage = Boolean(payload.beverage ?? payload.bebida);
  const snack = Boolean(payload.snack ?? payload.lanche);
  if (!name) throw new Error("Informe o nome da pessoa.");
  if (!generalStart) throw new Error("Informe a data de início geral.");
  if (!cuca && !beverage && !snack) throw new Error("Selecione pelo menos uma categoria de participação.");
  const duplicate = participants.find((person) => {
    if (normalizeName(person.name) !== normalizeName(name)) return false;
    return !originalName || normalizeName(person.name) !== normalizeName(originalName);
  });
  if (duplicate) throw new Error("Já existe uma pessoa cadastrada com esse nome.");
  return {
    originalName,
    name,
    generalStart,
    cuca,
    cucaStart: cuca ? parseDateToIso(payload.cucaStart || payload.inicioCuca) || generalStart : "",
    beverage,
    beverageStart: beverage ? parseDateToIso(payload.beverageStart || payload.inicioBebida) || generalStart : "",
    snack,
    snackStart: snack ? parseDateToIso(payload.snackStart || payload.inicioLanche) || generalStart : "",
    notes: cleanText(payload.notes || payload.observacoes)
  };
}

export function historyFormulas(row, category) {
  const spec = CATEGORY_RULES[category];
  if (!spec) throw new Error("Categoria inválida para fórmula.");
  const participantNames = "PARTICIPANTES!$A$4:$A";
  const participantFlag = `PARTICIPANTES!$${spec.flagColumn}$4:$${spec.flagColumn}`;
  const participantStart = `PARTICIPANTES!$${spec.startColumn}$4:$${spec.startColumn}`;
  const duplicate = `COUNTIFS($A$4:A${row},\">=\"&INT(A${row}),$A$4:A${row},\"<\"&INT(A${row})+1,$B$4:B${row},B${row},$D$4:D${row},\"REALIZADO\")>1`;
  const e = `=IF(OR(A${row}=\"\",B${row}=\"\",D${row}<>\"REALIZADO\"),\"NÃO\",IF(${duplicate},\"NÃO\",IF(COUNTIFS(${participantNames},B${row},${participantFlag},\"SIM\")=0,\"NÃO\",IF(INT(A${row})<INDEX(${participantStart},MATCH(B${row},${participantNames},0)),\"NÃO\",\"SIM\"))))`;
  const f = `=IF(A${row}=\"\",\"\",COUNTIFS(${participantFlag},\"SIM\",${participantStart},\"<=\"&INT(A${row})))`;
  const g = `=IF(AND(E${row}=\"SIM\",INT(A${row})<=TODAY(),F${row}>0),1/F${row},0)`;
  const h = `=IF(A${row}=\"\",\"\",D${row})`;
  const i = `=IF(OR(A${row}=\"\",B${row}=\"\"),\"\",IF(${duplicate},\"DUPLICADO MESMO DIA\",IF(COUNTIFS(${participantNames},B${row},${participantFlag},\"SIM\")=0,\"FORA DO RODÍZIO\",IF(INT(A${row})<INDEX(${participantStart},MATCH(B${row},${participantNames},0)),\"EXTRA PRÉ-INÍCIO\",\"\"))))`;
  const j = `=IF(A${row}=\"\",\"\",IF(E${row}=\"SIM\",\"OK\",IF(I${row}<>\"\",I${row},\"-\")))`;
  return [e, f, g, h, i, j];
}

function localRankingAnswer(category, dashboard, emoji) {
  const scheduled = dashboard.schedules.find((item) => item.category === category && item.dateIso >= dashboard.referenceIso);
  if (scheduled) return `${emoji} Já existe um agendamento: ${scheduled.person} · ${scheduled.date}${scheduled.item ? ` · ${scheduled.item}` : ""}.`;
  const first = dashboard.rankings?.[category]?.[0];
  if (!first) return `Não encontrei ranking para ${category.toLowerCase()}.`;
  return `${emoji} Minha indicação para ${category.toLowerCase()} é ${first.name}.\nSaldo: ${signed(first.balance)} | Prioridade: ${first.priority}${first.lastTime ? ` | Última vez: ${first.lastTime}` : ""}.`;
}

export function askLocal(question, dashboard) {
  const query = stripAccents(cleanText(question).toLowerCase());
  if (!query) return "Digite uma pergunta sobre o rodízio.";
  if (query.includes("agend") || query.includes("program") || query.includes("combinado")) {
    if (!dashboard.schedules.length) return "📅 Não há agendamentos em aberto agora.";
    return `📅 Agendamentos em aberto:\n${dashboard.schedules.slice(0, 6).map((item) => `• ${item.date} · ${item.category} · ${item.person}${item.item ? ` · ${item.item}` : ""}`).join("\n")}`;
  }
  if (query.includes("bebida") || query.includes("refri") || query.includes("energetico")) return localRankingAnswer("BEBIDA", dashboard, "🥤");
  if (query.includes("lanche") || query.includes("amendoim") || query.includes("petisco")) return localRankingAnswer("LANCHE", dashboard, "🥨");
  if (query.includes("cuca")) return localRankingAnswer("CUCA", dashboard, "🍰");
  if (query.includes("devendo") || query.includes("atrasado") || query.includes("folgado")) {
    const leaders = CATEGORIES.map((category) => ({ category, row: dashboard.rankings?.[category]?.[0] })).filter((item) => item.row).sort((a, b) => b.row.balance - a.row.balance);
    return leaders[0] ? `👀 O maior alerta agora é ${leaders[0].row.name} em ${leaders[0].category.toLowerCase()}, com saldo ${signed(leaders[0].row.balance)}.` : "Não há ranking disponível.";
  }
  const found = dashboard.participants.find((participant) => {
    const name = normalizeName(participant.name);
    return query.includes(name) || query.includes(name.split(" ")[0]);
  });
  if (found) {
    const details = CATEGORIES.map((category) => {
      const row = dashboard.rankings?.[category]?.find((item) => normalizeName(item.name) === normalizeName(found.name));
      return row ? `${category}: saldo ${signed(row.balance)}, prioridade ${row.priority}` : "";
    }).filter(Boolean);
    return `📌 ${found.name}: ${details.length ? details.join(" | ") : "sem saldo ativo nas categorias consultadas."}${found.notes ? `\nObs.: ${found.notes}` : ""}`;
  }
  return "Posso responder sobre bebida, lanche, CUCA, agendamentos, quem está devendo ou a situação de uma pessoa.";
}
