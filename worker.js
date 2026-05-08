export default {
  async fetch(request, env) {
    const CLIENT_ID = '1502223149876645888';
    const GUILD_ID = '1266986937965744148';
    const INVITE_CODE = 'XAwgpNKAHr';
    const BOT_TOKEN = 'BOT_TOKEN_HERE';
    const PUBLIC_KEY = '8790c29416a46b783d669f9076803ce504509cfe2a77280222af59d31db9d89d';
    const CHANNEL_ID = '1502227252774047914';
    const REDIRECT_URI = 'https://necrobin.github.io/Primordial-Villain-Community-Codex/';
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const path = new URL(request.url).pathname;

    if (path === '/interactions' && request.method === 'POST') {
      const signature = request.headers.get('X-Signature-Ed25519');
      const timestamp = request.headers.get('X-Signature-Timestamp');
      const body = await request.text();

      const isValid = await verifySignature(PUBLIC_KEY, signature, timestamp, body);
      if (!isValid) return new Response('Invalid signature', { status: 401 });

      const interaction = JSON.parse(body);

      if (interaction.type === 1) {
        return new Response(JSON.stringify({ type: 1 }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (interaction.type === 3) {
        const customId = interaction.data.custom_id;
        const parts = customId.split(':');
        const action = parts[0];
        const userId = parts[1];
        const embed = interaction.message.embeds[0];
        const modName = interaction.member && interaction.member.user
          ? (interaction.member.user.global_name || interaction.member.user.username)
          : 'Moderator';

        if (action === 'approve') {
          try {
            const key = 'sub:' + userId;
            const existing = await env.SUBS.get(key, { type: 'json' });
            if (existing) {
              existing.count = (existing.count || 0) + 1;
              await env.SUBS.put(key, JSON.stringify(existing));
            }
          } catch (e) {}

          embed.color = 0x2ecc71;
          embed.fields.push({ name: 'Status', value: '✅ Approved by ' + modName });

          return new Response(JSON.stringify({
            type: 7,
            data: { embeds: [embed], components: [] }
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        if (action === 'decline') {
          embed.color = 0xe74c3c;
          embed.fields.push({ name: 'Status', value: '❌ Declined by ' + modName });

          return new Response(JSON.stringify({
            type: 7,
            data: { embeds: [embed], components: [] }
          }), { headers: { 'Content-Type': 'application/json' } });
        }
      }

      return new Response(JSON.stringify({ type: 1 }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (path === '/members' && request.method === 'GET') {
      try {
        const res = await fetch('https://discord.com/api/v10/invites/' + INVITE_CODE + '?with_counts=true');
        if (!res.ok) return new Response('{"error":"Failed to fetch"}', { status: 502, headers: CORS });
        const data = await res.json();
        return new Response(JSON.stringify({
          members: data.approximate_member_count || 0,
          online: data.approximate_presence_count || 0
        }), { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Fetch error"}', { status: 500, headers: CORS });
      }
    }

    if (path === '/leaderboard' && request.method === 'GET') {
      try {
        const list = await env.SUBS.list({ prefix: 'sub:' });
        const entries = [];
        for (const key of list.keys) {
          const val = await env.SUBS.get(key.name, { type: 'json' });
          if (val && val.count > 0) entries.push(val);
        }
        entries.sort(function(a, b) { return b.count - a.count; });
        return new Response(JSON.stringify(entries.slice(0, 10)), { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Failed to load leaderboard"}', { status: 500, headers: CORS });
      }
    }

    if (path === '/token' && request.method === 'POST') {
      try {
        const { code } = await request.json();
        if (!code) return new Response('{"error":"No code"}', { status: 400, headers: CORS });

        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
          })
        });

        if (!tokenRes.ok) {
          const errBody = await tokenRes.text();
          return new Response(JSON.stringify({error:'Token exchange failed', status: tokenRes.status, detail: errBody}), { status: 401, headers: CORS });
        }
        const tokenData = await tokenRes.json();

        const [userRes, guildsRes] = await Promise.all([
          fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: 'Bearer ' + tokenData.access_token }
          }),
          fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: 'Bearer ' + tokenData.access_token }
          })
        ]);

        if (!userRes.ok) return new Response('{"error":"Failed to get user"}', { status: 401, headers: CORS });
        const user = await userRes.json();

        let isMember = false;
        if (guildsRes.ok) {
          const guilds = await guildsRes.json();
          isMember = guilds.some(function(g) { return g.id === GUILD_ID; });
        }

        if (!isMember) {
          return new Response(JSON.stringify({
            error: 'not_member',
            message: 'You must be a member of the Necroverse Discord server to submit entries.'
          }), { status: 403, headers: CORS });
        }

        return new Response(JSON.stringify({
          access_token: tokenData.access_token,
          username: user.username,
          global_name: user.global_name || user.username,
          id: user.id,
          avatar: user.avatar
        }), { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Token exchange error"}', { status: 500, headers: CORS });
      }
    }

    if (path === '/submit' && request.method === 'POST') {
      try {
        const auth = request.headers.get('Authorization');
        if (!auth || !auth.startsWith('Bearer '))
          return new Response('{"error":"Not authenticated"}', { status: 401, headers: CORS });

        const userRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: auth }
        });
        if (!userRes.ok) return new Response('{"error":"Invalid token"}', { status: 401, headers: CORS });
        const user = await userRes.json();

        const d = await request.json();
        const embed = {
          title: 'Codex Submission: ' + (d.title || 'Untitled'),
          color: 0x8B5CF6,
          fields: [
            { name: 'Category', value: d.category || 'Unknown', inline: true },
            { name: 'Submitted by', value: (user.global_name || user.username) + ' (' + user.username + ')', inline: true },
            { name: 'Discord ID', value: user.id, inline: true },
            { name: 'Content', value: (d.content || 'No content').substring(0, 1024) }
          ],
          timestamp: new Date().toISOString()
        };
        if (user.avatar) {
          embed.thumbnail = { url: 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png' };
        }

        const res = await fetch('https://discord.com/api/v10/channels/' + CHANNEL_ID + '/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bot ' + BOT_TOKEN
          },
          body: JSON.stringify({
            embeds: [embed],
            components: [{
              type: 1,
              components: [
                { type: 2, style: 3, label: 'Approve', custom_id: 'approve:' + user.id },
                { type: 2, style: 4, label: 'Decline', custom_id: 'decline:' + user.id }
              ]
            }]
          })
        });

        if (!res.ok) return new Response('{"error":"Discord rejected"}', { status: 502, headers: CORS });

        try {
          const key = 'sub:' + user.id;
          const existing = await env.SUBS.get(key, { type: 'json' });
          if (!existing) {
            await env.SUBS.put(key, JSON.stringify({
              id: user.id, username: user.username,
              global_name: user.global_name || user.username,
              avatar: user.avatar, count: 0
            }));
          } else {
            existing.username = user.username;
            existing.global_name = user.global_name || user.username;
            existing.avatar = user.avatar;
            await env.SUBS.put(key, JSON.stringify(existing));
          }
        } catch (e) {}

        return new Response('{"success":true}', { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Bad request"}', { status: 400, headers: CORS });
      }
    }

    return new Response('{"error":"Not found"}', { status: 404, headers: CORS });
  }
};

function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

async function verifySignature(publicKeyHex, signature, timestamp, body) {
  try {
    var key = await crypto.subtle.importKey(
      'raw', hexToBytes(publicKeyHex),
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
      false, ['verify']
    );
    return await crypto.subtle.verify(
      'NODE-ED25519', key, hexToBytes(signature),
      new TextEncoder().encode(timestamp + body)
    );
  } catch (e) { return false; }
}
