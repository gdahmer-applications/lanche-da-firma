import {
  askLocal,
  buildDashboard,
  cleanText,
  isoToBr,
  nextFridayIso,
  normalizeName,
  signed,
  todayIso,
  validateContribution,
  validateParticipant
} from "./logic.js";
import { DemoStore, GoogleSheetsStore, SheetsApiError } from "./sheets-api.js";

const config = window.LANCHES_CONFIG || {};
const SCOPES = Object.freeze([
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets"
]);
const PAGE_TITLES = Object.freeze({
  base: "Base",
  inicio: "Início",
  rodizio: "Rodízio",
  registrar: "Registrar",
  pessoas: "Pessoas",
  ia: "Conselheiro"
});

const state = {
  tokenClient: null,
  accessToken: "",
  user: null,
  store: null,
  raw: null,
  data: null,
  currentRank: "BEBIDA",
  deleteTarget: null,
  previousFocus: null,
  busy: false,
  demo: false
};

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUi();
  resetParticipantForm();
  setDefaultDates();

  const wantsDemo = Boolean(config.allowDemo) && new URLSearchParams(location.search).get("demo") === "1";
  if (wantsDemo) {
    await startDemo();
    return;
  }

  if (!hasValidConfig()) {
    showOnlyGate("configGate");
    return;
  }

  showOnlyGate("authGate");
  try {
    await waitForGoogleIdentity();
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: SCOPES.join(" "),
      include_granted_scopes: true,
      prompt: "select_account",
      hd: cleanText(config.allowedDomain).toLowerCase(),
      callback: handleTokenResponse,
      error_callback: (error) => setAuthStatus(authPopupMessage(error), true)
    });
    qs("#loginButton").disabled = false;
    setAuthStatus(`Use sua conta @${config.allowedDomain}.`);
  } catch (error) {
    setAuthStatus(error.message, true);
  }
}

function hasValidConfig() {
  const clientId = cleanText(config.googleClientId);
  const spreadsheetId = cleanText(config.spreadsheetId);
  return clientId.endsWith(".apps.googleusercontent.com")
    && !clientId.startsWith("COLE_")
    && /^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)
    && !spreadsheetId.startsWith("COLE_")
    && /^[a-z0-9.-]+$/i.test(cleanText(config.allowedDomain));
}

function showOnlyGate(gateId) {
  qs("#appShell").classList.add("hidden");
  qs("#configGate").classList.toggle("hidden", gateId !== "configGate");
  qs("#authGate").classList.toggle("hidden", gateId !== "authGate");
}

function waitForGoogleIdentity(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error("Não foi possível carregar o login Google. Verifique sua conexão e tente novamente."));
      window.setTimeout(check, 100);
    };
    check();
  });
}

function bindUi() {
  qs("#loginButton").addEventListener("click", beginLogin);
  qs("#logoutButton").addEventListener("click", logout);
  qs("#refreshButton").addEventListener("click", () => refreshData());
  qs("#menuButton").addEventListener("click", () => toggleSidebar());
  qs("#sidebarScrim").addEventListener("click", () => toggleSidebar(false));

  qsa(".nav-item").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
  qs("#baseAddButton").addEventListener("click", () => showPage("registrar"));
  qsa(".tab").forEach((button) => button.addEventListener("click", () => {
    state.currentRank = button.dataset.rank;
    qsa(".tab").forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    renderRanking();
  }));

  qs("#categorySelect").addEventListener("change", () => {
    renderPersonSelect();
    if (qs("#categorySelect").value === "CUCA") qs("#dateInput").value = nextFridayIso(todayIso(config.timezone));
  });
  qs("#registerForm").addEventListener("submit", submitRegister);
  qs("#participantForm").addEventListener("submit", submitParticipant);
  qs("#newParticipantButton").addEventListener("click", resetParticipantForm);
  ["participantCuca", "participantBeverage", "participantSnack"].forEach((id) => qs(`#${id}`).addEventListener("change", syncParticipantInputs));

  ["baseSearch", "baseCategory", "baseStatus"].forEach((id) => qs(`#${id}`).addEventListener(id === "baseSearch" ? "input" : "change", renderBase));
  qs("#baseClear").addEventListener("click", () => {
    qs("#baseSearch").value = "";
    qs("#baseCategory").value = "";
    qs("#baseStatus").value = "";
    renderBase();
  });

  qs("#deleteCancel").addEventListener("click", closeDeleteModal);
  qs("#deleteConfirm").addEventListener("click", confirmDelete);
  qs("#deleteModal").addEventListener("click", (event) => { if (event.target === qs("#deleteModal")) closeDeleteModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !qs("#deleteModal").classList.contains("hidden")) closeDeleteModal(); });

  qsa(".quick button").forEach((button) => button.addEventListener("click", () => askAdvisor(button.dataset.question)));
  qs("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = qs("#question");
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    askAdvisor(question);
  });
}

