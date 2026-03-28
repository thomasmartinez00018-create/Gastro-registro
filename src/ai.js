// ai.js — Shared OpenAI helper
import { getAIKey, AI_MODEL } from './config'

export async function callAI(messages, maxTokens = 800) {
  const key = getAIKey()
  const isGpt5 = AI_MODEL.startsWith('gpt-5')
  const body = { model: AI_MODEL, messages }
  if (isGpt5) {
    body.max_completion_tokens = maxTokens
  } else {
    body.max_tokens = maxTokens
    body.temperature = 0
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90_000) // 90s timeout

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = await resp.json()
    if (json.error) throw new Error(`OpenAI [${json.error.code || json.error.type}]: ${json.error.message}`)
    return json.choices?.[0]?.message?.content || ''
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('OpenAI timeout (90s) — verificá tu conexión a internet')
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
