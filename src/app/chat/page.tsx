"use client";

/**
 * 聊天页面：负责会话列表、消息流、事件轨迹与 draw.io 面板渲染。
 */
import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { DrawIoEmbed } from "react-drawio";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Home,
  LogOut,
  Send,
  Trash2,
  User,
  Workflow,
} from "lucide-react";
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

interface TraceEventRecord extends ThoughtEvent {
  messageId: string;
  messagePreview: string;
}

interface EventGraphNode {
  id: string;
  label: string;
  kind: "root" | "agent" | "tool" | "route";
}

interface EventGraphEdge {
  id: string;
  from: string;
  to: string;
  highlighted: boolean;
}

interface Message {
  id: string;
  role: Role;
  content: string;
  traceEvents?: ThoughtEvent[];
  drawioXml?: string;
}

interface ConversationRun {
  id: string;
  userMessage?: Message;
  agentMessages: Message[];
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
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface PersistedHistoryEvent {
  type: string;
  agentName: string;
  content: string;
  routeTarget?: string;
}

type InspectorTab = "events" | "state" | "artifacts";

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

const clipLabel = (value: string, maxLength = 18): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1))}\u2026`;
};

const normalizeGraphId = (value: string): string => {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\w\u4E00-\u9FFF-]/g, "");
};

const parseRouteTarget = (content: string): string | null => {
  const bracketMatch = content.match(/[（(]([^（）()]{1,64})[）)]/);
  if (bracketMatch?.[1]?.trim()) {
    return bracketMatch[1].trim();
  }
  return null;
};

const parseToolName = (content: string): string | null => {
  const nameMatch = content.match(/name["'\s:：=]+([A-Za-z_][A-Za-z0-9_]{1,63})/);
  if (nameMatch?.[1]) {
    return nameMatch[1];
  }

  const fnMatch = content.match(/\b(get_[a-z0-9_]{2,}|[a-z][a-z0-9_]{2,}_tool)\b/i);
  if (fnMatch?.[1]) {
    return fnMatch[1];
  }

  return null;
};

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredAgentId = searchParams.get("agentId")?.trim() ?? "";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const paneResizeRef = useRef<{ side: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const drawioResizeRef = useRef<{
    side: "top" | "bottom";
    startY: number;
    startHeight: number;
  } | null>(null);

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
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("events");
  const [selectedInspectorEventIdx, setSelectedInspectorEventIdx] = useState(0);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(288);
  const [rightInspectorWidth, setRightInspectorWidth] = useState(380);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightInspectorCollapsed, setRightInspectorCollapsed] = useState(false);
  const [drawioPanelHeight, setDrawioPanelHeight] = useState(640);

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

  const selectedAgent = useMemo(() => {
    return agentList.find((item) => item.agentId === selectedAgentId);
  }, [agentList, selectedAgentId]);

  const selectedMessage = useMemo(() => {
    return messages.find((item) => item.id === selectedMessageId && item.role === "agent");
  }, [messages, selectedMessageId]);

  const messageRuns = useMemo<ConversationRun[]>(() => {
    const runs: ConversationRun[] = [];
    let activeRun: ConversationRun | null = null;
    let orphanCount = 0;

    messages.forEach((message) => {
      if (message.role === "user") {
        if (activeRun) {
          runs.push(activeRun);
        }
        activeRun = {
          id: `run-${message.id}`,
          userMessage: message,
          agentMessages: [],
        };
        return;
      }

      if (!activeRun) {
        orphanCount += 1;
        activeRun = {
          id: `run-orphan-${orphanCount}-${message.id}`,
          agentMessages: [],
        };
      }
      activeRun.agentMessages.push(message);
    });

    if (activeRun) {
      runs.push(activeRun);
    }

    return runs;
  }, [messages]);

  const runIndexByMessageId = useMemo(() => {
    const map = new Map<string, number>();
    messageRuns.forEach((run, index) => {
      const runNumber = index + 1;
      if (run.userMessage) {
        map.set(run.userMessage.id, runNumber);
      }
      run.agentMessages.forEach((message) => map.set(message.id, runNumber));
    });
    return map;
  }, [messageRuns]);

  const traceEventFeed = useMemo<TraceEventRecord[]>(() => {
    const records: TraceEventRecord[] = [];
    messages.forEach((message) => {
      if (message.role !== "agent" || !message.traceEvents?.length) return;
      message.traceEvents.forEach((event) => {
        records.push({
          ...event,
          messageId: message.id,
          messagePreview: message.content.slice(0, 80),
        });
      });
    });

    return records.sort((a, b) => a.createdAt - b.createdAt);
  }, [messages]);

  const inspectorEvents = useMemo<TraceEventRecord[]>(() => {
    if (selectedMessage?.traceEvents?.length) {
      return selectedMessage.traceEvents.map((event) => ({
        ...event,
        messageId: selectedMessage.id,
        messagePreview: selectedMessage.content.slice(0, 80),
      }));
    }
    return traceEventFeed.slice(-18);
  }, [selectedMessage, traceEventFeed]);

  const activeInspectorEvent = useMemo(() => {
    if (!inspectorEvents.length) return null;
    const safeIndex = Math.min(Math.max(0, selectedInspectorEventIdx), inspectorEvents.length - 1);
    return inspectorEvents[safeIndex];
  }, [inspectorEvents, selectedInspectorEventIdx]);

  const eventGraph = useMemo(() => {
    const rootLabel = selectedAgent?.agentName || activeInspectorEvent?.agentName || "root_agent";
    const nodeMap = new Map<string, EventGraphNode>();
    const edges: EventGraphEdge[] = [];

    const ensureNode = (label: string, kind: EventGraphNode["kind"]) => {
      const id = normalizeGraphId(label) || `node_${nodeMap.size}`;
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, label, kind });
      }
      return id;
    };

    const rootNodeId = ensureNode(rootLabel, "root");
    const total = inspectorEvents.length;
    const center = Math.min(Math.max(0, selectedInspectorEventIdx), Math.max(0, total - 1));
    const windowStart = Math.max(0, center - 2);
    const windowEnd = Math.min(total, center + 2);
    const windowEvents = inspectorEvents.slice(windowStart, windowEnd);

    windowEvents.forEach((event) => {
      const fromLabel = event.agentName?.trim() || rootLabel;
      const fromId = ensureNode(fromLabel, fromLabel === rootLabel ? "root" : "agent");

      const routeTarget = event.type === "route" ? parseRouteTarget(event.content) : null;
      const toolTarget = parseToolName(event.content);
      const toLabel = routeTarget || toolTarget;
      if (toLabel) {
        const nodeKind: EventGraphNode["kind"] = routeTarget ? "route" : "tool";
        const toId = ensureNode(toLabel, nodeKind);
        if (toId !== fromId) {
          edges.push({
            id: `${event.id}-${fromId}-${toId}`,
            from: fromId,
            to: toId,
            highlighted: activeInspectorEvent?.id === event.id,
          });
        }
        return;
      }

      if (fromId !== rootNodeId) {
        edges.push({
          id: `${event.id}-${rootNodeId}-${fromId}`,
          from: rootNodeId,
          to: fromId,
          highlighted: activeInspectorEvent?.id === event.id,
        });
      }
    });

    const nodes = Array.from(nodeMap.values());
    const nonRootNodes = nodes.filter((node) => node.id !== rootNodeId);
    const rows = Math.max(1, Math.min(4, nonRootNodes.length));
    const columns = Math.max(1, Math.ceil(nonRootNodes.length / 4));
    const graphHeight = Math.max(112, rows * 48 + 24);
    const graphWidth = 180 + columns * 160;

    const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
    positions.set(rootNodeId, { x: 24, y: Math.max(16, graphHeight / 2 - 18), w: 132, h: 36 });
    nonRootNodes.forEach((node, index) => {
      const col = Math.floor(index / 4);
      const row = index % 4;
      positions.set(node.id, {
        x: 200 + col * 150,
        y: 14 + row * 48,
        w: 132,
        h: 34,
      });
    });

    const uniqueEdges = edges.filter((edge, index, arr) => {
      return arr.findIndex((item) => item.from === edge.from && item.to === edge.to) === index;
    });

    return {
      width: graphWidth,
      height: graphHeight,
      nodes,
      edges: uniqueEdges,
      positions,
      rootNodeId,
    };
  }, [activeInspectorEvent, inspectorEvents, selectedAgent, selectedInspectorEventIdx]);

  const inspectorStateJson = useMemo(() => {
    const stateSnapshot = {
      selectedAgentId,
      selectedAgentName: selectedAgent?.agentName ?? null,
      activeConversationId: activeConvId || null,
      sessionId: sessionId || null,
      messageCount: messages.length,
      runCount: messageRuns.length,
      selectedMessageId: selectedMessage?.id ?? null,
      selectedRun: selectedMessage ? (runIndexByMessageId.get(selectedMessage.id) ?? null) : null,
      totalTokens: activeConversation?.totalTokens ?? 0,
      updatedAt: activeConversation?.updatedAt ?? null,
    };
    return JSON.stringify(stateSnapshot, null, 2);
  }, [
    activeConvId,
    activeConversation,
    messageRuns.length,
    messages.length,
    runIndexByMessageId,
    selectedAgent,
    selectedAgentId,
    selectedMessage,
    sessionId,
  ]);

  const selectedMessageJson = useMemo(() => {
    if (!selectedMessage) return "";
    return JSON.stringify(selectedMessage, null, 2);
  }, [selectedMessage]);

  const drawioArtifactSummary = useMemo(() => {
    if (!drawioXml.trim()) {
      return {
        hasArtifact: false,
        vertexCount: 0,
        edgeCount: 0,
      };
    }

    const vertexCount = (drawioXml.match(/<mxCell[^>]*vertex=\"1\"/g) ?? []).length;
    const edgeCount = (drawioXml.match(/<mxCell[^>]*edge=\"1\"/g) ?? []).length;
    return {
      hasArtifact: true,
      vertexCount,
      edgeCount,
    };
  }, [drawioXml]);

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
      const index = prev.findIndex((m) => m.id === messageId);
      if (index >= 0) {
        const current = prev[index];
        const nextDrawioXml = nextXml ?? current.drawioXml;
        if (current.content === content && current.drawioXml === nextDrawioXml) {
          return prev;
        }
        const next = [...prev];
        next[index] = { ...current, content, drawioXml: nextDrawioXml };
        return next;
      }
      return [...prev, { id: messageId, role: "agent", content, traceEvents: [], drawioXml: nextXml }];
    });
    setConversations((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.id !== convId) return c;

        const existed = c.messages.some((m) => m.id === messageId);
        const appendedMessage: Message = { id: messageId, role: "agent", content, traceEvents: [], drawioXml: nextXml };
        const nextMessages = existed
          ? c.messages.map((m) => {
              if (m.id !== messageId) return m;
              const nextDrawioXml = nextXml ?? m.drawioXml;
              if (m.content === content && m.drawioXml === nextDrawioXml) {
                return m;
              }
              changed = true;
              return { ...m, content, drawioXml: nextDrawioXml };
            })
          : (() => {
              changed = true;
              return [...c.messages, appendedMessage];
            })();

        const nextConversationDrawio = nextXml ?? c.drawioXml;
        if (c.drawioXml !== nextConversationDrawio) {
          changed = true;
        }

        return {
          ...c,
          drawioXml: nextConversationDrawio,
          messages: nextMessages,
          updatedAt: Date.now(),
        };
      });
      return changed ? next : prev;
    });
    if (nextXml !== undefined) {
      setDrawioXml(nextXml);
    }
  };

  const appendAgentMessage = (convId: string, message: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === message.id)) {
        return prev;
      }
      return [...prev, message];
    });
    setConversations((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        if (c.messages.some((m) => m.id === message.id)) {
          return c;
        }
        changed = true;
        return {
          ...c,
          messages: [...c.messages, message],
          updatedAt: Date.now(),
        };
      });
      return changed ? next : prev;
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
    _convId: string,
    messageId: string,
    thought: ThoughtEvent,
    options?: { mergeWithLast?: boolean },
  ) => {
    const mergeWithLast = options?.mergeWithLast ?? false;
    if (!thought.content?.trim()) return;

    setMessages((prev) => {
      const index = prev.findIndex((m) => m.id === messageId);
      if (index < 0) {
        return prev;
      }
      const current = prev[index];
      const nextTraceEvents = mergeTraceEvents(current.traceEvents ?? [], thought, mergeWithLast);
      const next = [...prev];
      next[index] = {
        ...current,
        traceEvents: nextTraceEvents,
      };
      return next;
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

    const normalizedContent = responseContent
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .trim();
    const xmlMatch = normalizedContent.match(/(<mxfile[\s\S]*?<\/mxfile>|<mxGraphModel[\s\S]*?<\/mxGraphModel>)/);
    if (responseType === "drawio" || xmlMatch) {
      const xml = xmlMatch?.[1] ?? normalizedContent;
      const textWithoutXml = xmlMatch ? normalizedContent.replace(xml, "") : "";
      const replyText = textWithoutXml
        .replace(/```xml\s*/gi, "")
        .replace(/```\s*/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      return {
        type: "drawio",
        content: replyText || "Here is the generated diagram:",
        xml,
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
            // reply/final 系统事件主要用于承载“带思考轨迹的阶段回复”。
            // 若没有任何轨迹上下文，通常是流式分片或回放冗余，避免再生成独立气泡。
            if (pendingTraceEvents.length === 0) {
              return;
            }

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
              drawioXml: parsed.type === "drawio" ? parsed.xml : undefined,
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
        drawioXml: parsed.type === "drawio" ? parsed.xml : undefined,
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
    const latestAgentMessage = [...nextMessages].reverse().find((item) => item.role === "agent");
    setSelectedMessageId(latestAgentMessage?.id ?? "");
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
    setSelectedMessageId("");
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

  const startPaneResize = (side: "left" | "right", event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    paneResizeRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === "left" ? leftSidebarWidth : rightInspectorWidth,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const startDrawioResize = (side: "top" | "bottom", event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    drawioResizeRef.current = {
      side,
      startY: event.clientY,
      startHeight: drawioPanelHeight,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
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
      setSelectedMessageId(botMsgId);

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
      const pendingStreamEvents: ChatStreamEventResponseDTO[] = [];
      let flushScheduled = false;

      const startNextAgentMessage = () => {
        const nextMsgId = `${Date.now()}-${Math.random()}`;
        const nextPendingBotMsg: Message = {
          id: nextMsgId,
          role: "agent",
          content: "",
          traceEvents: [],
        };
        appendAgentMessage(currentSessionId, nextPendingBotMsg);
        setStreamingAgentMessageId(nextMsgId);
        setSelectedMessageId(nextMsgId);
        activeAgentMessageId = nextMsgId;
      };

      const processStreamEvent = (streamEvent: ChatStreamEventResponseDTO) => {
        const eventType = streamEvent.type?.toLowerCase();

        const isBoundaryEvent = eventType !== "reply" && eventType !== "final";
        const boundaryHasPayload =
          eventType === "route" ||
          eventType === "thinking" ||
          (streamEvent.content ?? "").trim().length > 0;
        if (isBoundaryEvent && boundaryHasPayload && activeReplyContent.trim()) {
          startNextAgentMessage();
          activeReplyContent = "";
        }

        appendStreamThought(currentSessionId, activeAgentMessageId, streamEvent);

        if (eventType !== "reply" && eventType !== "final") return;

        const chunk = streamEvent.content ?? "";
        if (streamEvent.partial) {
          activeReplyContent += chunk;
        } else {
          activeReplyContent = activeReplyContent ? `${activeReplyContent}${chunk}` : chunk;
        }

        const normalizedReply = normalizePotentialMojibake(activeReplyContent);
        const previewParsed = parseResponse({ content: normalizedReply });
        const previewText = previewParsed.type === "drawio"
          ? (previewParsed.content?.trim() || "正在生成图，请稍候...")
          : (normalizedReply.trim() || "Main agent is composing a reply...");
        replaceAgentMessage(
          currentSessionId,
          activeAgentMessageId,
          previewText,
          previewParsed.type === "drawio" ? previewParsed.xml : undefined,
        );

        if (eventType === "reply") {
          return;
        }

        sawFinal = true;
        finalContent = normalizedReply;
        finalMessageId = activeAgentMessageId;
      };

      const flushPendingStreamEvents = () => {
        flushScheduled = false;
        if (!pendingStreamEvents.length) return;
        const batch = pendingStreamEvents.splice(0, pendingStreamEvents.length);
        for (const streamEvent of batch) {
          processStreamEvent(streamEvent);
        }
      };

      const scheduleFlushPendingStreamEvents = () => {
        if (flushScheduled) return;
        flushScheduled = true;
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            flushPendingStreamEvents();
          });
        } else {
          setTimeout(() => {
            flushPendingStreamEvents();
          }, 16);
        }
      };

      await agentService.chatStream(
        {
          agentId: currentAgentId,
          userId,
          sessionId: currentSessionId,
          message: text,
        },
        (streamEvent) => {
          pendingStreamEvents.push(streamEvent);
          scheduleFlushPendingStreamEvents();
        },
        streamAbortRef.current.signal,
      );

      flushPendingStreamEvents();

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
    setSelectedMessageId("");
    setMessages(current.messages ?? []);
    setDrawioXml(current.drawioXml ?? "");
    await loadConversationMessages(current.sessionId);
  };

  const handleDeleteConversation = async (id: string) => {
    if (!id || !userId) return;

    const targetConversation = conversations.find((item) => item.id === id);
    const targetTitle = targetConversation?.title?.trim() || "该会话";
    const confirmed = window.confirm(`确认删除会话「${targetTitle}」吗？删除后不可恢复。`);
    if (!confirmed) return;

    const deletingActiveConversation = activeConvId === id;
    if (deletingActiveConversation) {
      streamAbortRef.current?.abort();
      setStreamingAgentMessageId("");
      setIsSending(false);
    }

    try {
      const response = await agentService.deleteSession({
        sessionId: id,
        userId,
      });
      if (response.code !== SUCCESS_CODE || response.data !== true) {
        window.alert(response.info || "删除会话失败，请稍后重试。");
        return;
      }

      const nextPreferredSessionId = deletingActiveConversation ? undefined : activeConvId;
      const reloadAgentId = selectedAgentId || targetConversation?.agentId;
      if (!reloadAgentId) {
        setConversations([]);
        setActiveConvId("");
        setSessionId("");
        setMessages([]);
        setDrawioXml("");
        setSelectedMessageId("");
        return;
      }

      await loadSessionHistoryList(userId, reloadAgentId, nextPreferredSessionId);
    } catch (error) {
      console.error("Delete session failed", error);
      window.alert("删除会话失败，请稍后重试。");
    }
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
  }, [messages]);

  useEffect(() => {
    if (selectedMessageId) {
      const exists = messages.some((item) => item.id === selectedMessageId);
      if (exists) return;
    }
    const latestAgentMessage = [...messages].reverse().find((item) => item.role === "agent");
    setSelectedMessageId(latestAgentMessage?.id ?? "");
  }, [messages, selectedMessageId]);

  useEffect(() => {
    if (isDrawioSession || inspectorTab !== "artifacts") return;
    setInspectorTab("events");
  }, [inspectorTab, isDrawioSession]);

  useEffect(() => {
    if (!inspectorEvents.length) {
      setSelectedInspectorEventIdx(0);
      return;
    }
    setSelectedInspectorEventIdx(inspectorEvents.length - 1);
  }, [inspectorEvents]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (paneResizeRef.current) {
        const { side, startX, startWidth } = paneResizeRef.current;
        const deltaX = event.clientX - startX;
        if (side === "left") {
          setLeftSidebarWidth(clamp(startWidth + deltaX, 240, 520));
        } else {
          setRightInspectorWidth(clamp(startWidth - deltaX, 300, 720));
        }
      }

      if (drawioResizeRef.current) {
        const { side, startY, startHeight } = drawioResizeRef.current;
        const deltaY = event.clientY - startY;
        const nextHeight = side === "top" ? startHeight - deltaY : startHeight + deltaY;
        setDrawioPanelHeight(clamp(nextHeight, 320, 1400));
      }
    };

    const stopResize = () => {
      if (!paneResizeRef.current && !drawioResizeRef.current) {
        return;
      }
      paneResizeRef.current = null;
      drawioResizeRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
    window.addEventListener("mouseleave", stopResize);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      window.removeEventListener("mouseleave", stopResize);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Bot size={16} />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold">EasyAgent Chat</p>
              <p className="text-[11px] text-slate-500">ADK Dev UI Style</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/")}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              <Home size={14} />
              EasyAgent
            </button>
            <button onClick={handleLogout} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-rose-500">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftSidebarCollapsed ? (
          <aside className="flex w-10 shrink-0 flex-col border-r border-slate-200 bg-white">
            <button
              onClick={() => setLeftSidebarCollapsed(false)}
              className="m-1.5 inline-flex h-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
              title="展开会话栏"
            >
              <ChevronRight size={16} />
            </button>
          </aside>
        ) : (
          <>
            <aside style={{ width: `${leftSidebarWidth}px` }} className="flex shrink-0 flex-col border-r border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-3 py-3">
                <div className="mb-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Agent</p>
                  <p className="mt-0.5 truncate text-sm text-slate-700">{selectedAgent?.agentName || "-"}</p>
                </div>
                
                  <button
                    onClick={() => setLeftSidebarCollapsed(true)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                    title="收起会话栏"
                  >
                    <ChevronLeft size={14} />
                  </button>
                </div>
                <button
                  className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  onClick={handleCreateNewConversation}
                >
                  新建会话
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {visibleConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => void handleSelectConversation(conv.id)}
                    className={`cursor-pointer border-b border-slate-100 px-3 py-3 ${
                      activeConvId === conv.id ? "bg-blue-50" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{conv.title || "Conversation"}</p>
                        <p className="mt-1 truncate text-[11px] text-slate-500">{conv.sessionId}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{conv.totalTokens} tokens</p>
                      </div>
                      <button
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteConversation(conv.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {visibleConversations.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">当前 Agent 暂无会话</div>
                ) : null}
              </div>
            </aside>
            <div
              onMouseDown={(event) => startPaneResize("left", event)}
              className="group hidden w-1 shrink-0 cursor-col-resize bg-transparent md:block"
              title="拖动调整会话栏宽度"
            >
              <div className="h-full w-full bg-slate-200/30 transition-colors group-hover:bg-blue-300/70" />
            </div>
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">{activeConversation?.title || "New Chat"}</p>
            <p className="mt-1 truncate text-xs text-slate-500">
              {activeConversation?.sessionId || "未创建会话"} · {selectedAgent?.agentName || "未选择 Agent"}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-400">
                开始一段新对话吧，消息会按 ADK 风格实时流式展示。
              </div>
            ) : null}
            {messageRuns.map((run, runIndex) => (
              <section key={run.id} className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-600">Run #{runIndex + 1}</span>
                  <span>{run.agentMessages.length} agent message(s)</span>
                </div>

                {run.userMessage ? (
                  <div className="mb-2 flex justify-end">
                    <div className="flex min-w-0 max-w-[88%] flex-row-reverse">
                      <div className="mt-1 shrink-0">
                        <div className="ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                          <User size={16} className="text-blue-600" />
                        </div>
                      </div>
                      <div className="rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2.5 text-sm leading-relaxed text-white">
                        {run.userMessage.content.trim() ? (
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            {run.userMessage.content}
                          </p>
                        ) : (
                          <p className="text-white/70">...</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {run.agentMessages.map((msg) => {
                    const hasDiagram = isDrawioSession && Boolean(msg.drawioXml);
                    return (
                    <div key={msg.id} className="flex justify-start">
                      <div className={`flex min-w-0 flex-row ${hasDiagram ? "w-full" : "max-w-[92%]"}`}>
                        <div className="mt-1 shrink-0">
                          <div className="mr-2 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-100">
                            <Bot size={16} className="text-slate-600" />
                          </div>
                        </div>

                        <div
                          onClick={() => {
                            setSelectedMessageId(msg.id);
                          }}
                          className={`rounded-2xl rounded-tl-sm border p-2.5 text-sm leading-relaxed ${
                            hasDiagram ? "w-full" : ""
                          } ${
                            selectedMessageId === msg.id
                              ? "border-blue-300 bg-blue-50 text-slate-800"
                              : "border-slate-200 bg-white text-slate-800"
                          }`}
                        >
                          {streamingAgentMessageId === msg.id || (msg.traceEvents?.length ?? 0) > 0 ? (
                            streamingAgentMessageId === msg.id ? (
                              <div className="mb-2 max-h-[3.75rem] overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-slate-100 px-2 py-1 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
                                {buildThoughtPreview(msg.traceEvents ?? [])}
                              </div>
                            ) : (
                              <details className="mb-2">
                                <summary className="list-none cursor-pointer text-xs text-slate-500 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
                                  <span className="inline-flex items-center gap-1">
                                    <Activity size={12} />
                                    <span>Thought for {calcThoughtDurationSeconds(msg.traceEvents ?? [])}s</span>
                                    <span aria-hidden>{">"}</span>
                                  </span>
                                </summary>
                                <div className="mt-2 max-h-44 space-y-2 overflow-y-auto rounded-lg bg-slate-100 p-2">
                                  {(msg.traceEvents ?? []).map((event) => (
                                    <p
                                      key={event.id}
                                      className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 [overflow-wrap:anywhere]"
                                    >
                                      {event.type === "route" ? "[route] " : ""}
                                      {event.content}
                                    </p>
                                  ))}
                                </div>
                              </details>
                            )
                          ) : null}

                          {msg.content.trim() ? (
                            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.content}</p>
                          ) : (
                            <p className="text-xs text-slate-400">Waiting for response...</p>
                          )}

                          {hasDiagram ? (
                            <div className="mt-2 flex justify-start">
                              <div
                                data-drawio-panel="true"
                                className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                                style={{ width: "100%" }}
                              >
                                <div className="w-full" style={{ height: `${drawioPanelHeight}px` }}>
                                  <DrawIoEmbed
                                    urlParameters={{ ui: "kennedy", spin: true, libraries: true, saveAndExit: true }}
                                    xml={msg.drawioXml}
                                  />
                                </div>

                                <div
                                  onMouseDown={(event) => startDrawioResize("top", event)}
                                  className="absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize hover:bg-blue-200/40"
                                  title="向上/向下拖动调整高度"
                                />
                                <div
                                  onMouseDown={(event) => startDrawioResize("bottom", event)}
                                  className="absolute inset-x-0 bottom-0 z-10 h-2 cursor-row-resize hover:bg-blue-200/40"
                                  title="向上/向下拖动调整高度"
                                />

                                <div className="pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-white/75 px-1 py-0.5 text-[10px] text-slate-500">
                                  <span className="inline-flex items-center gap-1">
                                    <GripVertical size={10} className="rotate-90" />
                                    拖拽上下边缘调高度
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-slate-200 bg-white p-3">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                className="min-w-0 w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none"
                placeholder="请输入你的问题..."
                value={inputValue}
                spellCheck={false}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSendMessage();
                  }
                }}
              />
              <button
                onClick={() => void handleSendMessage()}
                disabled={!inputValue.trim() || isSending}
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  inputValue.trim() && !isSending
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "cursor-not-allowed bg-slate-200 text-slate-400"
                }`}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </main>

        {rightInspectorCollapsed ? (
          <aside className="hidden w-10 shrink-0 flex-col border-l border-slate-200 bg-white xl:flex">
            <button
              onClick={() => setRightInspectorCollapsed(false)}
              className="m-1.5 inline-flex h-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
              title="展开右侧面板"
            >
              <ChevronLeft size={16} />
            </button>
          </aside>
        ) : (
          <>
            <div
              onMouseDown={(event) => startPaneResize("right", event)}
              className="group hidden w-1 shrink-0 cursor-col-resize bg-transparent xl:block"
              title="拖动调整右侧面板宽度"
            >
              <div className="h-full w-full bg-slate-200/30 transition-colors group-hover:bg-blue-300/70" />
            </div>
            <aside
              style={{ width: `${rightInspectorWidth}px` }}
              className="hidden shrink-0 flex-col border-l border-slate-200 bg-white xl:flex"
            >
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Run Inspector</p>
                    <p className="mt-1 text-xs text-slate-500">参考 ADK Dev UI 的事件与状态视图</p>
                  </div>
                  <button
                    onClick={() => setRightInspectorCollapsed(true)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100"
                    title="收起右侧面板"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              <div className="border-b border-slate-200 px-4 py-2">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button
                    onClick={() => setInspectorTab("events")}
                    className={`rounded-md px-2 py-1.5 ${
                      inspectorTab === "events"
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Events
                  </button>
                  <button
                    onClick={() => setInspectorTab("state")}
                    className={`rounded-md px-2 py-1.5 ${
                      inspectorTab === "state"
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    State
                  </button>
                  <button
                    onClick={() => setInspectorTab("artifacts")}
                    disabled={!isDrawioSession}
                    className={`rounded-md px-2 py-1.5 ${
                      inspectorTab === "artifacts"
                        ? "bg-blue-600 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    } ${!isDrawioSession ? "cursor-not-allowed opacity-40" : ""}`}
                  >
                    Artifacts
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-600">当前会话</p>
              <p className="truncate text-xs text-slate-500">Agent: {selectedAgent?.agentName || "-"}</p>
              <p className="mt-1 truncate text-xs text-slate-500">Session: {sessionId || "-"}</p>
              <p className="mt-1 text-xs text-slate-500">Runs: {messageRuns.length}</p>
              <p className="mt-1 text-xs text-slate-500">Messages: {messages.length}</p>
              <p className="mt-1 text-xs text-slate-500">Tokens: {activeConversation?.totalTokens ?? 0}</p>
            </section>

            {inspectorTab === "events" ? (
              <section className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <Workflow size={13} />
                  <span>{selectedMessage ? "已选消息事件轨迹" : "最近事件流"}</span>
                </div>
                <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-100">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span>
                      Event {inspectorEvents.length ? selectedInspectorEventIdx + 1 : 0} of {inspectorEvents.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setSelectedInspectorEventIdx((prev) => Math.max(0, prev - 1))}
                        disabled={selectedInspectorEventIdx <= 0 || !inspectorEvents.length}
                        className="rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {"<"}
                      </button>
                      <button
                        onClick={() =>
                          setSelectedInspectorEventIdx((prev) => Math.min(inspectorEvents.length - 1, prev + 1))
                        }
                        disabled={!inspectorEvents.length || selectedInspectorEventIdx >= inspectorEvents.length - 1}
                        className="rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {">"}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-slate-700 bg-slate-950">
                    <svg width={eventGraph.width} height={eventGraph.height} className="block">
                      <defs>
                        <marker
                          id="event-arrow"
                          markerWidth="8"
                          markerHeight="8"
                          refX="7"
                          refY="4"
                          orient="auto"
                          markerUnits="strokeWidth"
                        >
                          <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" />
                        </marker>
                        <marker
                          id="event-arrow-active"
                          markerWidth="8"
                          markerHeight="8"
                          refX="7"
                          refY="4"
                          orient="auto"
                          markerUnits="strokeWidth"
                        >
                          <path d="M0,0 L8,4 L0,8 z" fill="#34d399" />
                        </marker>
                      </defs>

                      {eventGraph.edges.map((edge) => {
                        const from = eventGraph.positions.get(edge.from);
                        const to = eventGraph.positions.get(edge.to);
                        if (!from || !to) return null;
                        const fromX = from.x + from.w;
                        const fromY = from.y + from.h / 2;
                        const toX = to.x;
                        const toY = to.y + to.h / 2;
                        const midX = Math.round((fromX + toX) / 2);
                        return (
                          <path
                            key={edge.id}
                            d={`M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX} ${toY}`}
                            fill="none"
                            stroke={edge.highlighted ? "#34d399" : "#94a3b8"}
                            strokeWidth={edge.highlighted ? 2.2 : 1.6}
                            markerEnd={edge.highlighted ? "url(#event-arrow-active)" : "url(#event-arrow)"}
                            opacity={edge.highlighted ? 1 : 0.85}
                          />
                        );
                      })}

                      {eventGraph.nodes.map((node) => {
                        const pos = eventGraph.positions.get(node.id);
                        if (!pos) return null;
                        const isRoot = node.kind === "root";
                        const fillColor = isRoot ? "#0f766e" : node.kind === "tool" ? "#166534" : "#1e293b";
                        const borderColor = isRoot ? "#14b8a6" : node.kind === "tool" ? "#22c55e" : "#64748b";
                        return (
                          <g key={node.id}>
                            <rect
                              x={pos.x}
                              y={pos.y}
                              width={pos.w}
                              height={pos.h}
                              rx={18}
                              fill={fillColor}
                              stroke={borderColor}
                              strokeWidth={1.5}
                            />
                            <text
                              x={pos.x + pos.w / 2}
                              y={pos.y + pos.h / 2 + 4}
                              textAnchor="middle"
                              fontSize="12"
                              fill="#e2e8f0"
                            >
                              {clipLabel(node.label, 16)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <p className="mt-2 truncate text-[11px] text-slate-300">
                    {activeInspectorEvent ? activeInspectorEvent.content : "暂无可视化事件"}
                  </p>
                </div>
                <div className="max-h-[34rem] space-y-2 overflow-y-auto">
                  {inspectorEvents.length ? (
                    inspectorEvents.map((event, eventIdx) => (
                      <div
                        key={`${event.id}-${event.createdAt}`}
                        onClick={() => setSelectedInspectorEventIdx(eventIdx)}
                        className={`cursor-pointer rounded-lg border p-2 ${
                          selectedInspectorEventIdx === eventIdx
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-slate-100 bg-slate-50 hover:border-slate-200"
                        }`}
                      >
                        <p className="text-[11px] font-medium text-slate-600">
                          Run #{runIndexByMessageId.get(event.messageId) ?? "-"} · {event.agentName || "Agent"} · {event.type}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600 [overflow-wrap:anywhere]">
                          {event.content}
                        </p>
                        <p className="mt-1 truncate text-[10px] text-slate-400">{event.messagePreview || "-"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-400">暂无事件</p>
                  )}
                </div>
              </section>
            ) : null}

            {inspectorTab === "state" ? (
              <section className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-600">Session State</p>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2 text-[11px] leading-5 text-slate-100">
                    {inspectorStateJson}
                  </pre>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-600">Selected Message</p>
                  {selectedMessageJson ? (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2 text-[11px] leading-5 text-slate-100">
                      {selectedMessageJson}
                    </pre>
                  ) : (
                    <p className="text-xs text-slate-400">点击中间任意 agent 回复可查看原始消息结构。</p>
                  )}
                </div>
              </section>
            ) : null}

            {inspectorTab === "artifacts" ? (
              <section className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-600">DrawIO Artifact</p>
                  {drawioArtifactSummary.hasArtifact ? (
                    <div className="space-y-1 text-xs text-slate-500">
                      <p>Nodes: {drawioArtifactSummary.vertexCount}</p>
                      <p>Edges: {drawioArtifactSummary.edgeCount}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">暂无 draw.io XML 产物。</p>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="mb-1 text-xs font-semibold text-slate-600">Render Mode</p>
                  <p className="text-xs text-slate-500">draw.io 预览已改为在对话消息下方直接渲染。</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-600">XML Snapshot</p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2 text-[11px] leading-5 text-slate-100">
                    {drawioXml || "No XML artifact."}
                  </pre>
                </div>
              </section>
            ) : null}
              </div>
            </aside>
          </>
        )}
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
