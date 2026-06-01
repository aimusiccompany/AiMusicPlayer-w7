import { createClient } from '@supabase/supabase-js'

if (typeof window !== 'undefined') {
  window.supabase = { createClient }
}

