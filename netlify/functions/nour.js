// Nour — fonction serveur (proxy vers Groq, gratuit et mondial).
// Variables Netlify : GROQ_API_KEY (obligatoire, gsk_...), NOUR_CODE (optionnel).
// Réponse renvoyée au format Gemini pour que l'appli marche sans modification.

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Nour-Code',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  const JSONH = { ...CORS, 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return { statusCode: 500, headers: JSONH, body: JSON.stringify({ error: 'GROQ_API_KEY manquante (réglages Netlify).' }) };

  const need = process.env.NOUR_CODE;
  if (need) {
    const got = event.headers['x-nour-code'] || event.headers['X-Nour-Code'] || '';
    if (got !== need) return { statusCode: 401, headers: JSONH, body: JSON.stringify({ error: 'Code d\'accès invalide.' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: JSONH, body: JSON.stringify({ error: 'Requête invalide.' }) }; }

  const sys = ((payload.system_instruction && payload.system_instruction.parts) || []).map(p => p.text).join('\n');
  const turns = (payload.contents || []).map(c => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: (c.parts || []).map(p => p.text).join('\n')
  }));
  const messages = [];
  if (sys) messages.push({ role: 'system', content: sys });
  for (const t of turns) messages.push(t);

  // Modèles Groq ACTUELS (2026) — les Llama 3.x ont été retirés le 17 juin 2026.
  const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];

  const wrapGemini = (text) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
  const spoken = (reply) => wrapGemini(JSON.stringify({ reply, tip: '', score: null, done: false, memo: '', level: null }));

  const errs = [];
  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + KEY },
        body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: 600 })
      });
      const raw = await res.text();
      let data = {};
      try { data = JSON.parse(raw); } catch (e) {}
      if (res.ok) {
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        if (text) return { statusCode: 200, headers: JSONH, body: wrapGemini(text) };
        errs.push(model + ': réponse vide');
        continue;
      }
      const em = (data.error && (data.error.message || data.error.code)) || ('HTTP ' + res.status);
      errs.push(model + ': ' + em);
      if (res.status === 401 || res.status === 403) break; // clé -> inutile de continuer
    } catch (err) {
      errs.push(model + ': réseau ' + (err && err.message ? err.message : ''));
    }
  }

  const joined = errs.join(' || ');
  let reply;
  if (/invalid|api key|unauthor|401|403/i.test(joined)) reply = "La clé Groq du serveur semble invalide (vérifie GROQ_API_KEY sur Netlify).";
  else if (/rate|quota|limit|429/i.test(joined)) reply = "Trop de demandes d'un coup. Attends une minute puis reparle-moi.";
  else reply = "Souci côté serveur : " + joined;
  return { statusCode: 200, headers: JSONH, body: spoken(reply) };
};
