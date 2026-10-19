const sqlite3 = require('sqlite3').verbose();
const { DB_FILE } = require('./config');
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) console.error('❌ Erro BD:', err.message);
  else console.log('✅ BD Conectado');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK(tipo IN ('admin','instituicao','jogador')),
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    telefone TEXT,
    cnpj TEXT,
    endereco TEXT,
    responsavel TEXT,
    alvará_arquivo TEXT,
    status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','aprovado','rejeitado')),
    data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bingos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instituicao_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    descricao TEXT,
    premio_nome TEXT NOT NULL,
    premio_foto TEXT,
    data_sorteio DATETIME NOT NULL,
    preco_cartela REAL NOT NULL,
    max_cartelas INTEGER DEFAULT 1000,
    qtd_cartelas_por_pessoa INTEGER DEFAULT 5,
    status TEXT DEFAULT 'rascunho' CHECK(status IN ('rascunho','publicado','em_andamento','finalizado')),
    taxa_aplicada REAL NOT NULL,
    FOREIGN KEY (instituicao_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cartelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bingo_id INTEGER NOT NULL,
    jogador_id INTEGER NOT NULL,
    numeros TEXT NOT NULL,
    codigo TEXT UNIQUE NOT NULL,
    comprado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bingo_id) REFERENCES bingos(id),
    FOREIGN KEY (jogador_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sorteios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bingo_id INTEGER NOT NULL,
    numero INTEGER NOT NULL,
    ordem INTEGER NOT NULL,
    sorteado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bingo_id) REFERENCES bingos(id)
  )`);

  db.get("SELECT id FROM usuarios WHERE email = 'admin@bingo'", (err, row) => {
    if (!row) {
      bcrypt.hash('admin@bingo', 10, (err, hash) => {
        db.run(`INSERT INTO usuarios (tipo, nome, email, senha, status) VALUES (?, ?, ?, ?, ?)`,
          ['admin', 'Administrador', 'admin@bingo', hash, 'aprovado']);
      });
    }
  });
});

module.exports = db;
