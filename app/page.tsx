"use client";

import React, { useState, useRef, useEffect } from "react";
import { DrawIoEmbed } from 'react-drawio';
import { Send, ChevronRight, ChevronLeft, User, Bot, LogOut, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cookieUtils } from '../src/utils/cookie';
import { agentService } from '../src/api/agent';
import { AiAgentConfigResponseDTO } from '../src/types/api';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  agentId: string;
  sessionId: string;
  messages: Message[];
  drawioXml: string;
  createdAt: number;
  updatedAt: number;
}

interface ConversationStorage {
  v: 1;
  userId: string;
  activeId: string;
  conversations: Conversation[];
}

export default function Home() {
  const router = useRouter();
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isBookmarksOpen, setIsBookmarksOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  const [agentList, setAgentList] = useState<AiAgentConfigResponseDTO[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [newConversationAgentId, setNewConversationAgentId] = useState<string>('');
  const [sessionId, setSessionId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  
  const [drawioXml, setDrawioXml] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');

  const userIdRef = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const STORAGE_KEY = 'drawioConversations';

  const persistStorage = (next: ConversationStorage) => {
    const uid = userIdRef.current;
    if (!uid) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const updateConversations = (updater: (prev: Conversation[]) => Conversation[], nextActiveId?: string) => {
    setConversations(prev => {
      const nextList = updater(prev)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const activeId = nextActiveId ?? activeConvId ?? nextList[0]?.id ?? '';
      persistStorage({ v: 1, userId: userIdRef.current, activeId, conversations: nextList });
      return nextList;
    });
    if (nextActiveId !== undefined) setActiveConvId(nextActiveId);
  };

  const ensureConversation = (sid: string, aid: string) => {
    updateConversations(prev => {
      if (prev.some(c => c.id === sid)) return prev;
      const now = Date.now();
      const conv: Conversation = {
        id: sid,
        title: '新对话',
        agentId: aid,
        sessionId: sid,
        messages: [],
        drawioXml: '',
        createdAt: now,
        updatedAt: now
      };
      return [conv, ...prev];
    }, sid);
  };

  useEffect(() => {
    if (newConversationAgentId) return;
    setNewConversationAgentId(selectedAgentId || agentList[0]?.agentId || '');
  }, [agentList, selectedAgentId, newConversationAgentId]);

  const createConversation = (sid: string, aid: string, initialMessages: Message[]) => {
    const now = Date.now();
    const conv: Conversation = {
      id: sid,
      title: '新对话',
      agentId: aid,
      sessionId: sid,
      messages: initialMessages,
      drawioXml: '',
      createdAt: now,
      updatedAt: now
    };
    updateConversations(prev => {
      const without = prev.filter(c => c.id !== sid);
      return [conv, ...without];
    }, sid);
    setMessages(conv.messages);
    setDrawioXml('');
  };

  const handleSelectConversation = (id: string) => {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    setActiveConvId(id);
    setSelectedAgentId(conv.agentId);
    setSessionId(conv.sessionId);
    setMessages(conv.messages);
    setDrawioXml(conv.drawioXml);
    persistStorage({ v: 1, userId: userIdRef.current, activeId: id, conversations });
  };

  const handleDeleteConversation = (id: string) => {
    const nextList = conversations
      .filter(c => c.id !== id)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const nextActiveId = activeConvId === id ? (nextList[0]?.id ?? '') : activeConvId;
    setConversations(nextList);
    setActiveConvId(nextActiveId);
    persistStorage({ v: 1, userId: userIdRef.current, activeId: nextActiveId, conversations: nextList });

    if (!nextActiveId) {
      setSessionId('');
      setMessages([]);
      setDrawioXml('');
      return;
    }

    const nextActive = nextList.find(c => c.id === nextActiveId);
    if (!nextActive) return;
    setSelectedAgentId(nextActive.agentId);
    setSessionId(nextActive.sessionId);
    setMessages(nextActive.messages);
    setDrawioXml(nextActive.drawioXml);
  };

  useEffect(() => {
    const session = cookieUtils.getSession();
    if (session.isLoggedIn !== 'true' || !session.username) {
      router.replace('/login');
      return;
    }
    const username = session.username;
    setUserId(username);
    userIdRef.current = username;

    let restored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ConversationStorage;
        if (parsed && parsed.v === 1 && parsed.userId === username && Array.isArray(parsed.conversations)) {
          const list = parsed.conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
          setConversations(list);
          const activeId = parsed.activeId || list[0]?.id || '';
          if (activeId) {
            const active = list.find(c => c.id === activeId) || list[0];
            if (active) {
              setActiveConvId(active.id);
              setSelectedAgentId(active.agentId);
              setSessionId(active.sessionId);
              setMessages(active.messages);
              setDrawioXml(active.drawioXml);
              restored = true;
            }
          }
        }
      }
    } catch {}

    const init = async () => {
      try {
        const res = await agentService.queryAiAgentConfigList();
        if (res.code === '0000' && res.data && res.data.length > 0) {
          setAgentList(res.data);
          const firstAgentId = res.data[0].agentId;
          setSelectedAgentId(prev => prev || firstAgentId);
          if (!restored && !sessionId) {
            try {
              const sessionRes = await agentService.createSession({ agentId: firstAgentId, userId: username });
              if (sessionRes.code === '0000' && sessionRes.data) {
                const sid = sessionRes.data.sessionId;
                setSessionId(sid);
                createConversation(sid, firstAgentId, [{
                  id: Date.now().toString(),
                  role: 'agent',
                  content: '已为您创建新会话，请问有什么可以帮您？'
                }]);
              }
            } catch (e) {
              console.error('创建会话失败', e);
            }
          }
        }
      } catch (e) {
        console.error('获取智能体列表失败', e);
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleCreateSession = async (agentId: string, uid: string = userId) => {
    if (!agentId || !uid) return;
    try {
      const res = await agentService.createSession({ agentId, userId: uid });
      if (res.code === '0000' && res.data) {
        const sid = res.data.sessionId;
        setSessionId(sid);
        createConversation(sid, agentId, [{
          id: Date.now().toString(),
          role: 'agent',
          content: '已为您创建新会话，请问有什么可以帮您？'
        }]);
      }
    } catch (e) {
      console.error('创建会话失败', e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isChatOpen]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isSending) return;
    if (!selectedAgentId) {
      alert("请先选择智能体");
      return;
    }
    
    let currentSessionId = sessionId;
    let createdNewSession = false;
    if (!currentSessionId) {
      try {
        const res = await agentService.createSession({ agentId: selectedAgentId, userId });
        if (res.code === '0000' && res.data) {
          currentSessionId = res.data.sessionId;
          setSessionId(currentSessionId);
          createdNewSession = true;
        }
      } catch (e) {
        console.error('创建会话失败', e);
        return;
      }
    }

    if (createdNewSession) {
      createConversation(currentSessionId, selectedAgentId, [{
        id: Date.now().toString(),
        role: 'agent',
        content: '已为您创建新会话，请问有什么可以帮您？'
      }]);
    } else {
      if (!activeConvId) {
        setActiveConvId(currentSessionId);
      }
      ensureConversation(currentSessionId, selectedAgentId);
    }

    const userText = inputValue;
    setInputValue('');
    setIsSending(true);

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: userText };
    setMessages(prev => [...prev, userMsg]);
    updateConversations(prev => prev.map(c => {
      if (c.id !== currentSessionId) return c;
      const nextTitle = c.title === '新对话' ? userText.slice(0, 30) : c.title;
      return { ...c, title: nextTitle, messages: [...c.messages, userMsg], updatedAt: Date.now() };
    }), currentSessionId);

    const botMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: botMsgId, role: 'agent', content: '正在思考...' }]);

    try {
      const res = await agentService.chat({
        agentId: selectedAgentId,
        userId,
        sessionId: currentSessionId,
        message: userText
      });

      if (res.code === '0000' && res.data) {
        let finalType = res.data.type || 'user';
        let finalContent = res.data.content || '';

        // 因为 sequential_draw_process 等多 Agent 工作流可能会将多个 JSON 字符串拼接到 content 中，
        // 或者模型返回带有 Markdown 代码块包裹的 JSON 字符串，我们需要从 fullResponse 中提取最后一个合法的 JSON
        const fullResponse = finalContent;
        
        try {
          // 清除 Markdown 代码块标记，如 ```json 和 ```
          const cleanedResponse = fullResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          
          // 按 JSON 对象边界分割：} {
          const chunks = cleanedResponse.split(/(?<=\})\s*(?=\{)/);
          const lastChunk = chunks[chunks.length - 1];
          
          if (lastChunk) {
            const parsed = JSON.parse(lastChunk);
            if (parsed.type) finalType = parsed.type;
            if (parsed.content) finalContent = parsed.content;
          }
        } catch (e) {
          console.error("解析返回结果失败:", e);
          // 兜底尝试正则匹配 {"type": "...", "content": "..."}
          const msgMatch = fullResponse.match(/"type"\s*:\s*"([^"]+)"\s*,\s*"content"\s*:\s*"([\s\S]*?)"\s*\}/);
          if (msgMatch) {
            finalType = msgMatch[1];
            finalContent = msgMatch[2].replace(/\\n/g, '\n').replace(/\\"/g, '"');
          }
        }

        if (finalType === 'drawio') {
          setDrawioXml(finalContent);
          setMessages(prev => prev.map(msg =>
            msg.id === botMsgId ? { ...msg, content: '为您绘制的图表如下：' } : msg
          ));
          updateConversations(prev => prev.map(c => {
            if (c.id !== currentSessionId) return c;
            const agentMsg: Message = { id: botMsgId, role: 'agent', content: '为您绘制的图表如下：' };
            return { ...c, messages: [...c.messages, agentMsg], drawioXml: finalContent, updatedAt: Date.now() };
          }), currentSessionId);
        } else {
          // 兜底：如果 JSON 损坏，或者模型没有按要求返回 JSON，尝试直接从字符串里暴力提取 XML
          const xmlMatchFallback = finalContent.replace(/\\"/g, '"').replace(/\\n/g, '\n').match(/(<mxfile[\s\S]*?<\/mxfile>|<mxGraphModel[\s\S]*?<\/mxGraphModel>)/);
          if (xmlMatchFallback) {
            setDrawioXml(xmlMatchFallback[1]);
            let textMsg = finalContent.replace(xmlMatchFallback[1], '').replace(/```xml|```/g, '').trim();
            if (!textMsg || textMsg.includes('"type"')) textMsg = '为您绘制的图表如下：';
            
            setMessages(prev => prev.map(msg =>
              msg.id === botMsgId ? { ...msg, content: textMsg } : msg
            ));
            updateConversations(prev => prev.map(c => {
              if (c.id !== currentSessionId) return c;
              const agentMsg: Message = { id: botMsgId, role: 'agent', content: textMsg };
              return { ...c, messages: [...c.messages, agentMsg], drawioXml: xmlMatchFallback[1], updatedAt: Date.now() };
            }), currentSessionId);
          } else {
            setMessages(prev => prev.map(msg =>
              msg.id === botMsgId ? { ...msg, content: finalContent } : msg
            ));
            updateConversations(prev => prev.map(c => {
              if (c.id !== currentSessionId) return c;
              const agentMsg: Message = { id: botMsgId, role: 'agent', content: finalContent };
              return { ...c, messages: [...c.messages, agentMsg], updatedAt: Date.now() };
            }), currentSessionId);
          }
        }
      } else {
        setMessages(prev => prev.map(msg => 
          msg.id === botMsgId ? { ...msg, content: res.info || '无返回内容' } : msg
        ));
        updateConversations(prev => prev.map(c => {
          if (c.id !== currentSessionId) return c;
          const agentMsg: Message = { id: botMsgId, role: 'agent', content: res.info || '无返回内容' };
          return { ...c, messages: [...c.messages, agentMsg], updatedAt: Date.now() };
        }), currentSessionId);
      }
    } catch (error) {
      console.error("Chat Error", error);
      setMessages(prev => prev.map(msg => 
        msg.id === botMsgId ? { ...msg, content: '连接异常，请重试' } : msg
      ));
      updateConversations(prev => prev.map(c => {
        if (c.id !== currentSessionId) return c;
        const agentMsg: Message = { id: botMsgId, role: 'agent', content: '连接异常，请重试' };
        return { ...c, messages: [...c.messages, agentMsg], updatedAt: Date.now() };
      }), currentSessionId);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  const handleLogout = () => {
    cookieUtils.clearSession();
    router.replace('/login');
  };

  return (
    <div className="flex h-screen w-full bg-zinc-50 font-sans overflow-hidden">
      <aside className={`relative h-full border-r border-gray-200 bg-white shadow-sm transition-all duration-300 ease-in-out flex flex-col ${isBookmarksOpen ? 'w-64' : 'w-0'}`}>
        <button
          onClick={() => setIsBookmarksOpen(!isBookmarksOpen)}
          className="absolute -right-8 top-1/2 -translate-y-1/2 w-8 h-16 bg-white border border-l-0 border-gray-200 rounded-r-lg flex items-center justify-center cursor-pointer hover:bg-gray-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] z-10"
          title={isBookmarksOpen ? "收起书签" : "展开书签"}
        >
          {isBookmarksOpen ? <ChevronLeft size={20} className="text-gray-500" /> : <ChevronRight size={20} className="text-gray-500" />}
        </button>

        <div className={`flex flex-col h-full w-64 ${isBookmarksOpen ? 'opacity-100' : 'opacity-0 overflow-hidden'}`}>
          <div className="h-14 border-b border-gray-200 flex items-center px-4 bg-gray-50 flex-shrink-0">
            <h2 className="font-semibold text-gray-700">对话书签</h2>
          </div>
          <div className="p-3">
            <select
              value={newConversationAgentId}
              onChange={(e) => setNewConversationAgentId(e.target.value)}
              className="w-full p-2 mb-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-white"
              disabled={agentList.length === 0}
            >
              {agentList.length === 0 ? (
                <option value="">暂无智能体</option>
              ) : (
                agentList.map(agent => (
                  <option key={agent.agentId} value={agent.agentId}>{agent.agentName}</option>
                ))
              )}
            </select>
            <button
              onClick={() => handleCreateSession(newConversationAgentId, userId)}
              className="w-full py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:bg-gray-300"
              disabled={!newConversationAgentId}
            >
              新建对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`px-3 py-2 border-b border-gray-100 flex items-center justify-between cursor-pointer ${activeConvId === conv.id ? 'bg-blue-50' : 'bg-white'}`}
                onClick={() => handleSelectConversation(conv.id)}
              >
                <div className="flex-1 pr-2 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{conv.title || '未命名对话'}</div>
                  <div className="text-xs text-gray-400 truncate">{conv.sessionId}</div>
                </div>
                <button
                  className="text-gray-400 hover:text-red-500 p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteConversation(conv.id);
                  }}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* 左侧主画板区域 */}
      <main className={`flex flex-col flex-1 transition-all duration-300 ease-in-out h-full`}>
        <div className="w-full h-full p-4">
          <div className="w-full h-full border border-gray-200 rounded-lg overflow-hidden shadow-sm bg-white">
            <DrawIoEmbed 
              urlParameters={{
                ui: 'kennedy',
                spin: true,
                libraries: true,
                saveAndExit: true
              }} 
              xml={drawioXml}
            />
          </div>
        </div>
      </main>

      {/* 右侧聊天侧边栏 */}
      <div 
        className={`relative h-full bg-white border-l border-gray-200 shadow-xl transition-all duration-300 ease-in-out flex flex-col ${
          isChatOpen ? 'w-96' : 'w-0'
        }`}
      >
        {/* 展开/收起按钮 */}
        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="absolute -left-8 top-1/2 -translate-y-1/2 w-8 h-16 bg-white border border-r-0 border-gray-200 rounded-l-lg flex items-center justify-center cursor-pointer hover:bg-gray-50 shadow-[-2px_0_5px_rgba(0,0,0,0.05)] z-10"
          title={isChatOpen ? "收起对话" : "展开对话"}
        >
          {isChatOpen ? <ChevronRight size={20} className="text-gray-500" /> : <ChevronLeft size={20} className="text-gray-500" />}
        </button>

        {/* 聊天区域内容 (当展开时显示) */}
        <div className={`flex flex-col h-full w-96 ${isChatOpen ? 'opacity-100' : 'opacity-0 overflow-hidden'}`}>
          {/* 标题 */}
          <div className="flex-col border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="h-14 flex items-center justify-between px-4">
              <div className="flex items-center">
                <Bot size={20} className="text-blue-600 mr-2" />
                <h2 className="font-semibold text-gray-700">智能体助手</h2>
              </div>
              <button onClick={handleLogout} className="text-gray-500 hover:text-red-500 transition-colors" title="退出登录">
                <LogOut size={18} />
              </button>
            </div>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
            {messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`flex max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* 头像 */}
                  <div className="flex-shrink-0 mt-1">
                    {msg.role === 'user' ? (
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center ml-2">
                        <User size={16} className="text-blue-600" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mr-2 border border-gray-200">
                        <Bot size={16} className="text-gray-600" />
                      </div>
                    )}
                  </div>
                  
                  {/* 消息气泡 */}
                  <div 
                    className={`p-3 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-tr-sm' 
                        : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区域 */}
          <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
            <div className="flex items-center bg-gray-50 border border-gray-200 rounded-full px-4 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                className="flex-1 bg-transparent border-none outline-none text-sm text-gray-700 placeholder-gray-400"
              />
              <button 
                onClick={handleSendMessage}
                disabled={!inputValue.trim()}
                className={`ml-2 p-1.5 rounded-full flex items-center justify-center transition-colors ${
                  inputValue.trim() 
                    ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer' 
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Send size={16} className={inputValue.trim() ? "ml-0.5" : ""} />
              </button>
            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
