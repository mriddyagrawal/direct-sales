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
      brands: {
        Row: {
          active: boolean
          code: string
          id: string
          name: string
          pricing_mode: string
          requires_approval: boolean
        }
        Insert: {
          active?: boolean
          code: string
          id?: string
          name: string
          pricing_mode?: string
          requires_approval?: boolean
        }
        Update: {
          active?: boolean
          code?: string
          id?: string
          name?: string
          pricing_mode?: string
          requires_approval?: boolean
        }
        Relationships: []
      }
      order_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          order_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          order_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          line_total_paise: number
          order_id: string
          position: number
          product_id: string
          product_name: string
          qty: number
          unit_price_paise: number
        }
        Insert: {
          id?: string
          line_total_paise: number
          order_id: string
          position?: number
          product_id: string
          product_name: string
          qty: number
          unit_price_paise: number
        }
        Update: {
          id?: string
          line_total_paise?: number
          order_id?: string
          position?: number
          product_id?: string
          product_name?: string
          qty?: number
          unit_price_paise?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          editable_until: string
          id: string
          notes: string
          order_no: number
          order_ref: string
          processed_at: string | null
          processed_by: string | null
          retailer_id: string
          salesman_id: string
          status: string
          submitted_at: string
          total_paise: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          editable_until: string
          id: string
          notes?: string
          order_no: number
          order_ref: string
          processed_at?: string | null
          processed_by?: string | null
          retailer_id: string
          salesman_id: string
          status: string
          submitted_at: string
          total_paise: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          editable_until?: string
          id?: string
          notes?: string
          order_no?: number
          order_ref?: string
          processed_at?: string | null
          processed_by?: string | null
          retailer_id?: string
          salesman_id?: string
          status?: string
          submitted_at?: string
          total_paise?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_processed_by_fkey"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_salesman_id_fkey"
            columns: ["salesman_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          brand_id: string
          category: string
          created_at: string
          id: string
          name: string
          price_paise: number | null
          tally_name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand_id: string
          category: string
          created_at?: string
          id?: string
          name: string
          price_paise?: number | null
          tally_name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand_id?: string
          category?: string
          created_at?: string
          id?: string
          name?: string
          price_paise?: number | null
          tally_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          id: string
          role: string
          username: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          id: string
          role?: string
          username?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          id?: string
          role?: string
          username?: string | null
        }
        Relationships: []
      }
      retailers: {
        Row: {
          active: boolean
          area: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          phone: string | null
          tally_ledger_name: string | null
          verified: boolean
        }
        Insert: {
          active?: boolean
          area?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          phone?: string | null
          tally_ledger_name?: string | null
          verified?: boolean
        }
        Update: {
          active?: boolean
          area?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          phone?: string | null
          tally_ledger_name?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "retailers_created_by_fkey"
            columns: ["created_by"]
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
      approve_order: {
        Args: { p_order_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          editable_until: string
          id: string
          notes: string
          order_no: number
          order_ref: string
          processed_at: string | null
          processed_by: string | null
          retailer_id: string
          salesman_id: string
          status: string
          submitted_at: string
          total_paise: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_profile_role: { Args: never; Returns: string }
      cancel_order: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          editable_until: string
          id: string
          notes: string
          order_no: number
          order_ref: string
          processed_at: string | null
          processed_by: string | null
          retailer_id: string
          salesman_id: string
          status: string
          submitted_at: string
          total_paise: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      email_for_username: { Args: { p_username: string }; Returns: string }
      import_products: {
        Args: { p_brand_id: string; p_rows: Json }
        Returns: Json
      }
      process_order: {
        Args: { p_order_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          editable_until: string
          id: string
          notes: string
          order_no: number
          order_ref: string
          processed_at: string | null
          processed_by: string | null
          retailer_id: string
          salesman_id: string
          status: string
          submitted_at: string
          total_paise: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_order: {
        Args: {
          p_id: string
          p_items: Json
          p_notes: string
          p_retailer_id: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          editable_until: string
          id: string
          notes: string
          order_no: number
          order_ref: string
          processed_at: string | null
          processed_by: string | null
          retailer_id: string
          salesman_id: string
          status: string
          submitted_at: string
          total_paise: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_order_items: {
        Args: {
          p_items: Json
          p_notes: string
          p_order_id: string
          p_reason?: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          editable_until: string
          id: string
          notes: string
          order_no: number
          order_ref: string
          processed_at: string | null
          processed_by: string | null
          retailer_id: string
          salesman_id: string
          status: string
          submitted_at: string
          total_paise: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
