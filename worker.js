export default {
  async fetch(request, env, ctx) {
    const CLIENT_ID = '1502223149876645888';
    const GUILD_ID = '1266986937965744148';
    const INVITE_CODE = 'XAwgpNKAHr';
    const PUBLIC_KEY = '8790c29416a46b783d669f9076803ce504509cfe2a77280222af59d31db9d89d';
    const CHANNEL_ID = '1502227252774047914';
    const REDIRECT_URI = 'https://necrobin.github.io/Primordial-Villain-Community-Codex/';
    const ALLOWED_ORIGIN = 'https://necrobin.github.io';

    // --- CORS: locked to your GitHub Pages origin ---
    const origin = request.headers.get('Origin') || '';
    const isAllowedOrigin = origin === ALLOWED_ORIGIN;
    const CORS = isAllowedOrigin
      ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json', 'Vary': 'Origin' }
      : { 'Content-Type': 'application/json', 'Vary': 'Origin' };

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const path = new URL(request.url).pathname;
    var edgeCache = caches.default;
    var cacheBase = new URL(request.url).origin;

    // --- Rate limiter (KV-based, for /token and /submit) ---
    async function checkRateLimit(key, maxRequests, windowSeconds) {
      var rlKey = 'rl:' + key;
      try {
        var entry = await env.SUBS.get(rlKey, { type: 'json' });
        var now = Date.now();
        if (!entry || now - entry.ts > windowSeconds * 1000) {
          await env.SUBS.put(rlKey, JSON.stringify({ ts: now, count: 1 }), { expirationTtl: Math.max(windowSeconds, 60) });
          return false;
        }
        if (entry.count >= maxRequests) return true;
        entry.count++;
        var ttl = Math.max(windowSeconds - Math.floor((now - entry.ts) / 1000), 60);
        await env.SUBS.put(rlKey, JSON.stringify(entry), { expirationTtl: ttl });
      } catch(e) { return true; }
      return false;
    }

    // --- Helpers ---
    async function verifyGuildMember(authHeader) {
      var guildsRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: authHeader } });
      if (!guildsRes.ok) return false;
      var guilds = await guildsRes.json();
      return guilds.some(function(g) { return g.id === GUILD_ID; });
    }

    function checkBodySize(request, maxBytes) {
      var len = request.headers.get('Content-Length');
      if (len && parseInt(len, 10) > maxBytes) return true;
      return false;
    }

    // --- /interactions (Discord webhook, no CORS needed) ---
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

    // --- /members (edge-cached 5 min, rate limited) ---
    if (path === '/members' && request.method === 'GET') {
      var ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (await checkRateLimit('get:' + ip, 30, 60))
        return new Response('{"error":"Too many requests."}', { status: 429, headers: CORS });
      try {
        var ck = cacheBase + '/__c/members';
        var cr = await edgeCache.match(ck);
        if (cr) return new Response(await cr.text(), { headers: CORS });
        const res = await fetch('https://discord.com/api/v10/invites/' + INVITE_CODE + '?with_counts=true');
        if (!res.ok) return new Response('{"error":"Failed to fetch"}', { status: 502, headers: CORS });
        const data = await res.json();
        var body = JSON.stringify({ members: data.approximate_member_count || 0, online: data.approximate_presence_count || 0 });
        ctx.waitUntil(edgeCache.put(ck, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } })));
        return new Response(body, { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Fetch error"}', { status: 500, headers: CORS });
      }
    }

    // --- /leaderboard (edge-cached 5 min, rate limited) ---
    if (path === '/leaderboard' && request.method === 'GET') {
      var ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (await checkRateLimit('get:' + ip, 30, 60))
        return new Response('{"error":"Too many requests."}', { status: 429, headers: CORS });
      try {
        var ck = cacheBase + '/__c/contrib-lb';
        var cr = await edgeCache.match(ck);
        if (cr) return new Response(await cr.text(), { headers: CORS });
        const list = await env.SUBS.list({ prefix: 'sub:' });
        const entries = [];
        for (const key of list.keys) {
          const val = await env.SUBS.get(key.name, { type: 'json' });
          if (val && val.count > 0) entries.push({ id: val.id, username: val.username, global_name: val.global_name, avatar: val.avatar, count: val.count });
        }
        entries.sort(function(a, b) { return b.count - a.count; });
        var body = JSON.stringify(entries.slice(0, 10));
        ctx.waitUntil(edgeCache.put(ck, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' } })));
        return new Response(body, { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Failed to load leaderboard"}', { status: 500, headers: CORS });
      }
    }

    // --- /token (rate limited: 5 per minute per IP) ---
    if (path === '/token' && request.method === 'POST') {
      if (checkBodySize(request, 2048))
        return new Response('{"error":"Request too large"}', { status: 413, headers: CORS });
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (await checkRateLimit('token:' + ip, 5, 60)) {
        return new Response('{"error":"Too many requests. Try again in a minute."}', { status: 429, headers: CORS });
      }
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
          return new Response(JSON.stringify({error:'Token exchange failed'}), { status: 401, headers: CORS });
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

    // --- /submit (rate limited: 10 per hour per IP) ---
    if (path === '/submit' && request.method === 'POST') {
      if (checkBodySize(request, 10240))
        return new Response('{"error":"Request too large"}', { status: 413, headers: CORS });
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (await checkRateLimit('submit:' + ip, 10, 3600)) {
        return new Response('{"error":"Too many submissions. Try again later."}', { status: 429, headers: CORS });
      }
      try {
        const auth = request.headers.get('Authorization');
        if (!auth || !auth.startsWith('Bearer '))
          return new Response('{"error":"Not authenticated"}', { status: 401, headers: CORS });

        const userRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: auth }
        });
        if (!userRes.ok) return new Response('{"error":"Invalid token"}', { status: 401, headers: CORS });
        const user = await userRes.json();

        if (!await verifyGuildMember(auth))
          return new Response('{"error":"You must be a member of the Discord server."}', { status: 403, headers: CORS });

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
            'Authorization': 'Bot ' + env.BOT_TOKEN
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

    // --- /votes/:id (get poll results) ---
    if (path.startsWith('/votes/') && request.method === 'GET') {
      try {
        var pollId = decodeURIComponent(path.slice(7));
        if (!pollId || pollId.length > 64)
          return new Response('{"error":"Invalid poll ID"}', { status: 400, headers: CORS });
        var poll = await env.SUBS.get('poll:' + pollId, { type: 'json' });
        var result = { options: {}, total: 0, userVote: null };
        if (poll) {
          result.options = poll.options || {};
          result.total = poll.total || 0;
          var url = new URL(request.url);
          var userId = url.searchParams.get('userId');
          if (userId && poll.voters && poll.voters[userId])
            result.userVote = poll.voters[userId];
        }
        return new Response(JSON.stringify(result), { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Failed to load poll"}', { status: 500, headers: CORS });
      }
    }

    // --- /vote (cast a vote, rate limited: 30 per hour per IP) ---
    if (path === '/vote' && request.method === 'POST') {
      if (checkBodySize(request, 1024))
        return new Response('{"error":"Request too large"}', { status: 413, headers: CORS });
      var ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (await checkRateLimit('vote:' + ip, 30, 3600))
        return new Response('{"error":"Too many requests. Try again later."}', { status: 429, headers: CORS });
      try {
        var auth = request.headers.get('Authorization');
        if (!auth || !auth.startsWith('Bearer '))
          return new Response('{"error":"Not authenticated"}', { status: 401, headers: CORS });
        var userRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: auth }
        });
        if (!userRes.ok) return new Response('{"error":"Invalid token"}', { status: 401, headers: CORS });
        var user = await userRes.json();

        if (!await verifyGuildMember(auth))
          return new Response('{"error":"You must be a member of the Discord server."}', { status: 403, headers: CORS });

        var voteBody = await request.json();
        var pollId = voteBody.pollId;
        var vote = voteBody.vote || '';
        if (!pollId || typeof pollId !== 'string' || pollId.length > 64)
          return new Response('{"error":"Invalid poll ID"}', { status: 400, headers: CORS });
        if (typeof vote !== 'string' || vote.length > 100)
          return new Response('{"error":"Invalid vote"}', { status: 400, headers: CORS });

        var poll = await env.SUBS.get('poll:' + pollId, { type: 'json' });
        if (!poll) poll = { options: {}, total: 0, voters: {} };
        if (!poll.voters) poll.voters = {};
        if (!poll.options) poll.options = {};

        var previousVote = poll.voters[user.id] || null;
        var isUnvote = !vote;

        if (previousVote) {
          if (poll.options[previousVote]) poll.options[previousVote] = Math.max(0, poll.options[previousVote] - 1);
          if (isUnvote) {
            delete poll.voters[user.id];
            poll.total = Math.max(0, (poll.total || 0) - 1);
          }
        }
        if (!isUnvote) {
          if (!previousVote) poll.total = (poll.total || 0) + 1;
          poll.voters[user.id] = vote;
          poll.options[vote] = (poll.options[vote] || 0) + 1;
        }

        await env.SUBS.put('poll:' + pollId, JSON.stringify(poll));

        return new Response(JSON.stringify({
          options: poll.options, total: poll.total, userVote: isUnvote ? null : vote
        }), { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Vote failed"}', { status: 500, headers: CORS });
      }
    }

    // --- /trivia/submit (rate limited: 20 per hour per IP) ---
    if (path === '/trivia/submit' && request.method === 'POST') {
      if (checkBodySize(request, 1024))
        return new Response('{"error":"Request too large"}', { status: 413, headers: CORS });
      var ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (await checkRateLimit('trivia:' + ip, 20, 3600))
        return new Response('{"error":"Too many requests."}', { status: 429, headers: CORS });
      try {
        var auth = request.headers.get('Authorization');
        if (!auth || !auth.startsWith('Bearer '))
          return new Response('{"error":"Not authenticated"}', { status: 401, headers: CORS });
        var userRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: auth }
        });
        if (!userRes.ok) return new Response('{"error":"Invalid token"}', { status: 401, headers: CORS });
        var user = await userRes.json();

        if (!await verifyGuildMember(auth))
          return new Response('{"error":"You must be a member of the Discord server."}', { status: 403, headers: CORS });

        var body = await request.json();
        var mode = body.mode;
        var correct = parseInt(body.correct, 10);
        var total = parseInt(body.total, 10);
        if (!mode || !['sprint','blitz','marathon','challenge'].includes(mode))
          return new Response('{"error":"Invalid mode"}', { status: 400, headers: CORS });
        if (isNaN(correct) || isNaN(total) || total <= 0 || correct < 0 || correct > total)
          return new Response('{"error":"Invalid score"}', { status: 400, headers: CORS });

        var timeMs = parseInt(body.time, 10) || 0;
        var pct = Math.round((correct / total) * 100);
        var key = 'trivia:' + mode + ':' + user.id;
        var existing = await env.SUBS.get(key, { type: 'json' });
        if (!existing) {
          existing = { id: user.id, username: user.username, global_name: user.global_name || user.username, avatar: user.avatar, pct: 0, bestTime: 0, games: 0, streak: 0, totalCorrect: 0 };
        }
        existing.username = user.username;
        existing.global_name = user.global_name || user.username;
        existing.avatar = user.avatar;
        existing.games = (existing.games || 0) + 1;
        existing.totalCorrect = (existing.totalCorrect || 0) + correct;
        if (correct >= total - 1) {
          existing.streak = (existing.streak || 0) + 1;
        } else {
          existing.streak = 0;
        }
        if (pct > (existing.pct || 0) || (pct === existing.pct && timeMs > 0 && (!existing.bestTime || timeMs < existing.bestTime))) {
          existing.pct = pct;
          if (timeMs > 0) existing.bestTime = timeMs;
          existing.correct = correct;
          existing.total = total;
        }
        existing.ts = Date.now();
        await env.SUBS.put(key, JSON.stringify(existing));

        var allKeys = await env.SUBS.list({ prefix: 'trivia:' + mode + ':' });
        var all = [];
        for (var rk of allKeys.keys) {
          var rv = await env.SUBS.get(rk.name, { type: 'json' });
          if (rv) all.push(rv);
        }
        var speedRank = null;
        if (existing.pct === 100 && existing.bestTime > 0) {
          var sp = all.filter(function(e){ return e.pct === 100 && e.bestTime > 0; })
            .sort(function(a,b){ return a.bestTime - b.bestTime; });
          for (var si = 0; si < sp.length; si++) { if (sp[si].id === user.id) { speedRank = si + 1; break; } }
        }
        var streakRank = null;
        if ((existing.streak || 0) > 0) {
          var st = all.filter(function(e){ return (e.streak || 0) > 0; })
            .sort(function(a,b){ return (b.streak||0) - (a.streak||0); });
          for (var sti = 0; sti < st.length; sti++) { if (st[sti].id === user.id) { streakRank = sti + 1; break; } }
        }
        var vetRank = null;
        var vt = all.slice().sort(function(a,b){ return (b.games||0) - (a.games||0); });
        for (var vi = 0; vi < vt.length; vi++) { if (vt[vi].id === user.id) { vetRank = vi + 1; break; } }

        ctx.waitUntil(edgeCache.delete(cacheBase + '/__c/trivia-lb:' + mode));
        return new Response(JSON.stringify({ success:true, ranks:{ speed:speedRank, streak:streakRank, veteran:vetRank } }), { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Submit failed"}', { status: 500, headers: CORS });
      }
    }

    // --- /trivia/leaderboard (edge-cached 60s, rate limited) ---
    if (path === '/trivia/leaderboard' && request.method === 'GET') {
      var ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (await checkRateLimit('get:' + ip, 30, 60))
        return new Response('{"error":"Too many requests."}', { status: 429, headers: CORS });
      try {
        var url = new URL(request.url);
        var mode = url.searchParams.get('mode') || 'challenge';
        if (!['sprint','blitz','marathon','challenge'].includes(mode))
          return new Response('{"error":"Invalid mode"}', { status: 400, headers: CORS });

        var ck = cacheBase + '/__c/trivia-lb:' + mode;
        var cr = await edgeCache.match(ck);
        if (cr) return new Response(await cr.text(), { headers: CORS });

        var list = await env.SUBS.list({ prefix: 'trivia:' + mode + ':' });
        var entries = [];
        for (var k of list.keys) {
          var val = await env.SUBS.get(k.name, { type: 'json' });
          if (val) entries.push(val);
        }
        function stripId(e){ return { id:e.id, username:e.username, global_name:e.global_name, avatar:e.avatar, pct:e.pct, bestTime:e.bestTime, games:e.games, streak:e.streak, totalCorrect:e.totalCorrect }; }
        var speed = entries.filter(function(e){ return e.pct === 100 && e.bestTime > 0; })
          .sort(function(a,b){ return a.bestTime - b.bestTime; }).slice(0,10).map(stripId);
        var streak = entries.filter(function(e){ return (e.streak||0) > 0; })
          .sort(function(a,b){
            if((b.streak||0) !== (a.streak||0)) return (b.streak||0) - (a.streak||0);
            return (a.bestTime||999999999) - (b.bestTime||999999999);
          }).slice(0,10).map(stripId);
        var veteran = entries.slice()
          .sort(function(a,b){
            if((b.games||0) !== (a.games||0)) return (b.games||0) - (a.games||0);
            return (b.totalCorrect||0) - (a.totalCorrect||0);
          }).slice(0,10).map(stripId);

        var body = JSON.stringify({ speed:speed, streak:streak, veteran:veteran });
        ctx.waitUntil(edgeCache.put(ck, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' } })));
        return new Response(body, { headers: CORS });
      } catch (e) {
        return new Response('{"error":"Leaderboard failed"}', { status: 500, headers: CORS });
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
