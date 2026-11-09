const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function criarTabelas() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("CREATE TABLE IF NOT EXISTS configuracoes (id SERIAL PRIMARY KEY,taxa_plataforma DECIMAL(5,2) NOT NULL DEFAULT 5.00,chave_pix_plataforma TEXT NOT NULL DEFAULT '',atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,elevenlabs_api_key TEXT DEFAULT '',voz_padrao TEXT DEFAULT 'Adam')");
    await client.query("CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY,tipo VARCHAR(20) NOT NULL,nome VARCHAR(255) NOT NULL,email VARCHAR(255) UNIQUE NOT NULL,senha VARCHAR(255) NOT NULL,telefone VARCHAR(20),cnpj VARCHAR(30),endereco TEXT,responsavel VARCHAR(255),chave_pix TEXT DEFAULT '',woovi_client_id TEXT,woovi_client_secret TEXT,woovi_webhook_secret TEXT,status VARCHAR(20) DEFAULT 'pendente',criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,conferencia_auto BOOLEAN DEFAULT TRUE)");
    await client.query("CREATE TABLE IF NOT EXISTS bingos (id SERIAL PRIMARY KEY,usuario_id INT REFERENCES usuarios(id),nome VARCHAR(255) NOT NULL,premio VARCHAR(255) NOT NULL,data_sorteio TIMESTAMP NOT NULL,preco_cartela DECIMAL(10,2) NOT NULL,max_cartelas INT DEFAULT 500,limite_por_pessoa INT DEFAULT 3,status VARCHAR(20) DEFAULT 'rascunho',criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,imagem_premio TEXT,encerrado_em TIMESTAMP,arquivado BOOLEAN DEFAULT FALSE,sorteio_auto BOOLEAN DEFAULT TRUE,intervalo_bolas INT DEFAULT 30,voz_numeros BOOLEAN DEFAULT TRUE)");
    await client.query("CREATE TABLE IF NOT EXISTS cartelas (id SERIAL PRIMARY KEY,bingo_id INT REFERENCES bingos(id),usuario_id INT REFERENCES usuarios(id),codigo VARCHAR(50) UNIQUE NOT NULL,numeros INT[] NOT NULL,paga BOOLEAN DEFAULT FALSE,txid_woovi VARCHAR(120),criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,marcados INT[] DEFAULT '{}')");
    await client.query("CREATE TABLE IF NOT EXISTS pagamentos (id SERIAL PRIMARY KEY,cartela_id INT REFERENCES cartelas(id),valor_total DECIMAL(10,2) NOT NULL,valor_plataforma DECIMAL(10,2) NOT NULL,chave_pix_plataforma TEXT NOT NULL DEFAULT '',valor_instituicao DECIMAL(10,2) NOT NULL,chave_pix_instituicao TEXT NOT NULL DEFAULT '',txid VARCHAR(120),status VARCHAR(20) DEFAULT 'pendente',criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,correlation_id VARCHAR(120),woovi_charge_id VARCHAR(160),br_code TEXT,qr_code_image TEXT,payment_link_url TEXT,expires_at TIMESTAMPTZ)");
    await client.query("CREATE TABLE IF NOT EXISTS sorteios (id SERIAL PRIMARY KEY,bingo_id INT REFERENCES bingos(id),numero INT NOT NULL,ordem INT NOT NULL,sorteado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
    await client.query("CREATE TABLE IF NOT EXISTS webhook_events (id BIGSERIAL PRIMARY KEY,event_key VARCHAR(200) NOT NULL UNIQUE,event_type VARCHAR(100) NOT NULL,correlation_id VARCHAR(120),received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_correlation_id_uidx ON pagamentos(correlation_id) WHERE correlation_id IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS cartelas_bingo_usuario_idx ON cartelas(bingo_id,usuario_id)');
    await client.query('CREATE INDEX IF NOT EXISTS sorteios_bingo_ordem_idx ON sorteios(bingo_id,ordem)');
    await client.query("INSERT INTO configuracoes (taxa_plataforma,chave_pix_plataforma) SELECT 5.00,'' WHERE NOT EXISTS (SELECT 1 FROM configuracoes)");

    const adminEmail=process.env.ADMIN_EMAIL;
    const adminPassword=process.env.ADMIN_PASSWORD;
    if(adminEmail && adminPassword) {
      if(adminPassword.length<12) throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres.');
      const exists=await client.query('SELECT id FROM usuarios WHERE email=$1',[adminEmail.trim().toLowerCase()]);
      if(!exists.rows.length) {
        const bcrypt=require('bcryptjs');
        const hash=await bcrypt.hash(adminPassword,12);
        await client.query("INSERT INTO usuarios (tipo,nome,email,senha,status,chave_pix) VALUES ('admin','Administrador',$1,$2,'aprovado','')",[adminEmail.trim().toLowerCase(),hash]);
        console.log('Administrador inicial criado pelas variáveis de ambiente.');
      }
    }
    await client.query('COMMIT');
    console.log('Banco Bingo Social verificado.');
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('Falha ao preparar banco:',err);
    throw err;
  } finally {
    client.release();
  }
}

pool.on('error',err=>console.error('Erro inesperado no pool PostgreSQL:',err));
module.exports={pool,criarTabelas};