function beginLogin() {
  if (!state.tokenClient || state.busy) return;
  qs("#loginButton").disabled = true;
  setAuthStatus("Abrindo o login Google…");
  state.tokenClient.requestAccessToken({ prompt: "select_account" });
}

async function handleTokenResponse(response) {
  if (response?.error || !response?.access_token) {
    qs("#loginButton").disabled = false;
    setAuthStatus(response?.error_description || "O acesso Google não foi concluído.", true);
    return;
  }

  try {
    const granted = google.accounts.oauth2.hasGrantedAllScopes(response, ...SCOPES);
    if (!granted) throw new Error("É necessário autorizar a leitura e edição da planilha para usar o site.");
    const profile = await fetchGoogleProfile(response.access_token);
    const allowedDomain = cleanText(config.allowedDomain).toLowerCase();
    const accountDomain = cleanText(profile.hd || response.hd).toLowerCase();
    const email = cleanText(profile.email).toLowerCase();
    if (!profile.email_verified || accountDomain !== allowedDomain || !email.endsWith(`@${allowedDomain}`)) {
      google.accounts.oauth2.revoke(response.access_token, () => {});
      throw new Error(`Acesso negado. Use uma conta corporativa @${allowedDomain}.`);
    }

    state.accessToken = response.access_token;
    state.user = profile;
    state.store = new GoogleSheetsStore({ accessToken: state.accessToken, spreadsheetId: config.spreadsheetId });
    await enterApplication();
  } catch (error) {
    state.accessToken = "";
    state.user = null;
    state.store = null;
    qs("#loginButton").disabled = false;
    setAuthStatus(error.message, true);
  }
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error("Não foi possível validar sua conta Google.");
  return response.json();
}

async function enterApplication() {
  qs("#authGate").classList.add("hidden");
  qs("#configGate").classList.add("hidden");
  qs("#appShell").classList.remove("hidden");
  renderUser();
  try {
    await refreshData();
  } catch (error) {
    qs("#appShell").classList.add("hidden");
    qs("#authGate").classList.remove("hidden");
    qs("#loginButton").disabled = false;
    setAuthStatus(error.message, true);
  }
}

async function startDemo() {
  state.demo = true;
  state.store = new DemoStore();
  state.user = { name: "Demonstração", email: "demo@madesa.com", picture: "./assets/avatar.svg" };
  qs("#configGate").classList.add("hidden");
  qs("#authGate").classList.add("hidden");
  qs("#appShell").classList.remove("hidden");
  qs("#demoBanner").classList.remove("hidden");
  renderUser();
  await refreshData();
}

function renderUser() {
  const picture = qs("#userPicture");
  picture.src = state.user?.picture || "./assets/avatar.svg";
  picture.alt = state.user?.name ? `Foto de ${state.user.name}` : "Foto do usuário";
  qs("#userName").textContent = state.user?.name || state.user?.given_name || "Usuário";
  qs("#userEmail").textContent = state.user?.email || "—";
}

function logout() {
  const token = state.accessToken;
  state.accessToken = "";
  state.user = null;
  state.store = null;
  state.raw = null;
  state.data = null;
  state.demo = false;
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  qs("#loginButton").disabled = false;
  setAuthStatus(`Use sua conta @${config.allowedDomain}.`);
  showOnlyGate("authGate");
}

async function refreshData(showOverlay = true) {
  if (!state.store || state.busy) return;
  state.busy = true;
  if (showOverlay) showLoading(true, "Sincronizando com a planilha…");
  try {
    await loadDataAndRender();
  } catch (error) {
    if (error instanceof SheetsApiError && error.status === 401) {
      toast(error.message, true);
      logout();
    }
    throw error;
  } finally {
    state.busy = false;
    if (showOverlay) showLoading(false);
  }
}

async function loadDataAndRender() {
  state.raw = await state.store.load();
  state.data = buildDashboard(state.raw, { timezone: config.timezone || "America/Sao_Paulo" });
  renderAll();
}

