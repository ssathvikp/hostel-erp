export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
      deposit_amounts: {
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
            foreignKeyName: "deposit_amounts_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      deposit_ledger: {
        Row: {
          amount: number;
          created_at: string;
          hostel_id: string;
          id: string;
          invoice_id: string | null;
          kind: string;
          mode: string | null;
          note: string | null;
          number: string | null;
          paid_at: string;
          payment_id: string | null;
          recorded_by: string | null;
          reference: string | null;
          resident_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          hostel_id: string;
          id?: string;
          invoice_id?: string | null;
          kind: string;
          mode?: string | null;
          note?: string | null;
          number?: string | null;
          paid_at?: string;
          payment_id?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          resident_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          hostel_id?: string;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          mode?: string | null;
          note?: string | null;
          number?: string | null;
          paid_at?: string;
          payment_id?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          resident_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deposit_ledger_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deposit_ledger_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_ledger_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_ledger_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deposit_ledger_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_ledger_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      discounts: {
        Row: {
          amount: number | null;
          created_at: string;
          created_by: string | null;
          fee_head_id: string | null;
          from_month: string;
          hostel_id: string;
          id: string;
          percent: number | null;
          reason: string;
          resident_id: string;
          to_month: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount?: number | null;
          created_at?: string;
          created_by?: string | null;
          fee_head_id?: string | null;
          from_month: string;
          hostel_id: string;
          id?: string;
          percent?: number | null;
          reason: string;
          resident_id: string;
          to_month?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number | null;
          created_at?: string;
          created_by?: string | null;
          fee_head_id?: string | null;
          from_month?: string;
          hostel_id?: string;
          id?: string;
          percent?: number | null;
          reason?: string;
          resident_id?: string;
          to_month?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "discounts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "discounts_head_fkey";
            columns: ["hostel_id", "fee_head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "discounts_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "discounts_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "discounts_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      fee_head_rates: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          effective_to: string | null;
          fee_head_id: string;
          hostel_id: string;
          id: string;
          sharing_type: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          effective_to?: string | null;
          fee_head_id: string;
          hostel_id: string;
          id?: string;
          sharing_type?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          effective_to?: string | null;
          fee_head_id?: string;
          hostel_id?: string;
          id?: string;
          sharing_type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_head_rates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_head_rates_head_fkey";
            columns: ["hostel_id", "fee_head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      fee_heads: {
        Row: {
          active: boolean;
          billing: string;
          charge_on_first_stay: boolean;
          created_at: string;
          created_by: string | null;
          hostel_id: string;
          id: string;
          name: string;
          pricing: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          billing: string;
          charge_on_first_stay?: boolean;
          created_at?: string;
          created_by?: string | null;
          hostel_id: string;
          id?: string;
          name: string;
          pricing: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          billing?: string;
          charge_on_first_stay?: boolean;
          created_at?: string;
          created_by?: string | null;
          hostel_id?: string;
          id?: string;
          name?: string;
          pricing?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_heads_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
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
          email: string | null;
          floors: number | null;
          gstin: string | null;
          id: string;
          name: string;
          owner_id: string;
          phone: string;
          pincode: string | null;
          slug: string;
          state: string | null;
          status: string;
          type: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          alt_phone?: string | null;
          city?: string | null;
          created_at?: string;
          email?: string | null;
          floors?: number | null;
          gstin?: string | null;
          id?: string;
          name: string;
          owner_id?: string;
          phone: string;
          pincode?: string | null;
          slug?: string;
          state?: string | null;
          status?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          alt_phone?: string | null;
          city?: string | null;
          created_at?: string;
          email?: string | null;
          floors?: number | null;
          gstin?: string | null;
          id?: string;
          name?: string;
          owner_id?: string;
          phone?: string;
          pincode?: string | null;
          slug?: string;
          state?: string | null;
          status?: string;
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
          created_at: string;
          description: string;
          detail: NonNullable<Json>;
          discount_id: string | null;
          fee_head_id: string | null;
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
          created_at?: string;
          description: string;
          detail?: NonNullable<Json>;
          discount_id?: string | null;
          fee_head_id?: string | null;
          hostel_id: string;
          id?: string;
          invoice_id: string;
          kind: string;
          position: number;
        };
        Update: {
          amount?: number;
          charge_id?: string | null;
          created_at?: string;
          description?: string;
          detail?: NonNullable<Json>;
          discount_id?: string | null;
          fee_head_id?: string | null;
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
            referencedRelation: "discounts";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "invoice_lines_head_fkey";
            columns: ["hostel_id", "fee_head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
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
          kind: string;
          number: string;
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
          kind?: string;
          number?: string;
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
          kind?: string;
          number?: string;
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
      late_fee_rules: {
        Row: {
          active: boolean;
          amount: number;
          cap: number | null;
          grace_days: number;
          hostel_id: string;
          kind: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          amount: number;
          cap?: number | null;
          grace_days?: number;
          hostel_id: string;
          kind: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amount?: number;
          cap?: number | null;
          grace_days?: number;
          hostel_id?: string;
          kind?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "late_fee_rules_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: true;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          created_at: string;
          hostel_id: string;
          id: string;
          invoice_id: string;
          mode: string;
          number: string | null;
          paid_at: string;
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
          created_at?: string;
          hostel_id: string;
          id?: string;
          invoice_id: string;
          mode: string;
          number?: string | null;
          paid_at: string;
          recorded_by?: string;
          recorded_by_name?: string | null;
          reference?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          hostel_id?: string;
          id?: string;
          invoice_id?: string;
          mode?: string;
          number?: string | null;
          paid_at?: string;
          recorded_by?: string;
          recorded_by_name?: string | null;
          reference?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
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
      profiles: {
        Row: {
          created_at: string;
          full_name: string;
          hostel_id: string | null;
          id: string;
          phone: string | null;
          role: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          full_name: string;
          hostel_id?: string | null;
          id: string;
          phone?: string | null;
          role?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string;
          hostel_id?: string | null;
          id?: string;
          phone?: string | null;
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
        ];
      };
      resident_charges: {
        Row: {
          amount: number;
          charge_date: string;
          created_at: string;
          created_by: string | null;
          description: string;
          fee_head_id: string | null;
          for_invoice_id: string | null;
          hostel_id: string;
          id: string;
          invoice_id: string | null;
          kind: string;
          resident_id: string;
          status: string;
          updated_at: string;
          void_reason: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          charge_date: string;
          created_at?: string;
          created_by?: string | null;
          description: string;
          fee_head_id?: string | null;
          for_invoice_id?: string | null;
          hostel_id: string;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          resident_id: string;
          status?: string;
          updated_at?: string;
          void_reason?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount?: number;
          charge_date?: string;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          fee_head_id?: string | null;
          for_invoice_id?: string | null;
          hostel_id?: string;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          resident_id?: string;
          status?: string;
          updated_at?: string;
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
            foreignKeyName: "resident_charges_for_invoice_fkey";
            columns: ["hostel_id", "for_invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_for_invoice_fkey";
            columns: ["hostel_id", "for_invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_head_fkey";
            columns: ["hostel_id", "fee_head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_charges_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
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
      resident_credit: {
        Row: {
          amount: number;
          created_at: string;
          hostel_id: string;
          id: string;
          invoice_id: string | null;
          kind: string;
          mode: string | null;
          note: string | null;
          number: string | null;
          paid_at: string;
          payment_id: string | null;
          recorded_by: string | null;
          reference: string | null;
          resident_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          hostel_id: string;
          id?: string;
          invoice_id?: string | null;
          kind: string;
          mode?: string | null;
          note?: string | null;
          number?: string | null;
          paid_at?: string;
          payment_id?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          resident_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          hostel_id?: string;
          id?: string;
          invoice_id?: string | null;
          kind?: string;
          mode?: string | null;
          note?: string | null;
          number?: string | null;
          paid_at?: string;
          payment_id?: string | null;
          recorded_by?: string | null;
          reference?: string | null;
          resident_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resident_credit_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_credit_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoice_balances";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_invoice_fkey";
            columns: ["hostel_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_credit_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      resident_fee_exemptions: {
        Row: {
          created_at: string;
          created_by: string | null;
          fee_head_id: string;
          hostel_id: string;
          resident_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          fee_head_id: string;
          hostel_id: string;
          resident_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          fee_head_id?: string;
          hostel_id?: string;
          resident_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resident_fee_exemptions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_fee_exemptions_head_fkey";
            columns: ["hostel_id", "fee_head_id"];
            isOneToOne: false;
            referencedRelation: "fee_heads";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_fee_exemptions_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_fee_exemptions_resident_fkey";
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
          created_at: string;
          created_by: string | null;
          dob: string;
          email: string | null;
          full_name: string;
          gender: string;
          guardian_name: string | null;
          guardian_phone: string | null;
          hostel_id: string;
          id: string;
          id_proof_hash: string;
          id_proof_last4: string;
          id_proof_path: string | null;
          id_proof_type: string;
          joining_date: string;
          notes: string | null;
          permanent_address: string;
          phone: string;
          status: string;
          status_changed_at: string | null;
          status_changed_by: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          alt_phone?: string | null;
          created_at?: string;
          created_by?: string | null;
          dob: string;
          email?: string | null;
          full_name: string;
          gender: string;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          hostel_id: string;
          id?: string;
          id_proof_hash: string;
          id_proof_last4: string;
          id_proof_path?: string | null;
          id_proof_type: string;
          joining_date: string;
          notes?: string | null;
          permanent_address: string;
          phone: string;
          status?: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          updated_at?: string;
        };
        Update: {
          alt_phone?: string | null;
          created_at?: string;
          created_by?: string | null;
          dob?: string;
          email?: string | null;
          full_name?: string;
          gender?: string;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          hostel_id?: string;
          id?: string;
          id_proof_hash?: string;
          id_proof_last4?: string;
          id_proof_path?: string | null;
          id_proof_type?: string;
          joining_date?: string;
          notes?: string | null;
          permanent_address?: string;
          phone?: string;
          status?: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "residents_created_by_fkey";
            columns: ["created_by"];
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
          kind: string | null;
          number: string | null;
          paid: number | null;
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
      resident_credit_balances: {
        Row: {
          balance: number | null;
          hostel_id: string | null;
          resident_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "resident_credit_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resident_credit_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "resident_credit_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "residents";
            referencedColumns: ["hostel_id", "id"];
          },
        ];
      };
      resident_deposits: {
        Row: {
          applied: number | null;
          deducted: number | null;
          due: number | null;
          held: number | null;
          hostel_id: string | null;
          outstanding: number | null;
          received: number | null;
          refunded: number | null;
          resident_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "deposit_ledger_hostel_id_fkey";
            columns: ["hostel_id"];
            isOneToOne: false;
            referencedRelation: "hostels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deposit_ledger_resident_fkey";
            columns: ["hostel_id", "resident_id"];
            isOneToOne: false;
            referencedRelation: "resident_directory";
            referencedColumns: ["hostel_id", "id"];
          },
          {
            foreignKeyName: "deposit_ledger_resident_fkey";
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
      allocate_bed: {
        Args: {
          p_bed_id: string;
          p_rent_override?: number;
          p_resident_id: string;
          p_start_date: string;
        };
        Returns: string;
      };
      apply_late_fees: { Args: { p_hostel_id: string }; Returns: number };
      bill_pending_charges: { Args: { p_resident_id: string }; Returns: string };
      billed_months: { Args: { p_hostel_id: string }; Returns: string[] };
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
          deposits_held: number;
          invoices: number;
          outstanding: number;
          overdue: number;
          overdue_residents: number;
          payments: number;
        }[];
      };
      deduct_deposit: {
        Args: { p_amount: number; p_reason: string; p_resident_id: string };
        Returns: string;
      };
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
      record_advance: {
        Args: {
          p_amount: number;
          p_mode: string;
          p_paid_at: string;
          p_reference?: string;
          p_resident_id: string;
        };
        Returns: string;
      };
      record_deposit: {
        Args: {
          p_amount: number;
          p_mode: string;
          p_paid_at: string;
          p_reference?: string;
          p_resident_id: string;
        };
        Returns: string;
      };
      record_payment: {
        Args: {
          p_amount: number;
          p_invoice_id: string;
          p_mode: string;
          p_paid_at: string;
          p_reference?: string;
        };
        Returns: Json;
      };
      refund_credit: {
        Args: { p_amount: number; p_mode: string; p_reference?: string; p_resident_id: string };
        Returns: string;
      };
      refund_deposit: {
        Args: { p_amount: number; p_mode: string; p_reference?: string; p_resident_id: string };
        Returns: string;
      };
      set_fee_head_rate: {
        Args: {
          p_amount: number;
          p_effective_from: string;
          p_fee_head_id: string;
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
      settle_resident: {
        Args: {
          p_deductions?: Json;
          p_refund_mode?: string;
          p_refund_reference?: string;
          p_resident_id: string;
          p_use_deposit?: boolean;
        };
        Returns: Json;
      };
      settlement_preview: { Args: { p_resident_id: string }; Returns: Json };
      transfer_allocation: {
        Args: {
          p_allocation_id: string;
          p_move_date: string;
          p_new_bed_id: string;
          p_rent_override?: number;
        };
        Returns: string;
      };
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
