
class EstagiariosAutomation {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.queue = [];
    this.collected = [];
    this.currentIndex = 0;
    this.tabId = null;
    this.mode = 'complete';
    this.stats = {
      total: 0,
      success: 0,
      errors: 0,
      startTime: null
    };
  }

  async start(tabId, mode = 'complete') {
    this.tabId = tabId;
    this.mode = mode;
    this.isRunning = true;
    this.isPaused = false;
    this.stats.startTime = Date.now();

    await this.loadState();

    if (this.queue.length === 0) {
      await this.buildQueueFromPage();
    }

    this.stats.total = this.queue.length;
    await this.processQueue();
  }

  async buildQueueFromPage() {
    const results = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: extractAllLinks
    });

    this.queue = results[0].result.map((link, index) => ({
      ...link,
      id: index,
      status: 'pending',
      retries: 0
    }));

    await this.saveState();
    this.notifyPopup('queueBuilt', { count: this.queue.length });
  }

  async processQueue() {
    while (this.currentIndex < this.queue.length && this.isRunning) {
      if (this.isPaused) {
        await this.waitForResume();
        continue;
      }

      const item = this.queue[this.currentIndex];

      try {
        this.notifyPopup('processing', {
          current: this.currentIndex + 1,
          total: this.queue.length,
          name: item.nome
        });

        // Navega para a página do estagiário
        await this.navigateToProfile(item.url);

        // Aguarda carregamento
        await this.waitForPageLoad();

        // Extrai dados completos
        const data = await this.extractProfileData(item);

        if (data) {
          this.collected.push(data);
          item.status = 'completed';
          this.stats.success++;
          this.notifyPopup('collected', data);
        } else {
          throw new Error('Não foi possível extrair dados');
        }

      } catch (error) {
        console.error(`Erro em ${item.nome}:`, error);
        item.status = 'error';
        item.error = error.message;
        this.stats.errors++;

        if (item.retries < 3) {
          item.retries++;
          this.currentIndex--; // Tenta novamente
        }

        this.notifyPopup('error', { name: item.nome, error: error.message });
      }

      this.currentIndex++;
      await this.saveState();

      // Delay entre requisições (evita sobrecarga)
      await this.delay(2000 + Math.random() * 1000);
    }

    if (this.currentIndex >= this.queue.length) {
      this.notifyPopup('completed', this.stats);
      this.isRunning = false;
    }
  }

  async navigateToProfile(url) {
    await chrome.tabs.update(this.tabId, { url: url });
  }

  async waitForPageLoad() {
    return new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === this.tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          // Aguarda mais um pouco para scripts carregarem
          setTimeout(resolve, 1500);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });
  }

  async extractProfileData(baseInfo) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: this.tabId },
      func: extractDetailedData,
      args: [this.mode, baseInfo]
    });

    return results[0].result;
  }

  pause() {
    this.isPaused = true;
    this.notifyPopup('paused');
  }

  resume() {
    this.isPaused = false;
    this.notifyPopup('resumed');
    this.processQueue();
  }

  async waitForResume() {
    while (this.isPaused) {
      await this.delay(500);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async saveState() {
    await chrome.storage.local.set({
      automationState: {
        queue: this.queue,
        collected: this.collected,
        currentIndex: this.currentIndex,
        stats: this.stats,
        isRunning: this.isRunning,
        isPaused: this.isPaused
      }
    });
  }

  async loadState() {
    const result = await chrome.storage.local.get(['automationState']);
    if (result.automationState) {
      const state = result.automationState;
      this.queue = state.queue || [];
      this.collected = state.collected || [];
      this.currentIndex = state.currentIndex || 0;
      this.stats = state.stats || this.stats;
    }
  }

  async reset() {
    this.isRunning = false;
    this.isPaused = false;
    this.queue = [];
    this.collected = [];
    this.currentIndex = 0;
    this.stats = { total: 0, success: 0, errors: 0, startTime: null };
    await chrome.storage.local.remove(['automationState']);
  }

  notifyPopup(action, data = {}) {
    chrome.runtime.sendMessage({
      type: 'automationUpdate',
      action,
      data,
      stats: this.stats,
      progress: {
        current: this.currentIndex,
        total: this.queue.length,
        percent: this.queue.length ? Math.round((this.currentIndex / this.queue.length) * 100) : 0
      }
    });
  }
}

// Instância global
const automation = new EstagiariosAutomation();

// Mensagens do popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'start':
        const tab = await chrome.tabs.query({ active: true, currentWindow: true });
        await automation.start(tab[0].id, request.mode);
        sendResponse({ success: true });
        break;

      case 'pause':
        automation.pause();
        sendResponse({ success: true });
        break;

      case 'resume':
        automation.resume();
        sendResponse({ success: true });
        break;

      case 'reset':
        await automation.reset();
        sendResponse({ success: true });
        break;

      case 'getState':
        sendResponse({
          isRunning: automation.isRunning,
          isPaused: automation.isPaused,
          stats: automation.stats,
          progress: {
            current: automation.currentIndex,
            total: automation.queue.length
          }
        });
        break;

      case 'export':
        await exportToExcel(automation.collected);
        sendResponse({ success: true });
        break;
    }
  })();
  return true;
});

// Funções de extração executadas na página

