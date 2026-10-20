const API = '/api';
let usuarioLogado = null;
let token = localStorage.getItem('token_bingo');
let bingoAtual = null;
let numerosSorteados = [];
let modoMarcacao = 'auto';

async function requisicao(caminho, metodo='GET', corpo=null) {
  const opcoes = {method: metodo, headers: {}};
  if (token) opcoes.headers['Authorization'] = `Bearer ${token}`;
  if (corpo) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const res = await fetch(`${API}${caminho}`, opcoes);
  if (res.status === 401) {
    localStorage.removeItem('token_bingo'); token = null; usuarioLogado = null;
    document.getElementById('botoes-nao-logado').classList.remove('oculto');
    document.getElementById('botoes-logado').classList.add('oculto');
    document.getElementById('navegacao-logado').classList.add('oculto');
    document.getElementById('paginas-internas').classList.add('oculto');
    throw new Error('Faça login novamente');
  }
  const dados = await res.json();
  if (!res.ok) throw new Error(dados.erro || 'Erro');
  return dados;
}

function mostrarAviso(elId, msg, tipo='sucesso') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<div class="aviso ${tipo}">${msg}</div>`;
  setTimeout(() => el.innerHTML = '', 6000);
}

function voltarInicio() {
  bingoAtual = null; numerosSorteados = [];
  document.getElementById('sala-sorteio').classList.add('oculto');
  document.getElementById('pagina-inicio').style.display = 'block';
  carregarBingos();
}

function abrirLogin() {
  document.getElementById('modal-login').classList.remove('oculto');
  document.getElementById('form-login').classList.remove('oculto');
  document.getElementById('form-cadastro').classList.add('oculto');
  document.getElementById('titulo-modal').textContent = 'Entrar';
  document.getElementById('aviso-modal').innerHTML = '';
}

function abrirCadastro() {
  document.getElementById('modal-login').classList.remove('oculto');
  document.getElementById('form-cadastro').classList.remove('oculto');
  document.getElementById('form-login').classList.add('oculto');
  document.getElementById('titulo-modal').textContent = 'Cadastrar';
  document.getElementById('aviso-modal').innerHTML = '';
}

function fecharModais() { document.getElementById('modal-login').classList.add('oculto'); }
function trocarParaCadastro() { document.getElementById('form-login').classList.add('oculto'); document.getElementById('form-cadastro').classList.remove('oculto'); }
function trocarParaLogin() { document.getElementById('form-cadastro').classList.add('oculto'); document.getElementById('form-login').classList.remove('oculto'); }
function mudarTipo() { document.getElementById('campos-inst').classList.toggle('oculto', document.getElementById('tipo-conta').value !== 'instituicao'); }

async function fazerCadastro() {
  try {
    const tipo = document.getElementById('tipo-conta').value;
    const dados = {
      tipo,
      nome: document.getElementById('nome-cad').value,
      email: document.getElementById('email-cad').value,
      senha: document.getElementById('senha-cad').value,
      telefone: document.getElementById('tel-cad').value
    };
    
    if (tipo === 'instituicao') {
      dados.cnpj = document.getElementById('cnpj-cad').value;
      dados.endereco = document.getElementById('end-cad').value;
      dados.responsavel = document.getElementById('resp-cad').value;
      dados.chave_pix = document.getElementById('chave-pix-cad').value;
      dados.woovi_client_id = document.getElementById('woovi-id').value;
      dados.woovi_client_secret = document.getElementById('woovi-secret').value;
      dados.woovi_webhook_secret = document.getElementById('woovi-webhook').value || null;
    }
    
    await requisicao('/auth/register', 'POST', dados);
    mostrarAviso('aviso-modal', '✅ Cadastro enviado! ' + (tipo==='instituicao'?'Aguarde aprovação do admin.':'Faça login agora.'), 'sucesso');
    trocarParaLogin();
  } catch(e) { mostrarAviso('aviso-modal', '❌ ' + e.message, 'erro'); }
}

async function fazerLogin() {
  try {
    const dados = await requisicao('/auth/login', 'POST', {
      email: document.getElementById('email-login').value,
      senha: document.getElementById('senha-login').value
    });
    token = dados.token; usuarioLogado = dados.usuario;
    localStorage.setItem('token_bingo', token);
    fecharModais();
    inicializarLogado();
  } catch(e) { mostrarAviso('aviso-modal', '❌ ' + e.message, 'erro'); }
}

function sair() {
  localStorage.removeItem('token_bingo'); token = null; usuarioLogado = null;
  document.getElementById('botoes-nao-logado').classList.remove('oculto');
  document.getElementById('botoes-logado').classList.add('oculto');
  document.getElementById('navegacao-logado').classList.add('oculto');
  document.getElementById('paginas-internas').classList.add('oculto');
  document.getElementById('sala-sorteio').classList.add('oculto');
  carregarBingos();
}

async function carregarConfiguracoes() {
  try {
    const cfg = await requisicao('/configuracoes');
    const elTaxa = document.getElementById('config-taxa');
    const elChave = document.getElementById('config-chave-pix');
    if (elTaxa) elTaxa.value = cfg.taxa_plataforma;
    if (elChave) elChave.value = cfg.chave_pix_plataforma;
  } catch(e) {
    console.log('Apenas admin vê configurações');
  }
}

async function salvarConfiguracoes() {
  try {
    const taxa = parseFloat(document.getElementById('config-taxa').value);
    const chave = document.getElementById('config-chave-pix').value.trim();
    
    await requisicao('/configuracoes', 'PATCH', {
      taxa_plataforma: taxa,
      chave_pix_plataforma: chave
    });
    
    mostrarAviso('aviso-config', '✅ Salvo! Taxa: ' + taxa + '%', 'sucesso');
  } catch(e) {
    mostrarAviso('aviso-config', '❌ ' + e.message, 'erro');
  }
}

function inicializarLogado() {
  document.getElementById('botoes-nao-logado').classList.add('oculto');
  document.getElementById('botoes-logado').classList.remove('oculto');
  document.getElementById('nome-usuario').textContent = usuarioLogado.nome;
  document.getElementById('navegacao-logado').classList.remove('oculto');
  document.getElementById('paginas-internas').classList.remove('oculto');
  document.getElementById('link-criar').classList.toggle('oculto', usuarioLogado.tipo !== 'instituicao' && usuarioLogado.tipo !== 'admin');
  document.getElementById('link-admin').classList.toggle('oculto', usuarioLogado.tipo !== 'admin');
  
  document.querySelectorAll('[data-pagina]').forEach(link => {
    link.onclick = e => {
      e.preventDefault();
      document.querySelectorAll('[data-pagina]').forEach(l => l.classList.toggle('ativo', l.dataset.pagina === link.dataset.pagina));
      ['meus-bingos','criar','admin','configuracoes'].forEach(p => {
        const pg = document.getElementById(`pagina-${p}`);
        if (pg) pg.style.display = p === link.dataset.pagina ? 'block' : 'none';
      });
      document.getElementById('sala-sorteio').classList.add('oculto');
      if (link.dataset.pagina === 'meus-bingos') carregarMinhasCartelas();
      if (link.dataset.pagina === 'criar') carregarMeusBingos();
      if (link.dataset.pagina === 'admin') carregarInstituicoes();
      if (link.dataset.pagina === 'configuracoes') carregarConfiguracoes();
    };
  });
}

async function carregarBingos() {
  const bingos = await requisicao('/bingos');
  const container = document.getElementById('lista-bingos');
  if (!bingos.length) { container.innerHTML = '<p class="sem-bingos">Nenhum bingo disponível.</p>'; return; }
  container.innerHTML = bingos.map(b => {
    const data = new Date(b.data_sorteio).toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});
    return `<div class="banner-bingo" onclick="entrarBingo(${b.id})">
      <h3>🎉 ${b.nome}</h3>
      <p>🏛️ ${b.instituicao_nome}</p>
      <p>🎁 Prêmio: ${b.premio}</p>
      <p class="data">📅 ${data}</p>
      <p class="preco">R$ ${parseFloat(b.preco_cartela).toFixed(2)}</p>
      <span class="etiqueta ${b.status}">${b.status.replace('_',' ')}</span>
    </div>`;
  }).join('');
}

async function entrarBingo(id) {
  if (!token) { abrirLogin(); alert('Faça login para participar!'); return; }
  const dados = await requisicao(`/bingos/${id}`);
  bingoAtual = dados.bingo; numerosSorteados = dados.sorteados || [];
  document.getElementById('pagina-inicio').style.display = 'none';
  document.getElementById('sala-sorteio').classList.remove('oculto');
  montarSala();
}

function voltarLista() { voltarInicio(); }

function montarSala() {
  const data = new Date(bingoAtual.data_sorteio).toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});
  const ehInst = usuarioLogado.tipo === 'instituicao' || usuarioLogado.tipo === 'admin';
  
  let html = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:20px;margin-bottom:20px">
      <div>
        <h2>${bingoAtual.nome}</h2>
        <p>🎁 Prêmio: ${bingoAtual.premio}</p>
        <p>📅 ${data}</p>
        <p>💰 R$ ${parseFloat(bingoAtual.preco_cartela).toFixed(2)}</p>
      </div>
      <div style="text-align:center">
        <div style="font-size:4rem;font-weight:bold;color:var(--secundario)" id="bola-atual">—</div>
        <p style="color:#666">Último número sorteado</p>
      </div>
    </div>

    <div style="margin:20px 0">
      <h3>📋 Números já sorteados</h3>
      <div id="historico-bolas" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>
    </div>
  `;

  if (ehInst && bingoAtual.status === 'publicado') {
    html += `<button class="btn btn-primario" onclick="iniciarSorteio()">🚀 Iniciar Sorteio</button>`;
  }
  if (ehInst && bingoAtual.status === 'em_andamento') {
    html += `<button class="btn btn-sucesso" onclick="sortearProximo()">🎲 Sortear Próximo Número</button>`;
  }
  if (!ehInst && bingoAtual.status !== 'rascunho') {
    html += `<button class="btn btn-primario" onclick="comprarCartela()">🎟️ Comprar Cartela</button>`;
  }

  html += `<div style="margin-top:30px"><h3>Suas Cartelas</h3><div id="suas-cartelas"></div></div>`;

  document.getElementById('conteudo-sala').innerHTML = html;
  atualizarBolas();
  carregarMinhasCartelasNaSala();
}

