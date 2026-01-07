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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      atm_profiles: {
        Row: {
          active: boolean | null
          atm_id: string | null
          cash_management_rep: number
          cash_management_rps: number
          city: string | null
          created_at: string | null
          id: string
          installed_date: string | null
          location_name: string | null
          monthly_rent: number
          notes: string | null
          on_bitstop: boolean | null
          on_coinradar: boolean | null
          platform: string | null
          platform_switch_date: string | null
          removed_date: string | null
          rent_payment_method: string | null
          sales_rep_id: string | null
          serial_number: string | null
          state: string | null
          street_address: string | null
          updated_at: string | null
          warehouse_location: string | null
          zip_code: string | null
        }
        Insert: {
          active?: boolean | null
          atm_id?: string | null
          cash_management_rep?: number
          cash_management_rps?: number
          city?: string | null
          created_at?: string | null
          id?: string
          installed_date?: string | null
          location_name?: string | null
          monthly_rent?: number
          notes?: string | null
          on_bitstop?: boolean | null
          on_coinradar?: boolean | null
          platform?: string | null
          platform_switch_date?: string | null
          removed_date?: string | null
          rent_payment_method?: string | null
          sales_rep_id?: string | null
          serial_number?: string | null
          state?: string | null
          street_address?: string | null
          updated_at?: string | null
          warehouse_location?: string | null
          zip_code?: string | null
        }
        Update: {
          active?: boolean | null
          atm_id?: string | null
          cash_management_rep?: number
          cash_management_rps?: number
          city?: string | null
          created_at?: string | null
          id?: string
          installed_date?: string | null
          location_name?: string | null
          monthly_rent?: number
          notes?: string | null
          on_bitstop?: boolean | null
          on_coinradar?: boolean | null
          platform?: string | null
          platform_switch_date?: string | null
          removed_date?: string | null
          rent_payment_method?: string | null
          sales_rep_id?: string | null
          serial_number?: string | null
          state?: string | null
          street_address?: string | null
          updated_at?: string | null
          warehouse_location?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "atm_profiles_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      bitstop_commissions: {
        Row: {
          commission_amount: number | null
          commission_percent: number | null
          created_at: string | null
          date_paid: string | null
          id: string
          month: string
          notes: string | null
          paid: boolean | null
          received_report: boolean | null
          total_sales: number | null
          updated_at: string | null
          year: number
        }
        Insert: {
          commission_amount?: number | null
          commission_percent?: number | null
          created_at?: string | null
          date_paid?: string | null
          id?: string
          month: string
          notes?: string | null
          paid?: boolean | null
          received_report?: boolean | null
          total_sales?: number | null
          updated_at?: string | null
          year: number
        }
        Update: {
          commission_amount?: number | null
          commission_percent?: number | null
          created_at?: string | null
          date_paid?: string | null
          id?: string
          month?: string
          notes?: string | null
          paid?: boolean | null
          received_report?: boolean | null
          total_sales?: number | null
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      cash_pickups: {
        Row: {
          amount: number
          atm_id: string | null
          atm_profile_id: string | null
          city: string | null
          created_at: string | null
          deposit_date: string | null
          deposit_id: string | null
          deposited: boolean | null
          id: string
          notes: string | null
          person_id: string | null
          pickup_date: string
        }
        Insert: {
          amount: number
          atm_id?: string | null
          atm_profile_id?: string | null
          city?: string | null
          created_at?: string | null
          deposit_date?: string | null
          deposit_id?: string | null
          deposited?: boolean | null
          id?: string
          notes?: string | null
          person_id?: string | null
          pickup_date: string
        }
        Update: {
          amount?: number
          atm_id?: string | null
          atm_profile_id?: string | null
          city?: string | null
          created_at?: string | null
          deposit_date?: string | null
          deposit_id?: string | null
          deposited?: boolean | null
          id?: string
          notes?: string | null
          person_id?: string | null
          pickup_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_pickups_atm_profile_id_fkey"
            columns: ["atm_profile_id"]
            isOneToOne: false
            referencedRelation: "atm_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_pickups_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_details: {
        Row: {
          atm_id: string
          bitstop_fees: number
          cash_fee: number
          cash_management_rep: number
          cash_management_rps: number
          commission_amount: number
          commission_id: string
          created_at: string | null
          id: string
          net_profit: number
          rent: number
          total_fees: number
          total_sales: number
        }
        Insert: {
          atm_id: string
          bitstop_fees?: number
          cash_fee?: number
          cash_management_rep?: number
          cash_management_rps?: number
          commission_amount?: number
          commission_id: string
          created_at?: string | null
          id?: string
          net_profit?: number
          rent?: number
          total_fees?: number
          total_sales?: number
        }
        Update: {
          atm_id?: string
          bitstop_fees?: number
          cash_fee?: number
          cash_management_rep?: number
          cash_management_rps?: number
          commission_amount?: number
          commission_id?: string
          created_at?: string | null
          id?: string
          net_profit?: number
          rent?: number
          total_fees?: number
          total_sales?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_details_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commissions"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          atm_count: number
          bitstop_fees: number
          commission_amount: number
          created_at: string | null
          flat_fee_amount: number
          id: string
          mgmt_rep: number
          mgmt_rps: number
          month_year: string
          notes: string | null
          paid: boolean | null
          paid_date: string | null
          rent: number
          sales_rep_id: string
          total_commission: number
          total_fees: number
          total_net_profit: number
          total_sales: number
          updated_at: string | null
        }
        Insert: {
          atm_count?: number
          bitstop_fees?: number
          commission_amount?: number
          created_at?: string | null
          flat_fee_amount?: number
          id?: string
          mgmt_rep?: number
          mgmt_rps?: number
          month_year: string
          notes?: string | null
          paid?: boolean | null
          paid_date?: string | null
          rent?: number
          sales_rep_id: string
          total_commission?: number
          total_fees?: number
          total_net_profit?: number
          total_sales?: number
          updated_at?: string | null
        }
        Update: {
          atm_count?: number
          bitstop_fees?: number
          commission_amount?: number
          created_at?: string | null
          flat_fee_amount?: number
          id?: string
          mgmt_rep?: number
          mgmt_rps?: number
          month_year?: string
          notes?: string | null
          paid?: boolean | null
          paid_date?: string | null
          rent?: number
          sales_rep_id?: string
          total_commission?: number
          total_fees?: number
          total_net_profit?: number
          total_sales?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commissions_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          amount: number
          created_at: string | null
          deposit_date: string
          deposit_id: string
          id: string
          notes: string | null
          person_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          deposit_date: string
          deposit_id: string
          id?: string
          notes?: string | null
          person_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          deposit_date?: string
          deposit_id?: string
          id?: string
          notes?: string | null
          person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      sales_reps: {
        Row: {
          active: boolean | null
          commission_percentage: number
          created_at: string | null
          email: string | null
          flat_monthly_fee: number
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          commission_percentage?: number
          created_at?: string | null
          email?: string | null
          flat_monthly_fee?: number
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          commission_percentage?: number
          created_at?: string | null
          email?: string | null
          flat_monthly_fee?: number
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ticker_mappings: {
        Row: {
          created_at: string | null
          display_value: string | null
          fee_percentage: number | null
          id: string
          original_value: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_value?: string | null
          fee_percentage?: number | null
          id?: string
          original_value: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_value?: string | null
          fee_percentage?: number | null
          id?: string
          original_value?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          atm_id: string | null
          atm_name: string | null
          bitstop_fee: number | null
          created_at: string
          customer_city: string | null
          customer_first_name: string | null
          customer_id: string | null
          customer_last_name: string | null
          customer_state: string | null
          date: string | null
          fee: number | null
          id: string
          location_name: string | null
          platform: string | null
          sale: number | null
          sent: number | null
          ticker: string | null
          upload_id: string | null
        }
        Insert: {
          atm_id?: string | null
          atm_name?: string | null
          bitstop_fee?: number | null
          created_at?: string
          customer_city?: string | null
          customer_first_name?: string | null
          customer_id?: string | null
          customer_last_name?: string | null
          customer_state?: string | null
          date?: string | null
          fee?: number | null
          id: string
          location_name?: string | null
          platform?: string | null
          sale?: number | null
          sent?: number | null
          ticker?: string | null
          upload_id?: string | null
        }
        Update: {
          atm_id?: string | null
          atm_name?: string | null
          bitstop_fee?: number | null
          created_at?: string
          customer_city?: string | null
          customer_first_name?: string | null
          customer_id?: string | null
          customer_last_name?: string | null
          customer_state?: string | null
          date?: string | null
          fee?: number | null
          id?: string
          location_name?: string | null
          platform?: string | null
          sale?: number | null
          sent?: number | null
          ticker?: string | null
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          created_at: string
          filename: string
          id: string
          platform: string
          record_count: number | null
          status: string | null
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          platform: string
          record_count?: number | null
          status?: string | null
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          platform?: string
          record_count?: number | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
