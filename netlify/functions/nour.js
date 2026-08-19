// Nour — fonction serveur (proxy vers Groq, gratuit et mondial).
// La clé reste ICI, côté serveur : jamais visible dans le navigateur.
// Variables Netlify :
//   GROQ_API_KEY  (obligatoire) : ta clé Groq (console.groq.com, gratuite, sans carte). Commence par gsk_...
//   NOUR_CODE     (optionnel)   : un code d'accès.
// La réponse est renvoyée dans le format Gemini pour que l'appli marche sans modification.
 
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
 
  // Convertit le format Gemini (system_instruction + contents) vers le format Groq (messages).
  const sys = ((payload.system_instruction && payload.system_instruction.parts) || [])
    .map(p => p.text).join('\n');
  const turns = (payload.contents || []).map(c => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: (c.parts || []).map(p => p.text).join('\n')
  }));
  const messages = [];
  if (sys) messages.push({ role: 'system', content: sys });
  for (const t of turns) messages.push(t);
 
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
 
  // Renvoie une réponse au format Gemini (pour que l'appli la lise sans changement).
  const wrapGemini = (text) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
  const spoken = (reply) => wrapGemini(JSON.stringify({ reply, tip: '', score: null, done: false, memo: '', level: null }));
 
  let lastErr = '';
  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + KEY },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.9,
          max_tokens: 600,
          response_format: { type: 'json_object' }
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        return { statusCode: 200, headers: JSONH, body: wrapGemini(text) };
      }
      lastErr = (data.error && (data.error.message || data.error.code)) || ('HTTP ' + res.status);
      // 400/404 = modèle non dispo → on essaie le suivant ; sinon on sort.
      if (res.status !== 404 && res.status !== 400) break;
    } catch (err) {
      lastErr = 'réseau';
    }
  }
 
  // Échec : message parlé clair (jamais un blocage sec).
  let reply = "Je n'arrive pas à joindre mon cerveau pour l'instant. Réessaie dans un instant.";
  if (/invalid|api key|unauthor/i.test(lastErr)) reply = "La clé Groq du serveur semble invalide. Vérifie GROQ_API_KEY sur Netlify.";
  else if (/rate|quota|limit|429/i.test(lastErr)) reply = "Trop de demandes d'un coup. Attends une minute puis reparle-moi.";
  return { statusCode: 200, headers: JSONH, body: spoken(reply) };
};
 