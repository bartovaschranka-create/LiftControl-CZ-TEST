export async function structureWithOpenAI({ request, candidate, finalUrl, pages, config, deps = {} }) {
  if (!config.openaiApiKey) return null;
  const fetchImpl = deps.fetch || fetch;
  const sourceText = pages.map(p => `PAGE ${p.page}\n${p.text.slice(0, 5000)}`).join('\n\n---\n\n');
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        {
          role: 'system',
          content: 'Vrať pouze validní JSON. Nevymýšlej nic mimo zdrojový text. Každý krok i safety musí mít krátkou sourceQuote doslovně obsaženou ve zdrojovém textu.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: request.task,
            maker: request.maker,
            model: request.model,
            sourceText,
            requiredSchema: {
              steps: [{ text: 'česky', sourceQuote: 'exact source quote', page: 1 }],
              safety: [{ text: 'česky', sourceQuote: 'exact source quote', page: 1 }],
              serialRange: 'string or empty',
              message: 'short Czech message'
            }
          })
        }
      ]
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = extractResponseText(data);
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const validated = validateAiOutput(parsed, pages);
  return {
    status: validated.steps.length ? 'ok' : 'not_found',
    maker: request.maker,
    model: request.model,
    serial: request.serial,
    manualTitle: candidate.title || '',
    manualType: candidate.type || '',
    serialRange: validated.serialRange || '',
    originalUrl: finalUrl || candidate.url,
    steps: validated.steps,
    safety: validated.safety,
    message: validated.message || (validated.steps.length ? 'Postup nalezen v originálním manuálu.' : 'Postup nebyl v ověřeném textu manuálu doložen.'),
    variants: []
  };
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const blocks = data?.output || [];
  for (const block of blocks) {
    for (const item of block.content || []) {
      if (item.type === 'output_text' && item.text) return item.text;
      if (item.text) return item.text;
    }
  }
  return '';
}

function validateAiOutput(parsed, pages) {
  const fullText = pages.map(p => p.text).join('\n').toLowerCase();
  const validItems = items => (Array.isArray(items) ? items : [])
    .filter(item => item?.text && item?.sourceQuote)
    .filter(item => fullText.includes(String(item.sourceQuote).toLowerCase()))
    .map(item => String(item.text).trim())
    .filter(Boolean);
  return {
    steps: validItems(parsed.steps),
    safety: validItems(parsed.safety),
    serialRange: typeof parsed.serialRange === 'string' ? parsed.serialRange : '',
    message: typeof parsed.message === 'string' ? parsed.message : ''
  };
}
