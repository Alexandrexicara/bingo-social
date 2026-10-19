require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');
const axios = require('axios');
const { pool, criarTabelas } = require('./database');
const config = require('./config');

const app = express();
const PORT = config.PORT;
const JWT_SECRET = config.JWT_SECRET;
const TAXA = config.TAXA_PADRAO;
const WOOVI = config.WOOVI;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== AUTENTICAÇÃO ==========
function autenticar(req, res, next) {
  const cabecalho = req.headers.authorization;
  if (!cabecalho) return res.status(401).json({erro: 'Não autorizado'});
  const token = cabecalho.split(' ')[1];
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({erro: 'Token inválido'});
  }
}

// ========== WOOVI — CRIAR COBRANÇA ==========
async function criarCobrancaPix(valor, chaveDestino, descricao) {
  try {
    const resposta = await axios.post(`${WOOVI.API_URL}/v2/cob`, {
      calha: { chave: chaveDestino },
      valor: valor.toFixed(2),
      descricao: descricao
    }, {
      headers: {
        'client_id': WOOVI.CLIENT_ID,
        'client_secret': WOOVI.CLIENT_SECRET,
        'Content-Type': 'application/json'
      }
    });
    return resposta.data;
  } catch (erro) {
    console.error('Erro Woovi:', erro.response?.data || erro.message);
    throw new Error('Não foi possível gerar o PIX');
  }
}

// ========== GERAR CARTELA ==========
function gerarCartela() {
  const colunas = [[], [], [], [], []];
  const mins = [1, 16, 31, 46, 61];
  const maxs = [15, 30, 45, 60, 75];
  for (let c=0; c<5; c++) {
    while (colunas[c].length < 5) {
      const n = Math.floor(Math.random() * (maxs[c] - mins[c] + 1)) + mins[c];
      if (!colunas[c].includes(n)) colunas[c].push(n);
    }
  }
  colunas[2][2] = 0;
  return colunas.flat();
}

