const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { PORT, TAXA_PADRAO, JWT_SECRET } = require('./config');
const db = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const verificarToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({erro: 'Não autorizado'});
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({erro: 'Token inválido'});
    req.usuario = user;
    next();
  });
};

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
    });
  });
});

const gerarCartela = () => {
  const colunas = [[], [], [], [], []];
  const ranges = [[1,15], [16,30], [31,45], [46,60], [61,75]];
  ranges.forEach(([min, max], i) => {
    while (colunas[i].length < 5) {
      const n = Math.floor(Math.random() * (max - min + 1)) + min;
      if (!colunas[i].includes(n)) colunas[i].push(n);
    }
    colunas[i].sort((a,b) => a-b);
  });
  colunas[2][2] = 0;
  return colunas.flat();
};

const gerarCodigo = () => 'BINGO-' + Math.random().toString(36).substring(2,10).toUpperCase();

app.post('/api/auth/register', (req, res) => {
  const {nome, email, senha, telefone, tipo, cnpj, endereco, responsavel} = req.body;
  bcrypt.hash(senha, 10, (err, hash) => {
    db.run(`INSERT INTO usuarios 
      (tipo, nome, email, senha, telefone, cnpj, endereco, responsavel, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tipo, nome, email, hash, telefone, cnpj || null, endereco || null, responsavel || null,
        tipo === 'jogador' ? 'aprovado' : 'pendente'],
      function(err) {
        if (err) return res.status(400).json({erro: err.message});
        res.json({sucesso: true, id: this.lastID});
      });
  });
});

app.post('/api/auth/login', (req, res) => {
  const {email, senha} = req.body;
  db.get('SELECT * FROM usuarios WHERE email = ?', [email], (err, user) => {
    if (!user) return res.status(400).json({erro: 'Usuário não encontrado'});
    bcrypt.compare(senha, user.senha, (err, valido) => {
      if (!valido) return res.status(400).json({erro: 'Senha incorreta'});
      const token = jwt.sign({id: user.id, tipo: user.tipo, nome: user.nome}, JWT_SECRET, {expiresIn: '24h'});
      res.json({token, usuario: {id: user.id, nome: user.nome, tipo: user.tipo, status: user.status}});
    });
  });
});

app.get('/api/admin/instituicoes', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  db.all("SELECT * FROM usuarios WHERE tipo = 'instituicao'", [], (err, rows) => res.json(rows));
});

app.put('/api/admin/instituicoes/:id/aprovar', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'admin') return res.status(403).json({erro: 'Sem permissão'});
  db.run("UPDATE usuarios SET status = 'aprovado' WHERE id = ?", [req.params.id], (err) => res.json({sucesso: true}));
});

app.post('/api/instituicao/bingos', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'instituicao') return res.status(403).json({erro: 'Sem permissão'});
  const {nome, descricao, premio_nome, data_sorteio, preco_cartela, max_cartelas, qtd_cartelas_por_pessoa} = req.body;
  db.run(`INSERT INTO bingos 
    (instituicao_id, nome, descricao, premio_nome, data_sorteio, preco_cartela, max_cartelas, qtd_cartelas_por_pessoa, status, taxa_aplicada)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', ?)`,
    [req.usuario.id, nome, descricao, premio_nome, data_sorteio, preco_cartela, max_cartelas, qtd_cartelas_por_pessoa, TAXA_PADRAO],
    function(err) {
      if (err) return res.status(400).json({erro: err.message});
      res.json({sucesso: true, id: this.lastID});
    });
});

app.get('/api/instituicao/bingos', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'instituicao') return res.status(403).json({erro: 'Sem permissão'});
  db.all('SELECT * FROM bingos WHERE instituicao_id = ? ORDER BY data_sorteio DESC', [req.usuario.id], (err, rows) => res.json(rows));
});

app.put('/api/instituicao/bingos/:id/publicar', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'instituicao') return res.status(403).json({erro: 'Sem permissão'});
  db.run("UPDATE bingos SET status = 'publicado' WHERE id = ? AND instituicao_id = ?", 
    [req.params.id, req.usuario.id], (err) => res.json({sucesso: true}));
});

