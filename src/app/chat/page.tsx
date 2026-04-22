"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DrawIoEmbed } from "react-drawio";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, ChevronLeft, ChevronRight, Home, LogOut, Send, Settings, Trash2, User } from "lucide-react";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";
import type { AiAgentConfigResponseDTO, ChatResponseDTO, ChatStreamEventResponseDTO } from "@/types/api";

type Role = "user" | "agent";
type ThoughtType = "thinking" | "route" | "system";

interface ThoughtEvent {
  id: string;
  type: ThoughtType;
  agentName: string;
  content: string;
  createdAt: number;
}

interface Message {
  id: string;
  role: Role;
  content: string;
  traceEvents?: ThoughtEvent[];
}

interface Conversation {
  id: string;
  title: string;
  sessionId: string;
  agentId: string;
  messages: Message[];
  drawioXml: string;
  updatedAt: number;
}

const SUCCESS_CODE = "0000";
const STORAGE_KEY = "drawioConversations";
const CJK_REGEX = /[\u4E00-\u9FFF]/;
const UNICODE_ESCAPE_REGEX = /\\u[0-9a-fA-F]{4}/;
const DRAWIO_AGENT_NAME_REGEX = /draw\s*\.?\s*io/i;
const DRAWIO_AGENT_ID_FALLBACK = new Set(["100120"]);

const isDrawioAgent = (agent?: Pick<AiAgentConfigResponseDTO, "agentId" | "agentName" | "agentDesc">) => {
  if (!agent) return false;
  if (DRAWIO_AGENT_ID_FALLBACK.has(agent.agentId)) return true;
  return DRAWIO_AGENT_NAME_REGEX.test(`${agent.agentName ?? ""} ${agent.agentDesc ?? ""}`);
};

const decodeUnicodeEscapes = (value: string): string => {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
};

