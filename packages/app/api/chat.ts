import type { IncomingMessage, ServerResponse } from "node:http"

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Method not allowed" }))
    return
  }

  const body = await readBody(req)
  const { messages, model } = body ?? {}

  if (!messages || !Array.isArray(messages)) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Missing messages array" }))
    return
  }

  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  if (!openaiKey && !anthropicKey && !googleKey) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "No API key configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY in Vercel environment variables." }))
    return
  }

  try {
    if (anthropicKey) {
      await proxyAnthropic(res, anthropicKey, messages, model)
      return
    }
    if (openaiKey) {
      await proxyOpenAI(res, openaiKey, messages, model)
      return
    }
    await proxyGoogle(res, googleKey!, messages, model)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: message }))
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        resolve({})
      }
    })
    req.on("error", reject)
  })
}

async function proxyOpenAI(res: ServerResponse, apiKey: string, messages: any[], model?: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      messages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    res.writeHead(response.status, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: `OpenAI error: ${body}` }))
    return
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const reader = response.body?.getReader()
  if (!reader) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "No response body" }))
    return
  }

  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value))
    }
  } finally {
    res.end()
  }
}

async function proxyAnthropic(res: ServerResponse, apiKey: string, messages: any[], model?: string) {
  const system = messages.find((m: any) => m.role === "system")?.content ?? ""
  const chatMessages = messages.filter((m: any) => m.role !== "system")

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: system || undefined,
      messages: chatMessages,
      stream: true,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    res.writeHead(response.status, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: `Anthropic error: ${body}` }))
    return
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const reader = response.body?.getReader()
  if (!reader) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "No response body" }))
    return
  }

  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value))
    }
  } finally {
    res.end()
  }
}

async function proxyGoogle(res: ServerResponse, apiKey: string, messages: any[], model?: string) {
  const contents = messages
    .filter((m: any) => m.role !== "system")
    .map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }))

  const system = messages.find((m: any) => m.role === "system")?.content

  const geminiModel = model || "gemini-2.0-flash"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${apiKey}`

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    res.writeHead(response.status, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: `Google error: ${body}` }))
    return
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const reader = response.body?.getReader()
  if (!reader) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "No response body" }))
    return
  }

  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value))
    }
  } finally {
    res.end()
  }
}
