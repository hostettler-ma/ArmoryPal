
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_actions": {
                  Row: {
                    "action": string,"admin_id": string | null,"created_at": string,"detail": string | null,"id": number,"target_event": string | null,"target_label": string | null,"target_store": string | null,"target_user": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"admin_id"?: string | null,"created_at"?: string,"detail"?: string | null,"id"?: never,"target_event"?: string | null,"target_label"?: string | null,"target_store"?: string | null,"target_user"?: string | null
                  }
                  Update: {
                    "action"?: string,"admin_id"?: string | null,"created_at"?: string,"detail"?: string | null,"id"?: never,"target_event"?: string | null,"target_label"?: string | null,"target_store"?: string | null,"target_user"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_actions_admin_id_fkey"
      columns: ["admin_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"attendances": {
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
                },"bans": {
                  Row: {
                    "banned_by": string | null,"created_at": string,"reason": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "banned_by"?: string | null,"created_at"?: string,"reason": string,"user_id": string
                  }
                  Update: {
                    "banned_by"?: string | null,"created_at"?: string,"reason"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bans_banned_by_fkey"
      columns: ["banned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bans_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cards": {
                  Row: {
                    "color": string | null,"id": string,"image_url": string | null,"name": string,"pitch": number | null,"set_ids": (string)[],"types": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"id": string,"image_url"?: string | null,"name": string,"pitch"?: number | null,"set_ids"?: (string)[],"types"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "color"?: string | null,"id"?: string,"image_url"?: string | null,"name"?: string,"pitch"?: number | null,"set_ids"?: (string)[],"types"?: (string)[],"updated_at"?: string
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
                    "cancel_note": string | null,"cancelled_at": string | null,"created_at": string,"deleted_at": string | null,"ends_at": string,"event_date": string,"format": string | null,"gem_code": string | null,"gem_url": string | null,"id": string,"label": string,"moved_from": string | null,"schedule_id": string | null,"slot_date": string | null,"starts_at": string,"store_id": string,"ticket_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_note"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"ends_at": string,"event_date": string,"format"?: string | null,"gem_code"?: string | null,"gem_url"?: string | null,"id"?: string,"label": string,"moved_from"?: string | null,"schedule_id"?: string | null,"slot_date"?: string | null,"starts_at": string,"store_id": string,"ticket_url"?: string | null
                  }
                  Update: {
                    "cancel_note"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"ends_at"?: string,"event_date"?: string,"format"?: string | null,"gem_code"?: string | null,"gem_url"?: string | null,"id"?: string,"label"?: string,"moved_from"?: string | null,"schedule_id"?: string | null,"slot_date"?: string | null,"starts_at"?: string,"store_id"?: string,"ticket_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_schedule_store_fkey"
      columns: ["schedule_id","store_id"]
isOneToOne: false
      referencedRelation: "store_schedules"
      referencedColumns: ["id","store_id"]
    },{
      foreignKeyName: "events_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"format_polls": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"created_by": string | null,"event_id": string,"options": (string)[],"weekly": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"event_id": string,"options": (string)[],"weekly"?: boolean
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"event_id"?: string,"options"?: (string)[],"weekly"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "format_polls_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "format_polls_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"format_votes": {
                  Row: {
                    "event_id": string,"format": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"format": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "event_id"?: string,"format"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "format_votes_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "format_polls"
      referencedColumns: ["event_id"]
    },{
      foreignKeyName: "format_votes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "enabled": boolean,"kind": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "enabled": boolean,"kind": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "enabled"?: boolean,"kind"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"event_id": string | null,"id": string,"kind": string,"payload": NonNullable<Json>,"read_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id"?: string | null,"id"?: string,"kind": string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string | null,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
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
      foreignKeyName: "pledges_request_event_fkey"
      columns: ["request_id","event_id"]
isOneToOne: false
      referencedRelation: "requests"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"gem_id": string | null,"guide_seen_at": string | null,"id": string,"is_admin": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"gem_id"?: string | null,"guide_seen_at"?: string | null,"id": string,"is_admin"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"gem_id"?: string | null,"guide_seen_at"?: string | null,"id"?: string,"is_admin"?: boolean
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
                },"store_owner_requests": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"id": string,"message": string | null,"status": string,"store_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"message"?: string | null,"status"?: string,"store_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"message"?: string | null,"status"?: string,"store_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_owner_requests_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "store_owner_requests_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "store_owner_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"store_owners": {
                  Row: {
                    "created_at": string,"granted_by": string | null,"store_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"granted_by"?: string | null,"store_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"granted_by"?: string | null,"store_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "store_owners_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "store_owners_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "store_owners_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"store_schedules": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"label": string,"poll_options": (string)[],"start_time": string,"store_id": string,"weekday": number,"weekly_format_poll": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"label"?: string,"poll_options"?: (string)[],"start_time": string,"store_id": string,"weekday": number,"weekly_format_poll"?: boolean
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"label"?: string,"poll_options"?: (string)[],"start_time"?: string,"store_id"?: string,"weekday"?: number,"weekly_format_poll"?: boolean
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
                    "address": string | null,"archived_at": string | null,"city": string,"country": string,"created_at": string,"created_by": string | null,"id": string,"name": string,"notes": string | null,"region": string | null,"ticket_url": string | null,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"archived_at"?: string | null,"city": string,"country": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"region"?: string | null,"ticket_url"?: string | null,"timezone": string
                  }
                  Update: {
                    "address"?: string | null,"archived_at"?: string | null,"city"?: string,"country"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"region"?: string | null,"ticket_url"?: string | null,"timezone"?: string
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
"admin_ban":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"admin_decide_ownership_request":
{ Args: { "p_approve": boolean,"p_note"?: string,"p_request_id": string }; Returns: undefined
                           },
"admin_delete_store":
{ Args: { "p_store_id": string }; Returns: string
                           },
"admin_list_players":
{ Args: { "p_limit"?: number,"p_query"?: string }; Returns: {
              "banned": boolean,"created_at": string,"display_name": string,"email": string,"id": string,"is_admin": boolean,"provider": string
            }[]
                           },
"admin_remove_attendee":
{ Args: { "p_event_id": string,"p_reason"?: string,"p_user_id": string }; Returns: undefined
                           },
"admin_remove_store_owner":
{ Args: { "p_store_id": string,"p_user_id": string }; Returns: undefined
                           },
"admin_restore_store":
{ Args: { "p_store_id": string }; Returns: undefined
                           },
"admin_unban":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"announce_event_moved":
{ Args: { "p_event_id": string,"p_from": string }; Returns: undefined
                           },
"announce_format":
{ Args: { "p_event_id": string,"p_format": string,"p_kind": string }; Returns: undefined
                           },
"announce_needed_again":
{ Args: { "p_actor": string,"p_event_id": string,"p_reason": string,"p_released": Json,"p_releaser": string }; Returns: undefined
                           },
"assert_admin":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"assert_attending":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"assert_can_manage":
{ Args: { "p_store_id": string }; Returns: undefined
                           },
"assert_event_open":
{ Args: { "p_event_id": string }; Returns: {
              "cancel_note": string | null,
"cancelled_at": string | null,
"created_at": string,
"deleted_at": string | null,
"ends_at": string,
"event_date": string,
"format": string | null,
"gem_code": string | null,
"gem_url": string | null,
"id": string,
"label": string,
"moved_from": string | null,
"schedule_id": string | null,
"slot_date": string | null,
"starts_at": string,
"store_id": string,
"ticket_url": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"assert_valid_label":
{ Args: { "p_label": string }; Returns: undefined
                           },
"assert_valid_links":
{ Args: { "p_gem_code": string,"p_gem_url": string,"p_ticket_url": string }; Returns: undefined
                           },
"attend_event":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"can_manage_store":
{ Args: { "p_store_id": string }; Returns: boolean
                           },
"cancel_ownership_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"cancel_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           },
"cancel_request_internal":
{ Args: { "p_reason": string,"p_request_id": string }; Returns: undefined
                           },
"card_label":
{ Args: { "p_card_id": string }; Returns: string
                           },
"card_name_key":
{ Args: { "p_name": string }; Returns: string
                           },
"clear_format_vote":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"copy_open_requests":
{ Args: { "p_from_event": string,"p_to_event": string }; Returns: number
                           },
"current_events_for_stores":
{ Args: { "p_store_ids": (string)[] }; Returns: {
              "cancel_note": string | null,
"cancelled_at": string | null,
"created_at": string,
"deleted_at": string | null,
"ends_at": string,
"event_date": string,
"format": string | null,
"gem_code": string | null,
"gem_url": string | null,
"id": string,
"label": string,
"moved_from": string | null,
"schedule_id": string | null,
"slot_date": string | null,
"starts_at": string,
"store_id": string,
"ticket_url": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: false
        isSetofReturn: true
      } },
"event_audience":
{ Args: { "p_event_id": string,"p_exclude": (string)[] }; Returns: string[]
                           },
"event_occurrence":
{ Args: { "p_now"?: string,"p_start_time": string,"p_timezone": string,"p_weekday": number }; Returns: {
              "ends_at": string,"event_date": string,"starts_at": string
            }[]
                           },
"event_times":
{ Args: { "p_date": string,"p_start_time": string,"p_timezone": string }; Returns: {
              "ends_at": string,"starts_at": string
            }[]
                           },
"format_event_time":
{ Args: { "p_at": string,"p_timezone": string }; Returns: string
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_banned":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_format":
{ Args: { "p_format": string }; Returns: boolean
                           },
"is_gem_url":
{ Args: { "p_url": string }; Returns: boolean
                           },
"is_https_url":
{ Args: { "p_url": string }; Returns: boolean
                           },
"is_store_owner":
{ Args: { "p_store_id": string }; Returns: boolean
                           },
"is_valid_timezone":
{ Args: { "tz": string }; Returns: boolean
                           },
"leave_event":
{ Args: { "p_cancel_requests"?: boolean,"p_event_id": string }; Returns: undefined
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
"log_admin_action":
{ Args: { "p_action": string,"p_detail": string,"p_target_event": string,"p_target_label": string,"p_target_store": string,"p_target_user": string }; Returns: undefined
                           },
"mark_notifications_read":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"my_display_name":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"new_request_recipients":
{ Args: { "p_event_id": string }; Returns: string[]
                           },
"notify":
{ Args: { "p_event_id": string,"p_kind": string,"p_payload": Json,"p_user_id": string }; Returns: undefined
                           },
"owner_add_schedule":
{ Args: { "p_label": string,"p_start_time": string,"p_store_id": string,"p_weekday": number }; Returns: string
                           },
"owner_cancel_event":
{ Args: { "p_event_id": string,"p_note"?: string }; Returns: undefined
                           },
"owner_confirm_format":
{ Args: { "p_event_id": string,"p_format": string }; Returns: undefined
                           },
"owner_create_event":
{ Args: { "p_date": string,"p_gem_code"?: string,"p_gem_url"?: string,"p_label": string,"p_start_time": string,"p_store_id": string,"p_ticket_url"?: string }; Returns: string
                           },
"owner_delete_event":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"owner_delete_poll":
{ Args: { "p_event_id": string }; Returns: undefined
                           },
"owner_move_event":
{ Args: { "p_date": string,"p_event_id": string,"p_start_time": string }; Returns: undefined
                           },
"owner_open_poll":
{ Args: { "p_event_id": string,"p_options": (string)[] }; Returns: undefined
                           },
"owner_rename_event":
{ Args: { "p_event_id": string,"p_label": string }; Returns: undefined
                           },
"owner_set_schedule_active":
{ Args: { "p_active": boolean,"p_schedule_id": string }; Returns: undefined
                           },
"owner_set_weekly_poll":
{ Args: { "p_on": boolean,"p_options": (string)[],"p_schedule_id": string }; Returns: undefined
                           },
"owner_upcoming_events":
{ Args: { "p_store_id": string,"p_weeks"?: number }; Returns: {
              "cancel_note": string | null,
"cancelled_at": string | null,
"created_at": string,
"deleted_at": string | null,
"ends_at": string,
"event_date": string,
"format": string | null,
"gem_code": string | null,
"gem_url": string | null,
"id": string,
"label": string,
"moved_from": string | null,
"schedule_id": string | null,
"slot_date": string | null,
"starts_at": string,
"store_id": string,
"ticket_url": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: false
        isSetofReturn: true
      } },
"owner_update_event_links":
{ Args: { "p_event_id": string,"p_gem_code": string,"p_gem_url": string,"p_ticket_url": string }; Returns: undefined
                           },
"owner_update_schedule":
{ Args: { "p_label": string,"p_schedule_id": string,"p_start_time": string,"p_weekday": number }; Returns: undefined
                           },
"owner_update_store_info":
{ Args: { "p_notes": string,"p_store_id": string,"p_ticket_url": string }; Returns: undefined
                           },
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
"pledges_to_release":
{ Args: { "p_event_id": string,"p_pledger_id": string }; Returns: Json
                           },
"prune_notifications":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"release_my_pledges":
{ Args: { "p_event_id": string,"p_reason": string }; Returns: undefined
                           },
"remove_from_event":
{ Args: { "p_event_id": string,"p_user_id": string }; Returns: undefined
                           },
"request_store_ownership":
{ Args: { "p_message"?: string,"p_store_id": string }; Returns: string
                           },
"resolve_card_names":
{ Args: { "p_names": (string)[] }; Returns: {
              "idx": number,"input": string,"match": string,"name": string
            }[]
                           },
"search_cards":
{ Args: { "max_results"?: number,"q": string }; Returns: {
              "color": string | null,
"id": string,
"image_url": string | null,
"name": string,
"pitch": number | null,
"set_ids": (string)[],
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
"archived_at": string | null,
"city": string,
"country": string,
"created_at": string,
"created_by": string | null,
"id": string,
"name": string,
"notes": string | null,
"region": string | null,
"ticket_url": string | null,
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
      } },
"valid_format_options":
{ Args: { "p_options": (string)[] }; Returns: boolean
                           },
"vote_format":
{ Args: { "p_event_id": string,"p_format": string }; Returns: undefined
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
