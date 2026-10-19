require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const WebSocket = require('ws');
const { pool, criarTabelas } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chave_temporaria';
const TAXA = parseFloat(process.env.TAXA_PLATAFORMA || 5);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const wss = new WebSocket.Server({ noServer: true });
const clientes = [];

wss.on('connection', (ws) => {
  clientes.push(ws);
  ws.on('close', () => {
    const idx = clientes.indexOf(ws);
    if (idx !== -1) clientes.splice(idx, 1);
  });
});

function notificarTodos(dados) {
  clientes.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(dados));
  });
}

// Middleware de autenticação
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

// Gerar números de cartela
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
  colunas[2][2] = 0; // centro livre
  return colunas.flat();
}

// Cadastro
app.post('/api/auth/register', async (req, res) => {
  try {
    const {tipo, nome, email, senha, telefone, cnpj, endereco, responsavel, chave_pix} = req.body;
    const senhaHash = await bcrypt.hash(senha, 10);
    const status = tipo === 'jogador' ? 'aprovado' : 'pendente';
    
    const resultado = await pool.query(`
      INSERT INTO usuarios (tipo, nome, email, senha, telefone, cnpj, endereco, responsavel, chave_pix, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [tipo, nome, email, senhaHash, telefone, cnpj, endereco, responsavel, chave_pix, status]);
    
    res.status(201).json({mensagem: 'Cadastro realizado', usuario: resultado.rows[0]});
  } catch (err) {
    res.status(400).json({erro: 'E-mail já cadastrado'});
  }
});

// Login
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

// Listar bingos publicos
app.get('/api/bingos', async (req, res) => {
  const {rows} = await pool.query(`
    SELECT b.*, u.nome as instituicao_nome FROM bingos b
    JOIN usuarios u ON b.usuario_id = u.id
    WHERE b.status = 'publicado' OR b.status = 'em_andamento'
    ORDER BY b.data_sorteio DESC
  `);
  res.json(rows);
});

// Criar bingo (instituicao)
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

// Publicar bingo
app.patch('/api/bingos/:id/publicar', autenticar, async (req, res) => {
  const {rows} = await pool.query(`UPDATE bingos SET status = 'publicado' WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(rows[0]);
});

// Comprar/gerar cartela
app.post('/api/bingos/:id/cartela', autenticar, async (req, res) => {
  const bingoId = req.params.id;
  const codigo = 'B' + bingoId + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const numeros = gerarCartela();
  
  const {rows} = await pool.query(`
    INSERT INTO cartelas (bingo_id, usuario_id, codigo, numeros, paga)
    VALUES ($1, $2, $3, $4, true) RETURNING *
  `, [bingoId, req.usuario.id, codigo, numeros]);
  
  res.json(rows[0]);
});

// Meus bingos/compras
app.get('/api/minhas-cartelas', autenticar, async (req, res) => {
  const {rows} = await pool.query(`
    SELECT c.*, b.nome as bingo_nome, b.premio, b.data_sorteio
    FROM cartelas c JOIN bingos b ON c.bingo_id = b.id
    WHERE c.usuario_id = $1 ORDER BY b.data_sorteio DESC
  `, [req.usuario.id]);
  res.json(rows);
});

// Iniciar sorteio
app.post('/api/bingos/:id/iniciar', autenticar, async (req, res) => {
  await pool.query(`UPDATE bingos SET status = 'em_andamento' WHERE id = $1`, [req.params.id]);
  notificarTodos({tipo: 'INICIO_SORTEIO', bingoId: req.params.id});
  res.json({mensagem: 'Sorteio iniciado'});
});

// Sortear numero
app.post('/api/bingos/:id/sortear', autenticar, async (req, res) => {
  const {rows: ultimos} = await pool.query(`SELECT numero FROM sorteios WHERE bingo_id = $1`, [req.params.id]);
  const jaSorteados = ultimos.map(r => r.numero);
  
  let numero;
  do { numero = Math.floor(Math.random() * 75) + 1; } while (jaSorteados.includes(numero) && jaSorteados.length < 75);
  if (jaSorteados.length >= 75) return res.status(400).json({erro: 'Todos os números já sorteados'});
  
  await pool.query(`
    INSERT INTO sorteios (bingo_id, numero, ordem) VALUES ($1, $2, $3)
  `, [req.params.id, numero, jaSorteados.length + 1]);
  
  notificarTodos({tipo: 'NOVO_NUMERO', bingoId: req.params.id, numero});
  res.json({numero});
});

// Aprovar instituicao (admin)
app.patch('/api/usuarios/:id/aprovar', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const {rows} = await pool.query(`UPDATE usuarios SET status = 'aprovado' WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json(rows[0]);
});

// Listar instituicoes pendentes (admin)
app.get('/api/admin/instituicoes', autenticar, async (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  const {rows} = await pool.query(`SELECT * FROM usuarios WHERE tipo = 'instituicao' AND status = 'pendente'`);
  res.json(rows);
});

// Dados de um bingo
app.get('/api/bingos/:id', async (req, res) => {
  const bingo = await pool.query('SELECT * FROM bingos WHERE id = $1', [req.params.id]);
  const sorteados = await pool.query('SELECT numero FROM sorteios WHERE bingo_id = $1 ORDER BY ordem', [req.params.id]);
  res.json({bingo: bingo.rows[0], sorteados: sorteados.rows.map(r => r.numero)});
});

async function iniciar() {
  await criarTabelas();
  const servidor = app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
  servidor.on('upgrade', (req, soc, cab) => {
    wss.handleUpgrade(req, soc, cab, (ws) => wss.emit('connection', ws, req));
  });
}

iniciar().catch(console.error);
