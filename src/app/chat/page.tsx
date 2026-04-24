"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DrawIoEmbed } from "react-drawio";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, ChevronLeft, ChevronRight, Home, LogOut, Send, Settings, Trash2, User } from "lucide-react";
import { agentService } from "@/api/agent";
import { cookieUtils } from "@/utils/cookie";
import type {
  AiAgentConfigResponseDTO,
  ChatResponseDTO,
  ChatStreamEventResponseDTO,
  SessionHistoryMessageResponseDTO,
  SessionHistorySummaryResponseDTO,
} from "@/types/api";

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
  totalTokens: number;
  messages: Message[];
  drawioXml: string;
  updatedAt: number;
}

const SUCCESS_CODE = "0000";
const CJK_REGEX = /[\u4E00-\u9FFF]/;
const UNICODE_ESCAPE_REGEX = /\\u[0-9a-fA-F]{4}/;
const DRAWIO_AGENT_NAME_REGEX = /draw\s*\.?\s*io/i;
const DRAWIO_AGENT_ID_FALLBACK = new Set(["100120"]);
const HISTORY_EVENT_MARKER = "[[AGENT_HISTORY_EVENT]]";

interface PersistedHistoryEvent {
  type: string;
  agentName: string;
  content: string;
  routeTarget?: string;
}

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

  const replaceAgentMessage = (
    convId: string,
    messageId: string,
    content: string,
    nextXml?: string,
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
      return next;
    });
    if (nextXml !== undefined) {
      setDrawioXml(nextXml);
    }
  };

  const appendAgentMessage = (convId: string, message: Message) => {
    setMessages((prev) => [...prev, message]);
    setConversations((prev) => {
      return prev.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...c.messages, message],
          updatedAt: Date.now(),
        };
      });
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

  const parsePersistedHistoryEvent = (rawContent: string): PersistedHistoryEvent | null => {
    if (!rawContent.startsWith(HISTORY_EVENT_MARKER)) {
      return null;
    }

    const payloadText = rawContent.substring(HISTORY_EVENT_MARKER.length).trim();
    if (!payloadText) {
      return null;
    }

    try {
      const parsed = JSON.parse(payloadText) as {
        type?: string;
        agentName?: string;
        content?: string;
        routeTarget?: string;
      };

      return {
        type: (parsed.type ?? "system").toLowerCase(),
        agentName: normalizePotentialMojibake(parsed.agentName ?? ""),
        content: normalizePotentialMojibake(parsed.content ?? ""),
        routeTarget: normalizePotentialMojibake(parsed.routeTarget ?? ""),
      };
    } catch {
      return null;
    }
  };

  const mapSessionSummaryToConversation = (item: SessionHistorySummaryResponseDTO): Conversation => {
    return {
      id: item.sessionId,
      title: normalizePotentialMojibake(item.sessionTitle || "New Chat"),
      sessionId: item.sessionId,
      agentId: item.agentId,
      totalTokens: item.totalTokens ?? 0,
      messages: [],
      drawioXml: "",
      updatedAt: item.updateTime ?? item.createTime ?? Date.now(),
    };
  };

  const mapSessionMessagesToUI = (items: SessionHistoryMessageResponseDTO[]): { messages: Message[]; drawioXml: string } => {
    let latestDrawioXml = "";
    const mapped: Message[] = [];
    let pendingTraceEvents: ThoughtEvent[] = [];

    items.forEach((item, index) => {
      const roleLower = item.role?.toLowerCase() ?? "";
      const rawContent = normalizePotentialMojibake(item.content ?? "");
      const fallbackId = `${item.createTime ?? Date.now()}-${index}`;
      const messageId = `${item.id ?? fallbackId}`;
      const createdAt = item.createTime ?? Date.now();

      if (roleLower === "user") {
        mapped.push({
          id: messageId,
          role: "user",
          content: rawContent,
        });
        return;
      }

      if (roleLower === "system") {
        const historyEvent = parsePersistedHistoryEvent(rawContent);
        if (historyEvent) {
          if (historyEvent.type === "reply" || historyEvent.type === "final") {
            const parsed = parseResponse({ content: historyEvent.content });
            const replayedContent = normalizePotentialMojibake(parsed.content ?? "");
            if (parsed.type === "drawio" && parsed.xml) {
              latestDrawioXml = parsed.xml;
            }

            mapped.push({
              id: messageId,
              role: "agent",
              content: replayedContent,
              traceEvents: pendingTraceEvents,
            });
            pendingTraceEvents = [];
            return;
          }

          if (historyEvent.type === "route") {
            const routeTarget = historyEvent.routeTarget || historyEvent.content || "\u672A\u6307\u5B9A\u5B50 Agent";
            pendingTraceEvents = [
              ...pendingTraceEvents,
              {
                id: `trace-${messageId}`,
                type: "route",
                agentName: historyEvent.agentName || "\u4E3B Agent",
                content: `\u8FDB\u5165\u4E0B\u4E00\u5904\u7406\u9636\u6BB5\uFF08${routeTarget}\uFF09`,
                createdAt,
              },
            ];
            return;
          }

          if (historyEvent.content.trim()) {
            pendingTraceEvents = [
              ...pendingTraceEvents,
              {
                id: `trace-${messageId}`,
                type: "thinking",
                agentName: historyEvent.agentName || "\u5B50 Agent",
                content: historyEvent.content,
                createdAt,
              },
            ];
          }
          return;
        }

        if (rawContent.trim()) {
          pendingTraceEvents = [
            ...pendingTraceEvents,
            {
              id: `trace-${messageId}`,
              type: "system",
              agentName: "System",
              content: rawContent,
              createdAt,
            },
          ];
        }
        return;
      }

      const parsed = parseResponse({ content: rawContent });
      const agentContent = normalizePotentialMojibake(parsed.content ?? "");
      if (parsed.type === "drawio" && parsed.xml) {
        latestDrawioXml = parsed.xml;
      }

      mapped.push({
        id: messageId,
        role: "agent",
        content: agentContent,
        traceEvents: pendingTraceEvents,
      });
      pendingTraceEvents = [];
    });

    if (pendingTraceEvents.length > 0) {
      for (let i = mapped.length - 1; i >= 0; i -= 1) {
        if (mapped[i].role !== "agent") continue;
        mapped[i] = {
          ...mapped[i],
          traceEvents: [...(mapped[i].traceEvents ?? []), ...pendingTraceEvents],
        };
        break;
      }
    }

    return {
      messages: mapped,
      drawioXml: latestDrawioXml,
    };
  };

  const loadConversationMessages = async (sid: string) => {
    const response = await agentService.querySessionMessageList(sid);
    if (response.code !== SUCCESS_CODE) return;

    const { messages: nextMessages, drawioXml: nextDrawioXml } = mapSessionMessagesToUI(response.data ?? []);
    setMessages(nextMessages);
    setDrawioXml(nextDrawioXml);
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === sid
          ? {
              ...conversation,
              messages: nextMessages,
              drawioXml: nextDrawioXml,
              updatedAt: Date.now(),
            }
          : conversation,
      ),
    );
  };

  const loadSessionHistoryList = async (uid: string, agentId: string, preferredSessionId?: string) => {
    const response = await agentService.querySessionHistoryList(uid, agentId);
    if (response.code !== SUCCESS_CODE) return;

    const nextConversations = (response.data ?? []).map(mapSessionSummaryToConversation);
    setConversations(nextConversations);

    let nextActiveId = "";
    if (preferredSessionId && nextConversations.some((item) => item.id === preferredSessionId)) {
      nextActiveId = preferredSessionId;
    } else {
      nextActiveId = nextConversations[0]?.id ?? "";
    }

    setActiveConvId(nextActiveId);
    setSessionId(nextActiveId);
    if (!nextActiveId) {
      setMessages([]);
      setDrawioXml("");
      return;
    }

    const active = nextConversations.find((item) => item.id === nextActiveId);
    if (active?.agentId) {
      setSelectedAgentId(active.agentId);
    }
    await loadConversationMessages(nextActiveId);
  };

  const createConversation = async (agentId: string, uid: string): Promise<string | null> => {
    const res = await agentService.createSession({ agentId, userId: uid });
    if (res.code !== SUCCESS_CODE || !res.data?.sessionId) return null;

    const sid = res.data.sessionId;
    const now = Date.now();
    const nextConversation: Conversation = {
      id: sid,
      title: "New Chat",
      sessionId: sid,
      agentId,
      totalTokens: 0,
      messages: [],
      drawioXml: "",
      updatedAt: now,
    };

    setSessionId(sid);
    setActiveConvId(sid);
    setSelectedAgentId(agentId);
    setMessages([]);
    setDrawioXml("");
    setConversations((prev) => [nextConversation, ...prev.filter((item) => item.id !== sid)]);
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

    const currentAgentId = selectedAgentId;
    let currentSessionId = sessionId;
    setIsSending(true);

    streamAbortRef.current?.abort();
    streamAbortRef.current = new AbortController();

    try {
      if (!currentSessionId) {
        const created = await createConversation(currentAgentId, userId);
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
        return prev.map((c) => {
          if (c.id !== currentSessionId) return c;
          return {
            ...c,
            title: c.title === "New Chat" ? text.slice(0, 24) : c.title,
            messages: [...c.messages, userMsg, pendingBotMsg],
            updatedAt: Date.now(),
          };
        });
      });

      let activeAgentMessageId = botMsgId;
      let activeReplyContent = "";
      let finalContent = "";
      let sawFinal = false;
      let finalMessageId = botMsgId;

      await agentService.chatStream(
        {
          agentId: currentAgentId,
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
          replaceAgentMessage(currentSessionId, activeAgentMessageId, previewText);

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
            appendAgentMessage(currentSessionId, nextPendingBotMsg);
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
          return prev.map((c) => (c.id === currentSessionId ? { ...c, updatedAt: Date.now() } : c));
        });
        await loadSessionHistoryList(userId, currentAgentId, currentSessionId);
        return;
      }

      const parsed = parseResponse({ content: finalContent });
      if (parsed.type === "drawio" && parsed.xml) {
        replaceAgentMessage(currentSessionId, finalMessageId, parsed.content, parsed.xml);
      } else {
        replaceAgentMessage(currentSessionId, finalMessageId, parsed.content);
      }
      setConversations((prev) => {
        return prev.map((c) => (c.id === currentSessionId ? { ...c, updatedAt: Date.now() } : c));
      });
      await loadSessionHistoryList(userId, currentAgentId, currentSessionId);
    } catch (error) {
      console.error(error);
      if (currentSessionId) {
        replaceAgentMessage(currentSessionId, `${Date.now() + 2}`, "Connection error, please retry.");
        await loadSessionHistoryList(userId, currentAgentId, currentSessionId);
      }
    } finally {
      setIsSending(false);
      setStreamingAgentMessageId("");
      streamAbortRef.current = null;
    }
  };

  const handleCreateNewConversation = async () => {
    if (!defaultConversationAgentId || !userId) return;
    const created = await createConversation(defaultConversationAgentId, userId);
    if (created) {
      await loadSessionHistoryList(userId, defaultConversationAgentId, created);
    }
  };

  const handleSelectConversation = async (id: string) => {
    const current = conversations.find((c) => c.id === id);
    if (!current) return;
    setActiveConvId(current.id);
    setSessionId(current.sessionId);
    setSelectedAgentId(current.agentId);
    setMessages(current.messages ?? []);
    setDrawioXml(current.drawioXml ?? "");
    await loadConversationMessages(current.sessionId);
  };

  const handleDeleteConversation = (id: string) => {
    if (!id) return;
    window.alert("当前版本暂不支持删除会话历史。");
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
      await loadSessionHistoryList(uid, preferredAgent);
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
                  <div className="truncate text-[11px] text-gray-400">{conv.totalTokens} tokens</div>
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
