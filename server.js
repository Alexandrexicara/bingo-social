require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { pool, criarTabelas } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bingo_digital_2026';
const WOOVI_URL = 'https://api.woovi.com';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ========== PEGAR CONFIGURAÇÕES DO BANCO ==========
async function getConfig() {
  const {rows} = await pool.query('SELECT * FROM configuracoes ORDER BY id LIMIT 1');
  if (!rows.length) return { taxa_plataforma: 5.00, chave_pix_plataforma: '' };
  return rows[0];
}

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

// ========== CADASTRO DE INSTITUIÇÃO ==========
app.post('/api/auth/register', async (req, res) => {
  try {
    const {
      tipo, nome, email, senha, telefone,
      cnpj, endereco, responsavel, chave_pix,
      woovi_client_id, woovi_client_secret, woovi_webhook_secret
    } = req.body;
    
    if (tipo === 'instituicao') {
      if (!cnpj) return res.status(400).json({erro: 'CNPJ é OBRIGATÓRIO!'});
      if (!chave_pix) return res.status(400).json({erro: 'Chave PIX da instituição é OBRIGATÓRIA!'});
      if (!woovi_client_id || !woovi_client_secret) {
        return res.status(400).json({erro: 'Preencha o Client ID e Client Secret da Woovi! Veja as instruções no formulário.'});
      }
    }
    
    const senhaHash = await bcrypt.hash(senha, 10);
    const status = tipo === 'jogador' ? 'aprovado' : 'pendente';
    
    const resultado = await pool.query(`
      INSERT INTO usuarios (
        tipo, nome, email, senha, telefone,
        cnpj, endereco, responsavel, chave_pix,
        woovi_client_id, woovi_client_secret, woovi_webhook_secret,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      tipo, nome, email, senhaHash, telefone,
      cnpj || null, endereco || null, responsavel || null, chave_pix,
      woovi_client_id || null, woovi_client_secret || null, woovi_webhook_secret || null,
      status
    ]);
    
    res.status(201).json({
      mensagem: tipo==='instituicao' 
        ? 'Cadastro enviado! Aguarde aprovação do administrador.' 
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

// ========== PEGAR CONFIGURAÇÕES (ADMIN) ==========
app.get('/api/configuracoes', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const config = await getConfig();
  res.json(config);
});

// ========== SALVAR CONFIGURAÇÕES (ADMIN EDITA AQUI!) ==========
app.patch('/api/configuracoes', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const { taxa_plataforma, chave_pix_plataforma } = req.body;
  
  if (taxa_plataforma < 0 || taxa_plataforma > 100) {
    return res.status(400).json({erro: 'Taxa deve ser entre 0 e 100%'});
  }
  
  const {rows} = await pool.query(`
    UPDATE configuracoes 
    SET taxa_plataforma = $1, chave_pix_plataforma = $2, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = (SELECT id FROM configuracoes LIMIT 1)
    RETURNING *
  `, [taxa_plataforma, chave_pix_plataforma]);
  
  res.json({mensagem: 'Configurações salvas!', configuracoes: rows[0]});
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

app.patch('/api/bingos/:id/publicar', autenticar, async (req, res) => {
  const {rows} = await pool.query(`UPDATE bingos SET status = 'publicado' WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(rows[0]);
});

// ========== COMPRAR CARTELA — USA TAXA E CHAVE DO BANCO ==========
app.post('/api/bingos/:id/cartela', autenticar, async (req, res) => {
  const bingoId = req.params.id;
  const config = await getConfig(); // Lê do banco!
  
  const bingoRes = await pool.query('SELECT * FROM bingos WHERE id = $1', [bingoId]);
  if (!bingoRes.rows.length) return res.status(404).json({erro: 'Bingo não encontrado'});
  const bingo = bingoRes.rows[0];
  
  const instRes = await pool.query(`
    SELECT chave_pix, nome, woovi_client_id, woovi_client_secret 
    FROM usuarios WHERE id = $1
  `, [bingo.usuario_id]);
  if (!instRes.rows.length) return res.status(404).json({erro: 'Instituição não encontrada'});
  const inst = instRes.rows[0];
  
  // DIVISÃO COM VALORES QUE VOCÊ SALVOU NO ADMIN
  const valorTotal = parseFloat(bingo.preco_cartela);
  const valorPlataforma = +(valorTotal * config.taxa_plataforma / 100).toFixed(2);
  const valorInstituicao = +(valorTotal - valorPlataforma).toFixed(2);
  
  const codigo = 'B' + bingoId + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const numeros = gerarCartela();
  
  const cartelaRes = await pool.query(`
    INSERT INTO cartelas (bingo_id, usuario_id, codigo, numeros, paga)
    VALUES ($1, $2, $3, $4, false) RETURNING *
  `, [bingoId, req.usuario.id, codigo, numeros]);
  
  await pool.query(`
    INSERT INTO pagamentos (
      cartela_id, valor_total, 
      valor_plataforma, chave_pix_plataforma,
      valor_instituicao, chave_pix_instituicao,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
  `, [
    cartelaRes.rows[0].id, valorTotal,
    valorPlataforma, config.chave_pix_plataforma, // Sua chave do banco!
    valorInstituicao, inst.chave_pix
  ]);
  
  res.status(201).json({
    ...cartelaRes.rows[0],
    valor_total: valorTotal,
    valor_plataforma: valorPlataforma,
    taxa_plataforma_porcentagem: config.taxa_plataforma,
    chave_pix_plataforma: config.chave_pix_plataforma,
    valor_instituicao: valorInstituicao,
    chave_pix_instituicao: inst.chave_pix,
    mensagem: `Divisão: ${config.taxa_plataforma}% para plataforma, ${(100-config.taxa_plataforma).toFixed(2)}% para instituição`
  });
});

// ========== WEBHOOK ==========
app.post('/api/webhook/woovi', async (req, res) => {
  const {txid, status} = req.body;
  if (!txid || status !== 'concluida') return res.status(200).json({ok: true});
  
  const cartelaRes = await pool.query(`
    UPDATE cartelas SET paga = true WHERE txid_woovi = $1 RETURNING *
  `, [txid]);
  
  if (cartelaRes.rows.length > 0) {
    await pool.query(`UPDATE pagamentos SET status = 'concluido' WHERE txid = $1`, [txid]);
    console.log('✅ PAGO! Cartela:', cartelaRes.rows[0].codigo);
  }
  
  res.status(200).json({ok: true});
});

app.get('/api/minhas-cartelas', autenticar, async (req, res) => {
  const {rows} = await pool.query(`
    SELECT c.*, b.nome as bingo_nome, b.premio, b.data_sorteio, b.preco_cartela
    FROM cartelas c JOIN bingos b ON c.bingo_id = b.id
    WHERE c.usuario_id = $1 ORDER BY b.data_sorteio DESC
  `, [req.usuario.id]);
  res.json(rows);
});

app.get('/api/bingos/:id', async (req, res) => {
  const bingo = await pool.query('SELECT * FROM bingos WHERE id = $1', [req.params.id]);
  const sorteados = await pool.query('SELECT numero FROM sorteios WHERE bingo_id = $1 ORDER BY ordem', [req.params.id]);
  res.json({bingo: bingo.rows[0], sorteados: sorteados.rows.map(r => r.numero)});
});

app.post('/api/bingos/:id/iniciar', autenticar, async (req, res) => {
  await pool.query(`UPDATE bingos SET status = 'em_andamento' WHERE id = $1`, [req.params.id]);
  res.json({mensagem: 'Sorteio iniciado'});
});

app.post('/api/bingos/:id/sortear', autenticar, async (req, res) => {
  const {rows: ultimos} = await pool.query(`SELECT numero FROM sorteios WHERE bingo_id = $1`, [req.params.id]);
  const jaSorteados = ultimos.map(r => r.numero);
  
  let numero;
  do { numero = Math.floor(Math.random() * 75) + 1; } while (jaSorteados.includes(numero) && jaSorteados.length < 75);
  if (jaSorteados.length >= 75) return res.status(400).json({erro: 'Todos os números já sorteados'});
  
  await pool.query(`INSERT INTO sorteios (bingo_id, numero, ordem) VALUES ($1, $2, $3)`, [req.params.id, numero, jaSorteados.length + 1]);
  res.json({numero});
});

app.patch('/api/usuarios/:id/aprovar', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const {rows} = await pool.query(`UPDATE usuarios SET status = 'aprovado' WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(rows[0]);
});

app.get('/api/admin/instituicoes', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const {rows} = await pool.query(`SELECT * FROM usuarios WHERE tipo = 'instituicao' AND status = 'pendente'`);
  res.json(rows);
});

app.get('/api/meus-bingos', autenticar, async (req, res) => {
  const {rows} = await pool.query(`SELECT * FROM bingos WHERE usuario_id = $1 ORDER BY criado_em DESC`, [req.usuario.id]);
  res.json(rows);
});

async function iniciar() {
  await criarTabelas();
  const cfg = await getConfig();
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`💰 Taxa padrão: ${cfg.taxa_plataforma}% — edite no painel Admin!`);
  console.log(`💳 Chave PIX plataforma: ${cfg.chave_pix_plataforma || '⚠️ Configure no Admin!'}`);
  app.listen(PORT);
}

iniciar().catch(console.error);
