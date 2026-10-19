const API = '/api';
let usuarioLogado = null;
let token = localStorage.getItem('token_bingo');
let numerosSorteados = [];
let bingoAtual = null;
let modoMarcacao = 'auto';

async function requisicao(caminho, metodo='GET', corpo=null) {
  const opcoes = {method: metodo, headers: {}};
  if (token) opcoes.headers['Authorization'] = `Bearer ${token}`;
  if (corpo) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const res = await fetch(`${API}${caminho}`, opcoes);
  const dados = await res.json();
  if (!res.ok) throw new Error(dados.erro || 'Erro na requisição');
  return dados;
}

function mostrarAviso(elemento, mensagem, tipo='sucesso') {
  const el = document.getElementById(elemento);
  el.innerHTML = `<div class="aviso ${tipo}">${mensagem}</div>`;
  setTimeout(() => el.innerHTML = '', 5000);
}

function mostrarCadastro() {
  document.getElementById('form-login').classList.add('oculto');
  document.getElementById('form-cadastro').classList.remove('oculto');
}

function mostrarLogin() {
  document.getElementById('form-cadastro').classList.add('oculto');
  document.getElementById('form-login').classList.remove('oculto');
}

function mudarTipoConta() {
  const tipo = document.getElementById('tipo-conta').value;
  document.getElementById('campos-instituicao').classList.toggle('oculto', tipo !== 'instituicao');
}

async function fazerCadastro() {
  try {
    const tipo = document.getElementById('tipo-conta').value;
    const dados = {
      tipo,
      nome: document.getElementById('nome-cad').value,
      email: document.getElementById('email-cad').value,
      senha: document.getElementById('senha-cad').value,
      telefone: document.getElementById('telefone-cad').value
    };
    if (tipo === 'instituicao') {
      dados.cnpj = document.getElementById('cnpj-cad').value;
      dados.endereco = document.getElementById('endereco-cad').value;
      dados.responsavel = document.getElementById('responsavel-cad').value;
    }
    await requisicao('/auth/register', 'POST', dados);
    mostrarAviso('aviso-form', '✅ Conta criada! Faça login.', 'sucesso');
    mostrarLogin();
  } catch(e) { mostrarAviso('aviso-form', '❌ ' + e.message, 'erro'); }
}

async function fazerLogin() {
  try {
    const dados = await requisicao('/auth/login', 'POST', {
      email: document.getElementById('email-login').value,
      senha: document.getElementById('senha-login').value
    });
    token = dados.token;
    usuarioLogado = dados.usuario;
    localStorage.setItem('token_bingo', token);
    inicializarApp();
  } catch(e) { mostrarAviso('aviso-form', '❌ ' + e.message, 'erro'); }
}

function sair() {
  localStorage.removeItem('token_bingo');
  token = usuarioLogado = null;
  document.getElementById('area-login').classList.remove('oculto');
  document.getElementById('area-logada').classList.add('oculto');
}

function inicializarApp() {
  document.getElementById('area-login').classList.add('oculto');
  document.getElementById('area-logada').classList.remove('oculto');
  document.getElementById('link-criar-bingo').classList.toggle('oculto', usuarioLogado.tipo !== 'instituicao');
  document.getElementById('link-admin').classList.toggle('oculto', usuarioLogado.tipo !== 'admin');
  document.getElementById('link-meus-bingos').classList.toggle('oculto', usuarioLogado.tipo !== 'jogador');
  
  document.querySelectorAll('[data-pagina]').forEach(link => {
    link.onclick = (e) => { e.preventDefault(); navegarPagina(link.dataset.pagina); };
  });
  navegarPagina('inicio');
}

function navegarPagina(nome) {
  document.querySelectorAll('[data-pagina]').forEach(l => l.classList.toggle('ativo', l.dataset.pagina === nome));
  document.querySelectorAll('.pagina').forEach(p => p.classList.remove('ativa'));
  document.getElementById(`pagina-${nome}`).classList.add('ativa');
  if (nome === 'inicio') carregarBingosPublicos();
  if (nome === 'meus-bingos') carregarMinhasCartelas();
  if (nome === 'criar-bingo') carregarMeusBingos();
  if (nome === 'admin') carregarInstituicoes();
}

