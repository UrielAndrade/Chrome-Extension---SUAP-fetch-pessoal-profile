// popup.js - Coletor de Perfil Pessoal (SUAP)

let perfis = [];
let coletando = false;
const STORAGE_KEY = 'perfisPessoaisData';

document.addEventListener('DOMContentLoaded', async () => {
  await carregarDados();
  bindEventos();
  atualizarUI();
  adicionarLog('info', 'Pronto para coletar dados do perfil pessoal.');
});

function bindEventos() {
  document.getElementById('startBtn').addEventListener('click', coletarPerfilAtual);
  document.getElementById('pauseBtn').addEventListener('click', () => {
    setStatus('warning', '⏸️ Modo pausa não é necessário na coleta de perfil único.');
  });
  document.getElementById('resumeBtn').addEventListener('click', () => {
    setStatus('warning', '▶️ Use “Coletar Perfil Atual” para uma nova coleta.');
  });
  document.getElementById('exportBtn').addEventListener('click', exportarCSV);
  document.getElementById('resetBtn').addEventListener('click', resetarTudo);
}

async function carregarDados() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  perfis = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

async function salvarDados() {
  await chrome.storage.local.set({ [STORAGE_KEY]: perfis });
}

function atualizarUI() {
  const total = perfis.length;
  document.getElementById('recordCount').textContent = total;
  document.getElementById('pendingCount').textContent = '0';
  document.getElementById('currentPage').textContent = total;
  document.getElementById('exportBtn').disabled = total === 0;

  atualizarProgresso(total > 0 ? 100 : 0, total > 0 ? 'Última coleta concluída' : 'Aguardando início...');

  if (total > 0) {
    renderPreview(perfis[perfis.length - 1]);
  }
}

async function coletarPerfilAtual() {
  if (coletando) return;

  try {
    coletando = true;
    setStatus('processing', '🔍 Lendo dados do perfil pessoal...');
    atualizarProgresso(25, 'Executando extração na página');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url) {
      throw new Error('Não foi possível obter a aba ativa.');
    }

    if (!tab.url.includes('suap.ifro.edu.br')) {
      throw new Error('Abra o perfil no domínio suap.ifro.edu.br e tente novamente.');
    }

    const modo = document.getElementById('collectMode').value;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extrairPerfilPessoal,
      args: [modo]
    });

    if (!result?.ok) {
      throw new Error(result?.error || 'Estrutura de perfil não encontrada nesta página.');
    }

    const perfil = result.data;
    const antes = perfis.length;
    perfis = deduplicarPorIdentidade(perfis, perfil);

    if (perfis.length === antes) {
      setStatus('warning', 'ℹ️ Perfil já existia na base local. Dados atualizados.');
      adicionarLog('warning', `Perfil atualizado: ${perfil.nome || perfil.matricula || 'Sem identificação'}`);
    } else {
      setStatus('success', `✅ Perfil coletado: ${perfil.nome || perfil.matricula || 'Sem identificação'}`);
      adicionarLog('success', `Novo perfil coletado: ${perfil.nome || perfil.matricula || 'Sem identificação'}`);
    }

    await salvarDados();
    atualizarProgresso(100, 'Coleta finalizada');
    atualizarUI();

  } catch (error) {
    console.error(error);
    setStatus('error', `❌ ${error.message}`);
    adicionarLog('error', error.message);
    atualizarProgresso(0, 'Falha na coleta');
  } finally {
    coletando = false;
  }
}

function deduplicarPorIdentidade(lista, novoPerfil) {
  const chave = (novoPerfil.matricula || '').trim() || (novoPerfil.cpf || '').trim() || (novoPerfil.nome || '').trim();

  if (!chave) return [...lista, novoPerfil];

  const idx = lista.findIndex(item => {
    const itemChave = (item.matricula || '').trim() || (item.cpf || '').trim() || (item.nome || '').trim();
    return itemChave && itemChave === chave;
  });

  if (idx === -1) {
    return [...lista, novoPerfil];
  }

  const copia = [...lista];
  copia[idx] = { ...copia[idx], ...novoPerfil };
  return copia;
}

function renderPreview(perfil) {
  const previewSection = document.getElementById('previewSection');
  const previewCard = document.getElementById('previewCard');

  previewSection.style.display = 'block';

  const linhas = [
    ['Nome', perfil.nome],
    ['Matrícula', perfil.matricula],
    ['Curso', perfil.curso],
    ['Período de Referência', perfil.periodoReferencia],
    ['E-mail Acadêmico', perfil.emailAcademico],
    ['CPF', perfil.cpf],
    ['Situação Sistêmica', perfil.situacaoSistemica]
  ];

  previewCard.innerHTML = linhas
    .map(([label, value]) => `
      <div class="preview-row">
        <span class="preview-label">${label}</span>
        <span class="preview-value">${value || '-'}</span>
      </div>
    `)
    .join('');
}

