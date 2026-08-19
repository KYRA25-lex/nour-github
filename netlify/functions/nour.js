// Nour — fonction serveur (proxy vers Google Gemini).
// La clé Gemini reste ICI, côté serveur : elle n'est jamais visible dans le navigateur.
// Variables d'environnement à définir sur Netlify :
//   GEMINI_API_KEY  (obligatoire) : ta clé Gemini (créée SANS carte bancaire = reste gratuit)
//   NOUR_CODE       (optionnel)   : un code d'accès. Si défini, seuls ceux qui le connaissent peuvent utiliser Nour.

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
  if (!KEY) {
    return { statusCode: 500, headers: JSONH, body: JSON.stringify({ error: 'GEMINI_API_KEY manquante (à définir dans les réglages Netlify).' }) };
  }

  // Protection par code d'accès (facultative)
  const need = process.env.NOUR_CODE;
  if (need) {
    const got = event.headers['x-nour-code'] || event.headers['X-Nour-Code'] || '';
    if (got !== need) {
      return { statusCode: 401, headers: JSONH, body: JSON.stringify({ error: 'Code d\'accès invalide.' }) };
    }
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers: JSONH, body: JSON.stringify({ error: 'Requête invalide.' }) }; }

  const body = {
    system_instruction: payload.system_instruction,
    contents: payload.contents,
    generationConfig: payload.generationConfig || { maxOutputTokens: 500, temperature: 0.9, responseMimeType: 'application/json' }
  };

  // On essaie plusieurs noms de modèles (ils changent parfois) et on garde le premier qui répond.
  const preferred = (payload.model || '').replace(/[^a-z0-9.\-]/gi, '');
  const candidates = [
    preferred,
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-002',
    'gemini-2.0-flash',
    'gemini-2.0-flash-001',
    'gemini-flash-latest',
    'gemini-2.5-flash'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let last = { status: 404, text: JSON.stringify({ error: 'Aucun modèle disponible.' }) };
  for (const model of candidates) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + KEY;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      last = { status: res.status, text };
      // 404 = ce modèle n'existe pas pour cette clé → on essaie le suivant.
      if (res.status !== 404) {
        return { statusCode: res.status, headers: JSONH, body: text };
      }
    } catch (err) {
      last = { status: 502, text: JSON.stringify({ error: 'Erreur réseau vers Gemini.' }) };
    }
  }
  return { statusCode: last.status, headers: JSONH, body: last.text };
};
