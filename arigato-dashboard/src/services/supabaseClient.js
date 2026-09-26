import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// null when not configured — the app then keeps the profile in this browser only
export const supabase = url && key ? createClient(url, key) : null;

const PROFILE_FIELDS = {
  location: "location",
  plotSize: "plot_size",
  plotUnit: "plot_unit",
  primaryCrop: "primary_crop",
  irrigation: "irrigation",
  farmingType: "farming_type",
  minorSharePercent: "minor_share_percent",
};

// Returns { farmerInput, compareList } or null when the farmer has no saved profile yet
export async function loadProfile(userId) {
  const { data, error } = await supabase.from("farmer_profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const farmerInput = {};
  for (const [field, column] of Object.entries(PROFILE_FIELDS)) {
    if (data[column] != null) farmerInput[field] = column === "plot_size" ? Number(data[column]) : data[column];
  }
  return { farmerInput, compareList: data.compare_list ?? null, fullName: data.full_name };
}

export async function saveProfile(userId, farmerInput, compareList, fullName) {
  const row = { id: userId, compare_list: compareList, updated_at: new Date().toISOString() };
  for (const [field, column] of Object.entries(PROFILE_FIELDS)) row[column] = farmerInput[field];
  if (fullName) row.full_name = fullName;
  const { error } = await supabase.from("farmer_profiles").upsert(row);
  if (error) throw error;
}

// PostgREST error code when the table hasn't been created yet
export const isMissingTable = (error) => error?.code === "PGRST205" || error?.code === "42P01";

/* ---------------------------------------------------------------- activity log */

// Events are queued and written in small batches; only signed-in farmers are logged
let activityUserId = null;
let activityQueue = [];
let flushTimer = null;

export function setActivityUser(userId) {
  activityUserId = userId;
  if (!userId) activityQueue = [];
}

export async function flushActivity() {
  clearTimeout(flushTimer);
  if (!supabase || !activityQueue.length) return;
  const batch = activityQueue;
  activityQueue = [];
  const { error } = await supabase.from("user_activity").insert(batch);
  if (error && !isMissingTable(error)) console.warn("Activity log failed:", error.message);
}

export function logActivity(event, details = {}) {
  if (!supabase || !activityUserId) return;
  activityQueue.push({ user_id: activityUserId, event, details });
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushActivity, 2000);
}

export async function loadRecentActivity(userId, limit = 6) {
  const { data, error } = await supabase
    .from("user_activity")
    .select("event, details, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function signOut() {
  logActivity("signed_out");
  await flushActivity();
  setActivityUser(null);
  await supabase.auth.signOut();
}
