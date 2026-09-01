const MAX_TTL_SECONDS = 86400;

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (!configured.length || configured.includes('*')) return origin || '*';
  return configured.includes(origin) ? origin : '';
}

function responseHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store, private',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {status, headers: responseHeaders(origin)});
}

function browserSafeIceServers(servers) {
  return servers.map(server => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .filter(Boolean)
      .filter(url => !/:53(?:\?|$)/.test(url));
    return {...server, urls};
  }).filter(server => server.urls.length);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({error:'Origin is not allowed.'}, 403, 'null');
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:responseHeaders(origin)});
    if (request.method !== 'GET') return json({error:'Method not allowed.'}, 405, origin);
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({error:'TURN secrets are not configured.'}, 503, origin);

    const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`;
    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method:'POST',
        headers:{
          'Authorization':`Bearer ${env.TURN_KEY_API_TOKEN}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({ttl:MAX_TTL_SECONDS})
      });
    } catch (error) {
      console.error('TURN credential provider could not be reached', error);
      return json({error:'TURN credential provider could not be reached.'}, 502, origin);
    }
    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('TURN credential generation failed', upstream.status, detail.slice(0, 300));
      return json({error:'TURN credential generation failed.'}, 502, origin);
    }

    const payload = await upstream.json();
    const iceServers = browserSafeIceServers(payload.iceServers || []);
    if (!iceServers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => String(url).startsWith('turn')))) {
      return json({error:'The TURN provider returned no relay routes.'}, 502, origin);
    }
    return json({iceServers, ttl:MAX_TTL_SECONDS}, 200, origin);
  }
};
