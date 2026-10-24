/** Preview-only provider: internal network, no external sends, persistent deterministic outcomes. */
export function notificationProviderService(m) {
  const program = `
    const http = require('node:http'), fs = require('node:fs');
    const file = '/app/uploads/counts.json';
    let counts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    http.createServer((req, res) => {
      const reply = (status, body) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(body)); };
      if (req.url === '/health') return reply(200, {ok:true});
      if (req.method !== 'POST') return reply(404, {ok:false});
      // Telegram check: the answer comes from an optional mode file, so a preview can show each state.
      if (req.url.endsWith('/getMe')) {
        req.resume();
        const mode = fs.existsSync('/app/uploads/getme-mode') ? fs.readFileSync('/app/uploads/getme-mode', 'utf8').trim() : 'ok';
        if (mode === 'slow') return;
        if (mode === 'malformed') { res.writeHead(200, {'content-type':'text/html'}); return res.end('<html>'); }
        if (/^[0-9]{3}$/.test(mode)) return reply(Number(mode), {ok:false,error_code:Number(mode)});
        return reply(200, {ok:true,result:{id:100000001,is_bot:true}});
      }
      let body = '', bytes = 0;
      req.on('data', chunk => { bytes += chunk.length; if (bytes > 131072) req.destroy(); else body += chunk; });
      req.on('end', () => {
        let value; try { value = JSON.parse(body); } catch { return reply(400, {ok:false,error_code:400}); }
        const chat = value.chat_id;
        if (!/^111[0-9]{3}$/.test(chat ?? '')) return reply(403, {ok:false,error_code:403});
        const count = counts[chat] ?? 0;
        counts[chat] = count + 1; fs.writeFileSync(file, JSON.stringify(counts));
        if (chat === '111003' && count === 0) return reply(200, {ok:true,result:{}});
        if (chat === '111004') return reply(403, {ok:false,error_code:403});
        if (['111001','111011','111021'].includes(chat) && count >= 5) return reply(200, {ok:true,result:{message_id:1006}});
        if (chat === '111002') return setTimeout(() => reply(200, {ok:true,result:{message_id:1002}}), 1000);
        return reply(429, {ok:false,error_code:429,parameters:{retry_after:1}});
      });
    }).listen(8099, '0.0.0.0');
  `
  return {
    image: `${m.project}-api:latest`,
    command: ['node', '-e', program],
    init: true,
    volumes: ['notification_provider_data:/app/uploads'],
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
