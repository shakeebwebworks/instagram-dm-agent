# Instagram DM Agent 🤖

You send the first DM manually. When the owner replies, this agent chats, qualifies the lead, and alerts you.

## 1. Instagram setup
1. Switch your Instagram to a **Business** (professional) account.
2. Create a Facebook Page and link it to the Instagram account.

## 2. Meta Developer app
1. Go to developers.facebook.com -> Create App -> Business type.
2. Add the **Instagram** product (Instagram API with Instagram Login, messaging).
3. Copy the **App Secret** (Settings -> Basic) into `APP_SECRET`.
4. Generate an access token for your Instagram account and put it in `IG_ACCESS_TOKEN`.
5. Add yourself as a tester while the app is in development mode.

## 3. Deploy on Render
1. Upload this folder to a GitHub repo.
2. Render -> New -> Web Service -> pick the repo.
3. Build command: `npm install`  |  Start command: `npm start`
4. Add the environment variables from `.env.example`.
5. After deploy you get a URL like `https://your-app.onrender.com`.

## 4. Connect the webhook
1. Meta app -> Instagram -> Webhooks.
2. Callback URL: `https://your-app.onrender.com/webhook`
3. Verify token: the same text as `VERIFY_TOKEN`.
4. Subscribe to the **messages** field.

## 5. Test
Message your Business account from a second Instagram account (a tester). The agent should reply.

## Notes
- **Free Render sleeps** after inactivity, so the first reply can be slow. Use UptimeRobot to ping `/` every 5 minutes, or upgrade to a paid plan.
- Chat memory is kept in RAM and clears on restart. Fine for starting; add a database later.
- To message real businesses (not just testers) Meta needs **App Review** for messaging permissions.
- Agent only replies within 24 hours of the owner's last message (Instagram rule).
- Lead alerts: set up the optional Telegram variables to get a ping the moment a lead is ready.
