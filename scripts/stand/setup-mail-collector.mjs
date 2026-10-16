/** Internal-only fake-recipient mailbox. Bodies never reach logs, files or a published port. */
export const mailCollectorProgram = `
const http = require('node:http');
const token = process.env.AMCORE_SETUP_MAIL_CAPTURE_KEY;
const messages = new Map();
const maxMessage = 128 * 1024, maxTotal = 1024 * 1024, ttl = 300000;
const fakeRecipient = value => typeof value === 'string' && /^[a-z0-9._+-]{1,180}@e2e\\.amcore\\.test$/i.test(value);
const prune = () => { for (const [key, value] of messages) if (value.expires <= Date.now()) messages.delete(key); };
setInterval(prune, 1000).unref();
http.createServer((req, res) => {
  const reply = (status, body) => { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store'}); res.end(JSON.stringify(body)); };
  if (req.url === '/health' && req.method === 'GET') return reply(200, {ok:true});
  if (!token || req.headers.authorization !== 'Bearer ' + token || req.method !== 'POST') return reply(403, {ok:false});
  let chunks = [], bytes = 0;
  req.on('data', chunk => { bytes += chunk.length; if (bytes > maxMessage) { chunks = []; req.destroy(); } else chunks.push(chunk); });
  req.on('end', () => {
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, {ok:false}); }
    if (!fakeRecipient(value.to)) return reply(400, {ok:false});
    prune();
    if (req.url === '/consume') {
      const message = messages.get(value.to.toLowerCase());
      if (!message) return reply(404, {ok:false});
      messages.delete(value.to.toLowerCase()); return reply(200, {html:message.html,text:message.text});
    }
    if (req.url !== '/deliver' || typeof value.html !== 'string' || typeof value.text !== 'string') return reply(400, {ok:false});
    const size = Buffer.byteLength(JSON.stringify({html:value.html,text:value.text}));
    const used = [...messages.values()].reduce((total, message) => total + message.size, 0);
    if (size > maxMessage || used + size > maxTotal) return reply(413, {ok:false});
    messages.set(value.to.toLowerCase(), {html:value.html,text:value.text,size,expires:Date.now()+ttl});
    reply(200, {ok:true});
  });
}).listen(8099, '0.0.0.0');
`

export function setupMailCollectorService(m) {
  return {
    image: `${m.project}-api:latest`,
    command: ['node', '-e', mailCollectorProgram],
    init: true,
    read_only: true,
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    healthcheck: {
      test: [
        'CMD',
        'node',
        '-e',
        "fetch('http://127.0.0.1:8099/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ],
      interval: '2s',
      timeout: '2s',
      retries: 20,
    },
  }
}
