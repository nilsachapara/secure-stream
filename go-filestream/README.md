# Telegram Filestream Server (MTProto)

A Go server that streams files from Telegram using **MTProto protocol** — no file size limits!

## Features

- **MTProto bot authentication** — unlimited file downloads (no 20MB Bot API limit)
- **Bot API fallback** — uses faster Bot API for files <20MB
- **HTTP Range support** — video seeking works for small files
- **Chunked streaming** — large files stream directly to client
- **Supabase integration** — reads file records from your database

## Deploy to Render

1. Create a new **Web Service** on [Render](https://render.com)
2. Connect the `nilsachapara/secure-stream` repo
3. Set **Root Directory**: `go-filestream`
4. Set **Runtime**: Docker
5. Set environment variables:
   - `TELEGRAM_BOT_TOKEN` — Your bot token from @BotFather
   - `TELEGRAM_API_ID` — From https://my.telegram.org/apps
   - `TELEGRAM_API_HASH` — From https://my.telegram.org/apps
   - `SUPABASE_URL` — Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — Your Supabase service role key
6. Deploy!

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/stream/:id` | Stream a file (Bot API for <20MB, MTProto for >20MB) |
| `GET /api/download/:id` | Download a file with Content-Disposition |
| `GET /api/files` | List files from Supabase |
| `GET /api/auth/status` | MTProto connection status |
| `GET /health` | Health check |

## How it works

1. Client requests `/api/stream/{file-uuid}`
2. Server looks up the file record in Supabase
3. For files ≤20MB: Uses Bot API `getFile` → proxies from Telegram CDN (fast, supports Range)
4. For files >20MB: Uses MTProto `upload.getFile` → streams directly (no size limit)
