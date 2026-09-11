export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_usage_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      assinaturas: {
        Row: {
          created_at: string
          data_vencimento: string
          id: string
          status: string
          updated_at: string
          user_id: string
          veiculo_id: string
        }
        Insert: {
          created_at?: string
          data_vencimento: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          veiculo_id: string
        }
        Update: {
          created_at?: string
          data_vencimento?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          veiculo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assinaturas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assinaturas_veiculo_id_fkey"
            columns: ["veiculo_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          details: Json
          id: string
          target_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
        }
        Relationships: []
      }
      carteiras_indicacao: {
        Row: {
          created_at: string
          id: string
          saldo_disponivel: number
          saldo_pendente: number
          saldo_reservado: number
          total_indicacoes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          saldo_disponivel?: number
          saldo_pendente?: number
          saldo_reservado?: number
          total_indicacoes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          saldo_disponivel?: number
          saldo_pendente?: number
          saldo_reservado?: number
          total_indicacoes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carteiras_indicacao_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      despesas: {
        Row: {
          categoria: string
          created_at: string
          data: string
          descricao: string
          id: string
          km_registro: number | null
          receipt_image_url: string | null
          user_id: string
          valor: number
          vehicle_id: string
        }
        Insert: {
          categoria: string
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          km_registro?: number | null
          receipt_image_url?: string | null
          user_id: string
          valor?: number
          vehicle_id: string
        }
        Update: {
          categoria?: string
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          km_registro?: number | null
          receipt_image_url?: string | null
          user_id?: string
          valor?: number
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "despesas_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      fipe_history: {
        Row: {
          codigo_fipe: string
          created_at: string
          id: string
          mes_referencia: string
          valor: number
          vehicle_id: string
        }
        Insert: {
          codigo_fipe: string
          created_at?: string
          id?: string
          mes_referencia: string
          valor: number
          vehicle_id: string
        }
        Update: {
          codigo_fipe?: string
          created_at?: string
          id?: string
          mes_referencia?: string
          valor?: number
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fipe_history_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      jarvys_maintenance_corpus: {
        Row: {
          brand: string
          coverage_json: Json
          created_at: string
          extracted_text: string | null
          file_name: string | null
          generation_range: string | null
          id: string
          mechanical_families_json: Json
          model_group: string
          notes: string | null
          published: boolean
          quality_score: number
          reviewed_by_admin: boolean
          slug: string
          source_type: string
          storage_path: string | null
          summary_json: Json
          title: string
          updated_at: string
          version: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          brand: string
          coverage_json?: Json
          created_at?: string
          extracted_text?: string | null
          file_name?: string | null
          generation_range?: string | null
          id?: string
          mechanical_families_json?: Json
          model_group: string
          notes?: string | null
          published?: boolean
          quality_score?: number
          reviewed_by_admin?: boolean
          slug: string
          source_type?: string
          storage_path?: string | null
          summary_json?: Json
          title: string
          updated_at?: string
          version?: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          brand?: string
          coverage_json?: Json
          created_at?: string
          extracted_text?: string | null
          file_name?: string | null
          generation_range?: string | null
          id?: string
          mechanical_families_json?: Json
          model_group?: string
          notes?: string | null
          published?: boolean
          quality_score?: number
          reviewed_by_admin?: boolean
          slug?: string
          source_type?: string
          storage_path?: string | null
          summary_json?: Json
          title?: string
          updated_at?: string
          version?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: []
      }
      logs_erro_bonificacao: {
        Row: {
          chave_pix: string | null
          codigo_cupom: string | null
          created_at: string
          efi_response: Json | null
          erro: string | null
          id: string
          padrinho_id: string | null
          pagamento_id: string | null
          valor: number | null
        }
        Insert: {
          chave_pix?: string | null
          codigo_cupom?: string | null
          created_at?: string
          efi_response?: Json | null
          erro?: string | null
          id?: string
          padrinho_id?: string | null
          pagamento_id?: string | null
          valor?: number | null
        }
        Update: {
          chave_pix?: string | null
          codigo_cupom?: string | null
          created_at?: string
          efi_response?: Json | null
          erro?: string | null
          id?: string
          padrinho_id?: string | null
          pagamento_id?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_erro_bonificacao_padrinho_id_fkey"
            columns: ["padrinho_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_erro_bonificacao_pagamento_id_fkey"
            columns: ["pagamento_id"]
            isOneToOne: false
            referencedRelation: "pagamentos_pix"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_cost_entries: {
        Row: {
          amount: number
          category: string
          competencia: string
          created_at: string
          created_by: string
          id: string
          note: string | null
        }
        Insert: {
          amount: number
          category: string
          competencia: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
        }
        Update: {
          amount?: number
          category?: string
          competencia?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      movimentacoes_indicacao: {
        Row: {
          afilhado_id: string | null
          created_at: string
          descricao: string | null
          id: string
          liberado_em: string | null
          padrinho_id: string
          pagamento_id: string | null
          referencia: string | null
          status: string
          tipo: string
          valor: number
        }
        Insert: {
          afilhado_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          liberado_em?: string | null
          padrinho_id: string
          pagamento_id?: string | null
          referencia?: string | null
          status: string
          tipo: string
          valor: number
        }
        Update: {
          afilhado_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          liberado_em?: string | null
          padrinho_id?: string
          pagamento_id?: string | null
          referencia?: string | null
          status?: string
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_indicacao_afilhado_id_fkey"
            columns: ["afilhado_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_indicacao_padrinho_id_fkey"
            columns: ["padrinho_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes_indicacao: {
        Row: {
          created_at: string
          id: string
          lida: boolean
          mensagem: string
          payload: Json
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem: string
          payload?: Json
          tipo: string
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string
          payload?: Json
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_indicacao_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ocr_whatsapp_jobs: {
        Row: {
          classification_json: Json | null
          confidence_score: number | null
          confirmation_status: string
          contact_id: string | null
          created_at: string
          id: string
          media_storage_path: string | null
          message_id: string | null
          needs_user_confirmation: boolean
          ocr_result_json: Json | null
          ocr_status: string
          original_media_type: string | null
          updated_at: string
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          classification_json?: Json | null
          confidence_score?: number | null
          confirmation_status?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          media_storage_path?: string | null
          message_id?: string | null
          needs_user_confirmation?: boolean
          ocr_result_json?: Json | null
          ocr_status?: string
          original_media_type?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          classification_json?: Json | null
          confidence_score?: number | null
          confirmation_status?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          media_storage_path?: string | null
          message_id?: string | null
          needs_user_confirmation?: boolean
          ocr_result_json?: Json | null
          ocr_status?: string
          original_media_type?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocr_whatsapp_jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_whatsapp_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_whatsapp_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocr_whatsapp_jobs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos_pix: {
        Row: {
          codigo_cupom: string | null
          created_at: string
          data_pagamento: string | null
          id: string
          metadata: Json | null
          pix_copia_cola: string | null
          produto_ref_id: string | null
          status: string
          tipo_produto: string
          txid_efi: string | null
          user_id: string
          valor: number
          veiculo_id: string | null
        }
        Insert: {
          codigo_cupom?: string | null
          created_at?: string
          data_pagamento?: string | null
          id?: string
          metadata?: Json | null
          pix_copia_cola?: string | null
          produto_ref_id?: string | null
          status?: string
          tipo_produto?: string
          txid_efi?: string | null
          user_id: string
          valor: number
          veiculo_id?: string | null
        }
        Update: {
          codigo_cupom?: string | null
          created_at?: string
          data_pagamento?: string | null
          id?: string
          metadata?: Json | null
          pix_copia_cola?: string | null
          produto_ref_id?: string | null
          status?: string
          tipo_produto?: string
          txid_efi?: string | null
          user_id?: string
          valor?: number
          veiculo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_pix_veiculo_id_fkey"
            columns: ["veiculo_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          asaas_customer_id: string | null
          cep: string | null
          cidade: string | null
          codigo_indicacao: string | null
          cpf: string | null
          created_at: string
          email: string | null
          id: string
          is_super_admin: boolean
          nome: string
          permite_indicacao: boolean
          pix_recebimento: string | null
          placa: string | null
          referrer_id: string | null
          status_usuario: string
          termos_aceitos_em: string | null
          tours_vistos: Json
          trial_inicio: string | null
          uf: string | null
          whatsapp: string
        }
        Insert: {
          asaas_customer_id?: string | null
          cep?: string | null
          cidade?: string | null
          codigo_indicacao?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          id: string
          is_super_admin?: boolean
          nome: string
          permite_indicacao?: boolean
          pix_recebimento?: string | null
          placa?: string | null
          referrer_id?: string | null
          status_usuario?: string
          termos_aceitos_em?: string | null
          tours_vistos?: Json
          trial_inicio?: string | null
          uf?: string | null
          whatsapp: string
        }
        Update: {
          asaas_customer_id?: string | null
          cep?: string | null
          cidade?: string | null
          codigo_indicacao?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_super_admin?: boolean
          nome?: string
          permite_indicacao?: boolean
          pix_recebimento?: string | null
          placa?: string | null
          referrer_id?: string | null
          status_usuario?: string
          termos_aceitos_em?: string | null
          tours_vistos?: Json
          trial_inicio?: string | null
          uf?: string | null
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_image_cache: {
        Row: {
          ano_norm: string
          cor_norm: string
          created_at: string
          id: string
          marca_norm: string
          modelo_norm: string
          storage_path: string
        }
        Insert: {
          ano_norm: string
          cor_norm: string
          created_at?: string
          id?: string
          marca_norm: string
          modelo_norm: string
          storage_path: string
        }
        Update: {
          ano_norm?: string
          cor_norm?: string
          created_at?: string
          id?: string
          marca_norm?: string
          modelo_norm?: string
          storage_path?: string
        }
        Relationships: []
      }
      vehicle_images_blob: {
        Row: {
          created_at: string
          id: string
          image_data: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_data: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_data?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_images_blob_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: true
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance_profiles: {
        Row: {
          ano_modelo: number | null
          cilindradas: number | null
          combustivel: string | null
          confidence: number
          created_at: string
          id: string
          maintenance_family: string | null
          maintenance_plan_json: Json | null
          marca: string | null
          modelo_fipe: string | null
          motor_textual: string | null
          parts_profile_json: Json | null
          reviewed_by_admin: boolean
          signature: string
          sistema_distribuicao: string
          source: string
          transmissao: string | null
          updated_at: string
          valvulas: number | null
          versao: string | null
        }
        Insert: {
          ano_modelo?: number | null
          cilindradas?: number | null
          combustivel?: string | null
          confidence?: number
          created_at?: string
          id?: string
          maintenance_family?: string | null
          maintenance_plan_json?: Json | null
          marca?: string | null
          modelo_fipe?: string | null
          motor_textual?: string | null
          parts_profile_json?: Json | null
          reviewed_by_admin?: boolean
          signature: string
          sistema_distribuicao?: string
          source?: string
          transmissao?: string | null
          updated_at?: string
          valvulas?: number | null
          versao?: string | null
        }
        Update: {
          ano_modelo?: number | null
          cilindradas?: number | null
          combustivel?: string | null
          confidence?: number
          created_at?: string
          id?: string
          maintenance_family?: string | null
          maintenance_plan_json?: Json | null
          marca?: string | null
          modelo_fipe?: string | null
          motor_textual?: string | null
          parts_profile_json?: Json | null
          reviewed_by_admin?: boolean
          signature?: string
          sistema_distribuicao?: string
          source?: string
          transmissao?: string | null
          updated_at?: string
          valvulas?: number | null
          versao?: string | null
        }
        Relationships: []
      }
      veiculos: {
        Row: {
          ano: string | null
          ano_modelo: number | null
          chassi: string | null
          cilindradas: number | null
          claimed_at: string | null
          codigo_fipe: string | null
          codigo_marca: string | null
          codigo_modelo: string | null
          combustivel_fipe: string | null
          cor: string | null
          created_at: string
          fipe_historico: Json | null
          fipe_mes_referencia: string | null
          fipe_ultima_atualizacao: string | null
          fipe_updated_at: string | null
          fipe_valor: number | null
          foto_url: string | null
          historico_fipe: Json | null
          history_locked: boolean
          id: string
          image_url: string | null
          jarvys_technical_profile: Json | null
          jarvys_technical_profile_confidence: string | null
          jarvys_technical_profile_source: string | null
          jarvys_technical_profile_updated_at: string | null
          km_atual: number | null
          km_ultima_troca_arrefecimento: number | null
          km_ultima_troca_filtros: number | null
          km_ultima_troca_oleo: number | null
          km_ultima_troca_pastilhas: number | null
          marca: string | null
          modelo: string | null
          modelo_fipe: string | null
          motorizacao: string | null
          placa: string
          placafipe_hash: string | null
          status: string
          user_id: string | null
          vehicle_signature: string | null
        }
        Insert: {
          ano?: string | null
          ano_modelo?: number | null
          chassi?: string | null
          cilindradas?: number | null
          claimed_at?: string | null
          codigo_fipe?: string | null
          codigo_marca?: string | null
          codigo_modelo?: string | null
          combustivel_fipe?: string | null
          cor?: string | null
          created_at?: string
          fipe_historico?: Json | null
          fipe_mes_referencia?: string | null
          fipe_ultima_atualizacao?: string | null
          fipe_updated_at?: string | null
          fipe_valor?: number | null
          foto_url?: string | null
          historico_fipe?: Json | null
          history_locked?: boolean
          id?: string
          image_url?: string | null
          jarvys_technical_profile?: Json | null
          jarvys_technical_profile_confidence?: string | null
          jarvys_technical_profile_source?: string | null
          jarvys_technical_profile_updated_at?: string | null
          km_atual?: number | null
          km_ultima_troca_arrefecimento?: number | null
          km_ultima_troca_filtros?: number | null
          km_ultima_troca_oleo?: number | null
          km_ultima_troca_pastilhas?: number | null
          marca?: string | null
          modelo?: string | null
          modelo_fipe?: string | null
          motorizacao?: string | null
          placa: string
          placafipe_hash?: string | null
          status?: string
          user_id?: string | null
          vehicle_signature?: string | null
        }
        Update: {
          ano?: string | null
          ano_modelo?: number | null
          chassi?: string | null
          cilindradas?: number | null
          claimed_at?: string | null
          codigo_fipe?: string | null
          codigo_marca?: string | null
          codigo_modelo?: string | null
          combustivel_fipe?: string | null
          cor?: string | null
          created_at?: string
          fipe_historico?: Json | null
          fipe_mes_referencia?: string | null
          fipe_ultima_atualizacao?: string | null
          fipe_updated_at?: string | null
          fipe_valor?: number | null
          foto_url?: string | null
          historico_fipe?: Json | null
          history_locked?: boolean
          id?: string
          image_url?: string | null
          jarvys_technical_profile?: Json | null
          jarvys_technical_profile_confidence?: string | null
          jarvys_technical_profile_source?: string | null
          jarvys_technical_profile_updated_at?: string | null
          km_atual?: number | null
          km_ultima_troca_arrefecimento?: number | null
          km_ultima_troca_filtros?: number | null
          km_ultima_troca_oleo?: number | null
          km_ultima_troca_pastilhas?: number | null
          marca?: string | null
          modelo?: string | null
          modelo_fipe?: string | null
          motorizacao?: string | null
          placa?: string
          placafipe_hash?: string | null
          status?: string
          user_id?: string | null
          vehicle_signature?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "veiculos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_action_executions: {
        Row: {
          action_type: string
          completed_at: string | null
          contact_id: string
          conversation_state_id: string | null
          created_at: string
          draft_id: string
          error_code: string | null
          id: string
          result_payload: Json | null
          source_message_id: string | null
          started_at: string
          status: string
          updated_at: string
          user_id: string
          vehicle_id: string | null
        }
        Insert: {
          action_type: string
          completed_at?: string | null
          contact_id: string
          conversation_state_id?: string | null
          created_at?: string
          draft_id: string
          error_code?: string | null
          id?: string
          result_payload?: Json | null
          source_message_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
          vehicle_id?: string | null
        }
        Update: {
          action_type?: string
          completed_at?: string | null
          contact_id?: string
          conversation_state_id?: string | null
          created_at?: string
          draft_id?: string
          error_code?: string | null
          id?: string
          result_payload?: Json | null
          source_message_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_action_executions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_action_executions_conversation_state_id_fkey"
            columns: ["conversation_state_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversation_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_action_executions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_action_executions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_action_executions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_consents: {
        Row: {
          accepted_at: string | null
          consent_text: string | null
          consent_type: string
          created_at: string
          id: string
          phone_e164: string
          revoked_at: string | null
          source: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          consent_text?: string | null
          consent_type: string
          created_at?: string
          id?: string
          phone_e164: string
          revoked_at?: string | null
          source: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          consent_text?: string | null
          consent_type?: string
          created_at?: string
          id?: string
          phone_e164?: string
          revoked_at?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_contacts: {
        Row: {
          assigned_instance_id: string | null
          assigned_provider: string | null
          assigned_whatsapp_number: string | null
          created_at: string
          display_name: string | null
          id: string
          is_primary: boolean
          last_inbound_at: string | null
          last_outbound_at: string | null
          opt_in: boolean
          opt_in_at: string | null
          opt_in_source: string | null
          opt_out: boolean
          opt_out_at: string | null
          phone_e164: string
          unlinked_at: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          assigned_instance_id?: string | null
          assigned_provider?: string | null
          assigned_whatsapp_number?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_primary?: boolean
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          opt_in?: boolean
          opt_in_at?: string | null
          opt_in_source?: string | null
          opt_out?: boolean
          opt_out_at?: string | null
          phone_e164: string
          unlinked_at?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          assigned_instance_id?: string | null
          assigned_provider?: string | null
          assigned_whatsapp_number?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_primary?: boolean
          last_inbound_at?: string | null
          last_outbound_at?: string | null
          opt_in?: boolean
          opt_in_at?: string | null
          opt_in_source?: string | null
          opt_out?: boolean
          opt_out_at?: string | null
          phone_e164?: string
          unlinked_at?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_handoff_ledger: {
        Row: {
          completed_at: string | null
          contact_id: string
          created_at: string
          expires_at: string
          id: string
          invoking_at: string | null
          reserved_at: string
          result_status: string | null
          segment: string
          source_message_id: string
          status: string
          user_id: string
          vehicle_id: string | null
        }
        Insert: {
          completed_at?: string | null
          contact_id: string
          created_at?: string
          expires_at: string
          id?: string
          invoking_at?: string | null
          reserved_at?: string
          result_status?: string | null
          segment: string
          source_message_id: string
          status?: string
          user_id: string
          vehicle_id?: string | null
        }
        Update: {
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          invoking_at?: string | null
          reserved_at?: string
          result_status?: string | null
          segment?: string
          source_message_id?: string
          status?: string
          user_id?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_handoff_ledger_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_handoff_ledger_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_handoff_ledger_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_states: {
        Row: {
          active_vehicle_id: string | null
          awaiting_field: string | null
          confirmed_at: string | null
          contact_id: string
          created_at: string
          current_intent: string | null
          draft_id: string | null
          draft_payload: Json | null
          draft_type: string | null
          draft_version: number
          executed_at: string | null
          expires_at: string | null
          fallback_count: number
          id: string
          last_interaction_at: string
          last_message_id: string | null
          request_source: string | null
          state: string
          state_version: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active_vehicle_id?: string | null
          awaiting_field?: string | null
          confirmed_at?: string | null
          contact_id: string
          created_at?: string
          current_intent?: string | null
          draft_id?: string | null
          draft_payload?: Json | null
          draft_type?: string | null
          draft_version?: number
          executed_at?: string | null
          expires_at?: string | null
          fallback_count?: number
          id?: string
          last_interaction_at?: string
          last_message_id?: string | null
          request_source?: string | null
          state?: string
          state_version?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active_vehicle_id?: string | null
          awaiting_field?: string | null
          confirmed_at?: string | null
          contact_id?: string
          created_at?: string
          current_intent?: string | null
          draft_id?: string | null
          draft_payload?: Json | null
          draft_type?: string | null
          draft_version?: number
          executed_at?: string | null
          expires_at?: string | null
          fallback_count?: number
          id?: string
          last_interaction_at?: string
          last_message_id?: string | null
          request_source?: string | null
          state?: string
          state_version?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_states_active_vehicle_id_fkey"
            columns: ["active_vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_states_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_states_last_message_id_fkey"
            columns: ["last_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_events: {
        Row: {
          created_at: string
          direction: string
          error_message: string | null
          event_type: string
          id: string
          instance_id: string | null
          phone_e164: string | null
          processed_at: string | null
          provider: string
          provider_event_id: string | null
          provider_message_id: string | null
          raw_payload_sanitized: Json | null
          received_at: string
          status: string
        }
        Insert: {
          created_at?: string
          direction: string
          error_message?: string | null
          event_type: string
          id?: string
          instance_id?: string | null
          phone_e164?: string | null
          processed_at?: string | null
          provider?: string
          provider_event_id?: string | null
          provider_message_id?: string | null
          raw_payload_sanitized?: Json | null
          received_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          direction?: string
          error_message?: string | null
          event_type?: string
          id?: string
          instance_id?: string | null
          phone_e164?: string | null
          processed_at?: string | null
          provider?: string
          provider_event_id?: string | null
          provider_message_id?: string | null
          raw_payload_sanitized?: Json | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      whatsapp_km_prompt_requests: {
        Row: {
          cancelled_at: string | null
          consumed_at: string | null
          contact_id: string
          created_at: string
          expired_at: string | null
          expires_at: string | null
          id: string
          pending_at: string | null
          prompt_message_id: string
          reserved_at: string | null
          reserved_draft_id: string | null
          status: string
          user_id: string
          vehicle_id: string
        }
        Insert: {
          cancelled_at?: string | null
          consumed_at?: string | null
          contact_id: string
          created_at?: string
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          pending_at?: string | null
          prompt_message_id: string
          reserved_at?: string | null
          reserved_draft_id?: string | null
          status: string
          user_id: string
          vehicle_id: string
        }
        Update: {
          cancelled_at?: string | null
          consumed_at?: string | null
          contact_id?: string
          created_at?: string
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          pending_at?: string | null
          prompt_message_id?: string
          reserved_at?: string | null
          reserved_draft_id?: string | null
          status?: string
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_km_prompt_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_km_prompt_requests_prompt_message_id_fkey"
            columns: ["prompt_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_km_prompt_requests_reserved_draft_id_fkey"
            columns: ["reserved_draft_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_km_prompt_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_km_prompt_requests_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_link_verifications: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          last_sent_at: string | null
          max_attempts: number
          phone_e164: string
          purpose: string
          requested_ip_hash: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          last_sent_at?: string | null
          max_attempts?: number
          phone_e164: string
          purpose?: string
          requested_ip_hash?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_sent_at?: string | null
          max_attempts?: number
          phone_e164?: string
          purpose?: string
          requested_ip_hash?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_link_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          contact_id: string | null
          created_at: string
          direction: string
          id: string
          instance_id: string | null
          media_mime_type: string | null
          media_storage_path: string | null
          media_url: string | null
          message_type: string
          plan_decision: Json | null
          provider: string
          provider_message_id: string | null
          status: string
          text_body: string | null
          updated_at: string
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          direction: string
          id?: string
          instance_id?: string | null
          media_mime_type?: string | null
          media_storage_path?: string | null
          media_url?: string | null
          message_type: string
          plan_decision?: Json | null
          provider?: string
          provider_message_id?: string | null
          status?: string
          text_body?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          direction?: string
          id?: string
          instance_id?: string | null
          media_mime_type?: string | null
          media_storage_path?: string | null
          media_url?: string | null
          message_type?: string
          plan_decision?: Json | null
          provider?: string
          provider_message_id?: string | null
          status?: string
          text_body?: string | null
          updated_at?: string
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_milestone_notices: {
        Row: {
          created_at: string
          dismissed_at: string | null
          id: string
          milestone_km: number
          notified_at: string | null
          snoozed_until: string | null
          status: string
          user_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          milestone_km: number
          notified_at?: string | null
          snoozed_until?: string | null
          status?: string
          user_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          milestone_km?: number
          notified_at?: string | null
          snoozed_until?: string | null
          status?: string
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_milestone_notices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_outbound_queue: {
        Row: {
          attempts: number
          contact_id: string | null
          created_at: string
          error_message: string | null
          expires_at: string | null
          id: string
          idempotency_key: string | null
          instance_id: string | null
          max_attempts: number
          media_storage_path: string | null
          message_type: string
          phone_e164: string | null
          priority: number
          provider: string
          provider_message_id: string | null
          purpose: string
          scheduled_at: string
          sent_at: string | null
          source_message_id: string | null
          status: string
          text_body: string | null
          user_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          attempts?: number
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          instance_id?: string | null
          max_attempts?: number
          media_storage_path?: string | null
          message_type?: string
          phone_e164?: string | null
          priority?: number
          provider?: string
          provider_message_id?: string | null
          purpose?: string
          scheduled_at?: string
          sent_at?: string | null
          source_message_id?: string | null
          status?: string
          text_body?: string | null
          user_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          attempts?: number
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          id?: string
          idempotency_key?: string | null
          instance_id?: string | null
          max_attempts?: number
          media_storage_path?: string | null
          message_type?: string
          phone_e164?: string | null
          priority?: number
          provider?: string
          provider_message_id?: string | null
          purpose?: string
          scheduled_at?: string
          sent_at?: string | null
          source_message_id?: string | null
          status?: string
          text_body?: string | null
          user_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_outbound_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_outbound_queue_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_outbound_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_outbound_queue_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "veiculos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_processing_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          error_message: string | null
          event_id: string | null
          finished_at: string | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          message_id: string | null
          orchestrator_processed_at: string | null
          orchestrator_result: Json | null
          orchestrator_version: string | null
          queue_type: string
          route_owner: string
          scheduled_at: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          message_id?: string | null
          orchestrator_processed_at?: string | null
          orchestrator_result?: Json | null
          orchestrator_version?: string | null
          queue_type: string
          route_owner?: string
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          finished_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          message_id?: string | null
          orchestrator_processed_at?: string | null
          orchestrator_result?: Json | null
          orchestrator_version?: string | null
          queue_type?: string
          route_owner?: string
          scheduled_at?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_processing_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_processing_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_provider_instances: {
        Row: {
          created_at: string
          current_users: number
          daily_media_limit: number | null
          daily_message_limit: number | null
          health_status: string
          id: string
          instance_id: string
          instance_name: string | null
          is_default: boolean
          last_health_check_at: string | null
          max_users: number | null
          orchestrator_mode: string
          phone_number_e164: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_users?: number
          daily_media_limit?: number | null
          daily_message_limit?: number | null
          health_status?: string
          id?: string
          instance_id: string
          instance_name?: string | null
          is_default?: boolean
          last_health_check_at?: string | null
          max_users?: number | null
          orchestrator_mode?: string
          phone_number_e164?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_users?: number
          daily_media_limit?: number | null
          daily_message_limit?: number | null
          health_status?: string
          id?: string
          instance_id?: string
          instance_name?: string | null
          is_default?: boolean
          last_health_check_at?: string | null
          max_users?: number | null
          orchestrator_mode?: string
          phone_number_e164?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_whatsapp_orchestrator_transition: {
        Args: {
          p_expected_state_version: number
          p_lease_token: string
          p_orchestrator_version: string
          p_patch: Json
          p_queue_item_id: string
          p_response?: Json
          p_result_summary: Json
        }
        Returns: Json
      }
      cancel_whatsapp_km_prompt_request: {
        Args: { p_prompt_message_id: string }
        Returns: {
          cancelled_at: string
          request_id: string
          result: string
        }[]
      }
      claim_whatsapp_orchestrator_items: {
        Args: {
          p_batch?: number
          p_lease_seconds?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          contact_id: string
          instance_id: string
          instance_pk: string
          lease_expires_at: string
          lease_token: string
          max_attempts: number
          message_id: string
          message_type: string
          orchestrator_mode: string
          provider: string
          queue_id: string
          queue_type: string
          user_id: string
          was_recovered: boolean
        }[]
      }
      complete_conversation_handoff_execution: {
        Args: { p_id: string; p_result_status: string }
        Returns: boolean
      }
      confirm_whatsapp_link_code: {
        Args: {
          p_code_hash_candidate: string
          p_user_id: string
          p_verification_id: string
        }
        Returns: {
          contact_id: string
          phone_e164: string
          result: string
        }[]
      }
      confirm_whatsapp_phone_change: {
        Args: {
          p_code_hash_candidate: string
          p_user_id: string
          p_verification_id: string
        }
        Returns: {
          new_contact_id: string
          new_phone_e164: string
          old_contact_id: string
          result: string
        }[]
      }
      create_whatsapp_km_prompt_request: {
        Args: {
          p_contact_id: string
          p_prompt_message_id: string
          p_user_id: string
          p_vehicle_id: string
        }
        Returns: {
          request_id: string
          result: string
        }[]
      }
      disable_whatsapp_messages: {
        Args: { p_user_id: string }
        Returns: {
          contact_id: string
          phone_e164: string
          result: string
        }[]
      }
      enqueue_conversation_handoff_outbound: {
        Args: {
          p_contact_id: string
          p_deliverable: boolean
          p_idempotency_key: string
          p_text_body: string
          p_user_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      enqueue_whatsapp_km_prompt: {
        Args: {
          p_contact_id: string
          p_idempotency_key: string
          p_text_body: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      execute_whatsapp_expense_create: {
        Args: {
          p_categoria: string
          p_confirmation_message_id: string
          p_contact_id: string
          p_conversation_state_id: string
          p_descricao: string
          p_draft_id: string
          p_expected_state_version: number
          p_orchestrator_version: string
          p_queue_item_id: string
          p_source_message_id: string
          p_user_id: string
          p_valor: number
          p_vehicle_id: string
        }
        Returns: Json
      }
      execute_whatsapp_km_update: {
        Args: {
          p_confirmation_message_id: string
          p_contact_id: string
          p_conversation_state_id: string
          p_correction_confirmed: boolean
          p_correction_reason: string
          p_draft_id: string
          p_expected_previous_km: number
          p_expected_state_version: number
          p_is_correction: boolean
          p_new_km: number
          p_orchestrator_version: string
          p_queue_item_id: string
          p_source_message_id: string
          p_user_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      execute_whatsapp_km_update_with_expense_link: {
        Args: {
          p_confirmation_message_id: string
          p_contact_id: string
          p_conversation_state_id: string
          p_correction_confirmed: boolean
          p_correction_reason: string
          p_draft_id: string
          p_expected_previous_km: number
          p_expected_state_version: number
          p_is_correction: boolean
          p_linked_despesa_id: string
          p_new_km: number
          p_orchestrator_version: string
          p_queue_item_id: string
          p_source_message_id: string
          p_user_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      expire_whatsapp_km_prompt_requests: {
        Args: { p_batch?: number }
        Returns: {
          expired_count: number
        }[]
      }
      fail_conversation_handoff_execution: {
        Args: { p_id: string; p_result_status: string }
        Returns: boolean
      }
      finalize_whatsapp_km_prompt_failed: {
        Args: {
          p_error_message: string
          p_outbound_queue_id: string
          p_terminal_reason: string
        }
        Returns: Json
      }
      finalize_whatsapp_km_prompt_sent: {
        Args: { p_outbound_queue_id: string; p_provider_message_id: string }
        Returns: Json
      }
      gerar_codigo_indicacao: { Args: { _nome: string }; Returns: string }
      get_conversation_handoff_outbound_by_key: {
        Args: { p_idempotency_key: string }
        Returns: {
          outbound_message_id: string
          outbound_queue_id: string
          text_body: string
        }[]
      }
      get_indicacao_dias_bloqueio: { Args: never; Returns: number }
      get_indicacao_saque_minimo: { Args: never; Returns: number }
      get_indicacao_valor_comissao: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      liberar_comissoes_indicacao: {
        Args: never
        Returns: {
          canceladas: number
          liberadas: number
        }[]
      }
      mark_conversation_handoff_invoking: {
        Args: { p_id: string }
        Returns: boolean
      }
      promote_whatsapp_km_prompt_request_to_pending: {
        Args: { p_prompt_message_id: string }
        Returns: {
          expires_at: string
          pending_at: string
          request_id: string
          result: string
        }[]
      }
      reactivate_whatsapp_contact: {
        Args: { p_user_id: string }
        Returns: {
          contact_id: string
          phone_e164: string
          result: string
        }[]
      }
      record_ai_usage_and_check_alert: {
        Args: { p_event_type: string; p_user_id: string }
        Returns: {
          daily_count: number
          should_alert: boolean
        }[]
      }
      record_whatsapp_milestone_notice: {
        Args: {
          p_action: string
          p_milestone_km: number
          p_user_id: string
          p_vehicle_id: string
        }
        Returns: Json
      }
      registrar_comissao_indicacao: {
        Args: {
          _afilhado_id: string
          _descricao?: string
          _padrinho_id: string
          _pagamento_id: string
          _referencia: string
          _valor?: number
        }
        Returns: string
      }
      release_whatsapp_orchestrator_item: {
        Args: {
          p_delay_seconds?: number
          p_lease_token: string
          p_queue_item_id: string
          p_reason: string
          p_retry_kind: string
        }
        Returns: Json
      }
      reserve_conversation_handoff_execution: {
        Args: {
          p_contact_id: string
          p_segment: string
          p_source_message_id: string
          p_ttl_seconds: number
          p_user_id: string
          p_vehicle_id: string
        }
        Returns: {
          id: string
          is_new_reservation: boolean
          result_status: string
          status: string
        }[]
      }
      reserve_whatsapp_km_prompt_request: {
        Args: {
          p_contact_id: string
          p_draft_id: string
          p_prompt_message_id: string
          p_user_id: string
          p_vehicle_id: string
        }
        Returns: {
          request_id: string
          reserved_at: string
          reserved_draft_id: string
          result: string
        }[]
      }
      solicitar_saque_indicacao: { Args: { _chave_pix: string }; Returns: Json }
      unaccent: { Args: { "": string }; Returns: string }
      upsert_vault_secret: {
        Args: { _name: string; _value: string }
        Returns: undefined
      }
      validar_cupom_indicacao: { Args: { _codigo: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
