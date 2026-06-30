# Offline Development Notes

This folder is the working source for the receipt app. Keep one verified copy
outside iCloud so the app can be inspected and edited even when the network or
iCloud sync is unavailable.

## Recommended Local Path

`/Users/kyounghomac/Projects/receipt-app`

## What Works Offline

- Open and edit source code
- Run the app locally if `node_modules` already exists
- Build the frontend with the installed dependencies
- Review existing local files and Git history

## What Still Requires Internet

- OCR API calls
- Google Drive upload
- KakaoTalk notification
- Vercel deployment
- Installing new npm packages if they are not already cached/installed

## Useful Commands

```bash
cd /Users/kyounghomac/Projects/receipt-app
npm run dev -- --host 127.0.0.1 --port 5175
npm run lint
npm run build
```

## Environment Variables

Do not store secret values in this document. Keep the actual values in Vercel
and, only if needed for local testing, in a private `.env.local` file.

Common variable names:

- `ANTHROPIC_API_KEY`
- `ADMIN_PIN`
- `UPLOAD_API_TOKEN` (optional, server-to-server Authorization only)
- `GDRIVE_CLIENT_ID`
- `GDRIVE_CLIENT_SECRET`
- `GDRIVE_REFRESH_TOKEN`
- `GDRIVE_MAIN_FOLDER_ID`
- `KAKAO_REST_API_KEY`
- `KAKAO_CLIENT_SECRET`
- `KAKAO_MANAGER_REFRESH_TOKEN`

## iCloud Folder Policy

Do not delete the iCloud folder until the local copy has been verified and a
recent backup exists. Rename it to an archive name first if it becomes confusing.
