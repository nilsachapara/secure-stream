# Telegram Filestream Server

A lightweight Go server that proxies file streams from Telegram Bot API. No MTProto, no session auth — just Bot API.

## Deploy to Render

1. Create a new **Web Service** on [Render](https://render.com)
2. Connect this repo
3. Set environment variables:
   - `TELEGRAM_BOT_TOKEN` — Your bot token from @BotFather
   - `SUPABASE_URL` — Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — Your Supabase service role key
4. Deploy!

## How it works

- Looks up file records in your Supabase `files` table
- Uses `telegram_msg_id` field as the Telegram file_id
- Fetches the file URL from Telegram Bot API
- **Proxies** the content directly to the client (no redirects)
- Supports HTTP Range requests for video seeking

## Limitations

- Telegram Bot API has a **20MB file size limit** for `getFile`
- For files >20MB, you'll need MTProto (tdlib/gotd)

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/stream/:id` | Stream a file (supports Range) |
| `GET /api/download/:id` | Download a file |
| `GET /api/files` | List files from Supabase |
| `GET /api/auth/status` | Auth status (always OK in Bot API mode) |
| `POST /api/auth/otp` | OTP handler (no-op in Bot API mode) |
| `GET /health` | Health check |
