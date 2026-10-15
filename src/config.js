// Tuberizer extension settings. Loaded before content.js (same isolated world).
const TUBERIZER_CONFIG = Object.freeze({
  // Where the /embed/youtube/:videoId route is served from.
  // For local testing against `npm run dev`, use "http://localhost:8080".
  origin: "https://tuberizer.com",

  // Public (anon) Supabase credentials — the same ones shipped in the web app bundle.
  // Used only for the read-only "has this video been Tuberized already?" lookup.
  supabaseUrl: "https://fxtwrwqhxgiqnwjmzfem.supabase.co",
  supabaseAnonKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4dHdyd3FoeGdpcW53am16ZmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NTEyMjgsImV4cCI6MjA4NDEyNzIyOH0.Eu4YepsKu2NslGINi-XxPdC_QoHUZ1hmO0QoymBK5dc",

  // Show "✓ Tuberized" on videos that already have a summary. Sends the video ID
  // of each watched video to Tuberizer's database; set false to only contact
  // Tuberizer when the button is clicked.
  checkExistingSummaries: true,

  // Pause the YouTube video while the Tuberizer window is open.
  pauseVideoOnOpen: false,

  // How long to wait for the embed to report it's ready before showing an error.
  loadTimeoutMs: 20000,
});
