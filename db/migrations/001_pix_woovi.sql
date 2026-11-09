-- Migration aditiva do Bingo Social: suporte a cobrança PIX Woovi e recursos já presentes no banco.
-- Não remove tabelas, colunas nem registros existentes.

ALTER TABLE cartelas ADD COLUMN IF NOT EXISTS txid_woovi VARCHAR(120);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS woovi_client_id TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS woovi_client_secret TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS woovi_webhook_secret TEXT;

ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(120);
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS woovi_charge_id VARCHAR(160);
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS br_code TEXT;
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS qr_code_image TEXT;
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_correlation_id_uidx
  ON pagamentos(correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_key VARCHAR(200) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  correlation_id VARCHAR(120),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS conferencia_auto BOOLEAN DEFAULT TRUE;
ALTER TABLE bingos ADD COLUMN IF NOT EXISTS imagem_premio TEXT;
ALTER TABLE bingos ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMP;
ALTER TABLE bingos ADD COLUMN IF NOT EXISTS arquivado BOOLEAN DEFAULT FALSE;
ALTER TABLE bingos ADD COLUMN IF NOT EXISTS sorteio_auto BOOLEAN DEFAULT TRUE;
ALTER TABLE bingos ADD COLUMN IF NOT EXISTS intervalo_bolas INTEGER DEFAULT 30;
ALTER TABLE bingos ADD COLUMN IF NOT EXISTS voz_numeros BOOLEAN DEFAULT TRUE;
ALTER TABLE cartelas ADD COLUMN IF NOT EXISTS marcados INTEGER[] DEFAULT '{}';
ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT DEFAULT '';
ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS voz_padrao TEXT DEFAULT 'Adam';
