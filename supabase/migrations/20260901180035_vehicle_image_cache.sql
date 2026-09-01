-- Vehicle-Image-Cache — banco de fotos compartilhado por combinação
-- marca+modelo+ano+cor.
--
-- Motivo: generateVehicleImageFn (src/lib/vehicle-image.functions.ts) hoje
-- gera uma foto nova via IA (OpenAI/Lovable AI Gateway, gpt-image-2) pra
-- TODO cadastro de veículo, mesmo quando já existe outro veículo com a
-- mesma combinação marca+modelo+ano+cor — confirmado com dado real: 2
-- veículos "TOYOTA CCROSS XRE 20" 2022 "Preta" geraram 2 chamadas de IA e 2
-- arquivos distintos no Storage, sem necessidade (a foto de um carro
-- genérico daquela combinação serve pros dois).
--
-- Esta tabela só guarda o mapeamento (chave normalizada) -> storage_path no
-- bucket "vehicle-photos" já existente. Antes de chamar a IA, o handler
-- consulta esta tabela pela chave; se encontrar, reaproveita o
-- storage_path já gerado (só cria uma signed URL nova, sem chamar IA nem
-- fazer upload). Mecanismo complementar, não substitui,
-- inheritVehicleImageFn (vehicles.functions.ts, reaproveita foto_url por
-- PLACA — mesmo carro físico revendido).
--
-- Backend-only: nenhuma policy de RLS pra usuário comum. service_role
-- (supabaseAdmin, já usado por generateVehicleImageFn hoje) bypassa RLS
-- automaticamente, mesmo padrão de outras tabelas internas do projeto
-- (ex: jarvys_test_meta, whatsapp_processing_queue).
CREATE TABLE public.vehicle_image_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marca_norm text NOT NULL,
  modelo_norm text NOT NULL,
  ano_norm text NOT NULL,
  cor_norm text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_image_cache_key_unique UNIQUE (marca_norm, modelo_norm, ano_norm, cor_norm)
);

ALTER TABLE public.vehicle_image_cache ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy criada de propósito: sem nenhuma policy, RLS bloqueia
-- 100% do acesso via roles sujeitos a RLS (anon/authenticated) — só
-- service_role (que sempre bypassa RLS) consegue ler/escrever.

COMMENT ON TABLE public.vehicle_image_cache IS
  'Cache de fotos de veículo geradas por IA, compartilhado por chave '
  'marca_norm+modelo_norm+ano_norm+cor_norm (trim+uppercase). Evita '
  'gerar/pagar por uma nova imagem via IA pra combinações já existentes. '
  'storage_path aponta pro bucket vehicle-photos (mesmo bucket já usado '
  'por veiculos.foto_url). Backend-only, sem policy de RLS pra usuário '
  'comum — só service_role acessa.';
