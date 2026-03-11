const BASE = '/api';

export async function startTest(config) {
  const res = await fetch(`${BASE}/test/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function cancelTest(runId) {
  const res = await fetch(`${BASE}/test/${runId}/cancel`, { method: 'POST' });
  return res.json();
}

export async function getRunResults(runId) {
  const res = await fetch(`${BASE}/test/${runId}/results`);
  if (!res.ok) throw new Error('Failed to load results');
  return res.json();
}

export async function listRuns(limit = 20) {
  const res = await fetch(`${BASE}/test/runs?limit=${limit}`);
  return res.json();
}

export async function compareRuns(runIds) {
  const res = await fetch(`${BASE}/test/compare?run_ids=${runIds.join(',')}`);
  return res.json();
}

export async function getQuestions(spaceId) {
  const res = await fetch(`${BASE}/questions?genie_space_id=${encodeURIComponent(spaceId)}`);
  return res.json();
}

export async function addQuestion(spaceId, question) {
  const res = await fetch(`${BASE}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genie_space_id: spaceId, question }),
  });
  return res.json();
}

export async function addQuestionsBulk(spaceId, questions) {
  const res = await fetch(`${BASE}/questions/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genie_space_id: spaceId, questions }),
  });
  return res.json();
}

export async function deleteQuestion(id) {
  await fetch(`${BASE}/questions/${id}`, { method: 'DELETE' });
}

export async function deleteRun(runId) {
  await fetch(`${BASE}/test/${runId}`, { method: 'DELETE' });
}

export function streamTest(runId, onProgress, onDone, onError) {
  const es = new EventSource(`${BASE}/test/${runId}/stream`);
  es.addEventListener('progress', (e) => onProgress(JSON.parse(e.data)));
  es.addEventListener('done', (e) => {
    onDone(JSON.parse(e.data));
    es.close();
  });
  es.addEventListener('error', (e) => {
    if (e.data) onError(JSON.parse(e.data));
    es.close();
  });
  es.onerror = () => {
    onError({ error: 'Connection lost' });
    es.close();
  };
  return es;
}