function extractAllLinks() {
  const links = [];

  // Seletores para encontrar links de estagiários
  const selectors = [
    '#changelist table tbody tr',
    '.results table tbody tr',
    '#result_list tbody tr'
  ];

  let rows = [];
  for (const selector of selectors) {
    rows = document.querySelectorAll(selector);
    if (rows.length > 0) break;
  }

  rows.forEach(row => {
    const link = row.querySelector('a[href*="praticaprofissional"]');
    if (link) {
      const cells = row.querySelectorAll('td');
      links.push({
        url: link.href,
        nome: link.textContent.trim(),
        matricula: cells[0]?.textContent.trim() || '',
        curso: cells[2]?.textContent.trim() || '',
        status: cells[3]?.textContent.trim() || ''
      });
    }
  });

  return links;
}

function extractDetailedData(mode, baseInfo) {
  const data = {
    ...baseInfo,
    coletadoEm: new Date().toISOString(),
    url: window.location.href
  };

  // Modo rápido - só dados básicos
  if (mode === 'fast') return data;

  // Tenta encontrar todos os campos na página de detalhes

  // Email acadêmico
  const emailAcadMatch = document.body.innerHTML.match(/[a-z0-9._%+-]+@ifro\.edu\.br/i) ||
    document.body.innerHTML.match(/[a-z0-9._%+-]+@aluno\.ifro\.edu\.br/i);
  data.emailAcademico = emailAcadMatch ? emailAcadMatch[0] : '';

  // Email pessoal
  const emailPessoalMatch = document.body.innerHTML.match(/[a-z0-9._%+-]+@(gmail|hotmail|yahoo|outlook|live|icloud)\.com/i);
  data.emailPessoal = emailPessoalMatch ? emailPessoalMatch[0] : '';

  // CPF
  const cpfMatch = document.body.innerHTML.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  data.cpf = cpfMatch ? cpfMatch[0].replace(/\D/g, '') : '';

  // Telefone (vários formatos)
  const telMatches = document.body.innerHTML.match(/\(?\d{2}\)?[\s-]?\d{4,5}[-]?\d{4}/g);
  data.telefones = telMatches ? [...new Set(telMatches)] : [];

  // RG
  const rgMatch = document.body.innerHTML.match(/\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]/);
  data.rg = rgMatch ? rgMatch[0] : '';

  // Data de nascimento
  const nascMatch = document.body.innerHTML.match(/\d{2}\/\d{2}\/\d{4}/g);
  data.dataNascimento = nascMatch ? nascMatch[0] : '';

  // Endereço
  const enderecoEl = Array.from(document.querySelectorAll('th, td, label, span'))
    .find(el => el.textContent.includes('Endereço') || el.textContent.includes('Logradouro'));
  if (enderecoEl) {
    const nextEl = enderecoEl.nextElementSibling || enderecoEl.parentElement.nextElementSibling;
    data.endereco = nextEl ? nextEl.textContent.trim() : '';
  }

  // Dados do estágio específicos
  const stageFields = {
    'Data Início': 'dataInicio',
    'Data Término': 'dataTermino',
    'Carga Horária': 'cargaHoraria',
    'Concedente': 'concedente',
    'Supervisor': 'supervisor',
    'Orientador': 'orientador',
    'Bolsa': 'bolsa',
    'Auxílio Transporte': 'auxilioTransporte'
  };

  Object.entries(stageFields).forEach(([label, key]) => {
    const el = Array.from(document.querySelectorAll('th, td, label, strong'))
      .find(e => e.textContent.trim().includes(label));
    if (el) {
      const valueEl = el.nextElementSibling || el.parentElement.querySelector('td:last-child, span:last-child');
      data[key] = valueEl ? valueEl.textContent.trim() : '';
    }
  });

  // Modo super completo - tenta pegar mais campos
  if (mode === 'super') {
    // Tenta acessar abas adicionais
    const abas = document.querySelectorAll('.nav-tabs li a, .tab-item');
    data.abasDisponiveis = Array.from(abas).map(a => a.textContent.trim());

    // Coleta todos os textos de labels e valores
    const allData = {};
    document.querySelectorAll('.form-row, .field-row, tr').forEach(row => {
      const label = row.querySelector('th, label, .field-label');
      const value = row.querySelector('td, .field-value, input, select');
      if (label && value) {
        allData[label.textContent.trim()] = value.value || value.textContent.trim();
      }
    });
    data.todosOsCampos = allData;
  }

  return data;
}

async function exportToExcel(data) {
  if (data.length === 0) return;

  // Cria CSV completo
  const allFields = new Set();
  data.forEach(item => Object.keys(item).forEach(k => allFields.add(k)));

  const headers = Array.from(allFields);
  const csvRows = [headers.join(';')];

  data.forEach(item => {
    const row = headers.map(h => {
      const val = item[h] || '';
      // Escapa aspas e quebras de linha
      return `"${String(val).replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    });
    csvRows.push(row.join(';'));
  });

  const csv = '\ufeff' + csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await chrome.downloads.download({
    url: url,
    filename: `estagiarios_completo_${timestamp}.csv`,
    saveAs: true
  });
}

// Instalação
chrome.runtime.onInstalled.addListener(() => {
  console.log('SUAP Coletor PRO instalado');
});
