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
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(20) NOT NULL,
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        senha VARCHAR(255) NOT NULL,
        telefone VARCHAR(20),
        cnpj VARCHAR(20),
        endereco TEXT,
        responsavel VARCHAR(255),
        chave_pix TEXT,
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
        criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sorteios (
        id SERIAL PRIMARY KEY,
        bingo_id INT REFERENCES bingos(id),
        numero INT NOT NULL,
        ordem INT NOT NULL,
        sorteado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Verifica se admin existe
    const admin = await client.query("SELECT id FROM usuarios WHERE email = 'admin@bingo'");
    if (admin.rows.length === 0) {
      const bcrypt = require('bcryptjs');
      const senhaHash = await bcrypt.hash('admin@bingo', 10);
      await client.query(`
        INSERT INTO usuarios (tipo, nome, email, senha, status)
        VALUES ('admin', 'Administrador', 'admin@bingo', $1, 'aprovado')
      `, [senhaHash]);
      console.log('✅ Admin criado: admin@bingo / senha: admin@bingo');
    }

    console.log('✅ Tabelas prontas no Neon!');
  } catch (err) {
    console.error('❌ Erro nas tabelas:', err);
  } finally {
    client.release();
  }
}

module.exports = { pool, criarTabelas };