const normalizePotentialMojibake = (value: string): string => {
  if (!value) return value;
  const unicodeNormalized = UNICODE_ESCAPE_REGEX.test(value) ? decodeUnicodeEscapes(value) : value;
  if (CJK_REGEX.test(unicodeNormalized)) return unicodeNormalized;
  if (!/[^\u0000-\u007F]/.test(unicodeNormalized)) return unicodeNormalized;

  const bytes = new Uint8Array(unicodeNormalized.length);
  for (let i = 0; i < unicodeNormalized.length; i += 1) {
    const code = unicodeNormalized.charCodeAt(i);
    if (code > 0xff) {
      return unicodeNormalized;
    }
    bytes[i] = code;
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (decoded.includes("\uFFFD")) return unicodeNormalized;

  const decodedCjkCount = (decoded.match(CJK_REGEX) ?? []).length;
  return decodedCjkCount >= 2 ? decoded : unicodeNormalized;
};

const normalizeTraceEvents = (events: ThoughtEvent[]): ThoughtEvent[] => {
  const merged: ThoughtEvent[] = [];
  for (const event of events) {
    const normalized: ThoughtEvent = {
      id: event.id,
      type: event.type,
      agentName: normalizePotentialMojibake(event.agentName ?? "System"),
      content: normalizePotentialMojibake(event.content ?? ""),
      createdAt: event.createdAt,
    };

    const last = merged[merged.length - 1];
    if (
      normalized.type === "thinking" &&
      last &&
      last.type === "thinking" &&
      last.agentName === normalized.agentName
    ) {
      merged[merged.length - 1] = {
        ...last,
        content: `${last.content}${normalized.content}`,
        createdAt: normalized.createdAt,
      };
      continue;
    }

    merged.push(normalized);
  }

  return merged;
};

const calcThoughtDurationSeconds = (events: ThoughtEvent[]): number => {
  if (!events.length) return 0;
  if (events.length === 1) return 1;

  const start = events[0].createdAt;
  const end = events[events.length - 1].createdAt;
  const durationSeconds = Math.round((end - start) / 1000);
  return Math.max(1, durationSeconds);
};

const formatThoughtEventText = (event: ThoughtEvent): string => {
  if (event.type === "route") {
    return event.content;
  }
  return event.content;
};

const buildThoughtPreview = (events: ThoughtEvent[]): string => {
  if (!events.length) return "\u601D\u8003\u4E2D...";

  const merged = events
    .slice(-6)
    .map((event) => formatThoughtEventText(event))
    .join("\n");

  const lines = merged
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return "\u601D\u8003\u4E2D...";
  return lines.slice(-3).join("\n");
};

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredAgentId = searchParams.get("agentId")?.trim() ?? "";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(true);
  const [agentList, setAgentList] = useState<AiAgentConfigResponseDTO[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [userId, setUserId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [activeConvId, setActiveConvId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drawioXml, setDrawioXml] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingAgentMessageId, setStreamingAgentMessageId] = useState("");

  const agentNameMap = useMemo(() => {
    return agentList.reduce<Record<string, string>>((acc, cur) => {
      acc[cur.agentId] = cur.agentName;
      return acc;
    }, {});
  }, [agentList]);

  const drawioAgentIdSet = useMemo(() => {
    const set = new Set<string>();
    agentList.forEach((agent) => {
      if (isDrawioAgent(agent)) {
        set.add(agent.agentId);
      }
    });
    return set;
  }, [agentList]);

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConvId);
  }, [conversations, activeConvId]);

  const isDrawioSession = useMemo(() => {
    const currentAgentId = activeConversation?.agentId || selectedAgentId;
    if (!currentAgentId) return false;
    return drawioAgentIdSet.has(currentAgentId);
  }, [activeConversation, selectedAgentId, drawioAgentIdSet]);

  const visibleConversations = useMemo(() => {
    if (!selectedAgentId) return conversations;
    return conversations.filter((conversation) => conversation.agentId === selectedAgentId);
  }, [conversations, selectedAgentId]);

  const defaultConversationAgentId = useMemo(() => {
    const availableAgentIds = new Set(agentList.map((agent) => agent.agentId));

    const fromActiveConversation = activeConversation?.agentId ?? "";
    if (fromActiveConversation && availableAgentIds.has(fromActiveConversation)) {
      return fromActiveConversation;
    }

    if (selectedAgentId && availableAgentIds.has(selectedAgentId)) {
      return selectedAgentId;
    }

    if (preferredAgentId && availableAgentIds.has(preferredAgentId)) {
      return preferredAgentId;
    }

    return agentList[0]?.agentId ?? "";
  }, [agentList, activeConversation, preferredAgentId, selectedAgentId]);

  const normalizeConversations = (rawConversations: Conversation[]): Conversation[] => {
    return rawConversations.map((conversation) => ({
      ...conversation,
      title: normalizePotentialMojibake(conversation.title ?? "New Chat"),
      messages: Array.isArray(conversation.messages)
        ? conversation.messages.map((msg) => ({
            id: msg.id,
            role: msg.role === "user" ? "user" : "agent",
            content: normalizePotentialMojibake(msg.content ?? ""),
            traceEvents: Array.isArray(msg.traceEvents)
              ? normalizeTraceEvents(msg.traceEvents)
              : [],
          }))
        : [],
      drawioXml: conversation.drawioXml ?? "",
    }));
  };

  const persistConversations = (nextConversations: Conversation[], nextActiveId: string, uid: string) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        userId: uid,
        activeId: nextActiveId,
        conversations: nextConversations,
      }),
    );
  };

  const replaceAgentMessage = (
    convId: string,
    messageId: string,
    content: string,
    nextXml?: string,
    persist = true,
  ) => {
    setMessages((prev) => {
      const existed = prev.some((m) => m.id === messageId);
      if (existed) {
        return prev.map((m) => (m.id === messageId ? { ...m, content } : m));
      }
      return [...prev, { id: messageId, role: "agent", content, traceEvents: [] }];
    });
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;

        const existed = c.messages.some((m) => m.id === messageId);
        const appendedMessage: Message = { id: messageId, role: "agent", content, traceEvents: [] };
        const nextMessages = existed
          ? c.messages.map((m) => (m.id === messageId ? { ...m, content } : m))
          : [...c.messages, appendedMessage];

        return {
          ...c,
          drawioXml: nextXml ?? c.drawioXml,
          messages: nextMessages,
          updatedAt: Date.now(),
        };
      });
      if (persist) {
        persistConversations(next, convId, userId);
      }
      return next;
    });
    if (nextXml !== undefined) {
      setDrawioXml(nextXml);
    }
  };

  const appendAgentMessage = (convId: string, message: Message, persist = true) => {
    setMessages((prev) => [...prev, message]);
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...c.messages, message],
          updatedAt: Date.now(),
        };
      });
      if (persist) {
        persistConversations(next, convId, userId);
      }
      return next;
    });
  };

  const mergeTraceEvents = (events: ThoughtEvent[], thought: ThoughtEvent, mergeWithLast: boolean): ThoughtEvent[] => {
    if (!mergeWithLast || events.length === 0) {
      return [...events, thought];
    }

    const last = events[events.length - 1];
    if (last.type !== thought.type || last.agentName !== thought.agentName) {
      return [...events, thought];
    }

    return [
      ...events.slice(0, -1),
      {
        ...last,
        content: `${last.content}${thought.content}`,
        createdAt: thought.createdAt,
      },
    ];
  };

  const appendMessageTrace = (
    convId: string,
    messageId: string,
    thought: ThoughtEvent,
    options?: { mergeWithLast?: boolean },
  ) => {
    const mergeWithLast = options?.mergeWithLast ?? false;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              traceEvents: mergeTraceEvents(m.traceEvents ?? [], thought, mergeWithLast),
            }
          : m,
      ),
    );

    setConversations((prev) => {
      return prev.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  traceEvents: mergeTraceEvents(m.traceEvents ?? [], thought, mergeWithLast),
                }
              : m,
          ),
          updatedAt: Date.now(),
        };
      });
    });
  };

  const parseResponse = (data: ChatResponseDTO): { type: string; content: string; xml?: string } => {
    let responseType = data.type ?? "user";
    let responseContent = normalizePotentialMojibake(data.content ?? "");

    try {
      const cleaned = responseContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const parts = cleaned.split(/(?<=\})\s*(?=\{)/);
      const last = parts[parts.length - 1];
      if (last && last.startsWith("{")) {
        const parsed = JSON.parse(last) as ChatResponseDTO;
        responseType = parsed.type ?? responseType;
        responseContent = parsed.content ?? responseContent;
      }
    } catch {
      // ignore parse failures and fallback to original content
    }

    const xmlMatch = responseContent
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .match(/(<mxfile[\s\S]*?<\/mxfile>|<mxGraphModel[\s\S]*?<\/mxGraphModel>)/);
    if (responseType === "drawio" || xmlMatch) {
      return {
        type: "drawio",
        content: "Here is the generated diagram:",
        xml: xmlMatch?.[1] ?? responseContent,
      };
    }

    return { type: responseType, content: responseContent };
  };

  const createConversation = async (agentId: string, uid: string): Promise<string | null> => {
    const res = await agentService.createSession({ agentId, userId: uid });
    if (res.code !== SUCCESS_CODE || !res.data?.sessionId) return null;

    const sid = res.data.sessionId;
    const now = Date.now();
    const welcomeMsg: Message = {
      id: `${now}`,
      role: "agent",
      content: `New session created. I am ${agentNameMap[agentId] || "Agent"}. How can I help you?`,
      traceEvents: [],
    };
    const nextConversation: Conversation = {
      id: sid,
      title: "New Chat",
      sessionId: sid,
      agentId,
      messages: [welcomeMsg],
      drawioXml: "",
      updatedAt: now,
    };

    const nextConversations = [nextConversation, ...conversations.filter((c) => c.id !== sid)];
    setSessionId(sid);
    setActiveConvId(sid);
    setSelectedAgentId(agentId);
    setMessages(nextConversation.messages);
    setDrawioXml("");
    setConversations(nextConversations);
    persistConversations(nextConversations, sid, uid);
    return sid;
  };

  const appendStreamThought = (
    conversationId: string,
    messageId: string,
    streamEvent: ChatStreamEventResponseDTO,
  ) => {
    const thoughtId = `${Date.now()}-${Math.random()}`;
    const eventType = streamEvent.type?.toLowerCase();

    if (eventType === "route") {
      const routeTarget = normalizePotentialMojibake(
        streamEvent.routeTarget || streamEvent.content || "\u672A\u6307\u5B9A\u5B50 Agent",
      );
      appendMessageTrace(conversationId, messageId, {
        id: thoughtId,
        type: "route",
        agentName: normalizePotentialMojibake(streamEvent.agentName || "\u4E3B Agent"),
        content: `进入下一处理阶段（${routeTarget}）`,
        createdAt: Date.now(),
      });
      return;
    }

    const rawContent = streamEvent.content ?? "";
    if (eventType === "thinking" && rawContent.trim()) {
      appendMessageTrace(conversationId, messageId, {
        id: thoughtId,
        type: "thinking",
        agentName: normalizePotentialMojibake(streamEvent.agentName || "\u5B50 Agent"),
        content: normalizePotentialMojibake(rawContent),
        createdAt: Date.now(),
      }, { mergeWithLast: true });
      return;
    }

    if (eventType !== "final" && eventType !== "reply" && rawContent.trim()) {
      appendMessageTrace(conversationId, messageId, {
        id: thoughtId,
        type: "system",
        agentName: normalizePotentialMojibake(streamEvent.agentName || "System"),
        content: normalizePotentialMojibake(rawContent),
        createdAt: Date.now(),
      });
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isSending || !selectedAgentId || !userId) return;

    let currentSessionId = sessionId;
    setIsSending(true);

    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();

    try {
      if (!currentSessionId) {
        const created = await createConversation(selectedAgentId, userId);
        if (!created) {
          setIsSending(false);
          return;
        }
        currentSessionId = created;
      }

      const text = inputValue.trim();
      setInputValue("");
      const userMsg: Message = { id: `${Date.now()}`, role: "user", content: text };
      const botMsgId = `${Date.now() + 1}`;
      setStreamingAgentMessageId(botMsgId);
      const pendingBotMsg: Message = {
        id: botMsgId,
        role: "agent",
        content: "",
        traceEvents: [],
      };

      setMessages((prev) => [...prev, userMsg, pendingBotMsg]);
      setConversations((prev) => {
        const next = prev.map((c) => {
          if (c.id !== currentSessionId) return c;
          return {
            ...c,
            title: c.title === "New Chat" ? text.slice(0, 24) : c.title,
            messages: [...c.messages, userMsg, pendingBotMsg],
            updatedAt: Date.now(),
          };
        });
        persistConversations(next, currentSessionId, userId);
        return next;
      });

      let activeAgentMessageId = botMsgId;
      let activeReplyContent = "";
      let finalContent = "";
      let sawFinal = false;
      let finalMessageId = botMsgId;

      await agentService.chatStream(
        {
          agentId: selectedAgentId,
          userId,
          sessionId: currentSessionId,
          message: text,
        },
        (streamEvent) => {
          const eventType = streamEvent.type?.toLowerCase();
          appendStreamThought(currentSessionId, activeAgentMessageId, streamEvent);

          if (eventType !== "reply" && eventType !== "final") return;

          const chunk = streamEvent.content ?? "";
          if (streamEvent.partial) {
            activeReplyContent += chunk;
          } else {
            activeReplyContent = activeReplyContent ? `${activeReplyContent}${chunk}` : chunk;
          }

          const normalizedReply = normalizePotentialMojibake(activeReplyContent);
          const previewText = normalizedReply.trim() || "Main agent is composing a reply...";
          replaceAgentMessage(currentSessionId, activeAgentMessageId, previewText, undefined, false);

          if (eventType === "reply") {
            if (streamEvent.partial) {
              return;
            }
            const nextMsgId = `${Date.now()}-${Math.random()}`;
            const nextPendingBotMsg: Message = {
              id: nextMsgId,
              role: "agent",
              content: "",
              traceEvents: [],
            };
            appendAgentMessage(currentSessionId, nextPendingBotMsg, false);
            setStreamingAgentMessageId(nextMsgId);
            activeAgentMessageId = nextMsgId;
            activeReplyContent = "";
            return;
          }

          sawFinal = true;
          finalContent = normalizedReply;
          finalMessageId = activeAgentMessageId;
        },
        streamAbortRef.current.signal,
      );

      if (!sawFinal || !finalContent.trim()) {
        replaceAgentMessage(currentSessionId, activeAgentMessageId, "This round ended without a final main-agent reply. Please retry.");
        setConversations((prev) => {
          const next = prev.map((c) => (c.id === currentSessionId ? { ...c, updatedAt: Date.now() } : c));
          persistConversations(next, currentSessionId, userId);
          return next;
        });
        return;
      }

      const parsed = parseResponse({ content: finalContent });
      if (parsed.type === "drawio" && parsed.xml) {
        replaceAgentMessage(currentSessionId, finalMessageId, parsed.content, parsed.xml);
      } else {
        replaceAgentMessage(currentSessionId, finalMessageId, parsed.content);
      }
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === currentSessionId ? { ...c, updatedAt: Date.now() } : c));
        persistConversations(next, currentSessionId, userId);
        return next;
      });
    } catch (error) {
      console.error(error);
      if (currentSessionId) {
        replaceAgentMessage(currentSessionId, `${Date.now() + 2}`, "Connection error, please retry.");
      }
    } finally {
      setIsSending(false);
      setStreamingAgentMessageId("");
      streamAbortRef.current = null;
    }
  };

  const handleCreateNewConversation = async () => {
    if (!defaultConversationAgentId || !userId) return;
    await createConversation(defaultConversationAgentId, userId);
  };

  const handleSelectConversation = (id: string) => {
    const current = conversations.find((c) => c.id === id);
    if (!current) return;
    setActiveConvId(current.id);
    setSessionId(current.sessionId);
    setSelectedAgentId(current.agentId);
    setMessages(current.messages);
    setDrawioXml(current.drawioXml);
    persistConversations(conversations, current.id, userId);
  };

  const handleDeleteConversation = (id: string) => {
    const next = conversations.filter((c) => c.id !== id);
    const nextVisible = selectedAgentId
      ? next.filter((c) => c.agentId === selectedAgentId)
      : next;
    const nextActive = activeConvId === id ? nextVisible[0]?.id ?? "" : activeConvId;
    setConversations(next);
    setActiveConvId(nextActive);
    persistConversations(next, nextActive, userId);

    if (!nextActive) {
      setSessionId("");
      setMessages([]);
      setDrawioXml("");
      return;
    }

    const active = next.find((c) => c.id === nextActive);
    if (!active) return;
    setSessionId(active.sessionId);
    setSelectedAgentId(active.agentId);
    setMessages(active.messages);
    setDrawioXml(active.drawioXml);
  };

  const handleLogout = () => {
    streamAbortRef.current?.abort();
    cookieUtils.clearSession();
    router.replace("/login");
  };

  useEffect(() => {
    const session = cookieUtils.getSession();
    if (session.isLoggedIn !== "true" || !session.username) {
      router.replace("/login");
      return;
    }

    const uid = session.username;
    setUserId(uid);

    const init = async () => {
      const [myRes, plazaRes] = await Promise.all([
        agentService.queryMyAgentConfigList(uid),
        agentService.queryAgentPlazaList(),
      ]);
      if (myRes.code !== SUCCESS_CODE || plazaRes.code !== SUCCESS_CODE) return;

      const mergedMap = new Map<string, AiAgentConfigResponseDTO>();
      (myRes.data ?? []).forEach((item) => {
        mergedMap.set(item.agentId, {
          agentId: item.agentId,
          agentName: item.agentName,
          agentDesc: item.agentDesc,
        });
      });
      (plazaRes.data ?? []).forEach((item) => {
        mergedMap.set(item.agentId, {
          agentId: item.agentId,
          agentName: item.agentName,
          agentDesc: item.agentDesc,
        });
      });

      const availableAgents = Array.from(mergedMap.values());
      if (!availableAgents.length) return;

      setAgentList(availableAgents);
      const preferredAgent = preferredAgentId && availableAgents.some((item) => item.agentId === preferredAgentId)
        ? preferredAgentId
        : availableAgents[0].agentId;
      setSelectedAgentId(preferredAgent);

      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            userId: string;
            activeId: string;
            conversations: Conversation[];
          };
          if (parsed.userId === uid && Array.isArray(parsed.conversations) && parsed.conversations.length > 0) {
            const normalizedConversations = normalizeConversations(parsed.conversations);
            setConversations(normalizedConversations);

            if (preferredAgent) {
              const sameAgentConversations = normalizedConversations.filter((c) => c.agentId === preferredAgent);
              if (sameAgentConversations.length === 0) {
                setActiveConvId("");
                setSessionId("");
                setMessages([]);
                setDrawioXml("");
                persistConversations(normalizedConversations, "", uid);
                return;
              }

              const active =
                sameAgentConversations.find((c) => c.id === parsed.activeId) ??
                sameAgentConversations[0];
              setActiveConvId(active.id);
              setSessionId(active.sessionId);
              setSelectedAgentId(active.agentId);
              setMessages(active.messages);
              setDrawioXml(active.drawioXml);
              return;
            }

            const active =
              normalizedConversations.find((c) => c.id === parsed.activeId) ??
              normalizedConversations[0];
            setActiveConvId(active.id);
            setSessionId(active.sessionId);
            setSelectedAgentId(active.agentId);
            setMessages(active.messages);
            setDrawioXml(active.drawioXml);
            return;
          }
        }
      } catch {
        // ignore local cache parse failures
      }

      await createConversation(preferredAgent, uid);
    };

    init().catch((e) => console.error("Initialization failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, preferredAgentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isChatOpen]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-50 font-sans">
      <aside
        className={`relative h-full border-r border-gray-200 bg-white shadow-sm transition-all duration-300 ${isBookmarksOpen ? "w-64" : "w-0"}`}
      >
        <button
          onClick={() => setIsBookmarksOpen(!isBookmarksOpen)}
          className="absolute -right-8 top-1/2 z-10 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-gray-200 bg-white"
        >
          {isBookmarksOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>

        <div className={`flex h-full w-64 flex-col ${isBookmarksOpen ? "opacity-100" : "overflow-hidden opacity-0"}`}>
          <div className="flex h-14 items-center border-b border-gray-200 bg-gray-50 px-4 font-semibold text-gray-700">
            {"\u4F1A\u8BDD\u5217\u8868"}
          </div>

          <div className="p-3">
            <button
              className="w-full rounded-md bg-blue-600 py-2 text-sm text-white hover:bg-blue-700"
              onClick={handleCreateNewConversation}
            >
              {"\u65B0\u5EFA\u4F1A\u8BDD"}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {visibleConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`flex cursor-pointer items-center justify-between border-b border-gray-100 px-3 py-2 ${activeConvId === conv.id ? "bg-blue-50" : "bg-white"}`}
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="truncate text-sm font-medium text-gray-800">{conv.title || "Conversation"}</div>
                  <div className="truncate text-xs text-gray-400">{conv.sessionId}</div>
                </div>
                <button
                  className="p-1 text-gray-400 hover:text-red-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConversation(conv.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {visibleConversations.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400">当前Agent暂无会话</div>
            ) : null}
          </div>
        </div>
      </aside>

      {isDrawioSession ? (
        <main className="flex h-full flex-1 flex-col">
          <div className="h-full w-full p-4">
            <div className="h-full w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <DrawIoEmbed urlParameters={{ ui: "kennedy", spin: true, libraries: true, saveAndExit: true }} xml={drawioXml} />
            </div>
          </div>
        </main>
      ) : null}

      <div
        className={`relative h-full border-l border-gray-200 bg-white shadow-xl transition-all duration-300 ${isChatOpen ? (isDrawioSession ? "w-96" : "flex-1") : "w-0"}`}
      >
        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="absolute -left-8 top-1/2 z-10 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-gray-200 bg-white"
        >
          {isChatOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>

        <div className={`flex h-full ${isDrawioSession ? "w-96" : "w-full"} flex-col ${isChatOpen ? "opacity-100" : "overflow-hidden opacity-0"}`}>
          <div className="border-b border-gray-200 bg-gray-50">
            <div className="flex h-14 items-center justify-between px-4">
              <div className="flex items-center text-gray-700">
                <Bot size={20} className="mr-2 text-blue-600" />
                <h2 className="font-semibold">EasyAgent平台</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => router.push("/")}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  <Home size={14} />
                  EasyAgent
                </button>
                <button
                  onClick={() => router.push("/agent-admin")}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  <Settings size={14} />
                  Admin
                </button>
                <button onClick={handleLogout} className="text-gray-500 hover:text-red-500">
                  <LogOut size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-white p-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`flex max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className="mt-1 shrink-0">
                    {msg.role === "user" ? (
                      <div className="ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                        <User size={16} className="text-blue-600" />
                      </div>
                    ) : (
                      <div className="mr-2 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-gray-100">
                        <Bot size={16} className="text-gray-600" />
                      </div>
                    )}
                  </div>
                  <div
                    className={`rounded-2xl p-3 text-sm leading-relaxed ${
                      msg.role === "user" ? "rounded-tr-sm bg-blue-600 text-white" : "rounded-tl-sm bg-gray-100 text-gray-800"
                    }`}
                  >
                    {msg.role === "agent" && (streamingAgentMessageId === msg.id || (msg.traceEvents?.length ?? 0) > 0) ? (
                      streamingAgentMessageId === msg.id ? (
                        <div className="max-h-[3.75rem] overflow-hidden whitespace-pre-wrap text-xs leading-5 text-gray-500">
                          {buildThoughtPreview(msg.traceEvents ?? [])}
                        </div>
                      ) : (
                        <details className="mb-2">
                          <summary className="list-none cursor-pointer text-xs text-gray-500 hover:text-gray-700 [&::-webkit-details-marker]:hidden">
                            <span className="inline-flex items-center gap-1">
                              <span>Thought for {calcThoughtDurationSeconds(msg.traceEvents ?? [])}s</span>
                              <span aria-hidden>{">"}</span>
                            </span>
                          </summary>
                          <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                            {(msg.traceEvents ?? []).map((event) => (
                              <p key={event.id} className="whitespace-pre-wrap text-xs leading-5 text-gray-500">
                                {event.type === "route" ? "[route] " : ""}
                                {event.content}
                              </p>
                            ))}
                          </div>
                        </details>
                      )
                    ) : null}

                    {msg.content.trim() ? <p className="whitespace-pre-wrap">{msg.content}</p> : null}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-gray-200 bg-white p-4">
            <div className="flex items-center rounded-full border border-gray-200 bg-gray-50 px-4 py-2">
              <input
                className="flex-1 bg-transparent text-sm text-gray-700 outline-none"
                placeholder={"\u8BF7\u8F93\u5165\u4F60\u7684\u95EE\u9898..."}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendMessage();
                }}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isSending}
                className={`ml-2 flex items-center justify-center rounded-full p-1.5 ${
                  inputValue.trim() && !isSending
                    ? "cursor-pointer bg-blue-600 text-white hover:bg-blue-700"
                    : "cursor-not-allowed bg-gray-200 text-gray-400"
                }`}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-zinc-50 text-zinc-500">
          Loading chat...
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