function atualizarBolas() {
  const elUltima = document.getElementById('bola-atual');
  const elHistorico = document.getElementById('historico-bolas');
  if (elUltima) elUltima.textContent = numerosSorteados.length > 0 ? numerosSorteados[numerosSorteados.length - 1] : '—';
  if (elHistorico) {
    elHistorico.innerHTML = numerosSorteados.map(n => `<span style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;background:var(--primario);color:white;border-radius:50%;font-weight:bold">${n}</span>`).join('');
  }
}

async function iniciarSorteio() {
  if (!confirm('Iniciar o sorteio?')) return;
  await requisicao(`/bingos/${bingoAtual.id}/iniciar`, 'POST');
  bingoAtual.status = 'em_andamento';
  montarSala();
}

async function sortearProximo() {
  try {
    const res = await requisicao(`/bingos/${bingoAtual.id}/sortear`, 'POST');
    numerosSorteados.push(res.numero);
    atualizarBolas();
  } catch(e) {
    alert(e.message);
  }
}

async function comprarCartela() {
  try {
    const res = await requisicao(`/bingos/${bingoAtual.id}/cartela`, 'POST');
    alert(`✅ Cartela criada!\nCódigo: ${res.codigo}\nValor: R$ ${res.valor_total}\nSua parte: R$ ${res.valor_instituicao}\nTaxa plataforma: R$ ${res.valor_plataforma}`);
    carregarMinhasCartelasNaSala();
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}

async function carregarMinhasCartelasNaSala() {
  const el = document.getElementById('suas-cartelas');
  if (!el) return;
  try {
    const cartelas = await requisicao('/minhas-cartelas');
    const minhas = cartelas.filter(c => c.bingo_id === bingoAtual.id);
    if (!minhas.length) { el.innerHTML = '<p>Você ainda não tem cartelas.</p>'; return; }
    el.innerHTML = minhas.map(c => `
      <div style="padding:10px;border:1px solid #ddd;border-radius:8px;margin:8px 0;background:${c.paga ? '#f0fff4' : '#fff8e1'}">
        <strong>${c.codigo}</strong> — ${c.paga ? '✅ Paga' : '⏳ Aguardando pagamento'}
        <div style="margin-top:5px;font-family:monospace;letter-spacing:2px">${c.numeros.join(' | ')}</div>
      </div>
    `).join('');
  } catch {}
}

async function carregarMinhasCartelas() {
  const container = document.getElementById('minhas-cartelas');
  try {
    const cartelas = await requisicao('/minhas-cartelas');
    if (!cartelas.length) { container.innerHTML = '<p class="sem-bingos">Você ainda não tem cartelas.</p>'; return; }
    container.innerHTML = cartelas.map(c => `
      <div class="card" style="margin-bottom:10px">
        <h4>${c.bingo_nome}</h4>
        <p>🎁 ${c.premio}</p>
        <p><strong>${c.codigo}</strong> — ${c.paga ? '✅ Paga' : '⏳ Pendente'}</p>
        <div style="font-family:monospace;font-size:1.1rem;padding:10px;background:#f5f5f5;border-radius:6px">${c.numeros.join(' · ')}</div>
      </div>
    `).join('');
  } catch { container.innerHTML = '<p>Erro ao carregar.</p>'; }
}

async function criarBingo() {
  try {
    const dados = {
      nome: document.getElementById('bingo-nome').value,
      premio: document.getElementById('bingo-premio').value,
      data_sorteio: new Date(document.getElementById('bingo-data').value).toISOString(),
      preco_cartela: parseFloat(document.getElementById('bingo-preco').value),
      max_cartelas: parseInt(document.getElementById('bingo-max').value) || 500,
      limite_por_pessoa: parseInt(document.getElementById('bingo-limite').value) || 3
    };
    await requisicao('/bingos', 'POST', dados);
    mostrarAviso('aviso-criar', '✅ Bingo criado! Agora publique.', 'sucesso');
    carregarMeusBingos();
  } catch(e) { mostrarAviso('aviso-criar', '❌ ' + e.message, 'erro'); }
}

async function carregarMeusBingos() {
  const container = document.getElementById('lista-meus-bingos');
  try {
    const bingos = await requisicao('/meus-bingos');
    if (!bingos.length) { container.innerHTML = '<p>Nenhum bingo criado.</p>'; return; }
    container.innerHTML = bingos.map(b => {
      const data = new Date(b.data_sorteio).toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'});
      return `<div style="padding:12px;border:1px solid #ddd;border-radius:8px;margin:8px 0">
        <strong>${b.nome}</strong>
        <span class="etiqueta ${b.status}" style="float:right">${b.status.replace('_',' ')}</span>
        <p>🎁 ${b.premio} | 💰 R$ ${parseFloat(b.preco_cartela).toFixed(2)} | 📅 ${data}</p>
        ${b.status === 'rascunho' ? `<button class="btn btn-primario" style="padding:6px 12px;font-size:0.9rem" onclick="publicarBingo(${b.id})">📢 Publicar</button>` : ''}
      </div>`;
    }).join('');
  } catch { container.innerHTML = '<p>Erro ao carregar.</p>'; }
}

async function publicarBingo(id) {
  if (!confirm('Publicar esse bingo?')) return;
  await requisicao(`/bingos/${id}/publicar`, 'PATCH');
  carregarMeusBingos();
}

async function carregarInstituicoes() {
  const container = document.getElementById('lista-instituicoes');
  try {
    const insts = await requisicao('/admin/instituicoes');
    if (!insts.length) { container.innerHTML = '<p>Nenhuma instituição pendente.</p>'; return; }
    container.innerHTML = insts.map(i => `
      <div style="padding:12px;border:1px solid #ddd;border-radius:8px;margin:8px 0">
        <h4>${i.nome}</h4>
        <p>📧 ${i.email}</p>
        <p>📜 CNPJ: ${i.cnpj}</p>
        <p>👤 Responsável: ${i.responsavel}</p>
        <p>🏠 ${i.endereco}</p>
        <p>💳 PIX: ${i.chave_pix}</p>
        <p>🔑 Woovi: ${i.woovi_client_id ? '✅ Configurado' : '❌ Não configurado'}</p>
        <button class="btn btn-sucesso" onclick="aprovarInst(${i.id})">✅ Aprovar</button>
      </div>
    `).join('');
  } catch { container.innerHTML = '<p>Erro ao carregar.</p>'; }
}

async function aprovarInst(id) {
  if (!confirm('Aprovar essa instituição?')) return;
  await requisicao(`/usuarios/${id}/aprovar`, 'PATCH');
  carregarInstituicoes();
}

// Inicialização
carregarBingos();
if (token) {
  requisicao('/auth/login', 'POST', {email: localStorage.getItem('ultimo_email') || '', senha: ''})
    .catch(() => {});
}
// ========== CONFIGURAÇÕES DA PLATAFORMA ==========
async function carregarConfiguracoes() {
  try {
    const cfg = await requisicao('/configuracoes');
    document.getElementById('config-taxa').value = cfg.taxa_plataforma;
    document.getElementById('config-chave-pix').value = cfg.chave_pix_plataforma;
  } catch(e) {
    console.log('Apenas admin vê configurações');
  }
}

async function salvarConfiguracoes() {
  try {
    const taxa = parseFloat(document.getElementById('config-taxa').value);
    const chave = document.getElementById('config-chave-pix').value.trim();
    
    await requisicao('/configuracoes', 'PATCH', {
      taxa_plataforma: taxa,
      chave_pix_plataforma: chave
    });
    
    mostrarAviso('aviso-config', '✅ Salvo! Taxa: ' + taxa + '%', 'sucesso');
  } catch(e) {
    mostrarAviso('aviso-config', '❌ ' + e.message, 'erro');
  }
}

// Atualiza o carregamento da aba
// No inicializarLogado, quando clicar em "Configurações":
// adiciona: if (link.dataset.pagina === 'configuracoes') carregarConfiguracoes();