app.get('/api/bingos', (req, res) => {
  db.all("SELECT b.*, u.nome as instituicao_nome FROM bingos b JOIN usuarios u ON b.instituicao_id = u.id WHERE b.status = 'publicado' ORDER BY data_sorteio DESC", [], (err, rows) => res.json(rows));
});

app.get('/api/bingos/:id', (req, res) => {
  db.get("SELECT b.*, u.nome as instituicao_nome FROM bingos b JOIN usuarios u ON b.instituicao_id = u.id WHERE b.id = ?", [req.params.id], (err, row) => {
    if (!row) return res.status(404).json({erro: 'Bingo não encontrado'});
    db.all('SELECT numero FROM sorteios WHERE bingo_id = ? ORDER BY ordem', [req.params.id], (err, sorteios) => {
      res.json({...row, numeros_sorteados: sorteios.map(s => s.numero)});
    });
  });
});

app.post('/api/jogador/bingos/:id/comprar', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'jogador') return res.status(403).json({erro: 'Apenas jogadores'});
  const bingoId = req.params.id;
  db.get('SELECT * FROM bingos WHERE id = ?', [bingoId], (err, bingo) => {
    if (!bingo || bingo.status !== 'publicado') return res.status(400).json({erro: 'Bingo indisponível'});
    db.get('SELECT COUNT(*) as total FROM cartelas WHERE bingo_id = ?', [bingoId], (err, contagem) => {
      if (contagem.total >= bingo.max_cartelas) return res.status(400).json({erro: 'Cartelas esgotadas'});
      db.get('SELECT COUNT(*) as total FROM cartelas WHERE bingo_id = ? AND jogador_id = ?', [bingoId, req.usuario.id], (err, minhas) => {
        if (minhas.total >= bingo.qtd_cartelas_por_pessoa) return res.status(400).json({erro: 'Limite por pessoa atingido'});
        const numeros = gerarCartela();
        const codigo = gerarCodigo();
        db.run('INSERT INTO cartelas (bingo_id, jogador_id, numeros, codigo) VALUES (?, ?, ?, ?)', 
          [bingoId, req.usuario.id, JSON.stringify(numeros), codigo], function(err) {
            if (err) return res.status(400).json({erro: err.message});
            res.json({sucesso: true, cartela: {id: this.lastID, numeros, codigo}});
          });
      });
    });
  });
});

app.get('/api/jogador/minhas-cartelas', verificarToken, (req, res) => {
  db.all("SELECT c.*, b.nome as bingo_nome, b.data_sorteio, b.status as bingo_status FROM cartelas c JOIN bingos b ON c.bingo_id = b.id WHERE c.jogador_id = ? ORDER BY b.data_sorteio DESC", [req.usuario.id], (err, rows) => {
    res.json(rows.map(r => ({...r, numeros: JSON.parse(r.numeros)})));
  });
});

app.post('/api/instituicao/bingos/:id/iniciar', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'instituicao') return res.status(403).json({erro: 'Sem permissão'});
  db.run("UPDATE bingos SET status = 'em_andamento' WHERE id = ? AND instituicao_id = ?", [req.params.id, req.usuario.id], (err) => res.json({sucesso: true}));
});

app.post('/api/instituicao/bingos/:id/sortear', verificarToken, (req, res) => {
  if (req.usuario.tipo !== 'instituicao') return res.status(403).json({erro: 'Sem permissão'});
  const bingoId = req.params.id;
  db.all('SELECT numero FROM sorteios WHERE bingo_id = ?', [bingoId], (err, existentes) => {
    const usados = existentes.map(s => s.numero);
    const disponiveis = [];
    for (let i = 1; i <= 75; i++) if (!usados.includes(i)) disponiveis.push(i);
    if (disponiveis.length === 0) return res.status(400).json({erro: 'Todos os números já sorteados'});
    const numero = disponiveis[Math.floor(Math.random() * disponiveis.length)];
    db.run('INSERT INTO sorteios (bingo_id, numero, ordem) VALUES (?, ?, ?)', 
      [bingoId, numero, existentes.length + 1], function(err) {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({tipo: 'NUMERO_SORTEADO', numero, ordem: existentes.length + 1, bingoId}));
        }
      });
      res.json({sucesso: true, numero});
    });
  });
});

server.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