function renderAll() {
  renderBase();
  renderCards();
  renderSchedule();
  renderBadges();
  renderRecent();
  renderRanking();
  renderPersonSelect();
  renderEligible();
  renderPeople();
  qs("#mainPhrase").textContent = `“${state.data.mainMessage}”`;
  qs("#syncTime").textContent = `Atualizado ${state.data.generatedAt}`;
  qs("#navBaseCount").textContent = `${state.data.baseStats.total} registros`;
}

function showPage(pageId) {
  if (!PAGE_TITLES[pageId]) return;
  qsa(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === pageId));
  qsa(".page").forEach((page) => page.classList.toggle("active", page.id === pageId));
  qs("#pageTitle").textContent = PAGE_TITLES[pageId];
  toggleSidebar(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toggleSidebar(force) {
  const sidebar = qs("#sidebar");
  const open = typeof force === "boolean" ? force : !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", open);
  qs("#sidebarScrim").classList.toggle("hidden", !open);
  qs("#menuButton").setAttribute("aria-expanded", String(open));
}

function renderCards() {
  const host = qs("#heroCards");
  host.innerHTML = "";
  ["CUCA", "BEBIDA", "LANCHE"].forEach((category) => {
    const card = state.data.cards.find((item) => item.category === category) || {};
    const symbol = category === "CUCA" ? "🍰" : category === "BEBIDA" ? "🥤" : "🥨";
    const label = category === "CUCA" ? "MESA DA CUCA" : category === "BEBIDA" ? "BALCÃO DA BEBIDA" : "PETISCO DA VEZ";
    const joke = category === "CUCA" ? "A casa recomenda chegar antes das 9h." : category === "BEBIDA" ? "A geladeira está julgando em silêncio." : "Aceitamos amendoim, salgadinho e decisões melhores.";
    const div = document.createElement("article");
    div.className = "ticket";
    div.dataset.symbol = symbol;
    div.innerHTML = `<p class="eyebrow">${escapeHtml(label)}</p><div class="big">${escapeHtml(card.responsible || "—")}${card.date ? ` · ${escapeHtml(card.date)}` : ""}</div><div class="small">${escapeHtml(card.reason || card.observation || "Aguardando dados")}</div><div class="joke">“${escapeHtml(joke)}”</div>`;
    host.appendChild(div);
  });
}

function renderSchedule() {
  const host = qs("#schedule");
  host.innerHTML = "";
  if (!state.data.schedules.length) {
    host.innerHTML = '<div class="empty-state">Nenhum agendamento em aberto. A responsabilidade está livre.</div>';
    return;
  }
  state.data.schedules.forEach((record) => {
    const row = document.createElement("div");
    row.className = "schedule-row";
    row.innerHTML = `<div class="date">${escapeHtml(record.date)}</div><div><strong>${escapeHtml(record.person || "—")}</strong><span>${escapeHtml(categoryIcon(record.category))} ${escapeHtml(record.category)} · ${escapeHtml(record.item || "A definir")}</span></div><button class="mini-button" type="button">Marcar realizado</button>`;
    qs("button", row).addEventListener("click", () => markRealized(record));
    host.appendChild(row);
  });
}

function renderBadges() {
  qs("#badges").innerHTML = [
    `${state.data.participants.length} participantes`,
    "3 categorias",
    "Dados protegidos pelo Google",
    `Atualizado ${state.data.generatedAt}`
  ].map((label) => `<span class="badge">${escapeHtml(label)}</span>`).join("");
}

function renderRecent() {
  const host = qs("#recentActivity");
  host.innerHTML = "";
  if (!state.data.recentActivity.length) {
    host.innerHTML = '<div class="empty-state">Nenhuma movimentação encontrada.</div>';
    return;
  }
  state.data.recentActivity.slice(0, 8).forEach((record) => {
    const row = document.createElement("div");
    row.className = "activity-row";
    row.innerHTML = `<div class="muted">${escapeHtml(record.date)}</div><div class="category">${escapeHtml(record.category)}</div><div><strong>${escapeHtml(record.person || "—")}</strong><span class="muted">${escapeHtml(record.item || "—")}</span></div><div class="activity-status muted">${escapeHtml(record.status || "—")}</div>`;
    host.appendChild(row);
  });
}

function renderRanking() {
  const host = qs("#rankingList");
  const rows = state.data?.rankings?.[state.currentRank] || [];
  host.innerHTML = "";
  if (!rows.length) {
    host.innerHTML = '<div class="empty-state">Sem ranking disponível para esta categoria.</div>';
    return;
  }
  rows.forEach((record, index) => {
    const statusClass = normalizeName(record.insight).replaceAll(" ", "-");
    const row = document.createElement("div");
    row.className = "rank-row";
    row.innerHTML = `<div class="rank-number">${String(index + 1).padStart(2, "0")}</div><div class="rank-person"><strong>${escapeHtml(record.name)}</strong><span>Última contribuição: ${escapeHtml(record.lastTime || "sem registro")}${record.daysWithout ? ` · ${record.daysWithout} dias` : ""}</span></div><div class="rank-balance">${escapeHtml(signed(record.balance))}</div><div class="status-pill ${escapeHtml(statusClass)}">${escapeHtml(record.insight)}</div>`;
    host.appendChild(row);
  });
}

function renderBase() {
  if (!state.data) return;
  const query = normalizeName(qs("#baseSearch").value);
  const category = qs("#baseCategory").value;
  const status = qs("#baseStatus").value;
  const rows = state.data.baseRecords.filter((record) => {
    if (category && record.category !== category) return false;
    if (status && record.status !== status) return false;
    if (!query) return true;
    return normalizeName([record.date, record.category, record.person, record.item, record.status].join(" ")).includes(query);
  });
  qs("#baseCount").textContent = `${rows.length} de ${state.data.baseRecords.length} registros`;
  renderBaseKpis();
  const host = qs("#baseRows");
  host.innerHTML = "";
  if (!rows.length) {
    host.innerHTML = '<tr><td colspan="7"><div class="empty-state">Nenhum lançamento encontrado com estes filtros.</div></td></tr>';
    return;
  }
  rows.forEach((record) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(record.date)}</td><td>${escapeHtml(record.category)}</td><td><strong>${escapeHtml(record.person || "—")}</strong></td><td class="item-cell">${escapeHtml(record.item || "—")}</td><td><span class="status-pill ${record.status === "REALIZADO" ? "adiantado" : ""}">${escapeHtml(record.status)}</span></td><td>${escapeHtml(Number(record.credit || 0).toFixed(3).replace(".", ","))}</td><td><div class="row-actions"></div></td>`;
    const actions = qs(".row-actions", tr);
    if (record.status === "PROGRAMADO") {
      const realize = actionButton("Realizado", "mini-button", () => markRealized(record));
      actions.appendChild(realize);
    }
    actions.appendChild(actionButton("Remover", "mini-button danger", () => openDeleteModal(record)));
    host.appendChild(tr);
  });
}

function renderBaseKpis() {
  const stats = state.data.baseStats;
  qs("#baseKpis").innerHTML = [
    [stats.total, "lançamentos"],
    [stats.realized, "realizados"],
    [stats.programmed, "programados"]
  ].map(([value, label]) => `<div class="metric-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");
}

