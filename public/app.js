const API = '/api';
let usuarioLogado = null;
let token = localStorage.getItem('token_bingo');
let bingoAtual = null;
let numerosSorteados = [];
let modoMarcacao = 'auto';

// ========== LIMPAR TOKEN ANTIGO SE ESTIVER INVÁLIDO ==========
async function requisicao(caminho, metodo='GET', corpo=null) {
  const opcoes = {method: metodo, headers: {}};
  if (token) opcoes.headers['Authorization'] = `Bearer ${token}`;
  if (corpo) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const res = await fetch(`${API}${caminho}`, opcoes);
  
  // Se token expirado/inválido → apaga e manda para login
  if (res.status === 401) {
    localStorage.removeItem('token_bingo');
    token = null;
    usuarioLogado = null;
    document.getElementById('botoes-nao-logado').classList.remove('oculto');
    document.getElementById('botoes-logado').classList.add('oculto');
    document.getElementById('navegacao-logado').classList.add('oculto');
    document.getElementById('paginas-internas').classList.add('oculto');
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  
  const dados = await res.json();
  if (!res.ok) throw new Error(dados.erro || 'Erro na requisição');
  return dados;
}

function mostrarAviso(elemento, mensagem, tipo='sucesso') {
  const el = document.getElementById(elemento);
  if (!el) return;
  el.innerHTML = `<div class="aviso ${tipo}">${mensagem}</div>`;
  setTimeout(() => el.innerHTML = '', 5000);
}

// ========== NAVEGAÇÃO ==========
function voltarInicio() {
  bingoAtual = null;
  numerosSorteados = [];
  document.getElementById('sala-sorteio').classList.add('oculto');
  document.getElementById('pagina-inicio').style.display = 'block';
  carregarBingos();
}

// ========== MODAL ==========
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

function fecharModais() {
  document.getElementById('modal-login').classList.add('oculto');
  document.getElementById('aviso-modal').innerHTML = '';
}

function trocarParaCadastro() {
  document.getElementById('form-login').classList.add('oculto');
  document.getElementById('form-cadastro').classList.remove('oculto');
  document.getElementById('titulo-modal').textContent = 'Cadastrar';
}

function trocarParaLogin() {
  document.getElementById('form-cadastro').classList.add('oculto');
  document.getElementById('form-login').classList.remove('oculto');
  document.getElementById('titulo-modal').textContent = 'Entrar';
}

function mudarTipo() {
  const tipo = document.getElementById('tipo-conta').value;
  document.getElementById('campos-inst').classList.toggle('oculto', tipo !== 'instituicao');
}

// ========== CADASTRO ==========
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
    }
    await requisicao('/auth/register', 'POST', dados);
    mostrarAviso('aviso-modal', '✅ Conta criada! Faça login.', 'sucesso');
    trocarParaLogin();
  } catch(e) { mostrarAviso('aviso-modal', '❌ ' + e.message, 'erro'); }
}

// ========== LOGIN ==========
async function fazerLogin() {
  try {
    const dados = await requisicao('/auth/login', 'POST', {
      email: document.getElementById('email-login').value,
      senha: document.getElementById('senha-login').value
    });
    token = dados.token;
    usuarioLogado = dados.usuario;
    localStorage.setItem('token_bingo', token);
    fecharModais();
    inicializarLogado();
  } catch(e) { mostrarAviso('aviso-modal', '❌ ' + e.message, 'erro'); }
}

