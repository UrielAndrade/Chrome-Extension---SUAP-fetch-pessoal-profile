// content.js - suporte para extração do perfil pessoal no SUAP

const observer = new MutationObserver(() => {
  chrome.runtime.sendMessage({
    action: 'pageUpdated',
    url: window.location.href,
    hasProfile: !!document.querySelector('.accordion-body dl.definition-list')
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageInfo') {
    sendResponse({
      url: window.location.href,
      title: document.title,
      hasProfile: !!document.querySelector('.accordion-body dl.definition-list')
    });
  }

  if (request.action === 'scrapeData') {
    sendResponse(extractPersonalProfile());
  }

  return true;
});

function extractPersonalProfile() {
  const bloco = document.querySelector('.accordion-body');
  const lista = bloco?.querySelector('dl.definition-list');

  if (!bloco || !lista) {
    return { ok: false, error: 'Bloco de perfil pessoal não encontrado.' };
  }

  const normalizar = (txt) => (txt || '').replace(/\s+/g, ' ').trim();
  const perfil = {
    coletadoEm: new Date().toISOString(),
    paginaUrl: window.location.href
  };

  const mapa = {
    'Nome': 'nome',
    'Matrícula': 'matricula',
    'Ingresso': 'ingresso',
    'E-mail Acadêmico': 'emailAcademico',
    'E-mail Google Sala de Aula': 'emailGoogleSalaAula',
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

  lista.querySelectorAll('.list-item').forEach((item) => {
    const dt = item.querySelector('dt');
    const dd = item.querySelector('dd');
    if (!dt || !dd) return;

    const chave = normalizar(dt.textContent);
    const valor = normalizar(dd.textContent);
    if (mapa[chave]) perfil[mapa[chave]] = valor;
  });

  const foto = bloco.querySelector('.photo-circle img');
  perfil.fotoUrl = foto?.src || '';

  return {
    ok: !!(perfil.nome || perfil.matricula),
    data: perfil
  };
}