// ========== CADASTRO — CNPJ OBRIGATÓRIO ==========
app.post('/api/auth/register', async (req, res) => {
  try {
    const {tipo, nome, email, senha, telefone, cnpj, endereco, responsavel, chave_pix} = req.body;
    
    if (tipo === 'instituicao' && !cnpj) {
      return res.status(400).json({erro: 'CNPJ é OBRIGATÓRIO para instituições!'});
    }
    
    const senhaHash = await bcrypt.hash(senha, 10);
    const status = tipo === 'jogador' ? 'aprovado' : 'pendente';
    
    const resultado = await pool.query(`
      INSERT INTO usuarios (tipo, nome, email, senha, telefone, cnpj, endereco, responsavel, chave_pix, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [tipo, nome, email, senhaHash, telefone, cnpj, endereco, responsavel, chave_pix, status]);
    
    res.status(201).json({
      mensagem: tipo==='instituicao' 
        ? 'Cadastro recebido! Aguarde aprovação do administrador.' 
        : 'Conta criada com sucesso!',
      usuario: resultado.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({erro: 'E-mail já cadastrado ou erro nos dados'});
  }
});

// ========== LOGIN ==========
app.post('/api/auth/login', async (req, res) => {
  const {email, senha} = req.body;
  const {rows} = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  if (rows.length === 0) return res.status(401).json({erro: 'Usuário não encontrado'});
  
  const usuario = rows[0];
  if (!(await bcrypt.compare(senha, usuario.senha))) {
    return res.status(401).json({erro: 'Senha incorreta'});
  }
  if (usuario.status === 'pendente') {
    return res.status(403).json({erro: 'Aguarde aprovação do administrador'});
  }
  
  const token = jwt.sign({id: usuario.id, tipo: usuario.tipo, nome: usuario.nome}, JWT_SECRET, {expiresIn: '24h'});
  res.json({token, usuario: {id: usuario.id, nome: usuario.nome, tipo: usuario.tipo}});
});

// ========== LISTAR BINGOS ==========
app.get('/api/bingos', async (req, res) => {
  const {rows} = await pool.query(`
    SELECT b.*, u.nome as instituicao_nome
    FROM bingos b JOIN usuarios u ON b.usuario_id = u.id
    WHERE b.status = 'publicado' OR b.status = 'em_andamento'
    ORDER BY b.data_sorteio DESC
  `);
  res.json(rows);
});

// ========== CRIAR BINGO ==========
app.post('/api/bingos', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'instituicao' && req.usuario.tipo !== 'admin') {
    return res.status(403).json({erro: 'Sem permissão'});
  }
  const {nome, premio, data_sorteio, preco_cartela, max_cartelas, limite_por_pessoa} = req.body;
  const {rows} = await pool.query(`
    INSERT INTO bingos (usuario_id, nome, premio, data_sorteio, preco_cartela, max_cartelas, limite_por_pessoa)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
  `, [req.usuario.id, nome, premio, data_sorteio, preco_cartela, max_cartelas, limite_por_pessoa]);
  res.status(201).json(rows[0]);
});

// ========== PUBLICAR BINGO ==========
app.patch('/api/bingos/:id/publicar', autenticar, async (req, res) => {
  const {rows} = await pool.query(`UPDATE bingos SET status = 'publicado' WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(rows[0]);
});

// ========== COMPRAR CARTELA — COM PIX AUTOMÁTICO ==========
app.post('/api/bingos/:id/cartela', autenticar, async (req, res) => {
  const bingoId = req.params.id;
  
  const bingoResult = await pool.query('SELECT * FROM bingos WHERE id = $1', [bingoId]);
  if (!bingoResult.rows.length) return res.status(404).json({erro: 'Bingo não encontrado'});
  const bingo = bingoResult.rows[0];
  
  const instResult = await pool.query('SELECT chave_pix, nome FROM usuarios WHERE id = $1', [bingo.usuario_id]);
  if (!instResult.rows.length) return res.status(404).json({erro: 'Instituição não encontrada'});
  const instituicao = instResult.rows[0];
  
  const valorTotal = parseFloat(bingo.preco_cartela);
  const valorPlataforma = +(valorTotal * TAXA / 100).toFixed(2);
  const valorInstituicao = +(valorTotal - valorPlataforma).toFixed(2);
  
  const codigo = 'B' + bingoId + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const numeros = gerarCartela();
  
  // Cria cobrança na Woovi — divisão automática
  let cobranca = null;
  try {
    cobranca = await criarCobrancaPix(
      valorTotal,
      instituicao.chave_pix,
      `Bingo: ${bingo.nome} — Cartela ${codigo}`
    );
  } catch (e) {
    return res.status(500).json({erro: 'Erro ao gerar PIX: ' + e.message});
  }
  
  // Salva cartela ainda não paga
  const cartelaResult = await pool.query(`
    INSERT INTO cartelas (bingo_id, usuario_id, codigo, numeros, paga, txid_woovi)
    VALUES ($1, $2, $3, $4, false, $5) RETURNING *
  `, [bingoId, req.usuario.id, codigo, numeros, cobranca.txid || cobranca.id]);
  
  await pool.query(`
    INSERT INTO pagamentos (cartela_id, valor_total, valor_plataforma, valor_instituicao, txid, status)
    VALUES ($1, $2, $3, $4, $5, 'pendente')
  `, [cartelaResult.rows[0].id, valorTotal, valorPlataforma, valorInstituicao, cobranca.txid || cobranca.id]);
  
  res.status(201).json({
    ...cartelaResult.rows[0],
    qr_code: cobranca.qr_code || cobranca.imagemQrcode,
    pix_copia_cola: cobranca.pixCopiaECola,
    valor_total: valorTotal,
    txid: cobranca.txid || cobranca.id,
    mensagem: 'PIX gerado! Pagamento confirmado automaticamente.'
  });
});

// ========== WEBHOOK WOOVI — CONFIRMA PAGAMENTO SOZINHO ==========
app.post('/api/webhook/woovi', async (req, res) => {
  const {txid, status} = req.body;
  
  if (!txid || status !== 'concluida') {
    return res.status(200).json({ok: true});
  }
  
  // Marca cartela como paga
  const resultado = await pool.query(`
    UPDATE cartelas SET paga = true WHERE txid_woovi = $1 RETURNING *
  `, [txid]);
  
  if (resultado.rows.length > 0) {
    await pool.query(`
      UPDATE pagamentos SET status = 'concluido' WHERE txid = $1
    `, [txid]);
    console.log('✅ Pagamento confirmado! Cartela liberada:', resultado.rows[0].codigo);
  }
  
  res.status(200).json({ok: true});
});

// ========== MINHAS CARTELAS ==========
app.get('/api/minhas-cartelas', autenticar, async (req, res) => {
  const {rows} = await pool.query(`
    SELECT c.*, b.nome as bingo_nome, b.premio, b.data_sorteio, b.preco_cartela
    FROM cartelas c JOIN bingos b ON c.bingo_id = b.id
    WHERE c.usuario_id = $1 ORDER BY b.data_sorteio DESC
  `, [req.usuario.id]);
  res.json(rows);
});

// ========== DADOS DE UM BINGO ==========
app.get('/api/bingos/:id', async (req, res) => {
  const bingo = await pool.query('SELECT * FROM bingos WHERE id = $1', [req.params.id]);
  const sorteados = await pool.query('SELECT numero FROM sorteios WHERE bingo_id = $1 ORDER BY ordem', [req.params.id]);
  res.json({bingo: bingo.rows[0], sorteados: sorteados.rows.map(r => r.numero)});
});

// ========== INICIAR SORTEIO ==========
app.post('/api/bingos/:id/iniciar', autenticar, async (req, res) => {
  await pool.query(`UPDATE bingos SET status = 'em_andamento' WHERE id = $1`, [req.params.id]);
  res.json({mensagem: 'Sorteio iniciado'});
});

// ========== SORTEAR NÚMERO ==========
app.post('/api/bingos/:id/sortear', autenticar, async (req, res) => {
  const {rows: ultimos} = await pool.query(`SELECT numero FROM sorteios WHERE bingo_id = $1`, [req.params.id]);
  const jaSorteados = ultimos.map(r => r.numero);
  
  let numero;
  do { numero = Math.floor(Math.random() * 75) + 1; } while (jaSorteados.includes(numero) && jaSorteados.length < 75);
  if (jaSorteados.length >= 75) return res.status(400).json({erro: 'Todos os números já sorteados'});
  
  await pool.query(`INSERT INTO sorteios (bingo_id, numero, ordem) VALUES ($1, $2, $3)`, [req.params.id, numero, jaSorteados.length + 1]);
  res.json({numero});
});

// ========== APROVAR INSTITUIÇÃO ==========
app.patch('/api/usuarios/:id/aprovar', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const {rows} = await pool.query(`UPDATE usuarios SET status = 'aprovado' WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(rows[0]);
});

// ========== LISTAR INSTITUIÇÕES PENDENTES ==========
app.get('/api/admin/instituicoes', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const {rows} = await pool.query(`SELECT * FROM usuarios WHERE tipo = 'instituicao' AND status = 'pendente'`);
  res.json(rows);
});

// ========== MEUS BINGOS (INSTITUIÇÃO) ==========
app.get('/api/meus-bingos', autenticar, async (req, res) => {
  const {rows} = await pool.query(`SELECT * FROM bingos WHERE usuario_id = $1 ORDER BY criado_em DESC`, [req.usuario.id]);
  res.json(rows);
});

// ========== INICIAR SERVIDOR ==========
async function iniciar() {
  await criarTabelas();
  app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
}

iniciar().catch(console.error);