function sair() {
  localStorage.removeItem('token_bingo');
  token = null;
  usuarioLogado = null;
  document.getElementById('botoes-nao-logado').classList.remove('oculto');
  document.getElementById('botoes-logado').classList.add('oculto');
  document.getElementById('navegacao-logado').classList.add('oculto');
  document.getElementById('paginas-internas').classList.add('oculto');
  document.getElementById('sala-sorteio').classList.add('oculto');
  carregarBingos();
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
    link.onclick = (e) => {
      e.preventDefault();
      document.querySelectorAll('[data-pagina]').forEach(l => l.classList.toggle('ativo', l.dataset.pagina === link.dataset.pagina));
      ['meus-bingos', 'criar', 'admin'].forEach(p => {
        document.getElementById(`pagina-${p}`).style.display = p === link.dataset.pagina ? 'block' : 'none';
      });
      document.getElementById('sala-sorteio').classList.add('oculto');
      if (link.dataset.pagina === 'meus-bingos') carregarMinhasCartelas();
      if (link.dataset.pagina === 'criar') carregarMeusBingos();
      if (link.dataset.pagina === 'admin') carregarInstituicoes();
    };
  });
}

// ========== LISTA DE BINGOS ==========
async function carregarBingos() {
  try {
    const bingos = await requisicao('/bingos');
    const container = document.getElementById('lista-bingos');
    if (!bingos.length) {
      container.innerHTML = '<div class="sem-bingos">🎯 Nenhum bingo disponível no momento.</div>';
      return;
    }
    container.innerHTML = bingos.map(b => {
      const data = new Date(b.data_sorteio).toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});
      return `
        <div class="banner-bingo" onclick="entrarBingo(${b.id})">
          <h3>🎉 ${b.nome}</h3>
          <p>🏛️ ${b.instituicao_nome || 'Plataforma'}</p>
          <p>🎁 Prêmio: ${b.premio}</p>
          <p class="data">📅 ${data}</p>
          <p class="preco">R$ ${parseFloat(b.preco_cartela).toFixed(2)}</p>
          <span class="etiqueta ${b.status}">${b.status.replace('_',' ')}</span>
        </div>`;
    }).join('');
  } catch(e) { console.error(e); }
}

// ========== SALA DO SORTEIO ==========
async function entrarBingo(id) {
  if (!token) {
    abrirLogin();
    mostrarAviso('aviso-modal', '⚠️ Faça login para participar!', 'erro');
    return;
  }
  try {
    const dados = await requisicao(`/bingos/${id}`);
    bingoAtual = dados.bingo;
    numerosSorteados = dados.sorteados || [];
    
    document.getElementById('pagina-inicio').style.display = 'none';
    document.getElementById('sala-sorteio').classList.remove('oculto');
    montarSala();
  } catch(e) { alert('Erro: ' + e.message); }
}

function voltarLista() {
  voltarInicio();
}

