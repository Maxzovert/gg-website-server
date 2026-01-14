import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in environment variables');
    console.error('Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    throw new Error('Missing Supabase credentials');
}

// Verify service role key is being used
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️  WARNING: Using SUPABASE_ANON_KEY instead of SUPABASE_SERVICE_ROLE_KEY');
    console.warn('⚠️  Backend operations may fail due to RLS policies. Please set SUPABASE_SERVICE_ROLE_KEY in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export default supabase;

