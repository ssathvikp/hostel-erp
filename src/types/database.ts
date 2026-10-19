export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          actor_email: string;
          actor_id: string;
          created_at: string;
          details: NonNullable<Json>;
          hostel_id: string | null;
          hostel_name: string | null;
          id: number;
          reason: string | null;
          target_email: string | null;
          target_user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_email: string;
          actor_id: string;
          created_at?: string;
          details?: NonNullable<Json>;
          hostel_id?: string | null;
          hostel_name?: string | null;
          id?: never;
          reason?: string | null;
          target_email?: string | null;
          target_user_id?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string;
          actor_id?: string;
          created_at?: string;
          details?: NonNullable<Json>;
          hostel_id?: string | null;
          hostel_name?: string | null;
          id?: never;
          reason?: string | null;
          target_email?: string | null;
          target_user_id?: string | null;
        };
        Relationships: [];
      };
      allocation_events: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_name: string | null;
          allocation_id: string;
          bed_id: string;
          created_at: string;
          effective_date: string;
          hostel_id: string;
          id: number;
          new_state: NonNullable<Json>;
          previous_state: Json | null;
          resident_id: string;
          room_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_name?: string | null;
          allocation_id: string;
          bed_id: string;
          created_at?: string;
          effective_date: string;
          hostel_id: string;
          id?: never;
          new_state: NonNullable<Json>;
          previous_state?: Json | null;
          resident_id: string;
          room_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          allocation_id?: string;
          bed_id?: string;
          created_at?: string;
          effective_date?: string;
          hostel_id?: string;
          id?: never;
          new_state?: NonNullable<Json>;
          previous_state?: Json | null;
          resident_id?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "allocation_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "allocation_events_allocation_fkey";
            columns: ["hostel_id", "allocation_id"];
            isOneToOne: false;
            referencedRelation: "allocations";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocation_events_bed_fkey";
            columns: ["hostel_id", "bed_id"];
            isOneToOne: false;
            referencedRelation: "bed_states";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocation_events_bed_fkey";
            columns: ["hostel_id", "bed_id"];
            isOneToOne: false;
            referencedRelation: "beds";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocation_events_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "allocation_events_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocation_events_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocation_events_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "room_inventory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocation_events_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      allocation_fee_opt_outs: {
        Row: {
          allocation_id: string;
          created_at: string;
          head_id: string;
          hostel_id: string;
        };
        ComputedFields: never;
        Insert: {
          allocation_id: string;
          created_at?: string;
          head_id: string;
          hostel_id: string;
        };
        Update: {
          allocation_id?: string;
          created_at?: string;
          head_id?: string;
          hostel_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "allocation_fee_opt_outs_allocation_fkey";
            columns: ["hostel_id", "allocation_id"];
            isOneToOne: false;
            referencedRelation: "allocations";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocation_fee_opt_outs_head_fkey";
            columns: ["hostel_id", "head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      allocations: {
        Row: {
          bed_id: string;
          created_at: string;
          created_by: string;
          end_date: string | null;
          hostel_id: string;
          id: string;
          rent_override: number | null;
          resident_id: string;
          room_id: string;
          start_date: string;
          updated_at: string;
          vacate_reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          bed_id: string;
          created_at?: string;
          created_by?: string;
          end_date?: string | null;
          hostel_id: string;
          id?: string;
          rent_override?: number | null;
          resident_id: string;
          room_id: string;
          start_date: string;
          updated_at?: string;
          vacate_reason?: string | null;
        };
        Update: {
          bed_id?: string;
          created_at?: string;
          created_by?: string;
          end_date?: string | null;
          hostel_id?: string;
          id?: string;
          rent_override?: number | null;
          resident_id?: string;
          room_id?: string;
          start_date?: string;
          updated_at?: string;
          vacate_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "allocations_bed_fkey";
            columns: ["hostel_id", "bed_id"];
            isOneToOne: false;
            referencedRelation: "bed_states";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocations_bed_fkey";
            columns: ["hostel_id", "bed_id"];
            isOneToOne: false;
            referencedRelation: "beds";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocations_bed_in_room_fkey";
            columns: ["room_id", "bed_id"];
            isOneToOne: false;
            referencedRelation: "bed_states";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "allocations_bed_in_room_fkey";
            columns: ["room_id", "bed_id"];
            isOneToOne: false;
            referencedRelation: "beds";
            referencedColumns: ["room_id", "id"];
          },
          {
            foreignKeyName: "allocations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "allocations_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "allocations_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocations_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocations_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "room_inventory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "allocations_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      announcement_dismissals: {
        Row: {
          announcement_id: string;
          dismissed_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          announcement_id: string;
          dismissed_at?: string;
          user_id: string;
        };
        Update: {
          announcement_id?: string;
          dismissed_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcement_dismissals_announcement_id_fkey";
            columns: ["announcement_id"];
            isOneToOne: false;
            referencedRelation: "announcements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcement_dismissals_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      announcements: {
        Row: {
          created_at: string;
          created_by: string | null;
          ends_at: string | null;
          id: string;
          message: string;
          severity: string;
          starts_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          message: string;
          severity?: string;
          starts_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          message?: string;
          severity?: string;
          starts_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      beds: {
        Row: {
          archived_at: string | null;
          bed_label: string;
          created_at: string;
          hostel_id: string;
          id: string;
          room_id: string;
          status: string;
          status_changed_at: string | null;
          status_changed_by: string | null;
          status_reason: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          bed_label: string;
          created_at?: string;
          hostel_id: string;
          id?: string;
          room_id: string;
          status?: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          bed_label?: string;
          created_at?: string;
          hostel_id?: string;
          id?: string;
          room_id?: string;
          status?: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "beds_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "room_inventory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "beds_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "beds_status_changed_by_fkey";
            columns: ["status_changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      data_rights_log: {
        Row: {
          action: string;
          done_at: string;
          done_by: string;
          done_by_name: string | null;
          hostel_id: string;
          id: string;
          reason: string | null;
          resident_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          done_at?: string;
          done_by?: string;
          done_by_name?: string | null;
          hostel_id: string;
          id?: string;
          reason?: string | null;
          resident_id: string;
        };
        Update: {
          action?: string;
          done_at?: string;
          done_by?: string;
          done_by_name?: string | null;
          hostel_id?: string;
          id?: string;
          reason?: string | null;
          resident_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "data_rights_log_done_by_fkey";
            columns: ["done_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "data_rights_log_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "data_rights_log_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "data_rights_log_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      deposit_entries: {
        Row: {
          allocation_id: string | null;
          amount: number;
          created_at: string;
          entry_date: string;
          hostel_id: string;
          id: string;
          kind: string;
          mode: string | null;
          reason: string | null;
          recorded_by: string;
          recorded_by_name: string | null;
          reference: string | null;
          resident_id: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          allocation_id?: string | null;
          amount: number;
          created_at?: string;
          entry_date: string;
          hostel_id: string;
          id?: string;
          kind: string;
          mode?: string | null;
          reason?: string | null;
          recorded_by?: string;
          recorded_by_name?: string | null;
          reference?: string | null;
          resident_id: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          allocation_id?: string | null;
          amount?: number;
          created_at?: string;
          entry_date?: string;
          hostel_id?: string;
          id?: string;
          kind?: string;
          mode?: string | null;
          reason?: string | null;
          recorded_by?: string;
          recorded_by_name?: string | null;
          reference?: string | null;
          resident_id?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "deposit_entries_allocation_fkey";
            columns: ["hostel_id", "allocation_id"];
            isOneToOne: false;
            referencedRelation: "allocations";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_entries_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deposit_entries_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deposit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_entries_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      deposit_rates: {
        Row: {
          amount: number;
          hostel_id: string;
          sharing_type: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          hostel_id: string;
          sharing_type: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          hostel_id?: string;
          sharing_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deposit_rates_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      document_counters: {
        Row: {
          fiscal_year: string;
          hostel_id: string;
          last_number: number;
          series: string;
        };
        ComputedFields: never;
        Insert: {
          fiscal_year: string;
          hostel_id: string;
          last_number: number;
          series: string;
        };
        Update: {
          fiscal_year?: string;
          hostel_id?: string;
          last_number?: number;
          series?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_counters_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      electricity_bills: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string | null;
          hostel_id: string;
          id: string;
          period_month: string;
          rate: number;
          room_id: string;
          units: number;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string | null;
          hostel_id: string;
          id?: string;
          period_month: string;
          rate: number;
          room_id: string;
          units: number;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          hostel_id?: string;
          id?: string;
          period_month?: string;
          rate?: number;
          room_id?: string;
          units?: number;
        };
        Relationships: [
          {
            foreignKeyName: "electricity_bills_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "electricity_bills_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "room_inventory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "electricity_bills_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      fee_head_prices: {
        Row: {
          amount: number;
          created_at: string;
          effective_from: string;
          effective_to: string | null;
          head_id: string;
          hostel_id: string;
          id: string;
          sharing_type: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          effective_from: string;
          effective_to?: string | null;
          head_id: string;
          hostel_id: string;
          id?: string;
          sharing_type?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          head_id?: string;
          hostel_id?: string;
          id?: string;
          sharing_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fee_head_prices_head_fkey";
            columns: ["hostel_id", "head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      fee_heads: {
        Row: {
          archived_at: string | null;
          created_at: string;
          hostel_id: string;
          id: string;
          kind: string;
          name: string;
          on_first_allocation: boolean;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          hostel_id: string;
          id?: string;
          kind: string;
          name: string;
          on_first_allocation?: boolean;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          hostel_id?: string;
          id?: string;
          kind?: string;
          name?: string;
          on_first_allocation?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "fee_heads_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_structures: {
        Row: {
          created_at: string;
          created_by: string | null;
          effective_from: string;
          effective_to: string | null;
          hostel_id: string;
          id: string;
          monthly_amount: number;
          sharing_type: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          effective_to?: string | null;
          hostel_id: string;
          id?: string;
          monthly_amount: number;
          sharing_type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          effective_to?: string | null;
          hostel_id?: string;
          id?: string;
          monthly_amount?: number;
          sharing_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_structures_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_structures_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      hostels: {
        Row: {
          address: string | null;
          alt_phone: string | null;
          city: string | null;
          created_at: string;
          electricity_unit_rate: number | null;
          email: string | null;
          floors: number | null;
          gstin: string | null;
          id: string;
          late_fee_amount: number | null;
          late_fee_cap: number | null;
          late_fee_grace_days: number;
          late_fee_mode: string;
          late_fee_since: string | null;
          name: string;
          owner_id: string;
          phone: string;
          pincode: string | null;
          plan: string;
          reminder_template: string | null;
          slug: string;
          state: string | null;
          status: string;
          suspension_reason: string | null;
          trial_ends_at: string | null;
          type: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          alt_phone?: string | null;
          city?: string | null;
          created_at?: string;
          electricity_unit_rate?: number | null;
          email?: string | null;
          floors?: number | null;
          gstin?: string | null;
          id?: string;
          late_fee_amount?: number | null;
          late_fee_cap?: number | null;
          late_fee_grace_days?: number;
          late_fee_mode?: string;
          late_fee_since?: string | null;
          name: string;
          owner_id?: string;
          phone: string;
          pincode?: string | null;
          plan?: string;
          reminder_template?: string | null;
          slug?: string;
          state?: string | null;
          status?: string;
          suspension_reason?: string | null;
          trial_ends_at?: string | null;
          type: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          alt_phone?: string | null;
          city?: string | null;
          created_at?: string;
          electricity_unit_rate?: number | null;
          email?: string | null;
          floors?: number | null;
          gstin?: string | null;
          id?: string;
          late_fee_amount?: number | null;
          late_fee_cap?: number | null;
          late_fee_grace_days?: number;
          late_fee_mode?: string;
          late_fee_since?: string | null;
          name?: string;
          owner_id?: string;
          phone?: string;
          pincode?: string | null;
          plan?: string;
          reminder_template?: string | null;
          slug?: string;
          state?: string | null;
          status?: string;
          suspension_reason?: string | null;
          trial_ends_at?: string | null;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hostels_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_lines: {
        Row: {
          amount: number;
          charge_id: string | null;
          description: string;
          details: NonNullable<Json>;
          discount_id: string | null;
          head_id: string | null;
          hostel_id: string;
          id: string;
          invoice_id: string;
          kind: string;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          charge_id?: string | null;
          description: string;
          details?: NonNullable<Json>;
          discount_id?: string | null;
          head_id?: string | null;
          hostel_id: string;
          id?: string;
          invoice_id: string;
          kind: string;
          position: number;
        };
        Update: {
          amount?: number;
          charge_id?: string | null;
          description?: string;
          details?: NonNullable<Json>;
          discount_id?: string | null;
          head_id?: string | null;
          hostel_id?: string;
          id?: string;
          invoice_id?: string;
          kind?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_lines_charge_fkey";
            columns: ["hostel_id", "charge_id"];
            isOneToOne: false;
            referencedRelation: "resident_charges";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoice_lines_discount_fkey";
            columns: ["hostel_id", "discount_id"];
            isOneToOne: false;
            referencedRelation: "resident_discounts";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoice_lines_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoice_lines_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      invoices: {
        Row: {
          allocation_id: string | null;
          amount: number;
          breakdown: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          due_date: string;
          hostel_id: string;
          id: string;
          invoice_number: string;
          kind: string;
          late_fee_for: string | null;
          period_month: string;
          resident_id: string;
          status: string;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          allocation_id?: string | null;
          amount: number;
          breakdown?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          due_date: string;
          hostel_id: string;
          id?: string;
          invoice_number?: string;
          kind?: string;
          late_fee_for?: string | null;
          period_month: string;
          resident_id: string;
          status?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          allocation_id?: string | null;
          amount?: number;
          breakdown?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          due_date?: string;
          hostel_id?: string;
          id?: string;
          invoice_number?: string;
          kind?: string;
          late_fee_for?: string | null;
          period_month?: string;
          resident_id?: string;
          status?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_allocation_fkey";
            columns: ["hostel_id", "allocation_id"];
            isOneToOne: false;
            referencedRelation: "allocations";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_late_fee_source_fkey";
            columns: ["hostel_id", "late_fee_for"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_late_fee_source_fkey";
            columns: ["hostel_id", "late_fee_for"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          cheque_bank: string | null;
          cheque_number: string | null;
          cleared_at: string | null;
          cleared_by: string | null;
          created_at: string;
          hostel_id: string;
          id: string;
          invoice_id: string;
          mode: string;
          paid_at: string;
          receipt_number: string;
          recorded_by: string;
          recorded_by_name: string | null;
          reference: string | null;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          cheque_bank?: string | null;
          cheque_number?: string | null;
          cleared_at?: string | null;
          cleared_by?: string | null;
          created_at?: string;
          hostel_id: string;
          id?: string;
          invoice_id: string;
          mode: string;
          paid_at: string;
          receipt_number?: string;
          recorded_by?: string;
          recorded_by_name?: string | null;
          reference?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          cheque_bank?: string | null;
          cheque_number?: string | null;
          cleared_at?: string | null;
          cleared_by?: string | null;
          created_at?: string;
          hostel_id?: string;
          id?: string;
          invoice_id?: string;
          mode?: string;
          paid_at?: string;
          receipt_number?: string;
          recorded_by?: string;
          recorded_by_name?: string | null;
          reference?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_cleared_by_fkey";
            columns: ["cleared_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "payments_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "payments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_events: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          hostel_id: string;
          id: number;
          plan: string;
          trial_ends_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          hostel_id: string;
          id?: never;
          plan: string;
          trial_ends_at?: string | null;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          hostel_id?: string;
          id?: never;
          plan?: string;
          trial_ends_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plan_events_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_events_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          id: boolean;
          trial_days: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          id?: boolean;
          trial_days?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: boolean;
          trial_days?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          deactivated_at: string | null;
          full_name: string;
          hostel_id: string | null;
          id: string;
          phone: string | null;
          referral_code: string | null;
          referred_by: string | null;
          role: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          deactivated_at?: string | null;
          full_name: string;
          hostel_id?: string | null;
          id: string;
          phone?: string | null;
          referral_code?: string | null;
          referred_by?: string | null;
          role?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deactivated_at?: string | null;
          full_name?: string;
          hostel_id?: string | null;
          id?: string;
          phone?: string | null;
          referral_code?: string | null;
          referred_by?: string | null;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_referred_by_fkey";
            columns: ["referred_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      reminder_log: {
        Row: {
          amount: number;
          channel: string;
          hostel_id: string;
          id: string;
          invoice_id: string | null;
          kind: string;
          resident_id: string;
          sent_at: string;
          sent_by: string;
          sent_by_name: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          channel: string;
          hostel_id: string;
          id?: string;
          invoice_id?: string | null;
          kind: string;
          resident_id: string;
          sent_at?: string;
          sent_by?: string;
          sent_by_name?: string | null;
        };
        Update: {
          amount?: number;
          channel?: string;
          hostel_id?: string;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          resident_id?: string;
          sent_at?: string;
          sent_by?: string;
          sent_by_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "reminder_log_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_log_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "reminder_log_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "reminder_log_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "reminder_log_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "reminder_log_sent_by_fkey";
            columns: ["sent_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      resident_charges: {
        Row: {
          amount: number;
          category: string;
          charge_date: string;
          created_at: string;
          created_by: string | null;
          description: string;
          details: NonNullable<Json>;
          head_id: string | null;
          hostel_id: string;
          id: string;
          invoice_id: string | null;
          resident_id: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          category?: string;
          charge_date: string;
          created_at?: string;
          created_by?: string | null;
          description: string;
          details?: NonNullable<Json>;
          head_id?: string | null;
          hostel_id: string;
          id?: string;
          invoice_id?: string | null;
          resident_id: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          category?: string;
          charge_date?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          details?: NonNullable<Json>;
          head_id?: string | null;
          hostel_id?: string;
          id?: string;
          invoice_id?: string | null;
          resident_id?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "resident_charges_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_charges_head_fkey";
            columns: ["hostel_id", "head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      resident_credit_entries: {
        Row: {
          amount: number;
          created_at: string;
          entry_date: string;
          hostel_id: string;
          id: string;
          invoice_id: string | null;
          kind: string;
          mode: string | null;
          payment_id: string | null;
          recorded_by: string;
          reference: string | null;
          resident_id: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          entry_date: string;
          hostel_id: string;
          id?: string;
          invoice_id?: string | null;
          kind: string;
          mode?: string | null;
          payment_id?: string | null;
          recorded_by?: string;
          reference?: string | null;
          resident_id: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          entry_date?: string;
          hostel_id?: string;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          mode?: string | null;
          payment_id?: string | null;
          recorded_by?: string;
          reference?: string | null;
          resident_id?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "resident_credit_entries_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_entries_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_entries_payment_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_credit_entries_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_credit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_entries_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      resident_discounts: {
        Row: {
          created_at: string;
          created_by: string | null;
          from_month: string;
          head_id: string | null;
          hostel_id: string;
          id: string;
          kind: string;
          reason: string;
          resident_id: string;
          to_month: string | null;
          value: number;
          void_reason: string | null;
          voided_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          from_month: string;
          head_id?: string | null;
          hostel_id: string;
          id?: string;
          kind: string;
          reason: string;
          resident_id: string;
          to_month?: string | null;
          value: number;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          from_month?: string;
          head_id?: string | null;
          hostel_id?: string;
          id?: string;
          kind?: string;
          reason?: string;
          resident_id?: string;
          to_month?: string | null;
          value?: number;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "resident_discounts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_discounts_head_fkey";
            columns: ["hostel_id", "head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_discounts_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_discounts_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      residents: {
        Row: {
          alt_phone: string | null;
          consent_at: string | null;
          consent_recorded_by: string | null;
          created_at: string;
          created_by: string | null;
          dob: string | null;
          email: string | null;
          erased_at: string | null;
          erased_by: string | null;
          full_name: string;
          gender: string;
          guardian_name: string | null;
          guardian_phone: string | null;
          hostel_id: string;
          id: string;
          id_proof_hash: string | null;
          id_proof_last4: string | null;
          id_proof_path: string | null;
          id_proof_type: string;
          joining_date: string;
          notes: string | null;
          permanent_address: string | null;
          phone: string | null;
          status: string;
          status_changed_at: string | null;
          status_changed_by: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          alt_phone?: string | null;
          consent_at?: string | null;
          consent_recorded_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          dob?: string | null;
          email?: string | null;
          erased_at?: string | null;
          erased_by?: string | null;
          full_name: string;
          gender: string;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          hostel_id: string;
          id?: string;
          id_proof_hash?: string | null;
          id_proof_last4?: string | null;
          id_proof_path?: string | null;
          id_proof_type: string;
          joining_date: string;
          notes?: string | null;
          permanent_address?: string | null;
          phone?: string | null;
          status?: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          updated_at?: string;
        };
        Update: {
          alt_phone?: string | null;
          consent_at?: string | null;
          consent_recorded_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          dob?: string | null;
          email?: string | null;
          erased_at?: string | null;
          erased_by?: string | null;
          full_name?: string;
          gender?: string;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          hostel_id?: string;
          id?: string;
          id_proof_hash?: string | null;
          id_proof_last4?: string | null;
          id_proof_path?: string | null;
          id_proof_type?: string;
          joining_date?: string;
          notes?: string | null;
          permanent_address?: string | null;
          phone?: string | null;
          status?: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "residents_consent_recorded_by_fkey";
            columns: ["consent_recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "residents_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "residents_erased_by_fkey";
            columns: ["erased_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "residents_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "residents_status_changed_by_fkey";
            columns: ["status_changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      room_meter_readings: {
        Row: {
          created_at: string;
          hostel_id: string;
          id: string;
          reading: number;
          reading_month: string;
          recorded_by: string;
          room_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          hostel_id: string;
          id?: string;
          reading: number;
          reading_month: string;
          recorded_by?: string;
          room_id: string;
        };
        Update: {
          created_at?: string;
          hostel_id?: string;
          id?: string;
          reading?: number;
          reading_month?: string;
          recorded_by?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_meter_readings_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_meter_readings_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "room_inventory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "room_meter_readings_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      rooms: {
        Row: {
          capacity: number;
          created_at: string;
          floor: number;
          hostel_id: string;
          id: string;
          room_number: string;
          sharing_type: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          capacity: number;
          created_at?: string;
          floor: number;
          hostel_id: string;
          id?: string;
          room_number: string;
          sharing_type: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          capacity?: number;
          created_at?: string;
          floor?: number;
          hostel_id?: string;
          id?: string;
          room_number?: string;
          sharing_type?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rooms_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_invitations: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          full_name: string;
          hostel_id: string;
          id: string;
          invited_at: string;
          invited_by: string;
          profile_id: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          full_name: string;
          hostel_id: string;
          id?: string;
          invited_at?: string;
          invited_by: string;
          profile_id?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          hostel_id?: string;
          id?: string;
          invited_at?: string;
          invited_by?: string;
          profile_id?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_invitations_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_invitations_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_invitations_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_access: {
        Row: {
          admin_id: string;
          admin_name: string;
          expires_at: string;
          hostel_id: string;
          id: string;
          opened_at: string;
          reason: string;
        };
        ComputedFields: never;
        Insert: {
          admin_id: string;
          admin_name: string;
          expires_at?: string;
          hostel_id: string;
          id?: string;
          opened_at?: string;
          reason: string;
        };
        Update: {
          admin_id?: string;
          admin_name?: string;
          expires_at?: string;
          hostel_id?: string;
          id?: string;
          opened_at?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_access_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      bed_states: {
        Row: {
          bed_label: string | null;
          hostel_id: string | null;
          id: string | null;
          manual_status: string | null;
          room_id: string | null;
          status: string | null;
          status_changed_at: string | null;
          status_changed_by: string | null;
          status_reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          bed_label?: string | null;
          hostel_id?: string | null;
          id?: string | null;
          manual_status?: string | null;
          room_id?: string | null;
          status?: never;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
        };
        Update: {
          bed_label?: string | null;
          hostel_id?: string | null;
          id?: string | null;
          manual_status?: string | null;
          room_id?: string | null;
          status?: never;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "beds_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "room_inventory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "beds_room_fkey";
            columns: ["hostel_id", "room_id"];
            isOneToOne: false;
            referencedRelation: "rooms";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "beds_status_changed_by_fkey";
            columns: ["status_changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_balances: {
        Row: {
          held: number | null;
          hostel_id: string | null;
          resident_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "resident_credit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      deposit_balances: {
        Row: {
          collected: number | null;
          deducted: number | null;
          held: number | null;
          hostel_id: string | null;
          refunded: number | null;
          resident_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "deposit_entries_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deposit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_entries_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      floor_occupancy: {
        Row: {
          floor: number | null;
          hostel_id: string | null;
          occupied_beds: number | null;
          out_of_service_beds: number | null;
          rooms: number | null;
          total_beds: number | null;
          vacant_beds: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "rooms_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_occupancy: {
        Row: {
          hostel_id: string | null;
          occupied_beds: number | null;
          out_of_service_beds: number | null;
          rooms: number | null;
          total_beds: number | null;
          vacant_beds: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "rooms_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_balances: {
        Row: {
          allocation_id: string | null;
          amount: number | null;
          balance: number | null;
          bed_label: string | null;
          created_at: string | null;
          due_date: string | null;
          due_status: string | null;
          hostel_id: string | null;
          id: string | null;
          invoice_number: string | null;
          kind: string | null;
          late_fee_for: string | null;
          paid: number | null;
          pending_cheques: number | null;
          period_month: string | null;
          resident_email: string | null;
          resident_id: string | null;
          resident_name: string | null;
          resident_phone: string | null;
          room_id: string | null;
          room_number: string | null;
          room_sort: string | null;
          status: string | null;
          void_reason: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "invoices_allocation_fkey";
            columns: ["hostel_id", "allocation_id"];
            isOneToOne: false;
            referencedRelation: "allocations";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_late_fee_source_fkey";
            columns: ["hostel_id", "late_fee_for"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_late_fee_source_fkey";
            columns: ["hostel_id", "late_fee_for"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      last_reminders: {
        Row: {
          channel: string | null;
          hostel_id: string | null;
          resident_id: string | null;
          sent_at: string | null;
          sent_by_name: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "reminder_log_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminder_log_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "reminder_log_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      resident_balances: {
        Row: {
          hostel_id: string | null;
          invoiced: number | null;
          oldest_overdue_due_date: string | null;
          open_invoices: number | null;
          outstanding: number | null;
          overdue: number | null;
          paid: number | null;
          resident_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "invoices_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoices_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      resident_directory: {
        Row: {
          bed_label: string | null;
          created_at: string | null;
          full_name: string | null;
          hostel_id: string | null;
          id: string | null;
          joining_date: string | null;
          phone: string | null;
          room_id: string | null;
          room_number: string | null;
          status: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "residents_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      room_inventory: {
        Row: {
          available_beds: number | null;
          capacity: number | null;
          created_at: string | null;
          floor: number | null;
          hostel_id: string | null;
          id: string | null;
          occupied_beds: number | null;
          out_of_service_beds: number | null;
          room_number: string | null;
          room_sort: string | null;
          sharing_type: string | null;
          status: string | null;
          total_beds: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "rooms_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      account_by_email: {
        Args: { p_email: string };
        Returns: {
          deactivated: boolean;
          email_confirmed: boolean;
          hostel_id: string;
          role: string;
          user_id: string;
        }[];
      };
      account_sign_out: { Args: { p_user_id: string }; Returns: undefined };
      admin_announcements: {
        Args: Record<PropertyKey, never>;
        Returns: {
          created_at: string;
          dismissals: number;
          ends_at: string;
          id: string;
          message: string;
          severity: string;
          starts_at: string;
        }[];
      };
      admin_audit_entries: {
        Args: {
          p_actor_id?: string;
          p_from?: string;
          p_hostel_id?: string;
          p_limit?: number;
          p_offset?: number;
          p_target_user_id?: string;
          p_to?: string;
        };
        Returns: {
          action: string;
          actor_email: string;
          created_at: string;
          details: Json;
          hostel_id: string;
          hostel_name: string;
          id: number;
          reason: string;
          target_email: string;
          total: number;
        }[];
      };
      admin_create_announcement: {
        Args: { p_ends_at?: string; p_message: string; p_severity: string; p_starts_at?: string };
        Returns: string;
      };
      admin_end_announcement: { Args: { p_id: string }; Returns: undefined };
      admin_hostels: {
        Args: Record<PropertyKey, never>;
        Returns: {
          allocations_ever: number;
          beds: number;
          city: string;
          collected_this_month: number;
          created_at: string;
          first_invoice_on: string;
          first_payment_on: string;
          id: string;
          invoices_this_month: number;
          last_activity_at: string;
          name: string;
          occupied_beds: number;
          owner_email: string;
          owner_hostels: number;
          owner_name: string;
          paying_referrals: number;
          plan: string;
          rates_set: boolean;
          referrals: number;
          referred_by_name: string;
          residents: number;
          rooms: number;
          staff: number;
          status: string;
          suspension_reason: string;
          trial_ends_at: string;
        }[];
      };
      admin_list_admins: {
        Args: Record<PropertyKey, never>;
        Returns: {
          email: string;
          full_name: string;
          id: string;
        }[];
      };
      admin_metrics: { Args: Record<PropertyKey, never>; Returns: Json };
      admin_open_support_view: { Args: { p_hostel_id: string; p_reason: string }; Returns: string };
      admin_owners: {
        Args: { p_limit?: number; p_offset?: number; p_owner_id?: string; p_search?: string };
        Returns: {
          active_hostels: number;
          created_at: string;
          draft_hostels: number;
          email: string;
          email_confirmed_at: string;
          full_name: string;
          hostels: number;
          id: string;
          last_sign_in_at: string;
          phone: string;
          referred_by_name: string;
          total: number;
        }[];
      };
      admin_record_email_action: {
        Args: { p_action: string; p_reason: string; p_user_id: string };
        Returns: undefined;
      };
      admin_set_plan: {
        Args: { p_hostel_id: string; p_plan: string; p_reason: string; p_trial_ends_at: string };
        Returns: undefined;
      };
      admin_set_suspended: {
        Args: { p_hostel_id: string; p_reason: string; p_suspend: boolean };
        Returns: undefined;
      };
      admin_set_trial_days: { Args: { p_days: number }; Returns: undefined };
      admin_sign_out_everywhere: {
        Args: { p_reason: string; p_user_id: string };
        Returns: undefined;
      };
      admin_support_snapshot: { Args: { p_hostel_id: string }; Returns: Json };
      allocate_bed: {
        Args: {
          p_bed_id: string;
          p_rent_override?: number;
          p_resident_id: string;
          p_start_date: string;
        };
        Returns: string;
      };
      apply_credit: { Args: { p_resident_id: string }; Returns: number };
      apply_late_fees: { Args: { p_hostel_id: string }; Returns: Json };
      bill_charges_now: { Args: { p_resident_id: string }; Returns: string };
      bill_electricity: { Args: { p_hostel_id: string; p_period_month: string }; Returns: Json };
      billed_months: { Args: { p_hostel_id: string }; Returns: string[] };
      clear_cheque: { Args: { p_payment_id: string }; Returns: undefined };
      create_rooms_bulk: {
        Args: {
          p_capacity: number;
          p_floor: number;
          p_from: number;
          p_hostel_id: string;
          p_sharing_type: string;
          p_to: number;
        };
        Returns: {
          beds_created: number;
          rooms_created: number;
        }[];
      };
      dashboard_money: {
        Args: { p_from: string; p_hostel_id: string; p_to: string };
        Returns: {
          billed: number;
          collected: number;
          invoices: number;
          outstanding: number;
          overdue: number;
          overdue_residents: number;
          payments: number;
        }[];
      };
      deposits_held_total: { Args: { p_hostel_id: string }; Returns: Json };
      erase_resident: { Args: { p_reason: string; p_resident_id: string }; Returns: undefined };
      fee_status_totals: {
        Args: { p_hostel_id: string; p_period_month?: string; p_room_id?: string };
        Returns: {
          amount: number;
          balance: number;
          due_status: string;
          invoices: number;
          paid: number;
        }[];
      };
      generate_invoices: {
        Args: { p_due_day?: number; p_hostel_id: string; p_period_month: string };
        Returns: Json;
      };
      import_residents: { Args: { p_hostel_id: string; p_residents: Json }; Returns: number };
      import_rooms: {
        Args: { p_hostel_id: string; p_rooms: Json };
        Returns: {
          beds_created: number;
          rooms_created: number;
        }[];
      };
      my_referral_code: { Args: Record<PropertyKey, never>; Returns: string };
      my_referrals: { Args: Record<PropertyKey, never>; Returns: Json };
      occupancy_trend: {
        Args: { p_from: string; p_granularity?: string; p_hostel_id: string; p_to: string };
        Returns: {
          bucket: string;
          days: number;
          occupancy_percent: number;
          occupied_beds: number;
          total_beds: number;
        }[];
      };
      record_payment: {
        Args: {
          p_amount: number;
          p_cheque_bank?: string;
          p_cheque_number?: string;
          p_invoice_id: string;
          p_mode: string;
          p_paid_at: string;
          p_reference?: string;
        };
        Returns: Json;
      };
      set_fee_head_price: {
        Args: {
          p_amount: number;
          p_effective_from: string;
          p_head_id: string;
          p_sharing_type?: string;
        };
        Returns: string;
      };
      set_fee_structure: {
        Args: {
          p_effective_from: string;
          p_hostel_id: string;
          p_monthly_amount: number;
          p_sharing_type: string;
        };
        Returns: string;
      };
      transfer_allocation: {
        Args: {
          p_allocation_id: string;
          p_move_date: string;
          p_new_bed_id: string;
          p_rent_override?: number;
        };
        Returns: string;
      };
      vacancy_cost: { Args: { p_hostel_id: string }; Returns: Json };
      vacate_allocation: {
        Args: {
          p_allocation_id: string;
          p_mark_vacated?: boolean;
          p_move_out_date: string;
          p_reason: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
