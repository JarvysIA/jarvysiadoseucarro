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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gerar_codigo_indicacao: { Args: { _nome: string }; Returns: string }
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
      solicitar_saque_indicacao: { Args: { _chave_pix: string }; Returns: Json }
      unaccent: { Args: { "": string }; Returns: string }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