async function carregarBingosPublicos() {
  try {
    const bingos = await requisicao('/bingos');
    const container = document.getElementById('lista-bingos');
    if (!bingos.length) {
      container.innerHTML = '<div class="sem-bingos">🎯 Nenhum bingo disponível.</div>';
      return;
    }
    container.innerHTML = bingos.map(b => {
      const data = new Date(b.data_sorteio).toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});
      return `<div class="banner-bingo" onclick="entrarBingo(${b.id})">
        <h3>🎉 ${b.nome}</h3><p>🏛️ ${b.instituicao_nome}</p><p>🎁 ${b.premio_nome}</p>
        <p class="data">📅 ${data}</p><p class="preco">R$ ${b.preco_cartela.toFixed(2)}</p>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
}

async function entrarBingo(id) {
  bingoAtual = await requisicao(`/bingos/${id}`);
  numerosSorteados = bingoAtual.numeros_sorteados || [];
  montarSalaBingo();
  navegarPagina('sala');
}

function montarSalaBingo() {
  const data = new Date(bingoAtual.data_sorteio).toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});
  const ehInst = usuarioLogado?.tipo === 'instituicao';
  
  document.getElementById('sala-conteudo').innerHTML = `
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:20px;margin-bottom:20px">
      <div><h2>${bingoAtual.nome}</h2><p>🏛️ ${bingoAtual.instituicao_nome}</p><p>🎁 ${bingoAtual.premio_nome}</p><p>📅 ${data}</p></div>
      <div>
        <span class="etiqueta ${bingoAtual.status}">${bingoAtual.status.replace('_',' ')}</span>
        ${ehInst && bingoAtual.status==='publicado'?`<button class="btn btn-sucesso" style="margin-left:10px" onclick="iniciarSorteio()">▶ Iniciar</button>`:''}
        ${ehInst && bingoAtual.status==='em_andamento'?`<button class="btn btn-primario" style="margin-left:10px" onclick="sortearProximo()">🎲 Sortear</button>`:''}
      </div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:5rem;font-weight:bold;color:var(--primario);transition:transform .3s" id="numero-atual">—</div>
      <p>Número atual</p>
      <p style="margin-top:10px"><strong>Histórico:</strong> <span id="historico-numeros">—</span></p>
    </div>
    ${usuarioLogado?.tipo==='jogador'?`
      <div class="card">
        <h3>🎟️ Suas Cartelas</h3>
        <div id="minhas-cartelas-sala"></div>
        <button class="btn btn-primario" onclick="comprarCartela()">Comprar (R$ ${bingoAtual.preco_cartela.toFixed(2)})</button>
        <div style="margin-top:20px">
          <h4>Modo:</h4>
          <div style="display:flex;gap:10px;margin:10px 0">
            <button class="btn" id="btn-auto" style="background:var(--acerto);color:white" onclick="definirModo('auto')">🤖 Automático</button>
            <button class="btn" id="btn-manual" onclick="definirModo('manual')">👆 Manual</button>
          </div>
        </div>
      </div>`:''}
    <button class="btn" onclick="navegarPagina('inicio')" style="margin-top:20px">← Voltar</button>
  `;
  if (numerosSorteados.length) {
    document.getElementById('numero-atual').textContent = numerosSorteados.at(-1);
    document.getElementById('historico-numeros').textContent = numerosSorteados.join('  ');
  }
  if (usuarioLogado?.tipo==='jogador') carregarCartelasSala();
  modoMarcacao = 'auto';
}

function atualizarSorteio(numero) {
  const el = document.getElementById('numero-atual');
  el.style.transform = 'scale(1.3)';
  el.textContent = numero;
  setTimeout(() => el.style.transform = 'scale(1)', 300);
  document.getElementById('historico-numeros').textContent = numerosSorteados.join('  ');
  if (modoMarcacao === 'auto') {
    document.querySelectorAll(`td[data-numero="${numero}"]`).forEach(td => {
      td.style.background = 'var(--acerto)'; td.style.color = 'white'; td.style.fontWeight = 'bold';
    });
  }
}

function definirModo(modo) {
  modoMarcacao = modo;
  document.getElementById('btn-auto').style.background = modo==='auto'?'var(--acerto)':'';
  document.getElementById('btn-auto').style.color = modo==='auto'?'white':'';
  document.getElementById('btn-manual').style.background = modo==='manual'?'var(--acerto)':'';
  document.getElementById('btn-manual').style.color = modo==='manual'?'white':'';
}

async function iniciarSorteio() {
  await requisicao(`/instituicao/bingos/${bingoAtual.id}/iniciar`, 'POST');
  bingoAtual.status = 'em_andamento'; montarSalaBingo();
}

async function sortearProximo() {
  const res = await requisicao(`/instituicao/bingos/${bingoAtual.id}/sortear`, 'POST');
  numerosSorteados.push(res.numero); atualizarSorteio(res.numero);
}

async function comprarCartela() {
  const res = await requisicao(`/jogador/bingos/${bingoAtual.id}/comprar`, 'POST');
  alert(`✅ Comprada! Código: ${res.cartela.codigo}`); carregarCartelasSala();
}

async function carregarCartelasSala() {
  const minhas = await requisicao('/jogador/minhas-cartelas');
  const minhasDeste = minhas.filter(c => c.bingo_id === bingoAtual.id);
  const container = document.getElementById('minhas-cartelas-sala');
  if (!minhasDeste.length) { container.innerHTML = '<p style="color:#888">Ainda não tem cartelas.</p>'; return; }
  container.innerHTML = minhasDeste.map(c => {
    const nums = c.numeros;
    return `<div style="border:2px solid #ddd;border-radius:8px;padding:15px;margin:10px 0;background:#fafafa">
      <div style="font-weight:bold;margin-bottom:8px">${c.codigo}</div>
      <table><thead><tr><th>B</th><th>I</th><th>N</th><th>G</th><th>O</th></tr></thead>
      <tbody>${[0,1,2,3,4].map(l=>`<tr>${[0,1,2,3,4].map(col=>{
        const n = nums[l*5+col];
        const centro = n===0;
        const sorteado = numerosSorteados.includes(n);
        return `<td data-numero="${n}" style="${centro?'background:#ddd':''};${sorteado?'background:var(--acerto);color:white':''}"
          onclick="marcarManual(this,${n})">${centro?'★':n}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>
    </div>`;
  }).join('');
}

function marcarManual(td, n) {
  if (modoMarcacao !== 'manual' || !numerosSorteados.includes(n)) return;
  const marcado = td.style.background === 'var(--acerto)';
  td.style.background = marcado ? '' : 'var(--acerto)';
  td.style.color = marcado ? '' : 'white';
}

async function carregarMinhasCartelas() {
  const minhas = await requisicao('/jogador/minhas-cartelas');
  const container = document.getElementById('minhas-cartelas');
  if (!minhas.length) { container.innerHTML = '<p style="color:#888">Você ainda não tem cartelas.</p>'; return; }
  container.innerHTML = minhas.map(c => `<div class="card"><h4>🎟️ ${c.bingo_nome}</h4><p>Código: ${c.codigo}</p><span class="etiqueta ${c.bingo_status}">${c.bingo_status.replace('_',' ')}</span></div>`).join('');
}

async function criarBingo() {
  const dados = {
    nome: document.getElementById('bingo-nome').value,
    descricao: document.getElementById('bingo-descricao').value,
    premio_nome: document.getElementById('bingo-premio').value,
    data_sorteio: document.getElementById('bingo-data').value,
    preco_cartela: parseFloat(document.getElementById('bingo-preco').value),
    max_cartelas: parseInt(document.getElementById('bingo-max').value),
    qtd_cartelas_por_pessoa: parseInt(document.getElementById('bingo-limite-pessoa').value)
  };
  await requisicao('/instituicao/bingos', 'POST', dados);
  mostrarAviso('aviso-criar', '✅ Criado!', 'sucesso');
  document.getElementById('bingo-nome').value = document.getElementById('bingo-descricao').value = document.getElementById('bingo-premio').value = document.getElementById('bingo-data').value = document.getElementById('bingo-preco').value = '';
  carregarMeusBingos();
}

async function carregarMeusBingos() {
  const bingos = await requisicao('/instituicao/bingos');
  const container = document.getElementById('lista-meus-bingos');
  if (!bingos.length) { container.innerHTML = '<p style="color:#888">Nenhum bingo criado.</p>'; return; }
  container.innerHTML = bingos.map(b => {
    const data = new Date(b.data_sorteio).toLocaleString('pt-BR', {dateStyle:'long', timeStyle:'short'});
    return `<div class="card"><h4>${b.nome}</h4><p>🎁 ${b.premio_nome}</p><p>📅 ${data}</p><span class="etiqueta ${b.status}">${b.status.replace('_',' ')}</span>
      ${b.status==='rascunho'?`<button class="btn btn-sucesso" style="margin-left:10px" onclick="publicar(${b.id})">Publicar</button>`:''}
    </div>`;
  }).join('');
}

async function publicar(id) {
  await requisicao(`/instituicao/bingos/${id}/publicar`, 'PUT');
  carregarMeusBingos(); carregarBingosPublicos();
}

async function carregarInstituicoes() {
  const lista = await requisicao('/admin/instituicoes');
  const container = document.getElementById('lista-instituicoes');
  container.innerHTML = lista.map(i => `<div class="card"><h4>${i.nome}</h4><p>📧 ${i.email}</p><p>📜 ${i.cnpj || 'Sem CNPJ'}</p><span class="etiqueta ${i.status}">${i.status}</span>
    ${i.status==='pendente'?`<button class="btn btn-sucesso" style="margin-left:10px" onclick="aprovar(${i.id})">Aprovar</button>`:''}
  </div>`).join('');
}

async function aprovar(id) {
  await requisicao(`/admin/instituicoes/${id}/aprovar`, 'PUT');
  carregarInstituicoes();
}
