import { createSignal, For, Show, onMount, onCleanup, type JSX } from "solid-js"

type Message = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
}

const SYSTEM_PROMPT = `You are a helpful coding assistant. You can help with code, answer programming questions, and assist with software engineering tasks. Be concise and direct.`

export default function StandaloneChat() {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [input, setInput] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let inputRef: HTMLTextAreaElement | undefined
  let messagesRef: HTMLDivElement | undefined

  const scrollToBottom = () => {
    if (messagesRef) {
      messagesRef.scrollTop = messagesRef.scrollHeight
    }
  }

  const sendMessage = async () => {
    const text = input().trim()
    if (!text || loading()) return

    setError(null)
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput("")

    const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: "" }
    setMessages((prev) => [...prev, assistantMsg])
    setLoading(true)

    try {
      const apiMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages().filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      ]

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(data.error ?? `Request failed: ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error("No response stream")

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6).trim()
          if (data === "[DONE]") continue

          try {
            const parsed = JSON.parse(data)
            // OpenAI format
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + delta }
                }
                return next
              })
              scrollToBottom()
              continue
            }

            // Anthropic format
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + parsed.delta.text }
                }
                return next
              })
              scrollToBottom()
              continue
            }

            // Google/Gemini format
            const geminiText = parsed.candidates?.[0]?.content?.parts?.[0]?.text
            if (geminiText) {
              setMessages((prev) => {
                const next = [...prev]
                const last = next[next.length - 1]
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + geminiText }
                }
                return next
              })
              scrollToBottom()
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setError(msg)
      // Remove empty assistant message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id || m.content.length > 0))
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown: JSX.EventHandler<HTMLTextAreaElement, KeyboardEvent> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  onMount(() => {
    inputRef?.focus()
  })

  return (
    <div class="flex flex-col h-dvh bg-background-base text-text-base">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-border-base">
        <div class="flex items-center gap-2">
          <span class="text-16-medium text-text-strong">MiMoCode</span>
          <span class="text-12-regular text-text-weak">Standalone</span>
        </div>
        <button
          type="button"
          class="text-12-regular text-text-weak hover:text-text-base transition-colors"
          onClick={() => setMessages([])}
        >
          New Chat
        </button>
      </div>

      {/* Messages */}
      <div ref={messagesRef} class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <Show when={messages().length === 0}>
          <div class="flex flex-col items-center justify-center h-full gap-3 text-text-weak">
            <span class="text-20-medium text-text-base">What can I help with?</span>
            <span class="text-14-regular">Ask me anything about code, debugging, or software engineering.</span>
          </div>
        </Show>
        <For each={messages()}>
          {(msg) => (
            <div class={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                class={`max-w-[80%] rounded-lg px-4 py-2 text-14-regular whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-surface-raised-base text-text-strong"
                    : "bg-surface-base text-text-base"
                }`}
              >
                {msg.content || (loading() && msg.role === "assistant" ? "..." : "")}
              </div>
            </div>
          )}
        </For>
        <Show when={error()}>
          <div class="flex justify-start">
            <div class="max-w-[80%] rounded-lg px-4 py-2 text-14-regular bg-red-500/10 text-red-400">
              {error()}
            </div>
          </div>
        </Show>
      </div>

      {/* Input */}
      <div class="px-4 pb-4 pt-2">
        <div class="flex gap-2 items-end bg-surface-base rounded-lg border border-border-base p-2">
          <textarea
            ref={inputRef}
            class="flex-1 bg-transparent text-14-regular text-text-base resize-none outline-none min-h-[24px] max-h-[120px]"
            placeholder="Type a message..."
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading()}
          />
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-12-medium bg-surface-raised-base text-text-strong hover:bg-surface-raised-base-hover transition-colors disabled:opacity-50"
            onClick={() => void sendMessage()}
            disabled={loading() || !input().trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
