
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "attendances": {
                  Row: {
                    "created_at": string,"event_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendances_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendances_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cards": {
                  Row: {
                    "color": string | null,"id": string,"image_url": string | null,"name": string,"pitch": number | null,"types": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"id": string,"image_url"?: string | null,"name": string,"pitch"?: number | null,"types"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "color"?: string | null,"id"?: string,"image_url"?: string | null,"name"?: string,"pitch"?: number | null,"types"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"catalog_meta": {
                  Row: {
                    "dataset_tag": string,"id": boolean,"imported_at": string,"latest_set_id": string,"latest_set_name": string,"latest_set_released_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "dataset_tag": string,"id"?: boolean,"imported_at"?: string,"latest_set_id": string,"latest_set_name": string,"latest_set_released_on"?: string | null
                  }
                  Update: {
                    "dataset_tag"?: string,"id"?: boolean,"imported_at"?: string,"latest_set_id"?: string,"latest_set_name"?: string,"latest_set_released_on"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"ends_at": string,"event_date": string,"id": string,"schedule_id": string,"starts_at": string,"store_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at": string,"event_date": string,"id"?: string,"schedule_id": string,"starts_at": string,"store_id": string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string,"event_date"?: string,"id"?: string,"schedule_id"?: string,"starts_at"?: string,"store_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_schedule_id_fkey"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "store_schedules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"pledges": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"pledger_id": string,"quantity": number,"request_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"pledger_id": string,"quantity": number,"request_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"pledger_id"?: string,"quantity"?: number,"request_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pledges_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pledges_pledger_id_fkey"
      columns: ["pledger_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pledges_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "requests"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"gem_id": string | null,"id": string,"is_admin": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"gem_id"?: string | null,"id": string,"is_admin"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"gem_id"?: string | null,"id"?: string,"is_admin"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"requests": {
                  Row: {
                    "card_id": string,"copied_from_id": string | null,"created_at": string,"event_id": string,"id": string,"note": string | null,"quantity": number,"requester_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "card_id": string,"copied_from_id"?: string | null,"created_at"?: string,"event_id": string,"id"?: string,"note"?: string | null,"quantity": number,"requester_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "card_id"?: string,"copied_from_id"?: string | null,"created_at"?: string,"event_id"?: string,"id"?: string,"note"?: string | null,"quantity"?: number,"requester_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "requests_card_id_fkey"
      columns: ["card_id"]
isOneToOne: false
      referencedRelation: "cards"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requests_copied_from_id_fkey"
      columns: ["copied_from_id"]
isOneToOne: false
      referencedRelation: "requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requests_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requests_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"store_schedules": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"label": string,"start_time": string,"store_id": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"label"?: string,"start_time": string,"store_id": string,"weekday": number
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"label"?: string,"start_time"?: string,"store_id"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_schedules_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"stores": {
                  Row: {
                    "address": string | null,"city": string,"country": string,"created_at": string,"created_by": string | null,"id": string,"name": string,"region": string | null,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"city": string,"country": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"region"?: string | null,"timezone": string
                  }
                  Update: {
                    "address"?: string | null,"city"?: string,"country"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"region"?: string | null,"timezone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stores_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_stores": {
                  Row: {
                    "created_at": string,"store_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"store_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"store_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_stores_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_stores_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_requests":
{ Args: { "p_event_id": string,"p_items": Json,"p_note"?: string }; Returns: {
              "card_id": string,
"copied_from_id": string | null,
"created_at": string,
"event_id": string,
"id": string,
"note": string | null,
"quantity": number,
"requester_id": string,
"status": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "requests"
        isOneToOne: false
        isSetofReturn: true
      } },
"assert_attending":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"assert_event_open":
{ Args: { "p_event_id": string }; Returns: {
              "created_at": string,
"ends_at": string,
"event_date": string,
"id": string,
"schedule_id": string,
"starts_at": string,
"store_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"attend_event":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"cancel_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"current_events_for_stores":
{ Args: { "p_store_ids": (string)[] }; Returns: {
              "created_at": string,
"ends_at": string,
"event_date": string,
"id": string,
"schedule_id": string,
"starts_at": string,
"store_id": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: false
        isSetofReturn: true
      } },
"event_occurrence":
{ Args: { "p_now"?: string,"p_start_time": string,"p_timezone": string,"p_weekday": number }; Returns: {
              "ends_at": string,"event_date": string,"starts_at": string
            }[]
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_valid_timezone":
{ Args: { "tz": string }; Returns: boolean
                           },
"leave_event":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"lock_own_request":
{ Args: { "p_request_id": string }; Returns: {
              "card_id": string,
"copied_from_id": string | null,
"created_at": string,
"event_id": string,
"id": string,
"note": string | null,
"quantity": number,
"requester_id": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "requests"
        isOneToOne: true
        isSetofReturn: false
      } },
"pledge":
{ Args: { "p_quantity": number,"p_request_id": string }; Returns: {
              "created_at": string,
"event_id": string,
"id": string,
"pledger_id": string,
"quantity": number,
"request_id": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "pledges"
        isOneToOne: true
        isSetofReturn: false
      } },
"search_cards":
{ Args: { "max_results"?: number,"q": string }; Returns: {
              "color": string | null,
"id": string,
"image_url": string | null,
"name": string,
"pitch": number | null,
"types": (string)[],
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "cards"
        isOneToOne: false
        isSetofReturn: true
      } },
"search_stores":
{ Args: { "q": string }; Returns: {
              "address": string | null,
"city": string,
"country": string,
"created_at": string,
"created_by": string | null,
"id": string,
"name": string,
"region": string | null,
"timezone": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "stores"
        isOneToOne: false
        isSetofReturn: true
      } },
"unpledge":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"update_request":
{ Args: { "p_note"?: string,"p_quantity": number,"p_request_id": string }; Returns: {
              "card_id": string,
"copied_from_id": string | null,
"created_at": string,
"event_id": string,
"id": string,
"note": string | null,
"quantity": number,
"requester_id": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "requests"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
