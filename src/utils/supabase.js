import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// URL과 Key가 설정되어 있을 때만 Supabase 클라이언트를 생성합니다.
// 로컬 저장소(IndexedDB)와 병행하여 하이브리드로 동작하도록 설계되었습니다.
export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