function montarSala() {
  const data = new Date(bingoAtual.data_sorteio).toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});
  const ehInst = usuarioLogado.tipo === 'instituicao' || usuarioLogado.tipo === 'admin';
  
  document.getElementById('conteudo-sala').innerHTML = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:20px;margin-bottom:20px">
      <div>
        <h2>${bingoAtual.nome}</h2>
        <p>🎁 Prêmio: ${bingoAtual.premio}</p>
        <p>📅 ${data}</p>
        <p>💰 R$ ${parseFloat(bingoAtual.preco_cartela).toFixed(2)} / cartela</p>
      </div>
      <div>
        <span class="etiqueta ${bingoAtual.status}">${bingoAtual.status.replace('_',' ')}</span>
        ${ehInst && bingoAtual.status==='publicado'?`<button class="btn btn-primario" style="margin-left:10px" onclick="iniciarSorteio()">▶ Iniciar</button>`:''}
        ${ehInst && bingoAtual.status==='em_andamento'?`<button class="btn btn-primario" style="margin-left:10px" onclick="sortearProximo()">🎲 Sortear</button>`:''}
      </div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:5rem;font-weight:bold;color:var(--primario);transition:transform .3s" id="numero-atual">—</div>
      <p>Número Sorteado</p>
      <p style="margin-top:10px"><strong>Histórico:</strong> <span id="historico-numeros">${numerosSorteados.join('  ') || '—'}</span></p>
    </div>
    ${usuarioLogado.tipo==='jogador'?`
      <div class="card">
        <h3>🎟️ Suas Cartelas</h3>
        <div id="minhas-cartelas-sala"></div>
        <button class="btn btn-primario" onclick="comprarCartela()">Comprar — R$ ${parseFloat(bingoAtual.preco_cartela).toFixed(2)}</button>
        <div style="margin-top:20px">
          <h4>Modo:</h4>
          <div style="display:flex;gap:10px;margin:10px 0">
            <button class="btn" id="btn-auto" style="background:var(--acerto);color:white" onclick="definirModo('auto')">🤖 Automático</button>
            <button class="btn" id="btn-manual" onclick="definirModo('manual')">👆 Manual</button>
          </div>
        </div>
      </div>`:''}
  `;
  if (numerosSorteados.length) document.getElementById('numero-atual').textContent = numerosSorteados.at(-1);
  if (usuarioLogado.tipo === 'jogador') carregarCartelasSala();
  modoMarcacao = 'auto';
}

function definirModo(modo) {
  modoMarcacao = modo;
  document.getElementById('btn-auto').style.background = modo==='auto'?'var(--acerto)':'';
  document.getElementById('btn-auto').style.color = modo==='auto'?'white':'';
  document.getElementById('btn-manual').style.background = modo==='manual'?'var(--acerto)':'';
  document.getElementById('btn-manual').style.color = modo==='manual'?'white':'';
}

async function iniciarSorteio() {
  await requisicao(`/bingos/${bingoAtual.id}/iniciar`, 'POST');
  bingoAtual.status = 'em_andamento'; montarSala();
}

async function sortearProximo() {
  const res = await requisicao(`/bingos/${bingoAtual.id}/sortear`, 'POST');
  numerosSorteados.push(res.numero); atualizarNumero(res.numero);
}

function atualizarNumero(numero) {
  const el = document.getElementById('numero-atual');
  el.style.transform = 'scale(1.3)'; el.textContent = numero;
  setTimeout(() => el.style.transform = 'scale(1)', 300);
  document.getElementById('historico-numeros').textContent = numerosSorteados.join('  ');
  if (modoMarcacao === 'auto') {
    document.querySelectorAll(`td[data-numero="${numero}"]`).forEach(td => {
      td.style.background = 'var(--acerto)'; td.style.color = 'white'; td.style.fontWeight = 'bold';
    });
  }
}

async function comprarCartela() {
  try {
    const res = await requisicao(`/bingos/${bingoAtual.id}/cartela`, 'POST');
    alert(`✅ Cartela gerada!\nCódigo: ${res.codigo}`); carregarCartelasSala();
  } catch(e) { alert('❌ ' + e.message); }
}

async function carregarCartelasSala() {
  const minhas = await requisicao('/minhas-cartelas');
  const minhasDeste = minhas.filter(c => c.bingo_id === bingoAtual.id);
  const container = document.getElementById('minhas-cartelas-sala');
  if (!minhasDeste.length) {
    container.innerHTML = '<p style="color:#888">Ainda não tem cartelas.</p>'; return;
  }
  container.innerHTML = minhasDeste.map(c => {
    const nums = c.numeros;
    return `
      <div style="border:2px solid #ddd;border-radius:8px;padding:15px;margin:10px 0;background:#fafafa">
        <div style="font-weight:bold;margin-bottom:8px">${c.codigo}</div>
        <table><thead><tr><th>B</th><th>I</th><th>N</th><th>G</th><th>O</th></tr></thead>
        <tbody>${[0,1,2,3,4].map(l=>`<tr>${[0,1,2,3,4].map(col=>{
          const n = nums[l*5+col];
          const centro = n===0;
          const sorteado = numerosSorteados.includes(n);
          return `<td data-numero="${n}" style="${centro?'background:#ddd':''};${sorteado?'background:var(--acerto);color:white':''}"
            onclick="marcarManual(this,${n})">${centro?'★':n}</td>`;
        }).join('')}</tr>`).join('')}
        </tbody></table>
      </div>`;
  }).join('');
}

function marcarManual(td, n) {
  if (modoMarcacao !== 'manual' || !numerosSorteados.includes(n)) return;
  const marcado = td.style.background === 'var(--acerto)';
  td.style.background = marcado ? '' : 'var(--acerto)';
  td.style.color = marcado ? '' : 'white';
}

// ========== MINHAS CARTELAS ==========
async function carregarMinhasCartelas() {
  const minhas = await requisicao('/minhas-cartelas');
  const container = document.getElementById('minhas-cartelas');
  if (!minhas.length) {
    container.innerHTML = '<p style="color:#888">Você ainda não tem cartelas.</p>'; return;
  }
  container.innerHTML = minhas.map(c => `<div class="card"><h4>🎟️ ${c.bingo_nome || 'Bingo'}</h4><p>Código: ${c.codigo}</p></div>`).join('');
}

// ========== CRIAR BINGO ==========
async function carregarMeusBingos() {
  const todos = await requisicao('/bingos');
  const meus = todos.filter(b => b.usuario_id === usuarioLogado.id);
  const container = document.getElementById('lista-meus-bingos');
  if (!meus.length) {
    container.innerHTML = '<p style="color:#888">Nenhum bingo criado.</p>'; return;
  }
  container.innerHTML = meus.map(b => `
    <div class="card">
      <h4>${b.nome}</h4>
      <p>🎁 ${b.premio}</p>
      <span class="etiqueta ${b.status}">${b.status.replace('_',' ')}</span>
      ${b.status==='rascunho'?`<button class="btn btn-sucesso" style="margin-left:10px" onclick="publicarBingo(${b.id})">Publicar</button>`:''}
    </div>`).join('');
}

async function criarBingo() {
  try {
    const dados = {
      nome: document.getElementById('bingo-nome').value,
      premio: document.getElementById('bingo-premio').value,
      data_sorteio: document.getElementById('bingo-data').value,
      preco_cartela: parseFloat(document.getElementById('bingo-preco').value),
      max_cartelas: parseInt(document.getElementById('bingo-max').value) || 500,
      limite_por_pessoa: parseInt(document.getElementById('bingo-limite').value) || 3
    };
    await requisicao('/bingos', 'POST', dados);
    mostrarAviso('aviso-criar', '✅ Bingo criado!', 'sucesso');
    document.getElementById('bingo-nome').value = '';
    document.getElementById('bingo-premio').value = '';
    document.getElementById('bingo-data').value = '';
    document.getElementById('bingo-preco').value = '';
    carregarMeusBingos();
  } catch(e) { mostrarAviso('aviso-criar', '❌ ' + e.message, 'erro'); }
}

async function publicarBingo(id) {
  await requisicao(`/bingos/${id}/publicar`, 'PATCH');
  carregarMeusBingos(); carregarBingos();
}

// ========== ADMIN ==========
async function carregarInstituicoes() {
  const lista = await requisicao('/admin/instituicoes');
  const container = document.getElementById('lista-instituicoes');
  if (!lista.length) {
    container.innerHTML = '<p style="color:#888">Nenhuma pendente.</p>'; return;
  }
  container.innerHTML = lista.map(i => `
    <div class="card">
      <h4>${i.nome}</h4>
      <p>📧 ${i.email}</p>
      <p>📜 ${i.cnpj || 'Sem CNPJ'}</p>
      <span class="etiqueta ${i.status}">${i.status}</span>
      <button class="btn btn-sucesso" style="margin-left:10px" onclick="aprovarInstituicao(${i.id})">Aprovar</button>
    </div>`).join('');
}

async function aprovarInstituicao(id) {
  await requisicao(`/usuarios/${id}/aprovar`, 'PATCH');
  carregarInstituicoes();
}

// ========== INICIALIZAÇÃO ==========
document.addEventListener('DOMContentLoaded', () => {
  carregarBingos();
  // Tenta validar token salvo — se estiver inválido, apaga sozinho
  if (token) {
    requisicao('/minhas-cartelas')
      .then(() => {})
      .catch(() => {
        console.log('Token inválido removido');
      });
  }
});
