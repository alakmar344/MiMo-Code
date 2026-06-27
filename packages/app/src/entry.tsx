// @refresh reload

import { render } from "solid-js/web"
import { handleNotificationClick } from "@/utils/notification-click"
import pkg from "../package.json"

const root = document.getElementById("root")

if (import.meta.env.VITE_STANDALONE) {
  import("@/index.css")
  const { default: StandaloneChat } = await import("@/pages/standalone-chat")
  if (root instanceof HTMLElement) {
    render(() => <StandaloneChat />, root)
  }
} else {
  const { AppBaseProviders, AppInterface } = await import("@/app")
  const { PlatformProvider } = await import("@/context/platform")
  const { ServerConnection } = await import("./context/server")

  const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

  const getLocale = () => {
    if (typeof navigator !== "object") return "en" as const
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const language of languages) {
      if (!language) continue
      if (language.toLowerCase().startsWith("zh")) return "zh" as const
    }
    return "en" as const
  }

  const getStorage = (key: string) => {
    if (typeof localStorage === "undefined") return null
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  const setStorage = (key: string, value: string | null) => {
    if (typeof localStorage === "undefined") return
    try {
      if (value !== null) {
        localStorage.setItem(key, value)
        return
      }
      localStorage.removeItem(key)
    } catch {
      return
    }
  }

  const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
  const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

  const notify = async (title: string, description?: string, href?: string) => {
    if (!("Notification" in window)) return
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission().catch(() => "denied")
        : Notification.permission
    if (permission !== "granted") return
    const inView = document.visibilityState === "visible" && document.hasFocus()
    if (inView) return
    const notification = new Notification(title, {
      body: description ?? "",
      icon: "https://opencode.ai/favicon-96x96-v3.png",
    })
    notification.onclick = () => {
      handleNotificationClick(href)
      notification.close()
    }
  }

  const getCurrentUrl = () => {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
    if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
    if (import.meta.env.DEV)
      return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
    return location.origin
  }

  const getDefaultUrl = () => {
    const lsDefault = readDefaultServerUrl()
    if (lsDefault) return lsDefault
    return getCurrentUrl()
  }

  const platform = {
    platform: "web" as const,
    version: pkg.version,
    openLink: (url: string) => window.open(url, "_blank"),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    restart: async () => window.location.reload(),
    notify,
    getDefaultServer: async () => {
      const stored = readDefaultServerUrl()
      return stored ? ServerConnection.Key.make(stored) : null
    },
    setDefaultServer: writeDefaultServerUrl,
  }

  if (root instanceof HTMLElement) {
    const server = {
      type: "http" as const,
      http: {
        url: getCurrentUrl(),
        ...(import.meta.env.VITE_SERVER_PASSWORD ? { password: import.meta.env.VITE_SERVER_PASSWORD } : {}),
      },
    }
    render(
      () => (
        <PlatformProvider value={platform}>
          <AppBaseProviders>
            <AppInterface
              defaultServer={ServerConnection.Key.make(getDefaultUrl())}
              servers={[server]}
              disableHealthCheck={!import.meta.env.VITE_API_URL}
            />
          </AppBaseProviders>
        </PlatformProvider>
      ),
      root,
    )
  }
}
