const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function criarTabelas() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- TABELA DE CONFIGURAÇÕES DA PLATAFORMA (VOCÊ EDITA NO ADMIN)
      CREATE TABLE IF NOT EXISTS configuracoes (
        id SERIAL PRIMARY KEY,
        taxa_plataforma DECIMAL(5,2) NOT NULL DEFAULT 5.00,
        chave_pix_plataforma TEXT NOT NULL DEFAULT '',
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- TABELA DE USUÁRIOS
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(20) NOT NULL,
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        senha VARCHAR(255) NOT NULL,
        telefone VARCHAR(20),
        cnpj VARCHAR(30),
        endereco TEXT,
        responsavel VARCHAR(255),
        chave_pix TEXT NOT NULL,
        woovi_client_id TEXT,
        woovi_client_secret TEXT,
        woovi_webhook_secret TEXT,
        status VARCHAR(20) DEFAULT 'pendente',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bingos (
        id SERIAL PRIMARY KEY,
        usuario_id INT REFERENCES usuarios(id),
        nome VARCHAR(255) NOT NULL,
        premio VARCHAR(255) NOT NULL,
        data_sorteio TIMESTAMP NOT NULL,
        preco_cartela DECIMAL(10,2) NOT NULL,
        max_cartelas INT DEFAULT 500,
        limite_por_pessoa INT DEFAULT 3,
        status VARCHAR(20) DEFAULT 'rascunho',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cartelas (
        id SERIAL PRIMARY KEY,
        bingo_id INT REFERENCES bingos(id),
        usuario_id INT REFERENCES usuarios(id),
        codigo VARCHAR(50) UNIQUE NOT NULL,
        numeros INT[] NOT NULL,
        paga BOOLEAN DEFAULT false,
        txid_woovi VARCHAR(100),
        criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pagamentos (
        id SERIAL PRIMARY KEY,
        cartela_id INT REFERENCES cartelas(id),
        valor_total DECIMAL(10,2) NOT NULL,
        valor_plataforma DECIMAL(10,2) NOT NULL,
        chave_pix_plataforma TEXT NOT NULL,
        valor_instituicao DECIMAL(10,2) NOT NULL,
        chave_pix_instituicao TEXT NOT NULL,
        txid VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pendente',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sorteios (
        id SERIAL PRIMARY KEY,
        bingo_id INT REFERENCES bingos(id),
        numero INT NOT NULL,
        ordem INT NOT NULL,
        sorteado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- INSERE CONFIGURAÇÕES PADRÃO SE NÃO EXISTIR
      INSERT INTO configuracoes (taxa_plataforma, chave_pix_plataforma)
      SELECT 5.00, ''
      WHERE NOT EXISTS (SELECT 1 FROM configuracoes);
    `);

    const bcrypt = require('bcryptjs');
    const admin = await client.query("SELECT id FROM usuarios WHERE email = 'admin@bingo'");
    if (admin.rows.length === 0) {
      const senhaHash = await bcrypt.hash('admin@bingo', 10);
      await client.query(`
        INSERT INTO usuarios (tipo, nome, email, senha, status, chave_pix, cnpj, endereco, responsavel)
        VALUES ('admin', 'Administrador', 'admin@bingo', $1, 'aprovado', 'sem-chave', '00000000000000', 'Sistema', 'Suporte')
      `, [senhaHash]);
      console.log('✅ Admin criado: admin@bingo / senha: admin@bingo');
    }

    console.log('✅ Tabelas prontas! Taxa e chave PIX editáveis no painel Admin!');
  } catch (err) {
    console.error('❌ Erro nas tabelas:', err);
  } finally {
    client.release();
  }
}

module.exports = { pool, criarTabelas };