function renderPersonSelect() {
  if (!state.data) return;
  const select = qs("#personSelect");
  const previous = select.value;
  const category = qs("#categorySelect").value;
  const property = category === "CUCA" ? "cuca" : category === "BEBIDA" ? "beverage" : "snack";
  select.innerHTML = "";
  state.data.participants.filter((person) => person[property]).forEach((person) => {
    const option = document.createElement("option");
    option.value = person.name;
    option.textContent = person.name;
    select.appendChild(option);
  });
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function renderEligible() {
  if (!state.data) return;
  const category = qs("#categorySelect").value;
  const property = category === "CUCA" ? "cuca" : category === "BEBIDA" ? "beverage" : "snack";
  qs("#eligibleBadges").innerHTML = state.data.participants.filter((person) => person[property]).map((person) => `<span class="badge">${escapeHtml(person.name)}</span>`).join("");
}

function renderPeople() {
  const host = qs("#peopleList");
  host.innerHTML = "";
  const rows = state.data.participants.slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (!rows.length) {
    host.innerHTML = '<div class="empty-state">Nenhuma pessoa cadastrada.</div>';
    return;
  }
  rows.forEach((person) => {
    const card = document.createElement("article");
    card.className = "person-card";
    const tags = [["CUCA", person.cuca], ["BEBIDA", person.beverage], ["LANCHE", person.snack]]
      .map(([label, enabled]) => `<span class="person-tag ${enabled ? "" : "off"}">${label} ${enabled ? "✓" : "—"}</span>`).join("");
    card.innerHTML = `<div class="person-head"><div><strong>${escapeHtml(person.name)}</strong><div class="person-meta">Início geral: ${escapeHtml(person.generalStartText || isoToBr(person.generalStart) || "—")}</div></div><button class="mini-button" type="button">Editar</button></div><div class="person-tags">${tags}</div>${person.notes ? `<div class="person-meta">${escapeHtml(person.notes)}</div>` : ""}`;
    qs("button", card).addEventListener("click", () => editParticipant(person));
    host.appendChild(card);
  });
}

async function submitRegister(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = event.currentTarget;
  const formData = new FormData(form);
  const status = qs("#formStatus");
  clearFormStatus(status);
  try {
    const contribution = validateContribution({
      pessoa: formData.get("pessoa"),
      categoria: formData.get("categoria"),
      data: formData.get("data"),
      item: formData.get("item"),
      acao: formData.get("acao")
    }, state.raw, state.data.referenceIso);
    await runMutation("Salvando registro…", async () => {
      await state.store.saveContribution(contribution);
      await loadDataAndRender();
    });
    const message = `${contribution.status === "REALIZADO" ? "Registrado" : "Agendado"}: ${contribution.person} · ${contribution.category}.${contribution.warning ? ` ${contribution.warning}` : ""}`;
    setFormStatus(status, message, false);
    toast(message);
    qs("#itemInput").value = "";
  } catch (error) {
    setFormStatus(status, error.message, true);
    toast(error.message, true);
  }
}

async function markRealized(record) {
  if (state.busy) return;
  try {
    if (record.status !== "PROGRAMADO") throw new Error("Somente registros programados podem ser marcados como realizados.");
    if (record.dateIso > state.data.referenceIso) throw new Error("A data agendada ainda está no futuro.");
    const duplicate = state.data.baseRecords.some((item) => item.id !== record.id && item.category === record.category && normalizeName(item.person) === normalizeName(record.person) && item.dateIso === record.dateIso && item.status === "REALIZADO");
    if (duplicate) throw new Error("Já existe um registro realizado para esta pessoa, categoria e data.");
    await runMutation("Atualizando o registro…", async () => {
      await state.store.markRealized(record);
      await loadDataAndRender();
    });
    toast(`${record.person} agora consta como realizado em ${record.category.toLowerCase()}.`);
  } catch (error) {
    toast(error.message, true);
  }
}

function openDeleteModal(record) {
  state.deleteTarget = record;
  state.previousFocus = document.activeElement;
  qs("#deleteModalText").textContent = `Você vai remover ${record.person || "este registro"} · ${record.category} · ${record.date}${record.item ? ` · ${record.item}` : ""}.`;
  qs("#deleteModal").classList.remove("hidden");
  qs("#deleteCancel").focus();
}

function closeDeleteModal() {
  qs("#deleteModal").classList.add("hidden");
  state.deleteTarget = null;
  if (state.previousFocus instanceof HTMLElement) state.previousFocus.focus();
}

async function confirmDelete() {
  const record = state.deleteTarget;
  if (!record || state.busy) return;
  try {
    await runMutation("Removendo o registro…", async () => {
      await state.store.deleteRecord(record);
      await loadDataAndRender();
    });
    closeDeleteModal();
    toast(`Registro removido: ${record.person} · ${record.category} · ${record.date}.`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function submitParticipant(event) {
  event.preventDefault();
  if (state.busy) return;
  const status = qs("#participantStatus");
  clearFormStatus(status);
  try {
    const participant = validateParticipant({
      originalName: qs("#participantOriginalName").value,
      name: qs("#participantName").value,
      generalStart: qs("#participantGeneralStart").value,
      cuca: qs("#participantCuca").checked,
      cucaStart: qs("#participantCucaStart").value,
      beverage: qs("#participantBeverage").checked,
      beverageStart: qs("#participantBeverageStart").value,
      snack: qs("#participantSnack").checked,
      snackStart: qs("#participantSnackStart").value,
      notes: qs("#participantNotes").value
    }, state.raw.participants);
    const editing = Boolean(participant.originalName && state.raw.participants.some((person) => normalizeName(person.name) === normalizeName(participant.originalName)));
    await runMutation("Salvando a pessoa…", async () => {
      await state.store.saveParticipant(participant, state.raw);
      await loadDataAndRender();
    });
    const message = editing ? `Cadastro atualizado: ${participant.name}.` : `Pessoa cadastrada: ${participant.name}.`;
    resetParticipantForm();
    setFormStatus(status, message, false);
    toast(message);
  } catch (error) {
    setFormStatus(status, error.message, true);
    toast(error.message, true);
  }
}

function editParticipant(person) {
  showPage("pessoas");
  qs("#participantOriginalName").value = person.name;
  qs("#participantName").value = person.name;
  qs("#participantGeneralStart").value = person.generalStart;
  qs("#participantCuca").checked = Boolean(person.cuca);
  qs("#participantBeverage").checked = Boolean(person.beverage);
  qs("#participantSnack").checked = Boolean(person.snack);
  qs("#participantCucaStart").value = person.cucaStart || person.generalStart;
  qs("#participantBeverageStart").value = person.beverageStart || person.generalStart;
  qs("#participantSnackStart").value = person.snackStart || person.generalStart;
  qs("#participantNotes").value = person.notes || "";
  qs("#participantSaveButton").textContent = "Atualizar pessoa";
  syncParticipantInputs();
  qs("#participantName").focus();
}

function resetParticipantForm() {
  const form = qs("#participantForm");
  if (!form) return;
  form.reset();
  const today = todayIso(config.timezone || "America/Sao_Paulo");
  qs("#participantOriginalName").value = "";
  qs("#participantName").value = "";
  qs("#participantGeneralStart").value = today;
  qs("#participantCuca").checked = true;
  qs("#participantBeverage").checked = true;
  qs("#participantSnack").checked = true;
  qs("#participantCucaStart").value = today;
  qs("#participantBeverageStart").value = today;
  qs("#participantSnackStart").value = today;
  qs("#participantNotes").value = "";
  qs("#participantSaveButton").textContent = "Salvar pessoa";
  clearFormStatus(qs("#participantStatus"));
  syncParticipantInputs();
}

function syncParticipantInputs() {
  [
    ["participantCuca", "participantCucaStart"],
    ["participantBeverage", "participantBeverageStart"],
    ["participantSnack", "participantSnackStart"]
  ].forEach(([checkboxId, inputId]) => {
    const checkbox = qs(`#${checkboxId}`);
    const input = qs(`#${inputId}`);
    input.disabled = !checkbox.checked;
    if (checkbox.checked && !input.value) input.value = qs("#participantGeneralStart").value || todayIso(config.timezone);
  });
}

function setDefaultDates() {
  qs("#dateInput").value = todayIso(config.timezone || "America/Sao_Paulo");
}

function askAdvisor(question) {
  if (!state.data) return;
  addMessage("user", question);
  const answer = askLocal(question, state.data);
  window.setTimeout(() => addMessage("bot", answer, "Base + ranking · processamento local"), 120);
}

function addMessage(type, content, meta = "") {
  const message = document.createElement("div");
  message.className = `message ${type}`;
  message.textContent = content;
  if (meta) {
    const small = document.createElement("small");
    small.textContent = meta;
    message.appendChild(small);
  }
  qs("#messages").appendChild(message);
  qs("#messages").scrollTop = qs("#messages").scrollHeight;
}

async function runMutation(label, operation) {
  if (state.busy) throw new Error("Há outra atualização em andamento.");
  state.busy = true;
  showLoading(true, label);
  try {
    await operation();
  } catch (error) {
    if (error instanceof SheetsApiError && error.status === 401) logout();
    throw error;
  } finally {
    state.busy = false;
    showLoading(false);
  }
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function categoryIcon(category) {
  return category === "CUCA" ? "🍰" : category === "BEBIDA" ? "🥤" : "🥨";
}

function showLoading(visible, message = "Sincronizando…") {
  qs("#loading").classList.toggle("hidden", !visible);
  qs("#loadingText").textContent = message;
}

function toast(message, error = false) {
  const element = qs("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 3400);
}

function setAuthStatus(message, error = false) {
  qs("#authStatus").textContent = message;
  qs("#authStatus").classList.toggle("error", error);
}

function clearFormStatus(element) {
  element.textContent = "";
  element.className = "form-status";
}

function setFormStatus(element, message, error) {
  element.textContent = message;
  element.className = `form-status show ${error ? "error" : "success"}`;
}

function authPopupMessage(error) {
  if (error?.type === "popup_closed") return "A janela de login foi fechada antes da conclusão.";
  if (error?.type === "popup_failed_to_open") return "O navegador bloqueou a janela de login. Libere pop-ups para este site.";
  return "Não foi possível abrir o login Google.";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