async function exportarCSV() {
  if (!perfis.length) return;

  const headers = [
    'nome',
    'matricula',
    'ingresso',
    'emailAcademico',
    'cpf',
    'periodoReferencia',
    'ira',
    'curso',
    'matriz',
    'qtdPeriodos',
    'situacaoSistemica',
    'dataMigracao',
    'impressaoDigital',
    'emitiuDiploma',
    'fotoUrl',
    'paginaUrl',
    'coletadoEm'
  ];

  const linhas = [headers.join(';')];
  for (const perfil of perfis) {
    const row = headers
      .map((k) => `"${String(perfil[k] || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`)
      .join(';');
    linhas.push(row);
  }

  const blob = new Blob(['\ufeff' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  await chrome.downloads.download({
    url,
    filename: `perfis_pessoais_suap_${timestamp}.csv`,
    saveAs: true
  });

  setStatus('success', '✅ Exportação concluída.');
  adicionarLog('success', 'Arquivo CSV exportado com sucesso.');
}

async function resetarTudo() {
  if (!confirm('Deseja apagar todos os perfis coletados localmente?')) return;

  perfis = [];
  await chrome.storage.local.remove([STORAGE_KEY]);
  atualizarUI();
  document.getElementById('previewSection').style.display = 'none';
  setStatus('success', '🧹 Dados removidos com sucesso.');
  adicionarLog('info', 'Base local limpa.');
}

function atualizarProgresso(percent, detalhe) {
  document.getElementById('progressFill').style.width = `${percent}%`;
  document.getElementById('progressPercent').textContent = `${Math.round(percent)}%`;
  document.getElementById('progressDetail').textContent = detalhe;
  document.getElementById('timeEstimate').textContent = percent === 100 ? 'Concluído' : '--';
}

function setStatus(type, message) {
  const statusEl = document.getElementById('status');
  const textEl = document.getElementById('statusText');

  statusEl.className = `status ${type}`;
  textEl.textContent = message;
}

function adicionarLog(type, mensagem) {
  const log = document.getElementById('logContent');
  const linha = document.createElement('p');
  linha.className = `log-entry ${type}`;
  linha.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${mensagem}`;
  log.prepend(linha);
}

function extrairPerfilPessoal(mode) {
  const bloco = document.querySelector('.accordion-body');
  const lista = bloco?.querySelector('dl.definition-list');

  if (!bloco || !lista) {
    return {
      ok: false,
      error: 'Não encontrei o bloco de perfil pessoal (.accordion-body / .definition-list).'
    };
  }

  const normalizar = (txt) => (txt || '').replace(/\s+/g, ' ').trim();

  const mapaCampos = {
    'Nome': 'nome',
    'Matrícula': 'matricula',
    'Ingresso': 'ingresso',
    'E-mail Acadêmico': 'emailAcademico',
    'CPF': 'cpf',
    'Período de Referência': 'periodoReferencia',
    'I.R.A.': 'ira',
    'Curso': 'curso',
    'Matriz': 'matriz',
    'Qtd. Períodos': 'qtdPeriodos',
    'Situação Sistêmica': 'situacaoSistemica',
    'Data da Migração': 'dataMigracao',
    'Impressão Digital': 'impressaoDigital',
    'Emitiu Diploma': 'emitiuDiploma'
  };

  const data = {
    coletadoEm: new Date().toISOString(),
    paginaUrl: window.location.href,
    fotoUrl: ''
  };

  const imagem = bloco.querySelector('.photo-circle img');
  if (imagem?.src) data.fotoUrl = imagem.src;

  const cru = {};
  const itens = lista.querySelectorAll('.list-item');
  itens.forEach((item) => {
    const dt = item.querySelector('dt');
    const dd = item.querySelector('dd');
    if (!dt || !dd) return;

    const label = normalizar(dt.textContent);
    const pTags = Array.from(dd.querySelectorAll('p')).map((p) => normalizar(p.textContent)).filter(Boolean);
    const valor = pTags.length ? pTags.join(' | ') : normalizar(dd.textContent);

    cru[label] = valor;
    if (mapaCampos[label]) {
      data[mapaCampos[label]] = valor;
    }
  });

  if (mode !== 'fast') {
    data.camposRaw = cru;
  }

  if (mode === 'super') {
    data.tituloPagina = document.title;
  }

  return {
    ok: !!(data.nome || data.matricula),
    data,
    error: data.nome || data.matricula ? '' : 'Não foi possível identificar Nome ou Matrícula no perfil.'
  };
}
