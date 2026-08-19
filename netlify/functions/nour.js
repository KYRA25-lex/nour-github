// Nour — fonction serveur (proxy vers Google Gemini).
// La clé Gemini reste ICI, côté serveur : jamais visible dans le navigateur.
// Variables Netlify : GEMINI_API_KEY (obligatoire), NOUR_CODE (optionnel).

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Nour-Code',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  const JSONH = { ...CORS, 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method not allowed' };

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) return { statusCode: 500, headers: JSONH, body: JSON.stringify({ error: 'GEMINI_API_KEY manquante (réglages Netlify).' }) };

  const need = process.env.NOUR_CODE;
  if (need) {
    const got = event.headers['x-nour-code'] || event.headers['X-Nour-Code'] || '';
    if (got !== need) return { statusCode: 401, headers: JSONH, body: JSON.stringify({ error: 'Code d\'accès invalide.' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: JSONH, body: JSON.stringify({ error: 'Requête invalide.' }) }; }

  // On force une config propre pour les modèles 2.5 (pas de "thinking" qui mange la réponse).
  const gen = Object.assign({}, payload.generationConfig || {}, {
    maxOutputTokens: 800,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingBudget: 0 }
  });
  const body = {
    system_instruction: payload.system_instruction,
    contents: payload.contents,
    generationConfig: gen
  };

  // gemini-2.5-flash EN PREMIER (c'est celui dispo avec la clé), puis d'autres en secours.
  const preferred = (payload.model || '').replace(/[^a-z0-9.\-]/gi, '');
  const candidates = [
    'gemini-2.5-flash', preferred, 'gemini-2.5-flash-lite',
    'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-1.5-flash'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let last = { status: 404, text: '{}' };
  for (const model of candidates) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + KEY;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const text = await res.text();
      last = { status: res.status, text };
      if (res.ok) return { statusCode: 200, headers: JSONH, body: text };
      if (res.status === 404 || res.status === 400) continue; // modèle absent/incompatible → on essaie le suivant
      return { statusCode: res.status, headers: JSONH, body: text };   // vraie erreur (429/403/500) → on la remonte
    } catch (err) {
      last = { status: 502, text: '{}' };
    }
  }

  // Aucun modèle n'a marché : on renvoie un message parlé clair (jamais un blocage sec).
  const msg = { reply: "Je n'ai pas trouvé de modèle compatible avec la clé. Réessaie dans un instant.", tip: "", score: null, done: false, memo: "", level: null };
  const wrapped = { candidates: [{ content: { parts: [{ text: JSON.stringify(msg) }] } }] };
  return { statusCode: 200, headers: JSONH, body: JSON.stringify(wrapped) };
};