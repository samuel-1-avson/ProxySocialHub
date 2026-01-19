import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://jkrypzxbnwdcdvhtjxgx.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprcnlwenhibndkY2R2aHRqeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MDcxNTcsImV4cCI6MjA4NDA4MzE1N30.7HjMFgimIhNNmBlEBSX_1U_EM6MUZJcXKNHQhYJLcvg";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
